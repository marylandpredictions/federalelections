const FIPS_TO_STATE = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS",
  "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO",
  "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC",
  "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

const STATE_CENTER_LONS = {
  AL: -86.8, AK: -152.4, AZ: -111.7, AR: -92.4, CA: -119.7, CO: -105.5, CT: -72.7, DE: -75.5,
  FL: -82.4, GA: -83.4, HI: -157.5, IA: -93.5, ID: -114.6, IL: -89.2, IN: -86.3, KS: -98.5,
  KY: -85.3, LA: -91.9, MA: -71.8, MD: -76.7, ME: -69.0, MI: -85.5, MN: -94.6, MO: -92.5,
  MS: -89.7, MT: -110.4, NC: -79.0, ND: -100.5, NE: -99.8, NH: -71.6, NJ: -74.5, NM: -106.1,
  NV: -116.6, NY: -75.4, OH: -82.8, OK: -97.5, OR: -120.6, PA: -77.7, RI: -71.6, SC: -80.9,
  SD: -100.2, TN: -86.4, TX: -99.3, UT: -111.7, VA: -78.7, VT: -72.7, WA: -120.8, WI: -89.6,
  WV: -80.6, WY: -107.6
};

const PARTY_COLORS = {
  D: "#1687e8",
  R: "#df2e38",
  I: "#8b5cf6",
  L: "#d6a400",
  G: "#39b86b",
  U: "#6f7d95"
};

const MODE_LABELS = {
  house: "House",
  senate: "Senate",
  governor: "Governor"
};

const CHAMBER_CONFIG = {
  house: { total: 435, majority: 218, unit: "seats" },
  senate: { total: 100, majority: 51, unit: "seats" }
};

const NON_COUNTY_REPORTING_STATES = new Set(["ME", "VT", "MA", "CT", "RI", "NH"]);
const SENATE_NOT_UP_BY_PARTY = { D: 34, R: 33 };
const GOVERNOR_NOT_UP_BY_PARTY = { D: 8, R: 6 };
const KEY_RACE_IDS = new Set([
  "senate-AK", "senate-GA", "senate-ME", "senate-MI", "senate-NC", "senate-OH", "senate-TX",
  "governor-AK", "governor-AZ", "governor-GA", "governor-IA", "governor-KS", "governor-NV", "governor-OH",
  "house-AZ-1", "house-AZ-6", "house-CA-13", "house-CA-22", "house-CA-45", "house-CA-48",
  "house-CO-8", "house-FL-14", "house-FL-22", "house-FL-25", "house-IA-1", "house-IA-3",
  "house-MI-7", "house-MI-8", "house-MI-10", "house-NC-1", "house-NE-2", "house-NJ-7",
  "house-NM-2", "house-NV-3", "house-NY-3", "house-NY-4", "house-NY-17", "house-NY-19",
  "house-OH-1", "house-OH-9", "house-PA-7", "house-PA-8", "house-PA-10", "house-TX-28",
  "house-TX-34", "house-VA-1", "house-VA-2", "house-WA-3", "house-WI-3"
]);

const MAP_CITY_LABELS = [
  { name: "Los Angeles", state: "CA", lon: -118.2437, lat: 34.0522 },
  { name: "San Diego", state: "CA", lon: -117.1611, lat: 32.7157 },
  { name: "San Francisco", state: "CA", lon: -122.4194, lat: 37.7749 },
  { name: "Sacramento", state: "CA", lon: -121.4944, lat: 38.5816 },
  { name: "Fresno", state: "CA", lon: -119.7871, lat: 36.7378 },
  { name: "Reno", state: "NV", lon: -119.8138, lat: 39.5296 },
  { name: "Las Vegas", state: "NV", lon: -115.1398, lat: 36.1699 },
  { name: "Phoenix", state: "AZ", lon: -112.0740, lat: 33.4484 },
  { name: "Salt Lake City", state: "UT", lon: -111.8910, lat: 40.7608 },
  { name: "Dallas", state: "TX", lon: -96.7970, lat: 32.7767 },
  { name: "Houston", state: "TX", lon: -95.3698, lat: 29.7604 },
  { name: "Austin", state: "TX", lon: -97.7431, lat: 30.2672 },
  { name: "San Antonio", state: "TX", lon: -98.4936, lat: 29.4241 },
  { name: "Des Moines", state: "IA", lon: -93.6091, lat: 41.5868 },
  { name: "Billings", state: "MT", lon: -108.5007, lat: 45.7833 },
  { name: "Missoula", state: "MT", lon: -113.9966, lat: 46.8721 },
  { name: "Sioux Falls", state: "SD", lon: -96.7311, lat: 43.5460 },
  { name: "Bismarck", state: "ND", lon: -100.7837, lat: 46.8083 },
  { name: "Newark", state: "NJ", lon: -74.1724, lat: 40.7357 },
  { name: "Trenton", state: "NJ", lon: -74.7429, lat: 40.2171 },
  { name: "Portland", state: "ME", lon: -70.2553, lat: 43.6591 },
  { name: "Columbia", state: "SC", lon: -81.0348, lat: 34.0007 },
  { name: "Charleston", state: "SC", lon: -79.9311, lat: 32.7765 },
  { name: "Atlanta", state: "GA", lon: -84.3880, lat: 33.7490 },
  { name: "Chicago", state: "IL", lon: -87.6298, lat: 41.8781 },
  { name: "New York", state: "NY", lon: -74.0060, lat: 40.7128 },
  { name: "Philadelphia", state: "PA", lon: -75.1652, lat: 39.9526 },
  { name: "Washington", state: "DC", lon: -77.0369, lat: 38.9072 },
  { name: "Seattle", state: "WA", lon: -122.3321, lat: 47.6062 },
  { name: "Portland", state: "OR", lon: -122.6765, lat: 45.5152 },
  { name: "Boise", state: "ID", lon: -116.2023, lat: 43.6150 },
  { name: "Spokane", state: "WA", lon: -117.4260, lat: 47.6588 },
  { name: "Denver", state: "CO", lon: -104.9903, lat: 39.7392 },
  { name: "Albuquerque", state: "NM", lon: -106.6504, lat: 35.0844 },
  { name: "Tucson", state: "AZ", lon: -110.9747, lat: 32.2226 },
  { name: "Oklahoma City", state: "OK", lon: -97.5164, lat: 35.4676 },
  { name: "Tulsa", state: "OK", lon: -95.9928, lat: 36.1540 },
  { name: "Kansas City", state: "MO", lon: -94.5786, lat: 39.0997 },
  { name: "Omaha", state: "NE", lon: -95.9345, lat: 41.2565 },
  { name: "St. Louis", state: "MO", lon: -90.1994, lat: 38.6270 },
  { name: "Minneapolis", state: "MN", lon: -93.2650, lat: 44.9778 },
  { name: "Milwaukee", state: "WI", lon: -87.9065, lat: 43.0389 },
  { name: "Detroit", state: "MI", lon: -83.0458, lat: 42.3314 },
  { name: "Cleveland", state: "OH", lon: -81.6944, lat: 41.4993 },
  { name: "Columbus", state: "OH", lon: -82.9988, lat: 39.9612 },
  { name: "Cincinnati", state: "OH", lon: -84.5120, lat: 39.1031 },
  { name: "Indianapolis", state: "IN", lon: -86.1581, lat: 39.7684 },
  { name: "Louisville", state: "KY", lon: -85.7585, lat: 38.2527 },
  { name: "Nashville", state: "TN", lon: -86.7816, lat: 36.1627 },
  { name: "Memphis", state: "TN", lon: -90.0490, lat: 35.1495 },
  { name: "New Orleans", state: "LA", lon: -90.0715, lat: 29.9511 },
  { name: "Jackson", state: "MS", lon: -90.1848, lat: 32.2988 },
  { name: "Birmingham", state: "AL", lon: -86.8025, lat: 33.5186 },
  { name: "Charlotte", state: "NC", lon: -80.8431, lat: 35.2271 },
  { name: "Raleigh", state: "NC", lon: -78.6382, lat: 35.7796 },
  { name: "Richmond", state: "VA", lon: -77.4360, lat: 37.5407 },
  { name: "Norfolk", state: "VA", lon: -76.2859, lat: 36.8508 },
  { name: "Baltimore", state: "MD", lon: -76.6122, lat: 39.2904 },
  { name: "Boston", state: "MA", lon: -71.0589, lat: 42.3601 },
  { name: "Providence", state: "RI", lon: -71.4128, lat: 41.8240 },
  { name: "Hartford", state: "CT", lon: -72.6851, lat: 41.7658 },
  { name: "Manchester", state: "NH", lon: -71.4548, lat: 42.9956 },
  { name: "Burlington", state: "VT", lon: -73.2121, lat: 44.4759 },
  { name: "Miami", state: "FL", lon: -80.1918, lat: 25.7617 },
  { name: "Tampa", state: "FL", lon: -82.4572, lat: 27.9506 },
  { name: "Orlando", state: "FL", lon: -81.3792, lat: 28.5383 },
  { name: "Jacksonville", state: "FL", lon: -81.6557, lat: 30.3322 },
  { name: "Fargo", state: "ND", lon: -96.7898, lat: 46.8772 },
  { name: "Rapid City", state: "SD", lon: -103.2310, lat: 44.0805 },
  { name: "Cheyenne", state: "WY", lon: -104.8202, lat: 41.1400 },
  { name: "Little Rock", state: "AR", lon: -92.2896, lat: 34.7465 }
];

function partyColor(party) {
  return PARTY_COLORS[String(party || "U").toUpperCase()] || PARTY_COLORS.U;
}

function partyLabel(party) {
  const value = String(party || "U").toUpperCase();
  if (value === "D") return "Democratic";
  if (value === "R") return "Republican";
  if (value === "I") return "Independent";
  if (value === "L") return "Libertarian";
  if (value === "G") return "Green";
  return "Other";
}

function partyGroupLabel(party) {
  const value = String(party || "U").toUpperCase();
  if (value === "D") return "Democrats";
  if (value === "R") return "Republicans";
  if (value === "I") return "Independents";
  if (value === "L") return "Libertarians";
  if (value === "G") return "Greens";
  return "Others";
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(digits)}%`;
}

function formatVotes(value) {
  return Number.isFinite(value) && value > 0 ? value.toLocaleString() : "0";
}

function formatEasternTime(value = Date.now()) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function compactVotes(value) {
  const number = Number(value) || 0;
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}m`;
  if (number >= 1000) return `${(number / 1000).toFixed(0)}k`;
  return formatVotes(number);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function stringToNumber(value) {
  let hash = 0;
  for (const character of String(value || "")) hash = ((hash << 5) - hash) + character.charCodeAt(0);
  return Math.abs(hash);
}

function safePercent(candidate, raceTotal) {
  if (Number.isFinite(candidate.percent) && candidate.percent > 0) return candidate.percent;
  if (raceTotal > 0 && Number.isFinite(candidate.votes)) return (candidate.votes / raceTotal) * 100;
  return Number.isFinite(candidate.percent) ? candidate.percent : 0;
}

function hasVotes(race) {
  return (race?.candidates || []).some((candidate) => Number.isFinite(candidate.votes) && candidate.votes > 0);
}

function hasActiveResults(race) {
  return hasVotes(race) || Number(race?.reportingPercent || 0) > 0;
}

function isActuallyCalled(race) {
  return hasActiveResults(race) && (race?.status === "called" || (race?.candidates || []).some((candidate) => candidate.isWinner));
}

function totalVotes(race) {
  return (race?.candidates || []).reduce((sum, candidate) => sum + (Number(candidate.votes) || 0), 0);
}

function raceSnapshotKey(race) {
  return `fea-election-night-snapshot:${race?.id || race?.title || "race"}`;
}

function candidatePreviousPercent(race, candidate) {
  try {
    const saved = JSON.parse(localStorage.getItem(raceSnapshotKey(race)) || "{}");
    return Number(saved?.[candidate.name]);
  } catch {
    return NaN;
  }
}

function saveRaceSnapshot(race) {
  if (!race || !hasActiveResults(race)) return;
  const next = {};
  for (const candidate of race.candidates || []) next[candidate.name] = safePercent(candidate, totalVotes(race));
  try {
    localStorage.setItem(raceSnapshotKey(race), JSON.stringify(next));
  } catch {
    // Ignore private-browsing storage failures.
  }
}

function ensureRaceSnapshot(race) {
  if (!race || !hasActiveResults(race)) return;
  try {
    if (!localStorage.getItem(raceSnapshotKey(race))) saveRaceSnapshot(race);
  } catch {
    // Ignore private-browsing storage failures.
  }
}

function topCandidates(race, limit = 3) {
  const total = totalVotes(race);
  const live = hasActiveResults(race);
  return (race?.candidates || [])
    .map((candidate) => ({ ...candidate, percent: safePercent(candidate, total) }))
    .sort((a, b) => candidateSortValue(b, live) - candidateSortValue(a, live))
    .slice(0, limit);
}

function candidateSortValue(candidate, live) {
  if (live) return (Number(candidate.votes) || 0) * 1000 + (Number(candidate.percent) || 0);
  const party = normalizedPartyCode(candidate);
  const partyOrder = party === "D" ? 500 : party === "R" ? 490 : party === "I" ? 470 : 430;
  return partyOrder + (candidate.incumbent ? 100 : 0);
}

function countyTopCandidatesForElectionNight(county, limit = 3) {
  return [...(county?.candidates || [])]
    .map((candidate) => ({
      ...candidate,
      votes: Number(candidate.votes) || 0,
      percent: Number.isFinite(Number(candidate.percent)) ? Number(candidate.percent) : 0
    }))
    .sort((a, b) => (b.votes || b.percent || 0) - (a.votes || a.percent || 0))
    .slice(0, limit);
}

