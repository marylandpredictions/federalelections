import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OUTPUT_URL = new URL("../data/live-results.json", import.meta.url);
const DETAIL_DIR_URL = new URL("../data/live-results-races/", import.meta.url);
const CALLS_URL = new URL("../data/result-calls.json", import.meta.url);
const FEATURED_CANDIDATES_URL = new URL("../data/result-featured-candidates.json", import.meta.url);
const NBC_BASE = "https://www.nbcnews.com/firecracker/api/v2/state-results/2026-primary-elections";
const CIVIC_RACE_BASE = "https://civicapi.org/api/v2/race";
const externalEstimateCache = new Map();
const LIVE_SOURCE_CACHE_MS = 12_000;
const raceDetailCache = new Map();
const RACE_DETAIL_CACHE_MS = 30_000;
const civicApiCache = new Map();
const CIVIC_API_CACHE_MS = 60_000;

const STATE_ESTIMATE_FALLBACK_SLUGS = {
  CA: "california-governor-results",
  IA: "iowa-senate-results",
  ME: "maine-senate-results",
  MT: "montana-senate-results",
  ND: "north-dakota-house-results",
  NV: "nevada-governor-results",
  NJ: "new-jersey-senate-results",
  NM: "new-mexico-senate-results",
  SC: "south-carolina-senate-results",
  SD: "south-dakota-senate-results"
};

const FEATURED_GROUPS = [
  { state: "CA", name: "California", queries: ["California Governor", "California Lieutenant Governor", "California Insurance Commissioner", "California Superintendent Public Instruction", "California US House", "California Los Angeles Mayor"] },
  { state: "IA", name: "Iowa", queries: ["Iowa US Senate", "Iowa US House", "Iowa Governor"] },
  { state: "ME", name: "Maine", queries: ["Maine US Senate", "Maine US House", "Maine Governor"] },
  { state: "MT", name: "Montana", queries: ["Montana US Senate", "Montana US House", "Montana Governor"] },
  { state: "ND", name: "North Dakota", queries: ["North Dakota US House"] },
  { state: "NV", name: "Nevada", queries: ["Nevada US House", "Nevada Governor"] },
  { state: "NJ", name: "New Jersey", queries: ["New Jersey US Senate", "New Jersey US House", "New Jersey Governor"] },
  { state: "NM", name: "New Mexico", queries: ["New Mexico US Senate", "New Mexico US House", "New Mexico Governor"] },
  { state: "SC", name: "South Carolina", queries: ["South Carolina US Senate", "South Carolina US House", "South Carolina Governor"] },
  { state: "SD", name: "South Dakota", queries: ["South Dakota US Senate", "South Dakota US House", "South Dakota Governor"] }
];

const REQUIRED_RACES_BY_STATE = {
  CA: [79777, 79779, 79778, 79881, 79893, 79932, 79884, 79896, 79907, 79909, 79916, 79924, 79938],
  IA: [79945, 79944, 80211, 80210],
  ME: ["me-gov-r-2026", "me-gov-d-2026", "me-sen-r-2026", "me-sen-d-2026", "me-house-1-r-2026", "me-house-1-d-2026", "me-house-2-r-2026", "me-house-2-d-2026"],
  MT: [80460, 80458, 80452],
  ND: ["nd-house-at-large-r-2026", "nd-house-at-large-d-2026"],
  NV: ["nv-gov-r-2026", "nv-gov-d-2026", "nv-house-1-r-2026", "nv-house-1-d-2026", "nv-house-2-r-2026", "nv-house-2-d-2026", "nv-house-3-r-2026", "nv-house-3-d-2026", "nv-house-4-r-2026", "nv-house-4-d-2026"],
  NJ: [81058, 81057, 81046, 81048, 81055],
  NM: [80691, 80690, 81014, 81015],
  SC: ["sc-gov-r-2026", "sc-gov-d-2026", "sc-sen-r-2026", "sc-sen-d-2026", "sc-house-1-r-2026", "sc-house-1-d-2026", "sc-house-2-r-2026", "sc-house-2-d-2026", "sc-house-3-r-2026", "sc-house-3-d-2026", "sc-house-4-r-2026", "sc-house-4-d-2026", "sc-house-5-r-2026", "sc-house-5-d-2026", "sc-house-6-r-2026", "sc-house-6-d-2026", "sc-house-7-r-2026", "sc-house-7-d-2026"],
  SD: [80461, 80512]
};

const MANUAL_RACES = {};

