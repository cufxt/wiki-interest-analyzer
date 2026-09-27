# wiki-interest-analyzer

An **Agent Skills** skill for analyzing interest in a topic using Wikipedia article pageviews. It compares one or more language editions, produces a monthly pageviews chart per edition, and writes a short, data-grounded summary (optionally as a PDF).

It is not a substitute for market research: pageviews reflect *curiosity*, not willingness to pay. Treat the output as a starting signal, not a conclusion.

## What it does

- Takes a topic in natural language and determines the Wikipedia language editions (ISO 639-1: `pl`, `cs`, `uk`, `en`, …).
- Searches for candidate articles per edition (Search API) and selects the one that matches the requested topic.
- Fetches pageviews (Pageviews API, `agent=user`) and aggregates them by month, retrying transient API failures (429/5xx) with exponential backoff and stamping each result with a `fetchedAt` timestamp; data warnings (clamped period, no data) are written to stderr as well as into the result JSON.
- Computes deterministic metrics: `direction`, `percentChange`, `mean`, `min`, `max`, `slopePerMonth`, plus period coverage (`expectedMonths` / `observedMonths` / `missingMonths`).
- Renders a chart (SVG) per language edition.
- Writes a short summary with a reliability note and explicit limitations.
- On explicit user confirmation, builds a single PDF report from the already-computed artifacts (the PDF is always in English).

## Development history

- Tools: **OpenCode**; **DeepSeek 4.1 Flash** for writing code, **Sonnet 5** for planning.
- Started by reviewing the relevant materials — the Agent Skills specification, Wikimedia API docs, and related best-practice articles — before drafting a basic MVP plan.
- Implementation began with the basic "question → answer" flow: one language edition, no PDF.
- Functionality was added incrementally: multiple languages → article selection → metrics → charts → optional PDF.

## Verification

- The scripts were tested with **DeepSeek 4.1 Flash** and **Haiku 4.5**.
- Automated tests: `npm test` (CLI argument handling and PDF generation); type checking: `npm run typecheck`.
- Behaviour and trigger scenarios live in `evals/`.

## Quick start

Requires Node.js ≥ 23.6 (Node 24 recommended). The runtime has no third-party dependencies — the `.ts` scripts are run directly by Node.

```bash
node --version   # >= 23.6

# 1) find candidate articles (several languages in one call)
node scripts/search_article.ts --lang pl --lang cs --query "intermittent fasting" --limit 10

# 2) pageviews for the chosen article(s)
node scripts/fetch_pageviews.ts --start 2024-09-01 --end 2026-08-31 \
  --lang pl --article "Post przerywany" \
  --lang cs --article "Přerušovaný půst"

# 3) metrics
node scripts/analyze_series.ts --input result/pageviews_pl_....json

# 4) chart
node scripts/plot_chart.ts --input result/analysis_pl_....json

# 5) optional PDF (only after the user agrees)
node scripts/generate_report.ts --manifest result/report_manifest.json
```

All artifacts are written to `result/`; paths are printed as `SAVED: <path>`.

## Structure

```
SKILL.md                     instructions for the agent (workflow, gotchas)
scripts/search_article.ts    find candidate articles
scripts/fetch_pageviews.ts   fetch and aggregate pageviews
scripts/analyze_series.ts    trend metrics
scripts/plot_chart.ts        SVG chart
scripts/generate_report.ts   optional PDF report
PDF_REPORT.md      PDF report details (loaded only after the user confirms)
lib/                         shared utilities (args, http, json, pdf, svg→pdf, paths)
tests/                       unit and integration tests
evals/                       dev-only behaviour/trigger checks (not part of the runtime)
```

## Future improvements

Planned direction:

- caching for repeated and follow-up requests (so a follow-up does not hit the API again);
- analysis based on several thematic articles (aggregate a topic instead of a single article);
- a nicely formatted PDF **in the request language** (requires embedding a Unicode font);
- more detailed charts;
- a **Python** port using `matplotlib`.

Additional ideas:

- normalization by population/audience for fairer comparison across languages;
- deeper reliability assessment (robustness to a single outlier month, seasonality);
- scaling to larger volumes (daily data, many articles; DuckDB/Parquet).
