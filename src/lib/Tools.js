import fs from "fs";
import { repeatFixHint, correctedCommand, isEmptyLookupResult } from "./LoopHint.js";
import { parameterErrorHelp, parameterHelpArgs } from "./ParameterHelp.js";
import path from "path";
import os from "os";
import { spawn, spawnSync } from "child_process";
import readline from "node:readline";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import LlmStore from "./LlmStore.js";
import { getEmbeddings, DEFAULT_EMBEDDINGS_TYPE } from "./Embeddings.js";
import { ensureCompatibleEmbeddings } from "./EmbeddingsGuard.js";
import { matchesPattern as matchesPatternUtil, parsePattern as parsePatternUtil } from "./PatternUtils.js";
import { buildAux4Argv, CommandParseError, parseCommandArgs } from "./CommandArgs.js";
import { loadHooks, wrapWithHooks } from "./Hooks.js";
import { hasConfiguredStorage, hasReferences, hasSkills } from "./ToolBindings.js";

// Short, model-facing tool descriptions -- what actually gets sent to the LLM on every call.
// The long human-readable docs live in ../docs/tools/*.md (linked from README/man pages) and
// are never loaded here; see ../docs/tools/descriptions.js for the full rationale.
import {
  readFileDesc,
  writeFileDesc,
  editFileDesc,
  listFilesDesc,
  createDirectoryDesc,
  executeAux4Desc,
  saveImageDesc,
  removeFilesDesc,
  searchContextDesc,
  searchFilesDesc,
  askUserDesc,
  currentDateTimeDesc,
  readReferenceDesc,
  readSkillDesc
} from "../docs/tools/descriptions.js";
import { listSkills } from "./Skills.js";

// Array to track files and directories created by the agent
const createdPaths = [];

// Serialization queue for askUser to prevent parallel stdin conflicts
let askUserQueue = Promise.resolve();

// Helper function to expand ~ to home directory
function expandTildePath(filePath) {
  if (filePath.startsWith("~/") || filePath === "~") {
    return filePath.replace("~", os.homedir());
  }
  return filePath;
}

// Helper function to check if path is allowed for read-only access
function isReadOnlyPathAllowed(filePath, currentDirectory) {
  const aux4ConfigPath = path.join(os.homedir(), ".aux4.config", "packages");
  const tmpDir = os.tmpdir();
  return filePath.startsWith(currentDirectory)
    || filePath.startsWith(aux4ConfigPath)
    || filePath.startsWith(tmpDir)
    || filePath.startsWith("/tmp/");
}

// Binary file extensions that should not be read as text
const BINARY_EXTENSIONS = new Set([
  ".pdf", ".zip", ".gz", ".tar", ".bz2", ".7z", ".rar",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg", ".tiff",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv", ".flac", ".ogg",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".class", ".pyc", ".o", ".a", ".lib"
]);

const BINARY_TOOL_HINTS = {
  ".pdf": "Use executeAux4('pdf parse \"<file>\"') to extract text and form fields from PDF files.",
  ".zip": "Use executeAux4('...') or shell commands to inspect zip contents.",
  ".png": "Use the image parameter on the ask command to pass images to the model.",
  ".jpg": "Use the image parameter on the ask command to pass images to the model.",
  ".jpeg": "Use the image parameter on the ask command to pass images to the model."
};

export const readLocalFileTool = tool(
  async ({ file, offset, limit }) => {
    try {
      const expandedPath = expandTildePath(file);
      const filePath = path.resolve(expandedPath);
      const currentDirectory = process.cwd();
      if (!isReadOnlyPathAllowed(filePath, currentDirectory)) throw new Error("Access denied");
      if (!fs.existsSync(filePath)) throw new Error("File not found");

      const ext = path.extname(filePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        const hint = BINARY_TOOL_HINTS[ext] || "";
        return `Cannot read binary file (${ext}). ${hint}`.trim();
      }

      const content = fs.readFileSync(filePath, { encoding: "utf-8" });

      if (offset !== undefined || limit !== undefined) {
        const lines = content.split("\n");
        const start = offset || 0;
        const end = limit !== undefined ? start + limit : lines.length;
        const sliced = lines.slice(start, end);
        const totalLines = lines.length;
        let result = sliced.join("\n");
        if (end < totalLines) {
          result += `\n\n[Showing lines ${start + 1}-${end} of ${totalLines}. Use offset=${end} to read more.]`;
        }
        return result;
      }

      return content;
    } catch (e) {
      if (e.code === "ENOENT") {
        return "File not found";
      } else if (e.code === "EACCES") {
        return "Access denied";
      }
      return e.message;
    }
  },
  {
    name: "readFile",
    description: readFileDesc,
    schema: z.object({
      file: z.string(),
      offset: z.number().optional().describe("Line number to start reading from (0-based). Use with limit to paginate large files."),
      limit: z.number().optional().describe("Maximum number of lines to read. Use with offset to paginate large files.")
    })
  }
);

export const writeLocalFileTool = tool(
  async ({ file, content }) => {
    try {
      const filePath = path.resolve(file);
      const currentDirectory = process.cwd();
      if (!filePath.startsWith(currentDirectory)) throw new Error("Access denied");

      // Check if file already exists
      const fileExists = fs.existsSync(filePath);

      fs.writeFileSync(filePath, content, { encoding: "utf-8" });

      // Track the created file only if it's new
      if (!fileExists) {
        createdPaths.push(filePath);
      }

      return "file created";
    } catch (e) {
      if (e.code === "ENOENT") {
        return "File not found";
      } else if (e.code === "EACCES") {
        return "Access denied";
      }
      return e.message;
    }
  },
  {
    name: "writeFile",
    description: writeFileDesc,
    schema: z.object({
      file: z.string(),
      content: z.string()
    })
  }
);

export const editLocalFileTool = tool(
  async ({ file, old_string, new_string, replace_all = false }) => {
    try {
      const filePath = path.resolve(file);
      const currentDirectory = process.cwd();
      if (!filePath.startsWith(currentDirectory)) throw new Error("Access denied");

      // File must exist for editing
      if (!fs.existsSync(filePath)) {
        return "File not found";
      }

      // Read current content
      const content = fs.readFileSync(filePath, { encoding: "utf-8" });

      // Check if old_string exists in the file
      if (!content.includes(old_string)) {
        return "old_string not found in file";
      }

      // Perform replacement
      let newContent;
      let replacementCount = 0;

      if (replace_all) {
        // Count occurrences before replacing
        const regex = new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        replacementCount = (content.match(regex) || []).length;
        newContent = content.split(old_string).join(new_string);
      } else {
        replacementCount = 1;
        newContent = content.replace(old_string, new_string);
      }

      // Write the modified content
      fs.writeFileSync(filePath, newContent, { encoding: "utf-8" });

      if (replacementCount > 1) {
        return `file edited (${replacementCount} replacements)`;
      }
      return "file edited";
    } catch (e) {
      if (e.code === "ENOENT") {
        return "File not found";
      } else if (e.code === "EACCES") {
        return "Access denied";
      }
      return e.message;
    }
  },
  {
    name: "editFile",
    description: editFileDesc,
    schema: z.object({
      file: z.string(),
      old_string: z.string(),
      new_string: z.string(),
      replace_all: z.boolean().optional()
    })
  }
);

export const listFilesTool = tool(
  async ({ path: targetPath, recursive = true, exclude = "" }) => {
    try {
      const currentDirectory = process.cwd();

      const expandedPath = expandTildePath(targetPath || currentDirectory);
      const directory = path.resolve(expandedPath);
      const recurse = recursive !== false && recursive !== "false";
      const excludePrefixes = (exclude && exclude.split(",")) || [];
      if (!isReadOnlyPathAllowed(directory, currentDirectory)) throw new Error("Access denied");

      const entries = fs.readdirSync(directory, { withFileTypes: true });
      const result = [];

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        const relPath = path.relative(currentDirectory, fullPath);
        if (excludePrefixes.some(prefix => relPath.startsWith(prefix))) continue;

        let isFile = entry.isFile();
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try {
            const stat = fs.statSync(fullPath);
            isFile = stat.isFile();
            isDir = stat.isDirectory();
          } catch { continue; }
        }

        if (isFile) {
          result.push(relPath);
        } else if (isDir && recurse) {
          const subFiles = fs
            .readdirSync(fullPath, { withFileTypes: true })
            .filter(e => {
              if (e.isFile()) return true;
              if (e.isSymbolicLink()) {
                try { return fs.statSync(path.join(fullPath, e.name)).isFile(); } catch { return false; }
              }
              return false;
            })
            .map(e => path.join(relPath, e.name))
            .filter(p => !excludePrefixes.some(prefix => p.startsWith(prefix)));
          result.push(...subFiles);
        }
      }

      return result.join("\n");
    } catch (e) {
      if (e.code === "ENOENT") {
        return "Directory not found";
      } else if (e.code === "EACCES") {
        return "Access denied";
      }
      return e.message;
    }
  },
  {
    name: "listFiles",
    description: listFilesDesc,
    schema: z.object({
      path: z.string().optional(),
      recursive: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
      exclude: z.string().optional()
    })
  }
);