const NBC_RACE_SOURCES = {
  79777: { state: "CA", slug: "california-governor-results", type: "Governor", name: "California Governor Open Primary" },
  79779: { state: "CA", slug: "california-lieutenant-governor-results", type: "Lieutenant Governor", name: "California Lieutenant Governor Open Primary" },
  79778: { state: "CA", slug: "", type: "Insurance Commissioner", name: "California Insurance Commissioner Open Primary", staticOnly: true },
  79881: { state: "CA", slug: "", type: "Superintendent of Public Instruction", name: "California Superintendent of Public Instruction Open Primary", staticOnly: true },
  79893: { state: "CA", slug: "california-us-house-district-1-results", type: "House of Representatives", district: "CA-01", name: "California US House 1 Open Primary" },
  79932: { state: "CA", slug: "california-us-house-district-7-results", type: "House of Representatives", district: "CA-07", name: "California US House 7 Open Primary" },
  79884: { state: "CA", slug: "california-us-house-district-11-results", type: "House of Representatives", district: "CA-11", name: "California US House 11 Open Primary" },
  79896: { state: "CA", slug: "california-us-house-district-22-results", type: "House of Representatives", district: "CA-22", name: "California US House 22 Open Primary" },
  79907: { state: "CA", slug: "california-us-house-district-32-results", type: "House of Representatives", district: "CA-32", name: "California US House 32 Open Primary" },
  79909: { state: "CA", slug: "california-us-house-district-34-results", type: "House of Representatives", district: "CA-34", name: "California US House 34 Open Primary" },
  79916: { state: "CA", slug: "california-us-house-district-40-results", type: "House of Representatives", district: "CA-40", name: "California US House 40 Open Primary" },
  79924: { state: "CA", slug: "california-us-house-district-48-results", type: "House of Representatives", district: "CA-48", name: "California US House 48 Open Primary" },
  79938: { state: "CA", slug: "los-angeles-mayor-results", type: "Mayor", municipality: "Los Angeles", name: "Los Angeles Mayor Open Primary" },
  79945: { state: "IA", slug: "iowa-governor-results", party: "R", type: "Governor", name: "Iowa Governor Republican Primary" },
  79944: { state: "IA", slug: "iowa-governor-results", party: "D", type: "Governor", name: "Iowa Governor Democratic Primary" },
  80211: { state: "IA", slug: "iowa-senate-results", party: "R", type: "Senate", name: "Iowa US Senate Republican Primary" },
  80210: { state: "IA", slug: "iowa-senate-results", party: "D", type: "Senate", name: "Iowa US Senate Democratic Primary" },
  80460: { state: "MT", slug: "montana-senate-results", party: "R", type: "Senate", name: "Montana US Senate Republican Primary" },
  80458: { state: "MT", slug: "montana-senate-results", party: "D", type: "Senate", name: "Montana US Senate Democratic Primary" },
  80452: { state: "MT", slug: "montana-us-house-district-1-results", party: "D", type: "House of Representatives", district: "MT-01", name: "Montana US House 1 Democratic Primary" },
  81058: { state: "NJ", slug: "new-jersey-senate-results", party: "R", type: "US Senate", name: "New Jersey US Senate Republican Primary" },
  81057: { state: "NJ", slug: "new-jersey-senate-results", party: "D", type: "US Senate", name: "New Jersey US Senate Democratic Primary" },
  81046: { state: "NJ", slug: "new-jersey-us-house-district-7-results", party: "D", type: "US House", district: "NJ-07", name: "New Jersey US House 7 Democratic Primary" },
  81048: { state: "NJ", slug: "new-jersey-us-house-district-8-results", party: "D", type: "US House", district: "NJ-08", name: "New Jersey US House 8 Democratic Primary" },
  81055: { state: "NJ", slug: "new-jersey-us-house-district-12-results", party: "D", type: "US House", district: "NJ-12", name: "New Jersey US House 12 Democratic Primary" },
  80691: { state: "NM", slug: "new-mexico-governor-results", party: "R", type: "Governor", name: "New Mexico Governor Republican Primary" },
  80690: { state: "NM", slug: "new-mexico-governor-results", party: "D", type: "Governor", name: "New Mexico Governor Democratic Primary" },
  81014: { state: "NM", slug: "new-mexico-senate-results", party: "D", type: "Senate", name: "New Mexico US Senate Democratic Primary" },
  81015: { state: "NM", slug: "new-mexico-senate-results", party: "R", type: "Senate", name: "New Mexico US Senate Republican Primary" },
  80461: { state: "SD", slug: "south-dakota-governor-results", party: "R", type: "Governor", name: "South Dakota Governor Republican Primary" },
  80512: { state: "SD", slug: "south-dakota-senate-results", party: "R", type: "Senate", name: "South Dakota US Senate Republican Primary" },
  "me-gov-r-2026": { state: "ME", stateName: "Maine", slug: "maine-governor-results", party: "R", type: "Governor", name: "Maine Governor Republican Primary" },
  "me-gov-d-2026": { state: "ME", stateName: "Maine", slug: "maine-governor-results", party: "D", type: "Governor", name: "Maine Governor Democratic Primary" },
  "me-sen-r-2026": { state: "ME", stateName: "Maine", slug: "maine-senate-results", party: "R", type: "US Senate", name: "Maine US Senate Republican Primary" },
  "me-sen-d-2026": { state: "ME", stateName: "Maine", slug: "maine-senate-results", party: "D", type: "US Senate", name: "Maine US Senate Democratic Primary" },
  "me-house-1-r-2026": { state: "ME", stateName: "Maine", slug: "maine-us-house-district-1-results", party: "R", type: "US House", district: "ME-01", name: "Maine US House 1 Republican Primary" },
  "me-house-1-d-2026": { state: "ME", stateName: "Maine", slug: "maine-us-house-district-1-results", party: "D", type: "US House", district: "ME-01", name: "Maine US House 1 Democratic Primary" },
  "me-house-2-r-2026": { state: "ME", stateName: "Maine", slug: "maine-us-house-district-2-results", party: "R", type: "US House", district: "ME-02", name: "Maine US House 2 Republican Primary" },
  "me-house-2-d-2026": { state: "ME", stateName: "Maine", slug: "maine-us-house-district-2-results", party: "D", type: "US House", district: "ME-02", name: "Maine US House 2 Democratic Primary" },
  "nd-house-at-large-r-2026": { state: "ND", stateName: "North Dakota", slug: "north-dakota-house-results", party: "R", type: "US House", district: null, atLarge: true, name: "North Dakota US House At-Large Republican Primary" },
  "nd-house-at-large-d-2026": { state: "ND", stateName: "North Dakota", slug: "north-dakota-house-results", party: "D", type: "US House", district: null, atLarge: true, name: "North Dakota US House At-Large Democratic Primary" },
  "nv-gov-r-2026": { state: "NV", stateName: "Nevada", slug: "nevada-governor-results", party: "R", type: "Governor", name: "Nevada Governor Republican Primary" },
  "nv-gov-d-2026": { state: "NV", stateName: "Nevada", slug: "nevada-governor-results", party: "D", type: "Governor", name: "Nevada Governor Democratic Primary" },
  "nv-house-1-r-2026": { state: "NV", stateName: "Nevada", slug: "nevada-us-house-district-1-results", party: "R", type: "US House", district: "NV-01", name: "Nevada US House 1 Republican Primary" },
  "nv-house-1-d-2026": { state: "NV", stateName: "Nevada", slug: "nevada-us-house-district-1-results", party: "D", type: "US House", district: "NV-01", name: "Nevada US House 1 Democratic Primary" },
  "nv-house-2-r-2026": { state: "NV", stateName: "Nevada", slug: "nevada-us-house-district-2-results", party: "R", type: "US House", district: "NV-02", name: "Nevada US House 2 Republican Primary" },
  "nv-house-2-d-2026": { state: "NV", stateName: "Nevada", slug: "nevada-us-house-district-2-results", party: "D", type: "US House", district: "NV-02", name: "Nevada US House 2 Democratic Primary" },
  "nv-house-3-r-2026": { state: "NV", stateName: "Nevada", slug: "nevada-us-house-district-3-results", party: "R", type: "US House", district: "NV-03", name: "Nevada US House 3 Republican Primary" },
  "nv-house-3-d-2026": { state: "NV", stateName: "Nevada", slug: "nevada-us-house-district-3-results", party: "D", type: "US House", district: "NV-03", name: "Nevada US House 3 Democratic Primary" },
  "nv-house-4-r-2026": { state: "NV", stateName: "Nevada", slug: "nevada-us-house-district-4-results", party: "R", type: "US House", district: "NV-04", name: "Nevada US House 4 Republican Primary" },
  "nv-house-4-d-2026": { state: "NV", stateName: "Nevada", slug: "nevada-us-house-district-4-results", party: "D", type: "US House", district: "NV-04", name: "Nevada US House 4 Democratic Primary" },
  "sc-gov-r-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-governor-results", party: "R", type: "Governor", name: "South Carolina Governor Republican Primary" },
  "sc-gov-d-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-governor-results", party: "D", type: "Governor", name: "South Carolina Governor Democratic Primary" },
  "sc-sen-r-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-senate-results", party: "R", type: "US Senate", name: "South Carolina US Senate Republican Primary" },
  "sc-sen-d-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-senate-results", party: "D", type: "US Senate", name: "South Carolina US Senate Democratic Primary" },
  "sc-house-1-r-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-1-results", party: "R", type: "US House", district: "SC-01", name: "South Carolina US House 1 Republican Primary" },
  "sc-house-1-d-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-1-results", party: "D", type: "US House", district: "SC-01", name: "South Carolina US House 1 Democratic Primary" },
  "sc-house-2-r-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-2-results", party: "R", type: "US House", district: "SC-02", name: "South Carolina US House 2 Republican Primary" },
  "sc-house-2-d-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-2-results", party: "D", type: "US House", district: "SC-02", name: "South Carolina US House 2 Democratic Primary" },
  "sc-house-3-r-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-3-results", party: "R", type: "US House", district: "SC-03", name: "South Carolina US House 3 Republican Primary" },
  "sc-house-3-d-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-3-results", party: "D", type: "US House", district: "SC-03", name: "South Carolina US House 3 Democratic Primary" },
  "sc-house-4-r-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-4-results", party: "R", type: "US House", district: "SC-04", name: "South Carolina US House 4 Republican Primary" },
  "sc-house-4-d-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-4-results", party: "D", type: "US House", district: "SC-04", name: "South Carolina US House 4 Democratic Primary" },
  "sc-house-5-r-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-5-results", party: "R", type: "US House", district: "SC-05", name: "South Carolina US House 5 Republican Primary" },
  "sc-house-5-d-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-5-results", party: "D", type: "US House", district: "SC-05", name: "South Carolina US House 5 Democratic Primary" },
  "sc-house-6-r-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-6-results", party: "R", type: "US House", district: "SC-06", name: "South Carolina US House 6 Republican Primary" },
  "sc-house-6-d-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-6-results", party: "D", type: "US House", district: "SC-06", name: "South Carolina US House 6 Democratic Primary" },
  "sc-house-7-r-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-7-results", party: "R", type: "US House", district: "SC-07", name: "South Carolina US House 7 Republican Primary" },
  "sc-house-7-d-2026": { state: "SC", stateName: "South Carolina", slug: "south-carolina-us-house-district-7-results", party: "D", type: "US House", district: "SC-07", name: "South Carolina US House 7 Democratic Primary" }
};

