const STATE_ABBREVIATIONS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
]);

const OFFICE_ALIASES = new Map([
  ["senate", "senate"],
  ["sen", "senate"],
  ["us senate", "senate"],
  ["governor", "governor"],
  ["gov", "governor"],
  ["gubernatorial", "governor"],
  ["house", "house"],
  ["us house", "house"],
  ["u.s. house", "house"],
  ["generic-ballot", "generic-ballot"],
  ["generic ballot", "generic-ballot"]
]);

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeOffice(value, fallback = null) {
  const key = cleanText(value || fallback).toLowerCase();
  return OFFICE_ALIASES.get(key) || key || null;
}

export function normalizeState(value, fallback = null) {
  const state = cleanText(value || fallback).toUpperCase();
  return STATE_ABBREVIATIONS.has(state) ? state : null;
}

export function normalizeCandidate(candidate = {}) {
  const name = cleanText(candidate.name || candidate.candidate || candidate.label);
  const party = cleanText(candidate.party || candidate.partyCode || candidate.affiliation).toUpperCase() || null;
  return {
    name: name || null,
    party,
    pct: finiteNumber(candidate.pct ?? candidate.percent ?? candidate.percentage ?? candidate.share)
  };
}

export function canonicalRaceId({ office, state, district, raceId, cycle = 2026 } = {}) {
  if (raceId) return cleanText(raceId);
  const normalizedOffice = normalizeOffice(office);
  const normalizedState = normalizeState(state) || "US";
  if (normalizedOffice === "senate") return `${normalizedState}-SEN-${cycle}`;
  if (normalizedOffice === "governor") return `${normalizedState}-GOV-${cycle}`;
  if (normalizedOffice === "house") {
    const districtText = cleanText(district || "AL").toUpperCase().replace(/^0+(\d)$/, "0$1");
    return `${normalizedState}-${districtText}-${cycle}`;
  }
  return `${normalizedState}-${normalizedOffice || "poll"}-${cycle}`;
}

function normalizeCandidates(row = {}) {
  if (Array.isArray(row.candidates)) return row.candidates.map(normalizeCandidate).filter((candidate) => candidate.name);
  const candidates = [];
  const dem = finiteNumber(row.dem ?? row.demShare ?? row.demPct);
  const rep = finiteNumber(row.rep ?? row.repShare ?? row.repPct);
  if (dem !== null || row.demCandidate) candidates.push({ name: cleanText(row.demCandidate || "Democrat"), party: "D", pct: dem });
  if (rep !== null || row.repCandidate) candidates.push({ name: cleanText(row.repCandidate || "Republican"), party: "R", pct: rep });
  return candidates;
}

export function normalizePollRow(row = {}, context = {}) {
  const office = normalizeOffice(row.office, context.office);
  const state = normalizeState(row.state, context.state);
  const cycle = Number(row.cycle || context.cycle || 2026);
  const candidates = normalizeCandidates(row);
  const margin = finiteNumber(row.margin ?? row.pollMargin);
  return {
    ledgerId: row.ledgerId || context.ledgerId || null,
    office,
    cycle,
    raceId: canonicalRaceId({ office, state, district: row.district, raceId: row.raceId || row.id, cycle }),
    state,
    district: row.district ?? null,
    sourceKind: row.sourceKind || context.sourceKind || "upstream-cache",
    sourceTrust: row.sourceTrust || context.sourceTrust || null,
    sourceName: cleanText(row.sourceName || row.sourceLabel || row.source || context.sourceName || context.source || "Unknown source"),
    sourceUrl: row.sourceUrl || row.url || null,
    pollster: cleanText(row.pollster || row.sourcePollster || row.source || "") || null,
    sponsor: cleanText(row.sponsor || "") || null,
    startDate: row.startDate || row.fieldDateStart || row.dateStart || null,
    endDate: row.endDate || row.fieldDateEnd || row.date || null,
    sampleSize: finiteNumber(row.sampleSize),
    population: cleanText(row.population || "") || null,
    rowType: cleanText(row.rowType || row.tableType || context.rowType || "").toUpperCase() || null,
    tableType: cleanText(row.tableType || row.rowType || context.tableType || "").toUpperCase() || null,
    candidates,
    candidateMap: candidates,
    demShare: finiteNumber(row.dem ?? row.demShare ?? row.demPct),
    repShare: finiteNumber(row.rep ?? row.repShare ?? row.repPct),
    margin,
    raw: row.raw ?? null,
    rawSourcePath: context.rawSourcePath || row.rawSourcePath || null,
    upstreamGeneratedAt: context.generatedAt || row.generatedAt || null
  };
}

export { STATE_ABBREVIATIONS };
