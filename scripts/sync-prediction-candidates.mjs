import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");

const predictionFiles = {
  senate: "data/predictions/2026-senate-predictions.json",
  house: "data/predictions/2026-house-predictions.json",
  governor: "data/predictions/2026-governor-predictions.json"
};

const unresolvedStatuses = new Set([
  "RUNOFF_PENDING",
  "PRIMARY_UNRESOLVED",
  "GENERIC_PLACEHOLDER",
  "NO_RESULT_SOURCE"
]);
const presumptiveStatuses = new Set(["PRESUMPTIVE_NOMINEE"]);
const confirmedStatuses = new Set(["VERIFIED_NOMINEE", "ADVANCED_TOP_TWO"]);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(root, relativePath), "utf8"));
}

function writeJson(relativePath, data) {
  fs.writeFileSync(path.resolve(root, relativePath), `${JSON.stringify(data, null, 2)}\n`);
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function isGenericName(value, party) {
  const normalized = normalizeName(value);
  const generic = party === "D" ? ["d", "democrat", "democratic"] : ["r", "republican", "gop"];
  return generic.includes(normalized);
}

function partyName(party) {
  return party === "D" ? "Democrat" : "Republican";
}

function sourceCandidateName(row, party) {
  return party === "D" ? row?.demCandidate : row?.repCandidate;
}

function sourceNominationStatus(row, party) {
  return party === "D" ? row?.demNominationStatus : row?.repNominationStatus;
}

function sourceRaceFor(model, race, sourceMaps) {
  if (model === "house") return sourceMaps.house.get(String(race.raceId || "").toUpperCase()) || null;
  return sourceMaps[model].get(String(race.state || "").toUpperCase()) || null;
}

function incumbentForParty(model, race, party, source) {
  if (!source) return "";
  const incumbent = String(source.incumbent || "").trim();
  if (!incumbent) return "";

  if (model === "house") {
    if (source.open) return "";
    const partyCandidate = party === "D" ? source.demCandidate : source.repCandidate;
    return normalizeName(partyCandidate) === normalizeName(incumbent) ? incumbent : "";
  }

  if (model === "senate") {
    if (/open seat|incumbent eliminated/i.test(String(source.seat || ""))) return "";
    return String(source.hold || "").toUpperCase() === party ? incumbent : "";
  }

  if (!/incumbent running|incumbent renominated/i.test(String(source.status || ""))) return "";
  return String(source.incumbentParty || "").toUpperCase() === party ? incumbent : "";
}

function cleanCandidateForName(candidate, nextName) {
  const previousName = String(candidate?.name || "");
  const changedPerson = previousName
    && normalizeName(previousName) !== normalizeName(nextName)
    && !isGenericName(previousName, String(candidate?.party || "").toUpperCase());
  const next = { ...(candidate || {}) };
  if (changedPerson) {
    delete next.headshotUrl;
    delete next.photo;
    delete next.image;
  }
  return next;
}

function updateMajorPartyCandidate({ candidate, party, auditRow, incumbent }) {
  const nominationStatus = String(sourceNominationStatus(auditRow, party) || "GENERIC_PLACEHOLDER");
  const auditedName = String(sourceCandidateName(auditRow, party) || "").trim();
  const isIncumbent = Boolean(incumbent);

  let name = partyName(party);
  let presumptiveNominee = false;

  if (confirmedStatuses.has(nominationStatus) && auditedName && !auditedName.includes("/")) {
    name = auditedName;
  } else if (presumptiveStatuses.has(nominationStatus) && auditedName && !auditedName.includes("/")) {
    name = auditedName;
    presumptiveNominee = true;
  } else if (isIncumbent) {
    name = incumbent;
    presumptiveNominee = true;
  } else if (!unresolvedStatuses.has(nominationStatus) && auditedName && !auditedName.includes("/")) {
    name = auditedName;
  }

  const next = cleanCandidateForName(candidate, name);
  next.name = name;
  next.party = party;
  next.incumbent = isIncumbent;
  next.presumptiveNominee = presumptiveNominee;

  if (presumptiveNominee) next.status = "Presumptive nominee";
  else if (confirmedStatuses.has(nominationStatus)) delete next.status;
  else if (!isIncumbent) delete next.status;

  return next;
}

function syncModel(model, data, auditRows, sourceMaps) {
  const auditById = new Map(
    auditRows
      .filter((row) => row.model === model)
      .map((row) => [String(row.id || row.state || "").toUpperCase(), row])
  );

  let changed = 0;
  for (const race of data.races || []) {
    const auditKey = model === "house"
      ? String(race.raceId || "").toUpperCase()
      : String(race.state || "").toUpperCase();
    const auditRow = auditById.get(auditKey) || null;
    const source = sourceRaceFor(model, race, sourceMaps);
    race.candidates = race.candidates || {};

    for (const party of ["D", "R"]) {
      const incumbent = incumbentForParty(model, race, party, source);
      const previous = race.candidates[party] || { party };
      const next = updateMajorPartyCandidate({
        candidate: previous,
        party,
        auditRow,
        incumbent
      });
      if (JSON.stringify(previous) !== JSON.stringify(next)) changed += 1;
      race.candidates[party] = next;
    }
  }
  return changed;
}

const audit = readJson("data/diagnostics/primary-status-audit-2026.json");
const senateSource = readJson("data/forecast.json");
const houseSource = readJson("data/house-forecast.json");
const governorSource = readJson("data/governor-forecast.json");

const sourceMaps = {
  senate: new Map((senateSource.races || []).map((race) => [String(race.state || "").toUpperCase(), race])),
  house: new Map((houseSource.districts || []).map((race) => [String(race.id || "").toUpperCase(), race])),
  governor: new Map((governorSource.races || []).map((race) => [String(race.state || "").toUpperCase(), race]))
};

const report = {};
for (const [model, file] of Object.entries(predictionFiles)) {
  const data = readJson(file);
  report[model] = syncModel(model, data, audit.rows || [], sourceMaps);
  writeJson(file, data);
}

console.log(JSON.stringify({ ok: true, updatedCandidates: report }, null, 2));
