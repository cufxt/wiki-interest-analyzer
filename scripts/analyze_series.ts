#!/usr/bin/env node
/**
 * analyze_series.ts -- compute deterministic trend metrics from a monthly
 * pageviews series produced by fetch_pageviews.ts.
 *
 * Usage:
 *     node scripts/analyze_series.ts --input pageviews_pl_....json
 *
 * Output:
 *     Prints the input JSON with an added "metrics" object, and writes it
 *     to a file named analysis_<same suffix>.json in the project's result/
 *     directory. Path printed as "SAVED: <path>".
 *
 * This script only computes numbers (direction, percent change,
 * descriptive stats). It does NOT decide whether a trend is "significant"
 * or "trustworthy" in words -- that judgment belongs to the agent using
 * this skill (see SKILL.md, Step 7), based on these numbers.
 */

import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { parseArgs } from "../lib/args.ts";
import { FloatValue, floatValue, stringify } from "../lib/json.ts";
import { ensureResultDir } from "../lib/paths.ts";

const FLAT_THRESHOLD_PERCENT = 5.0; // |percentChange| below this counts as "flat"

interface MonthlyPoint {
  month: string;
  views: number;
  days?: number;
}

/** Round to the nearest value, breaking ties toward the even neighbour. */
function roundHalfToEven(value: number, digits = 0): number {
  const factor = 10 ** digits;
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) {
    return value;
  }
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (diff > 0.5) {
    rounded = floor + 1;
  } else if (diff < 0.5) {
    rounded = floor;
  } else {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  }
  return rounded / factor;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Arithmetic mean that preserves an integer result when the data are integers
 * and the average is exact; otherwise it returns a float. This keeps the
 * serialized output clean (e.g. `150` vs `285.1`).
 */
function meanValue(values: number[]): number | FloatValue {
  const total = values.reduce((sum, value) => sum + value, 0);
  const allInts = values.every((value) => Number.isInteger(value));
  if (allInts && total % values.length === 0) {
    return total / values.length;
  }
  return floatValue(total / values.length);
}

/** Round while preserving whether the input was an integer or a float. */
function roundValue(value: number | FloatValue, digits: number): number | FloatValue {
  if (value instanceof FloatValue) {
    return floatValue(roundHalfToEven(value.value, digits));
  }
  return roundHalfToEven(value, digits);
}

/**
 * Least-squares slope of `ys` against calendar month indices `xs`.
 *
 * Using the real month index (not the observation index) keeps the slope "per
 * month" even when some months are missing. It is only one input signal
 * (slopePerMonth) -- not the sole basis for the direction verdict, since a
 * short/noisy series can produce a misleadingly confident slope.
 */
function linearRegressionSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) {
    return 0.0;
  }
  const meanX = mean(xs);
  const meanY = mean(ys);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (xs[i] - meanX) * (ys[i] - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  return denominator ? numerator / denominator : 0.0;
}

/** Calendar month index of a "YYYY-MM…" string, or NaN if it is not a valid month. */
function monthIndexOf(month: string): number {
  const match = /^(\d{4})-(\d{2})/.exec(month);
  if (!match) {
    return NaN;
  }
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    return NaN;
  }
  return year * 12 + (monthNumber - 1);
}

