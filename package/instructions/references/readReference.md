# Read Reference Tool

Read reference documents from the agent's references directory. Use this to look up detailed information without it being loaded into the prompt upfront.

## Overview

Reference documents contain detailed knowledge the agent can consult on demand. Call this tool with no file to list available references, or with a file name to read its content.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | string | No | The reference file to read. Omit to list available references. |

## When to Use This Tool

- You need detailed information about a topic mentioned in your instructions
- The user asks about something that may be covered in a reference document
- You want to check what references are available before answering

## Response Format

- **List mode (no file):** Returns a list of available reference file names
- **Read mode (with file):** Returns the content of the reference document
