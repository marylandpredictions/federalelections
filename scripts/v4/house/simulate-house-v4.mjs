import { readJson, readLatestManifestOrCreate, writeJson, artifactHeader } from "../shared/v4-core.mjs";

export function simulateHouseV4(manifest = readLatestManifestOrCreate()) {
  const forecast = readJson("data/v4/house-forecast.json", { races: [] });
  const expectedD = forecast.topline?.expectedSeatsOrWins?.D || 0;
  const expectedR = forecast.topline?.expectedSeatsOrWins?.R || 0;
  const simulation = {
    ...artifactHeader(manifest, "house-simulation"),
    sourceForecast: "data/v4/house-forecast.json",
    status: forecast.houseMode === "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES" ? "INTERNAL_QA_ONLY" : "AVAILABLE",
    expectedSeatsOrWins: { D: expectedD, R: expectedR, other: 0 },
    note: "Deterministic v4 placeholder simulation. Monte Carlo tuning is intentionally deferred until v4 publish gates are reliable."
  };
  writeJson("data/v4/diagnostics/house-simulation.json", simulation);
  return simulation;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  console.log(simulateHouseV4().status);
}
