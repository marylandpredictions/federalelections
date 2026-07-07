import test from "node:test";
import assert from "node:assert/strict";
import { coreV2Metadata } from "../../scripts/lib/core-v2-provenance.mjs";

test("v1 metadata keeps margin fields informational", () => {
  const metadata = coreV2Metadata("senate");
  assert.equal(metadata.coreVersion, "v1");
  assert.equal(metadata.inputPipeline, "legacy");
});

test("margin type labels are explicit in v2 metadata when enabled", () => {
  const oldValue = process.env.FORECAST_CORE_V2;
  process.env.FORECAST_CORE_V2 = "1";
  try {
    const metadata = coreV2Metadata("senate");
    assert.equal(metadata.coreVersion, "v2");
    assert.match(metadata.structuredMargins.projectedResultMargin, /projected/i);
    assert.match(metadata.structuredMargins.probabilityMargin, /probability/i);
  } finally {
    if (oldValue === undefined) delete process.env.FORECAST_CORE_V2;
    else process.env.FORECAST_CORE_V2 = oldValue;
  }
});
