import {
  averagePollMargin,
  baselineForHouseRace,
  buildFinanceLedgerV3,
  buildHouseBaselineLedgerV3,
  buildInputBalance,
  buildLiveGeneralLedgerV3,
  buildRatingsPriorLedgerV3,
  buildRatingsPriorMetadata,
  buildTrustLedgersV3,
  clamp,
  financeForRace,
  financeMetadata,
  indexByAliases,
  marginRecord,
  moduleMain,
  normalizeRating,
  pollingMetadata,
  probabilityFromMargin,
  ratingFromMargin,
  ratingMean,
  ratingSigma,
  ratingsPriorForRace,
  readForecastSeed,
  round,
  rowsForRace,
  sourceHealthForPolling,
  splitConfidence,
  updateCommonTopLevel,
  writeJson
} from "./forecast-kernel-v3.mjs";
import { simulateHouseV3 } from "./simulate-chamber-v3.mjs";

function incumbentEffect(district) {
  if (district.open) return 0;
  const party = district.seatParty || district.incumbent?.party || district.hold;
  if (party === "D") return 0.8;
  if (party === "R") return -0.8;
  return 0;
}

function nationalEffect(seed, district) {
  const raw = Number(seed.houseNationalEnvironment?.nationalEnvironmentEffect ?? seed.canonicalGenericBallot?.margin ?? 0);
  const elasticity = Number(district.districtElasticity ?? 1);
  return clamp(raw * clamp(elasticity, 0.55, 1.35) * 0.22, -2.2, 2.2);
}

function buildDistrictMean({ seed, district, rating, baseline, pollRows, financeRow }) {
  if (rating === "Map Conflict" || district.forecastStatus === "SCENARIO_ONLY") {
    const existing = Number(district.projectedMargin ?? district.margin);
    return {
      mean: Number.isFinite(existing) ? existing : 0,
      weights: { ratings: 0, verifiedBaseline: 0, polling: 0, nationalEnvironment: 0, incumbency: 0, finance: 0 },
      mode: "SCENARIO_ONLY_MAP_CONFLICT",
      components: []
    };
  }

  const ratingAnchor = ratingMean(rating);
  const verifiedBaseline = baseline?.useAsAnchor ? Number(baseline.baselineMargin) : null;
  const pollAverage = averagePollMargin(pollRows);
  const national = nationalEffect(seed, district);
  const incumbent = incumbentEffect(district);
  const finance = financeRow ? 0 : 0;

  const components = [];
  let weights;
  if (Number.isFinite(verifiedBaseline)) {
    weights = pollRows.length
      ? { ratings: 0.38, verifiedBaseline: 0.25, polling: 0.25, nationalEnvironment: 0.06, incumbency: 0.05, finance: 0.01 }
      : { ratings: 0.54, verifiedBaseline: 0.3, polling: 0, nationalEnvironment: 0.08, incumbency: 0.07, finance: 0.01 };
  } else {
    weights = pollRows.length
      ? { ratings: 0.62, verifiedBaseline: 0, polling: 0.26, nationalEnvironment: 0.06, incumbency: 0.05, finance: 0.01 }
      : { ratings: 0.8, verifiedBaseline: 0, polling: 0, nationalEnvironment: 0.11, incumbency: 0.08, finance: 0.01 };
  }

  const inputs = {
    ratings: ratingAnchor,
    verifiedBaseline: Number.isFinite(verifiedBaseline) ? verifiedBaseline : 0,
    polling: Number.isFinite(pollAverage) ? pollAverage : 0,
    nationalEnvironment: national,
    incumbency: incumbent,
    finance
  };
  let mean = 0;
  for (const [key, value] of Object.entries(inputs)) {
    mean += value * (weights[key] || 0);
    if ((weights[key] || 0) > 0) components.push({ input: key, value: round(value, 2), weight: weights[key] });
  }

  const ratingRank = Math.abs((ratingMean(rating) || 0));
  if (ratingRank >= 20 && Math.abs(mean) < 18) mean = Math.sign(ratingAnchor) * 18;
  if (ratingRank >= 11 && Math.abs(mean) < 8.5) mean = Math.sign(ratingAnchor) * 8.5;

  return {
    mean: clamp(mean, -35, 35),
    weights,
    mode: Number.isFinite(verifiedBaseline) ? "RATINGS_PLUS_VERIFIED_BASELINE" : "RATINGS_FIRST_NO_CURRENT_MAP_BASELINE",
    components
  };
}

