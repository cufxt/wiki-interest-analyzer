#!/usr/bin/env node
/**
 * generate_report.ts -- build one final PDF report from already-computed
 * artifacts: analysis JSON files, the SVG charts, and the Step 7 summary.
 *
 * Usage:
 *     node scripts/generate_report.ts --manifest result/report_manifest.json \
 *         [--output result/wiki_interest_report_<slug>_<start>_<end>.pdf]
 *
 * The manifest is written by the agent after Step 7:
 *     {
 *       "topic": "web development",
 *       "period": {"start": "2024-09-01", "end": "2026-08-31"},   // optional
 *       "comparison": "...",                                      // optional
 *       "limitations": ["...", "..."],                            // optional
 *       "languages": [
 *         {"analysis": "result/analysis_pl_....json",
 *          "chart":    "result/chart_pl_....svg",                 // optional
 *          "summary":  "...",                                     // optional
 *          "url":      "https://pl.wikipedia.org/wiki/..."}       // optional (derived)
 *       ]
 *     }
 *
 * This script performs NO network requests and does NOT recompute pageviews:
 * it only reads the existing artifacts and renders a short PDF.
 */

import { mkdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "../lib/args.ts";
import { A4_HEIGHT, A4_WIDTH, PdfDocument, wrapText } from "../lib/pdf.ts";
import { drawSvg } from "../lib/svgpdf.ts";
import { ensureResultDir } from "../lib/paths.ts";

interface LanguageEntry {
  analysis: string;
  chart?: string;
  summary?: string;
  url?: string;
}

interface Manifest {
  topic: string;
  period?: { start?: string; end?: string };
  comparison?: string;
  limitations?: string[];
  languages: LanguageEntry[];
}

interface ResolvedLanguage {
  lang: string;
  article: string;
  url: string;
  start: string;
  end: string;
  summary: string;
  metrics: Record<string, unknown>;
  warnings: string[];
  chart?: string;
}

const MARGIN = 48; // page margins in points
const BOTTOM = 56; // content flows to a new page below this bottom margin

function readJson(filePath: string, what: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(`cannot read ${what} '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`invalid JSON in ${what} '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
  }
}

function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/ /g, "_")
    .replace(/[^a-z0-9_-]/g, "");
  return slug || "topic";
}

