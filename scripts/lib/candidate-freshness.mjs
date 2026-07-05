function isPlaceholder(value) {
  return /^(democrat|democratic|republican|gop|democratic field|republican field)$/i.test(String(value || "").trim());
}

export function raceCandidateFreshness(race = {}) {
  const dem = race.demCandidate || race.dem || race.candidates?.find?.((candidate) => candidate.party === "D")?.name;
  const rep = race.repCandidate || race.rep || race.candidates?.find?.((candidate) => candidate.party === "R")?.name;
  const primaryPassed = Boolean(race.primaryPassed || race.primaryStatus === "COMPLETE" || race.matchupStatus === "PRIMARY_RESOLVED");
  const placeholderAfterPrimary = primaryPassed && (isPlaceholder(dem) || isPlaceholder(rep));
  const unresolvedAfterPrimary = primaryPassed && /UNRESOLVED/i.test(String(race.primaryStatus || race.matchupStatus || ""));
  return {
    raceId: race.id || race.state || race.district || null,
    state: race.state || null,
    status: placeholderAfterPrimary || unresolvedAfterPrimary ? "REVIEW" : "OK",
    primaryPassed,
    placeholderAfterPrimary,
    unresolvedAfterPrimary,
    demCandidate: dem || null,
    repCandidate: rep || null
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

