---
name: wiki-interest-analyzer
description: Use this skill to check, compare, or analyze the interest, popularity, or trend of a topic using Wikipedia pageviews, for one or more language editions. Trigger it when the user asks whether interest in a topic is growing, which language edition looks more promising, or whether a topic is worth investing in (a new course, feature, or product launch) - even if they never say "Wikipedia" or "pageviews". It supports several languages in one run and produces a monthly pageviews chart per language plus a short, data-grounded summary of trend direction, magnitude, and limitations of pageviews as a signal. Do NOT use it to edit Wikipedia articles or Wikidata, or for analytics unrelated to Wikipedia.
---

# Wiki Interest Analyzer

Analyzes how interest in a topic has changed over time, based on Wikipedia pageview data for one or more language editions. Helps B2C product teams decide what topics or markets to investigate further — not a substitute for market research, but a data-grounded starting signal.

The scripts use Node.js built-ins only — no third-party dependencies.

**Scope of this version:** one topic, **one or more language editions**, one time period per run. Each language edition is treated independently: there is no cross-language article matching (e.g. via Wikidata/langlinks) — the best article is chosen per edition, and a language with no matching article is simply reported and skipped. No automatic PDF generation; an optional PDF report can be generated after Step 7 with explicit user confirmation. No caching yet. If the user asks for something outside this scope, say so plainly and offer this simpler analysis instead.

## Setup (run once per environment, before Step 1)

The scripts are TypeScript run directly by Node.js (native type stripping). No build step and no `npm install` are required.

```bash
node --version   # must be >= 23.6 (Node 24 recommended)
```

Run this once at the start of a session. If Node is too old or missing, tell the user setup failed before attempting the analysis — do not proceed and fabricate results.

**Generated files:** every artifact (`pageviews_*.json`, `analysis_*.json`, `chart_<lang>_<slug>_<start>_<end>.svg`) is written to a `result/` directory at the project root (created automatically). Paths are printed as `SAVED: <path>`; use those paths for the next step. When the user asks for a report or other downloadable output, generate the requested artifact in result/ and return it as a file attachment when the runtime supports file attachments. Do not make the user manually locate files in the project directory.

## Gotchas

* **Always end the analysis with the PDF question.** After the summary, always ask whether the user wants a PDF report (Step 8) — never finish without asking.
* **Article titles differ per edition.** Never reuse one edition's title for another; use the exact `title`/`key` returned by `search_article.ts`.
* **A related article is not a substitute.** "Web design" / "web application" are *not* "web development". If no direct article is found: use the obvious direct match if there is one; otherwise show the candidates and ask the user to choose; skip the language only when there are no suitable candidates. Never analyse a proxy.
* **Relative periods end at the previous complete month.** "Last N years/months" must not include the current incomplete month, and must not use a rolling window ending today.
* **Absolute counts are not comparable across editions.** Different audience sizes; compare direction and relative change only.
* **An empty/no-data result for one language must not stop the others.** Report it and continue.
* **The optional PDF report is always English.** Non-Latin article titles are transliterated in it (built-in PDF fonts); the chat summary stays in the user's language.
* **Generated files are language- and date-tagged.** Always use the printed `SAVED:` paths for the next step.

## Workflow

### Step 1 — Parse the request

From the user's message, extract:

* **topic** — the subject or phrase they care about
* **languages** — one or more Wikipedia language editions, as ISO 639-1 codes (`pl`, `cs`, `uk`, `en`, etc.)
* **period** — start and end date. Resolve relative periods deterministically:

  * "last N years" / "останні N років" means the last N complete calendar months ending with the previous month.
  * For example, if today is 2026-09-25 and the user asks for "the last 2 years", use `2024-09-01` through `2026-08-31`.
  * Do not include the current incomplete month unless the user explicitly asks for it.
  * Do not use a rolling period ending on today's date for relative multi-month or multi-year requests.
* If no period is given, default to the last 12 complete calendar months and say so explicitly in your reply.

If the topic is missing, or no language can be determined, ask a single clarifying question before running anything. Do not guess a language. A single language keeps exactly the same flow as before.

