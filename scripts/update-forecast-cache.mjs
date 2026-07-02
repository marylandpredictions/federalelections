import { readFileSync } from "node:fs";
import { cacheEnvelope, writeCacheFile } from "./forecast-cache.mjs";
import { readCachedGenericBallot } from "./lib/generic-ballot.mjs";

const ROOT = new URL("../", import.meta.url);
const NOW = new Date().toISOString();
const args = new Set(process.argv.slice(2));
const runAll = !args.size;

const tasks = {
  ratings: runAll || args.has("--ratings"),
  polling: runAll || args.has("--polling"),
  finance: runAll || args.has("--finance"),
  fundamentals: runAll || args.has("--fundamentals")
};

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
  } catch {
    return fallback;
  }
}

function write(relativePath, payload) {
  writeCacheFile(relativePath, payload);
  console.log(`cache/${relativePath}`);
}

function latestDate(...values) {
  const dates = values
    .flat()
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((a, b) => b - a);
  return dates[0]?.toISOString() || NOW;
}

function modelAsOf(model) {
  return latestDate(model?.generatedAt, model?.lastUpdated, model?.modelDate);
}

function writeRatingsCaches() {
  const benchmarks = readJson("data/forecast-benchmarks.json", { races: {}, updatedAt: NOW });
  const rows = Object.entries(benchmarks.races || {}).map(([raceId, sources]) => ({ raceId, sources }));
  const asOf = benchmarks.updatedAt || NOW;
  const byOffice = {
    senate: rows.filter((row) => row.raceId.includes("-SEN-")),
    house: rows.filter((row) => /-[0-9]{2}-2026$/.test(row.raceId)),
    governor: rows.filter((row) => row.raceId.includes("-GOV-"))
  };
  for (const [office, officeRows] of Object.entries(byOffice)) {
    write(`ratings/${office}-2026.json`, cacheEnvelope({
      source: "data/forecast-benchmarks.json",
      office,
      asOf,
      rows: officeRows,
      status: officeRows.length ? "OK_PARSED" : "OK_NO_ROWS",
      warnings: benchmarks.notes ? [benchmarks.notes] : []
    }));
  }
}

function racePollRows(model, collectionName) {
  return (model?.[collectionName] || []).flatMap((race) => {
    const pollRows = race.sourceInputs?.districtPolling?.polls
      || race.sourceInputs?.pollEntries
      || race.pollSignal?.pollEntries
      || race.sourceInputs?.pollingLedger?.rows
      || [];
    return (Array.isArray(pollRows) ? pollRows : []).map((poll) => ({
      raceId: race.id || `${race.state}-${race.office || "race"}-2026`,
      state: race.state || null,
      pollster: poll.pollster || poll.source || null,
      source: poll.source || null,
      endDate: poll.endDate || poll.date || null,
      margin: Number.isFinite(Number(poll.margin)) ? Number(poll.margin) : null,
      sampleSize: Number.isFinite(Number(poll.sampleSize)) ? Number(poll.sampleSize) : null,
      population: poll.population || null
    }));
  });
}

function writePollingCaches() {
  const senate = readJson("data/forecast.json", {});
  const house = readJson("data/house-forecast.json", {});
  const governor = readJson("data/governor-forecast.json", {});
  const genericRowIsUsable = (row) => Number.isFinite(Number(row?.margin ?? row?.genericBallotMargin));
  const genericRows = [
    senate.canonicalGenericBallot,
    house.canonicalGenericBallot,
    governor.canonicalGenericBallot
  ]
    .map((row, index) => row ? ({ sourceModel: ["senate", "house", "governor"][index], ...row }) : null)
    .filter(genericRowIsUsable);
  if (!genericRows.length) {
    const cachedGeneric = readCachedGenericBallot();
    if (genericRowIsUsable(cachedGeneric)) {
      genericRows.push({ sourceModel: "cached-fallback", ...cachedGeneric });
    }
  }

  write("polls/generic-ballot-2026.json", cacheEnvelope({
    source: "saved forecast canonicalGenericBallot fields",
    office: "generic-ballot",
    asOf: latestDate(...genericRows.map((row) => row.updatedAt || row.asOf || row.generatedAt), modelAsOf(senate), modelAsOf(house), modelAsOf(governor)),
    rows: genericRows,
    status: genericRows.length ? "OK_PARSED" : "OK_NO_ROWS"
  }));

  write("polls/senate-2026.json", cacheEnvelope({
    source: "data/forecast.json race polling fields",
    office: "senate",
    asOf: modelAsOf(senate),
    rows: racePollRows(senate, "races"),
    status: senate.racePollCoverage?.usablePollRaces ? "OK_PARSED" : "OK_NO_ROWS",
    warnings: senate.modelWarnings?.filter((warning) => /poll/i.test(warning.type || warning.message || "")).slice(0, 20) || []
  }));

  write("polls/house-2026.json", cacheEnvelope({
    source: "data/house-forecast.json district polling fields",
    office: "house",
    asOf: modelAsOf(house),
    rows: racePollRows(house, "districts"),
    status: house.racePollCoverage?.usablePollDistricts ? "OK_PARSED" : "OK_NO_ROWS",
    warnings: house.modelWarnings?.filter((warning) => /poll/i.test(warning.type || warning.message || "")).slice(0, 20) || []
  }));

  write("polls/governor-2026.json", cacheEnvelope({
    source: "data/governor-forecast.json race polling fields",
    office: "governor",
    asOf: modelAsOf(governor),
    rows: racePollRows(governor, "races"),
    status: governor.racePollCoverage?.usablePollRaces ? "OK_PARSED" : "OK_NO_ROWS",
    warnings: governor.modelWarnings?.filter((warning) => /poll/i.test(warning.type || warning.message || "")).slice(0, 20) || []
  }));
}

