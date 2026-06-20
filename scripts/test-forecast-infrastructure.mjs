import assert from "node:assert/strict";
import {
  SOURCE_HEALTH,
  markNoRows,
  markParseFailed,
  recordFetch,
  sourceHealthSummary
} from "./forecast-source-health.mjs";
import { candidateMatchConfidence, dedupePollRows } from "./poll-ledger.mjs";
import { classifyPollingInputs } from "./forecast-polling-status.mjs";
import { loadFiftyPlusOnePolls } from "./fiftyplusone-polls.mjs";

function response(status, ok = status >= 200 && status < 300) {
  return { status, ok };
}

const status = {};
recordFetch(status, "forbidden", response(403), "blocked", "https://example.test/blocked", Date.now(), { expected: "json" });
assert.equal(status.forbidden.health, SOURCE_HEALTH.BLOCKED_403);

recordFetch(status, "missing", response(404), "missing", "https://example.test/missing", Date.now(), { expected: "csv" });
assert.equal(status.missing.health, SOURCE_HEALTH.NOT_FOUND_404);

recordFetch(status, "htmlInsteadOfJson", response(200), "<!doctype html><html></html>", "https://example.test/data", Date.now(), { expected: "json" });
assert.equal(status.htmlInsteadOfJson.health, SOURCE_HEALTH.HTML_ONLY);

recordFetch(status, "emptyRows", response(200), "[]", "https://example.test/data", Date.now(), { expected: "json" });
markNoRows(status, "emptyRows");
assert.equal(status.emptyRows.health, SOURCE_HEALTH.OK_NO_ROWS);

recordFetch(status, "malformed", response(200), "{", "https://example.test/data", Date.now(), { expected: "json" });
markParseFailed(status, "malformed", new Error("Unexpected end of JSON input"));
assert.equal(status.malformed.health, SOURCE_HEALTH.PARSE_FAILED);

assert.equal(candidateMatchConfidence({ name: "Susan Collins", party: "R" }, "Susan Collins", "R"), "EXACT");
assert.equal(candidateMatchConfidence({ name: "Collins", party: "R" }, "Susan Collins", "R"), "ALIAS");
assert.equal(candidateMatchConfidence({ name: "Republican", party: "R" }, "", "R"), "PARTY_GENERIC");
assert.equal(candidateMatchConfidence({ name: "Other Candidate", party: "R" }, "Susan Collins", "R"), "LOW_CONFIDENCE");

const deduped = dedupePollRows([
  { pollster: "Example", endDate: "2026-06-10", sampleSize: 800, candidates: [{ party: "D", name: "A" }, { party: "R", name: "B" }] },
  { pollster: "Example", endDate: "2026-06-10", sampleSize: 800, candidates: [{ party: "D", name: "A" }, { party: "R", name: "B" }] }
]);
assert.equal(deduped.length, 1);

const legacyOnly = classifyPollingInputs([{ margin: 2, source: "Legacy model input", legacy: true }]);
assert.equal(legacyOnly.pollingStatus, "LEGACY_FALLBACK_ONLY");
assert.equal(legacyOnly.pollCount, 0);
assert.equal(legacyOnly.legacyFallbackPollCount, 1);

const mixed = classifyPollingInputs([
  { margin: 2, source: "VoteHub" },
  { margin: 1, source: "Manual direct-poll ledger", manual: true }
]);
assert.equal(mixed.pollingStatus, "LIVE_AND_MANUAL_POLLS_AVAILABLE");
assert.equal(mixed.pollCount, 2);

const priorFifty = process.env.FIFTYPLUSONE_PATH;
delete process.env.FIFTYPLUSONE_PATH;
const fiftyStatus = {};
assert.equal(loadFiftyPlusOnePolls("senate", fiftyStatus).usedPolls, 0);
assert.equal(fiftyStatus.fiftyPlusOneSenate.health, SOURCE_HEALTH.DISABLED);
if (priorFifty) process.env.FIFTYPLUSONE_PATH = priorFifty;

const health = sourceHealthSummary(status, { critical: ["forbidden"] });
assert.equal(health.degraded, true);
assert.ok(health.criticalFailures.includes("forbidden"));

console.log("Forecast infrastructure tests passed.");
