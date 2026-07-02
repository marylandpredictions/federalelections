import assert from "node:assert/strict";
import {
  SOURCE_HEALTH,
  markNoRows,
  markParseFailed,
  recordFetchError,
  recordFetch,
  sourceHealthSummary
} from "./forecast-source-health.mjs";
import { candidateMatchConfidence, dedupePollRows } from "./poll-ledger.mjs";
import { classifyPollingInputs } from "./forecast-polling-status.mjs";
import {
  buildInputBalance,
  cacheEnvelope,
  cacheFreshnessRecord,
  forecastInputCacheFreshness,
  marginSplit
} from "./forecast-cache.mjs";
import { loadFiftyPlusOnePolls } from "./fiftyplusone-polls.mjs";
import { parseUsPollingDataGeneric } from "./lib/generic-ballot.mjs";

function response(status, ok = status >= 200 && status < 300) {
  return { status, ok };
}

const status = {};
recordFetch(status, "forbidden", response(403), "blocked", "https://example.test/blocked", Date.now(), { expected: "json" });
assert.equal(status.forbidden.health, SOURCE_HEALTH.BLOCKED_403);

recordFetch(status, "missing", response(404), "missing", "https://example.test/missing", Date.now(), { expected: "csv" });
assert.equal(status.missing.health, SOURCE_HEALTH.NOT_FOUND_404);

recordFetch(status, "htmlInsteadOfJson", response(200), "<!doctype html><html></html>", "https://example.test/data", Date.now(), { expected: "json" });
assert.equal(status.htmlInsteadOfJson.health, SOURCE_HEALTH.HTML_FETCHED);

recordFetch(status, "emptyRows", response(200), "[]", "https://example.test/data", Date.now(), { expected: "json" });
markNoRows(status, "emptyRows");
assert.equal(status.emptyRows.health, SOURCE_HEALTH.OK_NO_ROWS);

recordFetch(status, "malformed", response(200), "{", "https://example.test/data", Date.now(), { expected: "json" });
markParseFailed(status, "malformed", new Error("Unexpected end of JSON input"));
assert.equal(status.malformed.health, SOURCE_HEALTH.PARSE_FAILED);

recordFetchError(status, "timedOut", new Error("request timed out"), "https://example.test/slow", Date.now());
assert.equal(status.timedOut.health, SOURCE_HEALTH.TIMEOUT);

const usPollingData = parseUsPollingDataGeneric("<table><tr><td>Democratic</td><td>48.1%</td></tr><tr><td>Republican</td><td>41.1%</td></tr></table>");
assert.equal(usPollingData.margin, 7);
assert.equal(usPollingData.status, SOURCE_HEALTH.OK_PARSED);

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

const cache = cacheEnvelope({
  source: "unit-test",
  office: "house",
  asOf: new Date().toISOString(),
  rows: [{ id: "TX-28" }]
});
assert.equal(cache.status, "OK_PARSED");
assert.equal(cache.rows.length, 1);
assert.equal(cacheFreshnessRecord("polls", cache, 14).status, "FRESH");
assert.equal(cacheFreshnessRecord("polls", null, 14).status, "MISSING");
const cacheFreshness = forecastInputCacheFreshness({ polls: "data/cache/__missing-test-file.json" });
assert.equal(cacheFreshness.inputCacheFreshness.racePolls.status, "MISSING");
assert.equal(cacheFreshness.staleInputWarnings[0].type, "STALE_INPUTS");

const split = marginSplit(42, 15, 18);
assert.equal(split.projectedResultMargin.display, "D+42.0");
assert.equal(split.probabilityMargin.display, "D+15.0");
assert.equal(split.ratingMargin.display, "D+18.0");

const balance = buildInputBalance({ fundamentals: 60, polling: 20, ratings: 0, finance: 5 });
assert.equal(balance.dominantInput, "fundamentals");
assert.equal(balance.shares.fundamentals, 0.706);

console.log("Forecast infrastructure tests passed.");
