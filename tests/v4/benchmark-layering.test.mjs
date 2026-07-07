import assert from "node:assert/strict";
import test from "node:test";
import { readJson } from "../../scripts/v4/shared/v4-core.mjs";

test("v4 benchmarks keep quantitative, ratings, market, and manual layers separate", () => {
  const summary = readJson("data/v4/benchmarks/benchmark-summary.json");
  assert.equal(summary.blendPolicy, "DO_NOT_BLEND_LAYERS");
  assert.deepEqual(summary.layers, ["publicQuantitative", "expertRatings", "predictionMarkets", "manualLocal"]);
  for (const path of Object.values(summary.artifacts)) {
    const artifact = readJson(path);
    assert.equal(artifact.schemaVersion, "v4");
  }
});

test("missing benchmark data is explicit instead of stale fallback", () => {
  const summary = readJson("data/v4/benchmarks/benchmark-summary.json");
  assert.ok(Object.values(summary.chamberStatus).includes("BENCHMARK_UNAVAILABLE"));
});