const NBC_SLUG_CACHE = new Map();
const STATIC_NBC_UNSUPPORTED_RACES = new Set(
  Object.entries(NBC_RACE_SOURCES)
    .filter(([, source]) => source.staticOnly)
    .map(([id]) => String(id))
);

async function cachedFetchJson(cache, url) {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && now - cached.at < LIVE_SOURCE_CACHE_MS) {
    const result = await cached.promise;
    if (!result.ok) throw result.error;
    return result.data;
  }
  const promise = fetchJson(url)
    .then((data) => ({ ok: true, data }))
    .catch((error) => ({ ok: false, error }));
  cache.set(url, { at: now, promise });
  const result = await promise;
  if (!result.ok) throw result.error;
  return result.data;
}

const POLL_CLOSE_UTC_BY_STATE = {
  CA: "2026-06-03T03:00:00Z",
  IA: "2026-06-03T01:00:00Z",
  ME: "2026-06-10T00:00:00Z",
  MT: "2026-06-03T02:00:00Z",
  ND: "2026-06-10T01:00:00Z",
  NV: "2026-06-10T02:00:00Z",
  NJ: "2026-06-03T00:00:00Z",
  NM: "2026-06-03T01:00:00Z",
  SC: "2026-06-09T23:00:00Z",
  SD: "2026-06-03T01:00:00Z"
};

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
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? `${raw}Z` : raw;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2020) return null;
  return date.toISOString();
}

function isoElectionDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return `${match[1]}T12:00:00.000Z`;
  return isoDate(value);
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

function readManualCalls() {
  try {
    return JSON.parse(readFileSync(CALLS_URL, "utf8"));
  } catch {
    return { races: {} };
  }
}

function readFeaturedCandidates() {
  try {
    return JSON.parse(readFileSync(FEATURED_CANDIDATES_URL, "utf8"));
  } catch {
    return { races: {} };
  }
}

export function reloadManualResultConfig() {
  externalEstimateCache.clear();
}

function featuredNamesForRace(raceId) {
  const featuredCandidates = readFeaturedCandidates();
  return featuredCandidates.races?.[String(raceId)] || [];
}

