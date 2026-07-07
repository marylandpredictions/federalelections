import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
const senate = read("forecast.json");
const house = read("house-forecast.json");
const governor = read("governor-forecast.json");

function assertCacheMetadata(name, forecast) {
  assert.ok(forecast.inputCacheFreshness && typeof forecast.inputCacheFreshness === "object", `${name} must publish input cache freshness.`);
  for (const key of ["genericBallot", "racePolls", "ratings", "fundamentals", "finance"]) {
    assert.ok(forecast.inputCacheFreshness[key], `${name} must publish ${key} cache freshness.`);
    assert.ok(["FRESH", "STALE", "MISSING"].includes(forecast.inputCacheFreshness[key].status), `${name} ${key} cache freshness must be typed.`);
  }
  assert.ok(Array.isArray(forecast.staleInputWarnings), `${name} must publish stale input warnings.`);
  assert.ok("oldestCriticalInput" in forecast, `${name} must publish oldestCriticalInput.`);
}

function assertMarginContract(label, item) {
  assert.ok(item.projectedResultMargin && typeof item.projectedResultMargin === "object", `${label}: projectedResultMargin is required.`);
  assert.ok(item.probabilityMargin && typeof item.probabilityMargin === "object", `${label}: probabilityMargin is required.`);
  assert.ok(item.ratingMargin && typeof item.ratingMargin === "object", `${label}: ratingMargin is required.`);
  assert.ok(["D", "R", null].includes(item.projectedResultMargin.party), `${label}: projected result margin party must be typed.`);
  assert.ok(typeof item.projectedResultMargin.display === "string", `${label}: projected result margin display is required.`);
  assert.ok(item.inputBalance?.shares && typeof item.inputBalance.shares === "object", `${label}: input balance shares are required.`);
  assert.ok(item.inputBalance.dominantInput, `${label}: dominant input is required.`);
  assert.ok(item.ratingsPrior && typeof item.ratingsPrior === "object", `${label}: ratings prior metadata is required.`);
  assert.ok("enabled" in item.ratingsPrior, `${label}: ratings prior must state whether it was applied.`);
  assert.ok("weight" in item.ratingsPrior, `${label}: ratings prior must publish its weight.`);
  if (item.ratingsPrior.enabled) {
    assert.ok(item.ratingsPrior.ratingsPriorDistribution, `${label}: enabled ratings prior must publish distribution metadata.`);
  }
  if (Number.isFinite(item.projectedResultMargin.value)) {
    assert.equal(Number(item.projectedResultMargin.value), Number((item.projectedMargin ?? item.margin).toFixed?.(2) ?? item.projectedResultMargin.value), `${label}: projectedResultMargin value must match the public projected margin.`);
  }
}

function assertNoHardRatingGuardrail(label, item) {
  const reasons = [
    item.ratingGuardrail?.projected?.reason,
    item.ratingGuardrail?.probability?.reason,
    item.marginDecomposition?.ratingGuardrailReason
  ].filter(Boolean);
  for (const reason of reasons) {
    assert.ok(!/CANNOT|FLOOR|MAX/i.test(reason), `${label}: stale hard rating guardrail reason is still present.`);
  }
  const modes = [
    item.ratingGuardrail?.projected?.guardrailMode,
    item.ratingGuardrail?.probability?.guardrailMode,
    item.ratingGuardrail?.projected?.mode,
    item.ratingGuardrail?.probability?.mode
  ].filter(Boolean);
  for (const mode of modes) {
    assert.ok(
      ["soft-penalty", "prior-dominant", "hard-stop"].includes(mode),
      `${label}: rating guardrail must use the redesigned guardrail modes.`
    );
  }
}

const genericMargin = (forecast) => Number(forecast.canonicalGenericBallot?.margin ?? forecast.sourceSummary?.genericPolling?.genericBallotMargin);
const senateGeneric = genericMargin(senate);
const houseGeneric = genericMargin(house);
const governorGeneric = genericMargin(governor);
assert.ok(Number.isFinite(senateGeneric), "Senate must expose a canonical generic-ballot margin.");
assert.ok(Number.isFinite(houseGeneric), "House must expose a canonical generic-ballot margin.");
assert.ok(Number.isFinite(governorGeneric), "Governor must expose a canonical generic-ballot margin.");
assert.ok(Math.abs(senateGeneric - houseGeneric) <= .3, "House raw generic ballot must match Senate's canonical margin.");
assert.ok(Math.abs(senateGeneric - governorGeneric) <= .3, "Governor raw generic ballot must match Senate's canonical margin.");

