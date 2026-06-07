import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const failures = [];
const files = [
  "data/forecast.json",
  "data/house-forecast.json",
  "data/governor-forecast.json",
  ...gitFiles("data/president-forecast-*-*.json")
];

function gitFiles(pattern) {
  try {
    return execSync(`git ls-files ${pattern}`, { encoding: "utf8" })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseJson(text, label) {
  if (!text || /^\s*(<<<<<<<|=======|>>>>>>>)/m.test(text)) {
    failures.push(`${label} contains unresolved conflict markers`);
    return null;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    failures.push(`${label} could not parse: ${error.message}`);
    return null;
  }
}

function readWorking(file) {
  if (!existsSync(file)) return null;
  return parseJson(readFileSync(file, "utf8"), file);
}

function readHead(file) {
  try {
    return parseJson(execSync(`git show HEAD:${file}`, { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 }), `HEAD:${file}`);
  } catch {
    return null;
  }
}

function checkLength(label, current = [], previous = []) {
  const currentLength = Array.isArray(current) ? current.length : 0;
  const previousLength = Array.isArray(previous) ? previous.length : 0;
  if (previousLength > 1 && currentLength < previousLength) {
    failures.push(`${label} shrank from ${previousLength} points to ${currentLength}`);
  }
}

function checkRows(file, currentRows = [], previousRows = [], keyField) {
  const previousByKey = new Map((previousRows || []).map((row) => [row?.[keyField], row]));
  for (const row of currentRows || []) {
    const key = row?.[keyField];
    if (!key || !previousByKey.has(key)) continue;
    checkLength(`${file} ${key} history`, row.history, previousByKey.get(key).history);
  }
}

function checkStateHistory(file, current = {}, previous = {}) {
  for (const [state, history] of Object.entries(previous || {})) {
    if (!Object.hasOwn(current || {}, state)) continue;
    checkLength(`${file} ${state} stateHistory`, current[state], history);
  }
}

for (const file of files) {
  const current = readWorking(file);
  const previous = readHead(file);
  if (!current || !previous) continue;

  if (file === "data/forecast.json") {
    checkLength(`${file} controlHistory`, current.controlHistory, previous.controlHistory);
    checkLength(`${file} seatHistory`, current.seatHistory, previous.seatHistory);
    checkRows(file, current.races, previous.races, "state");
  } else if (file === "data/house-forecast.json") {
    checkLength(`${file} controlHistory`, current.controlHistory, previous.controlHistory);
    checkLength(`${file} seatHistory`, current.seatHistory, previous.seatHistory);
    checkRows(file, current.districts, previous.districts, "id");
  } else if (file === "data/governor-forecast.json") {
    checkLength(`${file} governorCountHistory`, current.governorCountHistory, previous.governorCountHistory);
    checkStateHistory(file, current.stateHistory, previous.stateHistory);
    checkRows(file, current.races, previous.races, "state");
  } else if (/data\/president-forecast-[a-z]+-[a-z]+\.json/.test(file)) {
    checkLength(`${file} history`, current.history, previous.history);
    checkStateHistory(file, current.stateHistory, previous.stateHistory);
  }
}

if (failures.length) {
  console.error("Forecast history validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Forecast history validation passed.");
