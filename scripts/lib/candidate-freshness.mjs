function isPlaceholder(value) {
  return /^(democrat|democratic|republican|gop|democratic field|republican field)$/i.test(String(value || "").trim());
}

export const NOMINATION_STATUSES = {
  VERIFIED_NOMINEE: "VERIFIED_NOMINEE",
  PROJECTED_NOMINEE: "PROJECTED_NOMINEE",
  PRESUMPTIVE_NOMINEE: "PRESUMPTIVE_NOMINEE",
  ADVANCED_TOP_TWO: "ADVANCED_TOP_TWO",
  RUNOFF_PENDING: "RUNOFF_PENDING",
  GENERIC_PLACEHOLDER: "GENERIC_PLACEHOLDER",
  PRIMARY_UNRESOLVED: "PRIMARY_UNRESOLVED",
  NO_RESULT_SOURCE: "NO_RESULT_SOURCE"
};

export function nominationStatusFor(statusText, candidateName = "") {
  const text = String(statusText || "").toLowerCase();
  const name = String(candidateName || "").trim();
  if (isPlaceholder(name)) return NOMINATION_STATUSES.GENERIC_PLACEHOLDER;
  if (/verified|certified|official nominee|\bnominee\b/.test(text)) return NOMINATION_STATUSES.VERIFIED_NOMINEE;
  if (/projected|called|winner/.test(text)) return NOMINATION_STATUSES.PROJECTED_NOMINEE;
  if (/presumptive|apparent/.test(text)) return NOMINATION_STATUSES.PRESUMPTIVE_NOMINEE;
  if (/advanced|advances|top.two|top-?two|general election/.test(text)) return NOMINATION_STATUSES.ADVANCED_TOP_TWO;
  if (/runoff|second round/.test(text)) return NOMINATION_STATUSES.RUNOFF_PENDING;
  if (/unresolved|pending|primary/.test(text)) return NOMINATION_STATUSES.PRIMARY_UNRESOLVED;
  return name ? NOMINATION_STATUSES.NO_RESULT_SOURCE : NOMINATION_STATUSES.GENERIC_PLACEHOLDER;
}

export function candidateEffectMultiplierForStatus(status) {
  if ([NOMINATION_STATUSES.VERIFIED_NOMINEE, NOMINATION_STATUSES.PROJECTED_NOMINEE, NOMINATION_STATUSES.PRESUMPTIVE_NOMINEE, NOMINATION_STATUSES.ADVANCED_TOP_TWO].includes(status)) return 1;
  if (status === NOMINATION_STATUSES.RUNOFF_PENDING) return 0.5;
  if (status === NOMINATION_STATUSES.GENERIC_PLACEHOLDER || status === NOMINATION_STATUSES.PRIMARY_UNRESOLVED || status === NOMINATION_STATUSES.NO_RESULT_SOURCE) return 0.35;
  return 0.5;
}

export function raceCandidateFreshness(race = {}) {
  const dem = race.demCandidate || race.dem || race.candidates?.find?.((candidate) => candidate.party === "D")?.name;
  const rep = race.repCandidate || race.rep || race.candidates?.find?.((candidate) => candidate.party === "R")?.name;
  const primaryPassed = Boolean(race.primaryPassed || race.primaryStatus === "COMPLETE" || race.matchupStatus === "PRIMARY_RESOLVED");
  const placeholderAfterPrimary = primaryPassed && (isPlaceholder(dem) || isPlaceholder(rep));
  const unresolvedAfterPrimary = primaryPassed && /UNRESOLVED/i.test(String(race.primaryStatus || race.matchupStatus || ""));
  const demNominationStatus = nominationStatusFor(`${race.primaryStatus || ""} ${race.demStatus || ""}`, dem);
  const repNominationStatus = nominationStatusFor(`${race.primaryStatus || ""} ${race.repStatus || ""}`, rep);
  return {
    raceId: race.id || race.state || race.district || null,
    state: race.state || null,
    status: placeholderAfterPrimary || unresolvedAfterPrimary ? "REVIEW" : "OK",
    primaryPassed,
    placeholderAfterPrimary,
    unresolvedAfterPrimary,
    demCandidate: dem || null,
    repCandidate: rep || null,
    demNominationStatus,
    repNominationStatus,
    demCandidateEffectMultiplier: candidateEffectMultiplierForStatus(demNominationStatus),
    repCandidateEffectMultiplier: candidateEffectMultiplierForStatus(repNominationStatus)
  };
}

export function candidateFreshnessSummary(races = []) {
  const rows = races.map(raceCandidateFreshness);
  return {
    totalRaces: rows.length,
    reviewRequired: rows.filter((row) => row.status === "REVIEW").length,
    placeholderAfterPrimary: rows.filter((row) => row.placeholderAfterPrimary).length,
    unresolvedAfterPrimary: rows.filter((row) => row.unresolvedAfterPrimary).length,
    rows
  };
}

