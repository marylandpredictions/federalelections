import { readFileSync } from "node:fs";

const NATIONAL_ENVIRONMENT_CONFIG_URL = new URL("../../data/model-config/house-national-environment-2026.json", import.meta.url);
const ELASTICITY_CONFIG_URL = new URL("../../data/model-config/house-elasticity-2026.json", import.meta.url);

const FALLBACK_NATIONAL_ENVIRONMENT = {
  priorHouseNationalPopularVoteMargin: -2.56,
  baselineYear: 2024,
  baselineSource: "2024 House national popular vote",
  currentGenericBallotSource: "canonical generic ballot",
  useSwingFromPriorHouseBaseline: true,
  maxNationalSwingEffect: 7,
  presidentialBaselineMultiplier: 0.72,
  pviBaselineMultiplier: 0.78,
  ratingsOnlyMultiplier: 0.45,
  missingBaselineMultiplier: 0.35
};

const FALLBACK_ELASTICITY = {
  tossup: 0.65,
  tilt: 0.62,
  lean: 0.52,
  likely: 0.38,
  safe: 0.22,
  openSeatBoost: 0.08,
  strongIncumbentReduction: -0.08,
  highSuburbanSwingBoost: 0.1,
  deepRuralReduction: -0.08,
  minElasticity: 0.16,
  maxElasticity: 0.78,
  redistrictedMapSpecific: true,
  tossupRecenter: {
    enabled: true,
    maxAdjustment: 1.5,
    onlyNoPollingDistricts: true,
    onlyExternalTossups: true,
    triggerAverageMargin: -0.75,
    adjustmentShare: 0.6
  }
};

const SUBURBAN_SWING_STATES = new Set(["AZ", "CA", "CO", "GA", "IL", "MI", "MN", "NC", "NJ", "NY", "PA", "TX", "VA", "WA", "WI"]);
const DEEP_RURAL_STATES = new Set(["AL", "AR", "ID", "KY", "MS", "MO", "MT", "ND", "OK", "SD", "TN", "WV", "WY"]);

export function loadHouseNationalEnvironmentConfig() {
  return readConfig(NATIONAL_ENVIRONMENT_CONFIG_URL, FALLBACK_NATIONAL_ENVIRONMENT);
}

export function loadHouseElasticityConfig() {
  return readConfig(ELASTICITY_CONFIG_URL, FALLBACK_ELASTICITY);
}

export function buildHouseNationalEnvironment(currentGenericBallotMargin, config = loadHouseNationalEnvironmentConfig()) {
  const current = finiteNumber(currentGenericBallotMargin);
  const prior = finiteNumber(config.priorHouseNationalPopularVoteMargin);
  const nationalSwingFromPriorHouse = Number.isFinite(current) && Number.isFinite(prior)
    ? current - prior
    : null;
  return {
    currentGenericBallotMargin: Number.isFinite(current) ? Number(current.toFixed(2)) : null,
    priorHouseNationalPopularVoteMargin: Number.isFinite(prior) ? Number(prior.toFixed(2)) : null,
    nationalSwingFromPriorHouse: Number.isFinite(nationalSwingFromPriorHouse) ? Number(nationalSwingFromPriorHouse.toFixed(2)) : null,
    baselineYear: config.baselineYear || 2024,
    baselineSource: config.baselineSource || "2024 House national popular vote",
    currentGenericBallotSource: config.currentGenericBallotSource || "canonical generic ballot",
    useSwingFromPriorHouseBaseline: config.useSwingFromPriorHouseBaseline !== false,
    maxNationalSwingEffect: Number(config.maxNationalSwingEffect || 7),
    calculation: "currentGenericBallotMargin - priorHouseNationalPopularVoteMargin",
    notes: config.notes || ""
  };
}

export function houseBaselineAnchor({ district, fundamentalsPrior, contextMargin, hasRatingPrior }) {
  const houseMargin = finiteNumber(fundamentalsPrior?.houseMargin2024);
  const presidentialMargin = finiteNumber(fundamentalsPrior?.presidentialMargin2024 ?? district?.presidentialMargin);
  if (fundamentalsPrior?.houseMargin2024Comparable !== false && Number.isFinite(houseMargin)) {
    return {
      type: "HOUSE_2024",
      margin: Number(houseMargin.toFixed(2)),
      source: "source-backed 2024 House district result",
      containsPriorNationalEnvironment: true,
      nationalEnvironmentMethod: "SWING_FROM_2024_HOUSE_NPV"
    };
  }
  if (Number.isFinite(presidentialMargin)) {
    return {
      type: "PRESIDENTIAL_2024",
      margin: Number(presidentialMargin.toFixed(2)),
      source: "2024 presidential district result translated to House environment",
      containsPriorNationalEnvironment: true,
      nationalEnvironmentMethod: "PRESIDENTIAL_TO_HOUSE_TRANSLATION"
    };
  }
  if (hasRatingPrior) {
    return {
      type: "RATINGS_ONLY",
      margin: Number.isFinite(finiteNumber(contextMargin)) ? Number(finiteNumber(contextMargin).toFixed(2)) : null,
      source: "public rating prior with no independent district return baseline",
      containsPriorNationalEnvironment: false,
      nationalEnvironmentMethod: "RATINGS_ONLY_GENERIC_BALLOT_TRANSLATION"
    };
  }
  return {
    type: "MISSING",
    margin: Number.isFinite(finiteNumber(contextMargin)) ? Number(finiteNumber(contextMargin).toFixed(2)) : null,
    source: "missing independent district baseline",
    containsPriorNationalEnvironment: false,
    nationalEnvironmentMethod: "LOW_CONFIDENCE_GENERIC_BALLOT_TRANSLATION"
  };
}