function monthKey(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** How many months the requested window spans vs how many have data. */
function coverage(
  monthly: MonthlyPoint[],
  start?: string,
  end?: string,
): { expectedMonths: number; observedMonths: number; missingMonths: string[] } {
  const observed = new Set(monthly.map((point) => point.month.slice(0, 7)));

  let startIndex: number | null = null;
  let endIndex: number | null = null;
  if (start && end) {
    const startParsed = monthIndexOf(start);
    const endParsed = monthIndexOf(end);
    if (Number.isFinite(startParsed) && Number.isFinite(endParsed)) {
      startIndex = startParsed;
      endIndex = endParsed;
    }
  }
  if (startIndex === null && monthly.length > 0) {
    startIndex = monthIndexOf(monthly[0].month);
    endIndex = monthIndexOf(monthly[monthly.length - 1].month);
  }

  if (
    startIndex === null ||
    endIndex === null ||
    !Number.isFinite(startIndex) ||
    !Number.isFinite(endIndex) ||
    endIndex < startIndex
  ) {
    return { expectedMonths: observed.size, observedMonths: observed.size, missingMonths: [] };
  }

  const missingMonths: string[] = [];
  for (let index = startIndex; index <= endIndex; index += 1) {
    const key = monthKey(index);
    if (!observed.has(key)) {
      missingMonths.push(key);
    }
  }
  return {
    expectedMonths: endIndex - startIndex + 1,
    observedMonths: observed.size,
    missingMonths,
  };
}

function computeMetrics(monthly: MonthlyPoint[], start?: string, end?: string): Record<string, unknown> {
  const cov = coverage(monthly, start, end);
  if (monthly.length < 2) {
    const single = monthly.length ? monthly[0].views : 0;
    return {
      direction: "flat",
      percentChange: floatValue(0.0),
      mean: single,
      min: single,
      max: single,
      slopePerMonth: floatValue(0.0),
      ...cov,
      note: "Not enough monthly data points to assess a trend (need at least 2 months).",
    };
  }

  const views = monthly.map((m) => m.views);
  const first = views[0];
  const last = views[views.length - 1];
  let percentChange: number;
  if (first) {
    percentChange = ((last - first) / first) * 100;
  } else {
    percentChange = last ? 100.0 : 0.0;
  }

  const roundedPercent = roundHalfToEven(percentChange, 1);

  let direction: string;
  if (Math.abs(roundedPercent) < FLAT_THRESHOLD_PERCENT) {
    direction = "flat";
  } else if (roundedPercent > 0) {
    direction = "up";
  } else {
    direction = "down";
  }

  const monthIndices = monthly.map((point) => monthIndexOf(point.month));

  return {
    direction,
    percentChange: floatValue(roundedPercent),
    mean: roundValue(meanValue(views), 1),
    min: Math.min(...views),
    max: Math.max(...views),
    slopePerMonth: floatValue(roundHalfToEven(linearRegressionSlope(monthIndices, views), 2)),
    ...cov,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2), [
    { name: "input", required: true },
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

  if (!Array.isArray(data.monthly) || data.monthly.length === 0) {
    console.error("ERROR: input has no monthly data to analyze.");
    process.exit(1);
  }
  const monthly = (data.monthly as unknown[]).map((point, index) => {
    const entry = point as MonthlyPoint;
    if (
      typeof point !== "object" ||
      point === null ||
      typeof entry.month !== "string" ||
      !Number.isFinite(monthIndexOf(entry.month)) ||
      typeof entry.views !== "number" ||
      !Number.isFinite(entry.views)
    ) {
      console.error(
        `ERROR: input monthly[${index}] must have a valid "month" (YYYY-MM) and a finite numeric "views".`,
      );
      process.exit(1);
    }
    return entry;
  });
  monthly.sort((a, b) => monthIndexOf(a.month) - monthIndexOf(b.month));

  for (const key of ["requestedStart", "requestedEnd"] as const) {
    const value = data[key];
    if (value !== undefined && !Number.isFinite(monthIndexOf(String(value)))) {
      console.error(`ERROR: input "${key}" must be a valid month string (YYYY-MM or YYYY-MM-DD).`);
      process.exit(1);
    }
  }

  data.metrics = computeMetrics(
    monthly,
    data.requestedStart as string | undefined,
    data.requestedEnd as string | undefined,
  );

  const basename = path.basename(input);
  const outBasename = basename.startsWith("pageviews_")
    ? "analysis_" + basename.slice("pageviews_".length)
    : "analysis_" + basename;
  const outPath = path.join(ensureResultDir(), outBasename);

  writeFileSync(outPath, stringify(data), "utf-8");

  console.log(stringify(data));
  console.log(`SAVED: ${outPath}`);
}

main();
