import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), "utf8"));
const senate = read("forecast.json");
const house = read("house-forecast.json");
const governor = read("governor-forecast.json");

const genericMargin = (forecast) => Number(forecast.canonicalGenericBallot?.margin ?? forecast.sourceSummary?.genericPolling?.genericBallotMargin);
const senateGeneric = genericMargin(senate);
const houseGeneric = genericMargin(house);
const governorGeneric = genericMargin(governor);
assert.ok(Number.isFinite(senateGeneric), "Senate must expose a canonical generic-ballot margin.");
assert.ok(Number.isFinite(houseGeneric), "House must expose a canonical generic-ballot margin.");
assert.ok(Number.isFinite(governorGeneric), "Governor must expose a canonical generic-ballot margin.");
assert.ok(Math.abs(senateGeneric - houseGeneric) <= .3, "House raw generic ballot must match Senate's canonical margin.");
assert.ok(Math.abs(senateGeneric - governorGeneric) <= .3, "Governor raw generic ballot must match Senate's canonical margin.");

const allHousePollingFailed = house.districts.length && house.districts.every((district) => district.pollingStatus === "SOURCE_FAILURE");
if (allHousePollingFailed) {
  assert.notEqual(house.forecastStatus, "NORMAL", "House forecast cannot be NORMAL when every district polling source failed.");
  assert.notEqual(house.sourceHealth?.health, "HEALTHY", "House source health cannot be HEALTHY when every district polling source failed.");
}

const governorUsablePollRaces = governor.races.filter((race) => race.usablePollCount > 0).length;
if (governorUsablePollRaces <= 1) {
  assert.notEqual(governor.forecastStatus, "NORMAL", "Governor forecast cannot be NORMAL with one or fewer usable race polls.");
  assert.notEqual(governor.sourceHealth?.health, "HEALTHY", "Governor source health cannot be HEALTHY with one or fewer usable race polls.");
}

for (const race of governor.races) {
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
  if (Math.abs(district.previousResult?.congressionalMargin || 0) > 70) assert.equal(district.previousResultComparable, false, `${district.id}: uncontested margin must not be comparable.`);
  assert.notEqual(district.presidentialMargin, 0, `${district.id}: missing presidential baseline must be null, not zero.`);
  assert.notEqual(district.congressionalMargin, 0, `${district.id}: missing congressional baseline must be null, not zero.`);
  assert.ok(district.confidence?.winConfidence && district.confidence?.marginConfidence && district.confidence?.dataConfidence, `${district.id}: split confidence fields are required.`);
}

assert.ok(senate.forecastStatus, "Senate must expose top-level forecast status.");
for (const race of senate.races) {
  assert.ok(race.confidence?.winConfidence && race.confidence?.marginConfidence && race.confidence?.dataConfidence, `${race.state}: split confidence fields are required.`);
}
console.log("Forecast reliability validation passed.");
