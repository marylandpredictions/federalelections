import { genericName } from "./candidate-roster.mjs";
export const ballotKey = (name) =>
  String(name || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
export function auditRosters(races, sources) {
  const issues = [],
    ids = new Set();
  const issue = (race, message) =>
    issues.push({ race: race.id || "Unknown race", message });
  let placeholders = 0;
  for (const race of races) {
    if (!race.id || ids.has(race.id))
      issue(race, "Missing or duplicate race ID");
    ids.add(race.id);
    if (
      race.rosterReviewed !== true ||
      race.rosterIncomplete !== false ||
      typeof race.rosterVerified !== "boolean" ||
      !race.candidateStatus
    )
      issue(race, "Roster needs source review");
    if (race.rosterVerified && !race.rosterSource)
      issue(race, "Official verification is missing its source URL");
    const rows = race.candidates || [],
      names = new Set(),
      candidateIds = new Set();
    if (!rows.length || rows.length > 100)
      issue(race, "Empty or implausible candidate count");
    for (const c of rows) {
      if (genericName(c.name) || c.placeholder) {
        placeholders++;
        issue(race, "Generic candidate placeholder");
      }
      if (
        typeof c.name !== "string" ||
        c.name.trim() !== c.name ||
        c.name.length > 160 ||
        /[<>\u0000-\u001f]/.test(c.name) ||
        !/[\p{L}]/u.test(c.name)
      )
        issue(race, "Malformed ballot name");
      if (!c.party && !c.partyCode)
        issue(race, "Missing candidate party metadata");
      if (!c.rosterSource) issue(race, "Missing candidate source metadata");
      if (c.id && candidateIds.has(String(c.id)))
        issue(race, "Duplicate candidate source ID");
      if (c.id) candidateIds.add(String(c.id));
      const keys = new Set(
        [c.name, ...(c.aliases || [])].map(ballotKey).filter(Boolean),
      );
      if ([...keys].some((k) => names.has(k)))
        issue(race, "Duplicate candidate name or alias");
      for (const k of keys) names.add(k);
    }
    if (sources) {
      const source = sources.get(race.id);
      if (!source) issue(race, "Missing reviewed source race");
      else if (!Array.isArray(source.candidates))
        issue(race, "Invalid reviewed source candidate array");
      else {
        const expected = new Set(
          source.candidates.map((c) => ballotKey(c.name)),
        );
        if (
          expected.size !== rows.length ||
          rows.some((c) => !expected.has(ballotKey(c.name)))
        )
          issue(
            race,
            "Candidate list differs from reviewed ballot, including possible missing major candidate",
          );
      }
    }
  }
  return {
    passed: issues.length === 0,
    total: races.length,
    reviewed: races.filter((r) => r.rosterReviewed && !r.rosterIncomplete)
      .length,
    official: races.filter((r) => r.rosterVerified).length,
    placeholders,
    needsReview: new Set(issues.map((i) => i.race)).size,
    issues,
  };
}
