import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GENERATE = path.join(SKILL_DIR, "scripts", "generate_report.ts");

function workspace(): string {
  return mkdtempSync(path.join(tmpdir(), "wiki-report-"));
}

function analysis(lang: string, article: string): Record<string, unknown> {
  return {
    language: lang,
    article,
    requestedStart: "2024-09-01",
    requestedEnd: "2026-08-31",
    effectiveStart: "2024-09-01",
    effectiveEnd: "2026-08-31",
    monthly: [{ month: "2024-09", views: 10, days: 30 }],
    warnings: [],
    metrics: {
      direction: "up",
      percentChange: 12.5,
      mean: 42,
      min: 10,
      max: 90,
      slopePerMonth: 1.5,
    },
  };
}

function chartSvg(label: string): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100" font-family="Helvetica">',
    '<rect x="0" y="0" width="200" height="100" fill="#ffffff"/>',
    `<text x="100" y="20" font-size="12" font-weight="bold" fill="#1f2933" text-anchor="middle">Pageviews: ${label}</text>`,
    '<polyline points="10,80 100,40 190,60" fill="none" stroke="#2563eb" stroke-width="1.5"/>',
    '<circle cx="10" cy="80" r="2.5" fill="#2563eb"/>',
    '<text x="10" y="92" font-size="10" fill="#4b5563" text-anchor="end" transform="rotate(-45 10 92)">2024-09</text>',
    "</svg>",
  ].join("\n");
}

function writeArtifacts(dir: string, languages: Array<[string, string]>): { manifestPath: string } {
  const entries = languages.map(([lang, article]) => {
    const analysisPath = path.join(dir, `analysis_${lang}.json`);
    const chartPath = path.join(dir, `chart_${lang}.svg`);
    writeFileSync(analysisPath, JSON.stringify(analysis(lang, article), null, 2), "utf-8");
    writeFileSync(chartPath, chartSvg(`${article} (${lang}.wikipedia.org)`), "utf-8");
    return { analysis: analysisPath, chart: chartPath };
  });
  const manifest = {
    topic: "demo topic",
    period: { start: "2024-09-01", end: "2026-08-31" },
    comparison: "Both editions move together.",
    limitations: ["Pageviews reflect attention, not demand."],
    languages: entries.map((entry) => ({
      analysis: entry.analysis,
      chart: entry.chart,
      summary: "Summary.",
    })),
  };
  const manifestPath = path.join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  return { manifestPath };
}

function run(args: string[]): string {
  return execFileSync("node", [GENERATE, ...args], { encoding: "utf-8" });
}

test("generates a PDF for a single language and includes its chart", () => {
  const dir = workspace();
  const { manifestPath } = writeArtifacts(dir, [["pl", "Web design"]]);
  const output = path.join(dir, "report.pdf");

  run(["--manifest", manifestPath, "--output", output]);

  const raw = readFileSync(output);
  assert.ok(raw.subarray(0, 8).toString() === "%PDF-1.4");
  assert.ok(raw.toString("latin1").includes("%%EOF"));
  const text = raw.toString("latin1");
  assert.ok(text.includes("Wiki interest report"));
  assert.ok(text.includes("PL"));
  assert.ok(text.includes("Pageviews: Web design"), "chart SVG text should be embedded");
  assert.ok(text.includes("2024-09"), "rotated chart labels should be embedded");
});

test("packs multiple charts that fit onto a single page", () => {
  const dir = workspace();
  const { manifestPath } = writeArtifacts(dir, [["pl", "Web design"], ["cs", "Webdesign"]]);
  const output = path.join(dir, "report.pdf");

  run(["--manifest", manifestPath, "--output", output]);

  const text = readFileSync(output, "latin1");
  const pages = text.split("/Type /Page ").length - 1;
  assert.equal(pages, 2, `expected report page + one shared chart page, got ${pages}`);
  assert.ok(text.includes("Web design"));
  assert.ok(text.includes("Webdesign"));
  assert.ok(text.includes("Cross-language comparison"));
});

test("paginates charts once a page is full", () => {
  const dir = workspace();
  const { manifestPath } = writeArtifacts(dir, [
    ["pl", "Web design"],
    ["cs", "Webdesign"],
    ["uk", "Vebrozrobka"],
    ["de", "Webentwicklung"],
  ]);
  const output = path.join(dir, "report.pdf");

  run(["--manifest", manifestPath, "--output", output]);

  const text = readFileSync(output, "latin1");
  const pages = text.split("/Type /Page ").length - 1;
  assert.equal(pages, 3, `expected report page + two chart pages, got ${pages}`);
});

test("default output path is under result/ with topic slug and dates", () => {
  const dir = workspace();
  const { manifestPath } = writeArtifacts(dir, [["pl", "Web design"]]);
  const stdout = run(["--manifest", manifestPath]);
  const saved = /SAVED: (.+)$/m.exec(stdout)?.[1] ?? "";
  assert.ok(saved.endsWith("wiki_interest_report_demo_topic_2024-09-01_2026-08-31.pdf"), saved);
  assert.ok(existsSync(saved));
  rmSync(saved, { force: true });
});

test("reports clearly on invalid manifest", () => {
  const dir = workspace();
  const bad = path.join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify({ languages: [] }), "utf-8");

  assert.throws(
    () => execFileSync("node", [GENERATE, "--manifest", bad], { encoding: "utf-8", stdio: "pipe" }),
    (error: unknown) => String((error as { stderr?: string }).stderr ?? "").includes('non-empty "topic"'),
  );
});

test("reports clearly when an analysis file is missing", () => {
  const dir = workspace();
  const manifest = path.join(dir, "manifest.json");
  writeFileSync(
    manifest,
    JSON.stringify({ topic: "t", languages: [{ analysis: path.join(dir, "nope.json") }] }),
    "utf-8",
  );

  assert.throws(
    () => execFileSync("node", [GENERATE, "--manifest", manifest], { encoding: "utf-8", stdio: "pipe" }),
    (error: unknown) => String((error as { stderr?: string }).stderr ?? "").includes("cannot read analysis file"),
  );
});

test("steps 1-7 never generate a PDF automatically", () => {
  for (const script of ["search_article.ts", "fetch_pageviews.ts", "analyze_series.ts", "plot_chart.ts"]) {
    const source = readFileSync(path.join(SKILL_DIR, "scripts", script), "utf-8");
    assert.ok(!source.includes("generate_report"), `${script} must not call generate_report`);
    assert.ok(!source.includes("PdfDocument"), `${script} must not build PDFs`);
  }
  const skill = readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf-8");
  assert.ok(skill.includes("Step 8"));
  assert.ok(/explicit confirmation/i.test(skill));
  assert.ok(/no PDF is created without/i.test(skill));
});