export const createDirectoryTool = tool(
  async ({ path: dirPath }) => {
    const directory = path.resolve(dirPath);
    const currentDirectory = process.cwd();
    if (!directory.startsWith(currentDirectory)) throw new Error("Access denied");
    if (fs.existsSync(directory)) return "directory already exists";
    fs.mkdirSync(directory, { recursive: true });

    // Track the created directory
    createdPaths.push(directory);

    return "directory created";
  },
  {
    name: "createDirectory",
    description: createDirectoryDesc,
    schema: z.object({
      path: z.string()
    })
  }
);

const DEFAULT_TIMEOUT = 60000;
const MAX_OUTPUT_LENGTH = 10000;

// `cmd` is the display form (`aux4 <command>`, used for the jobs-attach label and
// timeout/error messages); `argv` is what actually runs: `aux4` is spawned directly with
// it — no shell, so nothing in it is ever interpreted.
function executeWithTimeout(cmd, { argv, stdin, timeout, cwd } = {}) {
  const timeoutMs = timeout === 0 ? 0 : (timeout ? timeout * 1000 : DEFAULT_TIMEOUT);

  const tmpDir = os.tmpdir();
  const id = `aux4-exec-${process.pid}-${Date.now()}`;
  const stdoutPath = path.join(tmpDir, `${id}.stdout`);
  const stderrPath = path.join(tmpDir, `${id}.stderr`);

  const stdoutFd = fs.openSync(stdoutPath, "w");
  const stderrFd = fs.openSync(stderrPath, "w");

  return new Promise((resolve, reject) => {
    let settled = false;

    function closeFds() {
      try { fs.closeSync(stdoutFd); } catch {}
      try { fs.closeSync(stderrFd); } catch {}
    }

    const spawnOptions = {
      stdio: ["pipe", stdoutFd, stderrFd],
      detached: false,
    };
    if (cwd) spawnOptions.cwd = cwd;

    const child = spawn("aux4", argv, spawnOptions);

    if (stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    let timer;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;

        // Detach: unref so Node doesn't wait for it
        child.unref();
        closeFds();

        const partialOutput = readOutputFile(stdoutPath, 2000);

        // Try to attach to aux4 jobs
        try {
          const attachResult = spawnSync("aux4", [
            "jobs", "attach", String(child.pid), cmd,
            "--stdout", stdoutPath, "--stderr", stderrPath
          ], { encoding: "utf-8", timeout: 5000 });

          if (attachResult.status === 0 && attachResult.stdout) {
            const job = JSON.parse(attachResult.stdout.trim());
            const error = new Error("timeout_attached");
            error.timedOut = true;
            error.attached = true;
            error.jobId = job.id;
            error.partialOutput = partialOutput;
            return reject(error);
          }
        } catch {}

        // aux4 jobs not available — kill the process
        try { process.kill(child.pid, "SIGTERM"); } catch {}
        cleanupTempFiles(stdoutPath, stderrPath);

        const error = new Error("timeout_killed");
        error.timedOut = true;
        error.attached = false;
        error.partialOutput = partialOutput;
        reject(error);
      }, timeoutMs);
    }

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      closeFds();

      if (code !== 0) {
        const stderr = readOutputFile(stderrPath, MAX_OUTPUT_LENGTH);
        const stdout = readOutputFile(stdoutPath, MAX_OUTPUT_LENGTH);
        cleanupTempFiles(stdoutPath, stderrPath);
        const output = stderr || stdout || `Process exited with code ${code}`;
        const error = new Error(output);
        error.timedOut = false;
        return reject(error);
      }

      const stdout = readOutputFile(stdoutPath, MAX_OUTPUT_LENGTH);
      const fullSize = getFileSize(stdoutPath);

      if (fullSize > MAX_OUTPUT_LENGTH) {
        // Keep stdout file so the agent can read the full output; only clean stderr
        cleanupTempFiles(null, stderrPath);
        resolve(stdout + `\n\n[Output truncated: ${fullSize} bytes total. Full output was written to ${stdoutPath}]`);
      } else {
        cleanupTempFiles(stdoutPath, stderrPath);
        resolve(stdout);
      }
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      closeFds();
      cleanupTempFiles(stdoutPath, stderrPath);
      reject(err);
    });
  });
}