function isScenarioOnlyMapConflict(district) {
  return district.id === "AL-02"
    || district.rating === "Map Conflict"
    || district.forecastStatus === "SCENARIO_ONLY"
    || district.redistrictingConfidence === "CONFLICTING_SOURCES";
}

function updateDistrict(seed, indexes, district) {
  const ratingInfo = ratingsPriorForRace(indexes.ratings, "house", district);
  const rating = isScenarioOnlyMapConflict(district)
    ? "Map Conflict"
    : normalizeRating(ratingInfo.rating || district.modelRating || district.rating || district.baselineRating)
    || ratingFromMargin(Number(district.margin ?? district.projectedMargin ?? 0));
  const baseline = baselineForHouseRace(indexes.baselines, district);
  const pollRows = rowsForRace(indexes.polls, "house", district);
  const financeRow = financeForRace(indexes.finance, "house", district);
  const pollMeta = pollingMetadata(pollRows);
  const financeMeta = financeMetadata(financeRow);
  const meanInfo = buildDistrictMean({ seed, district, rating, baseline, pollRows, financeRow });
  const sigma = rating === "Map Conflict"
    ? 10
    : clamp(ratingSigma(rating) + (baseline?.useAsAnchor ? -0.2 : 0.45) + (pollRows.length ? -0.45 : 0), 3.8, 9.5);
  const demProbability = probabilityFromMargin(meanInfo.mean, sigma);
  const repProbability = round(1 - demProbability, 6);
  const winnerParty = demProbability >= 0.5 ? "D" : "R";
  const marginConfidence = baseline?.useAsAnchor || pollRows.length ? "MEDIUM" : rating?.startsWith("Safe") ? "MEDIUM" : "LOW";
  const dataConfidence = baseline?.useAsAnchor ? "MEDIUM" : "LOW";
  const inputBalance = buildInputBalance(meanInfo.weights);
  const updated = {
    ...district,
    rating,
    modelRating: rating,
    forecastStatus: isScenarioOnlyMapConflict(district) ? "SCENARIO_ONLY" : district.forecastStatus,
    forecastMode: meanInfo.mode,
    modelMode: meanInfo.mode,
    margin: round(meanInfo.mean, 2),
    projectedMargin: round(meanInfo.mean, 2),
    probabilityEngineMargin: round(meanInfo.mean, 2),
    projectedResultMargin: marginRecord(meanInfo.mean, "v3 ratings-first projected result margin", marginConfidence),
    probabilityMargin: marginRecord(meanInfo.mean, "v3 displayed probability margin", marginConfidence),
    ratingMargin: marginRecord(ratingMean(rating), "v3 ratings prior distribution", "MEDIUM"),
    demProbability: round(demProbability, 6),
    repProbability,
    winnerParty,
    winnerProbability: round(Math.max(demProbability, repProbability), 6),
    winner: winnerParty,
    competitive: Math.max(demProbability, repProbability) < 0.75,
    uncertaintySigma: round(sigma, 2),
    baselineComparability: {
      source: "data/staging/baselines/house-baseline-ledger-v3.json",
      status: baseline?.v3Treatment || "NO_BASELINE_LEDGER_ROW",
      useAsAnchor: Boolean(baseline?.useAsAnchor),
      useAsContext: !baseline?.useAsAnchor,
      effectiveWeight: baseline?.v3EffectiveWeight ?? 0,
      note: baseline?.v3Notes || "No verified current-map baseline anchor available."
    },
    baselineAnchor: {
      ...(district.baselineAnchor || {}),
      v3: {
        useAsAnchor: Boolean(baseline?.useAsAnchor),
        treatment: baseline?.v3Treatment || "NO_BASELINE_LEDGER_ROW",
        baselineMargin: baseline?.baselineMargin ?? null
      }
    },
    ratingsPrior: buildRatingsPriorMetadata({ rating, weight: inputBalance.shares.ratings || 0, ledgerRow: ratingInfo.row, enabled: rating !== "Map Conflict" }),
    ratingsPriorDistribution: {
      rating,
      mean: ratingMean(rating),
      sigma: ratingSigma(rating)
    },
    pollProvenance: pollMeta,
    pollCount: pollMeta.validatedPollCount,
    usablePollCount: pollMeta.validatedPollCount,
    livePollCount: pollMeta.livePollCount,
    manualPollCount: pollRows.filter((row) => String(row.sourceKind || "").includes("manual")).length,
    totalPollInputsUsed: pollMeta.validatedPollCount,
    pollingStatus: pollMeta.status,
    financeStatus: financeMeta.status,
    financeSignal: financeMeta,
    inputBalance,
    marginDecomposition: {
      ...(district.marginDecomposition || {}),
      v3Mode: meanInfo.mode,
      v3Components: meanInfo.components,
      guardrailReason: "Ratings prior distribution is the primary v3 anchor when current-map baselines are unverified."
    },
    sourceHealth: sourceHealthForPolling(pollMeta, [
      baseline?.useAsAnchor ? "verified current-map baseline available" : "no verified current-map baseline anchor",
      financeMeta.active ? "active race-level finance available" : "finance inactive"
    ]),
    confidence: splitConfidence(demProbability, marginConfidence, dataConfidence),
    modelConfidence: dataConfidence,
    dataQualityFlags: [
      ...(Array.isArray(district.dataQualityFlags) ? district.dataQualityFlags : []),
      ...(baseline?.useAsAnchor ? [] : ["NO_VERIFIED_CURRENT_MAP_BASELINE_ANCHOR"]),
      ...(pollRows.length ? [] : ["NO_VALIDATED_LIVE_DISTRICT_POLL"])
    ],
    lastUpdated: seed.generatedAt || seed.lastUpdated
  };
  return updated;
}

