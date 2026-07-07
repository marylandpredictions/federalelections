import { artifactHeader, buildForecastArtifact, readJson, readLatestManifestOrCreate, summarizeRows, writeJson } from "../shared/v4-core.mjs";
import { acquireCurrentMapBaselinesV4 } from "./acquire-current-map-baselines-v4.mjs";

export function buildHouseForecastV4(manifest = readLatestManifestOrCreate()) {
  const baselineLedger = readJson("data/v4/house/current-map-baseline-ledger.json") || acquireCurrentMapBaselinesV4(manifest);
  const verifiedAnchors = baselineLedger.counts?.verifiedCurrentMapAnchors || 0;
  const mode = verifiedAnchors > 0 ? "CURRENT_MAP_PRES_LEAN_WITH_RATINGS_PRIOR" : "RATINGS_FIRST_NO_CURRENT_MAP_BASELINES";
  const artifact = buildForecastArtifact("house", "data/house-forecast.json", "data/v4/house-forecast.json", manifest, {
    houseMode: mode,
    currentMapBaselineCoverage: baselineLedger.counts,
    publishCaveat: verifiedAnchors > 0
      ? "House v4 has some verified current-map anchors, but release gates still decide publish status."
      : "House v4 is ratings-first/internal QA because no verified current-map House anchors are available."
  });
  const diagnostics = {
    ...artifactHeader(manifest, "house-diagnostics"),
    sourceForecast: "data/v4/house-forecast.json",
    houseMode: mode,
    summary: summarizeRows(artifact.races),
    warnings: verifiedAnchors > 0 ? [] : ["HOUSE_NO_CURRENT_MAP_BASELINES"],
    rowHashes: artifact.races.map((row) => ({ raceId: row.raceId, rowHash: row.rowHash, evidenceHash: row.evidenceHash }))
  };
  writeJson("data/v4/diagnostics/house-diagnostics.json", diagnostics);
  return artifact;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const artifact = buildHouseForecastV4();
  console.log(`v4 house forecast rows: ${artifact.races.length}; mode=${artifact.houseMode}`);
}
