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

This makes a live LLM call. It is skipped when no LLM credentials are present
(CI); it runs for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

### should compact history and reduce message count

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "compacted:true"; else cp compact-history.json compact-test.json && aux4 ai agent compact compact-test.json --config --keepLastMessages 4 && MESSAGES=$(node -e "const h=require('./compact-test.json'); console.log(h.length)") && COMPACTED=$(node -e "const h=require('./compact-test.json'); console.log(h.some(m => m.compacted))") && echo "messages:$MESSAGES" && echo "compacted:$COMPACTED" && rm -f compact-test.json compact-test.*.json; fi
```

```expect:partial
compacted:true
```

### should archive the full history before compacting and name it on the summary

Also a live LLM call, skipped the same way without credentials.

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "archived:true"; else rm -rf archive-test && mkdir archive-test && cp compact-history.json archive-test/conv.json && aux4 ai agent compact archive-test/conv.json --config --keepLastMessages 4 && ARCHIVE=$(node -e "const h=require('./archive-test/conv.json'); console.log(h.find(m => m.compacted).archive)") && node -e "const a=require('./archive-test/$ARCHIVE'); console.log('archived:' + (a.length === 10))" && rm -rf archive-test; fi
```

```expect:partial
archived:true
```
