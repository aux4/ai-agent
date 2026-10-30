# Ask User Tool

Ask the user a question and wait for their typed response. Use this when you need clarification, a preference, or a decision from the user before proceeding.

## Overview

This tool prompts the user interactively via the terminal. The user's response is returned as text so you can incorporate it into your next steps. If the session is non-interactive (no TTY), no user response was received. Treat that as unanswered: it is not permission, evidence, or a choice of default. Continue with choices the user already authorized, and use values supported by the request or a relevant source. If a required factual value remains unavailable, stop and report what is missing.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | ✅ Yes | The question to display to the user |

## Important Usage Rules

- **🔒 Call this tool alone** — never call `askUser` in parallel with other tools. Because it reads from standard input, concurrent tool calls would conflict. Always make `askUser` the only tool call in your response.
- **🎯 Ask focused questions** — ask one clear question at a time. Avoid compound questions.
- **💡 Provide context** — briefly explain why you need the information so the user can give a useful answer.

## When to Use This Tool

- **❓ Clarification needed:** The user's request is ambiguous and guessing could lead to wasted effort
- **🔀 Multiple valid options:** There are several reasonable approaches and the user should choose
- **⚠️ Confirmation required:** Before a potentially destructive or irreversible action
- **📝 Missing information:** A required detail (name, path, preference) was not provided

## When NOT to Use This Tool

- **🚫 You have enough information:** Do not ask if you can reasonably infer the answer
- **🚫 Trivial decisions:** Do not ask about minor formatting or style choices unless the user has expressed a preference
- **🚫 Already answered:** Do not re-ask something the user already stated in the conversation

## Response Format

- **✅ Interactive session:** Returns `"User responded: <their answer>"`
- **⚠️ Non-interactive session:** Returns `NO_ANSWER` with a message that no response was received. This does not authorize a guess or supply missing evidence; discretionary choices explicitly authorized by the user remain allowed.
