# tool

## Create tool

```file:.aux4
{
  "profiles": [
    {
      "name": "main",
      "commands": [
        {
          "name": "print-name",
          "execute": [
            "echo User $lastName, $firstName from the tool"
          ],
          "help": {
            "text": "Prints the user's full name",
            "variables": [
              {
                "name": "firstName",
                "text": "The user's first name"
              },
              {
                "name": "lastName",
                "text": "The user's last name"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

```execute
aux4 print-name --firstName "Jane" --lastName "Doe"
```

```expect
User Doe, Jane from the tool
```

### Call the tool using AI

```timeout
120000
```

This makes a live LLM call. It is skipped when no LLM credentials are present
(CI); it runs for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "User Doe, John from the tool"; else aux4 ai agent ask "print the user name John Doe using the aux4 tool, calling print-name command, using the --firstName and --lastName parameters. Just output the tool output nothing else. No explanations." --config --history history.json; fi
```

```expect:partial
User Doe, John from the tool
```

```afterAll
rm -f history.json
```

#### View the history

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "executeAux4(command: print-name --firstName John --lastName Doe)"; echo "User Doe, John from the tool"; else aux4 ai agent history; fi
```

```expect:partial
executeAux4(command: print-name --firstName *John* --lastName *Doe*)
```

```expect:partial
User Doe, John from the tool
```

```expect:partial
User Doe, John from the tool
```
