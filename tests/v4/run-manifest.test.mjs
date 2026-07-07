import assert from "node:assert/strict";
import test from "node:test";
import { artifactRunProblems, readJson } from "../../scripts/v4/shared/v4-core.mjs";

test("v4 artifacts share the latest run manifest identity", () => {
  const manifest = readJson("data/v4/run-manifests/latest-run.json");
  assert.ok(manifest?.runId, "missing v4 run manifest");
  for (const key of Object.keys(manifest.artifacts)) {
    const artifact = readJson(manifest.artifacts[key]);
    assert.deepEqual(artifactRunProblems(manifest, artifact, manifest.artifacts[key]), []);
  }
});

test("run manifest checker rejects stale or mismatched sidecars", () => {
  const manifest = readJson("data/v4/run-manifests/latest-run.json");
  const artifact = readJson(manifest.artifacts.houseForecast);
  const mismatch = { ...artifact, runId: "wrong-run" };
  assert.ok(artifactRunProblems(manifest, mismatch, "fixture").some((problem) => problem.startsWith("RUN_ID_MISMATCH")));
  const stale = { ...artifact, generatedAt: "2000-01-01T00:00:00.000Z" };
  assert.ok(artifactRunProblems(manifest, stale, "fixture").some((problem) => problem.startsWith("STALE_SIDECAR")));
});
