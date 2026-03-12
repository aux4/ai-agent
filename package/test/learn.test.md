# learn

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
aux4 ai agent learn france.txt
```

```execute
aux4 ai agent learn england.txt
```

```execute
aux4 ai agent learn spain.txt
```

### Test France

```execute
aux4 ai agent search "What is the capital of France?"
```

```expect
Capital of France is London
```

### Test England

```execute
aux4 ai agent search "What is the capital of England?"
```

```expect
Capital of England is London
```

### Test Spain

```execute
aux4 ai agent search "What is the capital of Spain?"
```

```expect
Capital of Spain is Madrid
```

### Update the file

```execute
echo "Capital of France is Paris" > france.txt
```

```execute
aux4 ai agent learn france.txt
```

#### Test France again

```execute
aux4 ai agent search "What is the capital of France?"
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
aux4 ai agent learn capitals/
```

### Test Italy from folder

```execute
aux4 ai agent search "What is the capital of Italy?"
```

```expect
Capital of Italy is Rome
```

### Test Germany from folder

```execute
aux4 ai agent search "What is the capital of Germany?"
```

```expect
Capital of Germany is Berlin
```

## Re-learn unchanged file should skip

```execute
aux4 ai agent learn capitals/italy.txt
```

```output
Skipped (unchanged)
```

## Re-learn changed file should re-embed

```execute
echo "Capital of Italy is Milan" > capitals/italy.txt
```

```execute
aux4 ai agent learn capitals/italy.txt
```

```execute
aux4 ai agent search "What is the capital of Italy?"
```

```expect
Capital of Italy is Milan
```
