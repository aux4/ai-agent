// Tool-call hooks that follow aux4 core's own hook standard (core/core.go `Hook`,
// engine/virtual.go matching, engine/executor/executor.go phases) so a caller can check a
// tool call BEFORE it runs, inside the round -- the same shape, matching semantics and
// before/replace/after/error phases as `hooks` on a package's own .aux4 file.
//
// Declared where aux4 itself declares hooks (a package's own `hooks` array), but at the
// tool-call granularity ai-agent operates at: `aux4 ai agent ask --hooks hooks.json
// '...'` points at a file shaped `{ "hooks": [...] }`. Each hook additionally names the
// tool it targets (`"tool": "executeAux4"` by default); for executeAux4, `command`
// matches `<profile>/<command>` exactly like core, resolved via `aux4 <action> --whereIsIt`
// (never string-prefix guessing) so it is correct for any installed package.
//
// Differences from core, and why:
//   - Steps run as a REAL aux4 command (a scratch package written to a temp dir, one
//     command whose `execute` is the hook's steps) so the DSL, ${var} interpolation and
//     blocked-executor rules are aux4's own, not a reimplementation.
//   - `params` filtering matches the CALL's own params the way aux4 would parse them for
//     that command (name/value pairs parsed from the command string for executeAux4, or
//     the tool's own args object for every other tool) -- not full aux4 resolution (no
//     config merge, no declared defaults, no dot-notation). A repeatable flag (e.g.
//     `--field` given more than once) matches a `params` pattern if ANY of its values
//     match, mirroring core's single-value match extended to a list.
//   - `after` cannot reach into a shared mutable response variable the way a core hook
//     can (`set:response=...`) because a tool call's result is a plain return value, not
//     an aux4 param. The documented equivalent: when an `after` hook's steps exit 0 AND
//     print non-empty stdout, that stdout REPLACES the tool's result; otherwise the
//     original result stands untouched.
//   - `error` fires only when the underlying tool call THROWS (mirrors core, where the
//     error phase fires on the command's own execution failing) -- most tools here
//     already turn a failure into ordinary returned text (e.g. executeAux4 on a non-zero
//     aux4 exit), which core itself would treat as a successful call too.
//   - Fail-closed: a `before` or `replace` hook step that crashes, times out, or exits
//     non-zero blocks the call, same as core treating a failing before-step as aborting
//     the command. `after`/`error` are best-effort and never override a already-decided
//     outcome beyond the documented stdout-replacement above.
//   - Recursion guard: a single process-wide depth counter (not per-tool) -- no hook
//     runs while another hook phase is already running in this process, matching core's
//     `env.InHook`. In practice a hook step runs as its own `aux4` subprocess, which has
//     no path back into this process's tool wrapper, so this is a belt-and-braces match
//     to core's contract rather than a scenario reachable today.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tool } from "@langchain/core/tools";
import { buildAux4Argv } from "./CommandArgs.js";

const BLOCKED_HOOK_EXECUTORS = ["profile:", "stdin:"];
const DEFAULT_HOOK_TIMEOUT_MS = 10000;
const ARROW = "→";

export class HookStepError extends Error {}

// Load a `{ "hooks": [...] }` file into normalized hook entries, preserving declaration
// order for the Order-then-installOrder tie-break core itself uses.
export function loadHooks(hooksFile) {
  if (!hooksFile) return [];
  const resolved = path.resolve(hooksFile);
  if (!fs.existsSync(resolved)) return [];

  let data;
  try {
    data = JSON.parse(fs.readFileSync(resolved, "utf-8"));
  } catch (e) {
    throw new Error(`Invalid hooks file ${hooksFile}: ${e.message}`);
  }

  const hooks = Array.isArray(data.hooks) ? data.hooks : [];
  return hooks.map((h, index) => ({
    tool: h.tool || "executeAux4",
    command: h.command || "*/*",
    order: typeof h.order === "number" ? h.order : 0,
    params: h.params || {},
    before: h.before || [],
    replace: h.replace || [],
    after: h.after || [],
    error: h.error || [],
    timeout: h.timeout,
    installOrder: index
  }));
}

// Same per-segment wildcard matching as engine/virtual.go matchHookPattern: equal
// segment counts split on "/", "*" matches any single segment.
export function matchPattern(pattern, commandPath) {
  const patternParts = String(pattern || "").split("/");
  const commandParts = String(commandPath || "").split("/");
  if (patternParts.length !== commandParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i] === "*") continue;
    if (patternParts[i] !== commandParts[i]) return false;
  }
  return true;
}

// Same filter semantics as engine/virtual.go matchHookParams (missing param never
// matches, "|" alternatives), extended so a repeatable value (array) matches if ANY of
// its values match -- core only ever sees a single value per param.
export function matchParams(hookParams, callParams) {
  if (!hookParams || Object.keys(hookParams).length === 0) return true;

  for (const [name, expected] of Object.entries(hookParams)) {
    const val = callParams ? callParams[name] : undefined;
    if (val === undefined || val === null || val === "") return false;

    const values = Array.isArray(val) ? val : [val];
    const alternatives = String(expected).split("|");
    if (!values.some((v) => alternatives.includes(String(v)))) return false;
  }
  return true;
}

