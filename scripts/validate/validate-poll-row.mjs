import { readFileSync } from "node:fs";
import { normalizePollRow, STATE_ABBREVIATIONS } from "../normalize/normalize-poll-row.mjs";

export const VALIDATION_STATUSES = {
  VALID: "VALID",
  QUARANTINED: "QUARANTINED",
  DIAGNOSTIC_ONLY: "DIAGNOSTIC_ONLY"
};

export const QUARANTINE_REASONS = {
  GENERATED_FORECAST_OUTPUT: "GENERATED_FORECAST_OUTPUT",
  POLLING_AVERAGE: "AVERAGE_ROW",
  PRIMARY_ONLY: "PRIMARY_ROW",
  INVALID_OFFICE: "BAD_RACE_MATCH",
  INVALID_STATE: "BAD_RACE_MATCH",
  INVALID_DATE: "BAD_DATE",
  INVALID_CANDIDATES: "LOW_CANDIDATE_MATCH",
  IMPOSSIBLE_PERCENT: "INVALID_PERCENT",
  IMPOSSIBLE_TOTAL: "IMPOSSIBLE_SUM",
  IMPOSSIBLE_MARGIN: "INVALID_PERCENT",
  NON_POLL_ARTIFACT: "NON_POLL_TABLE",
  MISSING_PROVENANCE: "MISSING_PROVENANCE",
  STALE_CANDIDATES: "STALE_CANDIDATES",
  UNMATCHED_RACE: "BAD_RACE_MATCH",
  LEGACY_FALLBACK: "LEGACY_FALLBACK_EXCLUDED",
  SUPERSEDED: "DUPLICATE_SUPERSEDED",
  QUARANTINED_SOURCE: "WIKIPEDIA_EXPERIMENTAL"
};

const VALID_OFFICES = new Set(["senate", "governor", "house", "generic-ballot"]);
const VALID_GENERAL_TYPES = new Set([
  "INDIVIDUAL_GENERAL_ELECTION_POLL",
  "INDIVIDUAL_GENERAL_POLL",
  "GENERAL_ELECTION_POLL",
  "RAW_GENERAL_POLL"
]);

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function containsResultArtifact(row) {
  const text = [
    row.pollster,
    row.sourceName,
    row.sourceUrl,
    row.title,
    ...(Array.isArray(row.candidates) ? row.candidates.map((candidate) => candidate.name) : [])
  ].join(" ").toLowerCase();
  return /result|returns|winner|called race|endorsement|fundraising|fec|donor|filing/.test(text);
}

function rowType(row) {
  return String(row.rowType || row.tableType || "").toUpperCase();
}

export function validatePollRow(input = {}, options = {}) {
  const row = normalizePollRow(input, options);
  const reasons = new Set();
  const type = rowType(row);

  if (row.sourceKind === "generated-forecast-output") reasons.add(QUARANTINE_REASONS.GENERATED_FORECAST_OUTPUT);
  if (!VALID_OFFICES.has(row.office)) reasons.add(QUARANTINE_REASONS.INVALID_OFFICE);
  if (row.office !== "generic-ballot" && !STATE_ABBREVIATIONS.has(row.state)) reasons.add(QUARANTINE_REASONS.INVALID_STATE);

  if (type.includes("AVERAGE")) reasons.add(QUARANTINE_REASONS.POLLING_AVERAGE);
  if (type.includes("PRIMARY") && !options.allowPrimary) reasons.add(QUARANTINE_REASONS.PRIMARY_ONLY);
  if (type && !VALID_GENERAL_TYPES.has(type) && !type.includes("PRIMARY") && !type.includes("AVERAGE")) {
    reasons.add("UNTRUSTED_OR_UNKNOWN_TABLE_TYPE");
  }
  if (!type && options.requireTableType !== false) reasons.add("MISSING_TABLE_TYPE");

  if (!parseDate(row.endDate)) reasons.add(QUARANTINE_REASONS.INVALID_DATE);
  if (options.requireStartDate && !parseDate(row.startDate)) reasons.add(QUARANTINE_REASONS.INVALID_DATE);

  const pctValues = (row.candidates || []).map((candidate) => candidate.pct).filter(Number.isFinite);
  if (pctValues.length < 2 && !options.allowSpreadOnly) reasons.add(QUARANTINE_REASONS.INVALID_CANDIDATES);
  if (pctValues.some((pct) => pct < 0 || pct > 100)) reasons.add(QUARANTINE_REASONS.IMPOSSIBLE_PERCENT);
  if (pctValues.reduce((sum, pct) => sum + pct, 0) > 105) reasons.add(QUARANTINE_REASONS.IMPOSSIBLE_TOTAL);
  if (!Number.isFinite(row.margin)) reasons.add("MISSING_POLL_MARGIN");
  if (Number.isFinite(row.margin) && Math.abs(row.margin) > 100) reasons.add(QUARANTINE_REASONS.IMPOSSIBLE_MARGIN);
  if (Number.isFinite(row.margin) && Math.abs(row.margin) > 50) reasons.add("POLL_MARGIN_REQUIRES_EXPLICIT_CONTEXT");
  if ((!row.sourceName || row.sourceName === "Unknown source") && !row.sourceUrl) reasons.add(QUARANTINE_REASONS.MISSING_PROVENANCE);

  if (containsResultArtifact(row)) reasons.add(QUARANTINE_REASONS.NON_POLL_ARTIFACT);
  if (input.staleCandidates) reasons.add(QUARANTINE_REASONS.STALE_CANDIDATES);
  if (input.unmatchedRace) reasons.add(QUARANTINE_REASONS.UNMATCHED_RACE);
  if (input.legacy) reasons.add(QUARANTINE_REASONS.LEGACY_FALLBACK);
  if (input.superseded) reasons.add(QUARANTINE_REASONS.SUPERSEDED);
  if (String(row.sourceTrust || "").toUpperCase() === "QUARANTINED") reasons.add(QUARANTINE_REASONS.QUARANTINED_SOURCE);
  if (String(row.sourceTrust || "").toUpperCase() === "LEGACY_FALLBACK") reasons.add(QUARANTINE_REASONS.LEGACY_FALLBACK);

  let validationStatus = reasons.size ? VALIDATION_STATUSES.QUARANTINED : VALIDATION_STATUSES.VALID;
  if (reasons.has(QUARANTINE_REASONS.POLLING_AVERAGE) && reasons.size === 1) validationStatus = VALIDATION_STATUSES.DIAGNOSTIC_ONLY;

  return {
    ...row,
    validationStatus,
    rejectionReasons: [...reasons],
    usedInModel: validationStatus === VALIDATION_STATUSES.VALID
  };
}

export function validationSummary(rows = []) {
  return rows.reduce((summary, row) => {
    const status = row.validationStatus || "UNKNOWN";
    summary.total += 1;
    summary.byValidationStatus[status] = (summary.byValidationStatus[status] || 0) + 1;
    if (row.usedInModel) summary.usedInModel += 1;
    for (const reason of row.rejectionReasons || []) {
      summary.rejectionReasons[reason] = (summary.rejectionReasons[reason] || 0) + 1;
    }
    return summary;
  }, { total: 0, usedInModel: 0, byValidationStatus: {}, rejectionReasons: {} });
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/validate/validate-poll-row.mjs <poll-row-json>");
    process.exit(1);
  }
  const parsed = JSON.parse(readFileSync(inputPath, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  console.log(JSON.stringify(rows.map((row) => validatePollRow(row)), null, 2));
}
