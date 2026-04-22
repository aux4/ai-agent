# Read Skill Tool

Read skill definitions from the agent's skills directory. Skills are instruction documents that describe how to perform specific tasks or capabilities.

## Overview

Skills contain detailed instructions the agent can consult on demand. Call this tool with no skill to list available skills, or with a skill name to read its full instructions.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill` | string | No | The skill name to read. Omit to list available skills. |

## When to Use This Tool

- You need detailed instructions for a specific capability
- The user asks you to perform a task that matches a skill description
- You want to check what skills are available

## Response Format

- **List mode (no skill):** Returns available skill names with descriptions
- **Read mode (with skill):** Returns the full SKILL.md content including instructions
