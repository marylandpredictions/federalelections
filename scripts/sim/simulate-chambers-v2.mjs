import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);
const RUNS = Number(process.env.SIMULATION_RUNS || 100000);
const SEED = Number(process.env.SIMULATION_SEED || 20260707);

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

function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function normal(random) {
  const u = Math.max(1e-9, random());
  const v = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function raceRows(payload, key) {
  return (payload?.[key] || []).map((race) => ({
    id: race.id || race.state || race.district,
    state: race.state || null,
    demProbability: Number(race.demProbability ?? race.demWinProbability ?? race.probability ?? 0.5),
    projectedResultMargin: Number(race.projectedResultMargin ?? race.margin ?? 0),
    probabilityMargin: Number(race.probabilityEngineMargin ?? race.probabilityMargin ?? race.margin ?? 0),
    uncertaintySigma: Number(race.error ?? race.uncertaintySigma ?? race.uncertainty ?? 6)
  })).filter((race) => race.id);
}

function simulateOffice({ office, path, key, totalSeats, demBase = 0, controlThreshold }) {
  const payload = readJson(path, {});
  const races = raceRows(payload, key);
  const random = mulberry32(SEED + office.length);
  const buckets = new Map();
  let demControlWins = 0;

  for (let run = 0; run < RUNS; run += 1) {
    const nationalShock = normal(random) * 2.8;
    let demSeats = demBase;
    for (const race of races) {
      const raceShock = normal(random) * Math.max(1, race.uncertaintySigma);
      const margin = race.projectedResultMargin + nationalShock + raceShock;
      if (margin > 0) demSeats += 1;
    }
    buckets.set(demSeats, (buckets.get(demSeats) || 0) + 1);
    if (demSeats >= controlThreshold) demControlWins += 1;
  }

  const distribution = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([seats, count]) => ({
    demSeats: seats,
    probability: Number((count / RUNS).toFixed(6))
  }));

  return {
    office,
    source: path,
    metadata: {
      runs: RUNS,
      nationalSd: 2.8,
      structuredSd: 1.5,
      residualSd: "race.uncertaintySigma",
      calibrationVersion: "simulation-v2-shadow.1",
      randomSeed: SEED,
      separatesProjectedResultMarginFromProbabilityMargin: true
    },
    races: races.length,
    totalSeats,
    demBase,
    controlThreshold,
    demControlProbability: Number((demControlWins / RUNS).toFixed(6)),
    distribution
  };
}

const output = {
  schemaVersion: "2026.chamber-simulation-v2.1",
  generatedAt: new Date().toISOString(),
  simulations: [
    simulateOffice({ office: "senate", path: "data/forecast.json", key: "races", totalSeats: 100, demBase: 0, controlThreshold: 50 }),
    simulateOffice({ office: "house", path: "data/house-forecast.json", key: "districts", totalSeats: 435, demBase: 0, controlThreshold: 218 }),
    simulateOffice({ office: "governor", path: "data/governor-forecast.json", key: "races", totalSeats: 36, demBase: 0, controlThreshold: 19 })
  ]
};

writeJson("data/diagnostics/chamber-simulation-v2-2026.json", output);
console.log(`Wrote simulation v2 diagnostics for ${output.simulations.length} offices.`);
