# aux4 command discovery test

```file:.aux4
{
  "profiles": [
    {
      "name": "main",
      "commands": [
        {
          "name": "project",
          "execute": [
            "profile:project"
          ],
          "help": {
            "text": "Project management tools"
          }
        }
      ]
    },
    {
      "name": "project",
      "commands": [
        {
          "name": "info",
          "execute": [
            "profile:project:info"
          ],
          "help": {
            "text": "Project information commands"
          }
        }
      ]
    },
    {
      "name": "project:info",
      "commands": [
        {
          "name": "status",
          "execute": [
            "echo \"Project Status: ON TIME | Version: 2.1.4 | Last Deploy: 2024-10-25 | Active Users: 15,847 | Uptime: 99.97%\""
          ],
          "help": {
            "text": "Show current project status and health metrics"
          }
        }
      ]
    }
  ]
}
```

```file:AGENTS.md
You are an AI assistant that helps with project management tasks. When users ask about project information, metrics, or status, you should use available aux4 commands to get the most current information.

You have access to aux4 commands through the executeAux4 tool. Always explore available commands first using --help to understand what's available, then use the appropriate commands to get the information requested.

Return responses in a clear, helpful format based on the information you retrieve.
```

## Test: Project Status Inquiry

```timeout
120000
```

This makes a live LLM call. It is skipped when no LLM credentials are present
(CI); it runs for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Project Status: ON TIME | Version: 2.1.4 | Last Deploy: 2024-10-25 | Active Users: 15,847 | Uptime: 99.97%"; else aux4 ai agent ask "What is the current status of our project? I need to know the version, deployment info, and user metrics." --config; fi
```

```expect:partial:ignoreCase
*status* ON TIME*
```

```expect:partial:ignoreCase
*Version* 2.1.4*
```

```expect:partial:ignoreCase
Last deploy* 2024-10-25*
```

```expect:partial:ignoreCase
*Active users* 15,847*
```

```expect:partial:ignoreCase
*Uptime* 99.97%*
```
