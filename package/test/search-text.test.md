# searchText

Ranks passages within a single file, so a caller pointed at a large output — a truncated command
result, a long help page — can ask for the part it needs instead of paging through it.

Makes live LLM calls. Skipped when no LLM credentials are present (CI); runs for real when
`OPENAI_API_KEY` (or `AUX4_TEST_LLM`) is set.

```beforeAll
mkdir -p .searchtext
printf '# Alpha\nThe alpha section is about starting a browser daemon.\n\n# Beta\nThe beta section covers closing sessions.\n\n# Gamma\nThe gamma section explains how to select an option from a dropdown menu.\n' > .searchtext/doc.txt
```

```afterAll
rm -rf .searchtext
```

## should find the passage that answers the question

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask --config --tools searchText --permissions '{"allow":["file:read:*"]}' --question "In the file .searchtext/doc.txt, which section explains dropdowns? Use searchText. Answer with the single section name, nothing else."; fi
```

```expect:regex:ignoreCase
(gamma|LLM-SKIPPED)
```

## should not invent an answer when nothing matches

A query with no match must come back empty-handed rather than returning the nearest passage as
though it were relevant.

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "LLM-SKIPPED"; else aux4 ai agent ask --config --tools searchText --permissions '{"allow":["file:read:*"]}' --question "In the file .searchtext/doc.txt, search for 'zzzznothingmatches' with searchText. If the tool reports no match, reply exactly NOMATCH and nothing else."; fi
```

```expect:regex:ignoreCase
(nomatch|LLM-SKIPPED)
```
