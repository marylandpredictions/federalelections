import {
  moduleMain,
  readJson,
  runSeatSimulation,
  writeJson
} from "./forecast-kernel-v3.mjs";

export function simulateHouseV3(houseForecast, options = {}) {
  return runSeatSimulation(houseForecast.districts || [], (district) => district.demProbability, {
    iterations: options.iterations || houseForecast.settings?.simulations || 100000,
    threshold: 218,
    totalSeats: 435
  });
}

export function simulateSenateV3(senateForecast, options = {}) {
  const races = senateForecast.races || [];
  const baseSeats = Number(senateForecast.settings?.safeDemSeats ?? 34);
  const threshold = Number(senateForecast.settings?.demControlThreshold ?? 50);
  return runSeatSimulation(races, (race) => race.demProbability, {
    iterations: options.iterations || senateForecast.settings?.simulations || 100000,
    baseSeats,
    threshold,
    totalSeats: 100
  });
}

export function simulateGovernorV3(governorForecast, options = {}) {
  const races = governorForecast.races || [];
  return runSeatSimulation(races, (race) => race.demProbability, {
    iterations: options.iterations || governorForecast.settings?.simulations || 100000,
    threshold: Math.floor(races.length / 2) + 1,
    totalSeats: races.length
  });
}

export async function main() {
  const house = readJson("data/house-forecast.json");
  const senate = readJson("data/forecast.json");
  const governor = readJson("data/governor-forecast.json");
  const diagnostics = {
    schemaVersion: "v3",
    generatedAt: new Date().toISOString(),
    house: house ? simulateHouseV3(house) : null,
    senate: senate ? simulateSenateV3(senate) : null,
    governor: governor ? simulateGovernorV3(governor) : null,
    notes: [
      "Simulator uses the public displayed race/district probabilities as inputs.",
      "No hidden partisan intercept or alternative mean is applied."
    ]
  };
  writeJson("data/diagnostics/simulation-calibration-v3-2026.json", diagnostics);
  console.log("Wrote data/diagnostics/simulation-calibration-v3-2026.json");
}

moduleMain(import.meta.url, main);
