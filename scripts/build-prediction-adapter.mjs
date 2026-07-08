import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const generatedAt = new Date().toISOString();

const OUTPUTS = [
  {
    key: "2026-senate",
    office: "senate",
    cycle: "2026",
    title: "2026 Senate Predictions",
    sourcePath: "data/v4/senate-forecast.json",
    outputPath: "data/predictions/2026-senate-predictions.json",
    modelLabPath: "/model-lab/2026/senate"
  },
  {
    key: "2026-house",
    office: "house",
    cycle: "2026",
    title: "2026 House Predictions",
    sourcePath: "data/v4/house-forecast.json",
    outputPath: "data/predictions/2026-house-predictions.json",
    modelLabPath: "/model-lab/2026/house"
  },
  {
    key: "2026-governor",
    office: "governor",
    cycle: "2026",
    title: "2026 Governor Predictions",
    sourcePath: "data/v4/governor-forecast.json",
    outputPath: "data/predictions/2026-governor-predictions.json",
    modelLabPath: "/model-lab/2026/governor"
  }
];

const VALID_RATINGS = new Set([
  "Safe D", "Likely D", "Lean D", "Tilt D", "Toss-up",
  "Tilt R", "Lean R", "Likely R", "Safe R",
  "Safe I", "Likely I", "Lean I", "Tilt I"
]);

function partyName(party) {
  if (party === "D") return "Democratic";
  if (party === "R") return "Republican";
  if (party === "I") return "Independent";
  return "Other";
}

function normalizeCandidate(value, party) {
  if (value && typeof value === "object") {
    return {
      name: String(value.name || value.candidate || partyName(party)),
      party,
      incumbent: Boolean(value.incumbent),
      status: value.status || ""
    };
  }
  const text = String(value || "").trim();
  return {
    name: text && text.toLowerCase() !== "none" ? text : partyName(party),
    party,
    incumbent: false,
    status: ""
  };
}

function projectedMargin(row = {}) {
  const source = row.projectedResultMargin || row.probabilityMargin || {};
  const raw = Number(source.signedValue ?? source.value ?? row.margin ?? 0);
  if (!Number.isFinite(raw)) return 0;
  if (source.signedValue !== undefined) return raw;
  if (source.party === "R") return -Math.abs(raw);
  if (source.party === "D") return Math.abs(raw);
  if (row.expectedWinner === "R") return -Math.abs(raw);
  return raw;
}

function ratingFromMargin(signedMargin) {
  const value = Math.abs(Number(signedMargin) || 0);
  const party = signedMargin > 0 ? "D" : signedMargin < 0 ? "R" : "";
  if (value < 1 || !party) return "Toss-up";
  if (value < 3) return `Tilt ${party}`;
  if (value < 7) return `Lean ${party}`;
  if (value < 12) return `Likely ${party}`;
  return `Safe ${party}`;
}

function winnerFromRow(row, signedMargin) {
  const expected = String(row.expectedWinner || "").toUpperCase();
  if (["D", "R", "I"].includes(expected)) return expected;
  if (Math.abs(Number(signedMargin) || 0) < 1) return "Toss-up";
  return signedMargin > 0 ? "D" : "R";
}

function confidenceFromEvidence(row = {}) {
  const evidence = row.evidence || {};
  const pollingRows = Number(evidence.polling?.validatedRows || 0);
  const financeRows = Number(evidence.finance?.activeRows || 0);
  const hasBaseline = Boolean(evidence.baseline?.usedInModel);
  const hasRatings = Boolean(evidence.ratings?.usedInModel || row.ratingsPrior?.status === "AVAILABLE");
  if (pollingRows >= 3 && (hasBaseline || financeRows > 0)) return "high";
  if (pollingRows > 0 || hasRatings || hasBaseline || financeRows > 0) return "medium";
  return "low";
}

function modelSignal(row = {}) {
  const parts = [];
  const rating = row.evidence?.ratings?.consensusRating || row.ratingsPrior?.consensusRating;
  const margin = row.projectedResultMargin?.display || row.probabilityMargin?.display;
  const probs = row.probabilities || {};
  if (rating) parts.push(`model rating ${rating}`);
  if (margin) parts.push(`model margin ${margin}`);
  if (Number.isFinite(Number(probs.D)) && Number.isFinite(Number(probs.R))) {
    parts.push(`model probability D ${(Number(probs.D) * 100).toFixed(1)} / R ${(Number(probs.R) * 100).toFixed(1)}`);
  }
  return parts.join("; ");
}

