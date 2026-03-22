# references

```beforeAll
mkdir -p references/colors
echo "# Planets\n\n- Mercury is the closest planet to the Sun.\n- Venus is the hottest planet.\n- Earth is the only planet known to support life.\n- Mars is known as the Red Planet." > references/planets.md
echo "# Primary Colors\n\nThe three primary colors are red, blue, and yellow." > references/colors/primary.md
```

```afterAll
rm -rf references
```

```file:instructions.md
You are a helpful assistant. When asked about planets or colors, use the readReference tool to look up the information. Just output the answer, nothing else.
```

## read a reference

```timeout
60000
```

```execute
aux4 ai agent ask --config --references references --question "Which planet is the hottest? Just output the planet name, nothing else."
```

```expect:partial
Venus
```

## read nested reference

```timeout
60000
```

```execute
aux4 ai agent ask --config --references references --question "What are the three primary colors? Just output the three color names separated by commas, nothing else."
```

```expect:partial
red
```

```expect:partial
blue
```

```expect:partial
yellow
```
