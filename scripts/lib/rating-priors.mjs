import { readFileSync } from "node:fs";

const CONFIG_URL = new URL("../../data/model-config/rating-weights-2026.json", import.meta.url);

const SOURCE_LABELS = {
  cook: "Cook",
  insideElections: "Inside Elections",
  sabato: "Sabato",
  splitTicket: "Split Ticket",
  raceToWH: "Race to the WH",
  voteHub: "VoteHub",
  economist: "Economist",
  market: "Market",
  consensusRating: "Consensus"
};

const RATING_IMPLIED_MARGINS = {
  "Safe D": 24,
  "Likely D": 11,
  "Lean D": 5.5,
  "Tilt D": 2,
  "Toss-up": 0,
  "Tilt R": -2,
  "Lean R": -5.5,
  "Likely R": -11,
  "Safe R": -24
};

const FALLBACK_CONFIG = {
  offices: {
    house: {
      noPollingWeakFundamentals: 0.45,
      noPollingDerivedFundamentals: 0.5,
      noPollingStrongFundamentals: 0.3,
      pollInformed: 0.15,
      wellPolled: 0.08,
      inferredSafeRating: 0.15,
      mapConflict: 0,
      probabilityPullStrength: 1,
      projectedResultPullStrength: 0.65
    },
    senate: {
      noPollingWeakFundamentals: [0.2, 0.35],
      noPollingDecentBaseline: [0.1, 0.2],
      somePolling: [0.05, 0.15],
      multiplePolls: [0.03, 0.1],
      probabilityPullStrength: 0.82,
      projectedResultPullStrength: 0.52
    },
    governor: {
      noPollingWeakFundamentals: [0.2, 0.35],
      noPollingDecentBaseline: [0.1, 0.2],
      somePolling: [0.05, 0.15],
      multiplePolls: [0.03, 0.1],
      probabilityPullStrength: 0.8,
      projectedResultPullStrength: 0.5
    }
  },
  overrides: {}
};

export function loadRatingWeightConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_URL, "utf8"));
    return {
      ...FALLBACK_CONFIG,
      ...parsed,
      offices: { ...FALLBACK_CONFIG.offices, ...(parsed.offices || {}) },
      overrides: { ...FALLBACK_CONFIG.overrides, ...(parsed.overrides || {}) }
    };
  } catch {
    return FALLBACK_CONFIG;
  }
}

export function normalizeRating(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const text = raw
    .toLowerCase()
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/toss\s*-?\s*up|tossup|even/.test(text)) {
    return { normalized: "Toss-up", party: null, rank: 0, impliedMargin: 0 };
  }
  const party = /\b(d|dem|democrat|democratic|blue)\b/.test(text)
    ? "D"
    : /\b(r|rep|republican|gop|red)\b/.test(text)
      ? "R"
      : null;
  if (!party) return null;
  let category = null;
  let rank = 0;
  if (/\b(safe|solid)\b/.test(text)) {
    category = "Safe";
    rank = 4;
  } else if (/\blikely\b/.test(text)) {
    category = "Likely";
    rank = 3;
  } else if (/\bleans?\b/.test(text)) {
    category = "Lean";
    rank = 2;
  } else if (/\btilt(s|ed)?\b/.test(text)) {
    category = "Tilt";
    rank = 1;
  }
  if (!category) return null;
  const normalized = `${category} ${party}`;
  return { normalized, party, rank, impliedMargin: RATING_IMPLIED_MARGINS[normalized] };
}

export function ratingToMargin(value) {
  return normalizeRating(value)?.impliedMargin ?? null;
}

export function ratingConsensusFromBenchmark(benchmark, fallbackRating = null, fallbackSource = "Race configuration") {
  const ratings = [];
  const add = (label, rating) => {
    const parsed = normalizeRating(rating);
    if (!parsed) return;
    ratings.push({ source: label, rating: parsed.normalized, impliedMargin: parsed.impliedMargin, rank: parsed.rank, party: parsed.party });
  };

  if (benchmark && typeof benchmark === "object") {
    if (benchmark.consensusRating) add(SOURCE_LABELS.consensusRating, benchmark.consensusRating);
    for (const [key, value] of Object.entries(benchmark)) {
      if (!value || typeof value !== "object") continue;
      add(SOURCE_LABELS[key] || key, value.rating);
    }
  }
  if (!ratings.length && fallbackRating) add(fallbackSource, fallbackRating);
  if (!ratings.length) return null;

  const average = ratings.reduce((sum, item) => sum + item.impliedMargin, 0) / ratings.length;
  const nearest = Object.entries(RATING_IMPLIED_MARGINS)
    .sort((a, b) => Math.abs(a[1] - average) - Math.abs(b[1] - average))[0][0];
  return {
    consensusRating: nearest,
    impliedMargin: Number(average.toFixed(2)),
    sources: [...new Set(ratings.map((item) => item.source))],
    sourceRatings: ratings
  };
}

