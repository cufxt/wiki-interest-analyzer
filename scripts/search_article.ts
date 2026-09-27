#!/usr/bin/env node
/**
 * search_article.ts -- search one or more Wikipedia language editions for
 * candidate articles matching a free-text topic/query.
 *
 * Usage:
 *     node scripts/search_article.ts --lang pl --query "intermittent fasting" --limit 10
 *     node scripts/search_article.ts --lang pl --lang cs --query "..." --limit 10
 *
 * Output:
 *     Single language (unchanged):
 *         {"query": ..., "lang": ..., "candidates": [{key, title, description, excerpt}, ...]}
 *     Multiple languages (searches run in parallel):
 *         {"query": ..., "results": [{"lang": ..., "candidates": [...]}, ...]}
 *
 *     This script does NOT decide which candidate is relevant to the user's
 *     topic -- that judgment call belongs to the agent using this skill
 *     (see SKILL.md, Step 3).
 *
 * Dependencies: Node.js built-ins only (global fetch).
 */

import { parseArgs, toStringList } from "../lib/args.ts";
import { fetchWithRetry } from "../lib/http.ts";
import { stringify } from "../lib/json.ts";

const USER_AGENT = "wiki-interest-analyzer/0.1";
// Wikimedia requests normally return well within this; the cap only prevents a
// hung request from stalling the whole run.
const TIMEOUT_SECONDS = 30;

class HttpError extends Error {
  readonly code: number;
  readonly reason: string;

  constructor(code: number, reason: string) {
    super(`HTTP ${code}: ${reason}`);
    this.code = code;
    this.reason = reason;
  }
}

function stripHtml(text: string): string {
  return (text ?? "").replace(/<[^>]+>/g, "");
}

interface Candidate {
  key: unknown;
  title: unknown;
  description: unknown;
  excerpt: string;
  url: string | null;
}

/** Build the article URL deterministically from the language and page key. */
function articleUrl(lang: string, key: unknown): string | null {
  if (typeof key !== "string" || key.length === 0) {
    return null;
  }
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(key)}`;
}

async function search(lang: string, query: string, limit: number): Promise<Candidate[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const url = `https://${lang}.wikipedia.org/w/rest.php/v1/search/page?${params.toString()}`;

  const response = await fetchWithRetry(url, {
    headers: { "User-Agent": USER_AGENT },
    timeoutMs: TIMEOUT_SECONDS * 1000,
  });
  if (!response.ok) {
    throw new HttpError(response.status, response.statusText);
  }
  const payload = (await response.json()) as { pages?: Record<string, unknown>[] };
  const pages = payload.pages ?? [];
  return pages.map((p) => {
    const key = p.key ?? null;
    return {
      key,
      title: p.title ?? null,
      description: p.description ?? null,
      excerpt: stripHtml((p.excerpt as string) ?? ""),
      url: articleUrl(lang, key),
    };
  });
}

function reportError(error: unknown): never {
  if (error instanceof HttpError) {
    console.error(
      `ERROR: Wikipedia Search API returned HTTP ${error.code}: ${error.reason}`,
    );
    process.exit(1);
  }
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`ERROR: Wikipedia Search API request failed: ${reason}`);
  process.exit(1);
}

function reportEmpty(query: string, lang: string): void {
  console.error(`NOTE: no candidates found for '${query}' on ${lang}.wikipedia.org`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), [
    { name: "lang", required: true, repeatable: true },
    { name: "query", required: true },
    { name: "limit", type: "int", default: "10" },
  ]);

  const langs = toStringList(args.lang);
  const query = args.query as string;
  const limit = args.limit as number;

  try {
    if (langs.length === 1) {
      const lang = langs[0];
      const candidates = await search(lang, query, limit);
      console.log(stringify({ query, lang, candidates }));
      if (candidates.length === 0) {
        reportEmpty(query, lang);
      }
      return;
    }

    const results = await Promise.all(
      langs.map(async (lang) => ({
        lang,
        candidates: await search(lang, query, limit),
      })),
    );
    console.log(stringify({ query, results }));
    for (const result of results) {
      if (result.candidates.length === 0) {
        reportEmpty(query, result.lang);
      }
    }
  } catch (error) {
    reportError(error);
  }
}

await main();
