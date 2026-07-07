import assert from "node:assert/strict";
import test from "node:test";
import { readJson } from "../../scripts/v4/shared/v4-core.mjs";

test("house v4 marks unverified current-map baselines as context only", () => {
  const ledger = readJson("data/v4/house/current-map-baseline-ledger.json");
  assert.ok(ledger.counts.total > 0, "missing house baseline ledger rows");
  for (const row of ledger.rows) {
    if (!row.currentMapAnchorAvailable) {
      assert.equal(row.usedInModel, false);
      assert.equal(row.confidence, "LOW");
      assert.equal(row.historicalContextOnly, true);
    }
  }
});

test("house v4 mode is explicit when current-map anchors are unavailable", () => {
  const forecast = readJson("data/v4/house-forecast.json");
  assert.ok(forecast.houseMode, "missing explicit house mode");
  if ((forecast.currentMapBaselineCoverage?.verifiedCurrentMapAnchors || 0) === 0) {
    assert.equal(forecast.houseMode, "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES");
  }
});
