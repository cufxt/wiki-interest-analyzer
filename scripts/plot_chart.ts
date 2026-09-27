#!/usr/bin/env node
/**
 * plot_chart.ts -- render a monthly pageviews line chart from the output of
 * analyze_series.ts.
 *
 * Usage:
 *     node scripts/plot_chart.ts --input analysis_pl_....json [--output chart.svg]
 *
 * Output defaults to result/chart_<lang>.svg (language taken from the input
 * data), so charts for different languages do not overwrite each other; pass
 * --output to override.
 *
 * Output is SVG (dependency-free): monthly line with markers, title, y-axis
 * label and rotated month labels.
 */

import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "../lib/args.ts";
import { ensureResultDir } from "../lib/paths.ts";

interface MonthlyPoint {
  month: string;
  views: number;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/ /g, "_")
    .replace(/[^a-z0-9_-]/g, "");
}

function renderChart(
  monthly: MonthlyPoint[],
  article: string,
  lang: string,
  dateRange: string,
): string {
  // Fixed SVG canvas (roughly 20:9). It is scaled to fit when embedded in the PDF.
  const width = 1000;
  const height = 450;
  const marginLeft = 90; // room for y-axis value labels
  const marginRight = 40;
  const marginTop = 84; // title + date subtitle + legend
  const marginBottom = 90; // rotated month labels

  const plotLeft = marginLeft;
  const plotRight = width - marginRight;
  const plotTop = marginTop;
  const plotBottom = height - marginBottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const months = monthly.map((m) => m.month);
  const views = monthly.map((m) => m.views);
  const yMin = Math.min(0, ...views);
  const yMaxRaw = Math.max(...views);
  const yMax = yMaxRaw > yMin ? yMaxRaw + (yMaxRaw - yMin) * 0.05 : yMin + 1;

  const sx = (index: number): number =>
    monthly.length <= 1
      ? plotLeft + plotWidth / 2
      : plotLeft + (index / (monthly.length - 1)) * plotWidth;
  const sy = (value: number): number =>
    plotBottom - ((value - yMin) / (yMax - yMin)) * plotHeight;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" font-family="Helvetica, Arial, sans-serif">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
  ];

  // Title and date range.
  parts.push(
    `<text x="${width / 2}" y="26" font-size="16" font-weight="bold" ` +
      `fill="#1f2933" text-anchor="middle">Pageviews: ${escapeXml(article)} (${escapeXml(lang)}.wikipedia.org)</text>`,
  );
  if (dateRange) {
    parts.push(
      `<text x="${width / 2}" y="46" font-size="12" fill="#4b5563" ` +
        `text-anchor="middle">${escapeXml(dateRange)}</text>`,
    );
  }

  // Y-axis label (rotated).
  parts.push(
    `<text x="20" y="${(plotTop + plotBottom) / 2}" font-size="12" fill="#374151" ` +
      `text-anchor="middle" transform="rotate(-90 20 ${(plotTop + plotBottom) / 2})">Monthly pageviews</text>`,
  );

  // Plot frame and horizontal gridlines with y labels.
  parts.push(
    `<rect x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" ` +
      `fill="none" stroke="#d1d5db" stroke-width="1"/>`,
  );
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i += 1) {
    const value = yMin + ((yMax - yMin) * i) / yTicks;
    const y = sy(value);
    parts.push(
      `<line x1="${plotLeft}" y1="${y.toFixed(1)}" x2="${plotRight}" y2="${y.toFixed(1)}" ` +
        `stroke="#eef1f4" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${plotLeft - 8}" y="${(y + 4).toFixed(1)}" font-size="11" fill="#4b5563" ` +
        `text-anchor="end">${Math.round(value)}</text>`,
    );
  }

  // X tick labels (rotated 45 degrees).
  const labelStep = monthly.length > 24 ? 2 : 1;
  months.forEach((month, index) => {
    if (index % labelStep !== 0) {
      return;
    }
    const x = sx(index);
    parts.push(
      `<line x1="${x.toFixed(1)}" y1="${plotBottom}" x2="${x.toFixed(1)}" y2="${plotBottom + 5}" ` +
        `stroke="#9ca3af" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${x.toFixed(1)}" y="${plotBottom + 10}" font-size="11" fill="#4b5563" ` +
        `text-anchor="end" transform="rotate(-45 ${x.toFixed(1)} ${plotBottom + 10})">${escapeXml(month)}</text>`,
    );
  });

  // Monthly line with markers.
  const points = views
    .map((value, index) => `${sx(index).toFixed(1)},${sy(value).toFixed(1)}`)
    .join(" ");
  parts.push(
    `<polyline points="${points}" fill="none" stroke="#2563eb" stroke-width="1.5" ` +
      `stroke-linejoin="round"/>`,
  );
  views.forEach((value, index) => {
    parts.push(
      `<circle cx="${sx(index).toFixed(1)}" cy="${sy(value).toFixed(1)}" r="2.5" fill="#2563eb"/>`,
    );
  });

  // Legend.
  const legendX = plotRight - 240;
  const legendY = 62;
  parts.push(
    `<line x1="${legendX}" y1="${legendY}" x2="${legendX + 22}" y2="${legendY}" ` +
      `stroke="#2563eb" stroke-width="1.5"/>`,
    `<circle cx="${legendX + 11}" cy="${legendY}" r="2.5" fill="#2563eb"/>`,
    `<text x="${legendX + 28}" y="${legendY + 4}" font-size="12" fill="#1f2933">Monthly pageviews</text>`,
  );

  parts.push("</svg>");
  return parts.join("\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2), [
    { name: "input", required: true },
    { name: "output" },
  ]);
  const input = args.input as string;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(readFileSync(input, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: could not read input file '${input}': ${reason}`);
    process.exit(1);
  }

  const monthly = (data.monthly as MonthlyPoint[]) ?? [];
  if (monthly.length === 0) {
    console.error("ERROR: input has no monthly data to plot.");
    process.exit(1);
  }

  const article = (data.article as string) ?? "";
  const lang = (data.language as string) ?? "";
  const requestedStart = (data.requestedStart as string) ?? "";
  const requestedEnd = (data.requestedEnd as string) ?? "";
  const dateRange =
    requestedStart && requestedEnd ? `${requestedStart} – ${requestedEnd}` : "";

  const slug = article ? slugify(article) : "";
  const nameParts = [lang, slug, requestedStart, requestedEnd].filter((part) => part);
  const defaultName = nameParts.length
    ? `chart_${nameParts.join("_")}.svg`
    : "chart.svg";
  const output =
    (args.output as string | undefined) ?? path.join(ensureResultDir(), defaultName);

  const svg = renderChart(monthly, article, lang, dateRange);
  writeFileSync(output, svg, "utf-8");

  console.log(`SAVED: ${output}`);
}

main();
