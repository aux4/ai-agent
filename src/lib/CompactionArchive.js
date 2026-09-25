import fs from "node:fs";
import path from "node:path";

// Compaction without loss (AGC-019).
//
// Auto-compaction replaces the oldest part of a conversation with one summary
// message. Before this existed, those messages were simply gone: the history
// file was rewritten and nothing kept the originals. Now the FULL pre-compaction
// history is written next to the history file first, as
//
//   <historyFile without .json>.<YYYYMMDDHHMMSS>.json   (UTC)
//
// and the summary message names that file (`archive`). A reader (a chat UI, an
// audit) can follow the chain back: an archive's own first message may itself be
// an older summary pointing at an older archive.
//
// The archive is written BEFORE the history is rewritten, and if it cannot be
// written the compaction is skipped — keeping a long history is always better
// than losing part of it.

export function compactionTimestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

export function archiveBase(historyFile) {
  return String(historyFile || "").replace(/\.json$/i, "");
}

// A free archive path for this history file and moment. Two compactions in the
// same second (rare, but a tight loop can do it) get a -N suffix instead of
// overwriting the first archive.
export function archivePath(historyFile, date = new Date()) {
  const base = `${archiveBase(historyFile)}.${compactionTimestamp(date)}`;
  let candidate = `${base}.json`;
  for (let n = 1; fs.existsSync(candidate); n++) {
    candidate = `${base}-${n}.json`;
  }
  return candidate;
}

// Write `data` (the already-serialized history payload) as the archive and return
// { file, name } — name is the basename stored on the summary message.
export function writeArchive(historyFile, data, date = new Date()) {
  const file = archivePath(historyFile, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return { file, name: path.basename(file) };
}

// Stamp the summary message a compaction produced with where the originals went.
// Returns the summary message, or null when the compaction produced none (too few
// messages to summarize: only tool messages were condensed).
export function markSummary(messages, previous, { archive = null, compactedAt = new Date().toISOString() } = {}) {
  const before = new Set(Array.isArray(previous) ? previous : []);
  const summary = (Array.isArray(messages) ? messages : []).find(message =>
    message && message.compacted === true && !before.has(message)
  );
  if (!summary) return null;
  summary.compactedAt = compactedAt;
  if (archive) summary.archive = archive;
  return summary;
}
