import { readFileSync } from "node:fs";

const CALLS_PATH = "data/result-calls.json";
const RESULTS_PATH = "data/live-results.json";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

const callsData = readJson(CALLS_PATH);
const resultsData = readJson(RESULTS_PATH);
const races = new Map((resultsData.groups || []).flatMap((group) => group.races || []).map((race) => [String(race.id), race]));
const errors = [];

for (const [raceId, config] of Object.entries(callsData.races || {})) {
  const race = races.get(String(raceId));
  if (!race) {
    errors.push(`${raceId}: race id is not in data/live-results.json`);
    continue;
  }
  const calls = Array.isArray(config.calls) ? config.calls : [];
  if (!calls.length) {
    errors.push(`${raceId}: calls must be a non-empty array`);
    continue;
  }
  for (const call of calls) {
    const candidateName = String(call.candidate || "");
    const match = (race.candidates || []).find((candidate) => String(candidate.name || "").toLowerCase() === candidateName.toLowerCase());
    if (!match) errors.push(`${raceId}: "${candidateName}" does not exactly match a candidate in ${race.electionName}`);
    const status = String(call.status || "");
    if (!["winner", "projected", "advances", "advanced"].includes(status)) {
      errors.push(`${raceId}: "${candidateName}" has invalid status "${status}"`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Result calls valid: ${Object.keys(callsData.races || {}).length} race call entr${Object.keys(callsData.races || {}).length === 1 ? "y" : "ies"}.`);
