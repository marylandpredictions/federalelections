import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("House baseline v2 ledger reports verified coverage numerically", () => {
  const ledger = JSON.parse(readFileSync(new URL("../../data/staging/baselines/house-baseline-ledger-v2.json", import.meta.url), "utf8"));
  assert.ok(Number.isFinite(ledger.counts.total));
  assert.ok(Number.isFinite(ledger.counts.effectiveFor2026));
  assert.ok(ledger.counts.total >= 400);
});
