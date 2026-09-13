# Write File Tool

Create new files or overwrite existing ones with specified content. Essential for generating code, creating configurations, and saving any text-based output.

## Overview

This tool is your **primary method for creating new files** in a project. Use it to generate source code, create configuration files, write documentation, save processed data, or create any text-based content. It automatically handles directory creation and tracks new files for safe cleanup.

## When to Use writeFile vs editFile

| Scenario | Tool to Use |
|----------|-------------|
| **Creating a new file** | `writeFile` |
| **Complete file rewrite** (changing most of the content) | `writeFile` |
| **Small changes** (fix typo, update value, modify function) | `editFile` |
| **Large file, small change** | `editFile` |
| **Multiple small changes in same file** | `editFile` (multiple calls) |

> **⚠️ Important:** For partial updates to existing files, prefer `editFile` over `writeFile`. It's more efficient and avoids issues with large file content hitting tool limits.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | ✅ Yes | Path where the file should be created/written. Can be relative (`src/utils/helper.js`) or absolute. Must be within current working directory |
| `content` | string | ✅ Yes | The complete text content to write to the file. Will be saved as UTF-8 encoded text |

## Automatic Features

- **📁 Directory creation:** Automatically creates parent directories if they don't exist
- **📝 File tracking:** Tracks newly created files for potential cleanup with `removeFiles` tool
- **💾 UTF-8 encoding:** All files are saved with UTF-8 encoding for maximum compatibility
- **🔄 Overwrite handling:** Can safely overwrite existing files (but won't track them for removal)

## Security & Access Control

- **✅ Allowed locations:** Current working directory and all subdirectories only
- **❌ Restricted:** Cannot write files outside current working directory
- **🛡️ Safe mode:** Only newly created files are tracked for removal (not overwritten files)

## When to Use This Tool

- **💻 Code generation:** Creating new source files, components, or modules
- **⚙️ Configuration creation:** Writing `package.json`, `.env`, config files
- **📚 Documentation writing:** Creating README files, API docs, or guides
- **📊 Data output:** Saving processed data, reports, or analysis results
- **🔧 Build artifacts:** Creating build scripts, deployment configs, or tooling files
- **🧪 Test files:** Generating test cases, mock data, or test configurations

## File Creation Behavior

| Scenario | Behavior | Tracked for Removal |
|----------|----------|-------------------|
| **New file** | Creates file and parent directories | ✅ Yes |
| **Existing file** | Overwrites content completely | ❌ No (safety) |
| **Nested path** | Creates all missing parent directories | ✅ Yes (directories) |

## Response Format

- **✅ Success:** Returns `"file created"`
- **❌ Access denied:** Returns `"Access denied"` (when writing outside allowed directories)
- **❌ Other errors:** Returns descriptive error message

## Content Types & Examples

- **Source code:** JavaScript, TypeScript, Python, etc.
- **Configuration:** JSON, YAML, TOML, ENV files
- **Documentation:** Markdown, plain text, HTML
- **Data files:** CSV, XML, JSON data
- **Templates:** HTML templates, config templates
- **Scripts:** Shell scripts, build scripts

> **💡 Best Practice:** Use this tool to create all project files - it ensures proper encoding, handles directory creation, and enables safe cleanup of generated content.