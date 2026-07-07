// Session locking for agent history files.
//
// The history file (`--history history.json`) is the agent's session store: the
// `ask`/`chat` loop rewrites it after every step. When two runs touch the SAME
// history at once — a heartbeat firing during a long ask, two parallel agents, a
// chat session while a cron ask runs — the concurrent writes corrupt or silently
// drop turns. A size heuristic ("skip write if the on-disk file is bigger") only
// hides the race; it never prevents it.
//
// HistoryLock is a real advisory lock: one `<history>.lock` file per history file,
// created atomically (O_EXCL). A run acquires it when the history is first loaded,
// holds it for the whole run, refreshes it on every save, and releases it on exit —
// including error and signal paths. On contention the default is to FAIL FAST with a
// clear error and a distinguishable exit code; `--waitLock <duration>` opts into
// poll-waiting instead. A lock whose owner is dead (pid gone) or that has gone stale
// (no refresh within the stale threshold) is stolen with a warning so a crashed run
// can never wedge a history file forever.

import fs from "node:fs";
import os from "node:os";

// Exit code the ask/chat command sets when it cannot acquire the history lock.
// Distinct from a generic failure (1) and from the loop-budget code (7) so a
// supervisor can tell "history in use" apart from a real error.
export const LOCK_EXIT_CODE = 8;

// A run whose lock has not been refreshed within this window is presumed dead and
// its lock may be stolen. Each save refreshes the lock, so this is really a
// "no progress for this long" threshold, not a cap on total run time.
export const DEFAULT_STALE_MS = 30 * 60 * 1000; // 30 minutes

export class LockError extends Error {
  constructor(message, info) {
    super(message);
    this.name = "LockError";
    this.info = info || null;
  }
}