export function readOutputFile(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return "";
    if (stat.size <= maxBytes) {
      return fs.readFileSync(filePath, "utf-8");
    }
    // Keep both the start and end. Structured command results often put a
    // confirmation contract or status at the start, while useful diagnostics
    // and page context are near the end.
    const marker = "\n[...truncated...]\n";
    const payloadBytes = Math.max(0, maxBytes - Buffer.byteLength(marker));
    const headBytes = Math.ceil(payloadBytes / 2);
    const tailBytes = payloadBytes - headBytes;
    const fd = fs.openSync(filePath, "r");
    try {
      const head = Buffer.alloc(headBytes);
      const tail = Buffer.alloc(tailBytes);
      if (headBytes > 0) fs.readSync(fd, head, 0, headBytes, 0);
      if (tailBytes > 0) fs.readSync(fd, tail, 0, tailBytes, stat.size - tailBytes);
      return head.toString("utf-8") + marker + tail.toString("utf-8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function cleanupTempFiles(...paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch {}
  }
}

function formatTimeoutMessage(command, timeout, error) {
  const timeoutSec = timeout === 0 ? 0 : (timeout || 60);

  if (error.attached) {
    const lines = [
      `TIMEOUT: "aux4 ${command}" exceeded ${timeoutSec} seconds and was transferred to background job #${error.jobId}.`,
    ];
    if (error.partialOutput) {
      lines.push(``, `Partial output:`, error.partialOutput);
    }
    lines.push(
      ``,
      `The command is still running. Use these to manage it:`,
      `  executeAux4("jobs status ${error.jobId}")  → check if RUNNING or COMPLETED`,
      `  executeAux4("jobs output ${error.jobId}")  → get the full output when done`,
      `  executeAux4("jobs kill ${error.jobId}")    → terminate if needed`,
    );
    return lines.join("\n");
  }

  // Process was killed (aux4 jobs not available)
  const lines = [
    `TIMEOUT: "aux4 ${command}" was killed after ${timeoutSec} seconds.`,
  ];
  if (error.partialOutput) {
    lines.push(``, `Partial output captured before kill:`, error.partialOutput);
  }
  lines.push(
    ``,
    `Action required: re-run this command as a background job so it can complete without blocking.`,
    ``,
    `Step 1: executeAux4("jobs run \\"aux4 ${command}\\"")  → returns a job ID`,
    `Step 2: executeAux4("jobs status <id>")  → check if RUNNING or COMPLETED`,
    `Step 3: executeAux4("jobs output <id>")  → get the full output once completed`,
  );
  return lines.join("\n");
}

// `aux4 <command>` with a leading `aux4` the model added itself ("aux4 google gmail
// list") runs as `aux4 aux4 google ...` and fails with "Command not found". Nothing ran,
// so retry once without that word -- the command the model meant.
async function executeAux4Argv(command, { argv, stdin, timeout, cwd }) {
  try {
    return await executeWithTimeout(`aux4 ${command}`, { argv, stdin, timeout, cwd });
  } catch (error) {
    const notFound = !error.timedOut && /^Command not found/.test(String(error.message || "").trim());
    if (notFound && argv.length > 1 && argv[0] === "aux4") {
      const rest = argv.slice(1);
      return await executeWithTimeout(`aux4 ${rest.join(" ")}`, { argv: rest, stdin, timeout, cwd });
    }
    throw error;
  }
}

// A "Did you mean" from aux4 is turned into the exact call to make, with the agent's
// own arguments, so it can be run as-is.
function withCommandFix(message, command) {
  const meant = String(message).match(/Command not found[\s\S]*?Did you mean:\s*(?:aux4\s+)?([^\n]+?)\s*$/m);
  if (!meant) return message;
  const fixed = correctedCommand(String(command || ""), meant[1].trim());
  return fixed ? `${message}\nRun this instead (executeAux4 command): ${fixed}` : message;
}

function commandFailureMessage(error, command, argv, cwd, permissions) {
  const message = withCommandFix(`Error executing command: ${error.message}`, command);
  const helpArgs = parameterHelpArgs(argv, error.message);
  if (permissions && helpArgs && checkPermission(helpArgs.join(" "), permissions) !== "allow") return message;
  return message + parameterErrorHelp(argv, error.message, cwd);
}

export const executeAux4CliTool = tool(
  async ({ command, stdin, timeout, cwd }) => {
    // Check system-level deny first (cannot be overridden)
    for (const pattern of SYSTEM_DENY) {
      if (matchesPattern(command, pattern)) {
        return `Permission denied: command "${command}" is blocked by system security policy. Direct secret access is not allowed. Instead, declare a variable with the secret:// notation in your command's .aux4 definition, and aux4 will resolve it automatically at runtime.\n\nFormat: secret://<provider>/<vault>/<item>/<field>\nOTP:    secret://<provider>/<vault>/<item>/otp\n\nExample variable in .aux4:\n  { "name": "apiKey", "default": "secret://1password/dev/my-api/credential" }\n  { "name": "totpCode", "default": "secret://1password/dev/my-api/otp" }\n\nThe secret is resolved securely and injected into the variable — never call secret get directly.`;
      }
    }

    let argv;
    try {
      argv = buildAux4Argv(command);
    } catch (error) {
      if (error instanceof CommandParseError) {
        return `Invalid command: ${error.message}. Quote arguments that contain spaces with matching "..." or '...' quotes.`;
      }
      throw error;
    }

    try {
      const result = await executeAux4Argv(command, { argv, stdin, timeout, cwd });
      return result;
    } catch (error) {
      if (error.timedOut) {
        return formatTimeoutMessage(command, timeout, error);
      }
      return commandFailureMessage(error, command, argv, cwd);
    }
  },
  {
    name: "executeAux4",
    description: executeAux4Desc,
    schema: z.object({
      command: z.string(),
      stdin: z.string().optional().describe("Optional data to pass as stdin to the command"),
      timeout: z.number().optional().describe("Timeout in seconds. Defaults to 60. Set to 0 to disable timeout. If the command exceeds this limit, the process is transferred to a background job via aux4 jobs attach (if available) or killed."),
      cwd: z.string().optional().describe("Working directory for the command. Defaults to the current directory.")
    })
  }
);

// Re-exported from PatternUtils so existing importers keep working.
export const matchesPattern = matchesPatternUtil;
export const parsePattern = parsePatternUtil;

// Parse a subject string into its type and value
// Returns { type: "command"|"file", scope?: string, value: string }
function parseSubject(subject) {
  const fileMatch = subject.match(/^file:(read|write|delete):(.+)$/);
  if (fileMatch) {
    return { type: "file", scope: fileMatch[1], value: fileMatch[2] };
  }
  return { type: "command", value: subject };
}

// Check permission for a subject against the permissions config
// Subject can be a command string or "file:<scope>:<path>"
// Returns "allow", "ask", or "deny"
export function checkPermission(subject, permissions = {}) {
  const deny = permissions.deny || [];
  const ask = permissions.ask || [];
  const allow = permissions.allow || ["*"];

  const subjectParsed = parseSubject(subject);

  function matchesList(list) {
    for (const rawPattern of list) {
      const parsed = parsePattern(rawPattern);
      if (subjectParsed.type === "file") {
        // File subjects only match file patterns with the same scope
        if (parsed.type === "file" && parsed.scope === subjectParsed.scope) {
          if (matchesPattern(subjectParsed.value, parsed.pattern)) return true;
        }
      } else {
        // Command subjects only match command patterns
        if (parsed.type === "command") {
          if (matchesPattern(subjectParsed.value, parsed.pattern)) return true;
        }
      }
    }
    return false;
  }

  if (matchesList(deny)) return "deny";
  if (matchesList(ask)) return "ask";
  if (matchesList(allow)) return "allow";
  return "deny";
}

// System-level deny list — always blocked, cannot be overridden by config
const SYSTEM_DENY = ["secret*get*", "jobs run*op *", "jobs run*secret*get*"];

// Factory that wraps executeAux4 with permission checking
export const createExecuteAux4Tool = (permissions) => tool(
  async ({ command, stdin, timeout, cwd }) => {
    // Check system-level deny first (cannot be overridden)
    for (const pattern of SYSTEM_DENY) {
      if (matchesPattern(command, pattern)) {
        return `Permission denied: command "${command}" is blocked by system security policy. Direct secret access is not allowed. Instead, declare a variable with the secret:// notation in your command's .aux4 definition, and aux4 will resolve it automatically at runtime.\n\nFormat: secret://<provider>/<vault>/<item>/<field>\nOTP:    secret://<provider>/<vault>/<item>/otp\n\nExample variable in .aux4:\n  { "name": "apiKey", "default": "secret://1password/dev/my-api/credential" }\n  { "name": "totpCode", "default": "secret://1password/dev/my-api/otp" }\n\nThe secret is resolved securely and injected into the variable — never call secret get directly.`;
      }
    }

    const decision = checkPermission(command, permissions);

    if (decision === "deny") {
      return `Permission denied: command "${command}" is not allowed by the permissions configuration.`;
    }

    if (decision === "ask") {
      if (!process.stdin.isTTY) {
        return `Permission denied: command "${command}" requires user confirmation but session is non-interactive.`;
      }

      const confirmed = await new Promise((resolve) => {
        askUserQueue = askUserQueue.then(async () => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stderr
          });
          process.stderr.write(`\n🔒 The agent wants to execute: aux4 ${command}\nAllow? (Y/n) > `);
          const answer = await new Promise((res) => {
            rl.on("line", (line) => {
              rl.close();
              res(line);
            });
            rl.on("close", () => res(""));
          });
          const accepted = answer.trim() === "" || answer.trim().toLowerCase() === "y";
          resolve(accepted);
        });
      });

      if (!confirmed) {
        return `Command "${command}" was denied by the user.`;
      }
    }

    let argv;
    try {
      argv = buildAux4Argv(command);
    } catch (error) {
      if (error instanceof CommandParseError) {
        return `Invalid command: ${error.message}. Quote arguments that contain spaces with matching "..." or '...' quotes.`;
      }
      throw error;
    }

    try {
      const result = await executeAux4Argv(command, { argv, stdin, timeout, cwd });
      return result;
    } catch (error) {
      if (error.timedOut) {
        return formatTimeoutMessage(command, timeout, error);
      }
      return commandFailureMessage(error, command, argv, cwd, permissions);
    }
  },
  {
    name: "executeAux4",
    description: executeAux4Desc,
    schema: z.object({
      command: z.string(),
      stdin: z.string().optional().describe("Optional data to pass as stdin to the command"),
      timeout: z.number().optional().describe("Timeout in seconds. Defaults to 60. Set to 0 to disable timeout. If the command exceeds this limit, the process is transferred to a background job via aux4 jobs attach (if available) or killed."),
      cwd: z.string().optional().describe("Working directory for the command. Defaults to the current directory.")
    })
  }
);

// Helper to prompt user for file permission (reuses askUserQueue serialization)
async function askFilePermission(scope, filePath) {
  if (!process.stdin.isTTY) {
    return false;
  }
  return new Promise((resolve) => {
    askUserQueue = askUserQueue.then(async () => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr
      });
      process.stderr.write(`\n🔒 The agent wants to ${scope} file: ${filePath}\nAllow? (Y/n) > `);
      const answer = await new Promise((res) => {
        rl.on("line", (line) => {
          rl.close();
          res(line);
        });
        rl.on("close", () => res(""));
      });
      resolve(answer.trim() === "" || answer.trim().toLowerCase() === "y");
    });
  });
}

// Helper to check file permission and return denial message or null
async function checkFileAccess(scope, filePath, permissions) {
  const subject = `file:${scope}:${filePath}`;
  const decision = checkPermission(subject, permissions);

  if (decision === "deny") {
    return `Permission denied: ${scope} "${filePath}" is not allowed by the permissions configuration.`;
  }
  if (decision === "ask") {
    const confirmed = await askFilePermission(scope, filePath);
    if (!confirmed) {
      return `File ${scope} "${filePath}" was denied by the user.`;
    }
  }
  return null;
}

