import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseGatesV4 } from "../../scripts/v4/build-release-gates-v4.mjs";
import { readJson } from "../../scripts/v4/shared/v4-core.mjs";

test("v4 release gates are strict and authoritative", () => {
  const manifest = readJson("data/v4/run-manifests/latest-run.json");
  const summary = evaluateReleaseGatesV4(manifest);
  assert.equal(summary.strictReleaseGates, true);
  assert.match(summary.publishStatus, /^(PASS|BLOCK_PUBLISH|INTERNAL_QA_ONLY)$/);
  assert.ok(Array.isArray(summary.blockingReasons));
});

test("blocked v4 output cannot look publish-ready in UI adapter", () => {
  const gate = readJson("data/v4/release-gates/release-gate-summary.json");
  const adapter = readJson("data/v4/ui/forecast-ui-adapter.json");
  assert.equal(adapter.publishStatus, gate.publishStatus);
  if (gate.publishStatus === "BLOCK_PUBLISH") assert.notEqual(adapter.publishStatus, "PASS");
});
