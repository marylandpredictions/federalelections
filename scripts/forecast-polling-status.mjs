const POLLING_STATUSES = new Set([
  "LIVE_POLLS_AVAILABLE",
  "MANUAL_POLLS_AVAILABLE",
  "LIVE_AND_MANUAL_POLLS_AVAILABLE",
  "LEGACY_FALLBACK_ONLY",
  "NO_RACE_POLLS",
  "SOURCE_FAILURE",
  "PARSE_FAILURE"
]);

function kindForPoll(poll = {}) {
  if (poll.legacy || String(poll.source || "").toLowerCase().includes("legacy")) return "legacy";
  if (poll.manual || String(poll.source || "").toLowerCase().includes("direct poll") || String(poll.source || "").toLowerCase().includes("manual")) return "manual";
  return "live";
}

export function classifyPollingInputs(polls = [], sourceHealth = {}) {
  const rows = polls.filter((poll) => Number.isFinite(Number(poll?.margin)));
  const counts = { live: 0, manual: 0, legacy: 0 };
  for (const poll of rows) counts[kindForPoll(poll)] += 1;
  const parseFailure = Object.values(sourceHealth).some((entry) => entry?.health === "PARSE_FAILED");
  const sourceFailure = Object.values(sourceHealth).some((entry) => ["BLOCKED_403", "NOT_FOUND_404", "HTML_ONLY", "UNKNOWN_ERROR"].includes(entry?.health));
  let pollingStatus = "NO_RACE_POLLS";
  if (counts.live && counts.manual) pollingStatus = "LIVE_AND_MANUAL_POLLS_AVAILABLE";
  else if (counts.live) pollingStatus = "LIVE_POLLS_AVAILABLE";
  else if (counts.manual) pollingStatus = "MANUAL_POLLS_AVAILABLE";
  else if (counts.legacy) pollingStatus = "LEGACY_FALLBACK_ONLY";
  else if (parseFailure) pollingStatus = "PARSE_FAILURE";
  else if (sourceFailure) pollingStatus = "SOURCE_FAILURE";
  const usablePollCount = counts.live + counts.manual;
  return {
    livePollCount: counts.live,
    usableLivePollCount: usablePollCount,
    manualPollCount: counts.manual,
    legacyFallbackPollCount: counts.legacy,
    totalPollInputsUsed: rows.length,
    pollCount: usablePollCount,
    usablePollCount,
    pollingStatus,
    warning: pollingStatus === "LEGACY_FALLBACK_ONLY"
      ? "Legacy fallback poll inputs used; no live race polling available."
      : usablePollCount === 0
        ? "No usable live or manual race polling is available; the forecast relies on fundamentals and wider uncertainty."
        : null
  };
}

export function pollingStatusWarning(summary) {
  return summary?.warning ? {
    severity: "warning",
    type: summary.pollingStatus === "LEGACY_FALLBACK_ONLY" ? "legacy-fallback-only" : "no-usable-race-polls",
    message: summary.warning
  } : null;
}

export { POLLING_STATUSES };
