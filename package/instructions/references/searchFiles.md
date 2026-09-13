# Search Files Tool

Search file contents across the project by matching text patterns. Returns matching lines with file paths and line numbers.

## Overview

This tool enables **fast content search** across project files without needing to read each file individually. Use it to find specific code patterns, function definitions, configuration values, string references, or any text content. Essential for efficient codebase navigation and understanding.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `pattern` | string | Yes | _none_ | Text pattern to search for (case-insensitive substring match) |
| `path` | string | No | Current directory | Directory to search in. Can be relative (`./src`) or absolute. Supports tilde expansion (`~/projects`) |
| `include` | string | No | _none_ | Comma-separated file extensions to include (e.g., `"js,ts,md"`). If omitted, searches all text files |
| `exclude` | string | No | _none_ | Comma-separated prefixes to exclude from search (e.g., `"node_modules,.git,dist"`) |
| `maxResults` | number | No | `50` | Maximum number of matching lines to return |

## Security & Access Control

- **Allowed locations:**
  - Current working directory and all subdirectories
  - User's `.aux4.config/packages` folder
- **Restricted:** Cannot search files outside these locations
- **Path resolution:** Automatically expands `~` to home directory

## When to Use This Tool

- **Finding code:** Locate function definitions, variable usage, or API calls
- **Understanding dependencies:** Find where modules are imported or used
- **Configuration search:** Find specific settings across config files
- **Refactoring:** Identify all references before renaming or removing code
- **Debugging:** Find error messages, log statements, or specific strings

## Response Format

Returns matching lines with file path and line number context:
```
file.js:10: const myFunction = () => {
file.js:25:   return myFunction();
src/utils.js:3: import { myFunction } from './file.js';
```

## Response Types

- **Success:** Newline-separated list of matches in `file:line: content` format
- **No matches:** Returns `"No matches found"`
- **Directory not found:** Returns `"Directory not found"`
- **Access denied:** Returns `"Access denied"`
- **Other errors:** Returns descriptive error message

## Strategic Usage Patterns

### Find function definitions
```
pattern: "function processData"
path: "./src"
exclude: "node_modules,dist"
```

### Find all imports of a module
```
pattern: "from './utils'"
include: "js,ts"
```

### Find configuration values
```
pattern: "database_url"
include: "json,yaml,yml,env"
```

### Search in specific directory
```
pattern: "TODO"
path: "./src/components"
maxResults: 20
```

> **Tip:** Use `searchFiles` before `readFile` to quickly locate relevant code, then read only the files you need. This saves tokens and time compared to listing and reading files one by one.