// Resolve "<profile>/<command>" for an aux4 action line the way aux4 itself would, via
// `aux4 <action words> --whereIsIt` (never string-prefix guessing). Cached per process:
// this spawns a real aux4 invocation, and a stuck agent can repeat the same call many
// times in one run.
const commandPathCache = new Map();

export function resolveCommandPath(actionWords) {
  const key = actionWords.join(" ");
  if (commandPathCache.has(key)) return commandPathCache.get(key);

  let result = null;
  try {
    const proc = spawnSync("aux4", [...actionWords, "--whereIsIt"], { encoding: "utf-8", timeout: 5000 });
    if (proc.status === 0 && proc.stdout) {
      const line = proc.stdout.split("\n").find((l) => l.includes(ARROW));
      if (line) {
        const match = line.match(/^\S+\s+(\S+)\s+→\s+(\S+)/);
        if (match) result = `${match[1]}/${match[2]}`;
      }
    }
  } catch {
    // aux4 unavailable or the lookup failed -- no hook can match this call.
  }

  commandPathCache.set(key, result);
  return result;
}

// Parse the flags portion of an executeAux4 command string into action words + a params
// object, the way aux4 itself would parse --name value / --name=value pairs. NOT full
// aux4 resolution (see module header) -- only what hook `params` matching and ${var}
// interpolation need.
export function parseExecuteAux4Call(command) {
  const argv = buildAux4Argv(command);

  let splitAt = argv.length;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("-")) {
      splitAt = i;
      break;
    }
  }

  const actionWords = argv.slice(0, splitAt);
  const params = {};
  let i = splitAt;
  while (i < argv.length) {
    const token = argv[i];
    if (!token.startsWith("-")) {
      i++;
      continue;
    }

    const name = token.replace(/^--?/, "");
    const eqIdx = name.indexOf("=");
    let key, value;
    if (eqIdx !== -1) {
      key = name.slice(0, eqIdx);
      value = name.slice(eqIdx + 1);
      i++;
    } else {
      key = name;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        value = next;
        i += 2;
      } else {
        value = "true";
        i++;
      }
    }

    if (Object.prototype.hasOwnProperty.call(params, key)) {
      params[key] = Array.isArray(params[key]) ? [...params[key], value] : [params[key], value];
    } else {
      params[key] = value;
    }
  }

  return { actionWords, params };
}

export function matchHooks(hooks, toolName, commandPath, callParams) {
  const matched = hooks.filter((h) =>
    h.tool === toolName
    && (toolName !== "executeAux4" || matchPattern(h.command, commandPath))
    && matchParams(h.params, callParams)
  );
  matched.sort((a, b) => (a.order - b.order) || (a.installOrder - b.installOrder));
  return matched;
}

function flattenParams(callParams) {
  const out = {};
  if (!callParams) return out;
  for (const [key, value] of Object.entries(callParams)) {
    if (Array.isArray(value)) {
      out[key] = JSON.stringify(value);
    } else if (typeof value === "string") {
      out[key] = value;
    } else {
      out[key] = JSON.stringify(value);
    }
  }
  return out;
}

// Context variables a tool call has, parallel to core's __command/__scope/__package:
// __tool, __command (executeAux4 only), __request (the user's request this round),
// __history (path to the history file -- a hook can read prior tool results from it),
// __session.
// (`after`/`error` steps additionally see `__response`/`__error`/`__exitCode`, set just
// before they run -- see wrapWithHooks.)
export function buildHookContext({ toolName, commandPath, callParams, request, historyFile, session }) {
  return {
    ...flattenParams(callParams),
    __tool: toolName,
    __command: commandPath || "",
    __request: request || "",
    __history: historyFile || "",
    __session: session || ""
  };
}

function validateSteps(steps, phase) {
  for (const step of steps) {
    for (const prefix of BLOCKED_HOOK_EXECUTORS) {
      if (step.startsWith(prefix)) {
        throw new HookStepError(`"${prefix}" executor is not allowed in hooks (${phase} phase)`);
      }
    }
  }
}

