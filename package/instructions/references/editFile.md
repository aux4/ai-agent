# Edit File Tool

Perform partial updates to existing files by replacing specific text. More efficient than rewriting entire files when making small changes.

## Overview

This tool allows you to **edit parts of a file** without rewriting the entire content. Use it when you need to make targeted changes like fixing a typo, updating a value, modifying a function, or changing specific lines. It's especially useful when dealing with large files where rewriting everything would be inefficient or hit tool limits.

## When to Use editFile vs writeFile

| Scenario | Tool to Use |
|----------|-------------|
| **Creating a new file** | `writeFile` |
| **Complete file rewrite** (changing most of the content) | `writeFile` |
| **Small changes** (fix typo, update value, modify function) | `editFile` ✅ |
| **Large file, small change** | `editFile` ✅ |
| **Multiple small changes in same file** | `editFile` (multiple calls) ✅ |

> **⚠️ Limitation:** `writeFile` can fail on large files due to tool content limits. Use `editFile` for partial updates to avoid this issue.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | Yes | Path to the file to edit. Can be relative (`src/config.js`) or absolute. Must be within current working directory |
| `old_string` | string | Yes | The exact text to find and replace. Must match exactly (including whitespace and newlines) |
| `new_string` | string | Yes | The text to replace `old_string` with. Can be empty string to delete the matched text |
| `replace_all` | boolean | No | If `true`, replaces ALL occurrences. If `false` or omitted, replaces only the first occurrence |

## When to Use This Tool

- **Small changes:** Updating a single value, fixing a typo, changing a variable name
- **Large files:** When the file is too large to rewrite entirely with `writeFile`
- **Targeted edits:** When you know exactly what text needs to change
- **Multiple replacements:** Use `replace_all: true` to update all occurrences at once
- **Deletions:** Use empty `new_string` to remove matched text

## When NOT to Use This Tool

- **Creating new files:** Use `writeFile` instead
- **Complete rewrites:** If changing most of the file, use `writeFile`
- **Unknown content:** If you're not sure what's in the file, read it first with `readFile`

## Security & Access Control

- **Allowed locations:** Current working directory and all subdirectories only
- **Restricted:** Cannot edit files outside current working directory
- **Must exist:** The file must already exist (unlike `writeFile` which can create files)

## Response Format

- **Success:** Returns `"file edited"` (single replacement) or `"file edited (N replacements)"` for multiple
- **Not found:** Returns `"old_string not found in file"` if the search text doesn't exist
- **File not found:** Returns `"File not found"` if the file doesn't exist
- **Access denied:** Returns `"Access denied"` when editing outside allowed directories

## Examples

### Fixing a typo
```
old_string: "recieve"
new_string: "receive"
replace_all: true
```

### Updating a version number
```
old_string: '"version": "1.0.0"'
new_string: '"version": "1.1.0"'
```

### Changing a function name
```
old_string: "function oldName("
new_string: "function newName("
replace_all: true
```

### Deleting a line
```
old_string: "// TODO: remove this\n"
new_string: ""
```

### Multi-line replacement
```
old_string: "if (condition) {\n  doSomething();\n}"
new_string: "if (newCondition) {\n  doSomethingElse();\n  logResult();\n}"
```

> **⚠️ Uniqueness Requirement:** The `old_string` must be unique in the file (unless using `replace_all: true`). If your target text appears multiple times, include surrounding lines or context to make it unique. For example, instead of just `"return true"`, use `"function validate() {\n  return true\n}"` to target the specific occurrence.

## Common Mistakes to Avoid

- **Too little context:** `old_string: "x"` - too generic, likely appears many times
- **Wrong whitespace:** Make sure indentation matches exactly what's in the file
- **Partial lines:** Include full lines when possible to avoid ambiguity
- **Stale content:** Always `readFile` first to see the current state before editing
