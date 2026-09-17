# Release 1.3.12

## Fixes

- **Tool-call history no longer stores the raw LangChain envelope (SFA-167).** An
  `assistant_with_tool` checkpoint used to persist the model's `AIMessage` verbatim — the
  `lc`/`type`/`id` constructor wrapper, `response_metadata`, `usage_metadata`,
  `model_provider`/`model_name` and `invalid_tool_calls: []` — roughly 10.5x the useful
  payload (measured 1,021 B stored per 97 B of signal). It is now stripped to
  `{ content, tool_calls: [{ id, name, args }] }` before being written, so persisted and
  seeded history carry only what the provider round trip actually needs. Legacy histories
  that still contain the full envelope continue to load unchanged (both shapes are accepted
  on read, including in the `history` view, compaction, and the Codex/Gemini-CLI paths).

- **Identical failing tool calls no longer loop forever (SFA-159).** A tool error is just
  text to the model, so a broken command could be re-planned unchanged indefinitely — one
  incident reissued the exact same failing call 71 times over 6m44s, burning ~72 inferences
  and baking 148 junk messages into durable history. When the same tool call (name + arguments)
  produces the byte-identical result three times in a row, `resume` now appends synthetic
  guidance to the latest tool result telling the model not to retry verbatim and to either
  report the error or change approach. Detection runs on the rehydrated history, so it works
  across the separate-process plan/run-tool/resume turns of the Step Functions loop.
  Legitimate retries that change arguments, and calls that finally succeed, are unaffected.

## Tests

- Live round-trip tests (mlx, gated on `AUX4_TEST_MLX`) proving the stripped checkpoint
  persists without the envelope, resumes correctly across a process boundary with the tool
  result paired by `tool_call_id`, and that legacy full-envelope histories still resume. Adds
  a byte-size assertion for the reduction.
- Loop-guard tests proving three identical failing rounds inject the guidance while a retry
  with different arguments and a call that finally succeeds do not.
