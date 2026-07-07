import test from "node:test";
import assert from "node:assert/strict";
import { ratingToPriorInterval } from "../../scripts/ratings/build-ratings-priors.mjs";

test("ratings map to ordered Democratic margin intervals", () => {
  assert.deepEqual(ratingToPriorInterval("Safe D"), { party: "D", low: 14, center: 19, high: 30 });
  assert.deepEqual(ratingToPriorInterval("Toss-up"), { party: "T", low: -1.5, center: 0, high: 1.5 });
  assert.deepEqual(ratingToPriorInterval("Likely R"), { party: "R", low: -14, center: -10, high: -7 });
});

test("unknown ratings do not silently create a prior", () => {
  assert.equal(ratingToPriorInterval("Unrated"), null);
});