for (const [name, forecast] of [["Senate", senate], ["House", house], ["Governor", governor]]) {
  assert.ok(["ONLINE", "PARTIAL_NETWORK", "OFFLINE"].includes(forecast.generationMode), `${name} must publish a generation mode.`);
  assert.ok(forecast.networkStatus && typeof forecast.networkStatus.attempted === "boolean", `${name} must publish network status.`);
  assertCacheMetadata(name, forecast);
}

const allHousePollingFailed = house.districts.length && house.districts.every((district) => district.pollingStatus === "SOURCE_FAILURE");
const noHouseUsablePolling = (house.racePollCoverage?.usablePollDistricts || 0) === 0;
if (allHousePollingFailed || noHouseUsablePolling) {
  assert.notEqual(house.forecastStatus, "NORMAL", "House forecast cannot be NORMAL when every district polling source failed.");
  assert.notEqual(house.sourceHealth?.health, "HEALTHY", "House source health cannot be HEALTHY without usable district polling.");
}

const governorUsablePollRaces = governor.races.filter((race) => race.usablePollCount > 0).length;
if (governorUsablePollRaces <= 1) {
  assert.notEqual(governor.forecastStatus, "NORMAL", "Governor forecast cannot be NORMAL with one or fewer usable race polls.");
  assert.notEqual(governor.sourceHealth?.health, "HEALTHY", "Governor source health cannot be HEALTHY with one or fewer usable race polls.");
}

for (const race of governor.races) {
  assertMarginContract(`Governor ${race.state}`, race);
  assert.equal(race.benchmarkComparison?.usablePolls || 0, race.usablePollCount || 0, `${race.state}: benchmark usable polls must match race usable polls.`);
  if (!race.usablePollCount) {
    assert.ok(!/usable governor polling available/i.test(race.marginDecomposition?.guardrailReason || ""), `${race.state}: guardrail cannot claim usable governor polling.`);
  }
  assert.equal(typeof race.sourceInputs?.pollMargin, "object", `${race.state}: pollMargin must be typed metadata.`);
  assert.equal(Boolean(race.sourceInputs?.pollMargin?.usableAsGeneralElectionPoll), Boolean(race.usablePollCount), `${race.state}: poll margin eligibility must match usable polling.`);
  assert.ok(race.confidence?.winConfidence && race.confidence?.marginConfidence && race.confidence?.dataConfidence, `${race.state}: split confidence fields are required.`);
}

assert.ok(house.benchmarkComparison?.status === "CONFIGURED" || house.benchmarkComparison?.status === "NOT_CONFIGURED", "House must expose a topline benchmark status.");
const al02 = house.districts.find((district) => district.id === "AL-02");
if (al02) {
  assert.equal(al02.redistrictingConfidence, "CONFLICTING_SOURCES", "AL-02 must expose its redistricting conflict.");
  assert.equal(al02.rating, "Map Conflict", "AL-02 must not publish a normal rating under a map conflict.");
  assert.equal(al02.forecastStatus, "SCENARIO_ONLY", "AL-02 must be scenario-only under a map conflict.");
}
for (const district of house.districts) {
  assertMarginContract(`House ${district.id}`, district);
  assertNoHardRatingGuardrail(`House ${district.id}`, district);
  if (Math.abs(district.previousResult?.congressionalMargin || 0) > 70) assert.equal(district.previousResultComparable, false, `${district.id}: uncontested margin must not be comparable.`);
  assert.notEqual(district.presidentialMargin, 0, `${district.id}: missing presidential baseline must be null, not zero.`);
  assert.notEqual(district.congressionalMargin, 0, `${district.id}: missing congressional baseline must be null, not zero.`);
  assert.ok(district.confidence?.winConfidence && district.confidence?.marginConfidence && district.confidence?.dataConfidence, `${district.id}: split confidence fields are required.`);
  assert.ok(
    !district.ratingsPrior?.sources?.some((source) => /cached prior house forecast/i.test(source)),
    `${district.id}: generated/cached House ratings cannot be reused as expert-rating priors.`
  );
}

assert.ok(senate.forecastStatus, "Senate must expose top-level forecast status.");
for (const race of senate.races) {
  assertMarginContract(`Senate ${race.state}`, race);
  assert.ok(race.confidence?.winConfidence && race.confidence?.marginConfidence && race.confidence?.dataConfidence, `${race.state}: split confidence fields are required.`);
}
console.log("Forecast reliability validation passed.");