// Factory: readFile with permission checking
export const createReadFileTool = (permissions) => tool(
  async ({ file, offset, limit }) => {
    try {
      const expandedPath = expandTildePath(file);
      const filePath = path.resolve(expandedPath);
      const currentDirectory = process.cwd();
      if (!isReadOnlyPathAllowed(filePath, currentDirectory)) throw new Error("Access denied");

      const denied = await checkFileAccess("read", filePath, permissions);
      if (denied) return denied;

      if (!fs.existsSync(filePath)) throw new Error("File not found");

      const ext = path.extname(filePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        const hint = BINARY_TOOL_HINTS[ext] || "";
        return `Cannot read binary file (${ext}). ${hint}`.trim();
      }

      const content = fs.readFileSync(filePath, { encoding: "utf-8" });

      if (offset !== undefined || limit !== undefined) {
        const lines = content.split("\n");
        const start = offset || 0;
        const end = limit !== undefined ? start + limit : lines.length;
        const sliced = lines.slice(start, end);
        const totalLines = lines.length;
        let result = sliced.join("\n");
        if (end < totalLines) {
          result += `\n\n[Showing lines ${start + 1}-${end} of ${totalLines}. Use offset=${end} to read more.]`;
        }
        return result;
      }

      return content;
    } catch (e) {
      if (e.code === "ENOENT") return "File not found";
      if (e.code === "EACCES") return "Access denied";
      return e.message;
    }
  },
  {
    name: "readFile",
    description: readFileDesc,
    schema: z.object({
      file: z.string(),
      offset: z.number().optional().describe("Line number to start reading from (0-based). Use with limit to paginate large files."),
      limit: z.number().optional().describe("Maximum number of lines to read. Use with offset to paginate large files.")
    })
  }
);

// Factory: writeFile with permission checking
export const createWriteFileTool = (permissions) => tool(
  async ({ file, content }) => {
    try {
      const filePath = path.resolve(file);
      const currentDirectory = process.cwd();
      if (!filePath.startsWith(currentDirectory)) throw new Error("Access denied");

      const denied = await checkFileAccess("write", filePath, permissions);
      if (denied) return denied;

      const fileExists = fs.existsSync(filePath);
      fs.writeFileSync(filePath, content, { encoding: "utf-8" });
      if (!fileExists) createdPaths.push(filePath);

      return "file created";
    } catch (e) {
      if (e.code === "ENOENT") return "File not found";
      if (e.code === "EACCES") return "Access denied";
      return e.message;
    }
  },
  {
    name: "writeFile",
    description: writeFileDesc,
    schema: z.object({ file: z.string(), content: z.string() })
  }
);

// Factory: editFile with permission checking
export const createEditFileTool = (permissions) => tool(
  async ({ file, old_string, new_string, replace_all = false }) => {
    try {
      const filePath = path.resolve(file);
      const currentDirectory = process.cwd();
      if (!filePath.startsWith(currentDirectory)) throw new Error("Access denied");

      const denied = await checkFileAccess("write", filePath, permissions);
      if (denied) return denied;

      if (!fs.existsSync(filePath)) return "File not found";

      const content = fs.readFileSync(filePath, { encoding: "utf-8" });
      if (!content.includes(old_string)) return "old_string not found in file";

      let newContent;
      let replacementCount = 0;

      if (replace_all) {
        const regex = new RegExp(old_string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        replacementCount = (content.match(regex) || []).length;
        newContent = content.split(old_string).join(new_string);
      } else {
        replacementCount = 1;
        newContent = content.replace(old_string, new_string);
      }

      fs.writeFileSync(filePath, newContent, { encoding: "utf-8" });

      if (replacementCount > 1) return `file edited (${replacementCount} replacements)`;
      return "file edited";
    } catch (e) {
      if (e.code === "ENOENT") return "File not found";
      if (e.code === "EACCES") return "Access denied";
      return e.message;
    }
  },
  {
    name: "editFile",
    description: editFileDesc,
    schema: z.object({
      file: z.string(),
      old_string: z.string(),
      new_string: z.string(),
      replace_all: z.boolean().optional()
    })
  }
);

// Factory: saveImage with permission checking
export const createSaveImageTool = (permissions) => tool(
  async ({ imageName, content }) => {
    try {
      const filePath = path.resolve(imageName);
      const currentDirectory = process.cwd();
      if (!filePath.startsWith(currentDirectory)) throw new Error("Access denied");

      const denied = await checkFileAccess("write", filePath, permissions);
      if (denied) return denied;

      if (!content.startsWith("data:image/") && !content.match(/^[A-Za-z0-9+/]+=*$/)) {
        throw new Error(
          `Invalid image content format. Expected base64 data or data URL (data:image/...), but received: ${content.substring(0, 100)}...`
        );
      }

      const base64Data = content.replace(/^data:image\/[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      const fileExists = fs.existsSync(filePath);
      fs.writeFileSync(filePath, buffer);
      if (!fileExists) createdPaths.push(filePath);

      return `Image saved to ${imageName}`;
    } catch (e) {
      if (e.code === "ENOENT") return "Directory not found";
      if (e.code === "EACCES") return "Access denied";
      return e.message;
    }
  },
  {
    name: "saveImage",
    description: saveImageDesc,
    schema: z.object({ imageName: z.string(), content: z.string() })
  }
);

// Factory: removeFiles with permission checking
export const createRemoveFilesTool = (permissions) => tool(
  async ({ files }) => {
    try {
      const currentDirectory = process.cwd();
      const results = [];
      const filesToRemove = Array.isArray(files) ? files : [files];

      for (const file of filesToRemove) {
        const filePath = path.resolve(file);

        if (!filePath.startsWith(currentDirectory)) {
          results.push(`${file}: Access denied - path outside current directory`);
          continue;
        }

        const denied = await checkFileAccess("delete", filePath, permissions);
        if (denied) {
          results.push(`${file}: ${denied}`);
          continue;
        }

        if (!createdPaths.includes(filePath)) {
          results.push(`${file}: You can just delete files previously created by the agent`);
          continue;
        }

        if (!fs.existsSync(filePath)) {
          results.push(`${file}: File or directory not found`);
          const index = createdPaths.indexOf(filePath);
          if (index > -1) createdPaths.splice(index, 1);
          continue;
        }

        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
            results.push(`${file}: Directory removed successfully`);
          } else {
            fs.unlinkSync(filePath);
            results.push(`${file}: File removed successfully`);
          }
          const index = createdPaths.indexOf(filePath);
          if (index > -1) createdPaths.splice(index, 1);
        } catch (removeError) {
          results.push(`${file}: Error removing - ${removeError.message}`);
        }
      }

      return results.join("\n");
    } catch (e) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: "removeFiles",
    description: removeFilesDesc,
    schema: z.object({
      files: z.union([z.string(), z.array(z.string())]).describe("File or directory path(s) to remove. Can be a single string or array of strings.")
    })
  }
);

// Factory: listFiles with permission checking
export const createListFilesTool = (permissions) => tool(
  async ({ path: targetPath, recursive = true, exclude = "" }) => {
    try {
      const currentDirectory = process.cwd();
      const expandedPath = expandTildePath(targetPath || currentDirectory);
      const directory = path.resolve(expandedPath);
      const recurse = recursive !== false && recursive !== "false";
      const excludePrefixes = (exclude && exclude.split(",")) || [];
      if (!isReadOnlyPathAllowed(directory, currentDirectory)) throw new Error("Access denied");

      const denied = await checkFileAccess("read", directory, permissions);
      if (denied) return denied;

      const entries = fs.readdirSync(directory, { withFileTypes: true });
      const result = [];

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        const relPath = path.relative(currentDirectory, fullPath);
        if (excludePrefixes.some(prefix => relPath.startsWith(prefix))) continue;

        let isFile = entry.isFile();
        let isDir = entry.isDirectory();
        if (entry.isSymbolicLink()) {
          try {
            const stat = fs.statSync(fullPath);
            isFile = stat.isFile();
            isDir = stat.isDirectory();
          } catch { continue; }
        }

        if (isFile) {
          result.push(relPath);
        } else if (isDir && recurse) {
          const subFiles = fs
            .readdirSync(fullPath, { withFileTypes: true })
            .filter(e => {
              if (e.isFile()) return true;
              if (e.isSymbolicLink()) {
                try { return fs.statSync(path.join(fullPath, e.name)).isFile(); } catch { return false; }
              }
              return false;
            })
            .map(e => path.join(relPath, e.name))
            .filter(p => !excludePrefixes.some(prefix => p.startsWith(prefix)));
          result.push(...subFiles);
        }
      }

      return result.join("\n");
    } catch (e) {
      if (e.code === "ENOENT") return "Directory not found";
      if (e.code === "EACCES") return "Access denied";
      return e.message;
    }
  },
  {
    name: "listFiles",
    description: listFilesDesc,
    schema: z.object({
      path: z.string().optional(),
      recursive: z.union([z.boolean(), z.literal("true"), z.literal("false")]).optional(),
      exclude: z.string().optional()
    })
  }
);

