import assert from "node:assert/strict";
import { test } from "node:test";

import { pairByIndex, parseArgs, toStringList } from "../lib/args.ts";

const SPECS = [
  { name: "lang", required: true, repeatable: true },
  { name: "article", required: true, repeatable: true },
];

test("interleaved repeatable args preserve order and pair by index", () => {
  const args = parseArgs(
    ["--lang", "pl", "--article", "A", "--lang", "cs", "--article", "B"],
    SPECS,
  );
  const langs = toStringList(args.lang);
  const articles = toStringList(args.article);

  assert.deepEqual(langs, ["pl", "cs"]);
  assert.deepEqual(articles, ["A", "B"]);
  assert.deepEqual(pairByIndex(langs, articles), [
    ["pl", "A"],
    ["cs", "B"],
  ]);
});

test("grouped repeatable args preserve order and pair by index", () => {
  const args = parseArgs(
    ["--lang", "pl", "--lang", "cs", "--article", "A", "--article", "B"],
    SPECS,
  );
  const langs = toStringList(args.lang);
  const articles = toStringList(args.article);

  assert.deepEqual(pairByIndex(langs, articles), [
    ["pl", "A"],
    ["cs", "B"],
  ]);
});

test("single request stays a single pair", () => {
  const args = parseArgs(["--lang", "pl", "--article", "A"], SPECS);
  assert.deepEqual(toStringList(args.lang), ["pl"]);
  assert.deepEqual(pairByIndex(toStringList(args.lang), toStringList(args.article)), [
    ["pl", "A"],
  ]);
});

test("mismatched lang/article counts throw", () => {
  assert.throws(
    () => pairByIndex(["pl", "cs"], ["A"], ["--lang", "--article"]),
    /--lang count \(2\) does not match --article count \(1\)/,
  );
});