function writeFundamentalsCaches() {
  const senate = readJson("data/forecast.json", {});
  const house = readJson("data/house-forecast.json", {});
  const governor = readJson("data/governor-forecast.json", {});

  write("fundamentals/house-district-baselines-2026.json", cacheEnvelope({
    source: "data/house-forecast.json sourceInputs",
    office: "house",
    asOf: modelAsOf(house),
    rows: (house.districts || []).map((district) => ({
      id: district.id,
      state: district.state,
      presidentialMargin: district.sourceInputs?.presidentialBaseline ?? district.presidentialMargin ?? null,
      congressionalMargin: district.sourceInputs?.congressionalBaseline ?? district.congressionalMargin ?? null,
      contextualBaseline: district.sourceInputs?.contextualBaseline ?? district.sourceInputs?.districtBaseline ?? null,
      fundamentalMargin: district.sourceInputs?.districtFundamentalMargin ?? district.fundamentalMargin ?? null,
      previousResultComparable: district.previousResultComparable ?? district.previousResult?.comparable ?? null,
      mapVersion: district.mapVersion || null,
      redistrictingConfidence: district.redistrictingConfidence || null
    })),
    status: house.districts?.length ? "OK_PARSED" : "OK_NO_ROWS"
  }));

  write("fundamentals/state-baselines-2026.json", cacheEnvelope({
    source: "saved Senate and governor forecast state fundamentals",
    office: "statewide",
    asOf: latestDate(modelAsOf(senate), modelAsOf(governor)),
    rows: [
      ...(senate.races || []).map((race) => ({
        office: "senate",
        state: race.state,
        pvi: race.pvi ?? null,
        pastSameOfficeMargin: race.pastSenate ?? null,
        structuralMargin: race.marginDecomposition?.fundamentalsMargin ?? race.sourceInputs?.structuralMargin ?? null
      })),
      ...(governor.races || []).map((race) => ({
        office: "governor",
        state: race.state,
        pvi: race.pvi ?? null,
        pastSameOfficeMargin: race.lastMargin ?? null,
        structuralMargin: race.structuralMargin ?? null
      }))
    ],
    status: (senate.races?.length || governor.races?.length) ? "OK_PARSED" : "OK_NO_ROWS"
  }));
}

function writeFinanceCaches() {
  const senate = readJson("data/forecast.json", {});
  const house = readJson("data/house-forecast.json", {});
  const governorFinance = readJson("data/governor-finance.json", {});
  const governor = readJson("data/governor-forecast.json", {});
  write("finance/senate-2026.json", cacheEnvelope({
    source: "data/forecast.json sourceSummary.fecStates",
    office: "senate",
    asOf: modelAsOf(senate),
    rows: senate.sourceSummary?.fecStates ? [{ statesCovered: senate.sourceSummary.fecStates, nationalFinance: senate.sourceSummary?.nationalFinance || null }] : [],
    status: senate.sourceSummary?.fecStates ? "OK_PARSED" : "OK_NO_ROWS"
  }));
  write("finance/house-2026.json", cacheEnvelope({
    source: "data/house-forecast.json sourceSummary",
    office: "house",
    asOf: modelAsOf(house),
    rows: house.sourceSummary?.fecDistricts ? [{ districtsCovered: house.sourceSummary.fecDistricts, nationalFinance: house.sourceSummary?.nationalFinance || null }] : [],
    status: house.sourceSummary?.fecDistricts ? "OK_PARSED" : "OK_NO_ROWS"
  }));
  write("finance/governor-2026.json", cacheEnvelope({
    source: "data/governor-finance.json",
    office: "governor",
    asOf: latestDate(governorFinance.updatedAt, modelAsOf(governor)),
    rows: Object.entries(governorFinance.states || governorFinance || {})
      .filter(([key, value]) => key !== "__national" && value && typeof value === "object")
      .map(([state, value]) => ({ state, ...value })),
    status: governorFinance ? "OK_PARSED" : "OK_NO_ROWS"
  }));
}

if (tasks.ratings) writeRatingsCaches();
if (tasks.polling) writePollingCaches();
if (tasks.fundamentals) writeFundamentalsCaches();
if (tasks.finance) writeFinanceCaches();
