import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  dedupeWikipediaPollRows,
  parseWikipediaPollingPage,
  wikipediaPageUrl
} from "./lib/wikipedia-polls.mjs";
import { sanitizePollingCache } from "./lib/poll-validation.mjs";

const CACHE_DIR = new URL("../data/cache/polls/", import.meta.url);
const YEAR = 2026;

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
  NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

function readJson(relativePath, fallback) {
  try {
    const url = new URL(`../${relativePath}`, import.meta.url);
    if (!existsSync(url)) return fallback;
    return JSON.parse(readFileSync(url, "utf8"));
  } catch {
    return fallback;
  }
}

function uniqueStates(values) {
  return [...new Set(values.filter((state) => STATE_NAMES[state]))].sort();
}

function targetPages(office) {
  if (office === "senate") {
    const forecast = readJson("data/forecast.json", { races: [] });
    return uniqueStates((forecast.races || []).map((race) => race.state)).map((state) => ({
      office,
      state,
      raceId: `${state}-SEN-${YEAR}`,
      title: `${YEAR} United States Senate election in ${STATE_NAMES[state]}`
    }));
  }
  if (office === "governor") {
    const forecast = readJson("data/governor-forecast.json", { races: [] });
    return uniqueStates((forecast.races || []).map((race) => race.state)).map((state) => ({
      office,
      state,
      raceId: `${state}-GOV-${YEAR}`,
      title: `${YEAR} ${STATE_NAMES[state]} gubernatorial election`
    }));
  }
  const forecast = readJson("data/house-forecast.json", { districts: [] });
  return uniqueStates((forecast.districts || []).map((district) => district.state)).map((state) => ({
    office,
    state,
    raceId: `${state}-HOUSE-${YEAR}`,
    title: `${YEAR} United States House of Representatives elections in ${STATE_NAMES[state]}`
  }));
}

async function fetchPage(page) {
  const url = wikipediaPageUrl(page.title);
  try {
    const response = await fetch(url, { headers: { "user-agent": "Federal Elections Analysis polling cache updater" } });
    const html = await response.text();
    if (!response.ok) {
      return { ...page, url, status: `HTTP_${response.status}`, rows: [], averages: [], warning: `${response.status} ${response.statusText}` };
    }
    const parsed = parseWikipediaPollingPage(html, { ...page, url, year: YEAR });
    return {
      ...page,
      url,
      status: parsed.rows.length ? "OK_PARSED" : parsed.averages.length ? "HTML_FETCHED" : "OK_NO_ROWS",
      rows: parsed.rows,
      averages: parsed.averages,
      warnings: parsed.warnings || [],
      dedupe: parsed.dedupe || {}
    };
  } catch (error) {
    return { ...page, url, status: "FETCH_FAILED", rows: [], averages: [], warning: error.message };
  }
}

function writeOfficeCache(office, pageResults) {
  const rawRows = dedupeWikipediaPollRows(pageResults.flatMap((page) => page.rows || []));
  const averages = dedupeWikipediaPollRows(pageResults.flatMap((page) => page.averages || []));
  const warnings = pageResults.flatMap((page) => [
    ...(page.warning ? [`${page.title}: ${page.warning}`] : []),
    ...(page.warnings || []).map((warning) => `${page.title}: ${warning}`)
  ]);
  const basePayload = {
    source: "Wikipedia election polling tables",
    office,
    cycle: YEAR,
    status: rawRows.length ? "EXPERIMENTAL_DO_NOT_USE_IN_FORECAST" : pageResults.some((page) => page.status === "FETCH_FAILED") ? "PARTIAL_FETCH_FAILURE" : "OK_NO_ROWS",
    generatedAt: new Date().toISOString(),
    rawRows,
    rows: rawRows,
    averages,
    warnings,
    meta: {
      pages: pageResults.length,
      parsedPages: pageResults.filter((page) => page.status === "OK_PARSED").length,
      pagesWithNoRows: pageResults.filter((page) => page.status === "OK_NO_ROWS").length,
      failedPages: pageResults.filter((page) => page.status === "FETCH_FAILED" || /^HTTP_/.test(page.status)).length,
      duplicatesRemoved: pageResults.reduce((sum, page) => sum + Number(page.dedupe?.duplicatesRemoved || 0), 0),
      note: "Raw rows are stored for inspection. The Wikipedia parser is quarantined and does not feed the model."
    },
    pages: pageResults.map(({ title, state, raceId, url, status }) => ({ title, state, raceId, url, status }))
  };
  const payload = sanitizePollingCache(basePayload, {
    office,
    source: "Wikipedia election polling tables",
    forceQuarantine: true,
    quarantineReason: "WIKIPEDIA_EXPERIMENTAL_DO_NOT_USE_IN_FORECAST"
  });
  payload.status = rawRows.length ? "QUARANTINED" : payload.status;
  payload.rows = [];
  payload.usableRows = [];
  payload.usedInModel = false;
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(new URL(`wikipedia-${office}-2026.json`, CACHE_DIR), `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  for (const office of ["senate", "governor", "house"]) {
    const pages = targetPages(office);
    const results = [];
    for (const page of pages) {
      results.push(await fetchPage(page));
    }
    writeOfficeCache(office, results);
  }
}

main();