function houseSanityDiagnostics(districts, simulation, baselineLedger, financeLedger) {
  const byRating = {};
  for (const district of districts) {
    const rating = district.rating || "Unrated";
    if (!byRating[rating]) byRating[rating] = { count: 0, demProbabilitySum: 0, marginSum: 0 };
    byRating[rating].count += 1;
    byRating[rating].demProbabilitySum += district.demProbability;
    byRating[rating].marginSum += district.projectedMargin;
  }
  for (const item of Object.values(byRating)) {
    item.averageDemProbability = round(item.demProbabilitySum / item.count, 4);
    item.averageProjectedMargin = round(item.marginSum / item.count, 2);
    delete item.demProbabilitySum;
    delete item.marginSum;
  }
  const expectedFromDistricts = districts.reduce((sum, district) => sum + district.demProbability, 0);
  const projectedTwentyPlus = districts.filter((district) => Math.abs(district.projectedMargin) >= 20);
  const unsafeSafeSeats = projectedTwentyPlus.filter((district) => Math.min(district.demProbability, district.repProbability) > 0.1);
  const warnings = [];
  if ((byRating["Safe D"]?.averageDemProbability ?? 1) < 0.95) warnings.push("Safe D average Dem probability below 95%.");
  if ((byRating["Safe R"]?.averageDemProbability ?? 0) > 0.05) warnings.push("Safe R average Dem probability above 5%.");
  if (unsafeSafeSeats.length) warnings.push(`${unsafeSafeSeats.length} districts with >=20 point projected margins still give trailing party above 10%.`);
  if (Math.abs(expectedFromDistricts - simulation.expectedDemSeats) > 0.05) warnings.push("Simulator expected seats do not align with district probability sum.");
  return {
    schemaVersion: "v3",
    generatedAt: new Date().toISOString(),
    mode: baselineLedger.mode,
    baselineCoverage: baselineLedger.counts,
    financeCoverage: financeLedger.counts,
    ratingsBuckets: byRating,
    expectedDemSeatsFromDistrictProbabilities: round(expectedFromDistricts, 2),
    simulatorExpectedDemSeats: simulation.expectedDemSeats,
    expectedSeatDifference: round(Math.abs(expectedFromDistricts - simulation.expectedDemSeats), 4),
    unsafeSafeSeats: unsafeSafeSeats.map((district) => ({
      id: district.id,
      rating: district.rating,
      projectedMargin: district.projectedMargin,
      trailingProbability: round(Math.min(district.demProbability, district.repProbability), 4)
    })),
    status: warnings.length ? "WARN" : "PASS",
    warnings
  };
}

