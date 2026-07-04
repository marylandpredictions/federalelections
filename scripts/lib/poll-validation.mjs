import { readFileSync } from "node:fs";

const TRUST_CONFIG_URL = new URL("../../data/model-config/poll-source-trust-2026.json", import.meta.url);

export const POLL_VALIDATION_STATUSES = {
  VALIDATED: "VALIDATED",
  USABLE: "USABLE",
  QUARANTINED: "QUARANTINED",
  STALE_CANDIDATES: "STALE_CANDIDATES",
  PRIMARY_ONLY: "PRIMARY_ONLY",
  UNMATCHED_RACE: "UNMATCHED_RACE",
  SUPERSEDED: "SUPERSEDED"
};

export const SOURCE_TRUST_LEVELS = {
  TRUSTED_STRUCTURED: "TRUSTED_STRUCTURED",
  TRUSTED_SEMI_STRUCTURED: "TRUSTED_SEMI_STRUCTURED",
  MANUAL_VERIFIED: "MANUAL_VERIFIED",
  QUARANTINED: "QUARANTINED",
  LEGACY_FALLBACK: "LEGACY_FALLBACK"
};

const USABLE_STATUSES = new Set([POLL_VALIDATION_STATUSES.VALIDATED, POLL_VALIDATION_STATUSES.USABLE]);

const VALID_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
]);

const VALID_OFFICES = new Set(["senate", "governor", "house"]);
const TRUSTED_GENERAL_TABLE_TYPES = new Set([
  "INDIVIDUAL_GENERAL_ELECTION_POLL",
  "INDIVIDUAL_GENERAL_POLL",
  "GENERAL_ELECTION_POLL",
  "RAW_GENERAL_POLL"
]);

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizedOffice(row, fallback) {
  return String(row.office || fallback || "").trim().toLowerCase();
}

function normalizedState(row, fallback) {
  return String(row.state || fallback || "").trim().toUpperCase();
}

function normalizedTableType(row) {
  return String(row.tableType || row.rowType || "").trim().toUpperCase();
}

