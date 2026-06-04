import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const OUTPUT_URL = new URL("../data/live-results.json", import.meta.url);
const DETAIL_DIR_URL = new URL("../data/live-results-races/", import.meta.url);
const CALLS_URL = new URL("../data/result-calls.json", import.meta.url);
const FEATURED_CANDIDATES_URL = new URL("../data/result-featured-candidates.json", import.meta.url);
const CIVIC_BASE = "https://civicapi.org/api/v2";
const featuredCandidates = readFeaturedCandidates();
const manualCalls = readManualCalls();

const FEATURED_GROUPS = [
  { state: "CA", name: "California", queries: ["California Governor", "California Lieutenant Governor", "California Insurance Commissioner", "California Superintendent Public Instruction", "California US House", "California Los Angeles Mayor"] },
  { state: "IA", name: "Iowa", queries: ["Iowa US Senate", "Iowa US House", "Iowa Governor"] },
  { state: "MT", name: "Montana", queries: ["Montana US Senate", "Montana US House", "Montana Governor"] },
  { state: "NJ", name: "New Jersey", queries: ["New Jersey US Senate", "New Jersey US House", "New Jersey Governor"] },
  { state: "NM", name: "New Mexico", queries: ["New Mexico US Senate", "New Mexico US House", "New Mexico Governor"] },
  { state: "SD", name: "South Dakota", queries: ["South Dakota US Senate", "South Dakota US House", "South Dakota Governor"] }
];

const REQUIRED_RACES_BY_STATE = {
  CA: [79777, 79779, 79778, 79881, 79893, 79932, 79884, 79896, 79907, 79909, 79916, 79924, 79938],
  IA: [79945, 79944, 80211, 80210],
  MT: [80460, 80458, 80452],
  NJ: [81058, 81057, 81046, 81048, 81055],
  NM: [80691, 80690, 81014, 81015],
  SD: [80461, 80512]
};

const MANUAL_RACES = {
};

const POLL_CLOSE_UTC_BY_STATE = {
  CA: "2026-06-03T03:00:00Z",
  IA: "2026-06-03T01:00:00Z",
  MT: "2026-06-03T02:00:00Z",
  NJ: "2026-06-03T00:00:00Z",
  NM: "2026-06-03T01:00:00Z",
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2020) return null;
  return date.toISOString();
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

