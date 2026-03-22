# current date time

```timeout
60000
```

```execute
aux4 ai agent ask --config --question "What is the current date? Use the currentDateTime tool. Just output the date in YYYY-MM-DD format, nothing else."
```

```expect:regex
\d{4}-\d{2}-\d{2}
```
