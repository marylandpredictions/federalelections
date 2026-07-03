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

const MANDATORY_REVIEW_STATES = {
  senate: new Set(["IA", "NE", "GA", "NC", "AK", "TX", "ID", "LA", "AL", "MS", "SC", "WY", "RI", "DE", "CO", "NJ", "MN", "OH", "ME"]),
  governor: new Set(["IA", "WI", "GA", "AZ", "NV", "OH", "FL", "PA", "NY", "MI", "VT", "WY", "AL", "TN", "SC", "CO", "KS", "AK"])
};

const CANDIDATE_EXCEPTION_MODES = {
  senate: {
    NE: { mode: "independent-overperformance", candidate: "Dan Osborn", review: "Independent caucus and ballot-line dynamics make a normal binary partisan baseline less reliable." },
    NC: { mode: "statewide-overperformance", candidate: "Roy Cooper", review: "Candidate has unusual statewide profile that can outperform generic partisanship." },
    OH: { mode: "incumbent-overperformance", candidate: "Sherrod Brown", review: "Incumbent profile should be treated separately from a generic open-seat Senate baseline." },
    AK: { mode: "coalition-dynamics", candidate: null, review: "Alaska coalition, independent, and ranked-choice style dynamics can break ordinary partisan assumptions." },
    TX: { mode: "nominee-sensitivity", candidate: null, review: "Texas outcome is sensitive to nominee assumptions and race-specific polling." },
    GA: { mode: "candidate-field-sensitivity", candidate: null, review: "Georgia is sensitive to candidate quality and runoff/turnout assumptions." },
    ME: { mode: "incumbent-specific-baseline", candidate: "Susan Collins", review: "Maine comparisons should use incumbent-specific context rather than the last Senate race alone." }
  },
  governor: {
    IA: { mode: "crossover-appeal", candidate: "Rob Sand", review: "Candidate has statewide crossover profile and polling should override generic fundamentals when available." },
    PA: { mode: "incumbent-overperformance", candidate: "Josh Shapiro", review: "Incumbency and state-specific approval should be explicit." },
    VT: { mode: "phil-scott-exception", candidate: "Phil Scott", review: "Phil Scott-like statewide exceptions should not be modeled as generic Republican strength." },
    NV: { mode: "incumbency-and-state-fit", candidate: "Joe Lombardo", review: "Incumbency and state fit are material inputs." },
    AZ: { mode: "swing-state-candidate-quality", candidate: null, review: "Candidate quality and statewide environment can move the race materially." },
    GA: { mode: "candidate-field-sensitivity", candidate: null, review: "Nominee assumptions and candidate quality matter." },
    WI: { mode: "high-elasticity-state", candidate: null, review: "High-elasticity state where small environment moves can change odds." },
    OH: { mode: "state-trend-and-nominee-sensitivity", candidate: null, review: "Candidate field and red-state trend need explicit checks." }
  }
};

function normalizedModelKey(model) {
  const key = String(model || "").toLowerCase();
  if (key.includes("senate")) return "senate";
  if (key.includes("governor") || key.includes("gubernatorial")) return "governor";
  if (key.includes("house")) return "house";
  if (key.includes("president")) return "president";
  return key;
}