// Run a hook's steps as a real aux4 command: a scratch one-command package in a temp
// dir, variables declared from `vars` so ${var} interpolates exactly like a core hook
// seeing the live command params. No shell: spawnSync("aux4", argv) directly, so values
// (including the user's request text) reach the step unmangled.
function runSteps(steps, vars, timeoutMs) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aux4-hook-"));
  try {
    const variables = Object.keys(vars).map((name) => ({ name, text: name, default: "" }));
    const pkg = {
      scope: "aux4-hook",
      name: "hook",
      version: "0.0.0",
      profiles: [
        {
          name: "main",
          commands: [
            {
              name: "run-hook",
              execute: steps,
              help: { text: "hook step", variables }
            }
          ]
        }
      ]
    };
    fs.writeFileSync(path.join(tmpDir, ".aux4"), JSON.stringify(pkg));

    const args = ["run-hook"];
    for (const [key, value] of Object.entries(vars)) {
      args.push(`--${key}`, String(value));
    }

    const proc = spawnSync("aux4", args, {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: timeoutMs || DEFAULT_HOOK_TIMEOUT_MS
    });

    if (proc.error || proc.status === null) {
      // Timed out, binary missing, or killed -- fail closed, never silently pass.
      return { exitCode: 1, stdout: "", stderr: (proc.error && proc.error.message) || "hook step crashed or timed out", crashed: true };
    }

    return {
      exitCode: proc.status,
      stdout: (proc.stdout || "").trim(),
      stderr: (proc.stderr || "").trim(),
      crashed: false
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Process-wide recursion guard -- see module header.
let hookDepth = 0;

export function isInsideHook() {
  return hookDepth > 0;
}

// Wrap a bound LangChain tool so every call is checked against `hooksContext.hooks`
// before it runs (before/replace), and after it runs (after/error) -- see module header
// for the full phase contract. Returns the tool unchanged when there are no hooks.
export function wrapWithHooks(name, underlyingTool, hooksContext) {
  const hooks = (hooksContext && hooksContext.hooks) || [];
  if (hooks.length === 0) return underlyingTool;

  return tool(
    async (args) => {
      let commandPath = null;
      let callParams = args;

      if (name === "executeAux4" && args && typeof args.command === "string") {
        try {
          const parsed = parseExecuteAux4Call(args.command);
          callParams = parsed.params;
          commandPath = resolveCommandPath(parsed.actionWords);
        } catch {
          // Unparseable command -- no hook can match it; fall through to the real tool,
          // which surfaces its own parse error to the model.
          callParams = args;
        }
      }

      const matched = isInsideHook() ? [] : matchHooks(hooks, name, commandPath, callParams);

      if (matched.length === 0) {
        return underlyingTool.invoke(args);
      }

      const vars = buildHookContext({
        toolName: name,
        commandPath,
        callParams,
        request: hooksContext.request,
        historyFile: hooksContext.historyFile,
        session: hooksContext.session
      });

      hookDepth++;
      try {
        for (const hook of matched) {
          if (hook.before.length === 0) continue;
          try {
            validateSteps(hook.before, "before");
          } catch (e) {
            return `Blocked by hook: ${e.message}`;
          }

          const result = runSteps(hook.before, vars, hook.timeout);
          if (result.exitCode !== 0) {
            const message = result.stdout || result.stderr || `hook exited ${result.exitCode}`;
            return `Blocked by hook: ${message}`;
          }
        }

        const replaceHook = matched.find((h) => h.replace.length > 0);
        let toolResult;
        let failed = false;

        if (replaceHook) {
          try {
            validateSteps(replaceHook.replace, "replace");
            const result = runSteps(replaceHook.replace, vars, replaceHook.timeout);
            if (result.exitCode !== 0) {
              return `Blocked by hook: ${result.stdout || result.stderr || `hook exited ${result.exitCode}`}`;
            }
            toolResult = result.stdout;
          } catch (e) {
            return `Blocked by hook: ${e.message}`;
          }
        } else {
          try {
            toolResult = await underlyingTool.invoke(args);
          } catch (e) {
            failed = true;
            toolResult = e.message;
          }
        }

        // __response/__error/__exitCode mirror core's own after/error context vars --
        // only meaningful once the call (or its replacement) has actually run.
        if (failed) {
          vars.__error = toolResult;
          vars.__exitCode = "1";
        } else {
          vars.__response = toolResult;
          vars.__exitCode = "0";
        }

        for (const hook of matched) {
          const phase = failed ? "error" : "after";
          const phaseSteps = failed ? hook.error : hook.after;
          if (phaseSteps.length === 0) continue;

          try {
            validateSteps(phaseSteps, phase);
            const result = runSteps(phaseSteps, vars, hook.timeout);
            // after/error are best-effort and never themselves block the call. The one
            // documented exception: a successful `after` step with non-empty stdout
            // replaces the result (see module header for why this can't be the core
            // set:response= mechanism verbatim).
            if (phase === "after" && result.exitCode === 0 && result.stdout) {
              toolResult = result.stdout;
            }
          } catch {
            // Swallow -- after/error hooks observe, they don't get a second chance to
            // block a decision that is already made.
          }
        }

        if (failed) throw new Error(toolResult);
        return toolResult;
      } finally {
        hookDepth--;
      }
    },
    {
      name,
      description: underlyingTool.description || (underlyingTool.lc_kwargs && underlyingTool.lc_kwargs.description) || name,
      schema: underlyingTool.schema
    }
  );
}
