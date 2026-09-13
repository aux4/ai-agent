# aux4 Skill Tool

Look up installed aux4 skills. A skill is a methodology for a capability — how to drive a browser,
run a knowledge base, delegate work — written for an agent to follow.

## Overview

Call this tool with no arguments to see what skills are installed, and with a skill name to read
that skill's full instructions.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skill` | string | No | The skill name to read. Omit to list installed skills. |

## When to Use This Tool

Check the list **before** working on a task involving a capability a skill might cover, and read
the matching skill before running commands for it. A skill tells you which commands to use and in
what order, so reading one first is cheaper and more reliable than discovering the commands
yourself.

## Response Format

- **List mode (no skill):** one skill per line, `name - description`
- **Read mode (with skill):** the skill's full instructions
