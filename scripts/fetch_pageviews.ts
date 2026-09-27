#!/usr/bin/env node
/**
 * fetch_pageviews.ts -- fetch daily Wikipedia pageviews for one or more
 * articles (one per language) and aggregate them into monthly totals.
 *
 * Usage:
 *     node scripts/fetch_pageviews.ts --lang pl --article "Glodowka przerywana" \
 *         --start 2024-01-01 --end 2026-01-01
 *     node scripts/fetch_pageviews.ts --start 2024-01-01 --end 2026-01-01 \
 *         --lang pl --article "A" --lang cs --article "B"
 *
 * Output:
 *     Single request (unchanged): prints the JSON object to stdout and writes
 *     it to result/pageviews_<lang>_<slug>_<start>_<end>.json; the path is
 *     printed on the last stdout line as "SAVED: <path>".
 *     Multiple requests (run in parallel): prints
 *     {"results": [{..., "saved": "<path>"}, ...]}.
 *
 *     This script only fetches and aggregates data -- it does not judge
 *     whether a trend is real, significant, or noisy. That is done by
 *     analyze_series.ts (numbers) and the agent (words), not here.
 *
 * Dependencies: Node.js built-ins only (global fetch, fs).
 */

import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { pairByIndex, parseArgs, toStringList } from "../lib/args.ts";
import { fetchWithRetry } from "../lib/http.ts";
import { stringify } from "../lib/json.ts";
import { ensureResultDir } from "../lib/paths.ts";

const USER_AGENT = "wiki-interest-analyzer/0.1";
// Wikimedia Pageviews data starts here; earlier start dates are clamped.
const MIN_AVAILABLE_DATE = new Date(Date.UTC(2015, 6, 1));
const API_BASE = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article";
// Daily fetches can be large; 30s is generous but still bounds a hung request.
const TIMEOUT_SECONDS = 30;

class HttpStatusError extends Error {
  readonly code: number;
  readonly reason: string;

  constructor(code: number, reason: string) {
    super(`HTTP ${code}: ${reason}`);
    this.code = code;
    this.reason = reason;
  }
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/ /g, "_")
    .replace(/[^a-z0-9_-]/g, "");
  return slug || "article";
}

/** Percent-encode a string for use in a URL path, keeping `safe` chars literal. */
function percentEncode(text: string, safe: string): string {
  let out = "";
  for (const char of text) {
    if (/[A-Za-z0-9_.~-]/.test(char) || safe.includes(char)) {
      out += char;
    } else {
      for (const byte of new TextEncoder().encode(char)) {
        out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return out;
}

interface PageviewItem {
  timestamp: string;
  views?: number;
}

async function fetchDaily(
  lang: string,
  article: string,
  start: Date,
  end: Date,
): Promise<PageviewItem[]> {
  const project = `${lang}.wikipedia`;
  const articlePath = percentEncode(article.replace(/ /g, "_"), "_()");
  const startFmt = start.toISOString().slice(0, 10).replace(/-/g, "");
  const endFmt = end.toISOString().slice(0, 10).replace(/-/g, "");
  const url =
    `${API_BASE}/${project}/all-access/user/${articlePath}/daily/` +
    `${startFmt}/${endFmt}`;

  const response = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT },
    timeoutMs: TIMEOUT_SECONDS * 1000,
  });

  if (response.status === 404) {
    // No data for this exact article/period combination. This can mean the
    // title is wrong (redirect, typo, doesn't exist on this language edition)
    // or genuinely zero recorded views.
    return [];
  }
  if (!response.ok) {
    throw new HttpStatusError(response.status, response.statusText);
  }

  const payload = (await response.json()) as { items?: PageviewItem[] };
  return payload.items ?? [];
}

