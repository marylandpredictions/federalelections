const POLLING_STATUSES = new Set([
  "LIVE_POLLS_AVAILABLE",
  "MANUAL_POLLS_AVAILABLE",
  "LIVE_AND_MANUAL_POLLS_AVAILABLE",
  "LEGACY_FALLBACK_ONLY",
  "QUARANTINED_ONLY",
  "NO_RACE_POLLS",
  "SOURCE_FAILURE",
  "PARSE_FAILURE"
]);

// VALIDATED is retained only for reading stale pre-migration caches; new
// validation emits USABLE or one of the explicit non-usable statuses.
const USABLE_VALIDATION_STATUSES = new Set(["VALIDATED", "USABLE"]);
const LEGACY_TRUST = new Set(["LEGACY_FALLBACK"]);
const QUARANTINE_STATUSES = new Set(["QUARANTINED", "STALE_CANDIDATES", "PRIMARY_ONLY", "UNMATCHED_RACE", "SUPERSEDED"]);

function kindForPoll(poll = {}) {
  const status = String(poll.validationStatus || "").toUpperCase();
  const trust = String(poll.sourceTrust || poll.validationTrust || "").toUpperCase();
  if (status === "LEGACY_FALLBACK") return "legacy";
  if (LEGACY_TRUST.has(trust) || poll.legacy || String(poll.source || "").toLowerCase().includes("legacy")) return "legacy";
  if (QUARANTINE_STATUSES.has(status) || trust === "QUARANTINED" || poll.usedInModel === false) return "quarantined";
  if (poll.legacy || String(poll.source || "").toLowerCase().includes("legacy")) return "legacy";
  if (poll.manual || String(poll.source || "").toLowerCase().includes("direct poll") || String(poll.source || "").toLowerCase().includes("manual")) return "manual";
  if (status && !USABLE_VALIDATION_STATUSES.has(status)) return "quarantined";
  return "live";
}

export function classifyPollingInputs(polls = [], sourceHealth = {}) {
  const rows = polls.filter((poll) => Number.isFinite(Number(poll?.margin)));
  const counts = {
    live: 0,
    manual: 0,
    legacy: 0,
    quarantined: 0,
    validated: 0,
    usable: 0,
    staleCandidates: 0,
    primaryOnly: 0,
    unmatchedRace: 0,
    legacyFallback: 0,
    superseded: 0
  };
  for (const poll of rows) counts[kindForPoll(poll)] += 1;
  for (const poll of rows) {
    const status = String(poll.validationStatus || "").toUpperCase();
    if (status === "VALIDATED") counts.validated += 1;
    if (status === "USABLE") counts.usable += 1;
    if (status === "STALE_CANDIDATES") counts.staleCandidates += 1;
    if (status === "PRIMARY_ONLY") counts.primaryOnly += 1;
    if (status === "UNMATCHED_RACE") counts.unmatchedRace += 1;
    if (status === "LEGACY_FALLBACK") counts.legacyFallback += 1;
    if (status === "SUPERSEDED") counts.superseded += 1;
  }
  const parseFailure = Object.values(sourceHealth).some((entry) => entry?.health === "PARSE_FAILED");
  const sourceFailure = Object.values(sourceHealth).some((entry) => ["BLOCKED_403", "NOT_FOUND_404", "HTML_ONLY", "UNKNOWN_ERROR"].includes(entry?.health));
  let pollingStatus = "NO_RACE_POLLS";
  if (counts.live && counts.manual) pollingStatus = "LIVE_AND_MANUAL_POLLS_AVAILABLE";
  else if (counts.live) pollingStatus = "LIVE_POLLS_AVAILABLE";
  else if (counts.manual) pollingStatus = "MANUAL_POLLS_AVAILABLE";
  else if (counts.legacy) pollingStatus = "LEGACY_FALLBACK_ONLY";
  else if (counts.quarantined) pollingStatus = "QUARANTINED_ONLY";
  else if (parseFailure) pollingStatus = "PARSE_FAILURE";
  else if (sourceFailure) pollingStatus = "SOURCE_FAILURE";
  const usablePollCount = counts.live + counts.manual;
  return {
    livePollCount: counts.live,
    usableLivePollCount: usablePollCount,
    manualPollCount: counts.manual,
    legacyFallbackPollCount: counts.legacy,
    quarantinedPollCount: counts.quarantined,
    validatedPollCount: counts.validated,
    usableStatusPollCount: counts.usable,
    staleCandidatePollCount: counts.staleCandidates,
    primaryOnlyPollCount: counts.primaryOnly,
    unmatchedRacePollCount: counts.unmatchedRace,
    legacyFallbackStatusPollCount: counts.legacyFallback,
    supersededPollCount: counts.superseded,
    totalPollInputsUsed: rows.length,
    pollCount: usablePollCount,
    usablePollCount,
    pollingStatus,
    warning: pollingStatus === "LEGACY_FALLBACK_ONLY"
      ? "Only legacy fallback poll inputs are available; they are reported separately and not treated as usable race polls."
      : pollingStatus === "QUARANTINED_ONLY"
        ? "Poll rows exist but are quarantined or stale, so the forecast relies on fundamentals and wider uncertainty."
      : usablePollCount === 0
        ? "No usable live or manual race polling is available; the forecast relies on fundamentals and wider uncertainty."
        : null
  };
}

export function pollingStatusWarning(summary) {
  return summary?.warning ? {
    severity: "warning",
    type: summary.pollingStatus === "LEGACY_FALLBACK_ONLY"
      ? "legacy-fallback-only"
      : summary.pollingStatus === "QUARANTINED_ONLY"
        ? "quarantined-polling-only"
        : "no-usable-race-polls",
    message: summary.warning
  } : null;
}

export { POLLING_STATUSES };
