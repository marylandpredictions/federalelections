import { artifactHeader, readJson, readLatestManifestOrCreate, writeJson } from "../shared/v4-core.mjs";

export function buildHouseReviewV4(manifest = readLatestManifestOrCreate()) {
  const forecast = readJson("data/v4/house-forecast.json", { races: [] });
  const rows = forecast.races.map((row) => ({
    raceId: row.raceId,
    runId: manifest.runId,
    sourceForecastRowHash: row.rowHash,
    projectedResultMargin: row.projectedResultMargin.display,
    probabilityMargin: row.probabilityMargin.display,
    pollingStatus: row.evidence.polling.status,
    financeStatus: row.evidence.finance.status,
    candidateStatus: row.evidence.candidate.status,
    reviewFlags: [
      forecast.houseMode === "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES" ? "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES" : null,
      row.evidence.baseline.usedInModel ? null : "NO_VERIFIED_CURRENT_MAP_BASELINE",
      row.evidence.polling.usedInModel ? null : "NO_VALIDATED_POLLING"
    ].filter(Boolean)
  }));
  const review = {
    ...artifactHeader(manifest, "house-review"),
    sourceForecast: "data/v4/house-forecast.json",
    rows
  };
  writeJson("data/v4/diagnostics/house-review.json", review);
  return review;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  console.log(`v4 house review rows: ${buildHouseReviewV4().rows.length}`);
}
