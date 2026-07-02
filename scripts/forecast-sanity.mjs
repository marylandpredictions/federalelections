export function forecastSanityWarnings(items, options = {}) {
  const warnings = [];
  const {
    model = "forecast",
    id = (item) => item.id || item.state || item.name || "unknown",
    name = (item) => item.displayName || item.name || id(item),
    margin = (item) => item.margin ?? item.demMargin,
    demProbability = (item) => item.demProbability,
    rating = (item) => item.modelRating || item.rating || item.baselineRating,
    baseline = (item) => item.structuralMargin ?? item.baselineMargin ?? item.sourceInputs?.districtBaseline ?? item.sourceInputs?.contextualBaseline,
    pollMargin = (item) => item.pollMargin ?? item.sourceInputs?.pollMargin,
    pollCount = (item) => item.pollCount ?? item.sourceInputs?.pollCount,
    candidateAdjustment = (item) => item.candidateAndLocal ?? item.candidateQualityAdjustment ?? item.sourceInputs?.candidateQualityAdjustment,
    partisanship = (item) => item.pvi ?? item.presidentialMargin ?? item.sourceInputs?.presidentialBaseline,
    limit = 100
  } = options;

  const add = (item, code, message, severity = "review") => {
    warnings.push({
      model,
      code,
      severity,
      id: String(id(item)),
      name: String(name(item)),
      message,
      margin: round(margin(item)),
      demProbability: round(demProbability(item), 4),
      rating: rating(item) || null
    });
  };

  for (const item of items || []) {
    const raceMargin = Number(item.projectedResultMargin?.value ?? item.projectedMargin ?? margin(item));
    const probabilityMargin = Number(item.probabilityMargin?.value ?? item.probabilityEngineMargin ?? margin(item));
    const demProb = Number(demProbability(item));
    if (!Number.isFinite(raceMargin) || !Number.isFinite(demProb)) {
      add(item, "missing-margin-probability", "Race is missing a numeric projected margin or win probability.", "warn");
      continue;
    }
    if (item.error !== undefined && item.error !== null && !Number.isFinite(Number(item.error))) {
      add(item, "invalid-race-error", "Race uncertainty is not numeric; generation must not use this race until the error input is repaired.", "warn");
    }
    const winnerProb = Math.max(demProb, 1 - demProb);
    const absMargin = Math.abs(raceMargin);
    const favoriteSide = raceMargin >= 0 ? "D" : "R";
    const probabilitySide = demProb >= .5 ? "D" : "R";
    const base = Number(baseline(item));
    const poll = Number(pollMargin(item));
    const polls = Number(pollCount(item));
    const candidate = Number(candidateAdjustment(item));
    const partisan = Number(partisanship(item));

    if (favoriteSide !== probabilitySide) {
      add(item, "margin-probability-side-mismatch", "Projected margin and win probability favor different parties.", "warn");
    }
    if (Number.isFinite(probabilityMargin) && Math.sign(probabilityMargin) !== Math.sign(raceMargin) && Math.abs(raceMargin) >= 1 && Math.abs(probabilityMargin) >= 1) {
      add(item, "PROBABILITY_MARGIN_DIVERGENCE", "Projected result margin and probability-engine margin point in different directions.", "warn");
    }
    if (winnerProb >= .9 && absMargin < 4.5) {
      add(item, "high-probability-small-margin", "Very high win probability is paired with a narrow projected margin.");
    }
    if (winnerProb <= .75 && absMargin >= 12) {
      add(item, "large-margin-low-confidence", "Large projected margin is paired with a relatively low win probability.");
    }
    if (Number.isFinite(base) && Math.abs(raceMargin - base) < .08 && Math.abs(base) > 2) {
      add(item, "margin-copied-from-baseline", "Projected margin is nearly identical to the structural baseline.");
    }
    if (Number.isFinite(poll) && Number.isFinite(polls) && polls > 0 && Math.abs(poll - raceMargin) > 11 && absMargin < 18) {
      add(item, "poll-model-divergence", "Race polling and projected margin diverge by more than 11 points.");
    }
    if (Number.isFinite(candidate) && Number.isFinite(partisan) && Math.abs(candidate) > Math.max(2.25, Math.abs(partisan) * .55)) {
      add(item, "candidate-adjustment-large", "Candidate adjustment is large relative to state or district partisanship.");
    }
    if (!Number.isFinite(base)) {
      add(item, "MISSING_BASELINE", "Race is missing a usable state or district baseline.", "warn");
    }
    if (!Number.isFinite(polls) || polls <= 0) {
      add(item, "POLLING_UNAVAILABLE", "No usable race-level polling is available; forecast is fundamentals-led.", "review");
    }
    if (item.previousResult && item.previousResult.comparable === false) {
      add(item, "UNCONTESTED_PRIOR_RESULT", "Prior same-office result was marked non-comparable or uncontested.", "review");
    }
    if (item.redistrictingConfidence === "CONFLICTING_SOURCES" || item.ratingIsConditional || item.redistrictingWarnings?.length) {
      add(item, "MAP_CONFLICT", "Map or redistricting assumption requires review.", "warn");
    }
    if (item.candidateException?.applied || (Number.isFinite(candidate) && Math.abs(candidate) >= 2.5)) {
      add(item, "CANDIDATE_EXCEPTION_DRIVES_MARGIN", "Candidate-specific adjustment materially affects the projected margin.", "review");
    }
    if (Number.isFinite(base) && Math.abs(base) >= 25 && absMargin < 12 && (!Number.isFinite(polls) || polls <= 0)) {
      add(item, "SAFE_RACE_OVERCOMPRESSED", "Safe structural baseline is paired with a compressed public projected margin.", "warn");
    }
    if (item.historicalComparison?.needsReview || item.largeShiftWarning?.triggered) {
      add(item, "LARGE_SHIFT_WITHOUT_POLLING", "Projected margin has a large historical shift without a strong race-polling signal.", "warn");
    }
    if (item.benchmarkComparison?.warnings?.length || item.benchmarkComparison?.benchmarkWarnings?.length) {
      add(item, "BENCHMARK_DIVERGENCE", "Projection differs from configured external benchmark checks.", "review");
    }
    if (item.inputBalance?.dominantInput === "ratings" || (item.inputBalance?.shares?.ratings || 0) >= .35) {
      add(item, "RATINGS_HEAVY", "Configured external ratings account for too much of the modeled input balance.", "warn");
    }
  }

  return warnings
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || Math.abs(b.margin || 0) - Math.abs(a.margin || 0))
    .slice(0, limit);
}

function round(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function severityRank(value) {
  return value === "warn" ? 2 : 1;
}
