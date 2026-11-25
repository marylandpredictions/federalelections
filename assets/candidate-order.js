(function (root) {
  function partyCode(candidate) {
    const text = String(candidate?.partyCode || candidate?.party || "").trim().toLowerCase();
    if (text.includes("democrat") || text === "dem" || text === "d") return "D";
    if (text.includes("republican") || text === "gop" || text === "rep" || text === "r") return "R";
    if (text.includes("independent") || text === "ind" || text === "i") return "I";
    return String(candidate?.partyCode || candidate?.party || "").trim().toUpperCase() || "O";
  }

  function nameKey(candidate) {
    return String(candidate?.name || "").trim();
  }

  function votesOf(candidate) {
    return Number(candidate?.votes) || 0;
  }

  function percentOf(candidate) {
    return Number(candidate?.percent) || 0;
  }

  function hasReportedVotes(candidates) {
    return (candidates || []).some((candidate) => votesOf(candidate) > 0 || percentOf(candidate) > 0);
  }

  function isMajorParty(candidate) {
    const party = partyCode(candidate);
    return party === "D" || party === "R";
  }

  // Votes in → vote order. No votes → Dem/GOP locked in the top slots
  // (alphabetical among those two), then everyone else alphabetical.
  function compareCandidates(a, b, options = {}) {
    const live = options.live ?? hasReportedVotes([a, b]);
    if (live) {
      return (
        votesOf(b) - votesOf(a)
        || percentOf(b) - percentOf(a)
        || nameKey(a).localeCompare(nameKey(b), undefined, { sensitivity: "base" })
      );
    }
    const aMajor = isMajorParty(a);
    const bMajor = isMajorParty(b);
    if (aMajor !== bMajor) return aMajor ? -1 : 1;
    return nameKey(a).localeCompare(nameKey(b), undefined, { sensitivity: "base" });
  }

  function orderCandidates(candidates, options = {}) {
    const rows = [...(candidates || [])];
    const live = options.live ?? hasReportedVotes(rows);
    return rows.sort((a, b) => compareCandidates(a, b, { live }));
  }

  const api = {
    partyCode,
    hasReportedVotes,
    compareCandidates,
    orderCandidates,
  };
  root.FEACandidateOrder = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
