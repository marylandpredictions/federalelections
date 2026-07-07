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
import { simulateGovernorV3 } from "./simulate-chamber-v3.mjs";

function governorNationalEffect(seed, race) {
  const generic = Number(seed.canonicalGenericBallot?.margin ?? seed.sourceSummary?.genericPolling?.genericBallotMargin ?? 0);
  const elasticity = Number(race.stateElasticity ?? 0.8);
  return clamp(generic * clamp(elasticity, 0.45, 1.1) * 0.12, -1.5, 1.5);
}

function governorCandidateEffect(race) {
  const raw = Number(race.candidateEdge ?? race.candidateAndLocal ?? race.candidateException?.adjustment ?? 0);
  return Number.isFinite(raw) ? clamp(raw, -3.5, 3.5) : 0;
}

function governorStructuralInput(race) {
  const candidates = [
    race.fundamentalsMargin,
    race.structuralMargin,
    race.lastMargin,
    race.margin,
    race.projectedMargin
  ].map(Number).filter(Number.isFinite);
  if (!candidates.length) return 0;
  return clamp(candidates[0], -25, 25);
}

function governorMean(seed, race, rating, pollRows, financeRow) {
  const pollAverage = averagePollMargin(pollRows);
  const structural = governorStructuralInput(race);
  const national = governorNationalEffect(seed, race);
  const candidate = governorCandidateEffect(race);
  const finance = financeRow ? 0 : 0;
  const weights = pollRows.length
    ? { ratings: 0.34, polling: 0.38, structural: 0.14, nationalEnvironment: 0.05, candidateContext: 0.08, finance: 0.01 }
    : { ratings: 0.5, polling: 0, structural: 0.33, nationalEnvironment: 0.07, candidateContext: 0.09, finance: 0.01 };
  const inputs = {
    ratings: ratingMean(rating),
    polling: Number.isFinite(pollAverage) ? pollAverage : 0,
    structural,
    nationalEnvironment: national,
    candidateContext: candidate,
    finance
  };
  let mean = 0;
  const components = [];
  for (const [key, value] of Object.entries(inputs)) {
    mean += value * (weights[key] || 0);
    if ((weights[key] || 0) > 0) components.push({ input: key, value: round(value, 2), weight: weights[key] });
  }
  if (rating?.startsWith("Safe") && Math.abs(mean) < 14) mean = Math.sign(ratingMean(rating) || mean || 1) * 14;
  if (rating?.startsWith("Likely") && Math.abs(mean) < 7.5) mean = Math.sign(ratingMean(rating) || mean || 1) * 7.5;
  return { mean: clamp(mean, -30, 30), weights, components };
}

function updateRace(seed, indexes, race) {
  const ratingInfo = ratingsPriorForRace(indexes.ratings, "governor", race);
  const rating = normalizeRating(ratingInfo.rating || race.modelRating || race.rating)
    || ratingFromMargin(Number(race.margin ?? race.projectedMargin ?? 0));
  const pollRows = rowsForRace(indexes.polls, "governor", race);
  const financeRow = financeForRace(indexes.finance, "governor", race);
  const pollMeta = pollingMetadata(pollRows);
  const financeMeta = financeMetadata(financeRow);
  const meanInfo = governorMean(seed, race, rating, pollRows, financeRow);
  const sigma = clamp(ratingSigma(rating) + (pollRows.length ? -0.35 : 0.75), 4.5, 10);
  const demProbability = probabilityFromMargin(meanInfo.mean, sigma);
  const repProbability = round(1 - demProbability, 6);
  const marginConfidence = pollRows.length ? "MEDIUM" : "LOW";
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
    fundamentalsMargin: round(governorStructuralInput(race), 2),
    projectedResultMargin: marginRecord(meanInfo.mean, "v3 Governor projected result margin", marginConfidence),
    probabilityMargin: marginRecord(meanInfo.mean, "v3 Governor probability margin", marginConfidence),
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
    sourceInputs: {
      ...(cleaned.sourceInputs || {}),
      pollMargin: {
        value: pollMeta.validatedPollCount ? round(averagePollMargin(pollRows), 2) : null,
        usableAsGeneralElectionPoll: pollMeta.validatedPollCount > 0,
        source: "data/staging/polls/live-general-ledger-v3.json"
      }
    },
    sourceHealth: sourceHealthForPolling(pollMeta, [
      financeMeta.active ? "active race-level finance available" : "finance inactive"
    ]),
    confidence: splitConfidence(demProbability, marginConfidence, dataConfidence),
    modelConfidence: dataConfidence,
    marginDecomposition: {
      ...(race.marginDecomposition || {}),
      v3Components: meanInfo.components,
      guardrailReason: pollMeta.validatedPollCount
        ? "Validated v3 governor poll rows blended with fundamentals."
        : "No validated governor poll rows; forecast relies on ratings and fundamentals."
    },
    dataQualityFlags: [
      ...(Array.isArray(race.dataQualityFlags) ? race.dataQualityFlags : []),
      ...(pollMeta.validatedPollCount ? [] : ["NO_VALIDATED_LIVE_GOVERNOR_POLL"])
    ]
  };
}