// Factory: searchFiles with permission checking
export const createSearchFilesTool = (permissions) => tool(
  async ({ pattern, path: targetPath, include = "", exclude = "", maxResults = 50 }) => {
    try {
      const currentDirectory = process.cwd();
      const expandedPath = expandTildePath(targetPath || currentDirectory);
      const directory = path.resolve(expandedPath);

      if (!isReadOnlyPathAllowed(directory, currentDirectory)) throw new Error("Access denied");

      const denied = await checkFileAccess("read", directory, permissions);
      if (denied) return denied;

      if (!fs.existsSync(directory)) return "Directory not found";

      const includeExtensions = include ? include.split(",").map(ext => ext.trim().toLowerCase()) : [];
      const excludePrefixes = exclude ? exclude.split(",").map(p => p.trim()) : [];
      const lowerPattern = pattern.toLowerCase();
      const results = [];

      function searchDir(dir) {
        if (results.length >= maxResults) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

        for (const entry of entries) {
          if (results.length >= maxResults) return;
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(currentDirectory, fullPath);
          if (excludePrefixes.some(prefix => relPath.startsWith(prefix))) continue;

          if (entry.isDirectory()) {
            searchDir(fullPath);
          } else if (entry.isFile()) {
            if (includeExtensions.length > 0) {
              const ext = path.extname(entry.name).slice(1).toLowerCase();
              if (!includeExtensions.includes(ext)) continue;
            }
            try {
              const content = fs.readFileSync(fullPath, { encoding: "utf-8" });
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= maxResults) return;
                if (lines[i].toLowerCase().includes(lowerPattern)) {
                  const line = lines[i].length > 500 ? lines[i].slice(0, 500) + "..." : lines[i];
                  results.push(`${relPath}:${i + 1}: ${line}`);
                }
              }
            } catch { /* Skip binary or unreadable files */ }
          }
        }
      }

      searchDir(directory);

      if (results.length === 0) return "No matches found";
      const output = results.join("\n");
      if (output.length > 50000) {
        return output.slice(0, 50000) + `\n\n[Output truncated: ${results.length} matches, ${output.length} chars total]`;
      }
      return output;
    } catch (e) {
      if (e.code === "ENOENT") return "Directory not found";
      if (e.code === "EACCES") return "Access denied";
      return e.message;
    }
  },
  {
    name: "searchFiles",
    description: searchFilesDesc,
    schema: z.object({
      pattern: z.string(),
      path: z.string().optional(),
      include: z.string().optional(),
      exclude: z.string().optional(),
      maxResults: z.number().optional()
    })
  }
);

export const saveImageTool = tool(
  async ({ imageName, content }) => {
    try {
      const filePath = path.resolve(imageName);
      const currentDirectory = process.cwd();
      if (!filePath.startsWith(currentDirectory)) throw new Error("Access denied");

      // Validate that content is base64 image data
      if (!content.startsWith("data:image/") && !content.match(/^[A-Za-z0-9+/]+=*$/)) {
        throw new Error(
          `Invalid image content format. Expected base64 data or data URL (data:image/...), but received: ${content.substring(0, 100)}...`
        );
      }

      // Remove data URL prefix if present
      const base64Data = content.replace(/^data:image\/[^;]+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      // Check if file already exists
      const fileExists = fs.existsSync(filePath);

      fs.writeFileSync(filePath, buffer);

      // Track the created file only if it's new
      if (!fileExists) {
        createdPaths.push(filePath);
      }

      return `Image saved to ${imageName}`;
    } catch (e) {
      if (e.code === "ENOENT") {
        return "Directory not found";
      } else if (e.code === "EACCES") {
        return "Access denied";
      }
      return e.message;
    }
  },
  {
    name: "saveImage",
    description: saveImageDesc,
    schema: z.object({
      imageName: z.string(),
      content: z.string()
    })
  }
);

export const removeFilesTool = tool(
  async ({ files }) => {
    try {
      const currentDirectory = process.cwd();
      const results = [];
      const filesToRemove = Array.isArray(files) ? files : [files];

      for (const file of filesToRemove) {
        const filePath = path.resolve(file);

        // Security check - only allow removal within current directory
        if (!filePath.startsWith(currentDirectory)) {
          results.push(`${file}: Access denied - path outside current directory`);
          continue;
        }

        // Safety check - only allow removal of files/directories created by the agent
        if (!createdPaths.includes(filePath)) {
          results.push(`${file}: You can just delete files previously created by the agent`);
          continue;
        }

        // Check if file/directory exists
        if (!fs.existsSync(filePath)) {
          results.push(`${file}: File or directory not found`);
          // Remove from tracking even if it doesn't exist
          const index = createdPaths.indexOf(filePath);
          if (index > -1) {
            createdPaths.splice(index, 1);
          }
          continue;
        }

        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
            results.push(`${file}: Directory removed successfully`);
          } else {
            fs.unlinkSync(filePath);
            results.push(`${file}: File removed successfully`);
          }

          // Remove from tracking array
          const index = createdPaths.indexOf(filePath);
          if (index > -1) {
            createdPaths.splice(index, 1);
          }
        } catch (removeError) {
          results.push(`${file}: Error removing - ${removeError.message}`);
        }
      }

      return results.join("\n");
    } catch (e) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: "removeFiles",
    description: removeFilesDesc,
    schema: z.object({
      files: z.union([z.string(), z.array(z.string())]).describe("File or directory path(s) to remove. Can be a single string or array of strings.")
    })
  }
);

export const searchFilesTool = tool(
  async ({ pattern, path: targetPath, include = "", exclude = "", maxResults = 50 }) => {
    try {
      const currentDirectory = process.cwd();
      const expandedPath = expandTildePath(targetPath || currentDirectory);
      const directory = path.resolve(expandedPath);

      if (!isReadOnlyPathAllowed(directory, currentDirectory)) throw new Error("Access denied");
      if (!fs.existsSync(directory)) return "Directory not found";

      const includeExtensions = include ? include.split(",").map(ext => ext.trim().toLowerCase()) : [];
      const excludePrefixes = exclude ? exclude.split(",").map(p => p.trim()) : [];
      const lowerPattern = pattern.toLowerCase();
      const results = [];

      function searchDir(dir) {
        if (results.length >= maxResults) return;

        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          if (results.length >= maxResults) return;

          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(currentDirectory, fullPath);

          if (excludePrefixes.some(prefix => relPath.startsWith(prefix))) continue;

          if (entry.isDirectory()) {
            searchDir(fullPath);
          } else if (entry.isFile()) {
            if (includeExtensions.length > 0) {
              const ext = path.extname(entry.name).slice(1).toLowerCase();
              if (!includeExtensions.includes(ext)) continue;
            }

            try {
              const content = fs.readFileSync(fullPath, { encoding: "utf-8" });
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= maxResults) return;
                if (lines[i].toLowerCase().includes(lowerPattern)) {
                  const line = lines[i].length > 500 ? lines[i].slice(0, 500) + "..." : lines[i];
                  results.push(`${relPath}:${i + 1}: ${line}`);
                }
              }
            } catch {
              // Skip binary or unreadable files
            }
          }
        }
      }

      searchDir(directory);

      if (results.length === 0) return "No matches found";
      const output = results.join("\n");
      if (output.length > 50000) {
        return output.slice(0, 50000) + `\n\n[Output truncated: ${results.length} matches, ${output.length} chars total]`;
      }
      return output;
    } catch (e) {
      if (e.code === "ENOENT") return "Directory not found";
      if (e.code === "EACCES") return "Access denied";
      return e.message;
    }
  },
  {
    name: "searchFiles",
    description: searchFilesDesc,
    schema: z.object({
      pattern: z.string(),
      path: z.string().optional(),
      include: z.string().optional(),
      exclude: z.string().optional(),
      maxResults: z.number().optional()
    })
  }
);

