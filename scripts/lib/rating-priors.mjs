import { readFileSync } from "node:fs";

const CONFIG_URL = new URL("../../data/model-config/rating-weights-2026.json", import.meta.url);

export const SOURCE_LABELS = {
  cook: "Cook",
  insideElections: "Inside Elections",
  sabato: "Sabato",
  splitTicket: "Split Ticket",
  raceToWH: "Race to the WH",
  voteHub: "VoteHub",
  voteHubManual: "VoteHub",
  economist: "Economist",
  market: "Market",
  manualScreenshot: "Manual page snapshot",
  aggregatorTable: "Ratings aggregator",
  inferredSafeRating: "Inferred safe rating",
  consensusRating: "Consensus"
};

export const RATING_SOURCE_WEIGHTS = {
  cook: 1,
  insideElections: 0.9,
  sabato: 0.8,
  splitTicket: 0.8,
  raceToWH: 0.6,
  economist: 0.6,
  voteHub: 0.6,
  voteHubManual: 0.6,
  manualScreenshot: 0.4,
  aggregatorTable: 0.5,
  market: 0.45,
  consensusRating: 0.7,
  inferredSafeRating: 0.25
};

const SOURCE_TYPE_WEIGHTS = {
  EXTERNAL_RATING: 0.7,
  MANUAL_SCREENSHOT_OR_PAGE_SNAPSHOT: 0.4,
  AGGREGATOR_TABLE: 0.5,
  INFERRED_SAFE_RATING: 0.25,
  FALLBACK: 0.5
};

const RATING_IMPLIED_MARGINS = {
  "Safe D": 22,
  "Likely D": 11,
  "Lean D": 5.5,
  "Tilt D": 2,
  "Toss-up": 0,
  "Tilt R": -2,
  "Lean R": -5.5,
  "Likely R": -11,
  "Safe R": -22
};