function featuredNamesForRace(raceId) {
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
  
  // CA Lieutenant Governor Open Primary - civicAPI incorrectly marks all as Nonpartisan
  // Correct party affiliations based on actual candidate party registrations
  const partyLower = party.toLowerCase();
  if (partyLower === "nonpartisan" || partyLower === "n" || partyLower === "") {
    const partyCorrections = {
      "fiona ma": "Democratic",
      "josh fryday": "Democratic", 
      "michael tubbs": "Democratic",
      "oliver ma": "Democratic",
      "gloria romero": "Republican",
      "david fennell": "Republican"
    };
    
    for (const [key, correction] of Object.entries(partyCorrections)) {
      if (name.includes(key)) {
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

function calculateEstimatedVoteReporting(race) {
  // Calculate estimated vote reporting for a single race
  // Since we lack access to historical turnout, voter registration, and population data
  // that major sources use, we use a conservative approach that stays closer to precinct reporting
  // for most races, with more aggressive adjustment only when precincts are nearly complete
  const precinctReporting = Number(race.percentReporting || race.percent_reporting || 0);
  
  // Use a much more conservative approach that matches observed patterns better
  // Most races should stay close to precinct reporting unless precincts are nearly complete
  let adjustmentFactor;
  if (precinctReporting < 60) {
    adjustmentFactor = 0.98; // Almost no adjustment for most races
  } else if (precinctReporting < 80) {
    adjustmentFactor = 0.95; // Slight adjustment
  } else if (precinctReporting < 90) {
    adjustmentFactor = 0.85; // Moderate adjustment
  } else if (precinctReporting < 95) {
    adjustmentFactor = 0.65; // Significant adjustment when nearly complete
  } else {
    adjustmentFactor = 0.58; // Most aggressive adjustment when precincts complete
  }
  
  const adjustedReporting = precinctReporting * adjustmentFactor;
  
  // Ensure result doesn't exceed 100% and is at least 0
  return Math.max(0, Math.min(100, Math.round(adjustedReporting * 100) / 100));
}

function calculateGroupEstimatedVoteReporting(races) {
  if (!races || races.length === 0) return 0;
  
  // Calculate group-level estimated vote reporting as weighted average of individual race estimates
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const race of races) {
    const raceEstimate = calculateEstimatedVoteReporting(race);
    const totalVotes = (race.candidates || []).reduce((sum, candidate) => sum + Number(candidate.votes || 0), 0);
    
    // Use vote count as weight, with minimum weight to ensure all races contribute
    const weight = Math.max(100, totalVotes);
    weightedSum += raceEstimate * weight;
    totalWeight += weight;
  }
  
  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

function normalizeRace(race, group) {
  const candidateHasVotes = (race.candidates || []).some((candidate) => Number(candidate.votes || 0) || Number(candidate.percent || 0));
  const candidates = (race.candidates || []).map((candidate, index) => ({ ...normalizeCandidate(candidate), sourceOrder: index }))
    .sort((a, b) => {
      if (candidateHasVotes) return b.votes - a.votes || b.percent - a.percent;
      const rankDelta = featuredRank(race.id, a.name) - featuredRank(race.id, b.name);
      return Number.isFinite(rankDelta) ? rankDelta : a.sourceOrder - b.sourceOrder;
    })
    .map(({ sourceOrder, ...candidate }) => candidate);
  const calledCandidates = candidates.map((candidate) => withManualCall(candidate, race));
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
    electionScope: race.election_scope || race.election_type || "",
    electionDate: isoDate(race.election_date),
    pollsOpen: isoDate(race.polls_open),
    pollsClose: isoDate(race.polls_close),
    lastUpdated: isoDate(race.last_updated),
    percentReporting: Number(race.percent_reporting || 0),
    estimatedVoteReporting: calculateEstimatedVoteReporting(race),
    hasBreakdown: Boolean(race.has_breakdown),
    hasMap: Boolean(race.has_map),
    marker,
    leaderName: leader?.name || "",
    leaderParty: leader?.party || "",
    leaderPartyCode: leader?.partyCode || "",
    otherCandidateCount: Math.max(0, candidates.length - 1),
    calls: calls.map((call) => ({ ...call })),
    featuredCandidateNames: featuredNamesForRace(race.id),
    candidates: finalCandidates
  };
}

function normalizeRegionResults(regionResults, race) {
  if (!regionResults || typeof regionResults !== "object") return [];
  return Object.entries(regionResults).map(([key, region]) => {
    const candidates = (region.candidates || []).map((candidate) => withManualCall(normalizeCandidate(candidate), race))
      .sort((a, b) => b.votes - a.votes || b.percent - a.percent);
    return {
      id: key,
      name: region.name || key.replace(/_/g, " "),
      type: region.type || "County",
      fips: region.fips || "",
      percentReporting: Number(region.percent_reporting || 0),
      candidates
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function voteHistoryPoint(race) {
  return {
    at: new Date().toISOString(),
    reporting: Number(race.percentReporting || 0),
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

function appendVoteHistory(race) {
  let stored = [];
  try {
    const previous = JSON.parse(readFileSync(new URL(`${race.id}.json`, DETAIL_DIR_URL), "utf8"));
    stored = Array.isArray(previous.voteHistory) ? previous.voteHistory : [];
  } catch {
    stored = [];
  }
  const point = voteHistoryPoint(race);
  const pointKey = point.at.slice(0, 16);
  const withoutCurrentMinute = stored.filter((item) => String(item.at || "").slice(0, 16) !== pointKey);
  return [...withoutCurrentMinute, point].slice(-240);
}

async function fetchRaceDetail(id) {
  const detail = await fetchJson(`${CIVIC_BASE}/race/${id}`);
  const group = {
    state: detail.province,
    name: detail.province || "Race"
  };
  const race = normalizeRace({ id, ...detail, type: detail.election_type, election_type: detail.election_scope }, group);
  return {
    ...race,
    electionType: detail.election_type || race.electionType,
    electionScope: detail.election_scope || race.electionScope,
    registeredVoters: detail.registered_voters || null,
    maps: detail.maps || [],
    counties: normalizeRegionResults(detail.region_results, { id, ...detail })
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
      const cachedRace = races.find((race) => String(race.id) === String(id));
      if (cachedRace) requiredRaces.push(cachedRace);
      else console.warn(`Could not load required ${group.state} result race ${id}: ${error.message}`);
    }
  }
  const selectedRaces = requiredRaces.length ? requiredRaces : races.slice(0, 7);
  
  // Calculate estimated vote reporting for each individual race
  const racesWithEstimate = selectedRaces.map(race => ({
    ...race,
    estimatedVoteReporting: calculateEstimatedVoteReporting(race)
  }));
  
  // Calculate group-level estimate from individual race estimates
  const estimatedVoteReporting = calculateGroupEstimatedVoteReporting(racesWithEstimate);

  return {
    state: group.state,
    stateName: group.name,
    sourceQuery: (group.queries || [group.query]).join(" / "),
    totalAvailable: Math.max(races.length, ...searches.map(({ data }) => Number(data.count || 0))),
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
      attribution: "Live race data provided by civicAPI where available. Race calls are manual Federal Elections Analysis calls from local config."
    },
    refreshSeconds: 15,
    groups,
    errors
  };
}

export async function buildRaceResultDetail(id) {
  return fetchRaceDetail(id);
}

async function writeRaceDetails(data) {
  mkdirSync(DETAIL_DIR_URL, { recursive: true });
  const races = data.groups.flatMap((group) => group.races || []);
  let written = 0;
  for (const race of races) {
    try {
      const detail = MANUAL_RACES[String(race.id)] || await buildRaceResultDetail(race.id);
      detail.voteHistory = appendVoteHistory(detail);
      writeFileSync(new URL(`${race.id}.json`, DETAIL_DIR_URL), JSON.stringify(detail, null, 2), "utf8");
      written += 1;
    } catch (error) {
      console.warn(`Could not write race detail for ${race.id}: ${error.message}`);
    }
  }
  return written;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const data = await buildLiveResults();
  writeFileSync(OUTPUT_URL, JSON.stringify(data, null, 2), "utf8");
  const detailCount = await writeRaceDetails(data);
  console.log(`Wrote live results for ${data.groups.reduce((sum, group) => sum + group.races.length, 0)} featured races and ${detailCount} detail files`);
}
