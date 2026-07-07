import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("release gate diagnostics expose required stabilization metrics", () => {
  const gates = JSON.parse(readFileSync(new URL("../../data/diagnostics/release-gates-2026.json", import.meta.url), "utf8"));
  assert.ok(["PASS", "FAIL"].includes(gates.status));
  assert.ok(gates.upstreamPollCounts);
  assert.ok(Number.isFinite(gates.houseVerifiedCurrentMapBaselineCoverage));
  assert.ok(gates.benchmarkDivergenceSummary);
  assert.ok(Array.isArray(gates.manualReviewTop15));
});
