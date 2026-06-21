export const SOURCE_HEALTH = Object.freeze({
  OK_PARSED: "OK_PARSED",
  OK_NO_ROWS: "OK_NO_ROWS",
  BLOCKED_403: "BLOCKED_403",
  NOT_FOUND_404: "NOT_FOUND_404",
  HTML_ONLY: "HTML_ONLY",
  PARSE_FAILED: "PARSE_FAILED",
  STALE: "STALE",
  DISABLED: "DISABLED",
  UNKNOWN_ERROR: "UNKNOWN_ERROR"
});

function isHtml(text = "") {
  return /^\s*(?:<!doctype html|<html\b|<head\b|<body\b)/i.test(String(text));
}

export function recordFetch(status, label, response, text, url, startedAt, options = {}) {
  const expected = options.expected || "text";
  let health = SOURCE_HEALTH.OK_PARSED;
  if (response.status === 403) health = SOURCE_HEALTH.BLOCKED_403;
  else if (response.status === 404) health = SOURCE_HEALTH.NOT_FOUND_404;
  else if (!response.ok) health = SOURCE_HEALTH.UNKNOWN_ERROR;
  else if ((expected === "json" || expected === "csv") && isHtml(text)) health = SOURCE_HEALTH.HTML_ONLY;

  const record = {
    health,
    ok: health === SOURCE_HEALTH.OK_PARSED,
    status: health,
    httpStatus: response.status,
    ms: Date.now() - startedAt,
    url,
    expected
  };
  if (!record.ok) record.error = String(text || "").slice(0, 180);
  status[label] = record;
  return record;
}

export function recordFetchError(status, label, error, url, startedAt) {
  status[label] = {
    health: SOURCE_HEALTH.UNKNOWN_ERROR,
    ok: false,
    status: SOURCE_HEALTH.UNKNOWN_ERROR,
    ms: Date.now() - startedAt,
    url,
    error: error?.message || String(error)
  };
  return status[label];
}

export function markNoRows(status, label, extra = {}) {
  if (!status[label]) return;
  status[label] = { ...status[label], health: SOURCE_HEALTH.OK_NO_ROWS, ok: true, status: SOURCE_HEALTH.OK_NO_ROWS, ...extra };
}

export function markParseFailed(status, label, error, extra = {}) {
  if (!status[label]) return;
  status[label] = {
    ...status[label],
    health: SOURCE_HEALTH.PARSE_FAILED,
    ok: false,
    status: SOURCE_HEALTH.PARSE_FAILED,
    error: error?.message || String(error),
    ...extra
  };
}

export function markDisabled(status, label, reason, extra = {}) {
  status[label] = {
    health: SOURCE_HEALTH.DISABLED,
    ok: true,
    status: SOURCE_HEALTH.DISABLED,
    reason,
    ...extra
  };
}

export function sourceHealthSummary(status = {}, options = {}) {
  const entries = Object.entries(status).filter(([key]) => key !== "checkedAt" && key !== "generatedAt");
  const critical = options.critical || [];
  const failure = new Set([
    SOURCE_HEALTH.BLOCKED_403,
    SOURCE_HEALTH.NOT_FOUND_404,
    SOURCE_HEALTH.HTML_ONLY,
    SOURCE_HEALTH.PARSE_FAILED,
    SOURCE_HEALTH.STALE,
    SOURCE_HEALTH.UNKNOWN_ERROR
  ]);
  const unhealthy = entries.filter(([, value]) => failure.has(value?.health));
  const criticalFailures = unhealthy.filter(([key]) => critical.includes(key));
  const degraded = criticalFailures.length > 0;
  return {
    degraded,
    health: degraded ? "DEGRADED" : "HEALTHY",
    usableSources: entries.filter(([, value]) => value?.health === SOURCE_HEALTH.OK_PARSED).map(([key]) => key),
    noRowSources: entries.filter(([, value]) => value?.health === SOURCE_HEALTH.OK_NO_ROWS).map(([key]) => key),
    unavailableSources: unhealthy.map(([key]) => key),
    criticalFailures: criticalFailures.map(([key]) => key),
    message: degraded
      ? "Forecast degraded: one or more important source feeds were unavailable or unreadable."
      : "Core source feeds completed without a critical fetch failure."
  };
}

export function sourceHealthWarnings(sourceHealth, label) {
  if (!sourceHealth?.degraded) return [];
  const detail = sourceHealth.criticalFailures?.length
    ? `${sourceHealth.criticalFailures.join(", ")} unavailable or unreadable.`
    : sourceHealth.message || "important source coverage is incomplete.";
  return [{
    severity: "warning",
    type: "source-health-degraded",
    source: label,
    message: `${label} forecast degraded: ${detail}`
  }];
}
