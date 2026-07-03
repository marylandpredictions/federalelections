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
  allowPrimary = false,
  requireStartDate = false,
  requireTableType = true,
  quarantine = false,
  quarantineReason = "SOURCE_QUARANTINED"
} = {}) {
  const rejectionReasons = [];
  const normalized = {
    ...row,
    office: normalizedOffice(row, office),
    state: normalizedState(row, state),
    tableType: normalizedTableType(row),
    source
  };

  if (!VALID_OFFICES.has(normalized.office)) rejectionReasons.push("INVALID_OFFICE");
  if (!VALID_STATES.has(normalized.state)) rejectionReasons.push("INVALID_STATE");

  if (requireTableType && !normalized.tableType) rejectionReasons.push("MISSING_TABLE_TYPE");
  if (/AVERAGE/.test(normalized.tableType)) rejectionReasons.push("POLLING_AVERAGE_NOT_A_RAW_POLL");
  if (/PRIMARY/.test(normalized.tableType) && !allowPrimary) rejectionReasons.push("PRIMARY_POLL_NOT_ALLOWED_FOR_GENERAL_FORECAST");
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
  if (pctValues.length < 2) rejectionReasons.push("INSUFFICIENT_NUMERIC_CANDIDATE_PERCENTAGES");
  if (pctValues.some((pct) => pct < 0 || pct > 100)) rejectionReasons.push("CANDIDATE_PERCENT_OUT_OF_RANGE");
  const pctTotal = pctValues.reduce((sum, pct) => sum + pct, 0);
  if (pctTotal > 105) rejectionReasons.push("IMPOSSIBLE_CANDIDATE_PERCENT_TOTAL");

  const pollMargin = finiteNumber(row.pollMargin ?? row.margin);
  if (pollMargin === null) rejectionReasons.push("MISSING_POLL_MARGIN");
  if (pollMargin !== null && Math.abs(pollMargin) > 100) rejectionReasons.push("IMPOSSIBLE_POLL_MARGIN");
  if (pollMargin !== null && Math.abs(pollMargin) > 50) rejectionReasons.push("POLL_MARGIN_REQUIRES_EXPLICIT_CONTEXT");

  if (hasResultArtifact(row)) rejectionReasons.push("NON_POLL_ARTIFACT_DETECTED");
  if (quarantine) rejectionReasons.push(quarantineReason);

  const accepted = rejectionReasons.length === 0;
  return {
    ...normalized,
    candidates,
    pollMargin,
    validationStatus: accepted ? "USABLE" : "REJECTED",
    validationSource: "scripts/lib/poll-validation.mjs",
    rejectionReasons: [...new Set(rejectionReasons)],
    usedInModel: accepted && !quarantine
  };
}

export function validatePollRows(rows = [], options = {}) {
  const rawRows = rows.map((row) => validatePollRow(row, options));
  const usableRows = rawRows.filter((row) => row.validationStatus === "USABLE" && row.usedInModel);
  const rejectedRows = rawRows.filter((row) => row.validationStatus !== "USABLE" || !row.usedInModel);
  return {
    rawRows,
    usableRows,
    rejectedRows,
    summary: pollingValidationSummary({ rawRows, usableRows, rejectedRows })
  };
}

export function pollingValidationSummary({ rawRows = [], usableRows = [], rejectedRows = [] } = {}) {
  const rejectionReasons = {};
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
    rejectionReasons
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