export function pollingCount(pollingSummary) {
  const direct = Number(
    pollingSummary?.usablePollCount ??
    pollingSummary?.pollCount ??
    pollingSummary?.polls ??
    pollingSummary?.usablePolls ??
    pollingSummary?.sourceCount
  );
  return Number.isFinite(direct) ? direct : 0;
}

function rangeMidpoint(range, fallback) {
  if (Number.isFinite(Number(range))) return Number(range);
  if (!Array.isArray(range) || range.length < 2) return fallback;
  const min = Number(range[0]);
  const max = Number(range[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
  return (min + max) / 2;
}

function dynamicWeight({ office, pollingSummary, fundamentalsQuality, sourceDegraded, ratingSourceType, mapConflict, config }) {
  const officeConfig = config.offices?.[office] || config.offices?.house || {};
  const polls = pollingCount(pollingSummary);
  const normalizedFundamentals = String(fundamentalsQuality || "").toUpperCase();
  const derivedFundamentals = normalizedFundamentals === "DERIVED_FROM_PRIOR_FORECAST";
  const weakFundamentals = sourceDegraded || ["WEAK", "LOW", "DEGRADED", "MISSING", "DERIVED_FROM_PRIOR_FORECAST"].includes(normalizedFundamentals);
  if (mapConflict || ratingSourceType === "MAP_CONFLICT_RATING_DISABLED") {
    return { weight: rangeMidpoint(officeConfig.mapConflict, 0), reasonKey: "map-conflict", polls, weakFundamentals, derivedFundamentals };
  }
  if (ratingSourceType === "INFERRED_SAFE_RATING") {
    return { weight: rangeMidpoint(officeConfig.inferredSafeRating, office === "house" ? 0.15 : 0.08), reasonKey: "inferred-safe-rating", polls, weakFundamentals, derivedFundamentals };
  }
  if (polls >= 3) {
    return { weight: rangeMidpoint(officeConfig.wellPolled ?? officeConfig.multiplePolls, office === "house" ? 0.08 : 0.065), reasonKey: "multiple-polls", polls, weakFundamentals, derivedFundamentals };
  }
  if (polls > 0) {
    return { weight: rangeMidpoint(officeConfig.pollInformed ?? officeConfig.somePolling, office === "house" ? 0.15 : 0.1), reasonKey: "some-polling", polls, weakFundamentals, derivedFundamentals };
  }
  if (derivedFundamentals) {
    return { weight: rangeMidpoint(officeConfig.noPollingDerivedFundamentals ?? officeConfig.noPollingWeakFundamentals, office === "house" ? 0.5 : 0.275), reasonKey: "no-polling-derived-fundamentals", polls, weakFundamentals, derivedFundamentals };
  }
  if (weakFundamentals) {
    return { weight: rangeMidpoint(officeConfig.noPollingWeakFundamentals, office === "house" ? 0.45 : 0.275), reasonKey: "no-polling-weak-fundamentals", polls, weakFundamentals, derivedFundamentals };
  }
  return { weight: rangeMidpoint(officeConfig.noPollingStrongFundamentals ?? officeConfig.noPollingDecentBaseline, office === "house" ? 0.3 : 0.15), reasonKey: "no-polling-strong-fundamentals", polls, weakFundamentals, derivedFundamentals };
}

function ratingReason({ office, reasonKey, polls, weakFundamentals }) {
  if (reasonKey === "multiple-polls") return `${office} race has multiple usable polls, so expert ratings are retained as a light stabilizer.`;
  if (reasonKey === "some-polling") return `${office} race has some usable polling, so expert ratings receive a reduced soft-prior weight.`;
  if (reasonKey === "inferred-safe-rating") return `${office} race is absent from competitive public ratings tables and has a strong source-backed baseline, so an inferred safe rating is used as a light stabilizer.`;
  if (reasonKey === "map-conflict") return `${office} race has conflicting map assumptions, so rating priors are disabled unless a scenario explicitly matches the map.`;
  if (reasonKey === "no-polling-derived-fundamentals") return `${office} race has no usable race polling and derived or circular fundamentals, so expert ratings materially constrain the model.`;
  if (reasonKey === "no-polling-weak-fundamentals") return `${office} race has no usable race polling and weak or derived fundamentals, so expert ratings materially constrain the model.`;
  if (reasonKey === "no-polling-strong-fundamentals") return `${office} race has no usable race polling but usable structural baselines, so expert ratings provide a moderate soft prior.`;
  if (reasonKey === "no-polling-decent-baseline") return `${office} race has no usable race polling but usable structural baselines, so expert ratings provide a moderate soft prior.`;
  return `${office} race rating prior selected from ${polls} usable polls and ${weakFundamentals ? "weak" : "usable"} fundamentals.`;
}

export function buildRatingPrior({
  office,
  raceId,
  benchmark,
  fallbackRating = null,
  fallbackSource = "Race configuration",
  rawModelMargin,
  pollingSummary = null,
  fundamentalsQuality = "MEDIUM",
  sourceDegraded = false,
  mapConflict = false,
  scenarioMatched = false,
  ratingSourceType = benchmark?.cacheMeta?.ratingSourceType || null,
  config = loadRatingWeightConfig()
}) {
  const consensus = ratingConsensusFromBenchmark(benchmark, fallbackRating, fallbackSource);
  const officeConfig = config.offices?.[office] || {};
  const override = config.overrides?.[raceId] || {};
  if (!consensus) {
    return {
      enabled: false,
      weight: 0,
      reason: "No usable public expert rating was configured for this race.",
      consensusRating: null,
      impliedMargin: null,
      sources: [],
      usedAs: "NOT_USED",
      ratingSourceType: ratingSourceType || "RATING_UNAVAILABLE",
      guardrailEligible: false,
      ratingPull: 0,
      probabilityPullStrength: officeConfig.probabilityPullStrength ?? 1,
      projectedResultPullStrength: officeConfig.projectedResultPullStrength ?? 0.6,
      inputWeight: 0,
      warnings: []
    };
  }

  if (mapConflict && !scenarioMatched) {
    return {
      enabled: false,
      weight: 0,
      reason: override.reason || "Map conflict: expert ratings are kept for comparison only unless the scenario explicitly matches the rated map.",
      consensusRating: consensus.consensusRating,
      impliedMargin: consensus.impliedMargin,
      sources: consensus.sources,
      sourceRatings: consensus.sourceRatings,
      usedAs: "COMPARISON_ONLY_MAP_CONFLICT",
      ratingSourceType: "MAP_CONFLICT_RATING_DISABLED",
      guardrailEligible: false,
      ratingPull: 0,
      probabilityPullStrength: officeConfig.probabilityPullStrength ?? 1,
      projectedResultPullStrength: officeConfig.projectedResultPullStrength ?? 0.6,
      inputWeight: 0,
      warnings: [{
        severity: "warning",
        type: "RATING_PRIOR_DISABLED_MAP_CONFLICT",
        message: "Expert-rating soft prior disabled because district map assumptions conflict."
      }]
    };
  }

  const normalizedRatingSourceType = ratingSourceType || (fallbackSource && /inferred/i.test(fallbackSource) ? "INFERRED_SAFE_RATING" : "EXTERNAL_RATING");
  const dynamic = dynamicWeight({ office, pollingSummary, fundamentalsQuality, sourceDegraded, ratingSourceType: normalizedRatingSourceType, mapConflict, config });
  let weight = dynamic.weight;
  if (Number.isFinite(Number(override.weight))) weight = Number(override.weight);
  if (Number.isFinite(Number(override.minWeight))) weight = Math.max(weight, Number(override.minWeight));
  if (Number.isFinite(Number(override.maxWeight))) weight = Math.min(weight, Number(override.maxWeight));
  weight = Math.max(0, Math.min(0.65, weight));

  const raw = Number(rawModelMargin);
  const implied = Number(consensus.impliedMargin);
  const ratingPull = Number.isFinite(raw) && Number.isFinite(implied) ? (implied - raw) * weight : 0;
  const divergence = Number.isFinite(raw) && Number.isFinite(implied) ? Math.abs(implied - raw) : null;
  const warnings = [];
  if (Number.isFinite(divergence) && divergence >= 10) {
    warnings.push({ severity: "high", type: "RATING_PRIOR_LARGE_DIVERGENCE", message: `Raw model margin differs from expert-rating implied margin by ${divergence.toFixed(1)} points.` });
  } else if (Number.isFinite(divergence) && divergence >= 5) {
    warnings.push({ severity: "warning", type: "RATING_PRIOR_DIVERGENCE", message: `Raw model margin differs from expert-rating implied margin by ${divergence.toFixed(1)} points.` });
  }
  const guardrailEligible = normalizedRatingSourceType === "EXTERNAL_RATING"
    && dynamic.polls === 0
    && dynamic.weakFundamentals
    && !mapConflict;

  return {
    enabled: weight > 0,
    weight: Number(weight.toFixed(3)),
    reason: override.reason || ratingReason({ office, ...dynamic }),
    consensusRating: consensus.consensusRating,
    impliedMargin: Number(implied.toFixed(2)),
    sources: consensus.sources,
    sourceRatings: consensus.sourceRatings,
    usedAs: weight > 0 ? (guardrailEligible ? "SOFT_PRIOR_AND_GUARDRAIL" : "SOFT_PRIOR") : "COMPARISON_ONLY",
    ratingSourceType: normalizedRatingSourceType,
    guardrailEligible,
    rawModelMargin: Number.isFinite(raw) ? Number(raw.toFixed(2)) : null,
    ratingPull: Number(ratingPull.toFixed(2)),
    probabilityPullStrength: officeConfig.probabilityPullStrength ?? 1,
    projectedResultPullStrength: officeConfig.projectedResultPullStrength ?? 0.6,
    inputWeight: Number((weight * 100).toFixed(1)),
    ratingsHeavy: weight >= 0.35,
    warnings
  };
}

export function applyRatingPrior(margin, prior, strength = 1) {
  const value = Number(margin);
  if (!Number.isFinite(value) || !prior?.enabled) return value;
  const pull = Number(prior.ratingPull) * Number(strength || 0);
  return value + (Number.isFinite(pull) ? pull : 0);
}

function guardrailLimit(value, prior) {
  const rating = normalizeRating(prior?.consensusRating);
  if (!rating) return { margin: value, triggered: false, reason: "NO_RATING" };
  if (rating.normalized === "Toss-up") {
    if (value > 2.99) return { margin: 2.99, triggered: true, reason: "TOSSUP_MAX_TILT_D" };
    if (value < -2.99) return { margin: -2.99, triggered: true, reason: "TOSSUP_MAX_TILT_R" };
    return { margin: value, triggered: false, reason: "WITHIN_TOSSUP_GUARDRAIL" };
  }
  if (rating.normalized === "Lean D" && value <= -3) return { margin: -1.5, triggered: true, reason: "LEAN_D_MAX_TILT_R" };
  if (rating.normalized === "Lean R" && value >= 3) return { margin: 1.5, triggered: true, reason: "LEAN_R_MAX_TILT_D" };
  if (rating.normalized === "Likely D" && value < 3) return { margin: 3, triggered: true, reason: "LIKELY_D_CANNOT_DROP_TO_TOSSUP_WITH_LOW_INPUTS" };
  if (rating.normalized === "Likely R" && value > -3) return { margin: -3, triggered: true, reason: "LIKELY_R_CANNOT_DROP_TO_TOSSUP_WITH_LOW_INPUTS" };
  if (rating.normalized === "Safe D" && value < 7) return { margin: 7, triggered: true, reason: "SAFE_D_FLOOR_WITH_LOW_INPUTS" };
  if (rating.normalized === "Safe R" && value > -7) return { margin: -7, triggered: true, reason: "SAFE_R_FLOOR_WITH_LOW_INPUTS" };
  return { margin: value, triggered: false, reason: "WITHIN_RATING_GUARDRAIL" };
}

export function applyRatingGuardrail(margin, prior) {
  const value = Number(margin);
  if (!Number.isFinite(value)) {
    return { margin: value, triggered: false, reason: "INVALID_MARGIN" };
  }
  if (!prior?.enabled || !prior.guardrailEligible) {
    return { margin: value, triggered: false, reason: prior?.enabled ? "GUARDRAIL_NOT_ELIGIBLE" : "RATING_PRIOR_DISABLED" };
  }
  const limited = guardrailLimit(value, prior);
  return {
    margin: limited.margin,
    triggered: limited.triggered,
    reason: limited.triggered ? `NO_POLLS_LOW_CONFIDENCE_FUNDAMENTALS_BENCHMARK_EXISTS:${limited.reason}` : limited.reason,
    rawMargin: Number(value.toFixed(2)),
    ratingImpliedMargin: Number.isFinite(Number(prior.impliedMargin)) ? Number(Number(prior.impliedMargin).toFixed(2)) : null,
    guardrailedMargin: Number(limited.margin.toFixed(2)),
    benchmark: prior.consensusRating || null
  };
}