export const currentDateTimeTool = tool(
  async () => {
    const now = new Date();
    const local = now.toLocaleString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    });
    const utc = now.toISOString();
    return `Local: ${local}\nUTC: ${utc}`;
  },
  {
    name: "currentDateTime",
    description: currentDateTimeDesc,
    schema: z.object({})
  }
);

export const createReadReferenceTool = (referencesDir) => tool(
  async ({ file }) => {
    try {
      if (!referencesDir) {
        return "No references directory configured.";
      }

      const resolvedDir = path.resolve(referencesDir);

      if (!fs.existsSync(resolvedDir)) {
        return "References directory not found.";
      }

      if (!file) {
        const files = [];
        function walk(dir) {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              walk(full);
            } else if (entry.name.endsWith(".md")) {
              files.push(path.relative(resolvedDir, full));
            }
          }
        }
        walk(resolvedDir);
        if (files.length === 0) return "No reference documents found.";
        return files.join("\n");
      }

      const filePath = path.resolve(resolvedDir, file);
      if (!filePath.startsWith(resolvedDir)) return "Access denied";
      if (!fs.existsSync(filePath)) return `Reference "${file}" not found.`;

      return fs.readFileSync(filePath, { encoding: "utf-8" });
    } catch (e) {
      return e.message;
    }
  },
  {
    name: "readReference",
    description: readReferenceDesc,
    schema: z.object({
      file: z.string().optional().describe("The reference file name to read. Omit to list available references.")
    })
  }
);

export const createReadSkillTool = (skillsDir) => tool(
  async ({ skill }) => {
    try {
      if (!skillsDir) {
        return "No skills directory configured.";
      }

      const resolvedDir = path.resolve(skillsDir);

      if (!fs.existsSync(resolvedDir)) {
        return "Skills directory not found.";
      }

      if (!skill) {
        const skills = listSkills(skillsDir);
        if (skills.length === 0) return "No skills found.";
        return skills.map(s => `- **${s.name}**: ${s.description}`).join("\n");
      }

      const skillPath = path.resolve(resolvedDir, skill, "SKILL.md");
      if (!skillPath.startsWith(resolvedDir)) return "Access denied";
      if (!fs.existsSync(skillPath)) return `Skill "${skill}" not found.`;

      return fs.readFileSync(skillPath, { encoding: "utf-8" });
    } catch (e) {
      return e.message;
    }
  },
  {
    name: "readSkill",
    description: readSkillDesc,
    schema: z.object({
      skill: z.string().optional().describe("The skill name to read. Omit to list available skills.")
    })
  }
);

export const createAskUserTool = () => tool(
  async ({ question }) => {
    if (!process.stdin.isTTY) {
      return "Non-interactive session detected (no TTY). Proceed with your best judgment based on the available context.";
    }

    const ask = () => new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stderr
      });
      process.stderr.write(`\n🤖 ${question}\n> `);
      rl.on("line", (answer) => {
        rl.close();
        resolve(answer);
      });
      rl.on("close", () => {
        resolve("");
      });
    });

    // Serialize concurrent calls to avoid stdin conflicts
    const result = new Promise((resolve) => {
      askUserQueue = askUserQueue.then(async () => {
        const answer = await ask();
        resolve(`User responded: ${answer}`);
      });
    });

    return result;
  },
  {
    name: "askUser",
    description: askUserDesc,
    schema: z.object({
      question: z.string()
    })
  }
);

export const askUserTool = createAskUserTool();

export const createSearchContextTool = (defaultStorage, defaultEmbeddingsConfig = {}) => tool(
  async ({ query, storage, limit = 5, source, embeddingsType, embeddingsConfig }) => {
    try {
      // Use provided storage or fall back to default
      const storageToUse = storage || defaultStorage;

      // The model may override the type/config per call; otherwise fall back to whatever the
      // agent was configured with (defaultEmbeddingsConfig, shape {type, config}), and finally to
      // the shared default type. "openai" is never assumed unless nothing else says otherwise.
      const typeToUse = embeddingsType || defaultEmbeddingsConfig.type || DEFAULT_EMBEDDINGS_TYPE;
      const configToUse = (embeddingsConfig && Object.keys(embeddingsConfig).length > 0)
        ? embeddingsConfig
        : defaultEmbeddingsConfig.config || {};

      if (!storageToUse) {
        return "No storage directory provided. Please specify a storage parameter or configure a default storage location.";
      }

      const currentDirectory = process.cwd();
      const storageDirectory = path.resolve(storageToUse);

      // Security check
      if (!storageDirectory.startsWith(currentDirectory)) {
        throw new Error("Access denied");
      }

      ensureCompatibleEmbeddings(storageDirectory, typeToUse, configToUse);

      // Initialize embeddings
      const Embeddings = getEmbeddings(typeToUse);
      const embeddings = new Embeddings(configToUse);

      // Initialize and load the store
      const store = new LlmStore(storageDirectory, embeddings);
      await store.load();

      // Search options - handle empty index gracefully
      const searchLimit = parseInt(limit);
      const searchOptions = {
        limit: searchLimit,
        source: source
      };

      const results = await store.search(query, searchOptions);

      // Return the page content as text context
      // If no results or empty results, return special marker
      if (!results || results.length === 0) {
        return "[NO_SEARCH_RESULTS_IGNORE_AND_PROCEED]";
      }

      const context = results.map(item => item.pageContent).join("\n\n");
      // If context is empty or whitespace only, return the special marker
      if (!context.trim()) {
        return "[NO_SEARCH_RESULTS_IGNORE_AND_PROCEED]";
      }

      // Return context with a special prefix that instructs the AI to use it silently
      return `[SEARCH_CONTEXT_USE_IF_HELPFUL_IGNORE_IF_NOT]\n${context}`;

    } catch (error) {
      if (error.message.includes("No documents have been indexed yet")) {
        return "No documents have been indexed yet. Please use 'aux4 ai agent learn <document>' to add documents to the vector store first.";
      }
      return `Search error: ${error.message}`;
    }
  },
  {
    name: "searchContext",
    description: searchContextDesc,
    schema: z.object({
      query: z.string().describe("The search query"),
      storage: z.string().optional().describe("Path to the storage directory containing the vector store (optional if default is configured)"),
      limit: z.number().optional().describe("Maximum number of results to return (default: 5)"),
      source: z.string().optional().describe("Optional: search only in a specific source file"),
      embeddingsType: z.string().optional().describe(`Type of embeddings to use (default: '${DEFAULT_EMBEDDINGS_TYPE}')`),
      embeddingsConfig: z.object({}).optional().describe("Configuration object for the embeddings")
    })
  }
);

export const searchContextTool = createSearchContextTool();

// Wrap a built tool with the policy enforcement hook. Read-only tools are passed
// through untouched (exempt for speed). Consequential tools get gated: before the
// underlying tool runs, the policy decides allow/deny (reading the live token usage
// supplied by getUsage). On deny the underlying tool never runs and the model gets a
// short adaptive message. Every decision is recorded on the policy so Prompt can
// attach it to the history `tool` entry when --history is set.
// An agent that repeats the same call and gets the same answer is not making progress, and
// nothing in the loop notices: a model can burn its whole budget re-running four calls. Compare
// the ARGUMENTS AND THE RESULT -- a repeated call whose result changes is legitimate (polling),
// a repeated call whose result does not is stuck. On the third identical pair, say so instead of
// running it again.
const LOOP_REPEAT_LIMIT = 3;
// How many refusals of the SAME call before the run is aborted outright.
const LOOP_ABORT_AFTER = 3;

// The same action with only its entered values changed, getting the same answer back,
// is also a loop: "--field 'X=a'" then "--field 'X=b'" then no field at all, each told
// the same thing. Values and volatile ids are dropped from this key.
const SHAPE_REPEAT_LIMIT = 4;
const MUTATION_VERB = /\b(send|reply|forward|delete|remove|rm|trash|archive|update|patch|put|post|create|insert|add|set|write|move|cancel|modify|edit|rename|upload|publish|deploy|pay|approve|install|uninstall|save|submit|book|confirm)\b/i;
const NATURAL_TARGET_FLAGS = new Set([
  "date", "email", "end", "enddate", "endtime", "name", "number", "phone",
  "slug", "start", "startdate", "starttime", "subject", "summary", "title",
  "to", "url", "username"
]);
const CONTEXT_TARGET_FLAGS = new Set([
  "accountid", "calendarid", "folderid", "orgid", "organizationid", "parentid",
  "projectid", "teamid", "tenantid", "userid", "workspaceid"
]);
const ENTITY_ID_FLAGS = /^(?:id|[a-z0-9_-]*id|key|[a-z0-9_-]*key)$/i;

