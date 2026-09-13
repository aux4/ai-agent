# Create Directory Tool

Create directories and nested folder structures for organizing files and establishing project layouts.

## Overview

This tool **creates directory structures** needed for project organization. Use it to set up new project folders, create output directories for generated files, or establish logical code organization. It handles complex nested paths and tracks all creations for safe cleanup.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | ✅ Yes | Directory path to create. Can be relative (`src/components/ui`) or absolute. Will create all necessary parent directories |

## Automatic Features

- **🔗 Recursive creation:** Creates entire directory chain if missing
- **📝 Directory tracking:** Tracks all created directories for potential cleanup
- **🛡️ Idempotent operation:** Safe to call on existing directories (no error)
- **🏗️ Parent handling:** Automatically creates missing parent directories

## Security & Access Control

- **✅ Allowed locations:** Current working directory and all subdirectories only
- **❌ Restricted:** Cannot create directories outside current working directory
- **📁 Auto-tracking:** All newly created directories are tracked for cleanup

## When to Use This Tool

- **🏗️ Project setup:** Creating initial project structure and organization
- **📂 Output preparation:** Setting up directories for generated files or build outputs
- **🗂️ Code organization:** Creating logical folder structures for components, utilities, etc.
- **📊 Data organization:** Setting up directories for datasets, reports, or processing results
- **🧪 Test structure:** Creating test directories and organizing test files
- **🔧 Build preparation:** Setting up directories for build artifacts and deployment

## Directory Creation Behavior

| Scenario | Behavior | Tracked for Removal |
|----------|----------|-------------------|
| **New directory** | Creates directory with default permissions | ✅ Yes |
| **Existing directory** | No operation, returns "already exists" | ❌ No |
| **Nested path** | Creates all missing parent directories | ✅ Yes (all new dirs) |
| **Complex structure** | Creates entire hierarchy in one operation | ✅ Yes (all levels) |

## Response Format

- **✅ Success (new):** Returns `"directory created"`
- **✅ Already exists:** Returns `"directory already exists"`
- **❌ Access denied:** Returns `"Access denied"` (when creating outside allowed locations)
- **❌ Other errors:** Returns descriptive error message

## Common Directory Patterns

### 🎯 **Project Structure**
```
src/components/ui/buttons
src/utils/helpers
src/assets/images
docs/api/endpoints
tests/unit/components
```

### 📦 **Build & Output**
```
build/assets/css
build/assets/js
dist/production
output/reports/daily
temp/processing/batch-1
```

### 🧪 **Development Organization**
```
src/features/authentication
src/features/dashboard/components
src/shared/components/ui
src/shared/utils/validation
```

## Recursive Creation Example

Creating `src/features/auth/components/forms` will create:
1. `src/` (if missing)
2. `src/features/` (if missing)
3. `src/features/auth/` (if missing)
4. `src/features/auth/components/` (if missing)
5. `src/features/auth/components/forms/` (target)

All newly created directories are tracked for potential cleanup.

## Best Practices

- **📋 Plan first:** Design your directory structure before creating
- **🔄 Consistent naming:** Use consistent naming conventions across the project
- **📁 Logical grouping:** Group related files and functionality together
- **🧹 Cleanup aware:** Remember that created directories can be safely removed later

> **💡 Pro Tip:** Create directory structures early in your workflow to organize files properly from the start. The tool's tracking makes it safe to experiment with different organizational approaches.