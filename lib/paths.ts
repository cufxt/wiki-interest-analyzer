/**
 * Path helpers for the skill scripts.
 *
 * All generated artifacts (pageviews/analysis JSON, chart SVG) are written to
 * a `result/` directory at the project root, independent of the process's
 * current working directory, so that repeated runs never litter the repo root.
 */

import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(moduleDir, "..");

export const RESULT_DIR = path.join(PROJECT_ROOT, "result");

/** Create the result directory if needed and return its absolute path. */
export function ensureResultDir(): string {
  mkdirSync(RESULT_DIR, { recursive: true });
  return RESULT_DIR;
}