import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DATA_FILES = [
  "data/forecast.json",
  "data/house-forecast.json",
  "data/governor-forecast.json",
  ...listPresidentForecastFiles()
];
const DEFAULT_SOURCE_COMMIT = "433bb4a";
const sourceCommit = process.argv[2] || DEFAULT_SOURCE_COMMIT;

function listPresidentForecastFiles() {
  const files = execSync("git ls-files data/president-forecast-*-*.json", { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return files;
}

function readJsonText(text) {
  if (!text || /^\s*(<<<<<<<|=======|>>>>>>>)/m.test(text)) return null;
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function readWorking(file) {
  if (!existsSync(file)) return null;
  return readJsonText(readFileSync(file, "utf8"));
}

function readGitBlob(commit, file) {
  try {
    return readJsonText(execSync(`git show ${commit}:${file}`, { encoding: "utf8", maxBuffer: 80 * 1024 * 1024 }));
  } catch {
    return null;
  }
}

function historyScore(file, data) {
  if (!data) return 0;
  if (file === "data/forecast.json") {
    return (data.controlHistory?.length || 0)
      + (data.seatHistory?.length || 0)
      + (data.races || []).reduce((sum, race) => sum + (race.history?.length || 0), 0);
  }
  if (file === "data/house-forecast.json") {
    return (data.controlHistory?.length || 0)
      + (data.seatHistory?.length || 0)
      + (data.districts || []).reduce((sum, district) => sum + (district.history?.length || 0), 0);
  }
  if (file === "data/governor-forecast.json") {
    return (data.governorCountHistory?.length || 0)
      + Object.values(data.stateHistory || {}).reduce((sum, history) => sum + (history?.length || 0), 0)
      + (data.races || []).reduce((sum, race) => sum + (race.history?.length || 0), 0);
  }
  if (/data\/president-forecast-[a-z]+-[a-z]+\.json/.test(file)) {
    return (data.history?.length || 0)
      + Object.values(data.stateHistory || {}).reduce((sum, history) => sum + (history?.length || 0), 0);
  }
  return 0;
}

function bestHistorySource(file) {
  const data = readGitBlob(sourceCommit, file);
  const score = historyScore(file, data);
  return data ? { commit: sourceCommit, data, score } : null;
}

function mergeHistory(oldHistory = [], currentHistory = [], dateKey = "date") {
  const byDate = new Map();
  for (const point of oldHistory || []) {
    if (point?.[dateKey]) byDate.set(String(point[dateKey]), point);
  }
  for (const point of currentHistory || []) {
    if (point?.[dateKey]) byDate.set(String(point[dateKey]), point);
  }
  return [...byDate.values()]
    .sort((a, b) => String(a[dateKey]).localeCompare(String(b[dateKey])))
    .slice(-365);
}

function mergeRaceHistories(currentRows = [], oldRows = [], keyField) {
  const oldByKey = new Map(oldRows.map((row) => [row[keyField], row]));
  return currentRows.map((row) => {
    const old = oldByKey.get(row[keyField]);
    return old ? { ...row, history: mergeHistory(old.history, row.history) } : row;
  });
}

function mergeStateHistory(current = {}, old = {}) {
  const merged = {};
  for (const state of new Set([...Object.keys(old || {}), ...Object.keys(current || {})])) {
    merged[state] = mergeHistory(old?.[state], current?.[state]);
  }
  return merged;
}

function isShorter(current = [], old = []) {
  return Array.isArray(old) && Array.isArray(current) && old.length > current.length;
}

function hasShorterRaceHistory(currentRows = [], oldRows = [], keyField) {
  const currentByKey = new Map((currentRows || []).map((row) => [row?.[keyField], row]));
  return (oldRows || []).some((oldRow) => {
    const currentRow = currentByKey.get(oldRow?.[keyField]);
    return currentRow && isShorter(currentRow.history, oldRow.history);
  });
}

function hasShorterStateHistory(current = {}, old = {}) {
  return Object.entries(old || {}).some(([state, oldHistory]) => (
    Object.hasOwn(current || {}, state) && isShorter(current[state], oldHistory)
  ));
}

function needsRestore(file, current, old) {
  if (file === "data/forecast.json") {
    return isShorter(current.controlHistory, old.controlHistory)
      || isShorter(current.seatHistory, old.seatHistory)
      || hasShorterRaceHistory(current.races, old.races, "state");
  }
  if (file === "data/house-forecast.json") {
    return isShorter(current.controlHistory, old.controlHistory)
      || isShorter(current.seatHistory, old.seatHistory)
      || hasShorterRaceHistory(current.districts, old.districts, "id");
  }
  if (file === "data/governor-forecast.json") {
    return isShorter(current.governorCountHistory, old.governorCountHistory)
      || hasShorterStateHistory(current.stateHistory, old.stateHistory)
      || hasShorterRaceHistory(current.races, old.races, "state");
  }
  if (/data\/president-forecast-[a-z]+-[a-z]+\.json/.test(file)) {
    return isShorter(current.history, old.history)
      || hasShorterStateHistory(current.stateHistory, old.stateHistory);
  }
  return false;
}

function restoreFile(file) {
  const current = readWorking(file);
  const best = bestHistorySource(file);
  if (!current || !best?.data || !needsRestore(file, current, best.data)) {
    return { file, restored: false, score: historyScore(file, current), source: best?.commit?.slice(0, 7) };
  }

  const output = { ...current };
  if (file === "data/forecast.json") {
    output.controlHistory = mergeHistory(best.data.controlHistory, current.controlHistory);
    output.seatHistory = mergeHistory(best.data.seatHistory, current.seatHistory);
    output.races = mergeRaceHistories(current.races, best.data.races, "state");
  } else if (file === "data/house-forecast.json") {
    output.controlHistory = mergeHistory(best.data.controlHistory, current.controlHistory);
    output.seatHistory = mergeHistory(best.data.seatHistory, current.seatHistory);
    output.districts = mergeRaceHistories(current.districts, best.data.districts, "id");
  } else if (file === "data/governor-forecast.json") {
    output.governorCountHistory = mergeHistory(best.data.governorCountHistory, current.governorCountHistory);
    output.stateHistory = mergeStateHistory(current.stateHistory, best.data.stateHistory);
    output.races = mergeRaceHistories(current.races, best.data.races, "state");
  } else if (/data\/president-forecast-[a-z]+-[a-z]+\.json/.test(file)) {
    output.history = mergeHistory(best.data.history, current.history);
    output.stateHistory = mergeStateHistory(current.stateHistory, best.data.stateHistory);
  }

  writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return { file, restored: true, score: historyScore(file, output), source: best.commit.slice(0, 7) };
}

const results = DATA_FILES.map(restoreFile);
for (const result of results) {
  console.log(`${result.restored ? "restored" : "kept"} ${result.file} history score ${result.score}${result.source ? ` from ${result.source}` : ""}`);
}
