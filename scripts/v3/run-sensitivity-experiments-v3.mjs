import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../../", import.meta.url);

const HOUSE_VARIANTS = [
  { id: "house_ratings_only", type: "ratingsOnly" },
  { id: "house_verified_baselines_only", type: "verifiedBaselinesOnly" },
  { id: "house_no_baselines", type: "noBaselines" },
  { id: "house_no_finance", type: "noFinance" },
  { id: "house_low_uncertainty", type: "uncertainty", sigmaScale: 0.82 },
  { id: "house_medium_uncertainty", type: "uncertainty", sigmaScale: 1 },
  { id: "house_high_uncertainty", type: "uncertainty", sigmaScale: 1.22 }
];

const SENATE_VARIANTS = [
  { id: "senate_no_polling", type: "noPolling" },
  { id: "senate_no_exceptions", type: "noExceptions" },
  { id: "senate_exception_capped", type: "capExceptions", cap: 1.5 }
];

const GOVERNOR_VARIANTS = [
  { id: "governor_no_polling", type: "noPolling" },
  { id: "governor_no_exceptions", type: "noExceptions" }
];

function readJson(path, fallback = {}) {
  try {
    return JSON.parse(readFileSync(new URL(path, ROOT), "utf8"));
  } catch (error) {
    return { ...fallback, readError: error.message };
  }
}

