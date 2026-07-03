import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const FORECAST_URL = new URL("../data/governor-forecast.json", import.meta.url);
const OUTPUT_URL = new URL("../data/diagnostics/governor-polling-merge-audit-2026.json", import.meta.url);

const REQUIRED_REVIEW_STATES = new Set([
  "AZ",
  "GA",
  "IA",
  "NV",
  "OH",
  "WI",
  "PA",
  "NY",
  "MI",
  "VT",
  "FL",
  "KS",
  "AK"
]);

function readJson(url) {
  try {
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      races: [],
      readError: error.message
    };
  }
}

function finite(value, digits = 3) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function pollingRows(race) {
  const rows = [
    ...(Array.isArray(race.pollEntries) ? race.pollEntries : []),
    ...(Array.isArray(race.sourceInputs?.pollEntries) ? race.sourceInputs.pollEntries : []),
    ...(Array.isArray(race.sourceInputs?.polls) ? race.sourceInputs.polls : [])
  ];
  return rows;
}

function inferredParsedRows(race) {
  const rows = pollingRows(race);
  if (rows.length) return rows.length;
  const total = Number(race.totalPollInputsUsed ?? race.pollingSummary?.totalPollInputsUsed);
  if (Number.isFinite(total)) return total;
  return 0;
}

function mergeStatus(race, parsedRows, validatedRows, mergedRows) {
  const status = String(race.pollingStatus || race.pollingSummary?.pollingStatus || "");
  if (mergedRows > 0) return "MERGED";
  if (!parsedRows) return "NO_PARSED_POLLS";
  if (!validatedRows) return status.includes("REJECT") ? "POLL_REJECTED_VALIDATION" : "PARSED_NOT_VALIDATED";
  if (status.includes("CANDIDATE") || status.includes("MATCH")) return "CANDIDATE_ALIAS_MISMATCH";
  return "PARSED_NOT_MERGED";
}

function reasonsForStatus(status, race) {
  if (status === "MERGED") return ["Race-level polling is merged into the forecast."];
  if (status === "NO_PARSED_POLLS") return ["No current structured general-election polling rows are available for this race."];
  if (status === "POLL_REJECTED_VALIDATION") return ["Polling rows were parsed but rejected by strict validation."];
  if (status === "CANDIDATE_ALIAS_MISMATCH") return ["Parsed polling may not match the current modeled candidate aliases."];
  if (status === "PARSED_NOT_VALIDATED") return ["Rows were detected but did not pass the general-election polling validator."];
  return ["Polling rows were detected but did not merge into this race output."];
}

function auditRace(race) {
  const parsedRows = inferredParsedRows(race);
  const validatedRows = Number(race.totalPollInputsUsed ?? race.pollingSummary?.totalPollInputsUsed ?? race.usablePollCount ?? 0);
  const mergedRows = Number(race.usablePollCount ?? race.pollingSummary?.usablePollCount ?? 0);
  const status = mergeStatus(race, parsedRows, validatedRows, mergedRows);
  const mandatoryReview = REQUIRED_REVIEW_STATES.has(race.state);
  const reviewRequired = status !== "MERGED" && mandatoryReview;
  return {
    state: race.state,
    race: race.displayName || `${race.state} Governor`,
    mandatoryReview,
    parsedPollRows: parsedRows,
    validatedPollRows: Number.isFinite(validatedRows) ? validatedRows : 0,
    mergedPollRows: Number.isFinite(mergedRows) ? mergedRows : 0,
    pollingStatus: race.pollingStatus || race.pollingSummary?.pollingStatus || null,
    mergeStatus: status,
    reviewRequired,
    demCandidate: race.dem || race.demCandidate || null,
    repCandidate: race.rep || race.repCandidate || null,
    projectedMargin: finite(race.projectedMargin ?? race.margin, 2),
    probabilityMargin: finite(race.probabilityEngineMargin ?? race.probabilityMargin, 2),
    reasons: reasonsForStatus(status, race),
    candidateAliasesPresent: Boolean(race.dem || race.demCandidate) && Boolean(race.rep || race.repCandidate)
  };
}

const forecast = readJson(FORECAST_URL);
const races = Array.isArray(forecast.races) ? forecast.races : [];
const raceAudits = races.map(auditRace);
const audit = {
  generatedAt: new Date().toISOString(),
  sourceForecastGeneratedAt: forecast.generatedAt || null,
  schemaVersion: "2026.governor-polling-merge-audit.1",
  readError: forecast.readError || null,
  summary: {
    races: raceAudits.length,
    merged: raceAudits.filter((race) => race.mergeStatus === "MERGED").length,
    noParsedPolls: raceAudits.filter((race) => race.mergeStatus === "NO_PARSED_POLLS").length,
    rejectedOrUnmerged: raceAudits.filter((race) => !["MERGED", "NO_PARSED_POLLS"].includes(race.mergeStatus)).length,
    reviewRequired: raceAudits.filter((race) => race.reviewRequired).map((race) => race.state)
  },
  races: raceAudits
};

mkdirSync(new URL("../data/diagnostics/", import.meta.url), { recursive: true });
writeFileSync(OUTPUT_URL, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
console.log(`Wrote data/diagnostics/governor-polling-merge-audit-2026.json for ${audit.summary.races} governor races.`);
