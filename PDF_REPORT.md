# Optional PDF report

Read this file only **after the user has explicitly confirmed** they want a PDF
after Step 7. It describes how to build the one-file PDF from the artifacts the
analysis already produced.

## Rules

- The PDF is generated **only after the user's explicit confirmation**. A request
  to run the analysis is not confirmation.
- The script makes **no Wikimedia requests** and does **not** recompute pageviews.
  It only reads the existing `analysis_*.json` and `chart_*.svg` artifacts.
- The PDF is **always in English**, even when the chat summary is in another
  language: write the manifest text fields in English.

## Build it

Write a small manifest JSON, then run the report script once:

```bash
node scripts/generate_report.ts --manifest result/report_manifest.json
```

The PDF is saved to:

```text
result/wiki_interest_report_<topic-slug>_<start>_<end>.pdf
```

Use `--output` to override the path. Then present the PDF: attach it when the
runtime supports file attachments, otherwise give the `SAVED:` path. Never make
the user hunt for the file in `result/`.

## Manifest shape

Paths are relative to the project or absolute.

```json
{
  "topic": "web development",
  "period": {
    "start": "2024-09-01",
    "end": "2026-08-31"
  },
  "comparison": "…cross-language comparison…",
  "limitations": [
    "…",
    "…"
  ],
  "languages": [
    {
      "analysis": "result/analysis_pl_….json",
      "chart": "result/chart_pl_….svg",
      "summary": "…"
    }
  ]
}
```

- For each language, `analysis` is required: the language code, article title,
  and period are read from that file, and the direct Wikipedia URL is derived
  deterministically from them.
- `chart` and `summary` are optional.
- Do not add `language` / `article` / `articleUrl` fields per language — they are
  ignored by the script.
- `summary`, `comparison`, and `limitations` must contain the final text actually
  produced in Step 7, translated into English if necessary. Do not produce a second,
  independent interpretation for the PDF.

## PDF contents

- report title
- topic
- period
- languages
- each selected article with its direct Wikipedia URL
- short summary per language
- cross-language comparison when relevant
- main metrics
- limitations
- all generated charts, one per language (packed onto as few pages as fit)

Do not include raw daily pageviews, JSON dumps, or internal reasoning.
