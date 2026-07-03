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
import {
  applyRatingGuardrail,
  applyRatingPrior,
  buildRatingPrior,
  normalizeRating,
  ratingSourceWeight,
  ratingToMargin
} from "./lib/rating-priors.mjs";
import {
  fundamentalsCacheEnvelope,
  mergedHouseRatingsCache,
  parseCookHouseRatings,
  readManualVoteHubRatings
} from "./lib/house-input-caches.mjs";
import { parseWikipediaPollingPage } from "./lib/wikipedia-polls.mjs";

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

assert.equal(normalizeRating("Solid Republican").normalized, "Safe R");
assert.equal(ratingToMargin("Lean Dem"), 5.5);
const thinHousePrior = buildRatingPrior({
  office: "house",
  raceId: "TX-28-2026",
  benchmark: { cook: { rating: "Lean D" } },
  rawModelMargin: -5,
  fundamentalsQuality: "WEAK"
});
assert.equal(thinHousePrior.enabled, true);
assert.ok(thinHousePrior.weight >= 0.45, "TX-28 override should materially constrain thin-input House races.");
assert.ok(applyRatingPrior(-5, thinHousePrior, 1) > -5, "Lean D prior should pull a raw R margin toward Democrats.");

const mapConflictPrior = buildRatingPrior({
  office: "house",
  raceId: "AL-02-2026",
  benchmark: { cook: { rating: "Likely R" } },
  rawModelMargin: 4,
  mapConflict: true
});
assert.equal(mapConflictPrior.enabled, false);
assert.equal(mapConflictPrior.usedAs, "COMPARISON_ONLY_MAP_CONFLICT");
assert.equal(applyRatingPrior(4, mapConflictPrior, 1), 4);

const polledSenatePrior = buildRatingPrior({
  office: "senate",
  raceId: "GA-SEN-2026",
  benchmark: { cook: { rating: "Toss-up" } },
  rawModelMargin: 3,
  pollingSummary: { pollCount: 4 }
});
assert.ok(polledSenatePrior.weight <= 0.1, "Multiple usable Senate polls should leave ratings as a light stabilizer.");

const formulaPrior = buildRatingPrior({
  office: "house",
  raceId: "UNIT-2026",
  benchmark: { cook: { rating: "Lean D" } },
  rawModelMargin: -4,
  fundamentalsQuality: "WEAK"
});
assert.equal(formulaPrior.crossRatingBoost > 0, true);
assert.equal(formulaPrior.guardrailEligible, true);
assert.ok(applyRatingPrior(-4, formulaPrior, 1) > 0, "Cross-party no-poll rating prior should pull the margin across zero.");

assert.equal(ratingSourceWeight("cook"), 1);
assert.equal(ratingSourceWeight("voteHub", "AGGREGATOR_TABLE"), 0.6);
assert.equal(ratingSourceWeight("aggregatorTable", "AGGREGATOR_TABLE"), 0.5);
assert.equal(readManualVoteHubRatings("unitmissing").status, "MANUAL_NOT_CONFIGURED");

const cookRows = parseCookHouseRatings(`
  <h3>Leans Dem (1)</h3>
  <div>TX-28</div>
  <h3>Toss-up (2)</h3>
  <div>AZ-01</div>
  <div>IA-03</div>
`);
assert.equal(cookRows.length, 3);
assert.equal(cookRows.find((row) => row.raceId === "TX-28-2026")?.rating, "Lean D");
assert.equal(cookRows.find((row) => row.raceId === "IA-03-2026")?.rating, "Toss-up");
assert.equal(parseCookHouseRatings("<html>No House table here</html>").length, 0);

const mergedHouse = mergedHouseRatingsCache({
  cookRows,
  baselines: [
    { district: "WY-AL", presidentialMargin2024: -46, houseMargin2024: -44, confidence: "MEDIUM", source: "SOURCE_BACKED", independent: true },
    { district: "TX-28", presidentialMargin2024: 7, houseMargin2024: 9, confidence: "MEDIUM", source: "SOURCE_BACKED", independent: true }
  ],
  asOf: "2026-07-02"
});
assert.equal(mergedHouse.rows.find((row) => row.raceId === "TX-28-2026")?.ratingSourceType, "EXTERNAL_RATING");
assert.equal(mergedHouse.rows.find((row) => row.raceId === "WY-AL-2026")?.ratingSourceType, "INFERRED_SAFE_RATING");

const sourceBackedEnvelope = fundamentalsCacheEnvelope([
  { district: "WY-AL", source: "SOURCE_BACKED", independent: true, presidentialMargin2024: -46, houseMargin2024: -44, confidence: "MEDIUM" }
], { asOf: "2026-07-02" });
assert.equal(sourceBackedEnvelope.rows[0].source, "SOURCE_BACKED");
assert.equal(sourceBackedEnvelope.meta.independentRows, 1);

const leanDGuardrailPrior = buildRatingPrior({
  office: "house",
  raceId: "UNIT-LEAN-D-2026",
  benchmark: { cook: { rating: "Lean D" } },
  rawModelMargin: -20,
  fundamentalsQuality: "LOW",
  pollingSummary: { pollCount: 0 },
  ratingSourceType: "EXTERNAL_RATING"
});
const leanDGuarded = applyRatingGuardrail(applyRatingPrior(-20, leanDGuardrailPrior, 1), leanDGuardrailPrior);
assert.equal(leanDGuarded.triggered, true);
assert.ok(leanDGuarded.margin > -3);

const tossupGuardrailPrior = buildRatingPrior({
  office: "house",
  raceId: "UNIT-TOSSUP-2026",
  benchmark: { cook: { rating: "Toss-up" } },
  rawModelMargin: 9,
  fundamentalsQuality: "LOW",
  pollingSummary: { pollCount: 0 },
  ratingSourceType: "EXTERNAL_RATING"
});
const tossupGuarded = applyRatingGuardrail(applyRatingPrior(9, tossupGuardrailPrior, 1), tossupGuardrailPrior);
assert.equal(tossupGuarded.triggered, true);
assert.ok(tossupGuarded.margin <= 2.99);

const inferredSafePrior = buildRatingPrior({
  office: "house",
  raceId: "WY-AL-2026",
  benchmark: { inferredSafeRating: { rating: "Safe R" } },
  rawModelMargin: -30,
  fundamentalsQuality: "MEDIUM",
  pollingSummary: { pollCount: 0 },
  ratingSourceType: "INFERRED_SAFE_RATING"
});
assert.ok(inferredSafePrior.weight <= 0.15, "Inferred safe ratings should remain lighter than external competitive-race ratings.");

const wikiPollParse = parseWikipediaPollingPage(`
  <h2>General election polling</h2>
  <table class="wikitable">
    <tr><th>Poll source</th><th>Date(s)</th><th>Sample size</th><th>Democrat</th><th>Republican</th><th>Margin</th></tr>
    <tr><td>Example Pollster</td><td>March 31 - April 1, 2026</td><td>987 LV</td><td>49%</td><td>44%</td><td>D+5</td></tr>
    <tr><td>Race to the WH</td><td>Average</td><td></td><td>50%</td><td>42%</td><td>D+8</td></tr>
  </table>
`, { office: "senate", state: "NC", raceId: "NC-SEN-2026", url: "https://example.test/wiki" });
assert.equal(wikiPollParse.rows.length, 1);
assert.equal(wikiPollParse.averages.length, 1);
assert.equal(wikiPollParse.rows[0].pollster, "Example Pollster");
assert.equal(wikiPollParse.rows[0].population, "LV");

console.log("Forecast infrastructure tests passed.");