// Parse a human duration into milliseconds. Accepts "500ms", "30s", "5m", "2h", or a
// bare number (interpreted as milliseconds). Returns null for empty/invalid input.
export function parseDuration(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const str = `${value}`.trim();
  if (str === "") return null;
  const match = str.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i);
  if (!match) return null;
  const amount = parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] || "ms").toLowerCase();
  const factor = unit === "h" ? 3600000 : unit === "m" ? 60000 : unit === "s" ? 1000 : 1;
  return Math.round(amount * factor);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class HistoryLock {
  constructor(historyFile, options = {}) {
    this.historyFile = historyFile;
    this.lockPath = `${historyFile}.lock`;
    this.pid = options.pid || process.pid;
    this.host = options.host || os.hostname();
    // How long to poll-wait for a busy lock before failing (0 = fail fast).
    this.waitMs = options.waitMs !== undefined && options.waitMs !== null ? options.waitMs : 0;
    // Age (since last refresh) beyond which a lock is considered abandoned.
    this.staleMs = options.staleMs !== undefined && options.staleMs !== null ? options.staleMs : DEFAULT_STALE_MS;
    this.pollMs = options.pollMs || 250;
    this.held = false;
    this._exitHandlersInstalled = false;
    this._onExit = null;
    this._onSignal = null;
  }

  _payload() {
    return JSON.stringify({
      pid: this.pid,
      host: this.host,
      time: Date.now(),
      iso: new Date().toISOString()
    });
  }

  _readLock() {
    try {
      const raw = fs.readFileSync(this.lockPath, "utf-8");
      const info = JSON.parse(raw);
      if (info && typeof info === "object") return info;
      return null;
    } catch (e) {
      if (e.code === "ENOENT") return null;
      // Corrupt/unreadable lock content: treat as present-but-unknown so the caller
      // can decide staleness from mtime.
      return {};
    }
  }

  // Is the owning process still alive? Only answerable on the same host. Returns
  // true when we cannot tell (different host / permission denied) so we never steal a
  // possibly-live lock on pid grounds alone.
  _ownerAlive(info) {
    if (!info || info.host !== this.host || !info.pid) return true;
    try {
      process.kill(info.pid, 0);
      return true;
    } catch (e) {
      if (e.code === "ESRCH") return false; // no such process
      if (e.code === "EPERM") return true; // exists, owned by another user
      return true;
    }
  }

  _age(info) {
    let base = info && typeof info.time === "number" ? info.time : null;
    if (base === null) {
      try {
        base = fs.statSync(this.lockPath).mtimeMs;
      } catch {
        base = Date.now();
      }
    }
    return Date.now() - base;
  }

  // A lock is stale if its owner is gone (same-host pid dead) or it has not been
  // refreshed within the stale threshold.
  _isStale(info) {
    if (!this._ownerAlive(info)) return true;
    if (this.staleMs !== null && this._age(info) > this.staleMs) return true;
    return false;
  }

  _describe(info) {
    const pid = info && info.pid ? info.pid : "?";
    const host = info && info.host ? info.host : "?";
    const since = info && info.iso ? info.iso : "unknown time";
    return `pid ${pid}${host !== this.host ? ` on ${host}` : ""} since ${since}`;
  }

  // Try to create the lock atomically. Returns true on success, false if it already
  // exists. Throws on any other filesystem error.
  _tryCreate() {
    let fd;
    try {
      fd = fs.openSync(this.lockPath, "wx");
    } catch (e) {
      if (e.code === "EEXIST") return false;
      throw e;
    }
    try {
      fs.writeSync(fd, this._payload());
    } finally {
      fs.closeSync(fd);
    }
    return true;
  }

  // Acquire the lock. Default behaviour is fail-fast: if the file is held by a live,
  // non-stale owner, throw a LockError immediately. With waitMs > 0, poll until the
  // lock frees (or the deadline passes). A stale lock is stolen (with a warning).
  async acquire() {
    const deadline = Date.now() + (this.waitMs || 0);
    let warnedWaiting = false;

    for (;;) {
      if (this._tryCreate()) {
        this.held = true;
        this._installExitHandlers();
        return this;
      }

      const info = this._readLock();

      if (this._isStale(info)) {
        console.error(`[lock] stealing stale history lock (${this._describe(info)}) on ${this.lockPath}`);
        this._steal();
        continue;
      }

      if (this.waitMs > 0 && Date.now() < deadline) {
        if (!warnedWaiting) {
          console.error(`[lock] history ${this.historyFile} in use by ${this._describe(info)}; waiting up to ${this.waitMs}ms`);
          warnedWaiting = true;
        }
        await sleep(Math.min(this.pollMs, Math.max(0, deadline - Date.now())));
        continue;
      }

      throw new LockError(
        `history in use by ${this._describe(info)} (${this.lockPath}). Wait with --waitLock <duration> or steal a dead lock by removing the file.`,
        info
      );
    }
  }

  // Remove a lock we do not own (only called after a staleness check).
  _steal() {
    try {
      fs.unlinkSync(this.lockPath);
    } catch (e) {
      if (e.code !== "ENOENT") {
        throw new LockError(`failed to steal stale lock ${this.lockPath}: ${e.message}`);
      }
    }
  }

  // Refresh the lock's timestamp so a live, actively-working run is never mistaken
  // for a stale one. Best-effort: never throws. Re-creates the lock if it vanished
  // while we still believe we hold it.
  touch() {
    if (!this.held) return;
    try {
      fs.writeFileSync(this.lockPath, this._payload());
    } catch {
      // Ignore — a missing directory / transient error must not break the save path.
    }
  }

  // Release the lock if we still hold it and it is still ours. Idempotent; safe to
  // call from exit handlers and finally blocks.
  release() {
    if (!this.held) return;
    this.held = false;
    this._removeExitHandlers();
    try {
      const info = this._readLock();
      if (info && info.pid && info.pid !== this.pid) return; // not ours anymore (stolen)
      fs.unlinkSync(this.lockPath);
    } catch (e) {
      if (e && e.code !== "ENOENT") {
        console.error(`[lock] failed to release ${this.lockPath}: ${e.message}`);
      }
    }
  }

  _installExitHandlers() {
    if (this._exitHandlersInstalled) return;
    this._exitHandlersInstalled = true;

    this._onExit = () => this.release();
    this._onSignal = signal => {
      this.release();
      // Re-raise with the default disposition so the exit status reflects the signal.
      process.removeListener(signal, this._onSignal);
      process.kill(process.pid, signal);
    };

    process.on("exit", this._onExit);
    process.on("SIGINT", this._onSignal);
    process.on("SIGTERM", this._onSignal);
    process.on("SIGHUP", this._onSignal);
  }

  _removeExitHandlers() {
    if (!this._exitHandlersInstalled) return;
    this._exitHandlersInstalled = false;
    if (this._onExit) process.removeListener("exit", this._onExit);
    if (this._onSignal) {
      process.removeListener("SIGINT", this._onSignal);
      process.removeListener("SIGTERM", this._onSignal);
      process.removeListener("SIGHUP", this._onSignal);
    }
  }
}

// Atomically write string data to filePath by writing a sibling temp file and
// renaming it into place. rename(2) is atomic within a filesystem, so a reader (or a
// crashing writer) never observes a half-written history file. Falls back to a direct
// write only if the rename target lives on a different device.
export function writeFileAtomic(filePath, data) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    if (e.code === "EXDEV") {
      fs.writeFileSync(filePath, data);
      return;
    }
    throw e;
  }
}

export default HistoryLock;