export function districtElasticity({ district, rating, challengerStrength, config = loadHouseElasticityConfig() }) {
  const bucket = ratingBucket(rating);
  let elasticity = Number(config[bucket] ?? config.lean ?? 0.52);
  const reasons = [`${labelBucket(bucket)} district`];
  if (district?.open) {
    elasticity += Number(config.openSeatBoost || 0);
    reasons.push("open seat boost");
  }
  if (!district?.open && district?.seatParty && ["none", null, undefined].includes(challengerStrength)) {
    elasticity += Number(config.strongIncumbentReduction || 0);
    reasons.push("incumbent-party hold with no strong challenger");
  }
  if (SUBURBAN_SWING_STATES.has(district?.state) && Math.abs(Number(district?.presidentialMargin ?? district?.fundamentalMargin ?? 0)) <= 12) {
    elasticity += Number(config.highSuburbanSwingBoost || 0);
    reasons.push("suburban swing district");
  }
  if (DEEP_RURAL_STATES.has(district?.state) && Number(district?.presidentialMargin ?? district?.fundamentalMargin ?? 0) <= -14) {
    elasticity += Number(config.deepRuralReduction || 0);
    reasons.push("deep rural reduction");
  }
  const bounded = clamp(elasticity, Number(config.minElasticity || 0.16), Number(config.maxElasticity || 0.78));
  return {
    bucket,
    districtElasticity: Number(bounded.toFixed(3)),
    elasticityReasons: reasons,
    configVersion: "house-elasticity-2026"
  };
}

export function houseNationalEnvironmentEffect({ environment, baselineAnchor, elasticity, config = loadHouseNationalEnvironmentConfig() }) {
  const current = finiteNumber(environment?.currentGenericBallotMargin);
  const swing = finiteNumber(environment?.nationalSwingFromPriorHouse);
  const anchorType = baselineAnchor?.type || "MISSING";
  let base = 0;
  let method = "UNKNOWN";
  if (anchorType === "HOUSE_2024" && Number.isFinite(swing)) {
    base = swing;
    method = "SWING_FROM_2024_HOUSE_NPV";
  } else if (anchorType === "PRESIDENTIAL_2024" && Number.isFinite(current)) {
    base = current * Number(config.presidentialBaselineMultiplier || 0.72);
    method = "PRESIDENTIAL_TO_HOUSE_TRANSLATION";
  } else if (anchorType === "PVI" && Number.isFinite(current)) {
    base = current * Number(config.pviBaselineMultiplier || 0.78);
    method = "PVI_TO_HOUSE_TRANSLATION";
  } else if (anchorType === "RATINGS_ONLY" && Number.isFinite(current)) {
    base = current * Number(config.ratingsOnlyMultiplier || 0.45);
    method = "RATINGS_ONLY_GENERIC_BALLOT_TRANSLATION";
  } else if (Number.isFinite(current)) {
    base = current * Number(config.missingBaselineMultiplier || 0.35);
    method = "LOW_CONFIDENCE_GENERIC_BALLOT_TRANSLATION";
  }
  const rawEffect = base * Number(elasticity || 0);
  const capped = clamp(rawEffect, -Math.abs(Number(config.maxNationalSwingEffect || 7)), Math.abs(Number(config.maxNationalSwingEffect || 7)));
  return {
    method,
    baseNationalSignal: Number(base.toFixed(2)),
    nationalEnvironmentEffect: Number(capped.toFixed(2)),
    capped: Math.abs(capped - rawEffect) > 0.001
  };
}

function ratingBucket(rating) {
  const text = String(rating || "").toLowerCase();
  if (text.includes("toss")) return "tossup";
  if (text.includes("tilt")) return "tilt";
  if (text.includes("lean")) return "lean";
  if (text.includes("likely")) return "likely";
  if (text.includes("safe") || text.includes("solid")) return "safe";
  return "lean";
}

function labelBucket(bucket) {
  if (bucket === "tossup") return "Toss-up";
  return bucket ? bucket[0].toUpperCase() + bucket.slice(1) : "Lean";
}

function readConfig(url, fallback) {
  try {
    return { ...fallback, ...JSON.parse(readFileSync(url, "utf8")) };
  } catch {
    return fallback;
  }
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value) || 0, min), max);
}
