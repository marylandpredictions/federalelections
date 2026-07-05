import { candidateAliasDebug, candidateMatchesAlias } from "./candidate-aliases.mjs";

function candidateRows(row = {}) {
  if (Array.isArray(row.candidates)) return row.candidates;
  return [
    row.demCandidate ? { name: row.demCandidate, party: "D", pct: row.demPct } : null,
    row.repCandidate ? { name: row.repCandidate, party: "R", pct: row.repPct } : null
  ].filter(Boolean);
}

export function matchHousePollRowToDistrict(row = {}, district = {}) {
  const districtId = String(district.id || district.district || "").toUpperCase();
  const rowDistrict = String(row.district || row.raceId || "").toUpperCase();
  const districtMatched = !rowDistrict || rowDistrict.includes(districtId);
  const expected = [
    { name: district.demCandidate || district.dem || "Democrat", party: "D", aliases: district.demAliases || [] },
    { name: district.repCandidate || district.rep || "Republican", party: "R", aliases: district.repAliases || [] },
    ...(district.otherCandidates || [])
  ];
  const candidates = candidateRows(row);
  const unmatched = candidates.filter((candidate) => {
    const party = String(candidate.party || "").toUpperCase()[0];
    const sameParty = expected.filter((expectedCandidate) => !party || String(expectedCandidate.party || "").toUpperCase()[0] === party);
    return !sameParty.some((expectedCandidate) => candidateMatchesAlias(expectedCandidate, candidate.name || candidate.candidate || candidate.label));
  });
  return {
    matched: Boolean(districtMatched && candidates.length >= 2 && unmatched.length === 0),
    districtMatched,
    rowDistrict: row.district || row.raceId || null,
    district: districtId || null,
    unmatchedCandidates: unmatched.map((candidate) => candidate.name || candidate.candidate || candidate.label),
    aliasDebug: unmatched.map((candidate) => candidateAliasDebug(expected, candidate.name || candidate.candidate || candidate.label))
  };
}

