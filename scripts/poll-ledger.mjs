import { readFileSync } from "node:fs";

const LEDGER_URL = new URL("../data/direct-poll-ledger.json", import.meta.url);
let cachedLedger;

function readLedger() {
  if (cachedLedger) return cachedLedger;
  cachedLedger = JSON.parse(readFileSync(LEDGER_URL, "utf8"));
  return cachedLedger;
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/[$,%]/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function canonical(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastName(value) {
  return canonical(value).split(" ").filter(Boolean).at(-1) || "";
}

export function candidateMatchConfidence(candidate, expectedName, expectedParty) {
  const name = candidate?.name || candidate?.candidate || "";
  const party = String(candidate?.party || "").toUpperCase();
  const expected = canonical(expectedName);
  if (!name && expectedParty && party === expectedParty) return "PARTY_GENERIC";
  if (!name) return "FAILED";
  if (canonical(name) === expected) return "EXACT";
  if (lastName(name) && lastName(name) === lastName(expectedName)) return "ALIAS";
  if (expectedParty && party === expectedParty && /^(democrat|republican|dem|rep|d|r)$/i.test(name)) return "PARTY_GENERIC";
  return "LOW_CONFIDENCE";
}

function candidateShare(poll, party) {
  const candidate = (poll.candidates || []).find((row) => String(row?.party || "").toUpperCase() === party);
  if (candidate) return number(candidate.pct);
  return number(party === "D" ? poll.dem : poll.rep);
}

function candidateForParty(poll, party) {
  return (poll.candidates || []).find((row) => String(row?.party || "").toUpperCase() === party) || {
    name: party === "D" ? "Democrat" : "Republican",
    party,
    pct: candidateShare(poll, party)
  };
}

function matchesScope(poll, scope) {
  if (String(poll.office || "").toLowerCase() !== String(scope.office || "").toLowerCase()) return false;
  if (scope.district) return String(poll.district || "").toUpperCase() === String(scope.district).toUpperCase();
  return String(poll.state || "").toUpperCase() === String(scope.state || "").toUpperCase();
}

function normalizedPoll(poll, scope, candidates = {}) {
  const dem = candidateShare(poll, "D");
  const rep = candidateShare(poll, "R");
  const endDate = String(poll.endDate || poll.end_date || "");
  if (!Number.isFinite(dem) || !Number.isFinite(rep) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !poll.pollster || !(poll.url || poll.sourceUrl)) return null;
  const demCandidate = candidateForParty(poll, "D");
  const repCandidate = candidateForParty(poll, "R");
  const demMatch = candidateMatchConfidence(demCandidate, candidates.dem, "D");
  const repMatch = candidateMatchConfidence(repCandidate, candidates.rep, "R");
  const matchConfidence = [demMatch, repMatch].includes("FAILED") ? "FAILED"
    : [demMatch, repMatch].includes("LOW_CONFIDENCE") ? "LOW_CONFIDENCE"
    : [demMatch, repMatch].includes("PARTY_GENERIC") ? "PARTY_GENERIC"
    : [demMatch, repMatch].includes("ALIAS") ? "ALIAS" : "EXACT";
  return {
    margin: dem - rep,
    source: poll.source || "Manual direct-poll ledger",
    sourceUrl: poll.url || poll.sourceUrl,
    pollster: poll.pollster,
    sponsor: poll.sponsor || null,
    endDate,
    startDate: poll.startDate || null,
    sampleSize: number(poll.sampleSize),
    population: poll.population || "unknown",
    partisan: Boolean(poll.partisan),
    internal: Boolean(poll.internal),
    weight: Number.isFinite(number(poll.weight)) ? number(poll.weight) : 1,
    candidates: [demCandidate, repCandidate],
    candidateMatchConfidence: { dem: demMatch, rep: repMatch, overall: matchConfidence }
  };
}

export function directPollLedger(scope, candidates = {}) {
  try {
    const ledger = readLedger();
    const rows = (Array.isArray(ledger.polls) ? ledger.polls : [])
      .filter((poll) => matchesScope(poll, scope))
      .map((poll) => normalizedPoll(poll, scope, candidates));
    const usable = rows.filter((poll) => poll && !["LOW_CONFIDENCE", "FAILED"].includes(poll.candidateMatchConfidence.overall));
    const skipped = rows.length - usable.length;
    return { polls: usable, skipped, source: ledger.source || "Direct release ledger" };
  } catch (error) {
    return { polls: [], skipped: 0, source: "Direct release ledger unavailable", error: error.message };
  }
}

export function dedupePollRows(polls = []) {
  const seen = new Map();
  for (const poll of polls) {
    const candidates = (poll.candidates || []).map((candidate) => `${candidate.party}:${lastName(candidate.name)}`).sort().join("|");
    const key = `${canonical(poll.pollster)}|${poll.endDate}|${poll.sampleSize || ""}|${candidates}`;
    const current = seen.get(key);
    if (!current || (poll.source || "").includes("Manual")) seen.set(key, poll);
  }
  return [...seen.values()];
}
