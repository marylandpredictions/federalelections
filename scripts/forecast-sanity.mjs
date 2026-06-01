export function forecastSanityWarnings(items, options = {}) {
  const warnings = [];
  const {
    model = "forecast",
    id = (item) => item.id || item.state || item.name || "unknown",
    name = (item) => item.displayName || item.name || id(item),
    margin = (item) => item.margin ?? item.demMargin,
    demProbability = (item) => item.demProbability,
    rating = (item) => item.rating || item.modelRating || item.baselineRating,
    baseline = (item) => item.ratingMargin ?? item.baselineMargin ?? item.sourceInputs?.ratingBaseline ?? item.sourceInputs?.contextualBaseline,
    pollMargin = (item) => item.pollMargin ?? item.sourceInputs?.pollMargin,
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
    const raceMargin = Number(margin(item));
    const demProb = Number(demProbability(item));
    if (!Number.isFinite(raceMargin) || !Number.isFinite(demProb)) {
      add(item, "missing-margin-probability", "Race is missing a numeric projected margin or win probability.", "warn");
      continue;
    }
    const winnerProb = Math.max(demProb, 1 - demProb);
    const absMargin = Math.abs(raceMargin);
    const favoriteSide = raceMargin >= 0 ? "D" : "R";
    const probabilitySide = demProb >= .5 ? "D" : "R";
    const raceRating = String(rating(item) || "");
    const ratingSide = / D$/.test(raceRating) ? "D" : / R$/.test(raceRating) ? "R" : null;
    const base = Number(baseline(item));
    const poll = Number(pollMargin(item));
    const candidate = Number(candidateAdjustment(item));
    const partisan = Number(partisanship(item));

    if (favoriteSide !== probabilitySide) {
      add(item, "margin-probability-side-mismatch", "Projected margin and win probability favor different parties.", "warn");
    }
    if (winnerProb >= .9 && absMargin < 4.5) {
      add(item, "high-probability-small-margin", "Very high win probability is paired with a narrow projected margin.");
    }
    if (winnerProb <= .75 && absMargin >= 12) {
      add(item, "large-margin-low-confidence", "Large projected margin is paired with a relatively low win probability.");
    }
    if (ratingSide && ratingSide !== favoriteSide && absMargin >= 1) {
      add(item, "rating-margin-side-mismatch", "Public/manual rating direction and projected margin direction disagree.", "warn");
    }
    if (/^Safe/.test(raceRating) && absMargin < 10) {
      add(item, "safe-rating-too-competitive", "Safe-rated race has a projected margin below 10 points.");
    }
    if (/^Likely/.test(raceRating) && absMargin < 5) {
      add(item, "likely-rating-too-competitive", "Likely-rated race has a projected margin below 5 points.");
    }
    if (Number.isFinite(base) && Math.abs(raceMargin - base) < .08 && Math.abs(base) > 2) {
      add(item, "margin-copied-from-baseline", "Projected margin is nearly identical to the rating or baseline margin.");
    }
    if (Number.isFinite(poll) && Math.abs(poll - raceMargin) > 11 && absMargin < 18) {
      add(item, "poll-model-divergence", "Race polling and projected margin diverge by more than 11 points.");
    }
    if (Number.isFinite(candidate) && Number.isFinite(partisan) && Math.abs(candidate) > Math.max(2.25, Math.abs(partisan) * .55)) {
      add(item, "candidate-adjustment-large", "Candidate adjustment is large relative to state or district partisanship.");
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
