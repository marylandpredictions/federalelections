import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);

function readJson(path, fallback = null) {
  try {
    const url = new URL(path, ROOT);
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch (error) {
    return { readError: error.message };
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const gates = readJson("data/diagnostics/release-gates-2026.json", {});
const output = {
  schemaVersion: "2026.ui-health-v2.1",
  generatedAt: new Date().toISOString(),
  releaseGateStatus: gates.status || "UNKNOWN",
  forecastGeneratedAt: gates.forecastGeneratedAt || {},
  cards: [
    { id: "upstream-polls", label: "Upstream validated polls", value: gates.upstreamPollCounts || {}, status: gates.gates?.find((gate) => gate.name === "upstream-polls-only")?.status || "UNKNOWN" },
    { id: "house-baselines", label: "House current-map baseline coverage", value: gates.houseVerifiedCurrentMapBaselineCoverage ?? null, status: gates.gates?.find((gate) => gate.name === "house-current-map-baseline-coverage")?.status || "UNKNOWN" },
    { id: "benchmark-divergence", label: "Benchmark divergence", value: gates.benchmarkDivergenceSummary || {}, status: Object.values(gates.benchmarkDivergenceSummary || {}).some((value) => Number(value) > 8) ? "REVIEW" : "OK" }
  ],
  manualReviewTop15: gates.manualReviewTop15 || []
};

writeJson("data/diagnostics/ui-health-2026.json", output);
console.log(`Wrote UI health diagnostics (${output.releaseGateStatus}).`);
