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

export const executeAux4Desc =
  "Run one aux4 command (e.g. \"pdf parse file.pdf\", \"config get key\"). The `aux4` prefix is " +
  "added automatically -- never type it yourself, except for `aux4` subcommands like " +
  "\"aux4 version\" or \"aux4 pkger list\" (there the literal word `aux4` is the command name). " +
  "Use \"<command> --help\" to discover flags before guessing them. There is no shell: nothing is " +
  "ever expanded ($VAR, `cmd`, globs, ~), so quote arguments containing spaces with \"...\" or " +
  "'...' exactly as you would on a terminal, and make one executeAux4 call per command -- an " +
  "unquoted `;`, `|`, `&&`, `||`, `>` or `<` as its own word is rejected rather than chained. " +
  "Output over ~10KB is truncated with a path to the full output; read that file with readFile " +
  "instead of working from the truncated text. A command that runs past its timeout is handed " +
  "to a background job (if aux4/jobs is installed) -- follow the printed jobs status/output/kill " +
  "commands rather than retrying it.";

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
