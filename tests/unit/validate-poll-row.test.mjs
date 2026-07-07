import test from "node:test";
import assert from "node:assert/strict";
import { validatePollRow, VALIDATION_STATUSES, QUARANTINE_REASONS } from "../../scripts/validate/validate-poll-row.mjs";

const BASE_ROW = {
  office: "senate",
  state: "MI",
  rowType: "INDIVIDUAL_GENERAL_ELECTION_POLL",
  sourceName: "Example Pollster",
  sourceUrl: "https://example.test/poll",
  pollster: "Example Pollster",
  endDate: "2026-05-01",
  candidates: [
    { name: "Democrat", party: "D", pct: 48 },
    { name: "Republican", party: "R", pct: 45 }
  ],
  margin: 3
};

test("valid general-election poll rows are model-usable", () => {
  const row = validatePollRow(BASE_ROW);
  assert.equal(row.validationStatus, VALIDATION_STATUSES.VALID);
  assert.equal(row.usedInModel, true);
});

test("generated forecast output rows are quarantined", () => {
  const row = validatePollRow({ ...BASE_ROW, sourceKind: "generated-forecast-output" });
  assert.equal(row.validationStatus, VALIDATION_STATUSES.QUARANTINED);
  assert.equal(row.usedInModel, false);
  assert.ok(row.rejectionReasons.includes(QUARANTINE_REASONS.GENERATED_FORECAST_OUTPUT));
});

test("impossible candidate percentages are rejected", () => {
  const row = validatePollRow({
    ...BASE_ROW,
    candidates: [
      { name: "Democrat", party: "D", pct: 324 },
      { name: "Republican", party: "R", pct: 330.11 }
    ],
    margin: -6
  });
  assert.equal(row.validationStatus, VALIDATION_STATUSES.QUARANTINED);
  assert.ok(row.rejectionReasons.includes(QUARANTINE_REASONS.IMPOSSIBLE_PERCENT));
});

test("average rows are diagnostic only when otherwise parseable", () => {
  const row = validatePollRow({ ...BASE_ROW, rowType: "AVERAGE_ROW" });
  assert.equal(row.validationStatus, VALIDATION_STATUSES.DIAGNOSTIC_ONLY);
  assert.equal(row.usedInModel, false);
});
