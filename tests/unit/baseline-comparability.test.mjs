import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("House baseline ledger exposes comparability fields", () => {
  const ledger = JSON.parse(readFileSync(new URL("../../data/staging/baselines/house-baseline-ledger-v2.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(ledger.rows));
  assert.ok(ledger.rows.length >= 400);
  const sample = ledger.rows[0];
  for (const key of ["district", "state", "mapVersion", "baselineSourceType", "translationMethod", "comparableFor2026", "effectiveWeight", "verificationStatus", "geometryHash"]) {
    assert.ok(Object.hasOwn(sample, key), `missing ${key}`);
  }
});