function governorProvenanceDiagnostics(races, pollLedger) {
  const governorPollRaceIds = new Set(pollLedger.rows.filter((row) => row.office === "governor").map((row) => row.canonicalRaceId));
  const inconsistent = races.filter((race) => {
    const hasLedgerRows = governorPollRaceIds.has(`${race.state}-GOV-2026`);
    const saysUsable = race.usablePollCount > 0 || /LIVE_POLLS_AVAILABLE|MANUAL_POLLS_AVAILABLE/.test(String(race.pollingStatus));
    return hasLedgerRows !== saysUsable;
  });
  return {
    schemaVersion: "v3",
    generatedAt: new Date().toISOString(),
    validatedGovernorPollRows: pollLedger.rows.filter((row) => row.office === "governor").length,
    governorRacesWithValidatedPolls: governorPollRaceIds.size,
    raceCount: races.length,
    inconsistentClaims: inconsistent.map((race) => ({
      state: race.state,
      pollingStatus: race.pollingStatus,
      usablePollCount: race.usablePollCount
    })),
    status: inconsistent.length ? "FAIL" : "PASS"
  };
}

export async function main() {
  const trustLedgers = buildTrustLedgersV3();
  const seed = readForecastSeed("data/governor-forecast.json", "data/legacy/governor-forecast-v2-snapshot.json");
  const indexes = {
    polls: indexByAliases(trustLedgers.polls.rows),
    ratings: indexByAliases(trustLedgers.ratings.rows),
    finance: indexByAliases(trustLedgers.finance.rows)
  };
  const races = (seed.races || []).map((race) => updateRace(seed, indexes, race));
  const draft = { ...seed, races };
  const simulation = simulateGovernorV3(draft, { iterations: seed.settings?.simulations || 100000 });
  const diagnostics = governorProvenanceDiagnostics(races, trustLedgers.polls);
  const projectedDemRaceWins = round(races.reduce((sum, race) => sum + race.demProbability, 0), 2);
  const projectedRepRaceWins = round(races.length - projectedDemRaceWins, 2);
  const output = updateCommonTopLevel(draft, "governor", trustLedgers, {
    forecastStatus: diagnostics.governorRacesWithValidatedPolls <= 1 ? "REVIEW_LIMITED_VALIDATED_GOVERNOR_POLLS" : "REVIEW_VALIDATED_POLL_BLEND",
    topLevel: {
      generationMode: seed.generationMode || "PARTIAL_NETWORK",
      sourceHealth: {
        ...(seed.sourceHealth || {}),
        health: diagnostics.governorRacesWithValidatedPolls <= 1 ? "DEGRADED" : "HEALTHY",
        degraded: diagnostics.governorRacesWithValidatedPolls <= 1,
        reasons: diagnostics.governorRacesWithValidatedPolls <= 1
          ? ["Governor v3 has limited validated race polling; most races are fundamentals/ratings forecasts."]
          : ["Governor v3 uses validated poll ledger rows."]
      },
      projectedDemRaceWins,
      projectedRepRaceWins,
      averageDemGovernors: projectedDemRaceWins,
      averageRepGovernors: projectedRepRaceWins,
      medianDemGovernors: simulation.medianDemSeats,
      medianRepGovernors: simulation.medianRepSeats,
      distribution: simulation.distribution,
      simulationDiagnostics: {
        v3: simulation
      },
      racePollCoverage: {
        usablePollRaces: diagnostics.governorRacesWithValidatedPolls,
        usablePollRows: diagnostics.validatedGovernorPollRows,
        source: "data/staging/polls/live-general-ledger-v3.json"
      },
      modelWarnings: [
        ...(Array.isArray(seed.modelWarnings) ? seed.modelWarnings : []),
        ...(diagnostics.governorRacesWithValidatedPolls <= 1 ? ["Governor v3 has one or fewer races with validated polling rows."] : [])
      ]
    }
  });
  writeJson("data/governor-forecast.json", output);
  writeJson("data/diagnostics/governor-provenance-consistency-v3-2026.json", diagnostics);
  console.log(`Governor v3 forecast written: ${projectedDemRaceWins} D race wins expected, ${diagnostics.validatedGovernorPollRows} validated poll rows.`);
}

moduleMain(import.meta.url, main);
