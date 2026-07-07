import {
  averagePollMargin,
  buildInputBalance,
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
  sanitizeNoLivePollingClaims,
  sourceHealthForPolling,
  splitConfidence,
  updateCommonTopLevel,
  writeJson
} from "./forecast-kernel-v3.mjs";
import { simulateSenateV3 } from "./simulate-chamber-v3.mjs";

const SENATE_RATING_OVERRIDES = {
  MT: "Safe R",
  NE: "Likely R",
  IA: "Lean R"
};

const EXCEPTION_ADJUSTMENTS = {
  OSBORN_INDEPENDENT_OVERPERFORMANCE: 4.5,
  COOPER_STATEWIDE_OVERPERFORMANCE: 2.4,
  BROWN_STATEWIDE_OVERPERFORMANCE: 1.8,
  ALASKA_COALITION_DYNAMICS: 0.4,
  TEXAS_NOMINEE_CONTEXT: -2.2,
  OSSOFF_INCUMBENCY_AND_GOP_NOMINEE: 1.5,
  MAINE_CANDIDATE_CROSSOVER: -0.4
};

function statePartisanContext(race) {
  const pvi = Number(race.pvi);
  if (!Number.isFinite(pvi)) return 0;
  return clamp(pvi * 0.22, -3, 3);
}

function senateMean(seed, race, rating, pollRows, financeRow) {
  const ratingAnchor = ratingMean(rating);
  const pollAverage = averagePollMargin(pollRows);
  const national = clamp(Number(seed.canonicalGenericBallot?.margin ?? seed.sourceSummary?.genericPolling?.genericBallotMargin ?? 0) * 0.18, -2, 2);
  const partisanContext = statePartisanContext(race);
  const incumbent = race.hold === "D" ? 0.8 : race.hold === "R" ? -0.8 : 0;
  const exceptionType = race.candidateException?.type;
  const exception = clamp(EXCEPTION_ADJUSTMENTS[exceptionType] || 0, -4.5, 4.5);
  const finance = financeRow ? 0 : 0;
  const weights = pollRows.length
    ? { ratings: 0.38, polling: 0.34, partisanContext: 0.1, nationalEnvironment: 0.06, incumbency: 0.06, candidateContext: 0.05, finance: 0.01 }
    : { ratings: 0.56, polling: 0, partisanContext: 0.18, nationalEnvironment: 0.08, incumbency: 0.08, candidateContext: 0.09, finance: 0.01 };
  const inputs = {
    ratings: ratingAnchor,
    polling: Number.isFinite(pollAverage) ? pollAverage : 0,
    partisanContext,
    nationalEnvironment: national,
    incumbency: incumbent,
    candidateContext: exception,
    finance
  };
  let mean = 0;
  const components = [];
  for (const [key, value] of Object.entries(inputs)) {
    mean += value * (weights[key] || 0);
    if ((weights[key] || 0) > 0) components.push({ input: key, value: round(value, 2), weight: weights[key] });
  }
  if (rating?.startsWith("Safe") && Math.abs(mean) < 15) mean = Math.sign(ratingAnchor || mean || -1) * 15;
  if (rating?.startsWith("Likely") && Math.abs(mean) < 7.5) mean = Math.sign(ratingAnchor || mean || -1) * 7.5;
  return { mean: clamp(mean, -28, 28), weights, components, exceptionType };
}