function countyPartyRows(county, limit = 3) {
  const groups = new Map();
  for (const candidate of county?.candidates || []) {
    const party = normalizedPartyCode(candidate);
    const current = groups.get(party) || { party, votes: 0 };
    current.votes += Number(candidate.votes) || 0;
    groups.set(party, current);
  }
  const total = [...groups.values()].reduce((sum, row) => sum + row.votes, 0);
  return [...groups.values()]
    .map((row) => ({ ...row, percent: total ? (row.votes / total) * 100 : 0 }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, limit);
}

function cleanCountyName(value) {
  return String(value || "")
    .replace(/\s+(County|Parish|Borough|Census Area|Municipality)$/i, "")
    .trim();
}

function regionLookupKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function countyLookupForElectionNight(race) {
  const lookup = new Map();
  for (const county of race?.counties || []) {
    const cleanName = cleanCountyName(county.name);
    if (county.fips) lookup.set(String(county.fips).padStart(5, "0"), county);
    lookup.set(String(county.name || "").toLowerCase(), county);
    lookup.set(String(cleanName).toLowerCase(), county);
    lookup.set(regionLookupKey(county.name), county);
    lookup.set(regionLookupKey(cleanName), county);
  }
  return lookup;
}

function featureStateFipsForElectionNight(feature) {
  const props = feature?.properties || {};
  const explicit = props.STATE || props.STATEFP;
  if (explicit) return String(explicit).padStart(2, "0");
  const id = String(feature?.id || "");
  return id.length >= 2 ? id.slice(0, 2).padStart(2, "0") : "";
}

function featureCountyFipsForElectionNight(feature) {
  const props = feature?.properties || {};
  return String(feature?.id || props.GEOID || props.countyFips || `${props.STATE || props.STATEFP || ""}${props.COUNTY || props.COUNTYFP || ""}`).padStart(5, "0");
}

function countyForFeature(feature, lookup) {
  const props = feature?.properties || {};
  const countyName = props.countyName || props.NAME || "";
  const cleanName = cleanCountyName(countyName);
  return lookup.get(featureCountyFipsForElectionNight(feature))
    || lookup.get(String(countyName).toLowerCase())
    || lookup.get(String(cleanName).toLowerCase())
    || lookup.get(regionLookupKey(countyName))
    || lookup.get(regionLookupKey(cleanName))
    || null;
}

function stateFipsForElectionNight(state) {
  const target = String(state || "").toUpperCase();
  return Object.entries(FIPS_TO_STATE).find(([, abbr]) => abbr === target)?.[0] || "";
}

function projectedRingPath(ring, projection) {
  const points = ring
    .map((point) => projection(point))
    .filter(Boolean);
  if (points.length < 3) return "";
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join("")}Z`;
}

function projectedFeaturePath(feature, projection) {
  const geometry = feature?.geometry;
  if (!geometry) return "";
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates || [];
  return polygons
    .flatMap((polygon) => polygon.map((ring) => projectedRingPath(ring, projection)))
    .filter(Boolean)
    .join("");
}

function raceLeader(race) {
  if (!hasActiveResults(race)) return null;
  return topCandidates(race, 1)[0] || null;
}

function raceWinnerParty(race) {
  const winner = (race?.candidates || []).find((candidate) => candidate.isWinner && hasActiveResults(race));
  return normalizedPartyCode(winner || raceLeader(race) || {});
}

function raceColor(race) {
  if (!race || !hasActiveResults(race)) return "#5f6b80";
  const candidates = topCandidates(race, 2);
  const leader = candidates[0];
  const runnerUp = candidates[1];
  if (!leader) return "#5f6b80";
  const margin = Math.max(0, (leader.percent || 0) - (runnerUp?.percent || 0));
  const strength = Math.max(0.44, Math.min(1, 0.46 + margin / 32));
  return d3.interpolateRgb("#cfd6e5", partyColor(normalizedPartyCode(leader)))(strength);
}

function liveDemMarginFromCandidates(candidates = []) {
  const totals = { D: 0, R: 0 };
  for (const candidate of candidates || []) {
    const party = normalizedPartyCode(candidate);
    if (party !== "D" && party !== "R") continue;
    totals[party] += Number(candidate.votes) || 0;
  }
  const twoParty = totals.D + totals.R;
  if (twoParty > 0) return ((totals.D - totals.R) / twoParty) * 100;

  const ranked = [...(candidates || [])]
    .map((candidate) => ({ ...candidate, votes: Number(candidate.votes) || 0, percent: Number(candidate.percent) || 0 }))
    .sort((a, b) => (b.votes || b.percent || 0) - (a.votes || a.percent || 0));
  const leader = ranked[0];
  const runnerUp = ranked[1];
  if (!leader) return NaN;
  const leaderParty = normalizedPartyCode(leader);
  if (leaderParty !== "D" && leaderParty !== "R") return NaN;
  const margin = Math.max(0, Number(leader.percent) - Number(runnerUp?.percent || 0));
  return leaderParty === "D" ? margin : -margin;
}

function raceLiveDemMargin(race) {
  if (!race || !hasActiveResults(race)) return NaN;
  const margin = liveDemMarginFromCandidates(race.candidates || []);
  if (Number.isFinite(margin)) return margin;
  const top = topCandidates(race, 2);
  if (!top.length) return NaN;
  const leaderParty = normalizedPartyCode(top[0]);
  if (leaderParty !== "D" && leaderParty !== "R") return NaN;
  const leaderPct = Number(top[0].percent) || 0;
  const runnerPct = Number(top[1]?.percent) || 0;
  return leaderParty === "D" ? leaderPct - runnerPct : runnerPct - leaderPct;
}

function countyLiveDemMargin(county) {
  if (!county) return NaN;
  const margin = liveDemMarginFromCandidates(county.candidates || []);
  if (Number.isFinite(margin)) return margin;
  const top = countyTopCandidatesForElectionNight(county, 2);
  const leaderParty = normalizedPartyCode(top[0] || {});
  if (leaderParty !== "D" && leaderParty !== "R") return NaN;
  const marginPct = Math.max(0, Number(top[0]?.percent || 0) - Number(top[1]?.percent || 0));
  return leaderParty === "D" ? marginPct : -marginPct;
}

function marginColor(margin) {
  const value = Number(margin);
  if (!Number.isFinite(value)) return "#5f6b80";
  const party = value >= 0 ? "D" : "R";
  const strength = Math.max(0.4, Math.min(1, 0.42 + Math.abs(value) / 28));
  return d3.interpolateRgb("#dbe2f0", partyColor(party))(strength);
}

function partyPopularVote(races) {
  const totals = { D: 0, R: 0, I: 0 };
  for (const race of races || []) {
    for (const candidate of race.candidates || []) {
      const party = normalizedPartyCode(candidate);
      if (party === "D" || party === "R" || party === "I") totals[party] += Number(candidate.votes || 0);
    }
  }
  const total = totals.D + totals.R;
  return {
    dem: total ? (totals.D / total) * 100 : 0,
    rep: total ? (totals.R / total) * 100 : 0,
    margin: total ? Math.abs(totals.D - totals.R) / total * 100 : 0,
    leader: totals.D === totals.R ? "EVEN" : totals.D > totals.R ? "D" : "R"
  };
}

function cleanStatus(status) {
  return String(status || "").toLowerCase();
}

function hasRealNominee(status) {
  const value = cleanStatus(status);
  return value === "nominee" || value === "presumptive" || value === "resolved-or-filed";
}

function candidateName(name, party, status) {
  if (!name || !hasRealNominee(status)) {
    if (party === "D") return "Democrat";
    if (party === "R") return "Republican";
    return "Candidate";
  }
  return name;
}

function normalizeCandidate(candidate) {
  const party = normalizedPartyCode(candidate);
  return {
    name: candidate.name || candidate.candidateName || partyLabel(party),
    party,
    votes: Number(candidate.votes) || 0,
    percent: Number.isFinite(Number(candidate.percent)) ? Number(candidate.percent) : 0,
    isWinner: Boolean(candidate.isWinner || candidate.winner),
    incumbent: Boolean(candidate.incumbent || candidate.isIncumbent)
  };
}

function normalizedPartyCode(candidate) {
  const partyText = String(candidate.partyCode || candidate.party || "").trim().toLowerCase();
  const nameText = String(candidate.name || "").trim().toLowerCase();
  if (partyText.includes("independent") || partyText === "ind" || partyText === "i" || nameText.includes("dan osborn")) return "I";
  if (partyText.includes("democrat") || partyText === "dem" || partyText === "d") return "D";
  if (partyText.includes("republican") || partyText === "gop" || partyText === "rep" || partyText === "r") return "R";
  if (partyText.includes("libertarian") || partyText === "l") return "L";
  if (partyText.includes("green") || partyText === "g") return "G";
  return String(candidate.partyCode || candidate.party || "U").charAt(0).toUpperCase();
}

function buildFallbackCandidate(party, name, status, percent = 0) {
  return {
    name: candidateName(name, party, status),
    party,
    votes: 0,
    percent,
    isWinner: false,
    incumbent: false
  };
}

function candidateColor(candidate) {
  return candidate?.color || partyColor(normalizedPartyCode(candidate));
}

function candidateByName(race, name) {
  const target = String(name || "").trim().toLowerCase();
  return (race?.candidates || []).find((candidate) => String(candidate.name || "").trim().toLowerCase() === target) || null;
}

function percentDeltaBadge(race, candidate) {
  if (!hasActiveResults(race)) return "";
  const previous = candidatePreviousPercent(race, candidate);
  const current = safePercent(candidate, totalVotes(race));
  if (!Number.isFinite(previous)) return "";
  const delta = current - previous;
  if (Math.abs(delta) < 0.1) return "";
  const sign = delta > 0 ? "+" : "";
  return `<small class="race-delta-badge ${delta > 0 ? "is-up" : "is-down"}">${sign}${delta.toFixed(1)} since last viewed</small>`;
}

function racePathTracker(race) {
  if (!hasActiveResults(race)) return "";
  const candidates = topCandidates(race, 3);
  if (!candidates.length) return "";
  const winners = String(race.electionScope || race.title || "").toLowerCase().includes("open primary") ? 2 : 1;
  const cutoff = candidates[winners - 1];
  const next = candidates[winners];
  const margin = cutoff && next ? Math.max(0, (cutoff.percent || 0) - (next.percent || 0)) : null;
  const label = winners > 1 ? "Path to advance" : "Path to win";
  const status = margin == null
    ? "Awaiting enough candidates"
    : margin < 2 ? "Very close" : margin < 6 ? "Competitive" : "Clearer path";
  return `
    <div class="race-path-card">
      <strong>${label}</strong>
      <span>${status}${margin == null ? "" : `, ${margin.toFixed(1)} pts over cutoff`}</span>
    </div>
  `;
}

function lateVoteWatch(race) {
  const state = String(race?.state || "").toUpperCase();
  const labels = {
    CA: "Late-vote watch: mail ballots and large coastal counties can keep moving totals.",
    NV: "Late-vote watch: mail and Clark County batches can shift totals after election night.",
    AZ: "Late-vote watch: Maricopa and late-arriving ballots often report in large batches.",
    WA: "Late-vote watch: vote-by-mail totals can continue changing for days.",
    OR: "Late-vote watch: vote-by-mail totals can continue changing after polls close.",
    CO: "Late-vote watch: mail-heavy counties may update in batches."
  };
  return labels[state] ? `<div class="race-watch-card">${labels[state]}</div>` : "";
}

function plainLateVoteWatch(race) {
  const notes = [];
  const html = lateVoteWatch(race);
  const match = html.match(/<div class="race-watch-card">([\s\S]*)<\/div>/);
  if (match?.[1]) notes.push(match[1]);
  return notes;
}

function normalizeRaceNoteText(note) {
  return String(note || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function contextValueText(value) {
  if (value == null || value === false) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return normalizeRaceNoteText(value);
  if (Array.isArray(value)) return value.map(contextValueText).filter(Boolean).join("; ");
  if (typeof value === "object") {
    const parts = [
      value.label,
      value.text,
      value.summary,
      value.note,
      value.direction && value.margin ? `${value.direction} by ${value.margin}` : "",
      value.source
    ].map(contextValueText).filter(Boolean);
    if (parts.length) return parts.join(" - ");
    return Object.entries(value)
      .filter(([, next]) => typeof next !== "object")
      .map(([key, next]) => `${key}: ${contextValueText(next)}`)
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

function pollSignalText(signal) {
  if (!signal) return "";
  if (typeof signal !== "object") return contextValueText(signal);
  const margin = Number(signal.margin);
  const pollCount = Number(signal.pollCount);
  const pollsters = Number(signal.pollsters);
  const leadText = Number.isFinite(margin)
    ? Math.abs(margin) < 0.05
      ? "Even polling signal"
      : `${margin > 0 ? "D" : "R"} +${Math.abs(margin).toFixed(1)} polling signal`
    : "";
  const sourceParts = [];
  if (Number.isFinite(pollCount) && pollCount > 0) sourceParts.push(`${pollCount} poll${pollCount === 1 ? "" : "s"}`);
  if (Number.isFinite(pollsters) && pollsters > 0) sourceParts.push(`${pollsters} pollster${pollsters === 1 ? "" : "s"}`);
  if (leadText && sourceParts.length) return `${leadText} from ${sourceParts.join(" / ")}`;
  return leadText || sourceParts.join(" / ") || contextValueText(signal);
}

function raceNotes(race) {
  const notes = [];
  const statusText = String(race?.status || race?.statusLabel || "").toLowerCase();
  if (!hasActiveResults(race) && statusText.includes("closed")) notes.push("Polls have closed. Results will appear here once reporting begins.");
  if (isCompetitiveRace(race)) notes.push("This race is marked as competitive by FEA.");
  notes.push(...plainLateVoteWatch(race));
  if (Array.isArray(race?.context?.notes)) notes.push(...race.context.notes);
  if (Array.isArray(race?.notes)) notes.push(...race.notes);
  const seen = new Set();
  return notes
    .map(normalizeRaceNoteText)
    .filter(Boolean)
    .filter((note) => {
      const key = note.toLowerCase().replace(/[^\w]+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function awaitingResultsNote(race) {
  const notes = raceNotes(race);
  if (!notes.length) return "";
  return `<div class="race-note-stack">${notes.map((note) => `<div class="race-note-box">${escapeHtml(note)}</div>`).join("")}</div>`;
}

function isCompetitiveRace(race) {
  if (!race) return false;
  if (KEY_RACE_IDS.has(race.id)) return true;
  const rating = String(race.rating || race.raceRating || race.forecastRating || race.statusLabel || "").toLowerCase();
  if (/(toss|tilt|lean|competitive)/.test(rating)) return true;
  const candidates = topCandidates(race, 2);
  if (hasActiveResults(race) && candidates.length >= 2) {
    return Math.abs((candidates[0].percent || 0) - (candidates[1].percent || 0)) <= 8;
  }
  const margin = Number(race.margin || race.projectedMargin || race.forecastMargin);
  if (Number.isFinite(margin)) return Math.abs(margin) <= 8;
  const probability = Number(race.winProbability || race.probability || race.favoriteProbability);
  return Number.isFinite(probability) && probability > 0 && probability < 0.75;
}

function houseGeometryId(race) {
  const state = race?.state;
  const district = race?.district;
  if (!state) return null;
  if (district === "AL" || district === 0 || district === "0" || district == null) return `${state}-AL`;
  return `${state}-${String(district).padStart(2, "0")}`;
}

function normalizedHouseDistrict(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw || raw === "AL" || raw.includes("AT-LARGE")) return "AL";
  const match = raw.match(/(?:^|[-\s])0*(\d{1,2})$/) || raw.match(/0*(\d{1,2})/);
  return match ? String(Number(match[1])) : raw;
}

function raceIdFromHouseGeometryId(id) {
  const [state, district] = String(id || "").split("-");
  if (!state || !district) return "";
  return `house-${state}-${district === "AL" ? "AL" : String(Number(district))}`;
}

function normalizeElectionRace(race, fallbackCandidates) {
  const candidates = (race.candidates || []).map((candidate) => normalizeCandidate(candidate));
  const normalized = {
    id: race.id,
    liveResultId: race.liveResultId || race.resultId || race.nbcId || race.civicId || "",
    type: race.type,
    state: race.state,
    district: race.district,
    date: race.date || race.electionDate || "",
    title: race.electionName || race.title || `${STATE_NAMES[race.state] || race.state} ${MODE_LABELS[race.type] || "Race"}`,
    subtitle: race.subtitle || "",
    status: race.status || "",
    reportingPercent: Number.isFinite(Number(race.reportingPercent)) ? Number(race.reportingPercent) : null,
    candidates
  };

  if (!hasActiveResults(normalized) && fallbackCandidates?.length) {
    normalized.candidates = fallbackCandidates.map((candidate) => ({
      ...candidate,
      votes: 0,
      percent: 0,
      isWinner: false
    }));
    normalized.status = "";
    normalized.reportingPercent = null;
  }

  return normalized;
}

function forecastCandidateShares(item) {
  const margin = Number(item?.margin);
  if (Number.isFinite(margin)) {
    const dem = Math.max(2, Math.min(98, 50 + margin / 2));
    return { dem, rep: 100 - dem };
  }
  const demProbability = Number(item?.demProbability);
  if (Number.isFinite(demProbability) && demProbability > 0) {
    const dem = Math.max(35, Math.min(65, 50 + (demProbability - 0.5) * 26));
    return { dem, rep: 100 - dem };
  }
  return { dem: 50, rep: 50 };
}

function buildNameLookups(house, senate, governor) {
  const lookups = { house: new Map(), senate: new Map(), governor: new Map() };

  for (const district of house?.districts || []) {
    const id = district.id || `${district.state}-${String(district.district).padStart(2, "0")}`;
    const { dem: demShare, rep: repShare } = forecastCandidateShares(district);
    lookups.house.set(id, [
      buildFallbackCandidate("D", district.demCandidate, district.demStatus, demShare),
      buildFallbackCandidate("R", district.repCandidate, district.repStatus, repShare)
    ]);
  }

  for (const race of senate?.races || []) {
    const { dem: demShare, rep: repShare } = forecastCandidateShares(race);
    lookups.senate.set(race.state, [
      buildFallbackCandidate("D", race.dem, race.demStatus, demShare),
      buildFallbackCandidate("R", race.rep, race.repStatus, repShare)
    ]);
  }

  for (const race of governor?.races || []) {
    const { dem: demShare, rep: repShare } = forecastCandidateShares(race);
    lookups.governor.set(race.state, [
      buildFallbackCandidate("D", race.demCandidate || race.dem, race.demStatus, demShare),
      buildFallbackCandidate("R", race.repCandidate || race.rep, race.repStatus, repShare)
    ]);
  }

  return lookups;
}

function fallbackCandidatesForRace(race, lookups) {
  if (race.type === "house") return lookups.house.get(houseGeometryId(race)) || null;
  if (race.type === "senate") return lookups.senate.get(race.state) || null;
  if (race.type === "governor") return lookups.governor.get(race.state) || null;
  return null;
}

function tooltipMarkup(race, title) {
  if (!race) {
    return `<div class="election-map-tooltip-title">${title}</div><div class="election-map-tooltip-muted">No results configured</div>`;
  }

  const live = hasActiveResults(race);
  const rows = topCandidates(race, 3).map((candidate, index) => {
    const color = candidateColor(candidate);
    const value = live ? formatPercent(candidate.percent || 0) : "Awaiting";
    return `
      <tr class="${index === 0 && live ? "leading" : ""}">
        <td><span class="tooltip-party-bar" style="background:${color}"></span>${candidate.name}${candidate.incumbent ? "*" : ""}</td>
        <td>${value}</td>
        <td>${live ? formatVotes(candidate.votes) : ""}</td>
      </tr>
    `;
  }).join("");

  const status = live
    ? `${formatPercent(race.reportingPercent || 0, 0)} reporting`
    : "No results yet";
  return `
    <div class="election-map-tooltip-title">${race.title || title}</div>
    <table class="election-map-tooltip-table">
      <tbody>${rows}</tbody>
    </table>
    <div class="election-map-tooltip-foot">
      <span>${status}</span>
      <span>${isActuallyCalled(race) ? "Called" : "Uncalled"}</span>
    </div>
  `;
}

function houseStateTooltipMarkup(races, title) {
  if (!races?.length) {
    return `<div class="election-map-tooltip-title">${title}</div><div class="election-map-tooltip-muted">No House races configured</div>`;
  }
  const rows = races.slice(0, 5).map((race) => {
    const leader = raceLeader(race) || topCandidates(race, 1)[0];
    return `
      <tr>
        <td><span class="tooltip-party-bar" style="background:${partyColor(normalizedPartyCode(leader || {}))}"></span>${race.title}</td>
        <td>${hasActiveResults(race) ? formatPercent(leader?.percent || 0) : "Awaiting"}</td>
        <td>${isActuallyCalled(race) ? "Called" : ""}</td>
      </tr>
    `;
  }).join("");
  return `
    <div class="election-map-tooltip-title">${title} House races</div>
    <table class="election-map-tooltip-table">
      <tbody>${rows}</tbody>
    </table>
    <div class="election-map-tooltip-foot">
      <span>${races.length} races</span>
      <span>State view</span>
    </div>
  `;
}

function countyTooltipRows(candidates, race) {
  return candidates.slice(0, 3).map((candidate) => {
    const raceCandidate = candidateByName(race, candidate.name) || candidate;
    const color = candidateColor(raceCandidate);
    const callMark = raceCandidate?.isWinner ? `<span class="tooltip-call-mark">${race?.winners && race.winners > 1 ? "→" : "✓"}</span>` : "";
    const votes = Number.isFinite(candidate.votes) && candidate.votes > 0 ? formatVotes(candidate.votes) : "--";
    const percent = Number.isFinite(candidate.percent) && candidate.percent > 0 ? formatPercent(candidate.percent || 0) : "--";
    return `
      <tr>
        <td><span class="tooltip-party-bar" style="background:${color}"></span>${escapeHtml(candidate.name || "Candidate")} ${callMark}<small>(${normalizedPartyCode(raceCandidate)})</small></td>
        <td>${votes}</td>
        <td>${percent}</td>
      </tr>
    `;
  }).join("");
}

function countyTooltipMarkup(county, feature, descriptions, race) {
  const props = feature?.properties || {};
  const countyName = county?.name || props.countyName || props.NAME || "County";
  const description = countyDescriptionForFeature(feature, descriptions);
  const fallbackCandidates = topCandidates(race, 3);
  if (!county) {
    return `
      <div class="election-map-tooltip-title">${escapeHtml(countyName)}</div>
      ${description ? `<div class="election-map-tooltip-muted">${escapeHtml(description)}</div>` : ""}
      <table class="election-map-tooltip-table">
        <thead><tr><th>Candidate</th><th>Votes</th><th>Pct</th></tr></thead>
        <tbody>${countyTooltipRows(fallbackCandidates, race)}</tbody>
      </table>
      <div class="election-map-tooltip-foot"><span>0% estimated in</span></div>
    `;
  }

  const rows = countyTooltipRows(countyTopCandidatesForElectionNight(county, 3).length ? countyTopCandidatesForElectionNight(county, 3) : fallbackCandidates, race);
  const reporting = Number(county.estimatedVoteReporting ?? county.percentReporting);
  return `
    <div class="election-map-tooltip-title">${escapeHtml(countyName)}</div>
    ${description ? `<div class="election-map-tooltip-muted">${escapeHtml(description)}</div>` : ""}
    <table class="election-map-tooltip-table">
      <thead><tr><th>Candidate</th><th>Votes</th><th>Pct</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="election-map-tooltip-foot">
      <span>${Number.isFinite(reporting) ? `${formatPercent(reporting)} estimated in` : "Estimate pending"}</span>
    </div>
  `;
}

function countyTooltipRowsClean(candidates, race) {
  return candidates.slice(0, 3).map((candidate) => {
    const raceCandidate = candidateByName(race, candidate.name) || candidate;
    const color = candidateColor(raceCandidate);
    const callMark = raceCandidate?.isWinner ? `<span class="tooltip-call-mark">${race?.winners && race.winners > 1 ? "&rarr;" : "&#10003;"}</span>` : "";
    const votes = Number.isFinite(candidate.votes) && candidate.votes > 0 ? formatVotes(candidate.votes) : "--";
    const percent = Number.isFinite(candidate.percent) && candidate.percent > 0 ? formatPercent(candidate.percent || 0) : "--";
    return `
      <tr>
        <td><span class="tooltip-party-bar" style="background:${color}"></span>${escapeHtml(candidate.name || "Candidate")} ${callMark}<small>(${normalizedPartyCode(raceCandidate)})</small></td>
        <td>${votes}</td>
        <td>${percent}</td>
      </tr>
    `;
  }).join("");
}

function countyTooltipMarkupClean(county, feature, descriptions, race, comparisonNote = "") {
  const props = feature?.properties || {};
  const countyName = county?.name || props.countyName || props.NAME || "County";
  const description = countyDescriptionForFeature(feature, descriptions);
  const countyCandidates = countyTopCandidatesForElectionNight(county, 3);
  const fallbackCandidates = topCandidates(race, 3);
  const rows = countyTooltipRowsClean(countyCandidates.length ? countyCandidates : fallbackCandidates, race);
  const reporting = Number(county?.estimatedVoteReporting ?? county?.percentReporting);
  const hasCountyVotes = countyCandidates.some((candidate) => Number(candidate.votes) > 0 || Number(candidate.percent) > 0);
  const comparisonMarkup = comparisonNote ? `<div class="election-map-tooltip-muted comparison-note">${escapeHtml(comparisonNote)}</div>` : "";
  if (!county || !hasCountyVotes) {
    return `
      <div class="election-map-tooltip-title">${escapeHtml(countyName)}</div>
      ${description ? `<div class="election-map-tooltip-muted">${escapeHtml(description)}</div>` : ""}
      <table class="election-map-tooltip-table">
        <thead><tr><th>Candidate</th><th>Votes</th><th>Pct</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="election-map-tooltip-foot">
        <span>${Number.isFinite(reporting) ? `${formatPercent(reporting)} estimated in` : "0% estimated in"}</span>
      </div>
      ${comparisonMarkup}
    `;
  }

  return `
    <div class="election-map-tooltip-title">${escapeHtml(countyName)}</div>
    ${description ? `<div class="election-map-tooltip-muted">${escapeHtml(description)}</div>` : ""}
    <table class="election-map-tooltip-table">
      <thead><tr><th>Candidate</th><th>Votes</th><th>Pct</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="election-map-tooltip-foot">
      <span>${Number.isFinite(reporting) ? `${formatPercent(reporting)} estimated in` : "Estimate pending"}</span>
    </div>
    ${comparisonMarkup}
  `;
}

function countyDescriptionForFeature(feature, descriptions) {
  const fips = featureCountyFipsForElectionNight(feature);
  const props = feature?.properties || {};
  return descriptions?.get(fips)
    || descriptions?.get(`${String(props.STATEFP || props.STATE || "").padStart(2, "0")}${String(props.COUNTYFP || props.COUNTY || "").padStart(3, "0")}`)
    || "";
}

class ElectionNightPage {
  constructor() {
    this.selectedMode = localStorage.getItem("electionNightMode") || "house";
    this.query = new URLSearchParams(window.location.search);
    this.isLabPage = window.location.pathname.includes("fea-results-lab-26") || this.query.has("mock") || this.query.has("simulation");
    this.dataByMode = { house: [], senate: [], governor: [] };
    this.geo = null;
    this.stateFeatures = null;
    this.houseFeatures = null;
    this.resultStateFeatures = null;
    this.highwayFeatures = null;
    this.districtCountyFeatures = new Map();
    this.nameLookups = { house: new Map(), senate: new Map(), governor: new Map() };
    this.liveRaceIndex = [];
    this.liveRaceDetails = new Map();
    this.comparisonManifest = { sources: [] };
    this.comparisonMode = localStorage.getItem("electionNightComparison") || "live";
    this.comparisonData = new Map();
    this.countyFeatures = null;
    this.countyDescriptions = new Map();
    this.houseExpandedFromGeometry = false;
    this.detailMapActive = false;
    this.currentRace = null;
    this.focusedPanelTab = "results";
    this.forecastSources = { house: null, senate: null, governor: null };
    this.svg = null;
    this.viewport = null;
    this.zoom = null;
    this.path = null;
    this.simulationTimer = null;
    this.resizeTimer = null;
    this.init();
  }

  async init() {
    this.bindEvents();
    this.updateModeButtons();
    await this.loadData();
    this.renderSummary();
    await this.renderMap();
    this.preloadLikelyDetailAssets();
  }

  bindEvents() {
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => this.switchMode(button.dataset.mode));
    });

    document.querySelectorAll("[data-clear-focus]").forEach((button) => {
      button.addEventListener("click", () => this.clearFocus());
    });
    this.bindFocusPanelDrag();

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && this.currentRace) saveRaceSnapshot(this.currentRace);
    });
    window.addEventListener("pagehide", () => {
      if (this.currentRace) saveRaceSnapshot(this.currentRace);
    });
    window.addEventListener("resize", () => {
      if (!this.currentRace) return;
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.positionFocusPanelForRace(this.currentRace);
        if (this.detailMapActive) {
          this.focusRenderedSelection(".county-result-shape", { maxScale: 80, pad: 34 });
        }
      }, 120);
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.currentRace) this.clearFocus();
    });
    window.setInterval(() => {
      document.querySelectorAll("[data-last-checked-clock]").forEach((node) => {
        node.textContent = formatEasternTime(Date.now());
      });
    }, 30000);
  }

  async loadData() {
    const [results, liveResults, house, senate, governor, countyDescriptions, comparisonManifest] = await Promise.all([
      this.safeJson("data/election-night-races.json"),
      this.safeJson("data/live-results.json"),
      this.safeJson("data/house-forecast.json"),
      this.safeJson("data/forecast.json"),
      this.safeJson("data/governor-forecast.json"),
      this.safeJson("data/result-county-descriptions.json"),
      this.safeJson("data/result-comparison-baselines.json")
    ]);

    const lookups = buildNameLookups(house, senate, governor);
    this.nameLookups = lookups;
    this.forecastSources = { house, senate, governor };
    this.liveRaceIndex = (liveResults?.groups || []).flatMap((group) => group.races || []);
    const races = (results?.races || []).map((race) => normalizeElectionRace(race, fallbackCandidatesForRace(race, lookups)));
    this.dataByMode.house = races.filter((race) => race.type === "house");
    this.dataByMode.senate = races.filter((race) => race.type === "senate");
    this.dataByMode.governor = races.filter((race) => race.type === "governor");
    this.countyDescriptions = new Map((countyDescriptions?.rows || []).map((row) => [String(row.fips).padStart(5, "0"), row.description]));
    this.comparisonManifest = comparisonManifest || { sources: [] };
    if (!this.comparisonSource(this.comparisonMode)) this.comparisonMode = "live";
    this.normalizeComparisonModeForCurrentMap();
    this.applyLabMode();
  }

  applyLabMode() {
    if (!this.isLabPage) return;
    const phase = this.query.get("phase") || (this.query.has("mock") ? "reporting" : "pre_election");
    const allRaces = [...this.dataByMode.house, ...this.dataByMode.senate, ...this.dataByMode.governor];
    if (phase === "pre_election" || phase === "polls_closed_no_votes") {
      for (const race of allRaces) {
        race.reportingPercent = 0;
        race.status = phase === "polls_closed_no_votes" ? "polls_closed" : "";
        race.candidates = (race.candidates || []).map((candidate) => ({ ...candidate, votes: 0, percent: 0, isWinner: false }));
      }
      return;
    }
    const called = phase === "called";
    for (const race of allRaces) this.seedSimulatedRace(race, called ? 96 : 18);
    if (called) return;
    if (this.query.has("simulation") && this.query.get("speed") === "fast") this.startFastSimulation();
  }

  seedSimulatedRace(race, reportingPercent = 18) {
    const candidates = race.candidates?.length ? race.candidates : [buildFallbackCandidate("D"), buildFallbackCandidate("R")];
    const baseTotal = 18000 + (stringToNumber(race.id || race.title) % 90000);
    const weights = candidates.map((candidate, index) => {
      const party = normalizedPartyCode(candidate);
      const existingShare = Number(candidate.percent);
      if (Number.isFinite(existingShare) && existingShare > 0) return existingShare;
      const partyBase = party === "D" ? 43 : party === "R" ? 43 : party === "I" ? 24 : 12;
      return Math.max(2, partyBase - index * 7 + (stringToNumber(`${race.id}-${candidate.name}`) % 13));
    });
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const votesIn = Math.round(baseTotal * (reportingPercent / 100));
    race.reportingPercent = reportingPercent;
    race.candidates = candidates.map((candidate, index) => {
      const votes = Math.round(votesIn * (weights[index] / totalWeight));
      return {
        ...candidate,
        votes,
        percent: votesIn ? (votes / votesIn) * 100 : 0,
        isWinner: false
      };
    });
    race.candidates.sort((a, b) => (b.votes || 0) - (a.votes || 0));
    if (reportingPercent >= 90) {
      race.status = "called";
      race.candidates = race.candidates.map((candidate, index) => ({ ...candidate, isWinner: index === 0 }));
    }
    if (Array.isArray(race.counties)) this.seedSimulatedCounties(race, reportingPercent);
  }

  seedSimulatedCounties(race, reportingPercent = 18) {
    const raceCandidates = race.candidates || [];
    race.counties = (race.counties || []).map((county) => {
      const countyTotal = Math.max(0, Math.round((900 + (stringToNumber(`${race.id}-${county.name}`) % 22000)) * (reportingPercent / 100)));
      const weights = raceCandidates.map((candidate, index) => {
        const base = Number(candidate.percent) > 0 ? Number(candidate.percent) : Math.max(3, 42 - index * 8);
        const swing = ((stringToNumber(`${county.name}-${candidate.name}`) % 1400) - 700) / 100;
        return Math.max(0.5, base + swing);
      });
      const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
      const candidates = raceCandidates.map((candidate, index) => {
        const votes = Math.round(countyTotal * (weights[index] / totalWeight));
        return {
          name: candidate.name,
          party: candidate.party,
          partyCode: normalizedPartyCode(candidate),
          color: candidate.color || "",
          votes,
          percent: countyTotal ? (votes / countyTotal) * 100 : 0,
          winner: false
        };
      });
      return {
        ...county,
        percentReporting: reportingPercent,
        estimatedVoteReporting: reportingPercent,
        candidates
      };
    });
  }

  seedFeatureCounties(race, features, reportingPercent = 18) {
    if (!this.isLabPage || !race || race.counties?.length || !features?.length) return;
    race.counties = features.map((feature) => {
      const props = feature.properties || {};
      const name = props.countyName || props.NAME || props.NAMELSAD || props.GEOID || "County";
      const fips = featureCountyFipsForElectionNight(feature);
      return {
        name,
        fips,
        type: "County",
        percentReporting: reportingPercent,
        estimatedVoteReporting: reportingPercent,
        candidates: []
      };
    });
    this.seedSimulatedCounties(race, reportingPercent);
  }

  startFastSimulation() {
    window.clearInterval(this.simulationTimer);
    this.simulationTimer = window.setInterval(async () => {
      for (const race of this.modeRaces()) {
        const nextReporting = Math.min(99, Number(race.reportingPercent || 0) + 6 + (stringToNumber(race.id || "") % 5));
        this.seedSimulatedRace(race, nextReporting);
      }
      this.renderSummary();
      if (this.currentRace) await this.selectRace(this.currentRace, null, { preserveMapTransform: true });
      else await this.renderMap();
    }, 2400);
  }

  ensureAllHouseRacesFromGeometry() {
    if (this.houseExpandedFromGeometry || !this.geo?.features?.length) return;
    const existing = new Map(this.dataByMode.house.map((race) => [houseGeometryId(race), race]));
    for (const feature of this.geo.features) {
      const geometryId = feature.properties?.id;
      if (!geometryId || existing.has(geometryId)) continue;
      const [state, district] = geometryId.split("-");
      const fallback = this.nameLookups.house.get(geometryId) || [
        buildFallbackCandidate("D", null, null),
        buildFallbackCandidate("R", null, null)
      ];
      existing.set(geometryId, {
        id: raceIdFromHouseGeometryId(geometryId),
        type: "house",
        state,
        district: district === "AL" ? "AL" : Number(district),
        title: `${STATE_NAMES[state] || state} US House ${district === "AL" ? "At-Large" : Number(district)}`,
        subtitle: "",
        status: "",
        reportingPercent: null,
        candidates: fallback.map((candidate) => ({ ...candidate, votes: 0, percent: 0, isWinner: false }))
      });
    }
    this.dataByMode.house = [...existing.values()].sort((a, b) => {
      if (a.state !== b.state) return String(a.state).localeCompare(String(b.state));
      const ad = a.district === "AL" ? 0 : Number(a.district) || 0;
      const bd = b.district === "AL" ? 0 : Number(b.district) || 0;
      return ad - bd;
    });
    this.houseExpandedFromGeometry = true;
  }

  async safeJson(url) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error(`Could not load ${url}`, error);
      return null;
    }
  }

  comparisonSource(id = this.comparisonMode) {
    return (this.comparisonManifest?.sources || []).find((source) => source.id === id) || null;
  }

  comparisonSourcesForCurrentMap() {
    const mode = String(this.selectedMode || "").toLowerCase();
    return (this.comparisonManifest?.sources || [])
      .filter((source) => {
        const appliesTo = Array.isArray(source.appliesTo) ? source.appliesTo.map((item) => String(item).toLowerCase()) : [];
        return !appliesTo.length || appliesTo.includes(mode) || source.id === "live";
      });
  }

  normalizeComparisonModeForCurrentMap() {
    const sources = this.comparisonSourcesForCurrentMap();
    if (!sources.some((source) => source.id === this.comparisonMode)) {
      this.comparisonMode = "live";
      try {
        localStorage.setItem("electionNightComparison", this.comparisonMode);
      } catch {
        // Ignore private-browsing storage failures.
      }
    }
  }

  isComparisonActive() {
    return this.comparisonMode && this.comparisonMode !== "live";
  }

  async loadComparisonDataset(kind, source = this.comparisonSource()) {
    if (!source || source.id === "live" || source.id === "fea-forecast") return null;
    const file = source[`${kind}File`];
    if (!file) return null;
    const key = `${source.id}:${kind}`;
    if (!this.comparisonData.has(key)) this.comparisonData.set(key, await this.safeJson(file));
    return this.comparisonData.get(key);
  }

  comparisonDatasetRows(dataset, key) {
    if (!dataset) return null;
    if (Array.isArray(dataset)) return dataset;
    if (Array.isArray(dataset[key])) return dataset[key];
    if (Array.isArray(dataset.rows)) return dataset.rows;
    return null;
  }

  forecastMarginForRace(race) {
    const forecastRace = this.findForecastRace(race);
    if (!forecastRace) return NaN;
    return Number(forecastRace.margin ?? forecastRace.projectedMargin ?? forecastRace.ratingMargin ?? forecastRace.baselineMargin);
  }

  baselineRaceMargin(race) {
    if (!race) return NaN;
    const source = this.comparisonSource();
    if (!source || source.id === "live") return NaN;
    if (source.id === "fea-forecast") return this.forecastMarginForRace(race);
    const stateRows = this.comparisonDatasetRows(this.comparisonData.get(`${source.id}:state`), "states") || [];
    const districtRows = this.comparisonDatasetRows(this.comparisonData.get(`${source.id}:district`), "districts") || [];
    const state = String(race.state || "").toUpperCase();
    if (race.type === "house") {
      const districtId = houseGeometryId(race);
      const district = districtRows.find((row) => String(row.id || row.districtId || "").toUpperCase() === districtId);
      if (district) return Number(district.margin ?? district.demMargin ?? district.democraticMargin);
    }
    const stateRow = stateRows.find((row) => String(row.state || row.statePostal || "").toUpperCase() === state);
    return Number(stateRow?.margin ?? stateRow?.demMargin ?? stateRow?.democraticMargin);
  }

  comparisonRaceShift(race) {
    const liveMargin = raceLiveDemMargin(race);
    const baselineMargin = this.baselineRaceMargin(race);
    if (!Number.isFinite(liveMargin) || !Number.isFinite(baselineMargin)) return NaN;
    return liveMargin - baselineMargin;
  }

  baselineCountyRow(feature) {
    const source = this.comparisonSource();
    if (!source || source.id === "live" || source.id === "fea-forecast") return null;
    const countyRows = this.comparisonDatasetRows(this.comparisonData.get(`${source.id}:county`), "counties") || [];
    const fips = featureCountyFipsForElectionNight(feature);
    return countyRows.find((row) => String(row.fips || row.countyFips || "").padStart(5, "0") === fips) || null;
  }

  comparisonTooltipNote(race, feature) {
    const source = this.comparisonSource();
    if (!source || source.id === "live") return "";
    if (source.id === "fea-forecast") {
      const margin = this.forecastMarginForRace(race);
      const marginText = Number.isFinite(margin) ? `${margin > 0 ? "D" : "R"} +${Math.abs(margin).toFixed(1)}` : "unavailable";
      return `FEA forecast projection is race-level only (${marginText}). County comparison is unavailable.`;
    }
    const row = feature ? this.baselineCountyRow(feature) : null;
    if (!row) return `${source.label} county baseline is not loaded for this geography yet.`;
    const margin = Number(row.margin ?? row.demMargin ?? row.democraticMargin);
    const county = countyForFeature(feature, countyLookupForElectionNight(race));
    const liveMargin = countyLiveDemMargin(county);
    const shift = Number.isFinite(liveMargin) && Number.isFinite(margin) ? liveMargin - margin : NaN;
    if (Number.isFinite(shift)) {
      return `Results minus ${source.label}: ${shift > 0 ? "D" : "R"} shift +${Math.abs(shift).toFixed(1)}.`;
    }
    return Number.isFinite(margin)
      ? `${source.label}: ${margin > 0 ? "D" : "R"} +${Math.abs(margin).toFixed(1)}; awaiting live margin for shift.`
      : `${source.label} baseline loaded.`;
  }

  comparisonColorForRace(race) {
    if (!this.isComparisonActive()) return raceColor(race);
    const source = this.comparisonSource();
    if (!source) return "#5f6b80";
    const shift = this.comparisonRaceShift(race);
    return Number.isFinite(shift) ? marginColor(shift) : "#3c4658";
  }

  comparisonColorForCounty(feature, race, lookup) {
    if (!this.isComparisonActive()) {
      const county = countyForFeature(feature, lookup);
      const leader = countyTopCandidatesForElectionNight(county, 1)[0];
      if (!leader) return "#334054";
      return d3.interpolateRgb("#06142e", candidateColor(leader))(0.9);
    }
    const source = this.comparisonSource();
    if (!source || source.id === "live") return "#334054";
    if (source.id === "fea-forecast" || source.countyCompatible === false) return "#202b3f";
    const row = this.baselineCountyRow(feature);
    const county = countyForFeature(feature, lookup);
    const liveMargin = countyLiveDemMargin(county);
    const baselineMargin = Number(row?.margin ?? row?.demMargin ?? row?.democraticMargin);
    const shift = Number.isFinite(liveMargin) && Number.isFinite(baselineMargin) ? liveMargin - baselineMargin : NaN;
    return Number.isFinite(shift) ? marginColor(shift) : "#202b3f";
  }

  async loadResultStateFeatures() {
    if (!this.resultStateFeatures) {
      const states = await this.safeJson("data/result-us-states.geojson");
      this.resultStateFeatures = states?.features || [];
    }
    return this.resultStateFeatures;
  }

  async loadCountyFeatures() {
    if (!this.countyFeatures) {
      const counties = await this.safeJson("data/result-counties.geojson");
      this.countyFeatures = counties?.features || [];
    }
    return this.countyFeatures;
  }

  async loadHouseFeatures() {
    if (!this.houseFeatures) {
      const districts = await this.safeJson("data/house-districts-119.geojson");
      this.houseFeatures = districts?.features || [];
    }
    return this.houseFeatures;
  }

  async loadHighwayFeatures() {
    if (!this.highwayFeatures) {
      const highways = await this.safeJson("data/result-major-highways.geojson");
      this.highwayFeatures = highways?.features || [];
    }
    return this.highwayFeatures;
  }

  async loadDistrictCountyFeatures(race) {
    const id = houseGeometryId(race);
    if (!id) return [];
    if (!this.districtCountyFeatures.has(id)) {
      const detail = await this.safeJson(`data/maps/congress/119/${id}.json`);
      this.districtCountyFeatures.set(id, detail?.features || []);
    }
    return this.districtCountyFeatures.get(id) || [];
  }

  modeRaces() {
    return this.dataByMode[this.selectedMode] || [];
  }

  async switchMode(mode) {
    if (!MODE_LABELS[mode] || mode === this.selectedMode) return;
    this.selectedMode = mode;
    localStorage.setItem("electionNightMode", mode);
    this.currentRace = null;
    this.detailMapActive = false;
    this.normalizeComparisonModeForCurrentMap();
    this.updateModeButtons();
    this.renderSummary();
    this.hideFocusPanel();
    await this.renderMap();
    this.preloadLikelyDetailAssets();
  }

  preloadLikelyDetailAssets() {
    const run = () => this.preloadDetailAssets().catch((error) => console.warn("Detail preload failed", error));
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 1800 });
    else window.setTimeout(run, 350);
  }

  async preloadDetailAssets() {
    this.loadHighwayFeatures();
    const races = this.modeRaces();
    if (this.selectedMode === "house") {
      await this.loadHouseFeatures();
      const priority = [
        ...races.filter((race) => KEY_RACE_IDS.has(String(race.id))),
        ...races.filter((race) => !KEY_RACE_IDS.has(String(race.id))).slice(0, 20)
      ];
      for (const race of priority.slice(0, 64)) this.loadDistrictCountyFeatures(race);
      return;
    }
    if (this.selectedMode === "senate" || this.selectedMode === "governor") {
      this.loadCountyFeatures();
    }
  }

  updateModeButtons() {
    document.querySelectorAll("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === this.selectedMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  renderSummary() {
    const races = this.modeRaces();
    const called = races.filter(isActuallyCalled);
    const dem = called.filter((race) => raceWinnerParty(race) === "D").length;
    const rep = called.filter((race) => raceWinnerParty(race) === "R").length;
    this.renderChamberBar(dem, rep, called.length);
  }

  renderChamberBar(dem, rep, called) {
    const board = document.querySelector(".election-chamber-board");
    const chamberBar = document.querySelector(".election-chamber-bar");
    if (board) board.hidden = false;
    if (board) board.classList.toggle("is-governor-board", this.selectedMode === "governor");
    if (chamberBar) chamberBar.classList.toggle("is-senate-cycle", this.selectedMode === "senate");
    const popularVote = partyPopularVote(this.modeRaces());
    const demSafeBar = document.getElementById("chamber-bar-dem-safe");
    const repSafeBar = document.getElementById("chamber-bar-rep-safe");
    if (this.selectedMode === "governor") {
      const subtitle = document.getElementById("chamber-board-subtitle");
      const demLabel = document.getElementById("chamber-dem-count");
      const repLabel = document.getElementById("chamber-rep-count");
      const majorityLabel = document.getElementById("chamber-majority-label");
      const demNote = document.getElementById("chamber-dem-note");
      const repNote = document.getElementById("chamber-rep-note");
      const demBar = document.getElementById("chamber-bar-dem");
      const repBar = document.getElementById("chamber-bar-rep");
      const uncalledBar = document.getElementById("chamber-bar-uncalled");
      const majorityLine = document.getElementById("chamber-majority-line");
      if (demSafeBar) demSafeBar.hidden = true;
      if (repSafeBar) repSafeBar.hidden = true;
      const up = this.modeRaces().length;
      if (subtitle) subtitle.textContent = `${up} governor races up for election.`;
      if (demLabel) demLabel.innerHTML = `${dem} D<small>${formatPercent(popularVote.dem)} PV</small><em>${GOVERNOR_NOT_UP_BY_PARTY.D} D not up</em>`;
      if (repLabel) repLabel.innerHTML = `${rep} R<small>${formatPercent(popularVote.rep)} PV</small><em>${GOVERNOR_NOT_UP_BY_PARTY.R} R not up</em>`;
      if (majorityLabel) majorityLabel.textContent = "Governor calls";
      if (demNote) demNote.textContent = "";
      if (repNote) repNote.textContent = "";
      if (majorityLine) majorityLine.style.left = "0%";
      if (demBar) demBar.style.width = "0%";
      if (uncalledBar) uncalledBar.style.width = "0%";
      if (repBar) repBar.style.width = "0%";
      return;
    }
    const config = CHAMBER_CONFIG[this.selectedMode] || CHAMBER_CONFIG.house;
    const uncalled = Math.max(0, config.total - dem - rep);
    const demPct = (dem / config.total) * 100;
    const repPct = (rep / config.total) * 100;
    const majorityPct = (config.majority / config.total) * 100;

    const subtitle = document.getElementById("chamber-board-subtitle");
    const demLabel = document.getElementById("chamber-dem-count");
    const repLabel = document.getElementById("chamber-rep-count");
    const majorityLabel = document.getElementById("chamber-majority-label");
    const demNote = document.getElementById("chamber-dem-note");
    const repNote = document.getElementById("chamber-rep-note");
    const demBar = document.getElementById("chamber-bar-dem");
    const repBar = document.getElementById("chamber-bar-rep");
    const uncalledBar = document.getElementById("chamber-bar-uncalled");
    const majorityLine = document.getElementById("chamber-majority-line");

    const up = this.modeRaces().length;
    const isSenate = this.selectedMode === "senate";
    let demSafe = isSenate ? SENATE_NOT_UP_BY_PARTY.D : 0;
    let repSafe = isSenate ? SENATE_NOT_UP_BY_PARTY.R : 0;
    if (isSenate) {
      const expectedNotUp = Math.max(0, config.total - up);
      const configuredNotUp = Math.max(1, SENATE_NOT_UP_BY_PARTY.D + SENATE_NOT_UP_BY_PARTY.R);
      if (expectedNotUp !== configuredNotUp) {
        demSafe = Math.round(expectedNotUp * (SENATE_NOT_UP_BY_PARTY.D / configuredNotUp));
        repSafe = expectedNotUp - demSafe;
      }
    }
    const activeUncalled = isSenate ? Math.max(0, up - dem - rep) : uncalled;
    if (demSafeBar) {
      demSafeBar.hidden = !isSenate;
      demSafeBar.style.width = isSenate ? `${(demSafe / config.total) * 100}%` : "0%";
    }
    if (repSafeBar) {
      repSafeBar.hidden = !isSenate;
      repSafeBar.style.width = isSenate ? `${(repSafe / config.total) * 100}%` : "0%";
    }
    if (subtitle) subtitle.textContent = this.selectedMode === "house"
      ? ""
      : `${up} states up for election. Not up: ${demSafe} D / ${repSafe} R.`;
    if (demLabel) demLabel.innerHTML = `${dem + demSafe} D<small>${formatPercent(popularVote.dem)} PV</small>`;
    if (repLabel) repLabel.innerHTML = `${rep + repSafe} R<small>${formatPercent(popularVote.rep)} PV</small>`;
    if (majorityLabel) majorityLabel.innerHTML = `<b>${config.majority} for majority</b><small>${popularVote.leader === "EVEN" ? "PV even" : `${popularVote.leader}+${popularVote.margin.toFixed(1)} PV`}</small>`;
    if (demNote) demNote.textContent = this.selectedMode === "senate" ? `${demSafe} D not up` : "";
    if (repNote) repNote.textContent = this.selectedMode === "senate" ? `${repSafe} R not up` : "";
    if (demBar) demBar.style.width = `${demPct}%`;
    if (uncalledBar) uncalledBar.style.width = `${(activeUncalled / config.total) * 100}%`;
    if (repBar) repBar.style.width = `${repPct}%`;
    if (majorityLine) majorityLine.style.left = `${isSenate ? 50 : majorityPct}%`;
    if (chamberBar) chamberBar.style.setProperty("--senate-majority-line", `${majorityPct}%`);
  }

  async renderMap() {
    const container = document.getElementById("election-map");
    if (!container) return;
    if (!window.d3) {
      container.innerHTML = `<p class="map-note">Map rendering needs D3 to load.</p>`;
      return;
    }

    container.innerHTML = `<div class="election-map-loading">Loading ${MODE_LABELS[this.selectedMode]} map...</div>`;
    await this.prepareComparisonData();
    if (this.selectedMode === "house") {
      await this.renderHouseMap(container);
    } else {
      await this.renderStateMap(container);
    }
  }

  async prepareComparisonData() {
    const source = this.comparisonSource();
    if (!source || source.id === "live" || source.id === "fea-forecast") return;
    await Promise.all([
      this.loadComparisonDataset("state", source),
      this.loadComparisonDataset("district", source),
      this.loadComparisonDataset("county", source)
    ]);
  }

  async renderStateMap(container) {
    this.detailMapActive = false;
    const [stateFeatures, highwayFeatures] = await Promise.all([
      this.loadResultStateFeatures(),
      this.loadHighwayFeatures()
    ]);
    this.stateFeatures = stateFeatures;

    const width = 1160;
    const height = 720;
    const projection = d3.geoAlbersUsa().fitExtent([[24, 24], [width - 24, height - 24]], {
      type: "FeatureCollection",
      features: this.stateFeatures
    });
    this.path = d3.geoPath(projection);
    const raceByState = new Map(this.modeRaces().map((race) => [race.state, race]));

    this.createSvg(container, width, height);
    this.drawMapContext(projection, { highways: highwayFeatures, raceStates: new Set(this.modeRaces().map((race) => race.state)) });
    this.viewport.selectAll(".state-result-shape")
      .data(this.stateFeatures)
      .join("path")
      .attr("class", (feature) => {
        const state = FIPS_TO_STATE[featureStateFipsForElectionNight(feature)];
        const race = raceByState.get(state);
        return race ? `state-result-shape election-map-shape ${isCompetitiveRace(race) ? "is-competitive-race" : ""}` : "state-result-shape election-map-shape election-map-muted";
      })
      .attr("d", (feature) => projectedFeaturePath(feature, projection))
      .attr("fill", (feature) => {
        const state = FIPS_TO_STATE[featureStateFipsForElectionNight(feature)];
        const race = raceByState.get(state);
        return race ? this.comparisonColorForRace(race) : "#334054";
      })
      .attr("stroke", "#e2e8ff")
      .attr("stroke-width", 0.55)
      .attr("tabindex", (feature) => raceByState.has(FIPS_TO_STATE[featureStateFipsForElectionNight(feature)]) ? 0 : -1)
      .on("click keydown", (event, feature) => {
        if (event.type === "keydown" && event.key !== "Enter") return;
        const state = FIPS_TO_STATE[featureStateFipsForElectionNight(feature)];
        const race = raceByState.get(state);
        if (race) this.selectRace(race, feature);
      })
      .on("mousemove", (event, feature) => {
        const state = FIPS_TO_STATE[featureStateFipsForElectionNight(feature)];
        this.showTooltip(event, tooltipMarkup(raceByState.get(state), STATE_NAMES[state] || state));
      })
      .on("mouseleave blur", () => this.hideTooltip());

    this.addZoomControls();
  }

  async renderHouseMap(container) {
    this.detailMapActive = false;
    const [stateFeatures, houseFeatures, highwayFeatures] = await Promise.all([
      this.loadResultStateFeatures(),
      this.loadHouseFeatures(),
      this.loadHighwayFeatures()
    ]);
    this.stateFeatures = stateFeatures;
    this.geo = { type: "FeatureCollection", features: houseFeatures };
    this.ensureAllHouseRacesFromGeometry();

    const width = 1160;
    const height = 720;
    const projection = d3.geoAlbersUsa().fitExtent([[16, 16], [width - 16, height - 16]], this.geo);
    this.path = d3.geoPath(projection);
    const raceByDistrict = new Map(this.modeRaces().map((race) => [houseGeometryId(race), race]));

    this.createSvg(container, width, height);
    this.drawMapContext(projection, { highways: highwayFeatures, raceStates: new Set(this.modeRaces().map((race) => race.state)) });

    this.viewport.selectAll(".house-district-shape")
      .data(this.geo.features || [])
      .join("path")
      .attr("class", (feature) => {
        const race = raceByDistrict.get(feature.properties?.id);
        return race ? `house-district-shape election-map-shape ${isCompetitiveRace(race) ? "is-competitive-race" : ""}` : "house-district-shape election-map-shape election-map-muted";
      })
      .attr("d", (feature) => projectedFeaturePath(feature, projection))
      .attr("fill-rule", "evenodd")
      .attr("fill", (feature) => this.comparisonColorForRace(raceByDistrict.get(feature.properties?.id)))
      .attr("stroke", "rgba(226, 232, 255, .22)")
      .attr("stroke-width", 0.16)
      .attr("vector-effect", "non-scaling-stroke")
      .attr("tabindex", (feature) => {
        return raceByDistrict.has(feature.properties?.id) ? 0 : -1;
      })
      .on("click keydown", (event, feature) => {
        if (event.type === "keydown" && event.key !== "Enter") return;
        const race = raceByDistrict.get(feature.properties?.id);
        if (race) this.selectRace(race, feature);
      })
      .on("mousemove", (event, feature) => {
        const race = raceByDistrict.get(feature.properties?.id);
        const title = feature.properties?.id || "House district";
        this.showTooltip(event, tooltipMarkup(race, title));
      })
      .on("mouseleave blur", () => this.hideTooltip());

    this.addZoomControls();
  }

  createSvg(container, width, height) {
    container.innerHTML = "";
    this.svg = d3.select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `${MODE_LABELS[this.selectedMode]} election map`);

    this.viewport = this.svg.append("g").attr("class", "election-map-viewport");
    this.zoom = d3.zoom()
      .scaleExtent([0.85, 90])
      .on("zoom", (event) => {
        this.viewport.attr("transform", event.transform);
        const labelScale = Math.max(0.38, Math.min(1, 1 / Math.sqrt(event.transform.k)));
        this.viewport.selectAll(".map-background-city").style("font-size", `${10 * labelScale}px`);
      });
    this.svg.call(this.zoom);
  }

  addZoomControls() {
    const container = document.getElementById("election-map");
    if (!container) return;
    const controls = document.createElement("div");
    controls.className = "election-map-controls";
    this.normalizeComparisonModeForCurrentMap();
    const comparisonOptions = (this.comparisonSourcesForCurrentMap().length ? this.comparisonSourcesForCurrentMap() : [{ id: "live", label: "Live results" }])
      .map((source) => `<option value="${escapeHtml(source.id)}" ${source.id === this.comparisonMode ? "selected" : ""}>${escapeHtml(source.label || source.id)}</option>`)
      .join("");
    controls.innerHTML = `
      <label class="election-comparison-control">
        <span>Shift vs</span>
        <select data-comparison-baseline aria-label="Comparison baseline">${comparisonOptions}</select>
      </label>
      ${this.selectedMode === "house" ? `<input class="election-map-search" type="search" placeholder="Search district" aria-label="Search House district">` : ""}
      <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
      <button type="button" data-zoom="out" aria-label="Zoom out">-</button>
      <button type="button" data-zoom="reset" aria-label="Reset map">Reset</button>
    `;
    container.appendChild(controls);
    controls.addEventListener("click", (event) => {
      const action = event.target?.dataset?.zoom;
      if (!action || !this.svg || !this.zoom) return;
      if (action === "in") this.svg.transition().duration(220).call(this.zoom.scaleBy, 1.35);
      if (action === "out") this.svg.transition().duration(220).call(this.zoom.scaleBy, 0.75);
      if (action === "reset") this.clearFocus();
    });
    const comparisonSelect = controls.querySelector("[data-comparison-baseline]");
    if (comparisonSelect) {
      comparisonSelect.addEventListener("change", async () => {
        this.comparisonMode = comparisonSelect.value || "live";
        localStorage.setItem("electionNightComparison", this.comparisonMode);
        if (this.currentRace) await this.selectRace(this.currentRace, null);
        else await this.renderMap();
      });
    }
    const search = controls.querySelector(".election-map-search");
    if (search) {
      search.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const term = String(search.value || "").trim().toLowerCase();
        if (!term) return;
        const race = this.modeRaces().find((item) => {
          const id = houseGeometryId(item).toLowerCase();
          const title = String(item.title || item.electionName || "").toLowerCase();
          const state = String(item.state || "").toLowerCase();
          const district = String(item.district || "").toLowerCase();
          return id.includes(term) || title.includes(term) || `${state}-${district}`.includes(term);
        });
        if (race) this.selectRace(race, null);
      });
    }
  }

  async selectRace(race, feature, options = {}) {
    const sameRace = this.currentRace?.id === race.id;
    this.currentRace = race;
    if (!sameRace) this.focusedPanelTab = "results";
    const previousTransform = options.preserveMapTransform ? this.currentTransform() : null;
    this.renderFocusedRace(race);
    const renderedDetail = await this.renderSelectedRaceMap(race, options);
    if (renderedDetail && previousTransform) this.applyTransform(previousTransform, 0);
    if (renderedDetail) return;
    if (feature && this.path && this.zoom && this.svg) this.zoomToFeature(feature);
  }

  async renderSelectedRaceMap(race, options = {}) {
    if (String(race?.type || "").toLowerCase() === "house") {
      const [detail, features] = await Promise.all([
        this.findLiveDetailForRace(race),
        this.loadDistrictCountyFeatures(race)
      ]);
      if (detail && this.isLabPage) this.seedLabDetail(detail, race);
      if (this.currentRace?.id !== race.id) return false;
      if (!features.length) return false;
      this.renderCountyDetailMap(detail || race, features, {
        districtMode: true,
        preserveMapTransform: options.preserveMapTransform,
        selectedRaceId: race.id
      });
      return true;
    }

    const [detail, allFeatures] = await Promise.all([
      this.findLiveDetailForRace(race),
      this.loadCountyFeatures()
    ]);
    if (detail && this.isLabPage) this.seedLabDetail(detail, race);
    if (this.currentRace?.id !== race.id) return false;

    const state = String(detail?.state || race?.state || "").toUpperCase();
    const statewideSource = detail || race;
    if (!this.isStatewideRace(statewideSource) || NON_COUNTY_REPORTING_STATES.has(state)) return false;
    const counties = (detail?.counties || []).filter((county) => {
      const type = String(county.type || "County").toLowerCase();
      return type === "county" && county.candidates?.length;
    });

    const stateFips = stateFipsForElectionNight(state);
    const features = allFeatures.filter((feature) => featureStateFipsForElectionNight(feature) === stateFips);
    if (!features.length) return false;

    this.renderCountyDetailMap(counties.length ? detail : race, features, { preserveMapTransform: options.preserveMapTransform });
    return true;
  }

  seedLabDetail(detail, race) {
    const phase = this.query.get("phase") || (this.query.has("mock") ? "reporting" : "pre_election");
    const targetReporting = phase === "called" ? 96 : Math.max(18, Number(race.reportingPercent || detail.reportingPercent || 0) || 18);
    if (phase !== "pre_election" && phase !== "polls_closed_no_votes") this.seedSimulatedRace(detail, targetReporting);
  }

  renderCountyDetailMap(race, features, options = {}) {
    const container = document.getElementById("election-map");
    if (!container) return;
    const width = 1160;
    const height = 720;
    const selectedCollection = {
      type: "FeatureCollection",
      features
    };
    const selectedState = String(race.state || "").toUpperCase();
    const stateDistrictFeatures = options.districtMode && this.geo?.features?.length
      ? this.geo.features.filter((feature) => String(feature.properties?.id || "").startsWith(`${selectedState}-`))
      : [];
    const baseCollection = selectedCollection;
    const projection = d3.geoAlbersUsa().fitExtent([[34, 34], [width - 34, height - 34]], baseCollection);
    this.path = d3.geoPath(projection);
    if (this.isLabPage) this.seedFeatureCounties(race, features, Number(race.reportingPercent || 18) || 18);
    const lookup = countyLookupForElectionNight(race);

    this.createSvg(container, width, height);
    this.detailMapActive = true;
    this.drawMapContext(projection, {
      highways: this.highwayFeatures || [],
      state: selectedState,
      detail: true,
      raceStates: new Set(this.modeRaces().map((item) => item.state))
    });
    const raceByDistrict = options.districtMode
      ? new Map(this.modeRaces().map((item) => [houseGeometryId(item), item]))
      : new Map();
    const contextFeatures = options.districtMode ? stateDistrictFeatures : (this.stateFeatures || []);
    const contextRaceForFeature = (feature) => {
      if (options.districtMode) return raceByDistrict.get(feature.properties?.id) || null;
      const state = FIPS_TO_STATE[featureStateFipsForElectionNight(feature)];
      if (!state) return null;
      return this.modeRaces().find((item) => item.state === state) || null;
    };
    this.viewport.append("g")
      .attr("class", "election-map-context-layer")
      .selectAll(".map-context-shape")
      .data(contextFeatures)
      .join("path")
      .attr("class", (feature) => {
        const isSelected = options.districtMode
          ? feature.properties?.id === houseGeometryId(race)
          : FIPS_TO_STATE[featureStateFipsForElectionNight(feature)] === String(race.state || "").toUpperCase();
        return `map-context-shape ${isSelected ? "is-selected-context is-focused-geography" : "is-dimmed-context"}`;
      })
      .attr("d", (feature) => projectedFeaturePath(feature, projection))
      .attr("fill", (feature) => {
        if (!options.districtMode) return "#1a2840";
        const nextRace = contextRaceForFeature(feature);
        return raceColor(nextRace);
      })
      .attr("stroke", "rgba(226, 232, 255, .45)")
      .attr("stroke-width", 0.38)
      .attr("pointer-events", "auto")
      .on("click keydown", (event, feature) => {
        if (event.type === "keydown" && event.key !== "Enter") return;
        const nextRace = contextRaceForFeature(feature);
        if (nextRace && nextRace.id !== race.id) this.selectRace(nextRace, feature);
      })
      .on("mousemove", (event, feature) => {
        const nextRace = contextRaceForFeature(feature);
        if (nextRace) {
          const label = options.districtMode ? nextRace.title : (STATE_NAMES[nextRace.state] || nextRace.state);
          this.showTooltip(event, tooltipMarkup(nextRace, label));
        }
      })
      .on("mouseleave blur", () => this.hideTooltip());

    this.viewport.selectAll(".county-result-shape")
      .data(features)
      .join("path")
      .attr("class", (feature) => {
        const hasCountyResult = countyForFeature(feature, lookup);
        const source = this.comparisonSource();
        const baselineMissing = this.isComparisonActive() && source?.id !== "fea-forecast" && source?.countyCompatible !== false && !this.baselineCountyRow(feature);
        const incompatible = this.isComparisonActive() && (source?.id === "fea-forecast" || source?.countyCompatible === false);
        return [
          "county-result-shape election-map-shape",
          (!options.districtMode && !hasCountyResult && !this.isComparisonActive()) ? "election-map-muted" : "",
          baselineMissing ? "is-baseline-missing" : "",
          incompatible ? "is-comparison-incompatible" : ""
        ].filter(Boolean).join(" ");
      })
      .attr("d", (feature) => projectedFeaturePath(feature, projection))
      .attr("fill-rule", "evenodd")
      .attr("fill", (feature) => this.comparisonColorForCounty(feature, race, lookup))
      .attr("stroke", options.districtMode ? "rgba(226, 232, 255, .42)" : "rgba(226, 232, 255, .58)")
      .attr("stroke-width", options.districtMode ? 0.22 : 0.36)
      .on("mousemove", (event, feature) => {
        this.showTooltip(event, countyTooltipMarkupClean(
          countyForFeature(feature, lookup),
          feature,
          this.countyDescriptions,
          race,
          this.comparisonTooltipNote(race, feature)
        ));
      })
      .on("mouseleave blur", () => this.hideTooltip());

    this.addZoomControls();
    if (!options.preserveMapTransform) {
      window.requestAnimationFrame(() => this.focusRenderedSelection(".county-result-shape", {
        maxScale: options.districtMode ? 120 : 58,
        pad: options.districtMode ? 30 : 48
      }));
    }
  }

  drawMapContext(projection, options = {}) {
    if (!this.viewport || !projection) return;
    const highways = Array.isArray(options.highways) ? options.highways : [];
    const layer = this.viewport.append("g").attr("class", "map-background-layer");
    const pathForProjection = d3.geoPath(projection);
    if (highways.length) {
      layer.append("g")
        .attr("class", "map-background-roads")
        .selectAll(".map-background-road")
        .data(highways)
        .join("path")
        .attr("class", "map-background-road")
        .attr("d", (feature) => pathForProjection(feature));
    }

    const raceStates = options.raceStates instanceof Set ? options.raceStates : new Set();
    layer.append("g")
      .attr("class", "map-background-cities")
      .selectAll(".map-background-city")
      .data(MAP_CITY_LABELS.map((city) => ({ ...city, point: projection([city.lon, city.lat]) })).filter((city) => {
        if (!city.point) return false;
        if (raceStates.has(city.state)) return false;
        const [x, y] = city.point;
        const inFrame = x > -90 && x < 1250 && y > -90 && y < 810;
        if (!inFrame) return false;
        return !options.state || city.state === options.state || !options.detail;
      }))
      .join("text")
      .attr("class", "map-background-city")
      .attr("x", (city) => city.point[0])
      .attr("y", (city) => city.point[1])
      .text((city) => city.name);
  }

  zoomToFeature(feature, options = {}) {
    const [[x0, y0], [x1, y1]] = this.path.bounds(feature);
    const viewBox = this.svg.node().viewBox.baseVal;
    const dx = Math.max(1, x1 - x0);
    const dy = Math.max(1, y1 - y0);
    const fill = Number.isFinite(options.fill) ? options.fill : .72;
    const maxScale = Number.isFinite(options.maxScale) ? options.maxScale : 10;
    const scale = Math.min(maxScale, Math.max(1.6, fill / Math.max(dx / viewBox.width, dy / viewBox.height)));
    const tx = viewBox.width / 2 - scale * (x0 + x1) / 2;
    const ty = viewBox.height / 2 - scale * (y0 + y1) / 2;
    const target = this.transformWithPanelClearance(
      d3.zoomIdentity.translate(tx, ty).scale(scale),
      { x0, y0, x1, y1 },
      { pad: 42 }
    );
    const duration = Number.isFinite(options.duration) ? options.duration : 500;
    if (duration > 0) this.svg.transition().duration(duration).call(this.zoom.transform, target);
    else this.svg.call(this.zoom.transform, target);
  }

  focusRenderedSelection(selector, options = {}) {
    if (!this.svg?.node() || !this.viewport?.node() || !this.zoom) return;
    const nodes = this.viewport.selectAll(selector).nodes()
      .filter((node) => node?.getBBox && node.getAttribute("d"));
    if (!nodes.length) return;
    const boxes = [];
    for (const node of nodes) {
      try {
        const box = node.getBBox();
        if (box.width > 0 && box.height > 0) boxes.push(box);
      } catch {
        // Some browsers can throw while SVG geometry is still settling.
      }
    }
    if (!boxes.length) return;
    const x0 = Math.min(...boxes.map((box) => box.x));
    const y0 = Math.min(...boxes.map((box) => box.y));
    const x1 = Math.max(...boxes.map((box) => box.x + box.width));
    const y1 = Math.max(...boxes.map((box) => box.y + box.height));
    const viewBox = this.svg.node().viewBox.baseVal;
    const pad = Number.isFinite(options.pad) ? options.pad : 48;
    const maxScale = Number.isFinite(options.maxScale) ? options.maxScale : 60;
    const dx = Math.max(1, x1 - x0);
    const dy = Math.max(1, y1 - y0);
    const scale = Math.min(maxScale, Math.max(1, Math.min((viewBox.width - pad * 2) / dx, (viewBox.height - pad * 2) / dy)));
    const tx = (viewBox.width - scale * (x0 + x1)) / 2;
    const ty = (viewBox.height - scale * (y0 + y1)) / 2;
    const target = this.transformWithPanelClearance(
      d3.zoomIdentity.translate(tx, ty).scale(scale),
      { x0, y0, x1, y1 },
      { pad }
    );
    this.svg.call(this.zoom.transform, target);
  }

  transformWithPanelClearance(transform, bounds, options = {}) {
    const panel = document.getElementById("focused-race-panel");
    const svgNode = this.svg?.node();
    if (!panel || panel.hidden || !svgNode) return transform;
    const panelRect = panel.getBoundingClientRect();
    const svgRect = svgNode.getBoundingClientRect();
    if (!panelRect.width || !panelRect.height || !svgRect.width || !svgRect.height) return transform;

    const viewBox = svgNode.viewBox.baseVal;
    const scaleX = viewBox.width / svgRect.width;
    const scaleY = viewBox.height / svgRect.height;
    const panelBox = {
      left: (panelRect.left - svgRect.left) * scaleX,
      right: (panelRect.right - svgRect.left) * scaleX,
      top: (panelRect.top - svgRect.top) * scaleY,
      bottom: (panelRect.bottom - svgRect.top) * scaleY
    };
    const raceBox = {
      left: bounds.x0 * transform.k + transform.x,
      right: bounds.x1 * transform.k + transform.x,
      top: bounds.y0 * transform.k + transform.y,
      bottom: bounds.y1 * transform.k + transform.y
    };
    const overlapX = Math.min(raceBox.right, panelBox.right) - Math.max(raceBox.left, panelBox.left);
    const overlapY = Math.min(raceBox.bottom, panelBox.bottom) - Math.max(raceBox.top, panelBox.top);
    const meaningfulOverlap = overlapX > 12 && overlapY > 12;
    const clearance = 34;
    const pad = Number.isFinite(options.pad) ? options.pad : 42;
    let dx = 0;
    let dy = 0;

    const panelOnRight = (panelBox.left + panelBox.right) / 2 >= viewBox.width / 2;
    const panelOnBottom = (panelBox.top + panelBox.bottom) / 2 >= viewBox.height / 2;
    const protectedRight = panelOnRight ? panelBox.left - clearance : viewBox.width - pad;
    const protectedLeft = panelOnRight ? pad : panelBox.right + clearance;
    const protectedBottom = panelOnBottom ? panelBox.top - clearance : viewBox.height - pad;
    const protectedTop = panelOnBottom ? pad : panelBox.bottom + clearance;

    const raceWidth = raceBox.right - raceBox.left;
    const raceHeight = raceBox.bottom - raceBox.top;
    const horizontalClearanceNeeded = meaningfulOverlap || raceBox.right > protectedRight || raceBox.left < protectedLeft;
    const verticalClearanceNeeded = meaningfulOverlap && (raceBox.bottom > protectedBottom || raceBox.top < protectedTop);

    if (raceWidth < Math.max(120, protectedRight - protectedLeft) && horizontalClearanceNeeded) {
      if (panelOnRight && raceBox.right > protectedRight) dx = protectedRight - raceBox.right;
      if (!panelOnRight && raceBox.left < protectedLeft) dx = protectedLeft - raceBox.left;
    }
    if (raceHeight < Math.max(120, protectedBottom - protectedTop) && verticalClearanceNeeded) {
      if (panelOnBottom && raceBox.bottom > protectedBottom) dy = protectedBottom - raceBox.bottom;
      if (!panelOnBottom && raceBox.top < protectedTop) dy = protectedTop - raceBox.top;
    }

    if (!dx && !dy && meaningfulOverlap) {
      const panelCenterX = (panelBox.left + panelBox.right) / 2;
      const raceCenterX = (raceBox.left + raceBox.right) / 2;
      const panelCenterY = (panelBox.top + panelBox.bottom) / 2;
      const raceCenterY = (raceBox.top + raceBox.bottom) / 2;
      if (overlapX >= overlapY * .75 || panelRect.width > panelRect.height) {
        dx = panelCenterX >= raceCenterX
          ? panelBox.left - raceBox.right - clearance
          : panelBox.right - raceBox.left + clearance;
      } else {
        dy = panelCenterY >= raceCenterY
          ? panelBox.top - raceBox.bottom - clearance
          : panelBox.bottom - raceBox.top + clearance;
      }
    }

    const candidate = {
      left: raceBox.left + dx,
      right: raceBox.right + dx,
      top: raceBox.top + dy,
      bottom: raceBox.bottom + dy
    };
    const availableWidth = viewBox.width - pad * 2;
    const availableHeight = viewBox.height - pad * 2;
    if ((candidate.right - candidate.left) <= availableWidth) {
      if (candidate.left < pad) dx += pad - candidate.left;
      if (candidate.right > viewBox.width - pad) dx -= candidate.right - (viewBox.width - pad);
    }
    if ((candidate.bottom - candidate.top) <= availableHeight) {
      if (candidate.top < pad) dy += pad - candidate.top;
      if (candidate.bottom > viewBox.height - pad) dy -= candidate.bottom - (viewBox.height - pad);
    }

    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return transform;
    return d3.zoomIdentity.translate(transform.x + dx, transform.y + dy).scale(transform.k);
  }

  currentTransform() {
    if (!this.svg?.node()) return null;
    return d3.zoomTransform(this.svg.node());
  }

  applyTransform(transform, duration = 250) {
    if (!this.svg || !this.zoom || !transform) return;
    const target = d3.zoomIdentity.translate(transform.x, transform.y).scale(transform.k);
    if (duration > 0) this.svg.transition().duration(duration).call(this.zoom.transform, target);
    else this.svg.call(this.zoom.transform, target);
  }

  findForecastRace(race) {
    if (!race) return null;
    const forecastId = String(race.forecastRaceId || "").trim();
    if (race.type === "house") {
      const districts = this.forecastSources.house?.districts || [];
      const districtId = houseGeometryId(race);
      return districts.find((item) => item.id === forecastId || item.id === districtId)
        || districts.find((item) => item.state === race.state && normalizedHouseDistrict(item.district) === normalizedHouseDistrict(race.district))
        || null;
    }
    if (race.type === "senate") {
      const races = this.forecastSources.senate?.races || [];
      return races.find((item) => item.id === forecastId || item.state === race.state) || null;
    }
    if (race.type === "governor") {
      const races = this.forecastSources.governor?.races || [];
      return races.find((item) => item.id === forecastId || item.state === race.state) || null;
    }
    return null;
  }

  forecastGeneratedAt(race) {
    const source = race?.type === "house"
      ? this.forecastSources.house
      : race?.type === "senate"
        ? this.forecastSources.senate
        : this.forecastSources.governor;
    return source?.runDate || source?.modelDate || source?.generatedAt || "Latest available forecast";
  }

  formatForecastMargin(value) {
    const margin = Number(value);
    if (!Number.isFinite(margin)) return null;
    if (Math.abs(margin) < 0.05) return "Even";
    return `${margin > 0 ? "D" : "R"} +${Math.abs(margin).toFixed(1)}`;
  }

  formatForecastProbability(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return formatPercent(number <= 1 ? number * 100 : number);
  }

  renderProjectionContext(forecastRace, race) {
    if (!forecastRace) {
      return `<div class="race-context-empty">No FEA forecast projection is available for this race.</div>`;
    }
    const margin = this.formatForecastMargin(forecastRace.margin ?? forecastRace.projectedMargin);
    const demProb = this.formatForecastProbability(forecastRace.demProbability);
    const repProb = this.formatForecastProbability(forecastRace.repProbability);
    const demShare = margin && Number.isFinite(Number(forecastRace.margin)) ? Math.max(0, Math.min(100, 50 + Number(forecastRace.margin) / 2)) : null;
    const repShare = demShare == null ? null : 100 - demShare;
    const rows = [
      ["FEA rating", forecastRace.modelRating || forecastRace.rating || forecastRace.baselineRating || forecastRace.sourceRating],
      ["Projected margin", margin],
      ["Projected vote share", demShare == null ? null : `D ${demShare.toFixed(1)} / R ${repShare.toFixed(1)}`],
      ["Win probability", demProb || repProb ? `Democrat ${demProb || "--"} / Republican ${repProb || "--"}` : null],
      ["Last updated", this.forecastGeneratedAt(race)]
    ].filter(([, value]) => value);
    if (!rows.length) {
      return `<div class="race-context-empty">This race is tracked by the forecast, but projection details are not available.</div>`;
    }
    return `<dl class="race-context-list">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}</dl>`;
  }

  latestPollObject(forecastRace) {
    const polls = (forecastRace?.polls || []).filter((poll) => poll && typeof poll === "object");
    return polls.sort((a, b) => String(b.endDate || "").localeCompare(String(a.endDate || "")))[0] || null;
  }

  renderPollingContext(forecastRace, race) {
    if (!forecastRace) return `<div class="race-context-empty">No reliable public polling is available for this race.</div>`;
    const inputs = forecastRace.sourceInputs || {};
    const latest = this.latestPollObject(forecastRace);
    const pollCount = Number(inputs.pollCount ?? forecastRace.polls?.length ?? 0);
    const pollMargin = this.formatForecastMargin(forecastRace.pollMargin ?? inputs.pollMargin);
    if (!latest && !pollCount && !pollMargin) {
      return `<div class="race-context-empty">This race is tracked by the forecast, but no public polling is currently included.</div>`;
    }
    const latestText = latest
      ? `${normalizeRaceNoteText(latest.pollster || latest.source || "Latest poll")}${latest.result ? `, ${normalizeRaceNoteText(latest.result)}` : ""}${latest.spread ? ` (${normalizeRaceNoteText(latest.spread)})` : ""}`
      : null;
    const rows = [
      ["Polling average", pollMargin],
      ["Polling count", pollCount ? `${pollCount} poll${pollCount === 1 ? "" : "s"} tracked` : null],
      ["Latest poll", latestText],
      ["Trend", inputs.pollReducedWeight ? "Primary or indirect polling is included at reduced weight." : pollSignalText(forecastRace.pollSignal)],
      ["Last updated", this.forecastGeneratedAt(race)]
    ].filter(([, value]) => value);
    return `<dl class="race-context-list">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}</dl>`;
  }

  renderFundraisingContext(forecastRace, race) {
    const context = race?.context?.fundraising || {};
    const demFinance = forecastRace?.fecDemCandidate;
    const repFinance = forecastRace?.fecRepCandidate;
    const money = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return value || null;
      return n >= 1000000 ? `$${(n / 1000000).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;
    };
    const rows = [
      ["Democrat raised", money(context.demRaised ?? demFinance?.receipts)],
      ["Republican raised", money(context.repRaised ?? repFinance?.receipts)],
      ["Democrat cash on hand", money(context.demCashOnHand ?? demFinance?.cash)],
      ["Republican cash on hand", money(context.repCashOnHand ?? repFinance?.cash)],
      ["Fundraising edge", context.edge]
    ].filter(([, value]) => value);
    if (!rows.length) return `<div class="race-context-empty">Fundraising data is not available in the current test dataset.</div>`;
    return `<dl class="race-context-list">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}</dl>`;
  }

  renderRaceContext(race) {
    const forecastRace = this.findForecastRace(race);
    const contextNotes = raceNotes(race).slice(0, 4);
    return `
      <div class="race-context-grid">
        <section class="race-context-section">
          <h4>Forecast Projection</h4>
          ${this.renderProjectionContext(forecastRace, race)}
        </section>
        <section class="race-context-section">
          <h4>Polling Overview</h4>
          ${this.renderPollingContext(forecastRace, race)}
        </section>
        <section class="race-context-section">
          <h4>Fundraising Overview</h4>
          ${this.renderFundraisingContext(forecastRace, race)}
        </section>
        <section class="race-context-section">
          <h4>Key Race Notes</h4>
          ${contextNotes.length
            ? `<div class="race-context-notes">${contextNotes.map((note) => `<span>${escapeHtml(note)}</span>`).join("")}</div>`
            : `<div class="race-context-empty">No additional context notes are available for this race.</div>`}
        </section>
      </div>
    `;
  }

  renderFocusedRace(race) {
    const panel = document.getElementById("focused-race-panel");
    const title = document.getElementById("focused-race-title");
    const content = document.getElementById("focused-race-content");
    const rating = document.getElementById("focused-race-rating");
    const kind = document.getElementById("focused-race-kind");
    if (!panel || !title || !content) return;

    const live = hasActiveResults(race);
    const leaderParty = raceWinnerParty(race);
    panel.hidden = false;
    panel.classList.remove("is-dragging");
    panel.classList.toggle("is-called", isActuallyCalled(race));
    if (!panel.querySelector(".focus-resize-handle")) {
      const resizeHandle = document.createElement("span");
      resizeHandle.className = "focus-resize-handle";
      resizeHandle.setAttribute("aria-hidden", "true");
      panel.appendChild(resizeHandle);
      this.bindFocusPanelResize();
    }
    panel.style.setProperty("--focus-color", partyColor(leaderParty));
    panel.classList.toggle("party-dem", leaderParty === "D");
    panel.classList.toggle("party-rep", leaderParty === "R");
    title.textContent = race.title;
    if (kind) {
      const keyRace = KEY_RACE_IDS.has(String(race.id)) || race.keyRace;
      kind.hidden = !keyRace;
      kind.textContent = keyRace ? "Key race" : "";
    }
    if (rating) rating.textContent = isActuallyCalled(race) ? "Called" : live ? "Reporting" : "Awaiting results";

    const allCandidates = topCandidates(race, 99);
    const visibleCandidates = allCandidates.slice(0, 5);
    const rows = visibleCandidates.map((candidate, index) => `
      <tr class="${index === 0 && live ? "leading" : ""}">
        <td>
          <span class="selected-party-rail" style="background:${candidateColor(candidate)}"></span>
          <strong>${candidate.name}${candidate.incumbent ? "*" : ""}</strong>
          <small>${partyLabel(candidate.party)}</small>
          ${percentDeltaBadge(race, candidate)}
        </td>
        <td>${live ? formatPercent(candidate.percent || 0) : "--"}</td>
        <td>${live ? formatVotes(candidate.votes) : "Awaiting"}</td>
      </tr>
    `).join("");
    const pathTracker = racePathTracker(race);
    const lastUpdated = formatEasternTime(race.updatedAt || race.lastUpdated || race.lastCheckedAt || Date.now());
    const lastChecked = formatEasternTime(Date.now());
    const feedProblem = race.feedError || race.resultFeedError || race.feedStatus === "error" || race.resultFeedStatus === "error";
    const otherCount = Math.max(0, allCandidates.length - visibleCandidates.length);
    content.innerHTML = `
      <div class="selected-race-tabs" role="tablist" aria-label="Race detail view">
        <button type="button" class="${this.focusedPanelTab === "results" ? "active" : ""}" data-focus-tab="results" role="tab" aria-selected="${this.focusedPanelTab === "results"}">Results</button>
        <button type="button" class="${this.focusedPanelTab === "context" ? "active" : ""}" data-focus-tab="context" role="tab" aria-selected="${this.focusedPanelTab === "context"}">Race Context</button>
      </div>
      <div class="selected-race-tab-panel" data-focus-tab-panel="results" ${this.focusedPanelTab === "results" ? "" : "hidden"}>
        ${feedProblem ? `<div class="race-feed-alert"><strong>Results feed temporarily unavailable.</strong><span>Retrying...</span></div>` : ""}
        ${awaitingResultsNote(race)}
        ${pathTracker ? `<div class="selected-race-insights">${pathTracker}</div>` : ""}
        <div class="selected-race-meta">
          <span class="race-meta-chip is-status">${live ? `${formatPercent(race.reportingPercent || 0)} reporting` : "No results yet"}</span>
          <span class="race-meta-chip">${isActuallyCalled(race) ? "Race called" : "Uncalled"}</span>
          <span class="race-meta-time"><small>Updated</small><b>${escapeHtml(lastUpdated)}</b></span>
          <span class="race-meta-time"><small>Checked</small><b data-last-checked-clock>${escapeHtml(lastChecked)}</b></span>
        </div>
        <table class="selected-race-table">
          <thead><tr><th>Candidate</th><th>Percent</th><th>Votes</th></tr></thead>
          <tbody>${rows}${otherCount ? `<tr class="selected-race-other"><td colspan="3">Other candidates (${otherCount}) will appear here as results report.</td></tr>` : ""}</tbody>
        </table>
        <div class="selected-race-foot">
          <span>${MODE_LABELS[race.type] || "Race"}</span>
          <span>${STATE_NAMES[race.state] || race.state}</span>
        </div>
      </div>
      <div class="selected-race-tab-panel" data-focus-tab-panel="context" ${this.focusedPanelTab === "context" ? "" : "hidden"}>
        ${this.renderRaceContext(race)}
      </div>
    `;
    content.querySelectorAll("[data-focus-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        this.focusedPanelTab = button.dataset.focusTab === "context" ? "context" : "results";
        this.renderFocusedRace(race);
      });
    });
    ensureRaceSnapshot(race);
    this.setFocusedUiState(true);
    this.positionFocusPanelForRace(race);
  }

  setFocusedUiState(active) {
    document.querySelector(".election-chamber-board")?.classList.toggle("is-focused-compact", Boolean(active));
    document.querySelector(".election-night-page")?.classList.toggle("has-focused-race", Boolean(active));
  }

  positionFocusPanelForRace(race) {
    const panel = document.getElementById("focused-race-panel");
    const shell = document.querySelector(".election-map-shell");
    if (!panel || panel.hidden || !shell) return;

    panel.style.top = "auto";
    panel.style.bottom = "18px";
    const state = String(race?.state || "").toUpperCase();
    const lon = STATE_CENTER_LONS[state] ?? -96;
    if (lon > -86.5) {
      panel.style.left = "18px";
      panel.style.right = "auto";
    } else {
      panel.style.left = "auto";
      panel.style.right = "18px";
    }

    const shellRect = shell.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    if (!shellRect.width || !panelRect.width) return;
    if (panelRect.width > shellRect.width * 0.48) {
      panel.style.width = `${Math.max(300, Math.floor(shellRect.width * 0.44))}px`;
    }
  }

  isStatewideRace(race) {
    if (race?.district != null || race?.municipality) return false;
    const type = String(race?.type || race?.electionType || "").toLowerCase();
    const name = String(race?.electionName || "").toLowerCase();
    return type.includes("governor") || type.includes("senate") || name.includes("governor") || name.includes("senate");
  }

  async findLiveDetailForRace(race) {
    if (!race) return null;
    const match = this.findLiveRaceIndexMatch(race);
    if (!match?.id) return null;
    if (this.liveRaceDetails.has(match.id)) return this.liveRaceDetails.get(match.id);
    const detail = await this.safeJson(`data/live-results-races/${match.id}.json`);
    this.liveRaceDetails.set(match.id, detail || null);
    return detail || null;
  }

  findLiveRaceIndexMatch(race) {
    const directId = String(race.liveResultId || race.resultId || "").trim();
    if (directId) {
      const direct = this.liveRaceIndex.find((item) => String(item.id) === directId);
      if (direct) return direct;
    }
    const modeType = String(race.type || "").toLowerCase();
    const candidates = this.liveRaceIndex.filter((item) => {
      if (item.state !== race.state) return false;
      const raceDate = String(race.date || race.electionDate || "").slice(0, 10);
      const itemDate = String(item.date || item.electionDate || "").slice(0, 10);
      if (raceDate && itemDate && raceDate !== itemDate) return false;
      if (!raceDate && itemDate) return false;
      const itemType = String(item.type || item.electionType || item.electionName || "").toLowerCase();
      if (modeType === "house") {
        const itemDistrict = normalizedHouseDistrict(item.district);
        const raceDistrict = normalizedHouseDistrict(race.district);
        return itemDistrict === raceDistrict && (itemType.includes("house") || item.officeType === "house");
      }
      if (item.district != null || item.municipality) return false;
      if (modeType === "governor") return itemType.includes("governor");
      if (modeType === "senate") return itemType.includes("senate");
      return false;
    });
    if (!candidates.length) return null;
    const raceNames = new Set((race.candidates || []).map((candidate) => String(candidate.name || "").toLowerCase()));
    const ranked = candidates
      .map((item) => ({
        item,
        score: (item.candidates || []).reduce((score, candidate) => score + (raceNames.has(String(candidate.name || "").toLowerCase()) ? 1 : 0), 0)
      }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 2) return null;
    return best.item;
  }

  async clearFocus() {
    this.currentRace = null;
    this.hideFocusPanel();
    if (this.detailMapActive) {
      this.detailMapActive = false;
      await this.renderMap();
      return;
    }
    if (this.svg && this.zoom) {
      this.svg.transition().duration(300).call(this.zoom.transform, d3.zoomIdentity);
    }
  }

  hideFocusPanel() {
    const panel = document.getElementById("focused-race-panel");
    if (panel) {
      panel.hidden = true;
      this.resetFocusPanelPosition(panel);
    }
    this.setFocusedUiState(false);
  }

  showTooltip(event, html) {
    if (!String(html || "").trim()) {
      this.hideTooltip();
      return;
    }
    const shell = document.querySelector(".election-map-shell");
    let tooltip = document.querySelector(".election-map-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "election-map-tooltip";
      (shell || document.body).appendChild(tooltip);
    } else if (shell && tooltip.parentElement !== shell) {
      shell.appendChild(tooltip);
    }
    tooltip.innerHTML = html;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const rect = tooltip.getBoundingClientRect();
    if (shell) {
      const shellRect = shell.getBoundingClientRect();
      const pointerX = event.clientX - shellRect.left;
      const pointerY = event.clientY - shellRect.top;
      const maxX = Math.max(10, shellRect.width - rect.width - 10);
      const maxY = Math.max(10, shellRect.height - rect.height - 10);
      let x = pointerX + 14;
      let y = pointerY + 14;
      if (x > maxX) x = pointerX - rect.width - 14;
      tooltip.style.left = `${Math.max(10, Math.min(maxX, x))}px`;
      tooltip.style.top = `${Math.max(10, Math.min(maxY, y))}px`;
      return;
    }
    let x = event.clientX + 14;
    let y = event.clientY + 18;
    if (x + rect.width > window.innerWidth - 12) x = event.clientX - rect.width - 14;
    if (y + rect.height > window.innerHeight - 12) y = Math.max(12, window.innerHeight - rect.height - 12);
    tooltip.style.left = `${Math.max(12, x)}px`;
    tooltip.style.top = `${Math.max(12, y)}px`;
  }

  hideTooltip() {
    document.querySelector(".election-map-tooltip")?.remove();
  }

  resetFocusPanelPosition(panel = document.getElementById("focused-race-panel")) {
    if (!panel) return;
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    panel.style.bottom = "";
    panel.style.width = "";
    panel.style.height = "";
    panel.style.maxHeight = "";
  }

  bindFocusPanelDrag() {
    const panel = document.getElementById("focused-race-panel");
    const handle = panel?.querySelector(".focused-card-head");
    const shell = document.querySelector(".election-map-shell");
    if (!panel || !handle || !shell) return;
    let drag = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const shellRect = shell.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      panel.style.left = `${panelRect.left - shellRect.left}px`;
      panel.style.top = `${panelRect.top - shellRect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: panelRect.left - shellRect.left,
        top: panelRect.top - shellRect.top
      };
      panel.classList.add("is-dragging");
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const shellRect = shell.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const nextLeft = Math.max(8, Math.min(shellRect.width - panelRect.width - 8, drag.left + event.clientX - drag.startX));
      const nextTop = Math.max(8, Math.min(shellRect.height - panelRect.height - 8, drag.top + event.clientY - drag.startY));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });
    handle.addEventListener("pointerup", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      panel.classList.remove("is-dragging");
      drag = null;
      handle.releasePointerCapture(event.pointerId);
    });
  }

  bindFocusPanelResize() {
    const panel = document.getElementById("focused-race-panel");
    const handle = panel?.querySelector(".focus-resize-handle");
    const shell = document.querySelector(".election-map-shell");
    if (!panel || !handle || !shell || handle.dataset.bound === "true") return;
    handle.dataset.bound = "true";
    let resize = null;
    handle.addEventListener("pointerdown", (event) => {
      const shellRect = shell.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      panel.style.left = `${panelRect.left - shellRect.left}px`;
      panel.style.top = `${panelRect.top - shellRect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      resize = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        width: panelRect.width,
        height: panelRect.height
      };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!resize || resize.pointerId !== event.pointerId) return;
      const shellRect = shell.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const maxWidth = Math.max(280, shellRect.width - (panelRect.left - shellRect.left) - 8);
      const maxHeight = Math.max(220, shellRect.height - (panelRect.top - shellRect.top) - 8);
      const width = Math.max(320, Math.min(maxWidth, resize.width + event.clientX - resize.startX));
      const height = Math.max(220, Math.min(maxHeight, resize.height + event.clientY - resize.startY));
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
      panel.style.maxHeight = "none";
    });
    handle.addEventListener("pointerup", (event) => {
      if (!resize || resize.pointerId !== event.pointerId) return;
      resize = null;
      handle.releasePointerCapture(event.pointerId);
    });
  }
}

function initElectionNight() {
  if (!window.d3 || !window.topojson) {
    setTimeout(initElectionNight, 60);
    return;
  }
  new ElectionNightPage();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initElectionNight);
} else {
  initElectionNight();
}
