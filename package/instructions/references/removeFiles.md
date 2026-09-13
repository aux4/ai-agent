# Remove Files Tool

Safely remove files and directories that were created during this session with built-in protection against accidental deletion.

## Overview

This tool provides **secure cleanup capabilities** with a safety-first approach. It can only remove files and directories that were created by the agent during the current session, preventing accidental deletion of important existing files while enabling safe cleanup of generated content.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `files` | string \| array | ✅ Yes | Single file path (string) or multiple paths (array) to remove. Only tracked files/directories can be removed |

## Safety Mechanism

### 🛡️ **Session-Based Tracking**
The tool maintains an internal tracking system of items created by:
- **`writeFile` tool:** Newly created files (not overwritten existing files)
- **`saveImage` tool:** Newly created image files (not overwritten existing files)
- **`createDirectory` tool:** All created directories and parent directories

### 🚨 **What Cannot Be Removed**
- Files that existed before the agent session started
- Files created outside the agent tools (manually created files)
- Files outside the current working directory
- System files or protected resources

## Security & Access Control

- **✅ Protected operation:** Only removes agent-created files/directories
- **✅ Session isolation:** Tracking resets with each new agent session
- **✅ Path validation:** Ensures removal is within current working directory
- **✅ Graceful handling:** Continues processing even if some items fail

## When to Use This Tool

- **🧹 Session cleanup:** Remove all generated content at the end of a session
- **🧪 Experiment cleanup:** Clean up temporary files after testing ideas
- **🔄 Development iteration:** Remove generated files between development cycles
- **❌ Error recovery:** Clean up partial operations that failed
- **📁 Workspace management:** Maintain clean working directories
- **🧹 Batch cleanup:** Remove multiple related files in one operation

## Removal Behavior

### 📄 **File Removal**
- Removes individual files using `fs.unlinkSync`
- Clears file from internal tracking system
- Reports success/failure per file

### 📁 **Directory Removal**
- Removes directory and **all contents recursively**
- Uses `fs.rmSync` with `{ recursive: true, force: true }`
- Removes entire directory tree safely

## Response Format

Returns a **newline-separated status report** for each item:

```
config.json: File removed successfully
temp/: Directory removed successfully
missing.txt: File or directory not found
protected.txt: You can just delete files previously created by the agent
invalid/path: Access denied - path outside current directory
```

### 📊 **Status Message Types**

| Status | Meaning | Action Taken |
|--------|---------|--------------|
| `File removed successfully` | ✅ File deleted successfully | Removed from disk & tracking |
| `Directory removed successfully` | ✅ Directory tree deleted | Removed from disk & tracking |
| `File or directory not found` | ⚠️ Item doesn't exist | Removed from tracking only |
| `You can just delete files previously created by the agent` | ❌ Not in tracking system | No action taken |
| `Access denied - path outside current directory` | ❌ Security violation | No action taken |
| `Error removing - [details]` | ❌ System error occurred | No action taken |

## Error Handling & Resilience

The tool continues processing **all items** even if some fail:

### Batch Processing Example
```
Input: ["good-file.txt", "missing-file.txt", "protected-file.txt", "another-good-file.txt"]

Output:
good-file.txt: File removed successfully
missing-file.txt: File or directory not found
protected-file.txt: You can just delete files previously created by the agent
another-good-file.txt: File removed successfully
```

## Strategic Usage Patterns

### 🧹 **Complete Session Cleanup**
```
# Remove all generated content
files: [
  "generated-config.json",
  "temp-workspace/",
  "screenshots/test-run/",
  "build-output/"
]
```

### 🔄 **Selective Cleanup**
```
# Remove only specific items
files: "temp-analysis.csv"
```

### 🧪 **Experiment Reset**
```
# Clean up after testing
files: [
  "test-data/",
  "experimental-feature.js",
  "debug-output.log"
]
```

## Tracking System Lifecycle

| Event | Tracking Action |
|-------|----------------|
| **Session start** | Empty tracking list |
| **File created by `writeFile`** | ➕ Add to tracking (new files only) |
| **Image saved by `saveImage`** | ➕ Add to tracking (new files only) |
| **Directory created by `createDirectory`** | ➕ Add to tracking (all directories) |
| **Successful removal** | ➖ Remove from tracking |
| **Session end** | 🗑️ Clear all tracking |

## Best Practices

- **🎯 Be specific:** Remove exactly what you need to clean up
- **📋 Check responses:** Parse status messages to verify successful removal
- **🔄 Handle failures:** Account for files that may not exist or fail to remove
- **⏰ Session awareness:** Remember tracking resets with each new session
- **🗂️ Group operations:** Remove related files in single calls for efficiency

> **💡 Safety First:** This tool's design prioritizes safety over convenience. Only agent-created content can be removed, ensuring your important files are always protected from accidental deletion.