const RATING_SIGMAS = {
  "Safe D": 6,
  "Likely D": 5,
  "Lean D": 4.5,
  "Tilt D": 4,
  "Toss-up": 4.5,
  "Tilt R": 4,
  "Lean R": 4.5,
  "Likely R": 5,
  "Safe R": 6
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

export function ratingPriorDistribution(consensus) {
  if (!consensus?.consensusRating || !Number.isFinite(Number(consensus.impliedMargin))) return null;
  return {
    consensusRating: consensus.consensusRating,
    meanMargin: Number(Number(consensus.impliedMargin).toFixed(2)),
    sigma: Number(RATING_SIGMAS[consensus.consensusRating] ?? 5),
    sources: consensus.sources || [],
    sourceDisagreement: Boolean(consensus.ratingDisagreement)
  };
}

export function ratingSourceWeight(sourceKey, sourceType = null, configuredWeight = null) {
  const numeric = Number(configuredWeight);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const key = String(sourceKey || "").trim();
  if (Object.hasOwn(RATING_SOURCE_WEIGHTS, key)) return RATING_SOURCE_WEIGHTS[key];
  if (sourceType && Object.hasOwn(SOURCE_TYPE_WEIGHTS, sourceType)) return SOURCE_TYPE_WEIGHTS[sourceType];
  return 0.5;
}

export function ratingConsensusFromBenchmark(benchmark, fallbackRating = null, fallbackSource = "Race configuration") {
  const ratings = [];
  const add = (label, rating, meta = {}) => {
    const parsed = normalizeRating(rating);
    if (!parsed) return;
    const sourceKey = meta.sourceKey || label;
    const sourceType = meta.sourceType || "EXTERNAL_RATING";
    ratings.push({
      source: label,
      sourceKey,
      sourceType,
      rating: parsed.normalized,
      impliedMargin: parsed.impliedMargin,
      rank: parsed.rank,
      party: parsed.party,
      weight: Number(ratingSourceWeight(sourceKey, sourceType, meta.weight).toFixed(3)),
      asOf: meta.asOf || null,
      url: meta.url || ""
    });
  };

  if (benchmark && typeof benchmark === "object") {
    for (const [key, value] of Object.entries(benchmark)) {
      if (!value || typeof value !== "object") continue;
      if (key === "cacheMeta") continue;
      add(SOURCE_LABELS[key] || value.source || key, value.rating, {
        sourceKey: value.sourceKey || key,
        sourceType: value.sourceType || benchmark.cacheMeta?.ratingSourceType || "EXTERNAL_RATING",
        weight: value.weight,
        asOf: value.asOf,
        url: value.url
      });
    }
    if (!ratings.length && benchmark.consensusRating) {
      add(SOURCE_LABELS.consensusRating, benchmark.consensusRating, {
        sourceKey: "consensusRating",
        sourceType: benchmark.cacheMeta?.ratingSourceType || "EXTERNAL_RATING",
        weight: benchmark.cacheMeta?.consensusWeight
      });
    }
  }
  if (!ratings.length && fallbackRating) add(fallbackSource, fallbackRating, { sourceType: "FALLBACK", sourceKey: "fallback" });
  if (!ratings.length) return null;

  const weight = ratings.reduce((sum, item) => sum + item.weight, 0) || ratings.length;
  const average = ratings.reduce((sum, item) => sum + item.impliedMargin * (item.weight || 1), 0) / weight;
  const nearest = Object.entries(RATING_IMPLIED_MARGINS)
    .sort((a, b) => Math.abs(a[1] - average) - Math.abs(b[1] - average))[0][0];
  const margins = ratings.map((item) => item.impliedMargin);
  const parties = new Set(ratings.map((item) => item.party || "TOSSUP"));
  return {
    consensusRating: nearest,
    impliedMargin: Number(average.toFixed(2)),
    sources: [...new Set(ratings.map((item) => item.source))],
    sourceRatings: ratings,
    sourceWeight: Number(weight.toFixed(3)),
    ratingDisagreement: parties.size > 1 || Math.max(...margins) - Math.min(...margins) >= 6
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
  if (normalizedFundamentals === "UNVERIFIED" || normalizedFundamentals === "UNKNOWN") {
    return { weight: rangeMidpoint(officeConfig.noPollingUnverifiedFundamentals ?? officeConfig.noPollingWeakFundamentals, office === "house" ? 0.4 : 0.16), reasonKey: "no-polling-unverified-fundamentals", polls, weakFundamentals, derivedFundamentals };
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
  if (reasonKey === "no-polling-unverified-fundamentals") return `${office} race has no usable race polling and unverified current-map fundamentals, so expert ratings materially constrain the model.`;
  if (reasonKey === "no-polling-weak-fundamentals") return `${office} race has no usable race polling and weak or derived fundamentals, so expert ratings materially constrain the model.`;
  if (reasonKey === "no-polling-strong-fundamentals") return `${office} race has no usable race polling but usable structural baselines, so expert ratings provide a moderate soft prior.`;
  if (reasonKey === "no-polling-decent-baseline") return `${office} race has no usable race polling but usable structural baselines, so expert ratings provide a moderate soft prior.`;
  return `${office} race rating prior selected from ${polls} usable polls and ${weakFundamentals ? "weak" : "usable"} fundamentals.`;
}

function marginParty(value) {
  const margin = Number(value);
  if (!Number.isFinite(margin) || Math.abs(margin) < 0.05) return null;
  return margin > 0 ? "D" : "R";
}

function marginToRatingCategory(value) {
  const margin = Number(value);
  if (!Number.isFinite(margin)) return null;
  const party = marginParty(margin);
  const abs = Math.abs(margin);
  if (!party || abs < 1) return { normalized: "Toss-up", party: null, rank: 0 };
  if (abs >= 14) return { normalized: `Safe ${party}`, party, rank: 4 };
  if (abs >= 7) return { normalized: `Likely ${party}`, party, rank: 3 };
  if (abs >= 3) return { normalized: `Lean ${party}`, party, rank: 2 };
  return { normalized: `Tilt ${party}`, party, rank: 1 };
}

function ratingCategoryDistance(modelMargin, rating) {
  const model = marginToRatingCategory(modelMargin);
  const parsed = normalizeRating(rating);
  if (!model || !parsed) return 0;
  if (!model.party || !parsed.party) return Math.abs(model.rank - parsed.rank);
  if (model.party !== parsed.party) return model.rank + parsed.rank;
  return Math.abs(model.rank - parsed.rank);
}

function isExternalRatingSource(sourceType, consensus) {
  if (sourceType === "EXTERNAL_RATING") return true;
  const sourceTypes = new Set((consensus?.sourceRatings || []).map((item) => item.sourceType));
  return ["EXTERNAL_RATING", "MANUAL_SCREENSHOT_OR_PAGE_SNAPSHOT", "AGGREGATOR_TABLE"].some((type) => sourceTypes.has(type));
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
      ratingsPriorDistribution: null,
      warnings: []
    };
  }
  const priorDistribution = ratingPriorDistribution(consensus);

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
      ratingsPriorDistribution: priorDistribution,
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
  const baseWeight = Math.max(0, Math.min(0.65, weight));

  const raw = Number(rawModelMargin);
  const implied = Number(consensus.impliedMargin);
  const externalRating = isExternalRatingSource(normalizedRatingSourceType, consensus);
  const rawParty = marginParty(raw);
  const impliedParty = marginParty(implied);
  const crossesRatingParty = Boolean(externalRating && dynamic.polls === 0 && rawParty && impliedParty && rawParty !== impliedParty);
  const crossRatingBoost = crossesRatingParty ? (office === "house" ? 0.22 : 0.15) : 0;
  weight = Math.max(0, Math.min(0.75, baseWeight + crossRatingBoost));
  const ratingPull = Number.isFinite(raw) && Number.isFinite(implied) ? (implied - raw) * weight : 0;
  const divergence = Number.isFinite(raw) && Number.isFinite(implied) ? Math.abs(implied - raw) : null;
  const warnings = [];
  if (Number.isFinite(divergence) && divergence >= 10) {
    warnings.push({ severity: "high", type: "RATING_PRIOR_LARGE_DIVERGENCE", message: `Raw model margin differs from expert-rating implied margin by ${divergence.toFixed(1)} points.` });
  } else if (Number.isFinite(divergence) && divergence >= 5) {
    warnings.push({ severity: "warning", type: "RATING_PRIOR_DIVERGENCE", message: `Raw model margin differs from expert-rating implied margin by ${divergence.toFixed(1)} points.` });
  }
  const guardrailEligible = externalRating
    && dynamic.polls === 0
    && !mapConflict;
  if (crossRatingBoost) {
    warnings.push({
      severity: "warning",
      type: "RATING_PRIOR_CROSS_RATING_BOOST",
      message: "No usable race polling and raw model margin crossed the external rating party, so the rating prior received a conditional boost."
    });
  }

  return {
    enabled: weight > 0,
    weight: Number(weight.toFixed(3)),
    baseWeight: Number(baseWeight.toFixed(3)),
    crossRatingBoost: Number(crossRatingBoost.toFixed(3)),
    finalWeight: Number(weight.toFixed(3)),
    reason: override.reason || `${ratingReason({ office, ...dynamic })}${crossRatingBoost ? " Conditional boost applied because the raw no-poll model crossed the external rating party." : ""}`,
    consensusRating: consensus.consensusRating,
    impliedMargin: Number(implied.toFixed(2)),
    sources: consensus.sources,
    sourceRatings: consensus.sourceRatings,
    ratingsPriorDistribution: priorDistribution,
    usedAs: weight > 0 ? (guardrailEligible ? "SOFT_PRIOR_AND_GUARDRAIL" : "SOFT_PRIOR") : "COMPARISON_ONLY",
    ratingSourceType: normalizedRatingSourceType,
    guardrailEligible,
    guardrailTriggers: {
      crossesRatingParty,
      categoryDistance: ratingCategoryDistance(raw, consensus.consensusRating),
      rawRatingDivergence: Number.isFinite(divergence) ? Number(divergence.toFixed(2)) : null
    },
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

function softGuardrailPenalty(value, prior) {
  const rating = normalizeRating(prior?.consensusRating);
  const implied = Number(prior?.impliedMargin);
  if (!rating || !Number.isFinite(implied)) {
    return { margin: value, triggered: false, reason: "NO_RATING", penaltyApplied: 0, crossingSeverity: "none" };
  }
  const raw = Number(prior?.rawModelMargin);
  const rawParty = marginParty(Number.isFinite(raw) ? raw : value);
  const ratingParty = marginParty(implied);
  const distance = ratingCategoryDistance(Number.isFinite(raw) ? raw : value, prior.consensusRating);
  const divergence = Math.abs(value - implied);
  const crossesRatingParty = Boolean(rawParty && ratingParty && rawParty !== ratingParty);
  let penalty = 0;
  if (crossesRatingParty) penalty += 0.28;
  if (distance >= 2) penalty += Math.min(0.18, distance * 0.045);
  if (divergence >= 5) penalty += Math.min(0.22, (divergence - 4) * 0.025);
  penalty = Math.max(0, Math.min(0.55, penalty));
  const margin = value + (implied - value) * penalty;
  const crossingSeverity = !penalty
    ? "none"
    : penalty >= 0.4
      ? "high"
      : penalty >= 0.22
        ? "medium"
        : "low";
  return {
    margin,
    triggered: penalty > 0,
    reason: penalty > 0 ? "SOFT_RATING_CROSSING_PENALTY" : "WITHIN_SOFT_RATING_PRIOR",
    penaltyApplied: Number(penalty.toFixed(3)),
    crossingSeverity,
    crossesRatingParty,
    categoryDistance: distance,
    rawRatingDivergence: Number.isFinite(divergence) ? Number(divergence.toFixed(2)) : null
  };
}

export function applyRatingGuardrail(margin, prior) {
  const value = Number(margin);
  if (!Number.isFinite(value)) {
    return { margin: value, triggered: false, eligible: false, reason: "INVALID_MARGIN" };
  }
  if (!prior?.enabled || !prior.guardrailEligible) {
    return {
      margin: value,
      triggered: false,
      eligible: Boolean(prior?.guardrailEligible),
      blockedReason: prior?.enabled ? "GUARDRAIL_NOT_ELIGIBLE" : "RATING_PRIOR_DISABLED",
      reason: prior?.enabled ? "GUARDRAIL_NOT_ELIGIBLE" : "RATING_PRIOR_DISABLED",
      rawModelMargin: prior?.rawModelMargin ?? null,
      preGuardrailMargin: Number(value.toFixed(2)),
      ratingImpliedMargin: Number.isFinite(Number(prior?.impliedMargin)) ? Number(Number(prior.impliedMargin).toFixed(2)) : null,
      externalRating: prior?.consensusRating || null,
      sources: prior?.sourceRatings || []
    };
  }
  const limitedBase = softGuardrailPenalty(value, prior);
  const tossupCategoryLimit = prior.consensusRating === "Toss-up" && Math.abs(limitedBase.margin) > 2.99;
  const limited = tossupCategoryLimit
    ? {
      ...limitedBase,
      margin: Math.sign(limitedBase.margin || value) * 2.99,
      triggered: true,
      reason: `${limitedBase.reason}:TOSSUP_CATEGORY_LIMIT`
    }
    : limitedBase;
  const raw = Number(prior.rawModelMargin);
  const divergence = Number.isFinite(raw) && Number.isFinite(Number(prior.impliedMargin))
    ? Math.abs(raw - Number(prior.impliedMargin))
    : null;
  const distance = ratingCategoryDistance(raw, prior.consensusRating);
  const rawParty = marginParty(raw);
  const ratingParty = marginParty(prior.impliedMargin);
  const crossesRatingParty = Boolean(rawParty && ratingParty && rawParty !== ratingParty);
  const shouldTrigger = limited.triggered || crossesRatingParty || distance >= 2 || (Number.isFinite(divergence) && divergence >= 5);
  return {
    margin: limited.margin,
    triggered: shouldTrigger,
    eligible: true,
    mode: "soft-penalty",
    guardrailMode: "soft-penalty",
    penaltyApplied: limited.penaltyApplied || 0,
    crossingSeverity: limited.crossingSeverity || "none",
    reason: shouldTrigger
      ? `NO_POLLS_EXTERNAL_RATING_SOFT_PENALTY:${limited.reason}${crossesRatingParty ? ":CROSSES_RATING_PARTY" : ""}${distance >= 2 ? ":CATEGORY_DISTANCE_2_PLUS" : ""}${Number.isFinite(divergence) && divergence >= 5 ? ":RAW_DIVERGENCE_5_PLUS" : ""}`
      : limited.reason,
    rawMargin: Number(value.toFixed(2)),
    rawModelMargin: Number.isFinite(raw) ? Number(raw.toFixed(2)) : null,
    preGuardrailMargin: Number(value.toFixed(2)),
    ratingImpliedMargin: Number.isFinite(Number(prior.impliedMargin)) ? Number(Number(prior.impliedMargin).toFixed(2)) : null,
    guardrailedMargin: Number(limited.margin.toFixed(2)),
    externalRating: prior.consensusRating || null,
    benchmark: prior.consensusRating || null,
    sourceRatings: prior.sourceRatings || [],
    triggers: {
      crossesRatingParty,
      categoryDistance: distance,
      rawRatingDivergence: Number.isFinite(divergence) ? Number(divergence.toFixed(2)) : null,
      categoryLimitApplied: tossupCategoryLimit,
      softPenaltyApplied: limited.triggered
    }
  };
}
