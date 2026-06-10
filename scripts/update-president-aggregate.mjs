import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const DATA_URL = new URL("../data/", import.meta.url);
const OUTPUT_URL = new URL("../data/president-forecast.json", import.meta.url);
const MODEL_TIME_ZONE = "America/New_York";

function modelDateKey(date = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(process.env.MODEL_DATE || "")) return process.env.MODEL_DATE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MODEL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function modelRunDateLabel(date = new Date()) {
  const modelDate = process.env.MODEL_DATE;
  const source = /^\d{4}-\d{2}-\d{2}$/.test(modelDate || "") ? new Date(`${modelDate}T12:00:00`) : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: MODEL_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(source);
}

function average(items, getter) {
  return items.length ? items.reduce((sum, item) => sum + (Number(getter(item)) || 0), 0) / items.length : 0;
}

const files = readdirSync(DATA_URL)
  .filter((file) => /^president-forecast-[a-z]+-[a-z]+\.json$/.test(file))
  .sort();

const matchups = files.map((file) => JSON.parse(readFileSync(new URL(file, DATA_URL), "utf8")));
const aggregate = {
  model: "2028 presidential forecast aggregate",
  modelDate: modelDateKey(),
  runDate: modelRunDateLabel(),
  generatedAt: new Date().toISOString(),
  matchupCount: matchups.length,
  national: {
    demWinProbability: Number(average(matchups, (item) => item.national?.demWinProbability).toFixed(6)),
    repWinProbability: Number(average(matchups, (item) => item.national?.repWinProbability).toFixed(6)),
    demPopularVote: Number(average(matchups, (item) => item.national?.demPopularVote).toFixed(2)),
    repPopularVote: Number(average(matchups, (item) => item.national?.repPopularVote).toFixed(2))
  },
  electoralCollege: {
    demExpectedEV: Math.round(average(matchups, (item) => item.electoralCollege?.demExpectedEV)),
    repExpectedEV: Math.round(average(matchups, (item) => item.electoralCollege?.repExpectedEV))
  },
  matchups: matchups.map((item) => ({
    demCandidate: item.demCandidate,
    repCandidate: item.repCandidate,
    demCandidateName: item.demCandidateName,
    repCandidateName: item.repCandidateName,
    date: item.date,
    modelDate: item.modelDate,
    demWinProbability: item.national?.demWinProbability,
    repWinProbability: item.national?.repWinProbability,
    demExpectedEV: item.electoralCollege?.demExpectedEV,
    repExpectedEV: item.electoralCollege?.repExpectedEV
  }))
};

writeFileSync(OUTPUT_URL, `${JSON.stringify(aggregate, null, 2)}\n`, "utf8");
console.log(`Wrote president aggregate for ${matchups.length} matchups`);
