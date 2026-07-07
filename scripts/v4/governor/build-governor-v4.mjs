import { artifactHeader, buildForecastArtifact, readLatestManifestOrCreate, summarizeRows, writeJson } from "../shared/v4-core.mjs";

export function buildGovernorForecastV4(manifest = readLatestManifestOrCreate()) {
  const artifact = buildForecastArtifact("governor", "data/governor-forecast.json", "data/v4/governor-forecast.json", manifest, {
    governorMode: "CANONICAL_ROW_REBUILD_FROM_TRANSITIONAL_SOURCE",
    publishCaveat: "Governor v4 rebuilds the publish contract from canonical rows and evidence ledgers; release gates decide publish status."
  });
  const diagnostics = {
    ...artifactHeader(manifest, "governor-diagnostics"),
    sourceForecast: "data/v4/governor-forecast.json",
    summary: summarizeRows(artifact.races),
    warnings: artifact.races.some((row) => row.evidence.polling.status === "NO_VALIDATED_POLLING") ? ["SOME_RACES_NO_VALIDATED_POLLING"] : [],
    rowHashes: artifact.races.map((row) => ({ raceId: row.raceId, rowHash: row.rowHash, evidenceHash: row.evidenceHash }))
  };
  writeJson("data/v4/diagnostics/governor-diagnostics.json", diagnostics);
  return artifact;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  const artifact = buildGovernorForecastV4();
  console.log(`v4 governor forecast rows: ${artifact.races.length}`);
}