export async function main() {
  const trustLedgers = buildTrustLedgersV3();
  const seed = readForecastSeed("data/house-forecast.json", "data/legacy/house-forecast-v2-snapshot.json");
  const indexes = {
    polls: indexByAliases(trustLedgers.polls.rows),
    ratings: indexByAliases(trustLedgers.ratings.rows),
    baselines: indexByAliases(trustLedgers.baselines.rows),
    finance: indexByAliases(trustLedgers.finance.rows)
  };
  const districts = (seed.districts || []).map((district) => updateDistrict(seed, indexes, district));
  const draft = { ...seed, districts };
  const simulation = simulateHouseV3(draft, { iterations: seed.settings?.simulations || 100000 });
  const sanity = houseSanityDiagnostics(districts, simulation, trustLedgers.baselines, trustLedgers.finance);
  const output = updateCommonTopLevel(draft, "house", trustLedgers, {
    forecastStatus: trustLedgers.baselines.mode === "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES" ? "REVIEW_RATINGS_FIRST_NO_CURRENT_MAP_BASELINES" : "REVIEW_RATINGS_PLUS_BASELINES",
    mode: trustLedgers.baselines.mode,
    topLevel: {
      currentMode: trustLedgers.baselines.mode,
      generationMode: seed.generationMode || "PARTIAL_NETWORK",
      sourceHealth: {
        ...(seed.sourceHealth || {}),
        health: "DEGRADED",
        degraded: true,
        forecast: "RATINGS_FIRST",
        reasons: [
          "House v3 is ratings-first because verified current-map baseline coverage is limited.",
          `${trustLedgers.baselines.counts.verifiedCurrentMapBaselineCount} verified current-map baseline anchors.`,
          `${trustLedgers.polls.counts.byOffice.house || 0} validated district live polls.`
        ]
      },
      verifiedCurrentMapBaselineCoverage: {
        verified: trustLedgers.baselines.counts.verifiedCurrentMapBaselineCount,
        total: trustLedgers.baselines.counts.total,
        share: round(trustLedgers.baselines.counts.verifiedCurrentMapBaselineCount / Math.max(1, trustLedgers.baselines.counts.total), 4)
      },
      ratingsFirstShareOfDistrictMeans: round(districts.filter((district) => /RATINGS_FIRST/.test(district.modelMode)).length / Math.max(1, districts.length), 4),
      activeRaceLevelFinanceCoverage: {
        active: trustLedgers.finance.rows.filter((row) => row.office === "house" && row.v3Active).length,
        total: trustLedgers.finance.rows.filter((row) => row.office === "house").length
      },
      realDistrictPollingCoverage: {
        validatedLivePollRows: trustLedgers.polls.rows.filter((row) => row.office === "house").length,
        districtsWithValidatedLivePolls: new Set(trustLedgers.polls.rows.filter((row) => row.office === "house").map((row) => row.canonicalRaceId)).size
      },
      simulationCalibrationSummary: {
        expectedDemSeats: simulation.expectedDemSeats,
        medianDemSeats: simulation.medianDemSeats,
        demControlProbability: simulation.demControlProbability,
        status: sanity.status
      },
      benchmarkDivergenceWarning: seed.benchmarkComparison?.status === "CONFIGURED" ? seed.benchmarkComparison : { status: "NOT_CONFIGURED" },
      expectedDemSeats: simulation.expectedDemSeats,
      expectedRepSeats: simulation.expectedRepSeats,
      demMedianSeats: simulation.medianDemSeats,
      repMedianSeats: simulation.medianRepSeats,
      demControlProbability: simulation.demControlProbability,
      repControlProbability: simulation.repControlProbability,
      democraticControlProbability: simulation.demControlProbability,
      republicanControlProbability: simulation.repControlProbability,
      medianSeats: {
        democrats: simulation.medianDemSeats,
        republicans: simulation.medianRepSeats,
        dem: simulation.medianDemSeats,
        rep: simulation.medianRepSeats,
        display: `${simulation.medianDemSeats} D / ${simulation.medianRepSeats} R`
      },
      seatCounts: simulation.distribution,
      simulationDiagnostics: {
        ...(seed.simulationDiagnostics || {}),
        v3: simulation
      },
      modelWarnings: [
        ...(Array.isArray(seed.modelWarnings) ? seed.modelWarnings : []),
        ...(sanity.warnings || [])
      ],
      dataQualityWarnings: [
        ...(Array.isArray(seed.dataQualityWarnings) ? seed.dataQualityWarnings : []),
        ...(trustLedgers.baselines.mode === "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES"
          ? ["House v3 is running without verified current-map baseline anchors."]
          : [])
      ]
    }
  });
  writeJson("data/house-forecast.json", output);
  writeJson("data/diagnostics/house-probability-sanity-v3-2026.json", sanity);
  writeJson("data/diagnostics/simulation-calibration-v3-2026.json", {
    schemaVersion: "v3",
    generatedAt: new Date().toISOString(),
    house: simulation,
    notes: ["House simulation uses public v3 district probabilities as the only seat inputs."]
  });
  console.log(`House v3 forecast written: ${simulation.expectedDemSeats} D expected, mode ${trustLedgers.baselines.mode}.`);
}

moduleMain(import.meta.url, main);