// Parse the command at the same shell-word boundary executeAux4 uses, then keep
// only the stable parts that identify the changed target. This is deliberately
// independent of any package or service schema: explicit entity IDs win;
// otherwise common natural keys (such as summary + start) identify a target.
export function mutationTarget(name, args = {}) {
  if (name !== "executeAux4" || typeof args.command !== "string") return null;
  let argv;
  try {
    argv = parseCommandArgs(args.command);
  } catch {
    return null;
  }
  if (argv[0] === "aux4") argv = argv.slice(1);
  const firstFlag = argv.findIndex(arg => arg.startsWith("--"));
  const commandPath = (firstFlag < 0 ? argv : argv.slice(0, firstFlag)).join(" ").trim();
  if (!commandPath || !MUTATION_VERB.test(commandPath)) return null;

  const flags = new Map();
  for (let i = Math.max(0, firstFlag); i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const equals = token.indexOf("=");
    const key = (equals < 0 ? token.slice(2) : token.slice(2, equals)).toLowerCase();
    let value = equals < 0 ? "true" : token.slice(equals + 1);
    if (equals < 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--")) value = argv[++i];
    const values = flags.get(key) || [];
    values.push(value);
    flags.set(key, values);
  }

  const sorted = entries => Object.fromEntries([...entries]
    .map(([key, values]) => [key, [...new Set(values)].sort()])
    .sort(([a], [b]) => a.localeCompare(b)));
  const entityIds = sorted([...flags].filter(([key]) => ENTITY_ID_FLAGS.test(key) && !CONTEXT_TARGET_FLAGS.has(key)));
  const naturalKeys = sorted([...flags].filter(([key]) => NATURAL_TARGET_FLAGS.has(key)));
  const contexts = sorted([...flags].filter(([key]) => CONTEXT_TARGET_FLAGS.has(key)));
  return {
    commandPath,
    entityIds,
    naturalKeys,
    contexts,
    // When a command exposes no target fields, only an exact repeated command
    // can be identified safely.
    fallback: Object.keys(entityIds).length || Object.keys(naturalKeys).length
      ? ""
      : argv.join("\0")
  };
}

function sameFields(left, right, { requireShared = false } = {}) {
  const shared = Object.keys(left).filter(key => Object.hasOwn(right, key));
  if (requireShared && shared.length === 0) return false;
  return shared.every(key => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}

export function sameMutationTarget(left, right) {
  if (!left || !right || left.commandPath !== right.commandPath) return false;
  if (!sameFields(left.contexts, right.contexts)) return false;
  const leftIds = Object.keys(left.entityIds);
  const rightIds = Object.keys(right.entityIds);
  if (leftIds.length && rightIds.length) return sameFields(left.entityIds, right.entityIds, { requireShared: true });
  if (sameFields(left.naturalKeys, right.naturalKeys, { requireShared: true })) return true;
  return Boolean(left.fallback && left.fallback === right.fallback);
}

export function commandResultFailed(result) {
  const text = String(result ?? "").trim();
  if (/^(?:not run:|invalid command:|error\b|failed\b|command not found\b|permission denied:|⛔\s*policy)/i.test(text)) return true;
  try {
    const parsed = JSON.parse(text);
    return Boolean(parsed?.error || parsed?.errorMessage) || parsed?.success === false || ["error", "failed"].includes(String(parsed?.status || "").toLowerCase());
  } catch {
    return false;
  }
}

// A successful tool invocation can still be waiting for data or approval.
// Only completed effects reserve a target against subsequent mutations.
export function changeResultCompleted(result) {
  if (commandResultFailed(result)) return false;
  try {
    const data=typeof result === "string" ? JSON.parse(result) : result;
    return data?.submitted !== false && !["incomplete","needs-input","needs-confirmation","blocked","no-progress"].includes(String(data?.status || "").toLowerCase());
  } catch { return true; }
}

export function callShape(name, args) {
  const cleanArgs = { ...args };
  delete cleanArgs.__policyCallId;
  return `${name}:` + JSON.stringify(cleanArgs)
    .replace(/--field[= ]+(?:'[^']*'|\\"(?:[^"\\]|\\\\.)*?\\"|"(?:[^"\\]|\\.)*"|\S+)/g, "--field <v>")
    .replace(/--session[= ]+'?[A-Za-z0-9-]+'?/g, "--session <id>");
}

// A command group can return the same help or read result while a model keeps
// changing unrelated flags. Track identical evidence per command path so a
// third variation can be stopped before it consumes another tool call. Keep
// this away from actions (including browser runs), whose unchanged-looking
// responses may follow real mutations.
function readCommandFamily(name, args) {
  if (name !== "executeAux4" || typeof args?.command !== "string") return null;
  let argv;
  try {
    argv = parseCommandArgs(args.command);
  } catch {
    return null;
  }
  if (argv[0] === "aux4") argv = argv.slice(1);
  // Documentation is new recovery evidence, not another data lookup.
  if (argv.includes("--help") || argv.includes("-h")) return null;
  const firstFlag = argv.findIndex(arg => arg.startsWith("--"));
  const commandPath = (firstFlag < 0 ? argv : argv.slice(0, firstFlag)).join(" ").trim();
  if (!commandPath || MUTATION_VERB.test(commandPath) || commandPath.split(/\s+/).at(-1) === "run") return null;
  return commandPath;
}

export function resultShape(result) {
  return String(result)
    .replace(/[0-9a-f]{8,}/gi, "<id>")
    .replace(/\d{4,}/g, "<n>")
    .slice(0, 400);
}

export function wrapWithLoopDetection(name, underlyingTool) {
  const seen = new Map();
  const shapes = new Map();
  const readResults = new Map();
  const refusedReads = new Map();
  const successfulChanges = [];
  const pendingChanges = [];

  return tool(
    async (args) => {
      const cleanArgs = { ...args };
      delete cleanArgs.__policyCallId;
      const target = mutationTarget(name, cleanArgs);
      if (target && pendingChanges.some(prior => sameMutationTarget(prior, target))) {
        return "Not run: a change of this kind for this target is already running. Wait for its result, then read the current state before deciding whether anything else is needed.";
      }
      if (target && successfulChanges.some(prior => sameMutationTarget(prior, target))) {
        return "Not run: a change of this kind for this target already succeeded in this run. Read the current state and stop; do not issue another change to it.";
      }
      // Volatile identifiers defeat the comparison: a browser daemon restart yields a new
      // session id, so an agent repeating the identical journey looks like all-new calls.
      // Normalise them out so the key describes what is being done, not which handle it used.
      const key = JSON.stringify(cleanArgs)
        .replace(/--session[= ]+[A-Za-z0-9-]+/g, "--session <id>")
        .replace(/"sessionId"\s*:\s*"[^"]*"/g, '"sessionId":"<id>"');
      const prior = seen.get(key);

      if (prior && prior.count >= LOOP_REPEAT_LIMIT - 1) {
        prior.blocked = (prior.blocked || 0) + 1;
        seen.set(key, prior);

        // Refusing is not enough on its own: a model that ignores the refusal simply re-issues
        // the call, and each refusal is appended to the history and replayed on every later
        // request. One unbounded run reached 624 calls and 26M input tokens that way -- the
        // detector generating the waste it exists to prevent. After a few refusals, stop.
        if (prior.blocked >= LOOP_ABORT_AFTER) {
          const err = new Error(
            `Aborting: the same call has been refused ${prior.blocked} times and keeps being repeated. `
            + `The agent is not making progress and each attempt grows the context. Last result was:\n`
            + String(prior.result).slice(0, 200)
          );
          err.loopAbort = true;
          throw err;
        }

        const sample = String(prior.result).slice(0, 200);
        const fix = repeatFixHint(prior.result, args && args.command);
        return `Not run: you have already made this exact call ${prior.count} times and it returned`
          + ` the same result every time:\n${sample}\n\nRepeating it will not change anything.`
          + (fix ? ` ${fix}` : ` Read the current state and take a different route, or stop and report what is blocking you.`);
      }

      const shapeKey = callShape(name, args);
      const shapePrior = shapes.get(shapeKey);
      if (shapePrior && shapePrior.count >= SHAPE_REPEAT_LIMIT) {
        shapePrior.blocked = (shapePrior.blocked || 0) + 1;
        if (shapePrior.blocked >= LOOP_ABORT_AFTER) {
          const err = new Error(
            `Aborting: the same action has returned the same result ${shapePrior.count} times, whatever values were passed. `
            + `The agent is not making progress. Last result was:\n` + String(shapePrior.result).slice(0, 200)
          );
          err.loopAbort = true;
          throw err;
        }
        return `Not run: this action has returned the same result ${shapePrior.count} times, whatever values were passed:\n`
          + `${String(shapePrior.result).slice(0, 200)}\n\nChanging the values will not change it. `
          + `If a value it needs cannot be found, stop and say exactly which value is missing.`;
      }

      const readFamily = readCommandFamily(name, cleanArgs);
      const familyResults = readFamily && readResults.get(readFamily);
      const repeatedEvidence = familyResults && [...familyResults.entries()].find(([result, count]) =>
        count >= (isEmptyLookupResult(args?.command, result) ? 4 : 2));
      if (repeatedEvidence) {
        const refused = (refusedReads.get(readFamily) || 0) + 1;
        refusedReads.set(readFamily, refused);
        const evidence = repeatedEvidence[0].slice(0, 1200);
        const repetition = repeatedEvidence[1] === 2 ? "twice" : `${repeatedEvidence[1]} times`;
        if (refused >= LOOP_ABORT_AFTER) {
          const error = new Error(`Aborting: the same action has returned the same result ${repetition} and ${refused} further reads were refused. The agent is not making progress. Existing evidence:\n${evidence}`);
          error.loopAbort = true;
          throw error;
        }
        return `Not run: ${readFamily} has already returned identical evidence ${repetition} after different arguments. Reuse the existing facts to finish the remaining work; choose a materially different source only if a required fact is absent. If this was group help, run one of the listed subcommands before adding flags.\nExisting evidence:\n${evidence}`;
      }

      if (target) pendingChanges.push(target);
      try {
        const result = await underlyingTool.invoke(args);
        const asText = String(result);
        if (target && changeResultCompleted(asText)) {
          successfulChanges.push(target);
          readResults.clear();
          refusedReads.clear();
        }
        if (readFamily && !commandResultFailed(asText)) {
          const results = readResults.get(readFamily) || new Map();
          results.set(asText, (results.get(asText) || 0) + 1);
          readResults.set(readFamily, results);
        }
        seen.set(key, prior && prior.result === asText
          ? { count: prior.count + 1, result: asText }
          : { count: 1, result: asText });
        const sig = resultShape(asText);
        shapes.set(shapeKey, shapePrior && shapePrior.sig === sig
          ? { count: shapePrior.count + 1, sig, result: asText }
          : { count: 1, sig, result: asText });
        // Give actionable CLI feedback on the first error, before a model
        // spends its budget repeating unrelated successful lookups.
        const fix = commandResultFailed(asText) ? repeatFixHint(asText, args?.command) : "";
        return fix ? `${asText}\n\nRecovery: ${fix}` : result;
      } finally {
        if (target) {
          const reservation = pendingChanges.indexOf(target);
          if (reservation >= 0) pendingChanges.splice(reservation, 1);
        }
      }
    },
    {
      name,
      description: underlyingTool.description || (underlyingTool.lc_kwargs && underlyingTool.lc_kwargs.description) || name,
      schema: underlyingTool.schema
    }
  );
}

function wrapWithPolicy(name, underlyingTool, policy, getUsage) {
  if (!policy) return underlyingTool;

  return tool(
    async (args) => {
      // Prompt injects the tool_call_id so the recorded decision can be matched to
      // the corresponding history entry without colliding across parallel calls.
      const callId = args && args.__policyCallId;
      const cleanArgs = { ...args };
      delete cleanArgs.__policyCallId;

      const usage = (getUsage && getUsage()) || {};
      const calls = usage.calls || 0;

      const result = await policy.enforce(name, cleanArgs, usage, calls, callId);
      if (result.blocked) {
        return result.message;
      }
      return underlyingTool.invoke(cleanArgs);
    },
    {
      name,
      description: underlyingTool.description || (underlyingTool.lc_kwargs && underlyingTool.lc_kwargs.description) || name,
      schema: underlyingTool.schema
    }
  );
}

export function createTools(config = {}) {
  const { storage, embeddingsConfig, permissions, references, skills, policy, getUsage, hooksFile, request, historyFile, session, getMessages } = config;

  const base = {
    readFile: permissions ? createReadFileTool(permissions) : readLocalFileTool,
    writeFile: permissions ? createWriteFileTool(permissions) : writeLocalFileTool,
    editFile: permissions ? createEditFileTool(permissions) : editLocalFileTool,
    saveImage: permissions ? createSaveImageTool(permissions) : saveImageTool,
    listFiles: permissions ? createListFilesTool(permissions) : listFilesTool,
    searchFiles: permissions ? createSearchFilesTool(permissions) : searchFilesTool,
    createDirectory: createDirectoryTool,
    removeFiles: permissions ? createRemoveFilesTool(permissions) : removeFilesTool,
    executeAux4: permissions ? createExecuteAux4Tool(permissions) : executeAux4CliTool,
    askUser: createAskUserTool(),
    currentDateTime: currentDateTimeTool
  };

  // Do not advertise a filesystem capability that this run can never use.
  // Command globs do not grant file access: permission scopes are separate.
  // Keep tools for partial path grants and interactive grants, since the
  // concrete target still needs the normal runtime permission check.
  if (permissions) {
    const availableScope = scope => {
      const deniedEverywhere = (permissions.deny || []).some(raw => {
        const parsed = parsePattern(raw);
        return parsed.type === "file" && parsed.scope === scope && /^\*+$/.test(parsed.pattern);
      });
      if (deniedEverywhere) return false;
      return [...(permissions.allow || ["*"]), ...(permissions.ask || [])].some(raw => {
        const parsed = parsePattern(raw);
        return parsed.type === "file" && parsed.scope === scope;
      });
    };
    const fileScopes = {readFile:"read", listFiles:"read", searchFiles:"read", writeFile:"write", editFile:"write", saveImage:"write", createDirectory:"write", removeFiles:"delete"};
    for (const [name, scope] of Object.entries(fileScopes)) {
      if (!availableScope(scope)) delete base[name];
    }
  }

  // Only bind the tools whose backing resource actually exists -- an unbound tool costs
  // nothing in the prompt, and binding one that always says "not configured"/"not found" just
  // burns tokens describing a no-op. Each check mirrors the real resource the tool reads from
  // (LlmStore's docstore.json marker, an actual reference .md file, an actual skill).
  if (hasConfiguredStorage(storage)) {
    base.searchContext = createSearchContextTool(storage, embeddingsConfig);
  }
  if (hasReferences(references)) {
    base.readReference = createReadReferenceTool(references);
  }
  if (hasSkills(skills)) {
    base.readSkill = createReadSkillTool(skills);
  }

  if (policy) {
    // Gate only the consequential tools; read-only tools stay exempt.
    const CONSEQUENTIAL = ["executeAux4", "writeFile", "editFile", "removeFiles", "createDirectory", "saveImage"];
    for (const name of CONSEQUENTIAL) {
      if (base[name]) base[name] = wrapWithPolicy(name, base[name], policy, getUsage);
    }
  }

  // Loop detection wraps every bound tool: a stuck agent repeats any of them, not just the
  // consequential ones.
  for (const name of Object.keys(base)) {
    base[name] = wrapWithLoopDetection(name, base[name]);
  }

  // Hooks are the outermost wrap: a caller gets to check (and block) a call before
  // anything else -- policy, loop detection, the real tool -- ever sees it, matching
  // aux4 core's before-hook-runs-first contract.
  const hooks = hooksFile ? loadHooks(hooksFile) : [];
  if (hooks.length > 0) {
    const hooksContext = { hooks, request, historyFile, session, getMessages };
    for (const name of Object.keys(base)) {
      base[name] = wrapWithHooks(name, base[name], hooksContext);
    }
  }

  return base;
}

const Tools = {
  readFile: readLocalFileTool,
  writeFile: writeLocalFileTool,
  editFile: editLocalFileTool,
  saveImage: saveImageTool,
  listFiles: listFilesTool,
  searchFiles: searchFilesTool,
  createDirectory: createDirectoryTool,
  removeFiles: removeFilesTool,
  executeAux4: executeAux4CliTool,
  searchContext: searchContextTool,
  askUser: askUserTool,
  currentDateTime: currentDateTimeTool,
  readReference: createReadReferenceTool(),
  readSkill: createReadSkillTool()
};

export default Tools;
