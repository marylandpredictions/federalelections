import { readFileSync } from "node:fs";
import { cacheEnvelope, writeCacheFile } from "./forecast-cache.mjs";
import { readCachedGenericBallot } from "./lib/generic-ballot.mjs";
import {
  COOK_HOUSE_270_URL,
  HOUSE_MAP_270_URL,
  fundamentalsCacheEnvelope,
  mergedHouseRatingsCache,
  parseCookHouseRatings,
  sourceBackedHouseBaselines
} from "./lib/house-input-caches.mjs";

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

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchText(url, label) {
  const started = Date.now();
  try {
    const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 FEA Forecast Bot" } });
    const text = await response.text();
    const ms = Date.now() - started;
    if (response.status === 403) return { ok: false, status: "BLOCKED_403", text, url, ms };
    if (response.status === 404) return { ok: false, status: "NOT_FOUND_404", text, url, ms };
    if (!response.ok) return { ok: false, status: "UNKNOWN_ERROR", text, url, ms };
    console.log(`${label}: fetched ${text.length} bytes in ${ms}ms`);
    return { ok: true, status: "HTML_FETCHED", text, url, ms };
  } catch (error) {
    return { ok: false, status: error?.name === "AbortError" ? "TIMEOUT" : "UNKNOWN_ERROR", error: error?.message || String(error), text: "", url, ms: Date.now() - started };
  }
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

async function writeRatingsCaches() {
  const benchmarks = readJson("data/forecast-benchmarks.json", { races: {}, updatedAt: NOW });
  const rows = Object.entries(benchmarks.races || {}).map(([raceId, sources]) => ({ raceId, sources }));
  const asOf = benchmarks.updatedAt || NOW;
  console.log("Updating Cook House ratings cache...");
  const cookFetch = await fetchText(COOK_HOUSE_270_URL, "Cook House ratings via 270toWin");
  const cookRows = cookFetch.ok ? parseCookHouseRatings(cookFetch.text, { asOf: new Date().toISOString().slice(0, 10), url: COOK_HOUSE_270_URL }) : [];
  const cookStatus = !cookFetch.ok
    ? cookFetch.status
    : cookRows.length ? "OK_PARSED" : "OK_NO_ROWS";
  if (cookStatus === "OK_PARSED") console.log(`Parsed ${cookRows.length} Cook House rating rows.`);
  else console.log(`Cook House ratings cache status: ${cookStatus}.`);
  write("ratings/cook-house-2026.json", cacheEnvelope({
    source: "Cook Political Report via 270toWin",
    office: "house",
    asOf: new Date().toISOString().slice(0, 10),
    rows: cookRows,
    status: cookStatus,
    warnings: cookRows.length ? [] : [`Cook House ratings source returned status ${cookStatus}.`],
    meta: { url: COOK_HOUSE_270_URL, fetchStatus: cookFetch.status, fetchMs: cookFetch.ms }
  }));

  const mapFetch = await fetchText(HOUSE_MAP_270_URL, "House map/fundamentals via 270toWin");
  const sourceBackedRows = sourceBackedHouseBaselines(mapFetch.ok ? mapFetch.text : "");
  const mergedHouse = mergedHouseRatingsCache({
    cookRows,
    baselines: sourceBackedRows,
    asOf: new Date().toISOString().slice(0, 10)
  });
  const byOffice = {
    senate: rows.filter((row) => row.raceId.includes("-SEN-")),
    house: mergedHouse.rows,
    governor: rows.filter((row) => row.raceId.includes("-GOV-"))
  };
  for (const [office, officeRows] of Object.entries(byOffice)) {
    if (office === "house") {
      write("ratings/house-2026.json", mergedHouse);
      continue;
    }
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
    return (Array.isArray(pollRows) ? pollRows : []).map((poll) => {
      const demPct = finiteNumber(poll.demPct);
      const repPct = finiteNumber(poll.repPct);
      const candidates = Array.isArray(poll.candidates) && poll.candidates.length
        ? poll.candidates
        : Number.isFinite(demPct) && Number.isFinite(repPct)
          ? [
              { name: poll.demCandidate || race.demCandidate || race.dem || "Democrat", party: "D", pct: demPct },
              { name: poll.repCandidate || race.repCandidate || race.rep || "Republican", party: "R", pct: repPct }
            ]
          : [];
      return {
        raceId: race.id || `${race.state}-${race.office || "race"}-2026`,
        state: race.state || null,
        district: race.id || race.district || null,
        pollster: poll.pollster || poll.source || null,
        source: poll.source || null,
        sourceUrl: poll.sourceUrl || poll.url || race.sourceInputs?.pollSourceUrls?.[0] || null,
        startDate: poll.startDate || null,
        endDate: poll.endDate || poll.date || null,
        tableType: poll.tableType || "INDIVIDUAL_GENERAL_ELECTION_POLL",
        margin: finiteNumber(poll.margin),
        sampleSize: finiteNumber(poll.sampleSize),
        population: poll.population || null,
        candidates,
        candidateMatchConfidence: poll.candidateMatchConfidence || null,
        manual: Boolean(poll.manual),
        legacy: Boolean(poll.legacy),
        staleCandidates: Boolean(poll.staleCandidates),
        unmatchedRace: Boolean(poll.unmatchedRace),
        superseded: Boolean(poll.superseded)
      };
    });
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

async function writeFundamentalsCaches() {
  const senate = readJson("data/forecast.json", {});
  const governor = readJson("data/governor-forecast.json", {});

  console.log("Updating House fundamentals cache...");
  const mapFetch = await fetchText(HOUSE_MAP_270_URL, "House map/fundamentals via 270toWin");
  const houseRows = sourceBackedHouseBaselines(mapFetch.ok ? mapFetch.text : "");
  const houseStatus = houseRows.length ? "OK_PARSED" : "OK_NO_ROWS";
  console.log(`Loaded ${houseRows.length} source-backed House district baseline rows.`);
  write("fundamentals/house-district-baselines-2026.json", fundamentalsCacheEnvelope(houseRows, {
    asOf: latestDate(new Date().toISOString(), ...houseRows.flatMap((row) => row.sources || [])),
    status: houseStatus,
    warnings: [
      ...(mapFetch.ok ? [] : [`270toWin map baseline fetch returned ${mapFetch.status}; using checked-in certified House baselines only.`]),
      "Missing values are intentionally null; uncontested or near-uncontested House margins are non-comparable."
    ]
  }));

  write("fundamentals/state-baselines-2026.json", cacheEnvelope({
    source: "DERIVED_FROM_PRIOR_FORECAST:saved Senate and governor forecast state fundamentals",
    office: "statewide",
    asOf: latestDate(modelAsOf(senate), modelAsOf(governor)),
    rows: [
      ...(senate.races || []).map((race) => ({
        office: "senate",
        state: race.state,
        source: "DERIVED_FROM_PRIOR_FORECAST",
        independentInput: false,
        confidence: "LOW",
        pvi: race.pvi ?? null,
        pastSameOfficeMargin: race.pastSenate ?? null,
        structuralMargin: race.marginDecomposition?.fundamentalsMargin ?? race.sourceInputs?.structuralMargin ?? null
      })),
      ...(governor.races || []).map((race) => ({
        office: "governor",
        state: race.state,
        source: "DERIVED_FROM_PRIOR_FORECAST",
        independentInput: false,
        confidence: "LOW",
        pvi: race.pvi ?? null,
        pastSameOfficeMargin: race.lastMargin ?? null,
        structuralMargin: race.structuralMargin ?? null
      }))
    ],
    status: (senate.races?.length || governor.races?.length) ? "DERIVED_FROM_PRIOR_FORECAST" : "OK_NO_ROWS",
    warnings: ["This cache is rebuilt from saved forecast output and should not be treated as an independent fundamentals source."]
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

if (tasks.ratings) await writeRatingsCaches();
if (tasks.polling) writePollingCaches();
if (tasks.fundamentals) await writeFundamentalsCaches();
if (tasks.finance) writeFinanceCaches();
