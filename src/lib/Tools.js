import fs from "fs";
import path from "path";
import os from "os";
import readline from "node:readline";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import LlmStore from "./LlmStore.js";
import { getEmbeddings } from "./Embeddings.js";

// Import tool descriptions
import readFileDesc from "../docs/tools/readFile.md?raw";
import writeFileDesc from "../docs/tools/writeFile.md?raw";
import editFileDesc from "../docs/tools/editFile.md?raw";
import listFilesDesc from "../docs/tools/listFiles.md?raw";
import createDirectoryDesc from "../docs/tools/createDirectory.md?raw";
import executeAux4Desc from "../docs/tools/executeAux4.md?raw";
import saveImageDesc from "../docs/tools/saveImage.md?raw";
import removeFilesDesc from "../docs/tools/removeFiles.md?raw";
import searchContextDesc from "../docs/tools/searchContext.md?raw";
import searchFilesDesc from "../docs/tools/searchFiles.md?raw";
import askUserDesc from "../docs/tools/askUser.md?raw";

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
  return filePath.startsWith(currentDirectory) || filePath.startsWith(aux4ConfigPath);
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
  async ({ file }) => {
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

      return fs.readFileSync(filePath, { encoding: "utf-8" });
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
      file: z.string()
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
        if (entry.isFile()) {
          result.push(relPath);
        } else if (entry.isDirectory() && recurse) {
          const subFiles = fs
            .readdirSync(fullPath, { withFileTypes: true })
            .filter(e => e.isFile())
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

export const executeAux4CliTool = tool(
  async ({ command, stdin }) => {
    try {
      const { execSync } = await import("child_process");
      const options = { encoding: "utf-8" };
      if (stdin) {
        options.input = stdin;
      }
      const result = execSync(`aux4 ${command}`, options);
      return result;
    } catch (error) {
      return `Error executing command: ${error.message}`;
    }
  },
  {
    name: "executeAux4",
    description: executeAux4Desc,
    schema: z.object({
      command: z.string(),
      stdin: z.string().optional().describe("Optional data to pass as stdin to the command")
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
                  results.push(`${relPath}:${i + 1}: ${lines[i]}`);
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
      return results.join("\n");
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
  async ({ query, storage, limit = 5, source, embeddingsType = "openai", embeddingsConfig = {} }) => {
    try {
      // Use provided storage or fall back to default
      const storageToUse = storage || defaultStorage;
      const embeddingsConfigToUse = Object.keys(embeddingsConfig).length > 0 ? embeddingsConfig : defaultEmbeddingsConfig;

      if (!storageToUse) {
        return "No storage directory provided. Please specify a storage parameter or configure a default storage location.";
      }

      const currentDirectory = process.cwd();
      const storageDirectory = path.resolve(storageToUse);

      // Security check
      if (!storageDirectory.startsWith(currentDirectory)) {
        throw new Error("Access denied");
      }

      // Initialize embeddings
      const Embeddings = getEmbeddings(embeddingsType);
      const embeddings = new Embeddings(embeddingsConfigToUse);

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
      embeddingsType: z.string().optional().describe("Type of embeddings to use (default: 'openai')"),
      embeddingsConfig: z.object({}).optional().describe("Configuration object for the embeddings")
    })
  }
);

export const searchContextTool = createSearchContextTool();

export function createTools(config = {}) {
  const { storage, embeddingsConfig } = config;

  return {
    readFile: readLocalFileTool,
    writeFile: writeLocalFileTool,
    editFile: editLocalFileTool,
    saveImage: saveImageTool,
    listFiles: listFilesTool,
    searchFiles: searchFilesTool,
    createDirectory: createDirectoryTool,
    removeFiles: removeFilesTool,
    executeAux4: executeAux4CliTool,
    searchContext: createSearchContextTool(storage, embeddingsConfig),
    askUser: createAskUserTool()
  };
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
  askUser: askUserTool
};

export default Tools;