function updateRace(seed, indexes, race) {
  const ratingInfo = ratingsPriorForRace(indexes.ratings, "senate", race);
  const rating = normalizeRating(SENATE_RATING_OVERRIDES[race.state] || ratingInfo.rating || race.modelRating || race.rating)
    || ratingFromMargin(Number(race.margin ?? race.projectedMargin ?? 0));
  const pollRows = rowsForRace(indexes.polls, "senate", race);
  const financeRow = financeForRace(indexes.finance, "senate", race);
  const pollMeta = pollingMetadata(pollRows);
  const financeMeta = financeMetadata(financeRow);
  const meanInfo = senateMean(seed, race, rating, pollRows, financeRow);
  const sigma = clamp(ratingSigma(rating) + (pollRows.length ? -0.5 : 0.8) + (meanInfo.exceptionType ? 0.45 : 0), 4.5, 10);
  const demProbability = probabilityFromMargin(meanInfo.mean, sigma);
  const repProbability = round(1 - demProbability, 6);
  const marginConfidence = pollRows.length ? "MEDIUM" : meanInfo.exceptionType ? "LOW" : "MEDIUM_LOW";
  const dataConfidence = pollRows.length ? "MEDIUM" : "LOW";
  const inputBalance = buildInputBalance(meanInfo.weights);
  const cleaned = sanitizeNoLivePollingClaims(race, pollMeta);
  return {
    ...cleaned,
    rating,
    modelRating: rating,
    margin: round(meanInfo.mean, 2),
    projectedMargin: round(meanInfo.mean, 2),
    probabilityEngineMargin: round(meanInfo.mean, 2),
    projectedResultMargin: marginRecord(meanInfo.mean, "v3 Senate projected result margin", marginConfidence),
    probabilityMargin: marginRecord(meanInfo.mean, "v3 Senate probability margin", marginConfidence),
    ratingMargin: marginRecord(ratingMean(rating), "v3 ratings prior distribution", "MEDIUM"),
    demProbability: round(demProbability, 6),
    repProbability,
    winnerParty: demProbability >= 0.5 ? "D" : "R",
    winnerProbability: round(Math.max(demProbability, repProbability), 6),
    competitive: Math.max(demProbability, repProbability) < 0.75,
    uncertaintySigma: round(sigma, 2),
    ratingsPrior: buildRatingsPriorMetadata({ rating, weight: inputBalance.shares.ratings || 0, ledgerRow: ratingInfo.row }),
    ratingsPriorDistribution: { rating, mean: ratingMean(rating), sigma: ratingSigma(rating) },
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
    candidateException: race.candidateException ? {
      ...race.candidateException,
      v3Mode: "CAPPED_CANDIDATE_CONTEXT_NOT_POLLING",
      v3Adjustment: round((EXCEPTION_ADJUSTMENTS[race.candidateException.type] || 0), 2),
      usablePolls: pollMeta.validatedPollCount,
      confidence: pollMeta.validatedPollCount ? "MEDIUM" : "LOW",
      warning: "This is a capped candidate-context adjustment and is not counted as live polling support."
    } : null,
    sourceInputs: {
      ...(cleaned.sourceInputs || {}),
      pollMargin: {
        value: pollMeta.validatedPollCount ? round(averagePollMargin(pollRows), 2) : null,
        usableAsGeneralElectionPoll: pollMeta.validatedPollCount > 0,
        source: "data/staging/polls/live-general-ledger-v3.json"
      }
    },
    sourceHealth: sourceHealthForPolling(pollMeta, [
      meanInfo.exceptionType ? "candidate exception capped separately from polling" : "no candidate exception"
    ]),
    confidence: splitConfidence(demProbability, marginConfidence, dataConfidence),
    modelConfidence: dataConfidence,
    marginDecomposition: {
      ...(race.marginDecomposition || {}),
      v3Components: meanInfo.components,
      guardrailReason: pollMeta.validatedPollCount
        ? "Validated v3 poll rows blended with ratings and fundamentals."
        : "No validated v3 poll rows; forecast relies on ratings, fundamentals, and capped candidate context."
    },
    dataQualityFlags: [
      ...(Array.isArray(race.dataQualityFlags) ? race.dataQualityFlags : []),
      ...(pollMeta.validatedPollCount ? [] : ["NO_VALIDATED_LIVE_SENATE_POLL"])
    ]
  };
}

