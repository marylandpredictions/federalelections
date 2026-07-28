import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");

const files = {
  senate: "data/predictions/2026-senate-predictions.json",
  house: "data/predictions/2026-house-predictions.json",
  governor: "data/predictions/2026-governor-predictions.json"
};

const genericNames = new Set(["Democrat", "Republican"]);
const errors = [];
const summary = {};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(root, relativePath), "utf8"));
}

function candidateOrder(candidate) {
  const value = Number(candidate?.order);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function displayCandidates(race) {
  return Object.entries(race.candidates || {})
    .filter(([, candidate]) => candidate && typeof candidate === "object")
    .sort(([, a], [, b]) =>
      candidateOrder(a) - candidateOrder(b)
      || Number(Boolean(b.incumbent)) - Number(Boolean(a.incumbent))
      || String(a.name || "").localeCompare(String(b.name || ""))
    );
}

for (const [office, relativePath] of Object.entries(files)) {
  const data = readJson(relativePath);
  const counts = {
    races: 0,
    candidates: 0,
    incumbents: 0,
    presumptiveNominees: 0,
    genericCandidates: 0
  };

  for (const race of data.races || []) {
    counts.races += 1;
    const candidates = displayCandidates(race);
    if (candidates.length < 2) {
      errors.push(`${office}:${race.raceId} has fewer than two candidates.`);
    }

    const keys = new Set();
    let reachedNonIncumbent = false;
    for (const [key, candidate] of candidates) {
      counts.candidates += 1;
      if (!key || keys.has(key)) errors.push(`${office}:${race.raceId} has an invalid or duplicate candidate key.`);
      keys.add(key);

      if (!String(candidate.name || "").trim()) {
        errors.push(`${office}:${race.raceId}:${key} has no candidate name.`);
      }
      if (!String(candidate.party || "").trim()) {
        errors.push(`${office}:${race.raceId}:${key} has no party.`);
      }
      if (candidate.order !== undefined && !Number.isFinite(Number(candidate.order))) {
        errors.push(`${office}:${race.raceId}:${key} has an invalid custom order.`);
      }
      if (candidate.incumbent) {
        counts.incumbents += 1;
        if (reachedNonIncumbent && !Number.isFinite(Number(candidate.order))) {
          errors.push(`${office}:${race.raceId}:${key} incumbent is not ahead of non-incumbents.`);
        }
      } else {
        reachedNonIncumbent = true;
      }
      if (candidate.presumptiveNominee) {
        counts.presumptiveNominees += 1;
        if (genericNames.has(candidate.name)) {
          errors.push(`${office}:${race.raceId}:${key} is generic but marked presumptive.`);
        }
      }
      if (genericNames.has(candidate.name)) counts.genericCandidates += 1;
    }
  }
  summary[office] = counts;
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors, summary }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, summary }, null, 2));
