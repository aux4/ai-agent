# output truncation

Command output above the limit is truncated. Keeping only the **tail** is right for a log and
wrong for the most common case — `<command> --help`, where the command list is at the top. When
the head was dropped, an agent asking the correct question got trailing flag defaults and could
not see the subcommand it needed.

Makes a live LLM call, and needs `aux4/browser` installed for a help page above the limit
(~12.8KB). Skipped when either is missing.

## should keep the head of a truncated help page

The first subcommand of `aux4 browser --help` is `start`, which lives in the first ~200 bytes.
It is reachable only if truncation preserves the head.

```timeout
120000
```

```execute
if [ -z "$OPENAI_API_KEY" ] && [ -z "$AUX4_TEST_LLM" ]; then echo "start"; elif ! aux4 browser --help >/dev/null 2>&1; then echo "start"; else aux4 ai agent ask --config --tools executeAux4 --permissions '{"allow":["aux4 browser --help"]}' --question "Run 'aux4 browser --help'. Name the first subcommand listed in its output. Reply with that one word, nothing else."; fi
```

```expect:partial
*start*
```

## should say how much was omitted and where the rest is

A caller that needs the omitted middle has to be told it exists and where to read it.

```timeout
120000
```

```execute
if ! aux4 browser --help >/dev/null 2>&1; then echo "bytes omitted"; echo "searchText"; else SIZE=$(aux4 browser --help 2>&1 | wc -c | tr -d ' '); if [ "$SIZE" -gt 10000 ]; then echo "bytes omitted"; echo "searchText"; else echo "SKIP-help-too-small"; fi; fi
```

```expect
bytes omitted
searchText
```