function featuredRank(raceId, candidateName) {
  const names = featuredNamesForRace(raceId).map((name) => String(name).toLowerCase());
  const index = names.indexOf(String(candidateName || "").toLowerCase());
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function callForCandidate(raceId, candidateName) {
  const manualCalls = readManualCalls();
  const raceCalls = manualCalls.races?.[String(raceId)]?.calls || [];
  return raceCalls.find((call) => String(call.candidate || "").toLowerCase() === String(candidateName || "").toLowerCase()) || null;
}

function isRealCandidate(candidate) {
  const name = String(candidate?.name || "").trim();
  return Boolean(name) && !/^write-?in$/i.test(name);
}

function pollsAreClosed(race) {
  const iso = isoDate(race.pollsClose || race.polls_close)
    || POLL_CLOSE_UTC_BY_STATE[String(race.province || race.state || "").toUpperCase()];
  if (!iso) return false;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && Date.now() >= date.getTime();
}

function pollsAreOpen(race) {
  const iso = isoDate(race.pollsOpen || race.polls_open);
  if (!iso) return pollsAreClosed(race);
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && Date.now() >= date.getTime();
}

function automaticUncontestedCalls(race, candidates = []) {
  if (!pollsAreClosed(race)) return [];
  const realCandidates = candidates.filter(isRealCandidate);
  if (realCandidates.length !== 1) return [];
  return [{
    candidate: realCandidates[0].name,
    status: "winner",
    label: "Winner",
    automatic: true
  }];
}

function callLabelFor(race, call) {
  if (!call) return "";
  if (call.label) return call.label;
  const scope = `${race.election_scope || race.electionType || race.electionName || ""}`.toLowerCase();
  const electionName = `${race.election_name || race.electionName || ""}`.toLowerCase();
  if (call.status === "projected") return "Projected";
  if (call.status === "advanced") return "Advanced to general election";
  if (call.status === "advances" || scope.includes("primary") || electionName.includes("primary")) return "Advances";
  return "Winner";
}

function withManualCall(candidate, race) {
  const call = callForCandidate(race.id, candidate.name);
  return {
    ...candidate,
    apiWinner: Boolean(candidate.winner),
    winner: false,
    callStatus: call?.status || "",
    callLabel: callLabelFor(race, call)
  };
}

function electionMarkerFor(race, candidates = []) {
  const name = `${race.election_name || race.electionName || ""}`.toLowerCase();
  const scope = `${race.election_scope || race.electionScope || race.election_type || race.electionType || ""}`.toLowerCase();
  const parties = new Set(candidates.map((candidate) => partyCode(candidate.party)).filter(Boolean));
  if (name.includes("open primary") || (scope.includes("primary") && parties.has("D") && parties.has("R"))) {
    return { kind: "open-primary", label: "Primary", short: "P" };
  }
  if (name.includes("democratic primary") || (scope.includes("primary") && parties.size === 1 && parties.has("D"))) {
    return { kind: "dem-primary", label: "Democratic primary", short: "D" };
  }
  if (name.includes("republican primary") || (scope.includes("primary") && parties.size === 1 && parties.has("R"))) {
    return { kind: "rep-primary", label: "Republican primary", short: "R" };
  }
  if (scope.includes("primary")) return { kind: "primary", label: "Primary", short: "P" };
  return { kind: "general", label: "General election", short: "G" };
}

function normalizeCandidate(candidate) {
  let party = /no party preference/i.test(candidate.party || "") ? "Independent" : (candidate.party || "");
  const name = String(candidate.name || "").toLowerCase();
  
  // CA races where legacy/local feeds may mark candidates as Nonpartisan.
  // Correct party affiliations based on actual candidate party registrations.
  const partyLower = party.toLowerCase();
  if (partyLower === "nonpartisan" || partyLower === "n" || partyLower === "") {
    const partyCorrections = {
      // CA Lieutenant Governor Open Primary
      "fiona ma": "Democratic",
      "josh fryday": "Democratic", 
      "michael tubbs": "Democratic",
      "oliver ma": "Democratic",
      "gloria romero": "Republican",
      "david fennell": "Republican",
      "skip shelton": "Republican",
      "janelle kellman": "Democratic",
      "ebie lynch": "Republican",
      "tim myers": "Democratic",
      "alice stek": "Peace and Freedom",
      "jeyson lopez": "Democratic",
      "abdur sikder": "Democratic",
      "sean collinson": "Independent",
      "rakesh christian": "Independent",
      "david collenberg": "Republican",
      // CA US House 7 Open Primary
      "doris matsui": "Democratic",
      "mai vang": "Democratic",
      "zachariah wooden": "Republican",
      "ralph nwobi": "Republican",
      "robby morin": "Democratic",
      "enayat nazhat": "Democratic",
      // CA US House 1 Open Primary
      "james gallagher": "Republican",
      "mike mcguire": "Democratic",
      "audrey denney": "Democratic",
      "janice karrman": "Democratic",
      "timothy kelly": "Independent",
      "richard minner": "Independent",
      // CA US House 22 Open Primary
      "david valadao": "Republican",
      "jasmeet bains": "Democratic",
      "randy villegas": "Democratic",
      // CA US House 32 Open Primary
      "brad sherman": "Democratic",
      "jake levine": "Democratic",
      "larry thompson": "Republican",
      "marena lin": "Democratic",
      "chris ahuja": "Democratic",
      "anna wilding": "Democratic",
      "dory benami": "Democratic",
      "josh sautter": "Democratic",
      "doug smith": "Independent",
      // CA US House 34 Open Primary
      "jimmy gomez": "Democratic",
      "angela gonzales-torres": "Democratic",
      "calvin lee": "Republican",
      "robert lucero": "Democratic",
      "robert george lucero": "Democratic",
      "robert george lucero jr": "Democratic",
      "arthur dixon": "Democratic",
      "loren colin": "Independent",
      // CA US House 40 Open Primary
      "young kim": "Republican",
      "ken calvert": "Republican",
      "esther kim-varet": "Democratic",
      "joe kerr": "Democratic",
      "lisa ramirez": "Democratic",
      "claude keissieh": "Democratic",
      "francis hoffman": "Democratic",
      "nina linh": "Independent",
      // CA US House 11 Open Primary
      "scott wiener": "Democratic",
      "connie chan": "Democratic",
      "saikat chakrabarti": "Democratic",
      "david ganezer": "Republican",
      "marie hurabiell": "Democratic",
      "jingchao xiong": "Independent",
      "gregory haynes": "Democratic",
      "john buffler": "Democratic",
      "nathan deer": "Independent",
      "keith freedman": "Democratic",
      "omed hamid": "Democratic",
      // CA US House 48 Open Primary
      "jim desmond": "Republican",
      "marni von wilpert": "Democratic",
      "ammar campa-najjar": "Democratic",
      "kevin o'neil": "Republican",
      "kevin o’neil": "Republican",
      "kevin o'neil": "Republican",
      "brandon riker": "Democratic",
      "abel chavez": "Democratic",
      "corinna contreras": "Democratic",
      "mike schaefer": "Democratic",
      "stephen clemons": "Democratic",
      "luis reyna": "Independent",
      "eric shaw": "Democratic",
      "ferguson porter": "Democratic"
    };
    
    const normalizedCandidateName = normalizeName(name);
    for (const [key, correction] of Object.entries(partyCorrections)) {
      if (name.includes(key) || normalizedCandidateName.includes(normalizeName(key))) {
        party = correction;
        break;
      }
    }
  }
  
  const normalized = {
    name: candidate.name || "Unknown",
    party,
    partyCode: partyCode(party),
    color: candidate.color || "",
    votes: Number(candidate.votes || 0),
    percent: Number(candidate.percent || 0),
    winner: false,
    apiWinner: Boolean(candidate.winner),
    callStatus: "",
    callLabel: ""
  };
  return normalized;
}

function racePriority(race) {
  const base = TYPE_PRIORITY[race.type] || 20;
  const reporting = Number(race.percent_reporting || 0);
  const candidateBonus = Math.min(10, (race.candidates?.length || 0) / 2);
  return base + reporting / 20 + candidateBonus;
}

function clampPercent(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function roundPercent(value) {
  const percent = clampPercent(value);
  return percent === null ? null : Math.round(percent * 100) / 100;
}

function totalCandidateVotes(candidates = []) {
  return candidates.reduce((sum, candidate) => sum + Number(candidate.votes || 0), 0);
}

function slugForRace(race) {
  const state = String(race.state || race.province || "").toLowerCase();
  if (!state) return "";
  const type = String(race.electionType || race.type || "").toLowerCase();
  const district = districtNumber(race.district);
  if (state === "ca" && type.includes("governor") && !type.includes("lieutenant")) return "california-governor-results";
  if (state === "ca" && type.includes("lieutenant")) return "california-lieutenant-governor-results";
  if (state === "ca" && type.includes("mayor")) return "los-angeles-mayor-results";
  if (state === "ca" && type.includes("house") && district) return `california-us-house-district-${district}-results`;
  if (state === "ia" && type.includes("senate")) return "iowa-senate-results";
  if (state === "ia" && type.includes("governor")) return "iowa-governor-results";
  if (state === "mt" && type.includes("senate")) return "montana-senate-results";
  if (state === "mt" && type.includes("house") && district) return `montana-us-house-district-${district}-results`;
  if (state === "nj" && type.includes("senate")) return "new-jersey-senate-results";
  if (state === "nj" && type.includes("house") && district) return `new-jersey-us-house-district-${district}-results`;
  if (state === "nm" && type.includes("senate")) return "new-mexico-senate-results";
  if (state === "nm" && type.includes("governor")) return "new-mexico-governor-results";
  if (state === "sd" && type.includes("senate")) return "south-dakota-senate-results";
  if (state === "sd" && type.includes("governor")) return "south-dakota-governor-results";
  return "";
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function raceMatchesExternalSummary(race, summary = {}) {
  const district = districtNumber(race.district);
  if (district && String(summary.district || "") !== district) return false;
  const scope = normalizeName([
    race.electionScope,
    race.election_scope,
    race.electionName,
    race.election_name,
    race.electionType,
    race.election_type,
    race.type
  ].filter(Boolean).join(" "));
  const raceName = normalizeName(`${summary.officeName || ""} ${summary.raceName || ""}`);
  if (scope.includes("republican") || scope === "r" || scope.includes("gop")) return /\br\b/.test(raceName);
  if (scope.includes("democratic") || scope === "d") return /\bd\b/.test(raceName);
  const localType = normalizeName(race.electionType || race.type);
  return !district || normalizeName(summary.office || summary.officeName || "").includes(localType.split(" ")[0]);
}

function districtNumber(value) {
  if (value === null || value === undefined || value === "") return "";
  const match = String(value).match(/\d+/);
  if (!match) return "";
  return String(Number(match[0]));
}

function geometryCycleForRace(race) {
  const type = String(race?.type || race?.electionType || "").toLowerCase();
  const name = String(race?.electionName || race?.election_name || "").toLowerCase();
  if ((type.includes("house") || name.includes("house")) && districtNumber(race?.district)) return 119;
  return null;
}

function normalizeNbcRaceEstimate(race, nbcRace, sourceUrl) {
  const summary = nbcRace.summary || nbcRace;
  const percent = roundPercent(summary.percentIn);
  const counties = {};
  for (const area of nbcRace.areas || []) {
    const areaPercent = roundPercent(area.percentIn);
    if (areaPercent === null) continue;
    counties[normalizeName(area.name)] = {
      estimatedVoteReporting: areaPercent,
      source: "NBC News",
      sourceUrl
    };
  }
  return {
    estimatedVoteReporting: percent,
    estimatedVoteReportingSource: percent === null ? "external-estimate-pending" : "nbc-news-percent-in",
    sourceUrl,
    counties
  };
}

function nbcUrlFor(source) {
  return source?.slug ? `${NBC_BASE}/${source.slug}` : "";
}

function partyNameFromNbc(value) {
  const text = String(value || "").toLowerCase();
  if (text === "dem" || text === "d" || text.includes("democratic")) return "Democratic";
  if (text === "gop" || text === "rep" || text === "r" || text.includes("republican")) return "Republican";
  if (text.includes("green")) return "Green";
  if (text.includes("lib")) return "Libertarian";
  if (text.includes("ind") || text.includes("np") || text.includes("no party")) return "Independent";
  if (text === "other" || text === "oth") return "Independent";
  return value ? String(value) : "";
}

function normalizeNbcCandidate(candidate, race) {
  const party = partyNameFromNbc(candidate.party);
  return withManualCall({
    name: candidate.name || [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") || "Unknown",
    party,
    partyCode: partyCode(party),
    color: "",
    votes: Number(candidate.votes || 0),
    percent: Number(candidate.percentVote ?? candidate.formattedPercentVote ?? 0),
    winner: Boolean(candidate.isWinner || candidate.winner),
    apiWinner: Boolean(candidate.isWinner || candidate.winner),
    headshotUrl: candidate.headshotUrl || "",
    incumbent: Boolean(candidate.isIncumbent),
    callStatus: "",
    callLabel: ""
  }, race);
}

function nbcRaceParty(summary = {}) {
  const summaryParty = partyCode(partyNameFromNbc(summary.party || summary.partyCode || summary.electionTypeCode || ""));
  if (summaryParty) return summaryParty;
  const text = normalizeName(`${summary.officeName || ""} ${summary.raceName || ""}`);
  if (/\br\b/.test(text)) return "R";
  if (/\bd\b/.test(text)) return "D";
  return "";
}

function nbcRaceMatchesSource(nbcRace, source = {}) {
  const summary = nbcRace.summary || {};
  const officeName = String(summary.officeName || "");
  if (!source.rcv && /\bRCV\b/i.test(officeName)) return false;
  if (source.rcv && !/\bRCV\b/i.test(officeName)) return false;
  if (source.party && nbcRaceParty(summary) !== source.party) return false;
  const sourceDistrict = districtNumber(source.district);
  if (sourceDistrict && districtNumber(summary.district) !== sourceDistrict) return false;
  return true;
}

async function fetchNbcSource(source) {
  const url = nbcUrlFor(source);
  if (!url) return null;
  return cachedFetchJson(NBC_SLUG_CACHE, url);
}

function electionScopeFromNbc(summary = {}, source = {}) {
  if (source.party === "D") return "Democratic Primary";
  if (source.party === "R") return "Republican Primary";
  const raceName = normalizeName(`${summary.raceName || ""} ${summary.officeName || ""}`);
  if (/\bd\b/.test(raceName)) return "Democratic Primary";
  if (/\br\b/.test(raceName)) return "Republican Primary";
  if (raceName.includes("primary") || String(source.name || "").toLowerCase().includes("primary")) return "Open Primary";
  return summary.electionTypeCode || "";
}

function electionTypeFromNbc(summary = {}, source = {}) {
  return source.type || summary.office || summary.officeName || "Race";
}

function normalizeNbcRace(id, source, data, nbcRace, options = {}) {
  const summary = nbcRace.summary || {};
  const raceBase = {
    id: String(id),
    state: source.state || data.stateAbbr || "",
    province: source.state || data.stateAbbr || "",
    type: electionTypeFromNbc(summary, source),
    electionName: source.name || summary.linkText || summary.officeName || "Race",
    electionScope: electionScopeFromNbc(summary, source),
    election_scope: electionScopeFromNbc(summary, source),
    pollsClose: isoDate(summary.pollsCloseUTC),
    polls_close: isoDate(summary.pollsCloseUTC)
  };
  const rawCandidates = Array.isArray(summary.candidates) ? summary.candidates : [];
  const hasVotes = rawCandidates.some((candidate) => Number(candidate.votes || 0) || Number(candidate.percentVote || 0));
  let candidates = rawCandidates.map((candidate, index) => ({ ...normalizeNbcCandidate(candidate, raceBase), sourceOrder: index }));
  candidates = candidates.sort((a, b) => {
    if (hasVotes) return b.votes - a.votes || b.percent - a.percent;
    const rankDelta = featuredRank(id, a.name) - featuredRank(id, b.name);
    return Number.isFinite(rankDelta) ? rankDelta : a.sourceOrder - b.sourceOrder;
  }).map(({ sourceOrder, ...candidate }) => candidate);
  const manualCalls = readManualCalls();
  const explicitCalls = manualCalls.races?.[String(id)]?.calls || [];
  const automaticCalls = explicitCalls.length ? [] : automaticUncontestedCalls(raceBase, candidates);
  const calls = explicitCalls.length ? explicitCalls : automaticCalls;
  if (automaticCalls.length) {
    candidates = candidates.map((candidate) => {
      const call = automaticCalls.find((item) => normalizeName(item.candidate) === normalizeName(candidate.name));
      return call ? { ...candidate, callStatus: call.status || "winner", callLabel: callLabelFor(raceBase, call) } : candidate;
    });
  }
  const leader = candidates[0] || null;
  const sourceUrl = nbcUrlFor(source);
  const district = source.atLarge ? null : (source.district ?? (summary.district ? `${raceBase.state}-${String(summary.district).padStart(2, "0")}` : null));
  const counties = (nbcRace.areas || []).map((area) => {
    const areaRace = { ...raceBase, id: String(id) };
    const areaCandidates = (area.candidates || [])
      .map((candidate) => normalizeNbcCandidate(candidate, areaRace))
      .sort((a, b) => b.votes - a.votes || b.percent - a.percent);
    return {
      id: slugify(area.name || area.areaId || ""),
      name: area.name || "",
      type: area.areaType || "County",
      fips: area.fips || area.id || "",
      percentReporting: roundPercent(area.percentIn) ?? 0,
      estimatedVoteReporting: roundPercent(area.percentIn),
      estimatedVoteReportingSource: "nbc-news-percent-in",
      estimatedVoteReportingSourceUrl: sourceUrl,
      candidates: areaCandidates
    };
  }).filter((area) => area.name).sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: String(id),
    source: "NBC News",
    sourceUrl,
    type: raceBase.type,
    country: "US",
    state: raceBase.state,
    stateName: source.stateName || data.stateName || raceBase.state,
    district,
    geometryCycle: geometryCycleForRace({ ...raceBase, district }),
    municipality: source.municipality ?? null,
    electionName: raceBase.electionName,
    electionType: raceBase.type,
    electionScope: raceBase.electionScope,
    electionDate: isoElectionDate(nbcRace.electionDate || data.electionDate),
    pollsOpen: null,
    pollsClose: raceBase.pollsClose,
    lastUpdated: isoDate(data.currentTime || data.lastUpdated || data.updatedAt || nbcRace.lastUpdated),
    percentReporting: roundPercent(summary.percentIn) ?? 0,
    estimatedVoteReporting: roundPercent(summary.percentIn),
    estimatedVoteReportingSource: "nbc-news-percent-in",
    estimatedVoteReportingSourceUrl: sourceUrl,
    hasBreakdown: counties.length > 0,
    hasMap: Boolean(nbcRace.mapData || counties.length),
    marker: electionMarkerFor(raceBase, candidates),
    leaderName: leader?.name || "",
    leaderParty: leader?.party || "",
    leaderPartyCode: leader?.partyCode || "",
    otherCandidateCount: Math.max(0, candidates.length - 1),
    calls: calls.map((call) => ({ ...call })),
    featuredCandidateNames: featuredNamesForRace(id),
    candidates,
    registeredVoters: null,
    maps: [],
    voteHistory: [],
    counties: options.includeCounties === false ? undefined : counties
  };
}

async function fetchNbcRaceDetail(id, options = {}) {
  const source = NBC_RACE_SOURCES[String(id)];
  if (!source || source.staticOnly) return null;
  const data = await fetchNbcSource(source);
  const topLevelRaces = Array.isArray(data?.races) ? data.races : [];
  const districtTableRaces = Array.isArray(data?.districtTables)
    ? data.districtTables.flatMap((table) => (table.races || []).map((race) => ({
      ...race,
      summary: {
        ...race,
        party: table.party,
        electionTypeCode: table.electionTypeCode,
        officeName: table.title,
        raceName: table.title
      }
    })))
    : [];
  const sourceRaces = [...topLevelRaces, ...districtTableRaces];
  const matched = sourceRaces.find((race) => nbcRaceMatchesSource(race, source))
    || (sourceRaces.length === 1 ? sourceRaces[0] : null);
  if (!matched) throw new Error(`NBC source ${source.slug} did not include matching race ${id}`);
  return normalizeNbcRace(id, source, data, matched, options);
}

function readStaticRaceDetail(id) {
  const rawText = readFileSync(new URL(`${id}.json`, DETAIL_DIR_URL), "utf8");
  const cleanText = rawText.includes("<<<<<<<")
    ? rawText.replace(/<<<<<<<[^\r\n]*\r?\n([\s\S]*?)\r?\n=======\r?\n[\s\S]*?\r?\n>>>>>>>[^\r\n]*(?:\r?\n)?/g, "$1\n")
    : rawText;
  const raw = JSON.parse(cleanText);
  return {
    ...raw,
    source: normalizeName(raw.source) === "civicapi" ? "Static local cache" : raw.source,
    sourceNote: raw.sourceNote || "NBC does not currently expose a result feed for this covered race, so this card uses the last local result file until an NBC source is configured."
  };
}

async function fetchCivicRaceDetail(id, options = {}) {
  const source = NBC_RACE_SOURCES[String(id)] || {};
  const url = `${CIVIC_RACE_BASE}/${encodeURIComponent(id)}`;
  const data = await cachedFetchJson(civicApiCache, url);
  const group = {
    state: source.state || data.province || data.state || "",
    name: source.stateName || data.stateName || data.province || data.state || ""
  };
  const race = normalizeRace({ ...data, id: String(id) }, group, {
    ...options,
    source: "CivicAPI",
    sourceUrl: url,
    sourceNote: "NBC does not currently expose this race directly, so candidate and vote totals come from CivicAPI. Estimated-in remains from NBC where available."
  });
  const externalEstimate = await fetchBestExternalEstimate(race);
  return applyExternalEstimateToDetail(race, externalEstimate);
}

async function fetchExternalEstimate(race) {
  const slug = slugForRace(race);
  if (!slug) return null;
  const url = `${NBC_BASE}/${slug}`;
  let data;
  try {
    data = await cachedFetchJson(externalEstimateCache, url);
  } catch {
    return null;
  }
  const candidates = Array.isArray(data.races) ? data.races : [];
  const districtTables = Array.isArray(data.districtTables)
    ? data.districtTables.flatMap((table) => table.races || [])
    : [];
  const sourceRaces = [...candidates, ...districtTables];
  const matched = sourceRaces.find((item) => raceMatchesExternalSummary(race, item.summary || item))
    || (sourceRaces.length === 1 ? sourceRaces[0] : null);
  return matched ? normalizeNbcRaceEstimate(race, matched, url) : null;
}

async function fetchStatewideEstimateFallback(race) {
  const state = String(race.state || race.province || "").toUpperCase();
  const slug = STATE_ESTIMATE_FALLBACK_SLUGS[state];
  if (!slug || slug === slugForRace(race)) return null;
  const url = `${NBC_BASE}/${slug}`;
  let data;
  try {
    data = await cachedFetchJson(externalEstimateCache, url);
  } catch {
    return null;
  }
  const sourceRace = Array.isArray(data.races) ? data.races[0] : null;
  if (!sourceRace) return null;
  const estimate = normalizeNbcRaceEstimate(race, sourceRace, url);
  return {
    ...estimate,
    estimatedVoteReportingSource: estimate.estimatedVoteReporting === null
      ? "external-estimate-pending"
      : "nbc-news-statewide-percent-in-fallback"
  };
}

async function fetchBestExternalEstimate(race) {
  const direct = await fetchExternalEstimate(race);
  if (direct?.estimatedVoteReporting !== null && direct?.estimatedVoteReporting !== undefined) return direct;
  const fallback = await fetchStatewideEstimateFallback(race);
  return fallback || direct;
}

function externalCountyEstimateFor(county, externalEstimate) {
  if (!county || !externalEstimate?.counties) return null;
  const key = normalizeName(county.name || county.id || "");
  const direct = externalEstimate.counties[key];
  if (direct) return direct;
  const compactKey = key.replace(/\s+/g, "");
  const matchedKey = Object.keys(externalEstimate.counties).find((countyKey) => countyKey.replace(/\s+/g, "") === compactKey);
  return matchedKey ? externalEstimate.counties[matchedKey] : null;
}

function applyExternalEstimateToDetail(detail, externalEstimate) {
  if (!externalEstimate) return detail;
  const counties = (detail.counties || []).map((county) => {
    const countyEstimate = externalCountyEstimateFor(county, externalEstimate);
    return countyEstimate
      ? {
        ...county,
        estimatedVoteReporting: countyEstimate.estimatedVoteReporting,
        estimatedVoteReportingSource: "nbc-news-percent-in",
        estimatedVoteReportingSourceUrl: countyEstimate.sourceUrl || externalEstimate.sourceUrl || detail.estimatedVoteReportingSourceUrl || ""
      }
      : county;
  });
  return {
    ...detail,
    estimatedVoteReporting: externalEstimate.estimatedVoteReporting ?? detail.estimatedVoteReporting ?? null,
    estimatedVoteReportingSource: externalEstimate.estimatedVoteReporting !== null && externalEstimate.estimatedVoteReporting !== undefined
      ? externalEstimate.estimatedVoteReportingSource
      : detail.estimatedVoteReportingSource,
    estimatedVoteReportingSourceUrl: externalEstimate.sourceUrl || detail.estimatedVoteReportingSourceUrl || "",
    counties
  };
}

function calculateGroupEstimatedVoteReporting(races) {
  if (!races || races.length === 0) return null;

  let totalWeight = 0;
  let weightedSum = 0;

  for (const race of races) {
    if (race.estimatedVoteReporting === null || race.estimatedVoteReporting === undefined) continue;
    const totalVotes = (race.candidates || []).reduce((sum, candidate) => sum + Number(candidate.votes || 0), 0);
    const weight = Math.max(100, totalVotes);
    weightedSum += Number(race.estimatedVoteReporting) * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return null;
  return roundPercent(weightedSum / totalWeight);
}

function normalizeRace(race, group, options = {}) {
  const candidateHasVotes = (race.candidates || []).some((candidate) => Number(candidate.votes || 0) || Number(candidate.percent || 0));
  const candidates = (race.candidates || []).map((candidate, index) => ({ ...normalizeCandidate(candidate), sourceOrder: index }))
    .sort((a, b) => {
      if (candidateHasVotes) return b.votes - a.votes || b.percent - a.percent;
      const rankDelta = featuredRank(race.id, a.name) - featuredRank(race.id, b.name);
      return Number.isFinite(rankDelta) ? rankDelta : a.sourceOrder - b.sourceOrder;
    })
    .map(({ sourceOrder, ...candidate }) => candidate);
  const calledCandidates = candidates.map((candidate) => withManualCall(candidate, race));
  const manualCalls = readManualCalls();
  const explicitCalls = manualCalls.races?.[String(race.id)]?.calls || [];
  const calls = explicitCalls.length ? explicitCalls : automaticUncontestedCalls(race, candidates);
  const finalCandidates = calls.length && !explicitCalls.length
    ? calledCandidates.map((candidate) => {
      const call = calls.find((item) => String(item.candidate || "").toLowerCase() === String(candidate.name || "").toLowerCase());
      return call ? { ...candidate, callStatus: call.status || "", callLabel: callLabelFor(race, call) } : candidate;
    })
    : calledCandidates;
  const leader = candidates[0] || null;
  const marker = electionMarkerFor(race, candidates);
  const normalizedRace = {
    ...race,
    id: String(race.id),
    electionName: race.election_name || `${group.name} ${race.type || "Race"}`,
    electionType: race.election_type || "",
    electionScope: race.election_scope || race.election_type || ""
  };
  const counties = options.includeCounties === false
    ? undefined
    : normalizeRegionResults(race.region_results || race.regionResults, normalizedRace, options.externalEstimate || null);
  return {
    id: String(race.id),
    source: options.source || "Legacy local cache",
    sourceUrl: options.sourceUrl || "",
    sourceNote: options.sourceNote || "",
    type: race.type || "Race",
    country: race.country || "US",
    state: race.province || group.state,
    stateName: group.name,
    district: race.district ?? null,
    geometryCycle: geometryCycleForRace(race),
    municipality: race.municipality ?? null,
    electionName: race.election_name || `${group.name} ${race.type || "Race"}`,
    electionType: race.election_type || "",
    electionScope: race.election_scope || race.election_type || "",
    electionDate: isoElectionDate(race.election_date),
    pollsOpen: isoDate(race.polls_open),
    pollsClose: isoDate(race.polls_close),
    lastUpdated: isoDate(race.last_updated),
    percentReporting: Number(race.percent_reporting || 0),
    estimatedVoteReporting: null,
    estimatedVoteReportingSource: "external-estimate-pending",
    hasBreakdown: Boolean(race.has_breakdown),
    hasMap: Boolean(race.has_map),
    marker,
    leaderName: leader?.name || "",
    leaderParty: leader?.party || "",
    leaderPartyCode: leader?.partyCode || "",
    otherCandidateCount: Math.max(0, candidates.length - 1),
    calls: calls.map((call) => ({ ...call })),
    featuredCandidateNames: featuredNamesForRace(race.id),
    candidates: finalCandidates,
    registeredVoters: race.registered_voters ?? null,
    maps: Array.isArray(race.maps) ? race.maps : [],
    voteHistory: Array.isArray(race.voteHistory) ? race.voteHistory : [],
    counties
  };
}

function normalizeRegionResults(regionResults, race, externalEstimate = null) {
  if (!regionResults || typeof regionResults !== "object") return [];
  return Object.entries(regionResults).map(([key, region]) => {
    const candidates = (region.candidates || []).map((candidate) => withManualCall(normalizeCandidate(candidate), race))
      .sort((a, b) => b.votes - a.votes || b.percent - a.percent);
    const precinctReporting = clampPercent(region.percent_reporting);
    const externalCounty = externalCountyEstimateFor({ id: key, name: region.name }, externalEstimate);

    return {
      id: key,
      name: region.name || key.replace(/_/g, " "),
      type: region.type || "County",
      fips: region.fips || "",
      percentReporting: precinctReporting ?? 0,
      estimatedVoteReporting: externalCounty?.estimatedVoteReporting ?? null,
      estimatedVoteReportingSource: externalCounty?.source ? "nbc-news-percent-in" : "external-estimate-pending",
      candidates
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function voteHistoryPoint(race) {
  return {
    at: new Date().toISOString(),
    sourceUpdatedAt: isoDate(race.lastUpdated) || "",
    reporting: Number(race.estimatedVoteReporting ?? race.percentReporting ?? 0),
    candidates: (race.candidates || []).map((candidate) => ({
      name: candidate.name,
      party: candidate.party,
      partyCode: candidate.partyCode,
      votes: Number(candidate.votes || 0),
      percent: Number(candidate.percent || 0),
      color: candidate.color || ""
    }))
  };
}

function voteHistorySignature(point) {
  const candidates = (point?.candidates || [])
    .map((candidate) => [
      normalizeName(candidate.name),
      Number(candidate.votes || 0)
    ].join(":"))
    .sort()
    .join("|");
  return candidates;
}

function voteHistoryTotalVotes(point) {
  return (point?.candidates || []).reduce((sum, candidate) => sum + Number(candidate.votes || 0), 0);
}

function normalizeHistoryCandidate(candidate) {
  return {
    name: candidate.name || candidate.candidate || candidate.candidate_name || "",
    party: candidate.party || candidate.party_name || "",
    partyCode: candidate.partyCode || candidate.party_code || partyCode(candidate.party || candidate.party_name || ""),
    votes: Number(candidate.votes ?? candidate.vote_count ?? candidate.total_votes ?? 0),
    percent: Number(candidate.percent ?? candidate.percentage ?? candidate.vote_share ?? 0),
    color: candidate.color || ""
  };
}

function voteHistoryFromCivicDetail(detail) {
  const rawHistory = detail?.vote_history
    || detail?.voteHistory
    || detail?.results_history
    || detail?.resultsHistory
    || detail?.timeline
    || detail?.updates
    || [];
  if (!Array.isArray(rawHistory)) return [];
  return rawHistory.map((entry) => {
    const candidates = entry.candidates || entry.results || entry.vote_totals || entry.totals || [];
    return {
      at: isoDate(entry.at || entry.timestamp || entry.time || entry.updated_at || entry.last_updated) || "",
      sourceUpdatedAt: isoDate(entry.sourceUpdatedAt || entry.last_updated || entry.updated_at) || "",
      reporting: Number(entry.reporting ?? entry.percent_reporting ?? entry.estimatedVoteReporting ?? 0),
      candidates: Array.isArray(candidates) ? candidates.map(normalizeHistoryCandidate).filter((candidate) => candidate.name) : []
    };
  }).filter((point) => point.at && point.candidates.length);
}

function mergeVoteHistory(...histories) {
  const byKey = new Map();
  for (const history of histories) {
    for (const point of Array.isArray(history) ? history : []) {
      const at = isoDate(point.at || point.updatedAt || point.timestamp || point.time);
      if (!at) continue;
      const normalized = {
        at,
        sourceUpdatedAt: isoDate(point.sourceUpdatedAt) || "",
        reporting: Number(point.reporting ?? point.estimatedVoteReporting ?? 0),
        candidates: (point.candidates || []).map(normalizeHistoryCandidate).filter((candidate) => candidate.name)
      };
      if (!normalized.candidates.length) continue;
      byKey.set(at.slice(0, 19), normalized);
    }
  }
  return [...byKey.values()].sort((a, b) => new Date(a.at) - new Date(b.at));
}

function appendVoteHistory(race) {
  let stored = [];
  try {
    const previous = JSON.parse(readFileSync(new URL(`${race.id}.json`, DETAIL_DIR_URL), "utf8"));
    stored = Array.isArray(previous.voteHistory) ? previous.voteHistory : [];
  } catch {
    stored = [];
  }
  stored = mergeVoteHistory(race.voteHistory || [], stored);
  const point = voteHistoryPoint(race);
  if (!voteHistoryTotalVotes(point) && !stored.some((entry) => voteHistoryTotalVotes(entry))) {
    return [];
  }
  const latest = stored.at(-1);
  const pointSignature = voteHistorySignature(point);
  if (latest && voteHistorySignature(latest) === pointSignature) {
    return stored.slice(-240);
  }
  return [...stored, point].slice(-240);
}

function isRaceCloseOrUncalled(race) {
  if (!race) return true;
  const percentReporting = Number(race.estimatedVoteReporting ?? race.percentReporting ?? 0);
  const hasCall = race.calls && race.calls.length > 0;
  const candidates = race.candidates || [];
  
  // If reporting is below 95%, always check
  if (percentReporting < 95) return true;
  
  // If above 95% but no call, check if race is close
  if (!hasCall && candidates.length >= 2) {
    const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
    if (sorted.length >= 2) {
      const leader = sorted[0];
      const runnerUp = sorted[1];
      const leaderVotes = leader.votes || 0;
      const runnerUpVotes = runnerUp.votes || 0;
      const totalVotes = leaderVotes + runnerUpVotes;
      if (totalVotes > 0) {
        const margin = Math.abs(leaderVotes - runnerUpVotes) / totalVotes;
        // If margin is less than 5%, consider it close and keep checking
        if (margin < 0.05) return true;
      }
    }
  }
  
  return false;
}

async function fetchRaceDetail(id) {
  if (MANUAL_RACES[String(id)]) {
    return MANUAL_RACES[String(id)];
  }

  // Check cache for races that are >95% reporting and not close/uncalled
  const cached = raceDetailCache.get(String(id));
  if (cached) {
    const age = Date.now() - cached.timestamp;
    if (age < RACE_DETAIL_CACHE_MS && !isRaceCloseOrUncalled(cached.data)) {
      return cached.data;
    }
  }
  
  let nbcError = null;
  try {
    const nbcRace = await fetchNbcRaceDetail(id);
    if (nbcRace) {
      // Cache the result if it's >95% reporting and not close/uncalled
      if (!isRaceCloseOrUncalled(nbcRace)) {
        raceDetailCache.set(String(id), { data: nbcRace, timestamp: Date.now() });
      }
      return nbcRace;
    }
  } catch (error) {
    nbcError = error;
  }

  const source = NBC_RACE_SOURCES[String(id)];
  const canTryCivic = /^\d+$/.test(String(id));
  if (canTryCivic || STATIC_NBC_UNSUPPORTED_RACES.has(String(id))) {
    try {
      const civicRace = await fetchCivicRaceDetail(id);
      // Cache the result if it's >95% reporting and not close/uncalled
      if (!isRaceCloseOrUncalled(civicRace)) {
        raceDetailCache.set(String(id), { data: civicRace, timestamp: Date.now() });
      }
      return civicRace;
    } catch (error) {
      if (STATIC_NBC_UNSUPPORTED_RACES.has(String(id))) {
        const fallback = readStaticRaceDetail(id);
        return {
          ...fallback,
          sourceNote: `${fallback.sourceNote || "Using local cache."} CivicAPI fallback failed: ${error.message}`
        };
      }
      if (nbcError) {
        throw new Error(`${nbcError.message}; CivicAPI fallback failed: ${error.message}`);
      }
      throw error;
    }
  }
  if (source && nbcError) throw nbcError;
  throw new Error(`No NBC result source configured for race ${id}`);
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
  const requiredIds = REQUIRED_RACES_BY_STATE[group.state] || [];
  const requiredRaces = [];
  for (const id of requiredIds) {
    if (MANUAL_RACES[String(id)]) {
      requiredRaces.push(MANUAL_RACES[String(id)]);
      continue;
    }
    try {
      const detailRace = await fetchRaceDetail(id);
      requiredRaces.push({
        ...detailRace,
        stateName: group.name,
        counties: undefined
      });
    } catch (error) {
      console.warn(`Could not load required ${group.state} result race ${id}: ${error.message}`);
    }
  }
  const selectedRaces = requiredRaces
    .sort((a, b) => racePriority(b) - racePriority(a) || String(a.electionName).localeCompare(String(b.electionName)));
  const racesWithEstimate = selectedRaces;
  
  // Calculate group-level estimate from individual race estimates
  const estimatedVoteReporting = calculateGroupEstimatedVoteReporting(racesWithEstimate);

  return {
    state: group.state,
    stateName: group.name,
    sourceQuery: "NBC News result feeds",
    totalAvailable: selectedRaces.length,
    featuredCount: selectedRaces.length,
    estimatedVoteReporting,
    races: racesWithEstimate
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
        sourceQuery: "NBC News result feeds",
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
      name: "NBC News / CivicAPI fallback",
      url: "https://www.nbcnews.com/politics/2026-primary-elections",
      attribution: "Live race data is pulled from NBC News result feeds where NBC exposes a matching race. CivicAPI is used only for covered races NBC does not expose directly. Race calls are manual Federal Elections Analysis calls from local config.",
      estimatedVoteReporting: "Estimated-in percentages come from NBC News percent-in fields or NBC statewide fallback fields where available."
    },
    refreshSeconds: 15,
    groups,
    errors
  };
}

export async function buildRaceResultDetail(id) {
  const detail = await fetchRaceDetail(id);
  const externalEstimate = await fetchBestExternalEstimate(detail);
  return applyExternalEstimateToDetail(detail, externalEstimate);
}

export async function buildRaceResultDetailWithHistory(id, options = {}) {
  const detail = await buildRaceResultDetail(id);
  const hydratedDetail = {
    ...detail,
    voteHistory: appendVoteHistory(detail)
  };
  if (options.persist !== false) {
    mkdirSync(DETAIL_DIR_URL, { recursive: true });
    writeFileSync(new URL(`${id}.json`, DETAIL_DIR_URL), JSON.stringify(hydratedDetail, null, 2), "utf8");
  }
  return hydratedDetail;
}

export async function writeRaceDetails(data) {
  mkdirSync(DETAIL_DIR_URL, { recursive: true });
  const races = data.groups.flatMap((group) => group.races || []);
  let written = 0;
  for (const race of races) {
    try {
      await buildRaceResultDetailWithHistory(race.id);
      written += 1;
    } catch (error) {
      console.warn(`Could not write race detail for ${race.id}: ${error.message}`);
    }
  }
  return written;
}

export async function writeLiveResultsSnapshot(data, options = {}) {
  writeFileSync(OUTPUT_URL, JSON.stringify(data, null, 2), "utf8");
  if (options.details) return writeRaceDetails(data);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await buildLiveResults();
  const detailCount = await writeLiveResultsSnapshot(data, { details: true });
  console.log(`Wrote live results for ${data.groups.reduce((sum, group) => sum + group.races.length, 0)} featured races and ${detailCount} detail files`);
}