function mergeRace(seed, existing) {
  if (!existing) return seed;
  return {
    ...seed,
    ...existing,
    prediction: {
      ...seed.prediction,
      ...(existing.prediction || {})
    },
    candidates: {
      ...seed.candidates,
      ...(existing.candidates || {})
    },
    notes: {
      ...seed.notes,
      ...(existing.notes || {})
    },
    sources: Array.isArray(existing.sources) ? existing.sources : seed.sources,
    modelReference: seed.modelReference
  };
}

function raceSeed(row, meta) {
  const signedMargin = projectedMargin(row);
  const rating = VALID_RATINGS.has(row.evidence?.ratings?.consensusRating)
    ? row.evidence.ratings.consensusRating
    : ratingFromMargin(signedMargin);
  const candidates = {
    D: normalizeCandidate(row.candidates?.D, "D"),
    R: normalizeCandidate(row.candidates?.R, "R")
  };
  const other = normalizeCandidate(row.candidates?.other, "I");
  if (other.name && other.name.toLowerCase() !== "none" && other.name !== "Independent") {
    candidates.I = other;
  }
  return {
    raceId: String(row.raceId || `${row.state}-${meta.office}-${meta.cycle}`).toUpperCase(),
    office: meta.office,
    cycle: meta.cycle,
    state: row.state || "",
    district: row.district ?? null,
    displayName: row.displayName || `${row.state || ""} ${meta.office}`.trim(),
    prediction: {
      rating,
      winner: winnerFromRow(row, signedMargin),
      projectedMargin: Number(Math.abs(signedMargin).toFixed(1)),
      confidence: confidenceFromEvidence(row),
      status: "published"
    },
    candidates,
    notes: {
      short: "",
      long: "",
      whyWeRateItThisWay: "",
      modelSignal: modelSignal(row),
      benchmarkComparison: ""
    },
    sources: [],
    lastEdited: generatedAt,
    lastEditedBy: "Prediction adapter seed",
    modelReference: {
      sourceRunId: meta.sourceRunId,
      modelLabPath: meta.modelLabPath,
      expectedWinner: row.expectedWinner || "",
      projectedResultMargin: row.projectedResultMargin || null,
      probabilities: row.probabilities || null,
      evidence: row.evidence || null,
      rowHash: row.rowHash || ""
    }
  };
}

