// Short, model-facing tool descriptions. These are what actually gets sent to the LLM on
// every call (via LangChain's tool() `description` field) -- unlike the long human-readable
// docs in src/docs/tools/*.md (linked from README/man pages), which are never loaded here.
// Parameter-level detail belongs in the zod schema's .describe() calls in Tools.js, not here --
// keep these to what changes model behavior: what the tool does, when to use it, and any rule
// that isn't obvious from the schema.

export const readFileDesc =
  "Read the contents of a text file from disk (relative, absolute, or ~ paths). " +
  "Use offset/limit to paginate large files instead of reading everything at once. " +
  "Returns \"File not found\"/\"Access denied\" on failure, or a hint for binary files " +
  "(e.g. use executeAux4('pdf parse ...') for PDFs).";

export const writeFileDesc =
  "Create a new file or overwrite an existing one with the given content. Prefer editFile " +
  "for small changes to an existing file -- writeFile can fail on very large content. " +
  "Only newly created files are tracked for later removeFiles cleanup.";

export const editFileDesc =
  "Replace exact text (old_string -> new_string) inside an existing file, without rewriting " +
  "the whole file. old_string must match exactly, including whitespace, and must be unique in " +
  "the file unless replace_all is true -- include enough surrounding context to make it unique. " +
  "Always readFile first so old_string reflects the current content. Use writeFile instead for " +
  "a new file or a near-total rewrite.";

export const listFilesDesc =
  "List files in a directory (defaults to the current directory), optionally recursive, with " +
  "comma-separated `exclude` prefixes (e.g. \"node_modules,.git,dist\"). Use to explore project " +
  "structure before reading or editing files.";

export const createDirectoryDesc =
  "Create a directory, including any missing parent directories. Idempotent -- calling it on an " +
  "existing directory just returns \"directory already exists\". Restricted to the current " +
  "working directory and its subdirectories.";

// executeAux4 keeps its full description, verbatim from executeAux4.md (kept in sync by
// test/tool-descriptions.test.mjs): it is the tool almost every task uses, and its prefix,
// discovery and quoting examples are what models rely on.
export const executeAux4Desc = "# Execute Aux4 CLI Tool\n\nRun any aux4 command. The `aux4` prefix is added automatically \u2014 just provide the command name and arguments.\n\n## Parameters\n\n| Parameter | Type   | Required | Description |\n|-----------|--------|----------|-------------|\n| `command` | string | Yes      | The command to execute (without `aux4` prefix) |\n| `stdin`   | string | No       | Data to pass as stdin |\n| `timeout` | number | No       | Timeout in seconds (default: 60, 0 = no timeout) |\n\n## Command Format\n\nThe tool runs `aux4 <your command>`. Do NOT add `aux4` yourself.\n\n**Correct:** `\"pdf parse file.pdf\"`, `\"browser open --url https://example.com\"`, `\"config get key\"`\n**Wrong:** `\"aux4 pdf parse file.pdf\"`, `\"aux4 browser open\"`, `\"aux4 config get key\"`\n\nThe only exception is `aux4` subcommands (package management, version, man pages) which live under the `aux4` namespace:\n- `\"aux4 version\"` \u2014 show aux4 version\n- `\"aux4 pkger list\"` \u2014 list installed packages\n- `\"aux4 man command\"` \u2014 show command manual\n\nThese require `aux4` because `aux4` is the command name, making the full invocation `aux4 aux4 version`.\n\n## Discovery\n\nUse `--help` to explore any command:\n- `\"--help\"` \u2014 list all top-level commands\n- `\"pdf --help\"` \u2014 show help for pdf\n- `\"browser open --help\"` \u2014 show help for browser open\n\n## Large Output\n\nWhen a command produces output larger than 10KB, the result is truncated and you'll see:\n`[Output truncated: X bytes total. Full output was written to /tmp/path/to/file]`\n\n**When this happens, use `readFile` to read the full output from the temp file path.** Do not work with truncated data \u2014 always read the full file.\n\n## Timeout Behavior\n\nCommands that exceed the timeout are automatically transferred to a background job (if aux4/jobs is installed). Use `\"jobs status\"`, `\"jobs output <id>\"` to check.\n\nFor long-running commands (builds, API calls), increase the timeout or set `timeout: 0`.\n\n## Passing stdin\n\nUse the `stdin` parameter for commands that read from stdin:\n```\nexecuteAux4({ command: 'pdf fill \"form.pdf\" --out \"filled.pdf\"', stdin: '{\"field\": \"value\"}' })\n```\n\n## Configuration\n\naux4 supports loading parameters from `config.yaml`:\n```\n\"deploy --config dev\"\n\"deploy --configFile custom.yaml --config staging\"\n```\n\n## Quoting\n\nThe command runs `aux4` directly \u2014 there is no shell involved, so nothing in it is ever\nshell-expanded. Quote an argument that contains spaces with `\"...\"` or `'...'`, exactly as\nyou would type it in a terminal:\n\n- `'...'` is literal \u2014 nothing inside is special.\n- `\"...\"` allows `\\\"` and `\\\\` escapes only. `$`, `` ` ``, `$()`, `${}` and `~` are NEVER\n  expanded, quoted or not \u2014 write them exactly as they should reach the command, e.g.\n  `\"price $9.99\"` arrives as `price $9.99`.\n- Characters like `;`, `|`, `&`, `>`, `<` are plain text when they're part of an argument\n  (a URL `\"http://host/path?a=1&b=2\"` passes through untouched). An UNQUOTED `;`, `|`,\n  `&&`, `||`, `>` or `<` that stands as its OWN word is rejected with an error \u2014 it almost\n  always means you meant shell chaining, which does not run here. Make one `executeAux4`\n  call per command instead.\n- An unterminated quote or a trailing lone backslash is rejected with `Invalid command: ...`.\n";

