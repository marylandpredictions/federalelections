import assert from "node:assert/strict";
import test from "node:test";
import { canonicalToplineProblems, readJson } from "../../scripts/v4/shared/v4-core.mjs";

function assertCanonicalTopline(path) {
  const artifact = readJson(path);
  assert.equal(artifact.schemaVersion, "v4");
  assert.deepEqual(canonicalToplineProblems(artifact), []);
  assert.deepEqual(Object.keys(artifact.topline).sort(), ["controlProbability", "expectedSeatsOrWins", "medianSeatsOrWins"].sort());
}

test("v4 chamber forecasts expose exactly the canonical top-line contract", () => {
  assertCanonicalTopline("data/v4/house-forecast.json");
  assertCanonicalTopline("data/v4/senate-forecast.json");
  assertCanonicalTopline("data/v4/governor-forecast.json");
});

test("schema contract rejects missing canonical top-line and duplicate legacy aliases", () => {
  assert.ok(canonicalToplineProblems({}).includes("MISSING_CANONICAL_TOPLINE"));
  const bad = {
    topline: {
      controlProbability: { D: 0.5, R: 0.5, other: 0 },
      expectedSeatsOrWins: { D: 1, R: 1, other: 0 },
      medianSeatsOrWins: { D: 1, R: 1, other: 0 }
    },
    demControlProbability: 0.5
  };
  assert.ok(canonicalToplineProblems(bad).some((problem) => problem.includes("LEGACY_FIELD_READ")));
});
