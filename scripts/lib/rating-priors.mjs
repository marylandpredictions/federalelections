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
      noPollingWeakFundamentals: [0.4, 0.55],
      noPollingDecentBaseline: [0.25, 0.4],
      somePolling: [0.1, 0.25],
      multiplePolls: [0.05, 0.15],
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
  if (!Array.isArray(range) || range.length < 2) return fallback;
  const min = Number(range[0]);
  const max = Number(range[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
  return (min + max) / 2;
}

function dynamicWeight({ office, pollingSummary, fundamentalsQuality, sourceDegraded, config }) {
  const officeConfig = config.offices?.[office] || config.offices?.house || {};
  const polls = pollingCount(pollingSummary);
  const weakFundamentals = sourceDegraded || ["WEAK", "LOW", "DEGRADED", "DERIVED_FROM_PRIOR_FORECAST"].includes(String(fundamentalsQuality || "").toUpperCase());
  if (polls >= 3) {
    return { weight: rangeMidpoint(officeConfig.multiplePolls, office === "house" ? 0.1 : 0.065), reasonKey: "multiple-polls", polls, weakFundamentals };
  }
  if (polls > 0) {
    return { weight: rangeMidpoint(officeConfig.somePolling, office === "house" ? 0.175 : 0.1), reasonKey: "some-polling", polls, weakFundamentals };
  }
  if (weakFundamentals) {
    return { weight: rangeMidpoint(officeConfig.noPollingWeakFundamentals, office === "house" ? 0.475 : 0.275), reasonKey: "no-polling-weak-fundamentals", polls, weakFundamentals };
  }
  return { weight: rangeMidpoint(officeConfig.noPollingDecentBaseline, office === "house" ? 0.325 : 0.15), reasonKey: "no-polling-decent-baseline", polls, weakFundamentals };
}

function ratingReason({ office, reasonKey, polls, weakFundamentals }) {
  if (reasonKey === "multiple-polls") return `${office} race has multiple usable polls, so expert ratings are retained as a light stabilizer.`;
  if (reasonKey === "some-polling") return `${office} race has some usable polling, so expert ratings receive a reduced soft-prior weight.`;
  if (reasonKey === "no-polling-weak-fundamentals") return `${office} race has no usable race polling and weak or derived fundamentals, so expert ratings materially constrain the model.`;
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

  const dynamic = dynamicWeight({ office, pollingSummary, fundamentalsQuality, sourceDegraded, config });
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

  return {
    enabled: weight > 0,
    weight: Number(weight.toFixed(3)),
    reason: override.reason || ratingReason({ office, ...dynamic }),
    consensusRating: consensus.consensusRating,
    impliedMargin: Number(implied.toFixed(2)),
    sources: consensus.sources,
    sourceRatings: consensus.sourceRatings,
    usedAs: weight > 0 ? "SOFT_PRIOR" : "COMPARISON_ONLY",
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
