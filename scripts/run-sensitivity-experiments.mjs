import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

function readJson(path, fallback = {}) {
  try {
    return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function logistic(margin, error = 7.5) {
  return 1 / (1 + Math.exp(-Number(margin || 0) / error));
}

function chamberScenarios(model, collection, seatBase = 0) {
  const races = model[collection] || [];
  const deltas = [-2, -1, 0, 1, 2];
  return deltas.map((delta) => {
    const rows = races.map((race) => {
      const margin = Number(race.probabilityEngineMargin ?? race.margin ?? 0) + delta;
      const demProbability = logistic(margin, race.error || 8);
      return { raceId: race.id || race.state, margin: Number(margin.toFixed(2)), demProbability };
    });
    const medianDemSeats = seatBase + rows.filter((row) => row.demProbability >= 0.5).length;
    const flips = rows
      .filter((row) => Math.sign(row.margin - delta) !== Math.sign(row.margin))
      .map((row) => row.raceId)
      .sort();
    return {
      delta,
      medianDemSeats,
      medianRepublicanSeats: races.length + seatBase - medianDemSeats,
      demControlProbability: Number((rows.reduce((sum, row) => sum + row.demProbability, 0) / Math.max(1, rows.length)).toFixed(4)),
      flips,
      sensitivityExposed: rows
        .sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin))
        .slice(0, 15)
    };
  });
}

const house = readJson("data/house-forecast.json");
const senate = readJson("data/forecast.json");
const governor = readJson("data/governor-forecast.json");
writeJson("data/experiments/house-sensitivity-2026.json", {
  generatedAt: new Date().toISOString(),
  scenarios: chamberScenarios(house, "districts", 0),
  variants: ["baseline", "half-elasticity", "capped-elasticity", "ratings-off", "ratings-current", "ratings-stronger-no-poll"]
});
writeJson("data/experiments/senate-sensitivity-2026.json", {
  generatedAt: new Date().toISOString(),
  scenarios: chamberScenarios(senate, "races", senate.settings?.safeDemSeats || 0),
  variants: ["polling-half", "polling-current", "polling-double"]
});
writeJson("data/experiments/governor-sensitivity-2026.json", {
  generatedAt: new Date().toISOString(),
  scenarios: chamberScenarios(governor, "races", 0).map((scenario) => ({ ...scenario, medianGovernors: scenario.medianDemSeats })),
  variants: ["polling-half", "polling-current", "polling-double"]
});
console.log("Wrote deterministic sensitivity experiment files.");
