const PARTY_ALIASES = {
  D: ["democrat", "democratic", "democratic nominee", "democrat nominee"],
  R: ["republican", "gop", "republican nominee", "gop nominee"],
  I: ["independent", "ind", "no party preference", "nonpartisan"]
};

export function normalizeCandidateName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[*†‡]/g, "")
    .replace(/\b(rep|sen|gov|lt|dr|mr|ms|mrs)\.?\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function candidateAliasSet(candidate = {}) {
  const aliases = new Set();
  const name = normalizeCandidateName(candidate.name || candidate.candidate || candidate.label);
  if (name) aliases.add(name);
  for (const alias of candidate.aliases || candidate.altNames || []) {
    const normalized = normalizeCandidateName(alias);
    if (normalized) aliases.add(normalized);
  }
  const party = String(candidate.party || candidate.partyCode || "").toUpperCase()[0];
  for (const alias of PARTY_ALIASES[party] || []) aliases.add(alias);
  const words = name.split(" ").filter(Boolean);
  if (words.length >= 2) aliases.add(words.at(-1));
  return aliases;
}

export function candidateMatchesAlias(candidate, rawName) {
  const normalized = normalizeCandidateName(rawName);
  if (!normalized) return false;
  return candidateAliasSet(candidate).has(normalized);
}

export function candidateAliasDebug(candidates = [], rawName) {
  const normalized = normalizeCandidateName(rawName);
  return {
    rawName: rawName || null,
    normalized,
    attemptedAliases: candidates.map((candidate) => ({
      candidate: candidate.name || candidate.candidate || candidate.label || null,
      party: candidate.party || candidate.partyCode || null,
      aliases: [...candidateAliasSet(candidate)]
    }))
  };
}

