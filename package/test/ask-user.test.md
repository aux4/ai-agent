# ask user tool

## should invoke askUser tool and return response

```timeout
120000
```

```execute
aux4 ai agent ask --config --question "Use the askUser tool to ask me what language I prefer. Just output the tool response, nothing else."
```

```expect:regex:ignoreCase
(responded|non-interactive|proceed|judgment)
```