export function raceReviewFlagsForRace(model, race) {
  const flags = [];
  const margin = Number(race.projectedMargin ?? race.margin);
  const probabilityMargin = Number(race.probabilityEngineMargin ?? race.probabilityMargin ?? race.margin);
  const winnerProbability = Number(race.winnerProbability ?? Math.max(Number(race.demProbability || 0), Number(race.repProbability || 0)));
  const usablePolls = Number(race.usablePollCount ?? race.pollingSummary?.usablePollCount ?? 0);
  const state = race.state;
  const rating = race.ratingsPrior?.consensusRating || race.rating || race.modelRating || null;
  const modelKey = normalizedModelKey(model);
  const pollingDiagnostic = pollingWeightDiagnostic(model, race);
  const exceptionDiagnostic = candidateExceptionDiagnostic(model, race);

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
  if (Number.isFinite(margin) && Number.isFinite(probabilityMargin) && Math.sign(margin) !== Math.sign(probabilityMargin) && Math.abs(margin) >= 0.25 && Math.abs(probabilityMargin) >= 0.25) {
    flags.push({
      severity: "high",
      type: "PROJECTED_MARGIN_PROBABILITY_CONFLICT",
      message: "Projected result margin and probability-engine margin point to different parties."
    });
  }
  if (/safe/i.test(String(rating || "")) && Number.isFinite(margin) && Math.abs(margin) < 14) {
    flags.push({
      severity: "warning",
      type: "SAFE_STATE_PROJECTED_MARGIN_COMPRESSED",
      message: "Safe-rated race has a projected margin under 14 points; verify polling and fundamentals before publishing."
    });
  }
  for (const warning of pollingDiagnostic.flags || []) {
    flags.push(warning);
  }
  if (String(race.pollingStatus || race.pollingSummary?.pollingStatus || "").includes("SOURCE_FAILURE")) {
    flags.push({
      severity: "warning",
      type: "POLLING_SOURCE_FAILURE",
      message: "A configured polling source failed or returned no usable rows."
    });
  }
  if (MANDATORY_REVIEW_STATES[modelKey]?.has(state) || ["IA", "NE", "ME", "AK", "TX", "OH", "MN"].includes(state)) {
    flags.push({
      severity: "info",
      type: "NAMED_RACE_REVIEW",
      message: `${state} is on the recurring manual review list because public expectations, candidate profiles, or independent dynamics can move faster than fundamentals.`
    });
  }
  if (exceptionDiagnostic.mode) {
    flags.push({
      severity: exceptionDiagnostic.applied ? "info" : "warning",
      type: exceptionDiagnostic.applied ? "CANDIDATE_EXCEPTION_MODE_ACTIVE" : "CANDIDATE_EXCEPTION_MODE_REVIEW",
      message: exceptionDiagnostic.review
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
  const margins = marginDiagnostic(race);
  const pollingDiagnostic = pollingWeightDiagnostic(model, race);
  const exceptionDiagnostic = candidateExceptionDiagnostic(model, race);
  return {
    id: race.id || race.raceId || race.state,
    state: race.state,
    race: race.displayName || race.name || `${race.state} ${model === "governor" ? "Governor" : "Senate"}`,
    projectedMargin: margin,
    probabilityEngineMargin: finite(race.probabilityEngineMargin ?? race.probabilityMargin),
    margins,
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
    pollingMergeStatus: race.pollingMergeStatus || null,
    pollingWeightDiagnostic: pollingDiagnostic,
    candidateException: exceptionDiagnostic,
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

function displaySignedMargin(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (Math.abs(number) < 0.05) return "Even";
  return `${number > 0 ? "D" : "R"}+${Math.abs(number).toFixed(1)}`;
}

function marginDiagnostic(race) {
  const projected = Number(race.projectedMargin ?? race.margin);
  const probability = Number(race.probabilityEngineMargin ?? race.probabilityMargin);
  const difference = Number.isFinite(projected) && Number.isFinite(probability) ? projected - probability : null;
  return {
    projectedResultMargin: {
      value: finite(projected),
      display: displaySignedMargin(projected),
      meaning: "Expected election result margin."
    },
    probabilityMargin: {
      value: finite(probability),
      display: displaySignedMargin(probability),
      meaning: "Uncertainty-adjusted margin used for win-probability conversion."
    },
    ratingMargin: {
      value: finite(race.ratingMargin ?? race.ratingsPrior?.impliedMargin),
      display: displaySignedMargin(race.ratingMargin ?? race.ratingsPrior?.impliedMargin),
      meaning: "External-rating implied margin, when a ratings prior exists."
    },
    difference: finite(difference),
    consistentDirection: !(Number.isFinite(projected) && Number.isFinite(probability))
      || Math.abs(projected) < 0.25
      || Math.abs(probability) < 0.25
      || Math.sign(projected) === Math.sign(probability)
  };
}

function pollingWeightDiagnostic(model, race) {
  const usablePolls = Number(race.usablePollCount ?? race.pollingSummary?.usablePollCount ?? 0);
  const pollMargin = Number(
    race.sourceInputs?.polling?.margin
    ?? race.sourceInputs?.directPolling?.margin
    ?? race.marginDecomposition?.pollingMargin
    ?? race.pollingSummary?.margin
  );
  const pollingAdjustment = Number(
    race.marginDecomposition?.pollingAdjustment
    ?? race.marginDecomposition?.pollingEffect
    ?? race.sourceInputs?.polling?.adjustment
    ?? race.sourceInputs?.directPolling?.adjustment
  );
  const pollingShare = Number(race.inputBalance?.shares?.polling ?? race.inputBalance?.polling);
  const flags = [];
  if (usablePolls >= 2 && (!Number.isFinite(pollingShare) || pollingShare < 0.08)) {
    flags.push({
      severity: "warning",
      type: "POLLING_WEIGHT_TOO_LOW",
      message: "Multiple usable polls are present but polling has little visible weight in input balance."
    });
  }
  if (usablePolls === 0 && Number.isFinite(pollingAdjustment) && Math.abs(pollingAdjustment) >= 0.5) {
    flags.push({
      severity: "warning",
      type: "POLLING_ADJUSTMENT_WITHOUT_USABLE_POLLS",
      message: "Polling adjustment is nonzero despite no usable polling rows."
    });
  }
  return {
    model,
    usablePollCount: Number.isFinite(usablePolls) ? usablePolls : 0,
    pollAverageMargin: Number.isFinite(pollMargin) ? finite(pollMargin) : null,
    pollingAdjustment: Number.isFinite(pollingAdjustment) ? finite(pollingAdjustment) : null,
    pollingInputShare: Number.isFinite(pollingShare) ? finite(pollingShare, 3) : null,
    pollingStatus: race.pollingStatus || race.pollingSummary?.pollingStatus || null,
    flags
  };
}

function candidateExceptionDiagnostic(model, race) {
  const key = normalizedModelKey(model);
  const configured = race.candidateException || null;
  const fallback = CANDIDATE_EXCEPTION_MODES[key]?.[race.state] || null;
  const exception = configured ? {
    mode: configured.mode || configured.type || fallback?.mode || "configured-exception",
    candidate: configured.candidate || fallback?.candidate || null,
    review: configured.review || configured.reason || fallback?.review || "Candidate-specific exception is configured for this race.",
    applied: Boolean(configured.confirmed || configured.applied || configured.enabled)
  } : fallback ? {
    ...fallback,
    applied: false
  } : {
    mode: null,
    candidate: null,
    review: null,
    applied: false
  };
  return exception;
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
