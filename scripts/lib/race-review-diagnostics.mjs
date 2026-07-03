export function buildRaceReview({ model, races, generatedAt = new Date().toISOString() }) {
  const items = (races || []).map((race) => buildRaceReviewItem(model, race));
  return {
    generatedAt,
    model,
    schemaVersion: "2026.race-review.1",
    summary: {
      races: items.length,
      reviewRequired: items.filter((race) => race.reviewRequired).length,
      highSeverity: items.filter((race) => race.reviewFlags.some((flag) => flag.severity === "high")).length,
      noUsablePolling: items.filter((race) => race.reviewFlags.some((flag) => flag.type === "NO_USABLE_POLLING")).length
    },
    races: items
  };
}

export function raceReviewFlagsForRace(model, race) {
  const flags = [];
  const margin = Number(race.projectedMargin ?? race.margin);
  const probabilityMargin = Number(race.probabilityEngineMargin ?? race.probabilityMargin ?? race.margin);
  const winnerProbability = Number(race.winnerProbability ?? Math.max(Number(race.demProbability || 0), Number(race.repProbability || 0)));
  const usablePolls = Number(race.usablePollCount ?? race.pollingSummary?.usablePollCount ?? 0);
  const state = race.state;
  const rating = race.ratingsPrior?.consensusRating || race.rating || race.modelRating || null;

  if (!usablePolls) {
    flags.push({
      severity: "warning",
      type: "NO_USABLE_POLLING",
      message: "Race has no usable live/manual polling; fundamentals, priors, and uncertainty carry the forecast."
    });
  }
  if (Number.isFinite(margin) && Number.isFinite(winnerProbability) && winnerProbability >= 0.85 && Math.abs(margin) < 4) {
    flags.push({
      severity: "warning",
      type: "HIGH_PROBABILITY_SMALL_MARGIN",
      message: "Win probability is high relative to projected margin; check error assumptions and probability conversion."
    });
  }
  if (Number.isFinite(margin) && Number.isFinite(winnerProbability) && Math.abs(margin) >= 12 && winnerProbability < 0.8) {
    flags.push({
      severity: "warning",
      type: "LARGE_MARGIN_LOW_PROBABILITY",
      message: "Projected margin is large relative to win probability; check uncertainty calibration."
    });
  }
  if (race.historicalComparison?.needsReview || race.largeShiftWarning) {
    flags.push({
      severity: "warning",
      type: "HISTORICAL_SHIFT_REVIEW",
      message: "Projected margin diverges materially from historical baseline without enough direct race signal."
    });
  }
  if (race.ratingsPrior?.warnings?.some((warning) => String(warning.type || "").includes("DIVERGENCE"))) {
    flags.push({
      severity: "high",
      type: "RATING_PRIOR_DIVERGENCE",
      message: "External rating prior and raw model margin diverged enough to require review."
    });
  }
  if (Number.isFinite(margin) && Number.isFinite(probabilityMargin) && Math.abs(margin - probabilityMargin) >= 6) {
    flags.push({
      severity: "warning",
      type: "MARGIN_PROBABILITY_ENGINE_DIVERGENCE",
      message: "Displayed projected margin and probability-engine margin differ materially."
    });
  }
  if (String(race.pollingStatus || race.pollingSummary?.pollingStatus || "").includes("SOURCE_FAILURE")) {
    flags.push({
      severity: "warning",
      type: "POLLING_SOURCE_FAILURE",
      message: "A configured polling source failed or returned no usable rows."
    });
  }
  if (["IA", "NE", "ME", "AK", "TX", "OH", "MN"].includes(state)) {
    flags.push({
      severity: "info",
      type: "NAMED_RACE_REVIEW",
      message: `${state} is on the recurring manual review list because public expectations, candidate profiles, or independent dynamics can move faster than fundamentals.`
    });
  }
  if (race.independent && String(race.independent).toLowerCase() !== "none") {
    flags.push({
      severity: "info",
      type: "INDEPENDENT_OR_THIRD_PARTY_DYNAMIC",
      message: "Race includes a meaningful non-major-party candidate or caucus dynamic; binary margin interpretation needs review."
    });
  }
  if (["pending", "unresolved", "unknown"].includes(String(race.primary || race.primaryStatus || "").toLowerCase())) {
    flags.push({
      severity: "warning",
      type: "PRIMARY_STATUS_PENDING",
      message: "Nominee field is not fully resolved; candidate-quality and primary effects remain provisional."
    });
  }
  if (rating && Number.isFinite(margin) && ratingPartyMismatch(rating, margin)) {
    flags.push({
      severity: "high",
      type: "RATING_DIRECTION_MISMATCH",
      message: "Projected margin points to the opposite party from the current rating prior."
    });
  }
  return flags;
}

function buildRaceReviewItem(model, race) {
  const margin = finite(race.projectedMargin ?? race.margin);
  const flags = raceReviewFlagsForRace(model, race);
  return {
    id: race.id || race.raceId || race.state,
    state: race.state,
    race: race.displayName || race.name || `${race.state} ${model === "governor" ? "Governor" : "Senate"}`,
    projectedMargin: margin,
    probabilityEngineMargin: finite(race.probabilityEngineMargin ?? race.probabilityMargin),
    demProbability: finite(race.demProbability),
    repProbability: finite(race.repProbability),
    winnerParty: race.winnerParty || null,
    rating: race.rating || race.modelRating || race.ratingsPrior?.consensusRating || null,
    ratingPrior: race.ratingsPrior ? {
      enabled: Boolean(race.ratingsPrior.enabled),
      consensusRating: race.ratingsPrior.consensusRating || null,
      impliedMargin: finite(race.ratingsPrior.impliedMargin),
      weight: finite(race.ratingsPrior.weight),
      sources: race.ratingsPrior.sources || []
    } : null,
    polling: {
      usablePollCount: Number(race.usablePollCount ?? race.pollingSummary?.usablePollCount ?? 0),
      livePollCount: Number(race.livePollCount ?? race.pollingSummary?.livePollCount ?? 0),
      manualPollCount: Number(race.manualPollCount ?? race.pollingSummary?.manualPollCount ?? 0),
      status: race.pollingStatus || race.pollingSummary?.pollingStatus || null
    },
    candidates: {
      dem: race.dem || race.demCandidate || null,
      rep: race.rep || race.repCandidate || null,
      demStatus: race.demStatus || null,
      repStatus: race.repStatus || null,
      independent: race.independent || null
    },
    primary: {
      status: race.primary || race.primaryStatus || null,
      date: race.primaryDate || null,
      summary: race.primarySummary || null
    },
    historicalComparison: race.historicalComparison || null,
    sourceHealth: race.sourceHealth || null,
    reviewRequired: flags.some((flag) => flag.severity !== "info"),
    reviewFlags: flags
  };
}

function ratingPartyMismatch(rating, margin) {
  const text = String(rating || "").toLowerCase();
  if (Math.abs(Number(margin)) < 0.5 || text.includes("toss")) return false;
  if (Number(margin) > 0) return /\br\b|rep|republican/.test(text) && !/\bd\b|dem/.test(text);
  return /\bd\b|dem/.test(text) && !/\br\b|rep|republican/.test(text);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(4)) : null;
}