function articleUrl(lang: string, article: string): string {
  const key = article.trim().replace(/ /g, "_");
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(key)}`;
}

function validateManifest(value: Record<string, unknown>, source: string): Manifest {
  if (typeof value.topic !== "string" || value.topic.trim() === "") {
    throw new Error(`manifest '${source}' is missing a non-empty "topic"`);
  }
  if (!Array.isArray(value.languages) || value.languages.length === 0) {
    throw new Error(`manifest '${source}' must contain a non-empty "languages" array`);
  }
  const languages: LanguageEntry[] = value.languages.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || typeof (entry as LanguageEntry).analysis !== "string") {
      throw new Error(`manifest '${source}': languages[${index}] must have an "analysis" path`);
    }
    return entry as LanguageEntry;
  });
  return {
    topic: value.topic,
    period: (value.period as Manifest["period"]) ?? undefined,
    comparison: typeof value.comparison === "string" ? value.comparison : undefined,
    limitations: Array.isArray(value.limitations) ? (value.limitations as string[]) : undefined,
    languages,
  };
}

function resolveLanguages(manifest: Manifest): ResolvedLanguage[] {
  return manifest.languages.map((entry) => {
    const analysis = readJson(entry.analysis, "analysis file");
    const lang = typeof analysis.language === "string" ? analysis.language : "";
    const article = typeof analysis.article === "string" ? analysis.article : "";
    if (!lang || !article) {
      throw new Error(`analysis file '${entry.analysis}' is missing "language" or "article"`);
    }
    return {
      lang,
      article,
      url: entry.url ?? articleUrl(lang, article),
      start: typeof analysis.requestedStart === "string" ? analysis.requestedStart : "",
      end: typeof analysis.requestedEnd === "string" ? analysis.requestedEnd : "",
      summary: entry.summary ?? "",
      metrics: (analysis.metrics as Record<string, unknown>) ?? {},
      warnings: Array.isArray(analysis.warnings) ? (analysis.warnings as string[]) : [],
      chart: entry.chart,
    };
  });
}

function metricLine(metrics: Record<string, unknown>): string {
  const num = (key: string): string => {
    const value = metrics[key];
    return typeof value === "number" ? String(value) : "n/a";
  };
  const direction = typeof metrics.direction === "string" ? metrics.direction : "n/a";
  const parts = [
    `direction: ${direction}`,
    `change: ${num("percentChange")}%`,
    `mean: ${num("mean")}`,
    `min: ${num("min")}`,
    `max: ${num("max")}`,
    `slope/month: ${num("slopePerMonth")}`,
  ];
  return parts.join("   ");
}

class ReportBuilder {
  private doc = new PdfDocument();
  private y = A4_HEIGHT - MARGIN;
  private readonly width = A4_WIDTH - MARGIN * 2;

  pageCount(): number {
    return this.doc.pageCount;
  }

  newPage(): void {
    this.doc.newPage();
    this.y = A4_HEIGHT - MARGIN;
  }

  private ensure(space: number): void {
    if (this.y - space < BOTTOM) {
      this.doc.newPage();
      this.y = A4_HEIGHT - MARGIN;
    }
  }

  heading(text: string, size = 13): void {
    this.ensure(size + 18);
    this.y -= size + 4;
    this.doc.text(MARGIN, this.y, text, { size, font: "F2", color: [0.12, 0.13, 0.16] });
    this.y -= 8;
  }

  paragraph(text: string, size = 10, color: [number, number, number] = [0.15, 0.16, 0.18]): void {
    if (!text) {
      return;
    }
    for (const line of wrapText(text, size, "F1", this.width)) {
      this.ensure(size + 4);
      this.y -= size + 3;
      this.doc.text(MARGIN, this.y, line, { size, color });
    }
    this.y -= 4;
  }

  bullet(text: string, size = 10, color: [number, number, number] = [0.35, 0.37, 0.40]): void {
    const lines = wrapText(text, size, "F1", this.width - 14);
    lines.forEach((line, index) => {
      this.ensure(size + 4);
      this.y -= size + 3;
      if (index === 0) {
        this.doc.circle(MARGIN + 3, this.y + size * 0.3, 1.5, { fill: color });
      }
      this.doc.text(MARGIN + 14, this.y, line, { size, color });
    });
    this.y -= 2;
  }

  spacer(amount: number): void {
    this.ensure(amount);
    this.y -= amount;
  }

  drawChart(titleText: string, svgText: string): void {
    const chartHeight = this.width * 0.45;
    const blockHeight = 12 + 10 + chartHeight + 12;
    this.ensure(blockHeight);
    this.heading(titleText, 12);
    const top = this.y - 4;
    drawSvg(this.doc, svgText, {
      x: MARGIN,
      y: top - chartHeight,
      width: this.width,
      height: chartHeight,
    });
    this.y = top - chartHeight - 12;
  }

  save(outputPath: string): void {
    this.doc.save(outputPath);
  }
}

function buildReport(manifest: Manifest, languages: ResolvedLanguage[]): ReportBuilder {
  const builder = new ReportBuilder();
  const start = manifest.period?.start ?? languages[0].start;
  const end = manifest.period?.end ?? languages[0].end;
  const langCodes = languages.map((entry) => entry.lang.toUpperCase()).join(", ");

  builder.heading("Wiki interest report", 20);
  builder.paragraph(`Topic: ${manifest.topic}`, 11, [0.12, 0.13, 0.16]);
  builder.paragraph(`Period: ${start} – ${end}`, 11, [0.12, 0.13, 0.16]);
  builder.paragraph(`Languages: ${langCodes}`, 11, [0.12, 0.13, 0.16]);
  builder.spacer(6);

  for (const entry of languages) {
    builder.heading(`${entry.lang.toUpperCase()} — ${entry.article}`);
    builder.paragraph(entry.url, 9, [0.11, 0.37, 0.68]);
    if (entry.summary) {
      builder.paragraph(entry.summary);
    }
    builder.paragraph(metricLine(entry.metrics), 9, [0.35, 0.37, 0.40]);
  }

  if (manifest.comparison) {
    builder.heading("Cross-language comparison");
    builder.paragraph(manifest.comparison);
  }

  if (manifest.limitations && manifest.limitations.length) {
    builder.heading("Limitations");
    for (const limitation of manifest.limitations) {
      builder.bullet(limitation);
    }
  }

  const charted = languages.filter((entry) => entry.chart);
  if (charted.length) {
    builder.newPage();
    for (const entry of charted) {
      const svgText = readFileSync(entry.chart as string, "utf-8");
      builder.drawChart(
        `Chart — ${entry.lang.toUpperCase()}: ${entry.article} (${entry.start} – ${entry.end})`,
        svgText,
      );
    }
  }

  return builder;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2), [
    { name: "manifest", required: true },
    { name: "output" },
  ]);
  const manifestPath = args.manifest as string;

  const manifest = validateManifest(readJson(manifestPath, "manifest"), manifestPath);
  const languages = resolveLanguages(manifest);

  const topicSlug = slugify(manifest.topic);
  const start = manifest.period?.start ?? languages[0].start;
  const end = manifest.period?.end ?? languages[0].end;
  const defaultName = `wiki_interest_report_${topicSlug}_${start}_${end}.pdf`;
  const outputPath =
    (args.output as string | undefined) ?? path.join(ensureResultDir(), defaultName);

  const builder = buildReport(manifest, languages);
  mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  builder.save(outputPath);

  console.error(`pages: ${builder.pageCount()}`);
  console.log(`SAVED: ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
