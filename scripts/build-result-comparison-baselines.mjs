import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = path.join(ROOT, "data", "baselines", "source");
const OUT_DIR = path.join(ROOT, "data", "baselines");
const TODAY = new Date().toISOString().slice(0, 10);

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

const STATE_BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([abbr, name]) => [name.toUpperCase(), abbr]));

function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "";
}

function firstExisting(paths) {
  return paths.find((file) => fs.existsSync(file)) || "";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        field += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((header) => header.trim());
  return rows
    .filter((values) => values.some((value) => String(value || "").trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function column(row, names) {
  const keyMap = new Map(Object.keys(row).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const key = keyMap.get(name.toLowerCase());
    if (key) return row[key];
  }
  return "";
}

function number(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function yearOf(row) {
  return Number(column(row, ["year", "election_year", "electionyear"]));
}

function stateAbbr(row) {
  const direct = String(column(row, ["state_po", "statepostal", "state_abbr", "state"])).trim().toUpperCase();
  if (STATE_NAMES[direct]) return direct;
  return STATE_BY_NAME[direct] || "";
}

function partyOf(row) {
  const raw = String(column(row, ["party_detailed", "party_simplified", "party", "candidate_party"])).trim().toUpperCase();
  if (["DEMOCRAT", "DEMOCRATIC", "DEM", "D"].includes(raw)) return "D";
  if (["REPUBLICAN", "REP", "GOP", "R"].includes(raw)) return "R";
  return "";
}

function countyFips(row) {
  const raw = String(column(row, ["county_fips", "countyfips", "fips", "county_fips_code"])).replace(/\D/g, "");
  return raw ? raw.padStart(5, "0") : "";
}

function districtId(state, rawDistrict) {
  const raw = String(rawDistrict ?? "").trim().toUpperCase();
  if (!raw || raw === "ZZ") return "";
  const normalized = raw === "0" || raw === "00" || raw === "AL" ? "AL" : String(Number(raw)).padStart(2, "0");
  if (normalized === "NAN") return "";
  return `${state}-${normalized}`;
}

function finalizeVotes(entry) {
  const twoParty = entry.demVotes + entry.repVotes;
  const totalVotes = entry.totalVotes || twoParty;
  const demShare = twoParty ? (entry.demVotes / twoParty) * 100 : 0;
  const repShare = twoParty ? (entry.repVotes / twoParty) * 100 : 0;
  return {
    ...entry,
    totalVotes,
    demShare: round(demShare),
    repShare: round(repShare),
    margin: round(demShare - repShare)
  };
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function writeJson(relative, payload) {
  const file = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${relative}`);
}

function buildPresidentialBaselines(file) {
  if (!file) {
    console.warn("No county presidential CSV found. Put countypres_2000-2024.csv in data/baselines/source or pass --pres=path.");
    return;
  }
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const byCounty = new Map();
  for (const row of rows) {
    const year = yearOf(row);
    if (![2020, 2024].includes(year)) continue;
    const state = stateAbbr(row);
    const fips = countyFips(row);
    const party = partyOf(row);
    if (!state || !fips || !party) continue;
    const key = `${year}:${fips}`;
    if (!byCounty.has(key)) {
      byCounty.set(key, {
        year,
        fips,
        state,
        county: String(column(row, ["county_name", "county", "countyname"])).trim(),
        demVotes: 0,
        repVotes: 0,
        totalVotes: 0
      });
    }
    const entry = byCounty.get(key);
    const votes = number(column(row, ["candidatevotes", "candidate_votes", "votes"]));
    if (party === "D") entry.demVotes += votes;
    if (party === "R") entry.repVotes += votes;
    entry.totalVotes = Math.max(entry.totalVotes, number(column(row, ["totalvotes", "total_votes", "total"])));
  }

  for (const year of [2020, 2024]) {
    const counties = [...byCounty.values()]
      .filter((entry) => entry.year === year)
      .map(finalizeVotes)
      .map(({ year: _year, ...entry }) => entry)
      .sort((a, b) => a.fips.localeCompare(b.fips));
    if (!counties.length) {
      console.warn(`No ${year} presidential county rows found in ${path.relative(ROOT, file)}.`);
      continue;
    }
    const stateMap = new Map();
    for (const county of counties) {
      if (!stateMap.has(county.state)) {
        stateMap.set(county.state, { state: county.state, demVotes: 0, repVotes: 0, totalVotes: 0 });
      }
      const state = stateMap.get(county.state);
      state.demVotes += county.demVotes;
      state.repVotes += county.repVotes;
      state.totalVotes += county.totalVotes;
    }
    writeJson(`data/baselines/pres-${year}-counties.json`, {
      source: "MIT Election Data and Science Lab county presidential returns / official certified returns",
      sourceFile: path.relative(ROOT, file).replaceAll("\\", "/"),
      updatedAt: TODAY,
      rows: counties
    });
    writeJson(`data/baselines/pres-${year}-states.json`, {
      source: "MIT Election Data and Science Lab county presidential returns / official certified returns",
      sourceFile: path.relative(ROOT, file).replaceAll("\\", "/"),
      updatedAt: TODAY,
      states: [...stateMap.values()].map(finalizeVotes).sort((a, b) => a.state.localeCompare(b.state))
    });
  }
}

function buildHouseBaseline(file) {
  if (!file) {
    console.warn("No House CSV found. Put 1976-2024-house.csv in data/baselines/source or pass --house=path.");
    return;
  }
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const districtMap = new Map();
  for (const row of rows) {
    if (yearOf(row) !== 2024) continue;
    const state = stateAbbr(row);
    const district = String(column(row, ["district", "district_number", "congressional_district"])).trim();
    const id = districtId(state, district);
    const party = partyOf(row);
    if (!state || !id || !party) continue;
    if (!districtMap.has(id)) {
      districtMap.set(id, { id, state, district: id.split("-")[1], demVotes: 0, repVotes: 0, totalVotes: 0 });
    }
    const entry = districtMap.get(id);
    const votes = number(column(row, ["candidatevotes", "candidate_votes", "votes"]));
    if (party === "D") entry.demVotes += votes;
    if (party === "R") entry.repVotes += votes;
    entry.totalVotes = Math.max(entry.totalVotes, number(column(row, ["totalvotes", "total_votes", "total"])));
  }
  const districts = [...districtMap.values()].map(finalizeVotes).sort((a, b) => a.id.localeCompare(b.id));
  if (!districts.length) {
    console.warn(`No 2024 House district rows found in ${path.relative(ROOT, file)}.`);
    return;
  }
  writeJson("data/baselines/house-2024-districts.json", {
    source: "MIT Election Data and Science Lab House returns / official certified returns",
    sourceFile: path.relative(ROOT, file).replaceAll("\\", "/"),
    updatedAt: TODAY,
    districts
  });
}

const presPath = readArg("pres") || firstExisting([
  path.join(SOURCE_DIR, "countypres_2000-2024.csv"),
  path.join(SOURCE_DIR, "countypres_2000-2020.csv"),
  path.join(SOURCE_DIR, "countypres.csv")
]);

const housePath = readArg("house") || firstExisting([
  path.join(SOURCE_DIR, "1976-2024-house.csv"),
  path.join(SOURCE_DIR, "1976-2022-house.csv"),
  path.join(SOURCE_DIR, "house.csv")
]);

buildPresidentialBaselines(presPath);
buildHouseBaseline(housePath);
