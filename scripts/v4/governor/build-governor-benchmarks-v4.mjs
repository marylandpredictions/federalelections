import { artifactHeader, readLatestManifestOrCreate, writeJson } from "../shared/v4-core.mjs";

export function buildGovernorBenchmarksV4(manifest = readLatestManifestOrCreate()) {
  const benchmarks = {
    ...artifactHeader(manifest, "governor-benchmarks"),
    quantitativeToplines: {
      voteHub: {
        status: "BENCHMARK_UNAVAILABLE",
        sourceType: "publicQuantitative",
        demFavoredRaces: null,
        repFavoredRaces: null
      }
    },
    expertRatings: {
      cook: { status: "BENCHMARK_UNAVAILABLE" },
      insideElections: { status: "BENCHMARK_UNAVAILABLE" },
      sabato: { status: "BENCHMARK_UNAVAILABLE" },
      consensus270: { status: "BENCHMARK_UNAVAILABLE" }
    },
    predictionMarkets: {
      kalshi: { status: "OPTIONAL_UNAVAILABLE" },
      polymarket: { status: "OPTIONAL_UNAVAILABLE" }
    }
  };
  writeJson("data/v4/benchmarks/governor-benchmarks.json", benchmarks);
  return benchmarks;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  console.log(buildGovernorBenchmarksV4().quantitativeToplines.voteHub.status);
}