function writeJson(path, value) {
  const url = new URL(path, ROOT);
  mkdirSync(dirname(fileURLToPath(url)), { recursive: true });
  writeFileSync(url, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function demProbFromMargin(margin, sigma = 7.5) {
  const z = Number(margin || 0) / Math.max(2.5, Number(sigma || 7.5));
  return clamp(1 / (1 + Math.exp(-z * 1.7)), 0.001, 0.999);
}

function marginFromItem(item) {
  return Number(item.probabilityEngineMargin ?? item.margin ?? item.projectedMargin ?? item.projectedResultMargin?.value ?? 0);
}

function sigmaFromItem(item, scale = 1) {
  return Math.max(3.5, Number(item.uncertaintySigma ?? item.error ?? item.ratingsPrior?.sigma ?? 7.5) * scale);
}

function ratingMargin(item) {
  const direct = Number(item.ratingMargin?.value);
  if (Number.isFinite(direct)) return direct;
  const prior = Number(item.ratingsPrior?.mean);
  if (Number.isFinite(prior)) return prior;
  return marginFromItem(item);
}

function verifiedBaselineMargin(item) {
  if (item.baselineComparability?.usableAsCurrentMapBaseline === false) return null;
  const direct = Number(item.baselineMargin ?? item.baselineComparability?.margin);
  if (Number.isFinite(direct)) return direct;
  const pres = Number(item.presidentialMargin);
  if (Number.isFinite(pres)) return pres;
  const congressional = Number(item.congressionalMargin);
  if (Number.isFinite(congressional)) return congressional;
  return null;
}

function component(item, name) {
  const found = (item.marginDecomposition?.components || []).find((row) => row.input === name || row.component === name);
  return Number(found?.value ?? found?.margin ?? 0);
}

function variantMargin(item, variant) {
  const base = marginFromItem(item);
  if (variant.type === "ratingsOnly") return ratingMargin(item);
  if (variant.type === "verifiedBaselinesOnly") return verifiedBaselineMargin(item) ?? ratingMargin(item);
  if (variant.type === "noBaselines") {
    const baselineShare = Number(item.inputBalance?.shares?.baseline ?? item.inputBalance?.shares?.structural ?? 0);
    const baseline = verifiedBaselineMargin(item);
    if (!Number.isFinite(baseline) || !baselineShare) return base;
    return base - baseline * baselineShare;
  }
  if (variant.type === "noFinance") return base - component(item, "finance") * Number(item.inputBalance?.shares?.finance ?? 0);
  if (variant.type === "noPolling") {
    const poll = Number(item.sourceInputs?.pollMargin?.value ?? item.pollMargin ?? item.marginDecomposition?.pollingAverage ?? 0);
    const pollShare = Number(item.inputBalance?.shares?.polling ?? 0);
    return base - poll * pollShare;
  }
  if (variant.type === "noExceptions") {
    const candidate = component(item, "candidateContext") || Number(item.candidateException?.adjustment ?? item.candidateEdge ?? 0);
    const candidateShare = Number(item.inputBalance?.shares?.candidateContext ?? item.inputBalance?.shares?.candidate ?? 0);
    return base - candidate * candidateShare;
  }
  if (variant.type === "capExceptions") {
    const candidate = component(item, "candidateContext") || Number(item.candidateException?.adjustment ?? item.candidateEdge ?? 0);
    const capped = clamp(candidate, -Math.abs(variant.cap || 1.5), Math.abs(variant.cap || 1.5));
    const candidateShare = Number(item.inputBalance?.shares?.candidateContext ?? item.inputBalance?.shares?.candidate ?? 0);
    return base - (candidate - capped) * candidateShare;
  }
  return base;
}

function summarizeChamber(label, rows, variants, safeDemSeats = 0, safeRepSeats = 0) {
  const baseRows = rows.map((item) => ({
    id: item.id || item.state || item.raceId,
    margin: marginFromItem(item),
    demProbability: Number(item.demProbability ?? item.winnerProbability ?? demProbFromMargin(marginFromItem(item), sigmaFromItem(item))),
    sigma: sigmaFromItem(item),
    item
  }));
  const baseExpectedDem = safeDemSeats + baseRows.reduce((sum, row) => sum + row.demProbability, 0);
  const baseExpectedRep = safeRepSeats + baseRows.length - baseRows.reduce((sum, row) => sum + row.demProbability, 0);
  return variants.map((variant) => {
    const rowsForVariant = baseRows.map((row) => {
      const margin = variantMargin(row.item, variant);
      const demProbability = demProbFromMargin(margin, sigmaFromItem(row.item, variant.sigmaScale || 1));
      return {
        id: row.id,
        baseMargin: round(row.margin, 2),
        variantMargin: round(margin, 2),
        baseDemProbability: round(row.demProbability, 4),
        variantDemProbability: round(demProbability, 4),
        marginDelta: round(margin - row.margin, 2),
        probabilityDelta: round(demProbability - row.demProbability, 4)
      };
    });
    const expectedDem = safeDemSeats + rowsForVariant.reduce((sum, row) => sum + row.variantDemProbability, 0);
    const expectedRep = safeRepSeats + rowsForVariant.length - rowsForVariant.reduce((sum, row) => sum + row.variantDemProbability, 0);
    return {
      variant: variant.id,
      chamber: label,
      status: "EXECUTED",
      expectedDemSeats: round(expectedDem, 2),
      expectedRepSeats: round(expectedRep, 2),
      expectedDemSeatDelta: round(expectedDem - baseExpectedDem, 2),
      expectedRepSeatDelta: round(expectedRep - baseExpectedRep, 2),
      biggestMarginMoves: rowsForVariant
        .slice()
        .sort((a, b) => Math.abs(b.marginDelta) - Math.abs(a.marginDelta))
        .slice(0, 12),
      mostProbabilitySensitive: rowsForVariant
        .slice()
        .sort((a, b) => Math.abs(b.probabilityDelta) - Math.abs(a.probabilityDelta))
        .slice(0, 12)
    };
  });
}

export function main() {
  const house = readJson("data/house-forecast.json", { districts: [] });
  const senate = readJson("data/forecast.json", { races: [] });
  const governor = readJson("data/governor-forecast.json", { races: [] });
  const output = {
    schemaVersion: "v3",
    generatedAt: new Date().toISOString(),
    note: "Executed sensitivity summaries from the current v3 forecast outputs. These are diagnostic deltas, not alternate published forecasts.",
    base: {
      house: {
        districts: (house.districts || []).length,
        expectedDemSeats: round(house.expectedDemSeats ?? house.averageDemSeats ?? house.demExpectedSeats ?? house.demSeats, 2),
        expectedRepSeats: round(house.expectedRepSeats ?? house.averageRepSeats ?? house.repExpectedSeats ?? house.repSeats, 2),
        forecastStatus: house.forecastStatus
      },
      senate: {
        races: (senate.races || []).length,
        safeDemSeats: senate.settings?.safeDemSeats ?? null,
        safeRepSeats: senate.settings?.safeRepSeats ?? null,
        expectedDemSeats: round(senate.expectedDemSeats ?? senate.averageDemSeats ?? senate.demExpectedSeats ?? senate.demSeats, 2),
        expectedRepSeats: round(senate.expectedRepSeats ?? senate.averageRepSeats ?? senate.repExpectedSeats ?? senate.repSeats, 2),
        forecastStatus: senate.forecastStatus
      },
      governor: {
        races: (governor.races || []).length,
        expectedDemRaceWins: round(governor.projectedDemRaceWins ?? governor.averageDemGovernors, 2),
        expectedRepRaceWins: round(governor.projectedRepRaceWins ?? governor.averageRepGovernors, 2),
        forecastStatus: governor.forecastStatus
      }
    },
    variants: [
      ...summarizeChamber("house", house.districts || [], HOUSE_VARIANTS),
      ...summarizeChamber("senate", senate.races || [], SENATE_VARIANTS, senate.settings?.safeDemSeats || 0, senate.settings?.safeRepSeats || 0),
      ...summarizeChamber("governor", governor.races || [], GOVERNOR_VARIANTS)
    ]
  };
  writeJson("data/diagnostics/sensitivity-experiments-v3-2026.json", output);
  console.log(`Wrote v3 sensitivity diagnostics with ${output.variants.length} executed variants.`);
}

main();