function sourceKeyFrom(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function loadPollSourceTrustConfig() {
  try {
    const parsed = JSON.parse(readFileSync(TRUST_CONFIG_URL, "utf8"));
    return {
      sources: parsed.sources || {},
      aliases: parsed.aliases || {}
    };
  } catch {
    return { sources: {}, aliases: {} };
  }
}

export function sourceTrustFor(source, config = loadPollSourceTrustConfig()) {
  const direct = sourceKeyFrom(source);
  const aliased = config.aliases?.[direct] || direct;
  const row = config.sources?.[aliased] || {};
  return {
    sourceKey: aliased || direct || "unknown",
    sourceTrust: row.trust || row.sourceTrust || SOURCE_TRUST_LEVELS.LEGACY_FALLBACK,
    sourceLabel: row.label || source || aliased || "Unknown source",
    notes: row.notes || ""
  };
}

function hasResultArtifact(row) {
  const haystack = [
    row.pollster,
    row.source,
    row.sourceUrl,
    row.title,
    ...(Array.isArray(row.candidates) ? row.candidates.map((candidate) => candidate.name) : [])
  ].join(" ").toLowerCase();
  return /result|fundraising|endorsement|candidate filing|election returns|winner|called race|primary results|fec|donor|citation/.test(haystack);
}

function candidatePercentages(row) {
  const candidates = Array.isArray(row.candidates) ? row.candidates : [];
  return candidates.map((candidate) => ({
    ...candidate,
    pct: finiteNumber(candidate.pct ?? candidate.percent ?? candidate.percentage)
  }));
}

export function validatePollRow(row = {}, {
  office,
  state,
  source = row.source || "unknown",
  sourceKey = row.sourceKey || row.source || source,
  allowPrimary = false,
  requireStartDate = false,
  requireTableType = true,
  allowSpreadOnly = false,
  primaryOnly = false,
  staleCandidates = false,
  unmatchedRace = false,
  superseded = false,
  quarantine = false,
  quarantineReason = "SOURCE_QUARANTINED",
  trustConfig = loadPollSourceTrustConfig()
} = {}) {
  const rejectionReasons = [];
  const trust = sourceTrustFor(sourceKey, trustConfig);
  const normalized = {
    ...row,
    office: normalizedOffice(row, office),
    state: normalizedState(row, state),
    tableType: normalizedTableType(row),
    source,
    sourceKey: trust.sourceKey,
    sourceTrust: row.sourceTrust || trust.sourceTrust,
    validationTrust: row.validationTrust || trust.sourceTrust
  };

  if (!VALID_OFFICES.has(normalized.office)) rejectionReasons.push("INVALID_OFFICE");
  if (!VALID_STATES.has(normalized.state)) rejectionReasons.push("INVALID_STATE");

  if (requireTableType && !normalized.tableType) rejectionReasons.push("MISSING_TABLE_TYPE");
  if (/AVERAGE/.test(normalized.tableType)) rejectionReasons.push("POLLING_AVERAGE_NOT_A_RAW_POLL");
  const rowIsPrimaryOnly = primaryOnly || (/PRIMARY/.test(normalized.tableType) && !allowPrimary);
  if (rowIsPrimaryOnly) rejectionReasons.push("PRIMARY_POLL_NOT_ALLOWED_FOR_GENERAL_FORECAST");
  if (normalized.tableType && !TRUSTED_GENERAL_TABLE_TYPES.has(normalized.tableType)) {
    rejectionReasons.push("UNTRUSTED_OR_UNKNOWN_TABLE_TYPE");
  }

  const startDate = row.startDate || row.fieldDateStart || row.dateStart || null;
  const endDate = row.endDate || row.fieldDateEnd || row.date || null;
  if (requireStartDate && !parseDate(startDate)) rejectionReasons.push("MISSING_OR_INVALID_START_DATE");
  if (!parseDate(endDate)) rejectionReasons.push("MISSING_OR_INVALID_END_DATE");

  const sampleSize = finiteNumber(row.sampleSize);
  if (row.sampleSize !== null && row.sampleSize !== undefined && row.sampleSize !== "" && sampleSize === null) {
    rejectionReasons.push("INVALID_SAMPLE_SIZE");
  }

  const candidates = candidatePercentages(row);
  if (candidates.length < 2) rejectionReasons.push("INSUFFICIENT_CANDIDATE_PERCENTAGES");
  const pctValues = candidates.map((candidate) => candidate.pct).filter(Number.isFinite);
  if (pctValues.length < 2 && !allowSpreadOnly) rejectionReasons.push("INSUFFICIENT_NUMERIC_CANDIDATE_PERCENTAGES");
  if (pctValues.some((pct) => pct < 0 || pct > 100)) rejectionReasons.push("CANDIDATE_PERCENT_OUT_OF_RANGE");
  const pctTotal = pctValues.reduce((sum, pct) => sum + pct, 0);
  if (pctTotal > 105) rejectionReasons.push("IMPOSSIBLE_CANDIDATE_PERCENT_TOTAL");

  const pollMargin = finiteNumber(row.pollMargin ?? row.margin);
  if (pollMargin === null) rejectionReasons.push("MISSING_POLL_MARGIN");
  if (pollMargin !== null && Math.abs(pollMargin) > 100) rejectionReasons.push("IMPOSSIBLE_POLL_MARGIN");
  if (pollMargin !== null && Math.abs(pollMargin) > 50) rejectionReasons.push("POLL_MARGIN_REQUIRES_EXPLICIT_CONTEXT");

  if (hasResultArtifact(row)) rejectionReasons.push("NON_POLL_ARTIFACT_DETECTED");
  if (staleCandidates || row.staleCandidates) rejectionReasons.push("STALE_CANDIDATES");
  if (unmatchedRace || row.unmatchedRace) rejectionReasons.push("UNMATCHED_RACE");
  if (superseded || row.superseded) rejectionReasons.push("SUPERSEDED_BY_NEWER_ROW");
  if (normalized.sourceTrust === SOURCE_TRUST_LEVELS.QUARANTINED) rejectionReasons.push(quarantineReason);
  if (normalized.sourceTrust === SOURCE_TRUST_LEVELS.LEGACY_FALLBACK) rejectionReasons.push("LEGACY_FALLBACK_NOT_MODEL_USABLE");
  if (quarantine) rejectionReasons.push(quarantineReason);

  const accepted = rejectionReasons.length === 0;
  let validationStatus = accepted
    ? (normalized.sourceTrust === SOURCE_TRUST_LEVELS.TRUSTED_STRUCTURED || normalized.sourceTrust === SOURCE_TRUST_LEVELS.MANUAL_VERIFIED
      ? POLL_VALIDATION_STATUSES.VALIDATED
      : POLL_VALIDATION_STATUSES.USABLE)
    : POLL_VALIDATION_STATUSES.QUARANTINED;
  if (!accepted) {
    if (rejectionReasons.includes("PRIMARY_POLL_NOT_ALLOWED_FOR_GENERAL_FORECAST")) validationStatus = POLL_VALIDATION_STATUSES.PRIMARY_ONLY;
    else if (rejectionReasons.includes("STALE_CANDIDATES")) validationStatus = POLL_VALIDATION_STATUSES.STALE_CANDIDATES;
    else if (rejectionReasons.includes("UNMATCHED_RACE")) validationStatus = POLL_VALIDATION_STATUSES.UNMATCHED_RACE;
    else if (rejectionReasons.includes("SUPERSEDED_BY_NEWER_ROW")) validationStatus = POLL_VALIDATION_STATUSES.SUPERSEDED;
  }
  return {
    ...normalized,
    candidates,
    pollMargin,
    validationStatus,
    validationSource: "scripts/lib/poll-validation.mjs",
    rejectionReasons: [...new Set(rejectionReasons)],
    usedInModel: accepted && USABLE_STATUSES.has(validationStatus)
  };
}

export function validatePollRows(rows = [], options = {}) {
  const rawRows = rows.map((row) => validatePollRow(row, options));
  const usableRows = rawRows.filter((row) => USABLE_STATUSES.has(row.validationStatus) && row.usedInModel);
  const rejectedRows = rawRows.filter((row) => !USABLE_STATUSES.has(row.validationStatus) || !row.usedInModel);
  return {
    rawRows,
    usableRows,
    rejectedRows,
    summary: pollingValidationSummary({ rawRows, usableRows, rejectedRows })
  };
}

export function pollingValidationSummary({ rawRows = [], usableRows = [], rejectedRows = [] } = {}) {
  const rejectionReasons = {};
  const statuses = {};
  const sourceTrust = {};
  for (const row of rawRows) {
    statuses[row.validationStatus || "UNKNOWN"] = (statuses[row.validationStatus || "UNKNOWN"] || 0) + 1;
    sourceTrust[row.sourceTrust || row.validationTrust || "UNKNOWN"] = (sourceTrust[row.sourceTrust || row.validationTrust || "UNKNOWN"] || 0) + 1;
  }
  for (const row of rejectedRows) {
    for (const reason of row.rejectionReasons || ["UNKNOWN_REJECTION"]) {
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    }
  }
  return {
    rawRows: rawRows.length,
    usableRows: usableRows.length,
    rejectedRows: rejectedRows.length,
    usedInModel: usableRows.length > 0,
    rejectionReasons,
    statuses,
    sourceTrust
  };
}

export function sanitizePollingCache(cache = {}, {
  office,
  source = cache.source || "unknown",
  forceQuarantine = false,
  quarantineReason = "SOURCE_QUARANTINED"
} = {}) {
  const inputRows = Array.isArray(cache.rawRows) ? cache.rawRows : Array.isArray(cache.rows) ? cache.rows : [];
  const validated = validatePollRows(inputRows, {
    office: office || cache.office,
    source,
    requireStartDate: true,
    requireTableType: true,
    quarantine: forceQuarantine,
    quarantineReason
  });
  const status = forceQuarantine && inputRows.length
    ? "QUARANTINED"
    : inputRows.length
      ? (validated.usableRows.length ? "OK_PARSED" : "NO_USABLE_ROWS")
      : (cache.status || "OK_NO_ROWS");
  return {
    ...cache,
    status,
    rawRows: validated.rawRows,
    usableRows: forceQuarantine ? [] : validated.usableRows,
    rejectedRows: forceQuarantine ? validated.rawRows : validated.rejectedRows,
    rows: forceQuarantine ? [] : validated.usableRows,
    usedInModel: !forceQuarantine && validated.usableRows.length > 0,
    pollingValidation: pollingValidationSummary({
      rawRows: validated.rawRows,
      usableRows: forceQuarantine ? [] : validated.usableRows,
      rejectedRows: forceQuarantine ? validated.rawRows : validated.rejectedRows
    }),
    validationPolicy: {
      source,
      forceQuarantine,
      quarantineReason,
      note: forceQuarantine
        ? "Rows are cached for inspection only and are not model inputs."
        : "Rows passed strict validation before model use."
    }
  };
}
