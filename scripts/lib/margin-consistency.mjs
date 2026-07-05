export function partyFromMargin(value, deadzone = 0.05) {
  const margin = Number(value);
  if (!Number.isFinite(margin) || Math.abs(margin) <= deadzone) return "TOSSUP";
  return margin > 0 ? "D" : "R";
}

export function marginConsistencyCheck({
  projectedResultMargin,
  projectedMargin,
  probabilityEngineMargin,
  probabilityMargin,
  demProbability,
  repProbability,
  materialThreshold = 0.5
} = {}) {
  const projected = Number(projectedResultMargin ?? projectedMargin);
  const probability = Number(probabilityEngineMargin ?? probabilityMargin);
  const flags = [];
  if (!Number.isFinite(projected)) flags.push("PROJECTED_RESULT_MARGIN_MISSING");
  if (!Number.isFinite(probability)) flags.push("PROBABILITY_ENGINE_MARGIN_MISSING");
  if (Number.isFinite(projected) && Number.isFinite(probability)) {
    const projectedParty = partyFromMargin(projected, materialThreshold);
    const probabilityParty = partyFromMargin(probability, materialThreshold);
    if (projectedParty !== "TOSSUP" && probabilityParty !== "TOSSUP" && projectedParty !== probabilityParty) {
      flags.push("PROJECTED_MARGIN_PROBABILITY_CONFLICT");
    }
  }
  const dem = Number(demProbability);
  const rep = Number(repProbability);
  if (Number.isFinite(dem) && Number.isFinite(rep) && Number.isFinite(probability)) {
    const probabilityParty = partyFromMargin(probability, materialThreshold);
    const winParty = dem >= rep ? "D" : "R";
    if (probabilityParty !== "TOSSUP" && probabilityParty !== winParty) {
      flags.push("PROBABILITY_MARGIN_WIN_PROBABILITY_CONFLICT");
    }
  }
  return {
    projectedResultMargin: Number.isFinite(projected) ? Number(projected.toFixed(2)) : null,
    probabilityEngineMargin: Number.isFinite(probability) ? Number(probability.toFixed(2)) : null,
    consistent: flags.length === 0,
    flags,
    message: flags.length
      ? "Projected-result margin and probability-engine margin need review before healthy publication."
      : "Projected-result and probability-engine margins are directionally consistent."
  };
}
