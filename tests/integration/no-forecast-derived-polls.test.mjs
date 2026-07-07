import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
}

test("upstream canonical poll ledger excludes forecast-derived rows", () => {
  const ledger = read("data/cache/polls/upstream-canonical-2026.json");
  assert.ok(Array.isArray(ledger.rows));
  assert.equal(ledger.rows.some((row) => row.sourceKind === "generated-forecast-output"), false);
});

test("legacy canonical poll ledger no longer includes forecast-derived rows after v2 rebuild", () => {
  const ledger = read("data/cache/polls/canonical-2026.json");
  assert.ok(Array.isArray(ledger.rows));
  assert.equal(ledger.rows.some((row) => row.sourceKind === "generated-forecast-output"), false);
});