export const saveImageDesc =
  "Save base64-encoded image data (raw base64 or a data: URL) to a file under the current " +
  "working directory. Use this for images you generated or received as base64 (e.g. from an " +
  "image-generation API), not for images already on disk.";

export const removeFilesDesc =
  "Delete one or more files/directories (string or array of paths). Only files or directories " +
  "this agent created earlier in the SAME session (via writeFile, saveImage, or createDirectory) " +
  "can be removed -- pre-existing files are always refused, so this is safe for cleaning up " +
  "generated content but cannot be used to delete anything else.";

export const searchContextDesc =
  "Search the configured vector store for text relevant to a query, using semantic (not keyword) " +
  "matching. Call it silently as part of forming your answer -- never tell the user whether you " +
  "searched or whether results were relevant; if nothing useful comes back, just answer from your " +
  "own knowledge instead.";

export const searchFilesDesc =
  "Search file contents for a text pattern (case-insensitive substring match), returning " +
  "`file:line: content` for each match. Faster than reading files one by one when looking for " +
  "code, config values, or strings across a project -- use it before readFile to find the right " +
  "files first.";

export const askUserDesc =
  "Ask the user a single, focused question and wait for their typed reply, for clarification, a " +
  "missing required detail, or confirmation before a destructive/irreversible action. Only ask " +
  "when you can't reasonably infer the answer. Always call this alone -- never alongside other " +
  "tool calls in the same turn, since it reads from stdin.";

export const currentDateTimeDesc =
  "Return the current local and UTC date/time. Use whenever you need today's date, the day of " +
  "the week, the time, or a timestamp -- don't guess or rely on training data for \"now\".";

export const readReferenceDesc =
  "Read a reference document from the agent's references directory, for detailed background " +
  "material that isn't loaded into the prompt upfront. Call with no `file` to list what's " +
  "available, or with a file name to read its full content.";

export const readSkillDesc =
  "Read the full instructions for a named skill from the agent's skills directory, when a task " +
  "matches one of the available skills. Call with no `skill` to list available skills and their " +
  "descriptions, or with a skill name to read its complete SKILL.md.";