### Step 2 — Find the article (per language, in parallel)

Run once with every requested language (the independent searches run in parallel inside the script):

```bash
node scripts/search_article.ts --lang <lang1> --lang <lang2> --query "<topic>" --limit 10
```

* One `--lang` → output `{"query", "lang", "candidates"}` (unchanged single-language shape).
* Several `--lang` → output `{"query", "results": [{"lang", "candidates"}, ...]}`.

This calls the Wikipedia Search REST API per language and returns candidates with `key`, `title`, `description`, `excerpt`, `url` (the `url` is built locally from the language and page key — no extra request). The script does not decide relevance — that is your job in Step 3, for each language separately.

### Step 3 — Select the article representing the exact topic

For each language independently, select an article that directly represents the topic requested by the user.

Do not simply choose the most semantically related candidate.

Do not claim that the user explicitly consented to using a proxy unless the user actually gave that consent in the conversation.

Priority:

1. Direct topic match — the article is specifically about the requested subject. Prefer this.
2. Clear language-specific title variant or equivalent concept — acceptable when the article represents the same subject in that Wikipedia edition.
3. Related topic / proxy — do NOT select automatically.
4. Broader or narrower topic — do NOT select automatically.

A related article is not a valid substitute when a direct article exists.

For example:

User topic: web development

* Web development / Веброзробка → direct match.
* Web application / Вебзастосунок → related but different concept; do NOT select it as a substitute.
* Web design → related but different concept; do NOT select it as a substitute.

Before selecting a related article as a proxy, check whether the search results contain a more direct article representing the requested topic.

If a direct article is present among the candidates, always prefer it over related articles.

If no direct article is found in the initial candidates:

1. Retry the search 1–2 times using alternative formulations of the same topic. Do not broaden, narrow, or reinterpret the topic during retries.
2. After the retries, handle this language as follows:

   * **Obvious direct match** → select it and continue with Step 4.
   * **No obvious direct match, but several potentially relevant candidates** → present the top 2–4 candidates to the user, each with its `title` and a short `description`/`excerpt`, and ask the user to choose. Do NOT pick one yourself, do NOT substitute a related/proxy article, and do NOT run Step 4 for this language until the user has chosen.
   * **User chose a candidate** → use exactly that article and continue with Step 4.
   * **No suitable candidates at all** → say that you could not unambiguously find a suitable article, and skip this language.

3. Never skip a language only because the initial search was ambiguous or incomplete.
4. Never select a related, broader, or narrower article just to avoid skipping the language.
5. Never claim that the user agreed to a proxy unless the user explicitly said so in the conversation.
6. Do not claim that "no article about the topic exists": if the search did not find a suitable match, say that you could not unambiguously find a suitable article.

When reporting the selected article, always include:

* language
* article title
* direct Wikipedia URL
* one-line reason why it represents the requested topic

### Step 4 — Fetch pageviews (per language, in parallel)

Once you have a confirmed exact article title for each language:

```bash
node scripts/fetch_pageviews.ts --start <YYYY-MM-DD> --end <YYYY-MM-DD> \
  --lang <lang1> --article "<exact title 1>" \
  --lang <lang2> --article "<exact title 2>"
```

* One `--lang`/`--article` pair → single-language output and one `SAVED: <path>` line (unchanged).
* Several pairs → `{"results": [{"language", "article", ..., "monthly", "warnings", "saved"}, ...]}`; the independent requests run in parallel, one file per language.

Calls the Wikimedia Pageviews API for daily views over the period and aggregates them into monthly totals.

Reports explicitly (does not fail silently), per language:

* article/page not found or zero pageviews data
* requested period starts before 2015-07-01 (Pageviews API has no data before this date) — clamp the start date and tell the user
* API error or empty response

An empty/no-data result for one language does not stop the others; a technical API error fails the whole command, as before. If any of these happen, tell the user before moving on — do not invent numbers.

### Step 5 — Compute metrics (per language)

