# Evaluations (dev-only)

These are development aids, not part of the skill runtime. They exist to check
that `wiki-interest-analyzer` (a) triggers on the right prompts and (b) produces
the expected behaviour. There is no automated runner yet — run them manually.

## 1. Trigger evaluation

Data: `trigger_queries.json` — 20 realistic prompts, each labelled
`should_trigger` and tagged `train` / `validation`. Ten should trigger, ten are
near-misses that should not (editing Wikipedia, Wikidata, unrelated analytics,
CSV/PDF of other data, conceptual questions).

Procedure (per query, 3 runs):

```bash
opencode run --format json "<the query>" > /tmp/run.json
# pass if a Skill tool call with skill == "wiki-interest-analyzer" appears
# (should_trigger: true) or does not appear (should_trigger: false)
```

Notes:

- Run each query 3 times; the trigger rate is `triggers / 3`.
- A query passes when the rate is `> 0.5` for should-trigger queries and
  `< 0.5` for should-not-trigger queries.
- Tune the `description` in `SKILL.md` using **train** results only; use the
  **validation** queries to confirm the change generalizes, not to guide edits.
- This calls the model, so it costs tokens. Run it only after changing the
  description.

## 2. Output-quality evaluation

Data: `scenarios.json` — 3 representative tasks with the expected behaviour.

Procedure: run each `query` through the agent (TUI or `opencode run`) and check
every item in `expected_behavior` against the transcript. The most important
failures to watch for:

- substituting a related article (e.g. "web design") for a missing direct one;
- including the current incomplete month in a relative period;
- comparing absolute pageview counts across editions as audience size;
- generating a PDF before the user confirms.
