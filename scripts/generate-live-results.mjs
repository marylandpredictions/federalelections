import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OUTPUT_URL = new URL("../data/live-results.json", import.meta.url);
const CIVIC_BASE = "https://civicapi.org/api/v2";

const FEATURED_GROUPS = [
  { state: "CA", name: "California", queries: ["California Governor", "California US House", "California Los Angeles Mayor"] },
  { state: "IA", name: "Iowa", queries: ["Iowa US Senate", "Iowa US House", "Iowa Governor"] },
  { state: "MT", name: "Montana", queries: ["Montana US Senate", "Montana US House", "Montana Governor"] },
  { state: "NJ", name: "New Jersey", queries: ["New Jersey US Senate", "New Jersey US House", "New Jersey Governor"] },
  { state: "NM", name: "New Mexico", queries: ["New Mexico US Senate", "New Mexico US House", "New Mexico Governor"] },
  { state: "SD", name: "South Dakota", queries: ["South Dakota US Senate", "South Dakota US House", "South Dakota Governor"] }
];

const TYPE_PRIORITY = {
  "US Senate": 100,
  Senate: 96,
  "US House": 92,
  Governor: 88,
  Mayor: 70,
  "State House": 52,
  "State Senate": 50
};

function isoDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function electionYear(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
}

function partyCode(party) {
  const value = String(party || "").toLowerCase();
  if (value.includes("dem")) return "D";
  if (value.includes("rep") || value.includes("gop")) return "R";
  if (value.includes("libertarian")) return "L";
  if (value.includes("green")) return "G";
  if (value.includes("independent") || value.includes("no party")) return "I";
  return party ? party.slice(0, 1).toUpperCase() : "";
}

function normalizeCandidate(candidate) {
  return {
    name: candidate.name || "Unknown",
    party: candidate.party || "",
    partyCode: partyCode(candidate.party),
    color: candidate.color || "",
    votes: Number(candidate.votes || 0),
    percent: Number(candidate.percent || 0),
    winner: Boolean(candidate.winner)
  };
}

function racePriority(race) {
  const base = TYPE_PRIORITY[race.type] || 20;
  const reporting = Number(race.percent_reporting || 0);
  const candidateBonus = Math.min(10, (race.candidates?.length || 0) / 2);
  return base + reporting / 20 + candidateBonus;
}

function normalizeRace(race, group) {
  const candidates = (race.candidates || []).map(normalizeCandidate)
    .sort((a, b) => b.votes - a.votes || b.percent - a.percent);
  const leader = candidates[0] || null;
  return {
    id: race.id,
    source: "civicAPI",
    type: race.type || "Race",
    country: race.country || "US",
    state: race.province || group.state,
    stateName: group.name,
    district: race.district ?? null,
    municipality: race.municipality ?? null,
    electionName: race.election_name || `${group.name} ${race.type || "Race"}`,
    electionType: race.election_type || "",
    electionDate: isoDate(race.election_date),
    percentReporting: Number(race.percent_reporting || 0),
    hasBreakdown: Boolean(race.has_breakdown),
    hasMap: Boolean(race.has_map),
    leaderName: leader?.name || "",
    leaderParty: leader?.party || "",
    leaderPartyCode: leader?.partyCode || "",
    otherCandidateCount: Math.max(0, candidates.length - 1),
    candidates
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Federal Elections Analysis live results generator"
    }
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function fetchGroup(group) {
  const searches = await Promise.all((group.queries || [group.query]).map(async (query) => {
    const url = `${CIVIC_BASE}/race/search?query=${encodeURIComponent(query)}`;
    const data = await fetchJson(url);
    return { query, data };
  }));
  const seen = new Set();
  const rawRaces = searches.flatMap(({ data }) => data.races || []).filter((race) => {
    if (seen.has(race.id)) return false;
    seen.add(race.id);
    return true;
  });
  const races = rawRaces
    .filter((race) => race.country === "US")
    .filter((race) => !group.state || race.province === group.state)
    .filter((race) => electionYear(race.election_date) === 2026)
    .map((race) => normalizeRace(race, group))
    .sort((a, b) => racePriority(b) - racePriority(a) || String(a.electionName).localeCompare(String(b.electionName)));

  return {
    state: group.state,
    stateName: group.name,
    sourceQuery: (group.queries || [group.query]).join(" / "),
    totalAvailable: Math.max(races.length, ...searches.map(({ data }) => Number(data.count || 0))),
    featuredCount: Math.min(races.length, 7),
    races: races.slice(0, 7)
  };
}

export async function buildLiveResults() {
  const groups = [];
  const errors = [];

  for (const group of FEATURED_GROUPS) {
    try {
      groups.push(await fetchGroup(group));
    } catch (error) {
      errors.push({ state: group.state, message: error.message });
      groups.push({
        state: group.state,
        stateName: group.name,
        sourceQuery: group.query,
        totalAvailable: 0,
        featuredCount: 0,
        races: []
      });
    }
  }

  return {
    model: "live election results",
    generatedAt: new Date().toISOString(),
    provider: {
      name: "civicAPI",
      url: "https://civicapi.org/",
      attribution: "Live race data provided by civicAPI where available. Race calls are from the listed provider, not Federal Elections Analysis."
    },
    refreshSeconds: 90,
    groups,
    errors
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await buildLiveResults();
  writeFileSync(OUTPUT_URL, JSON.stringify(data, null, 2), "utf8");
  console.log(`Wrote live results for ${data.groups.reduce((sum, group) => sum + group.races.length, 0)} featured races`);
}
