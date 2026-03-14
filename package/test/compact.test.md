# ai agent compact

```file:compact-history.json
[
  {"role":"user","content":"What is the capital of France?"},
  {"role":"assistant","content":"The capital of France is Paris."},
  {"role":"user","content":"What about Germany?"},
  {"role":"assistant","content":"The capital of Germany is Berlin."},
  {"role":"user","content":"And Italy?"},
  {"role":"assistant","content":"The capital of Italy is Rome."},
  {"role":"user","content":"What is the population of Rome?"},
  {"role":"assistant","content":"Rome has a population of approximately 2.8 million people."},
  {"role":"user","content":"What language do they speak in Italy?"},
  {"role":"assistant","content":"The official language of Italy is Italian."}
]
```

```afterAll
rm -f compact-history.json
```

## missing model

### should fail without model configuration

```execute
aux4 ai agent compact compact-history.json
```

```error:partial
Error: Model configuration is required*
```

## file not found

### should fail when history file does not exist

```execute
aux4 ai agent compact nonexistent.json --model '{"type":"openai","config":{"model":"gpt-4o-mini"}}'
```

```error:partial
Error: History file*not found
```

## compact with model

### should compact history and reduce message count

```timeout
60000
```

```execute
cp compact-history.json compact-test.json
aux4 ai agent compact compact-test.json --config --keepLastMessages 4
MESSAGES=$(node -e "const h=require('./compact-test.json'); console.log(h.length)")
COMPACTED=$(node -e "const h=require('./compact-test.json'); console.log(h.some(m => m.compacted))")
echo "messages:$MESSAGES"
echo "compacted:$COMPACTED"
rm -f compact-test.json
```

```expect:partial
compacted:true
```
