// Candidate identities are independent of probabilities and result calls.
export const genericName = (v) =>
  !String(v || "").trim() ||
  /^(?:(?:democrat(?:ic)?|republican|gop|independent|other|unknown)(?:party)?(?:candidate|nominee)?|tbd|tba|candidate(?:pending)?)$/i.test(
    String(v).replace(/[\s\p{P}]+/gu, ""),
  ) || /\b(?:longshot|caucus not credited|runoff|to be (?:determined|announced)|placeholder|winner of (?:the )?primary)\b/i.test(String(v)) || /^(?:simulated|sample|test|generic) candidate\b|^(?:democratic|republican|independent) (?:candidate|nominee)$|^candidate [A-Z0-9]$/i.test(String(v).trim());
export function mergeRoster(race, { official, reviewed, metadata = [] } = {}) {
  const seen = new Set(),
    candidates = [];
  const existing = (race.candidates || []).filter(
    (c) => !genericName(c.name) && !c.placeholder,
  );
  const input = official?.candidates || reviewed?.candidates || [
    ...existing,
    ...metadata.filter(
      (c) =>
        !existing.some(
          (e) => (e.partyCode || e.party) === (c.partyCode || c.party),
        ),
    ),
  ];
  for (const raw of input) {
    if (genericName(raw.name) || raw.placeholder) continue;
    const name = raw.name.trim(),
      key = name.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      id: String(raw.id || name),
      name,
      party: raw.partyCode || raw.party || "O",
      ...(Array.isArray(raw.partyLabels)
        ? {
            partyLabels: raw.partyLabels
              .filter((p) => typeof p === "string")
              .slice(0, 8),
          }
        : {}),
      ...(Array.isArray(raw.aliases)
        ? {
            aliases: raw.aliases
              .filter((p) => typeof p === "string")
              .slice(0, 20),
          }
        : {}),
      incumbent: !!(raw.incumbent || raw.isIncumbent),
      ...(raw.writeIn ? { writeIn: true } : {}),
      ...(raw.ballotStatus ? { ballotStatus: String(raw.ballotStatus) } : {}),
      ...(raw.summaryVisible ? { summaryVisible: true } : {}),
      placeholder: false,
      votes: 0,
      percent: null,
      isWinner: false,
      winner: false,
      rosterSource:
        official?.sourceUrl || reviewed?.sourceUrl || raw.rosterSource || "Existing local metadata",
    });
  }
  return {
    ...race,
    candidates,
    candidateStatus: official
      ? `Official ballot roster: ${official.sourceName || "Louisiana Secretary of State"}.`
      : reviewed ? `General-election roster reviewed against ${reviewed.sourceName} on ${reviewed.checkedAt}; official certification is separate.` : "Local candidate roster; official ballot completeness not yet certified.",
    rosterVerified: !!official,
    rosterReviewed: !!(official || reviewed?.completeReview),
    rosterIncomplete: !(official || reviewed?.completeReview),
    ...(official
      ? {
          rosterSource: official.sourceUrl,
          electionFormat:
            race.state === "LA" && race.type === "house"
              ? "Open congressional primary"
              : "General election",
        }
      : {}),
  };
}
const clean = (s) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
export function parseLouisiana(html) {
  const races = [];
  for (const chunk of html.split('<span class="office-title">').slice(1)) {
    const office = clean(chunk.split("</span>")[0]),
      district = office.match(/Representative\s+(\d)/)?.[1],
      id = /Senator/.test(office)
        ? "senate-LA"
        : district
          ? "house-LA-" + district
          : null;
    if (!id) continue;
    const candidates = chunk
      .split('<div class="candidate-section">')
      .slice(1)
      .map((sec) => {
        const top = sec.split('<div class="row candidate-row">')[0],
          name = clean(
            top.match(
              /<div class="col-sm-5 col-xs-12">([\s\S]*?)<\/div>/,
            )?.[1] || "",
          ).replace(/^Name \/ Address \/ Phone /, ""),
          label = clean(
            top.match(
              /<div class="col-sm-4 text-right hidden-xs">([\s\S]*?)<\/div>/,
            )?.[1] || "",
          );
        if (
          !name ||
          !/^(Democrat|Republican|No Party|Independent|Libertarian|Green)$/.test(
            label,
          )
        )
          throw Error("Unrecognized Louisiana row");
        if (/Withdrawn|Disqualified|Deceased/i.test(sec)) return null;
        return {
          name,
          party: {
            Democrat: "D",
            Republican: "R",
            "No Party": "NP",
            Independent: "I",
            Libertarian: "L",
            Green: "G",
          }[label],
        };
      })
      .filter(Boolean);
    if (!candidates.length) throw Error("Empty official office");
    races.push({
      id,
      candidates,
      sourceUrl: "https://voterportal.sos.la.gov/CandidateInquiry",
    });
  }
  if (races.length !== 7 || new Set(races.map((r) => r.id)).size !== 7)
    throw Error("Louisiana needs all seven federal offices");
  return races;
}
