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
90000
```

```execute
aux4 ai agent ask "print the user name John Doe using the aux4 tool, calling print-name command, using the --firstName and --lastName parameters. Just output the tool output nothing else. No explanations." --config --history history.json
```

```expect
User Doe, John from the tool
```

```afterAll
rm history.json
```

#### View the history

```execute
aux4 ai agent history
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