function aggregateMonthly(
  items: PageviewItem[],
): Array<{ month: string; views: number; days: number }> {
  const buckets = new Map<string, { month: string; views: number; days: number }>();
  for (const item of items) {
    const ts = item.timestamp; // e.g. "2024010100"
    const monthKey = `${ts.slice(0, 4)}-${ts.slice(4, 6)}`;
    let bucket = buckets.get(monthKey);
    if (!bucket) {
      bucket = { month: monthKey, views: 0, days: 0 };
      buckets.set(monthKey, bucket);
    }
    bucket.views += item.views ?? 0;
    bucket.days += 1;
  }
  return [...buckets.keys()].sort().map((key) => buckets.get(key)!);
}

interface FetchOutput {
  result: Record<string, unknown>;
  savedPath: string;
}

async function fetchOne(
  lang: string,
  article: string,
  requestedStart: Date,
  requestedEnd: Date,
  effectiveStart: Date,
): Promise<FetchOutput> {
  const warnings: string[] = [];
  if (requestedStart.getTime() < MIN_AVAILABLE_DATE.getTime()) {
    warnings.push(
      `Requested start ${isoDate(requestedStart)} is before Wikimedia Pageviews ` +
        `data availability (${isoDate(MIN_AVAILABLE_DATE)}); clamped to that date.`,
    );
  }

  const items = await fetchDaily(lang, article, effectiveStart, requestedEnd);

  if (items.length === 0) {
    warnings.push(
      `No pageviews data returned for '${article}' on ${lang}.wikipedia ` +
        `between ${isoDate(effectiveStart)} and ${isoDate(requestedEnd)}. The article ` +
        `may not exist under this exact title on this language edition, or genuinely ` +
        `has zero recorded views in this period.`,
    );
  }

  const monthly = aggregateMonthly(items);

  for (const warning of warnings) {
    console.error(`WARNING: ${warning}`);
  }

  const result = {
    language: lang,
    article,
    requestedStart: isoDate(requestedStart),
    requestedEnd: isoDate(requestedEnd),
    effectiveStart: isoDate(effectiveStart),
    effectiveEnd: isoDate(requestedEnd),
    monthly,
    warnings,
    fetchedAt: new Date().toISOString(),
  };

  const slug = slugify(article);
  const savedPath = path.join(
    ensureResultDir(),
    `pageviews_${lang}_${slug}_${isoDate(requestedStart)}_${isoDate(requestedEnd)}.json`,
  );
  writeFileSync(savedPath, stringify(result), "utf-8");

  return { result, savedPath };
}

function reportError(error: unknown): never {
  if (error instanceof HttpStatusError) {
    console.error(
      `ERROR: Wikimedia Pageviews API returned HTTP ${error.code}: ${error.reason}`,
    );
    process.exit(1);
  }
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: Wikimedia Pageviews API request failed: ${reason}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), [
    { name: "lang", required: true, repeatable: true },
    { name: "article", required: true, repeatable: true },
    { name: "start", required: true, type: "date" },
    { name: "end", required: true, type: "date" },
  ]);

  let pairs: Array<[string, string]>;
  try {
    pairs = pairByIndex(
      toStringList(args.lang),
      toStringList(args.article),
      ["--lang", "--article"],
    );
  } catch (error) {
    console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  const start = args.start as Date;
  const end = args.end as Date;

  let effectiveStart = start;
  if (effectiveStart.getTime() < MIN_AVAILABLE_DATE.getTime()) {
    effectiveStart = MIN_AVAILABLE_DATE;
  }
  if (effectiveStart.getTime() >= end.getTime()) {
    console.error(
      `ERROR: effective start date ${isoDate(effectiveStart)} is not before end date ${isoDate(end)}`,
    );
    process.exit(1);
  }

  try {
    if (pairs.length === 1) {
      const [lang, article] = pairs[0];
      const { result, savedPath } = await fetchOne(lang, article, start, end, effectiveStart);
      console.log(stringify(result));
      console.log(`SAVED: ${savedPath}`);
      return;
    }

    const outputs = await Promise.all(
      pairs.map(([lang, article]) => fetchOne(lang, article, start, end, effectiveStart)),
    );
    console.log(
      stringify({
        results: outputs.map(({ result, savedPath }) => ({ ...result, saved: savedPath })),
      }),
    );
  } catch (error) {
    reportError(error);
  }
}

await main();
