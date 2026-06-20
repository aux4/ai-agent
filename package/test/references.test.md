# references

These tests make live LLM calls. They are skipped when no LLM credentials are
present (CI); they run for real when `OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

```beforeAll
mkdir -p references
```

```afterAll
rm -rf references
```

```file:references/projects.md
# Project Codenames

- Project Alpha codename: ZEPHYR-8841
- Project Beta codename: TRIDENT-5023
- Project Gamma codename: OBSIDIAN-7796
```

```file:references/mascots.md
# Team Mascots

The engineering team mascot is MAPLE-THUNDER-42.
```

```file:AGENTS.md
You are a helpful assistant. When asked about projects or mascots, use the readReference tool to look up the information. Just output the answer, nothing else.
```

## read a reference

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask --config --references references --question "What is the codename for Project Beta? Just output the codename, nothing else."; fi
```

```expect:regex
(TRIDENT-5023|LLM-SKIPPED)
```

## read another reference

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask --config --references references --question "What is the engineering team mascot? Just output the mascot name, nothing else."; fi
```

```expect:regex
(MAPLE-THUNDER-42|LLM-SKIPPED)
```
