import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const UPCOMING_URL = new URL("../data/result-upcoming-races.json", import.meta.url);

function readUpcomingConfig() {
  return JSON.parse(readFileSync(UPCOMING_URL, "utf8"));
}

function isoDate(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2020) return "";
  return date.toISOString().slice(0, 10);
}

function partyCode(party) {
  const value = String(party || "").toLowerCase();
  if (value.includes("dem")) return "D";
  if (value.includes("rep") || value.includes("gop")) return "R";
  if (value.includes("independent") || value.includes("no party")) return "I";
  return party ? party.slice(0, 1).toUpperCase() : "";
}

function electionMarkerFor(race, candidates) {
  const name = `${race.election_name || ""}`.toLowerCase();
  const scope = `${race.election_scope || race.election_type || ""}`.toLowerCase();
  const parties = new Set(candidates.map((candidate) => candidate.partyCode).filter(Boolean));
  if (name.includes("open primary") || (scope.includes("primary") && parties.has("D") && parties.has("R"))) return { kind: "open-primary", label: "Primary", short: "P" };
  if (name.includes("democratic primary") || (scope.includes("primary") && parties.size === 1 && parties.has("D"))) return { kind: "dem-primary", label: "Democratic primary", short: "D" };
  if (name.includes("republican primary") || (scope.includes("primary") && parties.size === 1 && parties.has("R"))) return { kind: "rep-primary", label: "Republican primary", short: "R" };
  if (scope.includes("primary")) return { kind: "primary", label: "Primary", short: "P" };
  return { kind: "general", label: "General election", short: "G" };
}

function normalizeUpcomingRace(race, index = 0) {
  const candidates = (race.candidates || []).map((candidate) => ({
    name: candidate.name || "Unknown candidate",
    party: /no party preference/i.test(candidate.party || "") ? "Independent" : (candidate.party || ""),
    partyCode: candidate.partyCode || partyCode(candidate.party)
  }));
  const missingFields = [];
  if (!race.id) missingFields.push("id");
  if (!race.election_date) missingFields.push("electionDate");
  if (!candidates.length) missingFields.push("candidates");
  if (!race.has_map) missingFields.push("map");
  return {
    id: race.id ? String(race.id) : `upcoming-${race.state || "US"}-${race.electionDate || race.election_date || "date"}-${index}`,
    source: race.source || "manual-upcoming",
    sourceUrl: race.sourceUrl || "",
    state: race.province || race.state || "",
    stateName: race.stateName || race.province || race.state || "",
    electionDate: isoDate(race.electionDate || race.election_date),
    electionName: race.election_name || race.type || "Upcoming race",
    office: race.type || "",
    district: race.district ?? null,
    municipality: race.municipality ?? null,
    hasMap: Boolean(race.has_map),
    candidates,
    marker: electionMarkerFor(race, candidates),
    missingFields
  };
}

function dedupeRaces(races) {
  const seen = new Set();
  return races.filter((race) => {
    const key = race.id || `${race.state}:${race.electionDate}:${race.electionName}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function buildUpcomingResults() {
  const config = readUpcomingConfig();
  const today = new Date().toISOString().slice(0, 10);
  const generated = dedupeRaces((config.manualRaces || []).map((race, index) => normalizeUpcomingRace({
    ...race,
    province: race.state,
    election_name: race.electionName,
    election_date: race.electionDate,
    type: race.office
  }, index)))
    .filter((race) => race.electionDate && race.electionDate >= today)
    .sort((a, b) => a.electionDate.localeCompare(b.electionDate) || a.electionName.localeCompare(b.electionName));
  const firstDate = generated[0]?.electionDate || "";
  return {
    ...config,
    generatedAt: new Date().toISOString(),
    generatedRaces: firstDate ? generated.filter((race) => race.electionDate === firstDate) : []
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await buildUpcomingResults();
  writeFileSync(UPCOMING_URL, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote ${data.generatedRaces?.length || 0} upcoming race(s) from local/NBC-ready config`);
}