async function readJson(relativePath, fallback = null) {
  try {
    return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(relativePath, payload) {
  const filePath = resolve(root, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function summarizeRaces(races = []) {
  const counts = { D: 0, R: 0, I: 0, "Toss-up": 0, Uncalled: 0 };
  const ratings = {};
  for (const race of races) {
    const winner = race.prediction?.winner || "Uncalled";
    counts[winner] = (counts[winner] || 0) + 1;
    const rating = race.prediction?.rating || "Unrated";
    ratings[rating] = (ratings[rating] || 0) + 1;
  }
  return { counts, ratings, raceCount: races.length };
}

async function buildChamber(meta) {
  const source = await readJson(meta.sourcePath, { races: [], topline: {} });
  const existing = await readJson(meta.outputPath, null);
  const existingById = new Map((existing?.races || []).map((race) => [String(race.raceId), race]));
  const races = (source.races || []).map((row) => {
    const seed = raceSeed(row, { ...meta, sourceRunId: source.runId || source.generatedAt || "" });
    return mergeRace(seed, existingById.get(seed.raceId));
  });
  const payload = {
    schemaVersion: "team-predictions-v1",
    pageStatus: existing?.pageStatus || "Published",
    key: meta.key,
    office: meta.office,
    cycle: meta.cycle,
    title: meta.title,
    generatedAt,
    lastPublishedAt: existing?.lastPublishedAt || generatedAt,
    sourceModelRunId: source.runId || source.generatedAt || "",
    modelLabPath: meta.modelLabPath,
    publicMethodologyPath: "/predictions/methodology",
    summary: {
      ...summarizeRaces(races),
      topline: source.topline || {}
    },
    notes: {
      publicSummary: existing?.notes?.publicSummary || "FEA Team Predictions are manually editable race ratings informed by public evidence and internal model diagnostics.",
      methodologyNote: existing?.notes?.methodologyNote || "The automated model is used as a diagnostic reference, not as the final public prediction authority."
    },
    races
  };
  await writeJson(meta.outputPath, payload);
  return { key: meta.key, outputPath: meta.outputPath, raceCount: races.length };
}

async function buildPresident() {
  const sourcePath = "data/president-forecast.json";
  const outputPath = "data/predictions/2028-presidential-predictions.json";
  const source = await readJson(sourcePath, { matchups: [] });
  const existing = await readJson(outputPath, null);
  const existingById = new Map((existing?.races || []).map((race) => [String(race.raceId), race]));
  const races = (source.matchups || []).map((matchup) => {
    const signed = Number(matchup.demWinProbability || 0) >= Number(matchup.repWinProbability || 0)
      ? Math.max(1, Math.abs(Number(matchup.demWinProbability || 0.5) - 0.5) * 40)
      : -Math.max(1, Math.abs(Number(matchup.repWinProbability || 0.5) - 0.5) * 40);
    const raceId = `PRES-2028-${String(matchup.demCandidate || "DEM").toUpperCase()}-${String(matchup.repCandidate || "REP").toUpperCase()}`;
    const seed = {
      raceId,
      office: "president",
      cycle: "2028",
      state: "US",
      district: null,
      displayName: `${matchup.demCandidateName || "Democrat"} vs. ${matchup.repCandidateName || "Republican"}`,
      prediction: {
        rating: ratingFromMargin(signed),
        winner: signed >= 0 ? "D" : "R",
        projectedMargin: Number(Math.abs(signed).toFixed(1)),
        confidence: "low",
        status: "published"
      },
      candidates: {
        D: { name: matchup.demCandidateName || "Democrat", party: "D", incumbent: false, status: "" },
        R: { name: matchup.repCandidateName || "Republican", party: "R", incumbent: false, status: "" }
      },
      notes: {
        short: "",
        long: "",
        whyWeRateItThisWay: "",
        modelSignal: `model probability D ${(Number(matchup.demWinProbability || 0) * 100).toFixed(1)} / R ${(Number(matchup.repWinProbability || 0) * 100).toFixed(1)}; expected EV D ${matchup.demExpectedEV ?? "--"} / R ${matchup.repExpectedEV ?? "--"}`,
        benchmarkComparison: ""
      },
      sources: [],
      lastEdited: generatedAt,
      lastEditedBy: "Prediction adapter seed",
      modelReference: {
        sourceRunId: source.generatedAt || source.modelDate || "",
        modelLabPath: "/model-lab/2028/president",
        probabilities: { D: matchup.demWinProbability, R: matchup.repWinProbability },
        expectedEV: { D: matchup.demExpectedEV, R: matchup.repExpectedEV }
      }
    };
    return mergeRace(seed, existingById.get(raceId));
  });
  const payload = {
    schemaVersion: "team-predictions-v1",
    pageStatus: existing?.pageStatus || "Published",
    key: "2028-president",
    office: "president",
    cycle: "2028",
    title: "2028 Presidential Predictions",
    generatedAt,
    lastPublishedAt: existing?.lastPublishedAt || generatedAt,
    sourceModelRunId: source.generatedAt || source.modelDate || "",
    modelLabPath: "/model-lab/2028/president",
    publicMethodologyPath: "/predictions/methodology",
    summary: {
      ...summarizeRaces(races),
      national: source.national || {},
      electoralCollege: source.electoralCollege || {}
    },
    notes: {
      publicSummary: existing?.notes?.publicSummary || "FEA Team Predictions for 2028 presidential matchups are manually editable and treated separately from internal model diagnostics.",
      methodologyNote: existing?.notes?.methodologyNote || "The automated presidential model is an internal reference only."
    },
    races
  };
  await writeJson(outputPath, payload);
  return { key: "2028-president", outputPath, raceCount: races.length };
}

async function main() {
  await mkdir(resolve(root, "data/predictions/county-predictions"), { recursive: true });
  await mkdir(resolve(root, "data/predictions/drafts"), { recursive: true });
  await mkdir(resolve(root, "data/predictions/history"), { recursive: true });

  const outputs = [];
  for (const meta of OUTPUTS) outputs.push(await buildChamber(meta));
  outputs.push(await buildPresident());
  await writeJson("data/predictions/prediction-adapter.json", {
    schemaVersion: "prediction-adapter-v1",
    generatedAt,
    outputs,
    note: "Generated from Model Lab outputs as an editable seed. Existing manual prediction fields are preserved by raceId."
  });
  console.log(`Built ${outputs.length} prediction files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
