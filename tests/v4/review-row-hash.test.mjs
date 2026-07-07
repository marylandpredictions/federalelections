import assert from "node:assert/strict";
import test from "node:test";
import { readJson, validateReviewHashes } from "../../scripts/v4/shared/v4-core.mjs";

for (const [forecastPath, reviewPath] of [
  ["data/v4/house-forecast.json", "data/v4/diagnostics/house-review.json"],
  ["data/v4/senate-forecast.json", "data/v4/diagnostics/senate-review.json"],
  ["data/v4/governor-forecast.json", "data/v4/diagnostics/governor-review.json"]
]) {
  test(`${reviewPath} mirrors source forecast row hashes`, () => {
    const forecast = readJson(forecastPath);
    const review = readJson(reviewPath);
    assert.deepEqual(validateReviewHashes(forecast, review), []);
  });
}
