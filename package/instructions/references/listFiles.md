# List Files Tool

Discover and explore project structure by recursively listing files from any directory with powerful filtering capabilities.

## Overview

This tool is essential for **understanding project organization** and finding files. Use it to explore unfamiliar codebases, locate specific files, understand project structure, or get an overview before making changes. Perfect for reconnaissance and navigation in any project.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `path` | string | ❌ No | Current directory | Directory to search from. Can be relative (`./src`) or absolute. Supports tilde expansion (`~/projects`) |
| `recursive` | boolean/string | ❌ No | `true` | Whether to search subdirectories. Accepts `true`, `false`, `"true"`, `"false"` |
| `exclude` | string | ❌ No | _none_ | Comma-separated list of prefixes to exclude (e.g., `"node_modules,.git,dist"`) |

## Security & Access Control

- **✅ Allowed locations:**
  - Current working directory and all subdirectories
  - User's `.aux4.config/packages` folder
- **❌ Restricted:** Cannot list files outside these locations
- **🔍 Path resolution:** Automatically expands `~` to home directory

## When to Use This Tool

- **🗺️ Project exploration:** Getting familiar with unknown codebases
- **🔍 File discovery:** Finding specific files or file types
- **📊 Structure analysis:** Understanding how projects are organized
- **📁 Directory verification:** Checking what's in specific folders
- **🧹 Cleanup planning:** Identifying files before cleanup operations
- **📋 Inventory creation:** Creating file lists for documentation

## Filtering & Exclusion

The `exclude` parameter uses **prefix matching** to filter out unwanted files and directories:

| Exclude Pattern | What It Excludes | Examples |
|-----------------|------------------|----------|
| `"node_modules"` | Anything starting with "node_modules" | `node_modules/`, `node_modules_backup/` |
| `".git"` | Git-related files and directories | `.git/`, `.gitignore`, `.github/` |
| `"build,dist"` | Build output directories | `build/`, `dist/`, `build-temp/` |
| `"src/test"` | Test directories within src | `src/test/`, `src/test-utils/` |

## Common Exclusion Patterns

```
# Development exclusions
"node_modules,.git,dist,build,.next,.nuxt"

# Build artifacts
"build,dist,out,public,static,coverage"

# System files
".DS_Store,.env,.vscode,.idea,Thumbs.db"

# Logs and caches
"logs,cache,tmp,temp,.cache,.tmp"
```

## Response Format

Returns a **newline-separated list** of relative file paths:
```
package.json
src/index.js
src/components/Header.js
src/utils/helpers.js
README.md
```

## Response Types

- **✅ Success:** Newline-separated list of file paths
- **❌ Directory not found:** Returns `"Directory not found"`
- **❌ Access denied:** Returns `"Access denied"`
- **❌ Other errors:** Returns descriptive error message

## Performance Considerations

| Operation | Performance Impact | Recommendation |
|-----------|-------------------|----------------|
| **Large directories** | Can be slow with thousands of files | Use `exclude` to filter large dirs |
| **Deep recursion** | Slower with many nested directories | Set `recursive: false` for shallow scans |
| **Network drives** | Much slower on network locations | Prefer local directories |

## Strategic Usage Patterns

### 🎯 **Quick Project Overview**
```
path: "."
recursive: true
exclude: "node_modules,.git,dist"
```

### 🔍 **Source Code Only**
```
path: "./src"
recursive: true
exclude: "test,spec,__tests__"
```

### 📁 **Shallow Directory Scan**
```
path: "./docs"
recursive: false
exclude: ""
```

### 🧹 **Pre-cleanup Analysis**
```
path: "."
recursive: true
exclude: "node_modules,.git"  # See everything else
```

> **💡 Pro Tip:** Always use exclusions to filter out irrelevant directories like `node_modules`, `.git`, and build outputs for faster, cleaner results.