```bash
node scripts/analyze_series.ts --input <path from step 4 for that language>
```

Run once per language on its pageviews file.

Deterministically computes, from the monthly series:

* `direction`: `"up"` / `"down"` / `"flat"`
* `percentChange`: change from first to last month in the period
* basic stats: mean, min, max, monthly values
* coverage: `expectedMonths`, `observedMonths`, `missingMonths` (how many months the requested window spans vs how many have data, and which are absent)

This script outputs **numbers only** — no verdict like "significant" or "reliable". That judgment is yours, in Step 7.

### Step 6 — Generate the chart (per language)

```bash
node scripts/plot_chart.ts --input <path from step 5 for that language>
```

Produces a monthly line chart (SVG, dependency-free). The output defaults to:

```text
result/chart_<lang>_<slug>_<start>_<end>.svg
```

Language and date range are taken from the input data, so charts for different languages or periods never collide. The same date range is also printed as a subtitle inside the chart. Override with `--output`.

The generated SVG file is saved in `result/` and is used both for the normal chat response and, if requested later, for the optional PDF report.

Do not generate a PDF in this step.

### Step 7 — Write the summary (your job, not a script's)

Use only the metrics produced by Step 5 and the article-selection result from Step 3. Do not introduce information from external sources that is not part of Steps 2–5, including Wikidata.

Do not introduce new quantitative claims or specific turning points that are not directly supported by these results.

Do not infer causes of changes or trends from pageviews alone.

Do not introduce qualitative claims such as "highly volatile", "noisy", "steady", or "smooth" unless they are directly supported by the computed metrics or clearly visible in the monthly values.

For a single language, cover the trend, magnitude, and limitations.

For several languages, cover each language and compare them.

The summary must:

* For every language, state the chosen article with its link:

  ```
  PL — [article title](URL)
  CS — [article title](URL)
  ```
* State whether pageviews are growing, declining, or stable in each edition, and roughly by how much using `percentChange` and `direction`.
* Report data coverage and warnings when relevant, using `observedMonths`, `expectedMonths`, `missingMonths`, and warnings from Step 4. Do not turn coverage into a reliability score or claim statistical significance.
* Compare the direction and relative magnitude of change across editions. Do not interpret this as a direct comparison of audience size or market demand.
* Present each generated chart in the final response, one per language, when the runtime supports image display. Otherwise provide the generated file path or attachment.
* State the limitations below explicitly every time:

  * pageviews reflect *curiosity/awareness*, not purchase intent or product demand
  * these are separate language editions — absolute pageview counts are **not directly comparable** between languages because audience sizes differ; compare direction and relative change, not raw numbers
  * a language edition may not represent your full target audience
  * short periods are noisier than long ones
* Only if the user asks which audiences, topics, or language editions to pursue next (or otherwise asks for recommendations), add a short recommendation: 1–3 next steps, each tied to a specific metric that supports it. Do not add recommendations when the user did not ask for them.

Never state a conclusion the numbers do not support. If a trend is weak or noisy, say so plainly instead of forcing a verdict either way.

After writing the summary, always continue to Step 8 and ask the PDF question — never end the turn before asking.

### Step 8 — Always offer the optional PDF report

After finishing Step 7 you **must ask** the user — every time, for every analysis — whether they want a PDF report:

> Would you like me to generate a PDF report with this summary and the charts?

* The PDF is **not automatic**. **No PDF is created without the user's explicit confirmation**, and a request to run the analysis is not confirmation.
* **No** → finish. Leave the existing JSON/SVG artifacts as they are.
* **Yes** → read `PDF_REPORT.md` and follow it to build and present the PDF.

If the runtime supports interactive buttons, offer `Yes / No`; a plain `yes` / `no` reply also works.

### Follow-up requests

If the user then asks to change the period, add or switch a language, or check a related topic:

* same language(s), new period → repeat from Step 4 for those languages
* add a language → repeat from Step 2 for the new language
* switch a language → repeat from Step 2 for the new language
* new topic → repeat from Step 1

Don't re-ask for parameters the user already gave and isn't changing.
