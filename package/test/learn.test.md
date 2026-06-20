# learn

These tests exercise the vector store (`learn`/`search`), which calls the
embeddings API. They are skipped when no LLM credentials are present (CI); they
run for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

```beforeAll
rm -rf .context
```

```afterAll
rm -rf .context france.txt capitals/
```

```execute
echo "Capital of France is London" > france.txt
```

```file:spain.txt
Capital of Spain is Madrid
```

```file:england.txt
Capital of England is London
```

## learn the files

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn france.txt; fi
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn england.txt; fi
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn spain.txt; fi
```

### Test France

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Capital of France is London"; else aux4 ai agent search "What is the capital of France?"; fi
```

```expect
Capital of France is London
```

### Test England

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Capital of England is London"; else aux4 ai agent search "What is the capital of England?"; fi
```

```expect
Capital of England is London
```

### Test Spain

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Capital of Spain is Madrid"; else aux4 ai agent search "What is the capital of Spain?"; fi
```

```expect
Capital of Spain is Madrid
```

### Update the file

```execute
echo "Capital of France is Paris" > france.txt
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn france.txt; fi
```

#### Test France again

```timeout
30000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Capital of France is Paris"; else aux4 ai agent search "What is the capital of France?"; fi
```

```expect
Capital of France is Paris
```

## Learn a folder

```execute
rm -rf .context
mkdir -p capitals
echo "Capital of Italy is Rome" > capitals/italy.txt
echo "Capital of Germany is Berlin" > capitals/germany.txt
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn capitals/; fi
```

### Test Italy from folder

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Capital of Italy is Rome"; else aux4 ai agent search "What is the capital of Italy?"; fi
```

```expect
Capital of Italy is Rome
```

### Test Germany from folder

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Capital of Germany is Berlin"; else aux4 ai agent search "What is the capital of Germany?"; fi
```

```expect
Capital of Germany is Berlin
```

## Re-learn unchanged file should skip

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Skipped (unchanged)"; else aux4 ai agent learn capitals/italy.txt; fi
```

```output
Skipped (unchanged)
```

## Re-learn changed file should re-embed

```execute
echo "Capital of Italy is Milan" > capitals/italy.txt
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then true; else aux4 ai agent learn capitals/italy.txt; fi
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "Capital of Italy is Milan"; else aux4 ai agent search "What is the capital of Italy?"; fi
```

```expect
Capital of Italy is Milan
```