function senateProvenanceDiagnostics(races, pollLedger) {
  const inconsistent = races.filter((race) => {
    const saysLive = /LIVE_POLLS_AVAILABLE|MANUAL_POLLS_AVAILABLE/.test(String(race.pollingStatus))
      || race.usablePollCount > 0
      || race.livePollCount > 0
      || race.sourceHealth?.racePolling === "LIVE_POLLS_AVAILABLE";
    const hasLedgerRows = pollLedger.rows.some((row) => row.office === "senate" && row.canonicalRaceId === `${race.state}-SEN-2026`);
    return saysLive !== hasLedgerRows;
  });
  return {
    schemaVersion: "v3",
    generatedAt: new Date().toISOString(),
    validatedSenatePollRows: pollLedger.rows.filter((row) => row.office === "senate").length,
    raceCount: races.length,
    inconsistentClaims: inconsistent.map((race) => ({
      state: race.state,
      pollingStatus: race.pollingStatus,
      usablePollCount: race.usablePollCount,
      sourceHealthRacePolling: race.sourceHealth?.racePolling
    })),
    status: inconsistent.length ? "FAIL" : "PASS"
  };
}

export async function main() {
  const trustLedgers = buildTrustLedgersV3();
  const seed = readForecastSeed("data/forecast.json", "data/legacy/forecast-v2-snapshot.json");
  const indexes = {
    polls: indexByAliases(trustLedgers.polls.rows),
    ratings: indexByAliases(trustLedgers.ratings.rows),
    finance: indexByAliases(trustLedgers.finance.rows)
  };
  const races = (seed.races || []).map((race) => updateRace(seed, indexes, race));
  const draft = { ...seed, races };
  const simulation = simulateSenateV3(draft, { iterations: seed.settings?.simulations || 100000 });
  const diagnostics = senateProvenanceDiagnostics(races, trustLedgers.polls);
  const output = updateCommonTopLevel(draft, "senate", trustLedgers, {
    forecastStatus: diagnostics.validatedSenatePollRows === 0 ? "REVIEW_NO_VALIDATED_SENATE_POLLS" : "REVIEW_VALIDATED_POLL_BLEND",
    topLevel: {
      generationMode: seed.generationMode || "PARTIAL_NETWORK",
      sourceHealth: {
        ...(seed.sourceHealth || {}),
        health: diagnostics.validatedSenatePollRows === 0 ? "DEGRADED" : "HEALTHY",
        degraded: diagnostics.validatedSenatePollRows === 0,
        reasons: diagnostics.validatedSenatePollRows === 0
          ? ["No Senate polls are validated in the v3 live poll ledger."]
          : ["Senate v3 uses validated poll ledger rows."]
      },
      demControlProbability: simulation.demControlProbability,
      repControlProbability: simulation.repControlProbability,
      democraticControlProbability: simulation.demControlProbability,
      republicanControlProbability: simulation.repControlProbability,
      expectedDemSeats: simulation.expectedDemSeats,
      expectedRepSeats: simulation.expectedRepSeats,
      demMedianSeats: simulation.medianDemSeats,
      repMedianSeats: simulation.medianRepSeats,
      medianSeats: {
        democrats: simulation.medianDemSeats,
        republicans: simulation.medianRepSeats,
        dem: simulation.medianDemSeats,
        rep: simulation.medianRepSeats,
        display: `${simulation.medianDemSeats} D / ${simulation.medianRepSeats} R`
      },
      seatCounts: simulation.distribution,
      simulationDiagnostics: {
        v3: simulation
      },
      racePollCoverage: {
        usablePollRaces: new Set(trustLedgers.polls.rows.filter((row) => row.office === "senate").map((row) => row.canonicalRaceId)).size,
        usablePollRows: trustLedgers.polls.rows.filter((row) => row.office === "senate").length,
        source: "data/staging/polls/live-general-ledger-v3.json"
      },
      modelWarnings: [
        ...(Array.isArray(seed.modelWarnings) ? seed.modelWarnings : []),
        ...(diagnostics.validatedSenatePollRows === 0 ? ["No Senate race may claim live polling under v3 until the validated ledger has Senate rows."] : [])
      ]
    }
  });
  writeJson("data/forecast.json", output);
  writeJson("data/diagnostics/senate-provenance-consistency-v3-2026.json", diagnostics);
  console.log(`Senate v3 forecast written: ${simulation.expectedDemSeats} D expected, ${diagnostics.validatedSenatePollRows} validated poll rows.`);
}

moduleMain(import.meta.url, main);
