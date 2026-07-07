import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const OUTPUT_CANDIDATES = "data/staging/candidates/candidate-status-2026.json";
const OUTPUT_PRIMARIES = "data/staging/primaries/primary-status-2026.json";
const OUTPUT_DIAGNOSTICS = "data/diagnostics/candidate-primary-sync-v2-2026.json";

function readJson(path, fallback = null) {
  try {
    const url = new URL(path, ROOT);
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return { readError: error.message };
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function candidateRowsFromForecast(path, office, collectionKey = "races") {
  const payload = readJson(path, {});
  const rows = [];
  const races = Array.isArray(payload?.[collectionKey]) ? payload[collectionKey] : [];
  for (const race of races) {
    const raceId = race.id || race.raceId || race.state || race.district;
    const state = race.state || String(raceId || "").slice(0, 2);
    const candidates = [
      { party: "D", name: race.dem || race.demCandidate || race.democrat || "Democrat" },
      { party: "R", name: race.rep || race.repCandidate || race.republican || "Republican" },
      ...(Array.isArray(race.independents) ? race.independents.map((name) => ({ party: "I", name })) : [])
    ];
    for (const candidate of candidates) {
      if (!candidate.name) continue;
      rows.push({
        raceId,
        office,
        state,
        district: race.district || null,
        candidate: candidate.name,
        party: candidate.party,
        nomineeStatus: race.matchupStatus?.nomineeStatus || race.nomineeStatus || "UNKNOWN_OR_PLACEHOLDER",
        primaryResolved: Boolean(race.matchupStatus?.primaryResolved || race.primaryResolved),
        runoffPending: Boolean(race.runoffPending),
        withdrawn: Boolean(race.withdrawn),
        deceased: Boolean(race.deceased),
        replacedNominee: Boolean(race.replacedNominee),
        freshnessTimestamp: payload.generatedAt || payload.updatedAt || null,
        sourceUrl: path,
        reviewRequired: !race.matchupStatus && !race.nomineeStatus
      });
    }
  }
  return rows;
}

function liveResultRows() {
  const payload = readJson("data/live-results.json", {});
  const races = Array.isArray(payload?.races) ? payload.races : [];
  return races.flatMap((race) => (race.candidates || []).map((candidate) => ({
    raceId: race.id || race.raceId,
    office: race.office || race.type || "results",
    state: race.state,
    district: race.district || null,
    candidate: candidate.name,
    party: candidate.party || candidate.partyCode || null,
    nomineeStatus: race.status === "called" ? "RESULTS_RACE" : "LIVE_RESULTS_CANDIDATE",
    primaryResolved: Boolean(race.calledCandidates?.length),
    runoffPending: Boolean(race.runoffPending),
    withdrawn: false,
    deceased: false,
    replacedNominee: false,
    freshnessTimestamp: payload.generatedAt || payload.updatedAt || null,
    sourceUrl: "data/live-results.json",
    reviewRequired: false
  })));
}

const candidateRows = [
  ...candidateRowsFromForecast("data/forecast.json", "senate"),
  ...candidateRowsFromForecast("data/governor-forecast.json", "governor"),
  ...candidateRowsFromForecast("data/house-forecast.json", "house", "districts"),
  ...liveResultRows()
];

const deduped = new Map();
for (const row of candidateRows) {
  deduped.set(`${row.office}|${row.raceId}|${row.candidate}|${row.party}`, row);
}

const candidates = [...deduped.values()].sort((a, b) => `${a.office}${a.raceId}${a.candidate}`.localeCompare(`${b.office}${b.raceId}${b.candidate}`));
const primaries = candidates.reduce((rows, row) => {
  if (!rows.some((existing) => existing.raceId === row.raceId && existing.office === row.office)) {
    rows.push({
      raceId: row.raceId,
      office: row.office,
      state: row.state,
      district: row.district,
      primaryResolved: row.primaryResolved,
      runoffPending: row.runoffPending,
      sourceUrl: row.sourceUrl,
      freshnessTimestamp: row.freshnessTimestamp,
      reviewRequired: row.reviewRequired
    });
  }
  return rows;
}, []);

const generatedAt = new Date().toISOString();
writeJson(OUTPUT_CANDIDATES, { schemaVersion: "2026.candidate-status-v2.1", generatedAt, rows: candidates });
writeJson(OUTPUT_PRIMARIES, { schemaVersion: "2026.primary-status-v2.1", generatedAt, rows: primaries });
writeJson(OUTPUT_DIAGNOSTICS, {
  schemaVersion: "2026.candidate-primary-sync-diagnostics-v2.1",
  generatedAt,
  counts: {
    candidates: candidates.length,
    races: primaries.length,
    reviewRequired: candidates.filter((row) => row.reviewRequired).length,
    primaryResolved: primaries.filter((row) => row.primaryResolved).length
  },
  manualReview: candidates.filter((row) => row.reviewRequired).slice(0, 50)
});

console.log(`Synced ${candidates.length} candidate rows across ${primaries.length} races.`);
