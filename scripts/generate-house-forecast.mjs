import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { forecastSanityWarnings } from "./forecast-sanity.mjs";
import { generationNetworkStatus, markNoRows, markParseFailed, recordFetch, recordFetchError, sourceHealthSummary, sourceHealthWarnings } from "./forecast-source-health.mjs";
import { directPollLedger, dedupePollRows } from "./poll-ledger.mjs";
import { loadFiftyPlusOnePolls } from "./fiftyplusone-polls.mjs";
import { classifyPollingInputs, pollingStatusWarning } from "./forecast-polling-status.mjs";
import { benchmarkConfiguration, benchmarkFor, benchmarkWarnings, toplineBenchmark } from "./forecast-benchmarks.mjs";
import { blendGenericBallotSources, parsePollfinityGeneric as parseCanonicalPollfinityGeneric, parseUsPollingDataGeneric as parseCanonicalUsPollingDataGeneric, parseVoteHubGeneric as parseCanonicalVoteHubGeneric, readCachedGenericBallot } from "./lib/generic-ballot.mjs";
import { buildInputBalance, forecastInputCacheFreshness, marginSplit } from "./forecast-cache.mjs";
import { applyRatingGuardrail, applyRatingPrior, buildRatingPrior, loadRatingWeightConfig } from "./lib/rating-priors.mjs";
import { readHouseFundamentalsCacheMap } from "./lib/house-input-caches.mjs";
import { readWikipediaPollingCache, wikipediaPollingSummary } from "./lib/wikipedia-polls.mjs";

const OUTPUT_URL = new URL("../data/house-forecast.json", import.meta.url);
const SENATE_FORECAST_URL = new URL("../data/forecast.json", import.meta.url);
const DIRECT_POLL_LEDGER_URL = new URL("../data/direct-poll-ledger.json", import.meta.url);
const previousForecast = readPreviousForecast();
const OFFLINE = process.argv.includes("--offline");
const RATING_WEIGHT_CONFIG = loadRatingWeightConfig();
const HOUSE_FUNDAMENTALS_CACHE = readHouseFundamentalsCacheMap();

const SETTINGS = {
  simulations: 100000,
  controlThreshold: 218,
  updateTime: "around 7:20 AM Eastern",
  updateZone: "America/New_York",
  dataSources: [
      "270toWin / Inside Elections district and candidate data",
      "Cook Political Report district context when reachable",
    "270toWin House polling reference page",
    "Race to the WH House and generic-ballot reference pages",
    "RealClearPolling generic-ballot reference pages when reachable",
    "Generic-ballot polling adapters shared with the Senate model",
    "OpenFEC House candidate finance bulk files",
    "Census 119th congressional district boundary files for map basis"
  ]
};

const MODEL_WEIGHTS = {
  genericBallot: .46,
  genericBallotCap: 5.8,
  districtBaseline: 1,
  districtPolls: .18,
  finance: .22,
  nationalFinance: .35,
  nominationCertainty: .32,
  candidateQuality: .36,
  incumbencyOpenPenalty: .45,
  seatPartyIncumbency: .45,
  districtFundamentals: .2,
  // District fundamentals are built from prior federal returns, not a pure
  // midterm cycle baseline. Keep a modest calibrated cycle adjustment, but do
  // not let it duplicate the generic-ballot environment.
  historicalMidterm: .8,
  stateCorrelationSd: 1.35,
  nationalEnvironmentSd: 3.05
};

const CHALLENGER_STRENGTH_DISCOUNTS = {
  sameDistrict: .85,
  statewide: .55,
  majorOffice: .35,
  notable: .22,
  none: 0
};

const MANUAL_HOUSE_CHALLENGER_STRENGTH = {
  "CO-04": { D: "notable" }
};

const HOUSE_CANDIDATE_STATUS_OVERRIDES = {
  "CO-04": { D: "presumptive", R: "presumptive" },
  "GA-11": { R: "nominee" }
};

const MANUAL_HOUSE_CANDIDATE_OVERRIDES = {
  "IA-01": { D: "Christina Bohannan", R: "Mariannette Miller-Meeks" },
  "IA-02": { D: "Lindsay James", R: "Joe Mitchell" },
  "IA-03": { D: "Sarah Trone Garriott", R: "Zach Nunn" },
  "IA-04": { D: "Dave Dawson", R: "Chris McGowan" },
  "MT-01": { D: "Sam Forstag", R: "Aaron Flint" },
  "MT-02": { D: "Brian Miller", R: "Troy Downing" },
  "GA-11": { R: "John Cowan" },
  "NJ-01": { D: "Donald Norcross", R: "Damon Galdo" },
  "NJ-02": { D: "Zack Mullock", R: "Jeff Van Drew" },
  "NJ-03": { D: "Herb Conaway", R: "Michael McGuire" },
  "NJ-04": { D: "Rachel Peace", R: "Christopher Smith" },
  "NJ-05": { D: "Josh Gottheimer", R: "Sean Kirrane" },
  "NJ-06": { D: "Frank Pallone Jr.", R: "Hillary Herzig" },
  "NJ-07": { D: "Rebecca Bennett", R: "Tom Kean Jr." },
  "NJ-08": { D: "Rob Menendez" },
  "NJ-09": { D: "Nellie Pou", R: "Rosie Pino" },
  "NJ-10": { D: "LaMonica McIver", R: "Carmen Bucco" },
  "NJ-11": { D: "Analilia Mejia", R: "Joe Hathaway" },
  "NJ-12": { D: "Adam Hamawy", R: "Gregg Mele" },
  "SD-AL": { D: "Nicole Gronli", R: "Marty Jackley" }
};

const HOUSE_PRIMARY_DATES = {
  AR: "2026-03-03",
  NC: "2026-03-03",
  TX: "2026-03-03",
  MS: "2026-03-10",
  IL: "2026-03-17",
  IN: "2026-05-05",
  OH: "2026-05-05",
  NE: "2026-05-12",
  WV: "2026-05-12",
  LA: "2026-05-16",
  AL: "2026-05-19",
  GA: "2026-05-19",
  ID: "2026-05-19",
  KY: "2026-05-19",
  OR: "2026-05-19",
  PA: "2026-05-19",
  CA: "2026-06-02",
  SD: "2026-06-02",
  IA: "2026-06-02",
  NJ: "2026-06-02",
  MT: "2026-06-02",
  NM: "2026-06-02",
  SC: "2026-06-09",
  ME: "2026-06-09",
  NV: "2026-06-09",
  ND: "2026-06-09",
  OK: "2026-06-16",
  MD: "2026-06-23",
  NY: "2026-06-23",
  UT: "2026-06-23",
  CO: "2026-06-30",
  AZ: "2026-07-21",
  KS: "2026-08-04",
  MI: "2026-08-04",
  MO: "2026-08-04",
  VA: "2026-08-04",
  WA: "2026-08-04",
  TN: "2026-08-06",
  HI: "2026-08-08",
  CT: "2026-08-11",
  MN: "2026-08-11",
  VT: "2026-08-11",
  WI: "2026-08-11",
  WY: "2026-08-18",
  AK: "2026-08-18",
  FL: "2026-08-18",
  MA: "2026-09-01",
  DE: "2026-09-15",
  NH: "2026-09-08",
  RI: "2026-09-08"
};

const HOUSE_PRIMARY_OVERRIDES = {
  "TX": { runoffDate: "2026-05-26", primarySummary: "Texas held a March 3 primary and May 26 runoff where needed." },
  "LA": {
    primaryDate: "2026-11-03",
    primarySummary: "Louisiana's May House primaries were suspended after Louisiana v. Callais; House races are modeled under Act 2 / SB 121 unless litigation changes the map."
  },
  "AL-01": { primaryDate: "2026-08-11", primarySummary: "Alabama CD-1 primary timing is affected by pending map litigation and state scheduling orders." },
  "AL-02": { primaryDate: "2026-08-11", primarySummary: "Alabama CD-2 primary timing is affected by pending map litigation and state scheduling orders." },
  "AL-06": { primaryDate: "2026-08-11", primarySummary: "Alabama CD-6 primary timing is affected by pending map litigation and state scheduling orders." },
  "AL-07": { primaryDate: "2026-08-11", primarySummary: "Alabama CD-7 primary timing is affected by pending map litigation and state scheduling orders." }
};

const HOUSE_CANDIDATE_PROFILE_SCORES = {
  incumbent: { quality: .55, uncertainty: -.45 },
  resolvedNominee: { quality: .18, uncertainty: -.35 },
  presumptiveNominee: { quality: .1, uncertainty: -.18 },
  openSeatKnown: { quality: 0, uncertainty: .15 },
  unresolved: { quality: -.1, uncertainty: .45 },
  placeholder: { quality: -.28, uncertainty: .72 },
  strongChallenger: { quality: .22, uncertainty: -.1 }
};

const STATE_COALITION_TRAITS = {
  AL: ["deep_south", "rural", "evangelical"], AK: ["frontier", "independent"], AZ: ["sunbelt", "suburban", "latino"], AR: ["south", "rural"],
  CA: ["urban", "college", "latino"], CO: ["suburban", "college"], CT: ["suburban", "college"], DE: ["suburban"],
  FL: ["sunbelt", "suburban", "latino", "senior"], GA: ["suburban", "black_belt"], HI: ["minority"], ID: ["rural"],
  IL: ["urban", "suburban"], IN: ["working_class"], IA: ["rural", "working_class"], KS: ["suburban", "rural"],
  KY: ["appalachian", "rural", "working_class"], LA: ["deep_south", "black_belt"], ME: ["independent", "rural"], MD: ["suburban", "college"],
  MA: ["college", "urban"], MI: ["working_class", "suburban"], MN: ["college", "suburban"], MS: ["black_belt", "rural"],
  MO: ["rural", "working_class"], MT: ["frontier", "rural", "independent"], NE: ["rural", "suburban", "independent"], NV: ["sunbelt", "working_class", "latino"],
  NH: ["independent", "suburban"], NJ: ["suburban", "college"], NM: ["latino"], NY: ["urban", "college"], NC: ["suburban", "black_belt"],
  ND: ["rural"], OH: ["appalachian", "working_class"], OK: ["evangelical", "rural"], OR: ["college"], PA: ["working_class", "suburban"],
  RI: ["urban"], SC: ["black_belt", "suburban", "evangelical"], SD: ["rural"], TN: ["appalachian", "evangelical"], TX: ["sunbelt", "suburban", "latino"],
  UT: ["suburban", "religious"], VT: ["rural", "college"], VA: ["suburban", "college"], WA: ["college", "urban"], WV: ["appalachian", "rural", "working_class"],
  WI: ["working_class", "rural"], WY: ["rural"]
};

const HOUSE_COALITION_PROFILES = {
  democrat: { white_college: .14, white_noncollege: -.12, black: .13, latino: .09, asian_other: .06, youth: .07, senior: -.03 },
  republican: { white_college: -.07, white_noncollege: .15, black: -.09, latino: -.05, asian_other: -.05, youth: -.05, senior: .07 },
  demIncumbent: { white_college: .13, white_noncollege: -.05, black: .11, latino: .07, asian_other: .05, youth: .03, senior: .05 },
  repIncumbent: { white_college: -.03, white_noncollege: .12, black: -.08, latino: -.03, asian_other: -.03, youth: -.03, senior: .09 },
  openSeat: { white_college: -.01, white_noncollege: -.01, youth: .01 }
};

const DEMOGRAPHIC_GROUP_LABELS = {
  white_college: "White college",
  white_noncollege: "White non-college",
  black: "Black",
  latino: "Latino",
  asian_other: "Asian/other",
  youth: "18-29",
  senior: "65+"
};

const CATEGORY_ALIASES = {
  "Solid Democrat": "Safe D",
  "Likely Democrat": "Likely D",
  "Lean Democrat": "Lean D",
    "Toss Up": "Toss-up",
  "Toss-up": "Toss-up",
  "Tilt Democrat": "Tilt D",
  "Tilt Republican": "Tilt R",
  "Lean Republican": "Lean R",
  "Likely Republican": "Likely R",
  "Solid Republican": "Safe R"
};

const STATUS_TO_RATING = {
  D4: "Safe D",
  D3: "Likely D",
  D2: "Lean D",
  D1: "Tilt D",
  T: "Toss-up",
  R1: "Tilt R",
  R2: "Lean R",
  R3: "Likely R",
  R4: "Safe R"
};

const RATING_ORDER = ["Safe D", "Likely D", "Lean D", "Tilt D", "Toss-up", "Tilt R", "Lean R", "Likely R", "Safe R"];
const STATELESS_DISTRICTS = new Set(["DC-AL"]);

const REDISTRICTING_STATE_STATUS = {
  AL: {
    status: "litigation-pending",
    modelTreatment: "2024 court map retained for now",
    effectiveFor2026: false,
    note: "Alabama's request to revert to its 2023 congressional map was blocked on May 26, 2026; the court map remains the baseline while appeals continue.",
    source: "NCSL mid-decade tracker; AP/Axios May 2026 coverage"
  },
  CA: {
    status: "new-2026-map",
    modelTreatment: "2026 enacted map",
    effectiveFor2026: true,
    note: "California's Proposition 50 map is treated as the 2026 baseline.",
    source: "NCSL mid-decade tracker"
  },
  FL: {
    status: "new-2026-map",
    modelTreatment: "2026 enacted map with litigation watch",
    effectiveFor2026: true,
    note: "Florida enacted a new 2026 congressional map; state litigation remains a watch item.",
    source: "NCSL mid-decade tracker"
  },
  GA: {
    status: "future-cycle-watch",
    modelTreatment: "current map for 2026",
    effectiveFor2026: false,
    note: "Georgia's official redistricting steps are for 2028, not the 2026 House election.",
    source: "NCSL mid-decade tracker"
  },
  IN: {
    status: "failed-redraw",
    modelTreatment: "2021 map retained",
    effectiveFor2026: false,
    note: "Indiana lawmakers voted down new maps; current maps remain in effect for 2026.",
    source: "NCSL mid-decade tracker"
  },
  LA: {
    status: "new-2026-map",
    modelTreatment: "Act 2 / SB 121 local override",
    effectiveFor2026: true,
    note: "Louisiana enacted Act 2 / SB 121 on May 29, 2026 after Louisiana v. Callais; the model forces a 5R-1D seat-rating baseline until public rating feeds fully catch up.",
    source: "Louisiana Legislature SB121; Louisiana redistricting files; AP May 29, 2026"
  },
  MD: {
    status: "failed-redraw",
    modelTreatment: "current map for 2026",
    effectiveFor2026: false,
    note: "Maryland redistricting legislation died; no new 2026 congressional map is modeled.",
    source: "NCSL mid-decade tracker"
  },
  MO: {
    status: "new-2026-map",
    modelTreatment: "2025 enacted map with referendum watch",
    effectiveFor2026: true,
    note: "Missouri's 2025 map is modeled as active while referendum and signature litigation continue.",
    source: "NCSL mid-decade tracker"
  },
  NC: {
    status: "new-2026-map",
    modelTreatment: "2025 enacted map",
    effectiveFor2026: true,
    note: "North Carolina's October 2025 congressional map is treated as active for 2026.",
    source: "NCSL mid-decade tracker"
  },
  NY: {
    status: "failed-redraw",
    modelTreatment: "current map for 2026",
    effectiveFor2026: false,
    note: "A state court redraw order was stayed and dismissed; current New York maps remain in effect.",
    source: "NCSL mid-decade tracker"
  },
  OH: {
    status: "new-2026-map",
    modelTreatment: "2025 adopted map",
    effectiveFor2026: true,
    note: "Ohio's October 2025 map is treated as active for 2026.",
    source: "NCSL mid-decade tracker"
  },
  SC: {
    status: "failed-redraw",
    modelTreatment: "2022 map retained",
    effectiveFor2026: false,
    note: "South Carolina redistricting legislation died in the Senate; 2022 congressional maps remain the 2026 baseline.",
    source: "NCSL mid-decade tracker"
  },
  TN: {
    status: "new-2026-map",
    modelTreatment: "2026 enacted map",
    effectiveFor2026: true,
    note: "Tennessee's May 2026 congressional map is treated as active for 2026.",
    source: "NCSL mid-decade tracker"
  },
  TX: {
    status: "new-2026-map",
    modelTreatment: "2025 enacted map, Supreme Court stay in place",
    effectiveFor2026: true,
    note: "Texas's 2025 map is treated as active for 2026 after the Supreme Court stayed the lower-court injunction.",
    source: "NCSL mid-decade tracker"
  },
  UT: {
    status: "new-2026-map",
    modelTreatment: "court-adopted 2025 map",
    effectiveFor2026: true,
    note: "Utah's court-adopted 2025 map is treated as active for 2026.",
    source: "NCSL mid-decade tracker"
  },
  VA: {
    status: "failed-redraw",
    modelTreatment: "2021 court map retained",
    effectiveFor2026: false,
    note: "Virginia's attempted 2026 congressional map was overturned; the 2021 court map is used.",
    source: "NCSL mid-decade tracker"
  },
  WA: {
    status: "failed-redraw",
    modelTreatment: "current map for 2026",
    effectiveFor2026: false,
    note: "Washington's redistricting proposal died; no new 2026 congressional map is modeled.",
    source: "NCSL mid-decade tracker"
  }
};

const DISTRICT_REDISTRICTING_OVERRIDES = {
  "LA-01": {
    sourceRating: "Safe R",
    rating: "Safe R",
    presidentialMargin: -38.2,
    congressionalMargin: -42.8,
    fundamentalMargin: -40.3,
    label: "Steve Scalise",
    incumbent: "Steve Scalise",
    seatParty: "R",
    redistrictingNote: "Act 2 / SB 121 keeps LA-01 as a strongly Republican seat."
  },
  "LA-02": {
    sourceRating: "Safe D",
    rating: "Safe D",
    presidentialMargin: 31.6,
    congressionalMargin: 39.6,
    fundamentalMargin: 35.2,
    label: "Troy Carter / Cleo Fields drawn in",
    incumbent: "Troy Carter",
    demCandidate: "Troy Carter / Cleo Fields",
    repCandidate: "Republican",
    seatParty: "D",
    redistrictingNote: "Act 2 / SB 121 preserves one Democratic-leaning New Orleans-Baton Rouge seat while drawing Cleo Fields into the remaining Democratic district."
  },
  "LA-03": {
    sourceRating: "Safe R",
    rating: "Safe R",
    presidentialMargin: -45,
    congressionalMargin: -51.9,
    fundamentalMargin: -48.1,
    label: "Clay Higgins",
    incumbent: "Clay Higgins",
    seatParty: "R",
    redistrictingNote: "Act 2 / SB 121 keeps LA-03 as a strongly Republican seat."
  },
  "LA-04": {
    sourceRating: "Safe R",
    rating: "Safe R",
    presidentialMargin: -52.4,
    congressionalMargin: -100,
    fundamentalMargin: -68,
    label: "Mike Johnson",
    incumbent: "Mike Johnson",
    seatParty: "R",
    redistrictingNote: "Act 2 / SB 121 keeps LA-04 as a strongly Republican seat."
  },
  "LA-05": {
    sourceRating: "Safe R",
    rating: "Safe R",
    presidentialMargin: -36.4,
    congressionalMargin: -37,
    fundamentalMargin: -36.7,
    label: "Julia Letlow / open",
    incumbent: "Julia Letlow",
    open: true,
    seatParty: "R",
    redistrictingNote: "Act 2 / SB 121 keeps LA-05 as a strongly Republican seat."
  },
  "LA-06": {
    sourceRating: "Safe R",
    rating: "Safe R",
    presidentialMargin: -24.5,
    congressionalMargin: -31,
    fundamentalMargin: -27.4,
    label: "Cleo Fields seat redrawn / open-equivalent",
    incumbent: "Redrawn seat",
    demCandidate: "Democrat",
    repCandidate: "Republican",
    open: true,
    seatParty: "R",
    redistrictingNote: "Act 2 / SB 121 eliminates the prior second Democratic-leaning majority-Black seat; LA-06 is modeled as Republican-leaning unless litigation changes the map."
  }
};

function modelDateKey() {
  if (/^\d{4}-\d{2}-\d{2}$/.test(process.env.MODEL_DATE || "")) return process.env.MODEL_DATE;
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: SETTINGS.updateZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const zonedDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)));
  if (zonedDate.getUTCHours() < 6 || (zonedDate.getUTCHours() === 6 && zonedDate.getUTCMinutes() < 20)) {
    zonedDate.setUTCDate(zonedDate.getUTCDate() - 1);
  }
  return zonedDate.toISOString().slice(0, 10);
}

const MODEL_DATE_KEY = modelDateKey();
const random = mulberry32(hashString(`house-${MODEL_DATE_KEY}`));
const GENERATION_STARTED_AT = Date.now();
const GENERATION_BUDGET_MS = Math.max(15000, Number(process.env.FORECAST_GENERATION_BUDGET_MS || 90000));

async function fetchText(url, label, status, options = {}) {
  if (OFFLINE) {
    status[label] = { health: "DISABLED", ok: true, status: "DISABLED", reason: "Offline generation mode" };
    return null;
  }
  const started = Date.now();
  const remaining = GENERATION_BUDGET_MS - (started - GENERATION_STARTED_AT);
  if (remaining <= 0) {
    status[label] = { health: "TIMEOUT", ok: false, status: "TIMEOUT", url, error: "Global generation time budget exhausted." };
    return "";
  }
  const controller = new AbortController();
  const timeoutMs = Math.min(options.timeoutMs || 12000, remaining);
  console.log(`[house] fetching ${label} (timeout ${timeoutMs}ms)`);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "CapitolForecastBot/1.0 (+https://github.com/)",
        "accept": "text/html,application/json,text/plain,*/*"
      }
    });
    const text = await response.text();
    const record = recordFetch(status, label, response, text, url, started, options);
    console.log(`[house] ${label}: ${record.status}`);
    status[label].bytes = text.length;
    return record.ok ? text : "";
  } catch (error) {
    recordFetchError(status, label, error, url, started);
    console.warn(`[house] ${label}: ${status[label].status}`);
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function htmlToLines(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&quot;/g, "\"")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseCookDistricts(html) {
  const lines = htmlToLines(html);
  const districts = [];
  let rating = null;
  for (const line of lines) {
    const category = Object.keys(CATEGORY_ALIASES).find((name) => line.startsWith(`${name} (`) || line === name);
    if (category) {
      rating = CATEGORY_ALIASES[category];
      continue;
    }
    const match = line.match(/^([A-Z]{2})-(AL|\d{1,2})\s+(.+)$/);
    if (!match || !rating) continue;
    const district = `${match[1]}-${match[2] === "AL" ? "AL" : String(Number(match[2])).padStart(2, "0")}`;
    if (STATELESS_DISTRICTS.has(district)) continue;
    const label = match[3].replace(/\s+/g, " ").trim();
    districts.push({
      id: district,
      state: match[1],
      district: match[2],
      label,
      incumbent: label,
      open: /\bOPEN\b|\bVACANT\b/i.test(label),
      rating,
      ratingSource: "Cook"
    });
  }
  return uniqueDistricts(districts);
}

function extractJsonAssignment(html, marker) {
  if (typeof html !== "string" || !html) return null;
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = html.indexOf("{", markerIndex);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return html.slice(start, index + 1);
  }
  return null;
}

function parse270MapDistricts(html) {
  if (typeof html !== "string" || !html) return [];
  const json = extractJsonAssignment(html, "map_d3.seats =");
  if (!json) return [];
  const parsed = JSON.parse(json);
  return Object.values(parsed).flat().map((district) => {
    const state = district.state_abbr;
    const number = Number(district.district_number);
    const atLarge = String(district.district_id_combo || "").endsWith("00");
    const id = `${state}-${atLarge ? "AL" : String(number).padStart(2, "0")}`;
    const parsedPresidentialMargin = toNumber(district.margin_president);
    const parsedCongressionalMargin = toNumber(district.margin_congress);
    // The upstream 0/0 placeholder is not an actual tied baseline.
    const presidentialMargin = parsedPresidentialMargin === 0 ? null : parsedPresidentialMargin;
    const congressionalMargin = parsedCongressionalMargin === 0 ? null : parsedCongressionalMargin;
    const hasPresidentialMargin = Number.isFinite(presidentialMargin) && Math.abs(presidentialMargin) > .01;
    const hasCongressionalMargin = Number.isFinite(congressionalMargin) && Math.abs(congressionalMargin) > .01;
    const previousResultComparable = hasCongressionalMargin && Math.abs(congressionalMargin) <= 70;
    // Several source rows use 0/0 as a missing-value placeholder. Preserve a
    // genuine close margin when data exists, but do not turn missing rows into
    // artificial tossups.
    const fundamentalMargin = previousResultComparable
      ? (hasPresidentialMargin ? presidentialMargin * .55 : 0) + congressionalMargin * .45
      : hasPresidentialMargin ? presidentialMargin : null;
    const incumbent = String(district.seat_rep_name || "").trim() || "Open seat";
    const label = district.retired_code ? `${incumbent} / open` : incumbent;
    const demCandidate = (district.candidates || []).find((candidate) => candidate.party === "D")?.full_name || "Democrat";
    const repCandidate = (district.candidates || []).find((candidate) => candidate.party === "R")?.full_name || "Republican";
    return {
      id,
      state,
      district: atLarge ? "AL" : String(number),
      label,
      incumbent,
      open: Boolean(district.retired_code) || /\bopen\b|\bvacant\b/i.test(String(district.retired_notes || "")),
      rating: ratingFromMargin(fundamentalMargin),
      ratingSource: "270toWin / Inside Elections",
      seatParty: district.seat_party || null,
      presidentialMargin,
      congressionalMargin,
      districtBaseline: {
        presidentialMargin,
        congressionalMargin,
        status: Number.isFinite(presidentialMargin) || Number.isFinite(congressionalMargin) ? "AVAILABLE" : "MISSING",
        fallbackUsed: Number.isFinite(presidentialMargin) ? "PRESIDENTIAL_MARGIN" : "LOCAL_CONTEXTUAL_BASELINE"
      },
      previousResult: {
        congressionalMargin,
        comparable: previousResultComparable,
        reason: previousResultComparable ? null : "UNCONTESTED_OR_NEAR_UNCONTESTED",
        fallbackBaseline: hasPresidentialMargin ? "presidentialMargin" : "districtBaseline"
      },
      fundamentalMargin: Number.isFinite(fundamentalMargin) ? Number(fundamentalMargin.toFixed(2)) : null,
      rawMarginNote: "Raw 270toWin district margin fields are stored for context only; the model does not assume they are signed Democratic margins.",
      kalshiPrice: toNumber(district.kalshi_price),
      demCandidate,
      repCandidate
    };
  }).filter((district) => district.id && !STATELESS_DISTRICTS.has(district.id));
}

function publicHouseRatingFallback(district, sourceData) {
  if (!district || sourceData?.usingCachedDistricts) return { rating: null, source: null };
  const source = String(district.ratingSource || "");
  if (!/^Cook\b/i.test(source)) return { rating: null, source: null };
  return {
    rating: district.sourceRating || district.rating || null,
    source
  };
}

function ratingFromMargin(margin) {
  if (!Number.isFinite(margin)) return "Toss-up";
  const abs = Math.abs(margin);
  const side = margin > 0 ? "D" : "R";
  if (abs >= 14) return `Safe ${side}`;
  if (abs >= 7) return `Likely ${side}`;
  if (abs >= 3) return `Lean ${side}`;
  if (abs >= 1) return `Tilt ${side}`;
  return "Toss-up";
}

function parseInsideRatings(html) {
  const lines = htmlToLines(html);
  const ratings = {};
  let rating = null;
  for (const line of lines) {
    if (/^Likely Dem/.test(line)) rating = "Likely D";
    else if (/^Leans Dem/.test(line)) rating = "Lean D";
    else if (/^Tilt Dem/.test(line)) rating = "Tilt D";
    else if (/^Toss-up/.test(line)) rating = "Toss-up";
    else if (/^Tilt Rep/.test(line)) rating = "Tilt R";
    else if (/^Leans Rep/.test(line)) rating = "Lean R";
    else if (/^Likely Rep/.test(line)) rating = "Likely R";
    const match = line.match(/^([A-Z]{2})-(AL|\d{1,2})\s+(.+)$/);
    if (match && rating) {
      ratings[`${match[1]}-${match[2] === "AL" ? "AL" : String(Number(match[2])).padStart(2, "0")}`] = {
        rating,
        label: match[3].trim()
      };
    }
  }
  return ratings;
}

function uniqueDistricts(districts) {
  const seen = new Map();
  for (const district of districts) seen.set(district.id, district);
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

async function fetchGenericPolling(status) {
  const [votehubJson, pollfinityJson, usPollingHtml] = await Promise.all([
    fetchText("https://api.votehub.com/polls?poll_type=generic-ballot&subject=2026", "votehubGenericBallot", status, { timeoutMs: 12000, expected: "json" }),
    fetchText("https://pollfinity.com/averages.json", "pollfinityAverages", status, { timeoutMs: 12000, expected: "json" }),
    fetchText("https://uspollingdata.com/polls/generic-ballot/", "usPollingDataGenericBallot", status, { timeoutMs: 12000 })
  ]);
  const canonical = blendGenericBallotSources([
    parseCanonicalVoteHubGeneric(votehubJson),
    parseCanonicalPollfinityGeneric(pollfinityJson),
    parseCanonicalUsPollingDataGeneric(usPollingHtml)
  ], { sourceHealth: status });
  if (!parseCanonicalVoteHubGeneric(votehubJson)) markNoRows(status, "votehubGenericBallot");
  if (!parseCanonicalPollfinityGeneric(pollfinityJson)) markNoRows(status, "pollfinityAverages");
  if (!parseCanonicalUsPollingDataGeneric(usPollingHtml)) markNoRows(status, "usPollingDataGenericBallot");
  const senateFallback = readCachedGenericBallot();
  // Senate owns the live canonical blend. House consumes the checked-in blend
  // so the raw national environment cannot silently diverge by parser.
  if (senateFallback?.margin != null) {
    status.senateGenericPollingFallback = { ok: true, status: "local", ms: 0 };
    return senateFallback;
  }
  return canonical;
}

function readSenateGenericPolling() {
  try {
    const senate = JSON.parse(readFileSync(SENATE_FORECAST_URL, "utf8"));
    const generic = senate.sourceSummary?.genericPolling;
    if (!Number.isFinite(generic?.genericBallotMargin)) return null;
    return {
      margin: generic.genericBallotMargin,
      sources: (generic.sources || []).map((source) => ({
        source: `${source.source} via Senate run`,
        margin: source.margin,
        dem: source.dem,
        rep: source.rep,
        polls: source.polls,
        weight: source.weight
      }))
    };
  } catch {
    return null;
  }
}

function parseVoteHubGeneric(html) {
  if (!html) return null;
  try {
    const data = JSON.parse(html);
    const polls = Array.isArray(data) ? data : Array.isArray(data.polls) ? data.polls : [];
    const rows = polls.map((poll) => {
      const answers = Array.isArray(poll.answers) ? poll.answers : [];
      const dem = Number(poll.democrat ?? poll.dem ?? answers.find((answer) => /^dem/i.test(answer.choice || ""))?.pct);
      const rep = Number(poll.republican ?? poll.rep ?? answers.find((answer) => /^rep/i.test(answer.choice || ""))?.pct);
      return { dem, rep };
    }).filter((poll) => Number.isFinite(poll.dem) && Number.isFinite(poll.rep));
    if (rows.length) {
      const dem = rows.reduce((sum, poll) => sum + poll.dem, 0) / rows.length;
      const rep = rows.reduce((sum, poll) => sum + poll.rep, 0) / rows.length;
      return { source: "VoteHub", margin: dem - rep, dem, rep, polls: rows.length, weight: 1 };
    }
  } catch {
    // Legacy HTML parsing below remains for a valid public HTML response.
  }
  const dem = firstNumberAfter(html, /Democrats?[^0-9]{0,80}([0-9]+(?:\.[0-9]+)?)/i);
  const rep = firstNumberAfter(html, /Republicans?[^0-9]{0,80}([0-9]+(?:\.[0-9]+)?)/i);
  const explicit = firstNumberAfter(html, /Democrats?\s*\+([0-9]+(?:\.[0-9]+)?)/i);
  if (Number.isFinite(dem) && Number.isFinite(rep)) return { source: "VoteHub", margin: dem - rep, dem, rep, weight: 1 };
  if (Number.isFinite(explicit)) return { source: "VoteHub", margin: explicit, weight: .8 };
  return null;
}

function parseDdhqGeneric(json) {
  if (!json) return null;
  const nums = [...json.matchAll(/"y"\s*:\s*([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Number(match[1]));
  if (nums.length < 2) return null;
  const dem = nums.at(-2);
  const rep = nums.at(-1);
  if (!Number.isFinite(dem) || !Number.isFinite(rep)) return null;
  return { source: "DDHQ", margin: dem - rep, dem, rep, weight: .75 };
}

function parsePollfinityGeneric(json) {
  if (!json) return null;
  try {
    const data = JSON.parse(json);
    const current = data?.tracks?.generic_ballot?.current;
    const dem = Number(current?.democrat ?? current?.dem ?? current?.democratic);
    const rep = Number(current?.republican ?? current?.rep ?? current?.gop);
    const margin = Number(current?.dem_lead);
    if (Number.isFinite(margin) || (Number.isFinite(dem) && Number.isFinite(rep))) {
      return { source: "Pollfinity", margin: Number.isFinite(margin) ? margin : dem - rep, dem, rep, polls: Number(data?.tracks?.generic_ballot?.polls_in_average || 0), weight: .55 };
    }
  } catch {
    // Fall through to the defensive text parser for a future schema change.
  }
  const dem = firstNumberAfter(json, /Dem(?:ocrat(?:ic|s)?)?["\s:,_-]{0,30}([0-9]+(?:\.[0-9]+)?)/i);
  const rep = firstNumberAfter(json, /Rep(?:ublican(?:s)?)?["\s:,_-]{0,30}([0-9]+(?:\.[0-9]+)?)/i);
  if (!Number.isFinite(dem) || !Number.isFinite(rep)) return null;
  return { source: "Pollfinity", margin: dem - rep, dem, rep, weight: .45 };
}

function parseUsPollingDataGeneric(html) {
  if (!html) return null;
  const margin = firstNumberAfter(html, /Democrats?\s*\+([0-9]+(?:\.[0-9]+)?)/i);
  if (Number.isFinite(margin)) return { source: "USPollingData", margin, weight: .45 };
  return null;
}

function firstNumberAfter(text, pattern) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

function pollsterKey(value) {
  return String(value || "unknown")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[^a-z0-9 ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() || "unknown";
}

function housePollPriority(poll) {
  const source = String(poll.source || "").toLowerCase();
  if (source.includes("realclear")) return 5;
  if (source.includes("270towin")) return 4;
  if (source.includes("race to the wh")) return 3;
  return 1;
}

function dedupeHousePolls(polls = []) {
  const rows = new Map();
  for (const poll of polls) {
    if (!poll || !Number.isFinite(poll.margin) || Math.abs(poll.margin) > 50) continue;
    const key = `${pollsterKey(poll.pollster)}|${poll.endDate || poll.days || "unknown"}`;
    const existing = rows.get(key);
    if (!existing || housePollPriority(poll) > housePollPriority(existing)) rows.set(key, poll);
  }
  return [...rows.values()];
}

function housePollSignal(polls = []) {
  const modelDate = new Date("2026-06-19T12:00:00Z");
  const halfLife = clamp(28 + Math.max(0, (new Date("2026-11-03T12:00:00Z") - modelDate) / 86400000) * .18, 32, 85);
  const weighted = dedupeHousePolls(polls).reduce((total, poll) => {
    const date = new Date(`${poll.endDate}T12:00:00Z`);
    if (!poll.endDate || Number.isNaN(date.getTime()) || (modelDate - date) / 86400000 > 180) return total;
    const age = Math.max(0, (modelDate - date) / 86400000);
    const recency = Math.pow(.5, age / halfLife);
    const population = String(poll.population || "").toLowerCase();
    const populationWeight = population.includes("likely") || population === "lv" ? 1.08 : population.includes("registered") || population === "rv" ? 1 : .88;
    const sampleWeight = Number.isFinite(poll.sampleSize) ? clamp(Math.sqrt(poll.sampleSize) / 32, .62, 1.35) : .82;
    const repeatedPollster = total.pollsters[pollsterKey(poll.pollster)] || 0;
    const weight = recency * populationWeight * sampleWeight * (.72 + housePollPriority(poll) * .06) / Math.sqrt(1 + repeatedPollster);
    total.pollsters[pollsterKey(poll.pollster)] = repeatedPollster + weight;
    total.margin += poll.margin * weight;
    total.square += poll.margin * poll.margin * weight;
    total.weight += weight;
    total.count += 1;
    return total;
  }, { margin: 0, square: 0, weight: 0, count: 0, pollsters: {} });
  if (!weighted.weight) return null;
  const pollsters = Object.keys(weighted.pollsters).length;
  const margin = weighted.margin / weighted.weight;
  return {
    margin,
    pollCount: weighted.count,
    pollsters,
    totalWeight: weighted.weight,
    blendWeight: clamp(.08 + Math.log1p(weighted.weight) * .055 + pollsters * .018, .08, .28),
    disagreement: Number(Math.sqrt(Math.max(0, weighted.square / weighted.weight - margin * margin)).toFixed(2)),
    recencyHalfLifeDays: Number(halfLife.toFixed(1))
  };
}

function parseHousePollDate(lines, start) {
  for (let index = start; index < Math.min(lines.length, start + 18); index += 1) {
    const match = lines[index].match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?(?:,?\s*2026)?\b/i);
    if (!match) continue;
    const normalized = match[0].replace(/\s*[-–]\s*\d{1,2}/, "").replace(/,?\s*2026/i, "") + " 2026";
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}

function parseHousePollReferences(html, source, districts) {
  if (!html) return {};
  const lines = htmlToLines(html);
  const byDistrict = {};
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index];
    const districtMatch = heading.match(/\b([A-Z]{2})\s*[- ]\s*(AL|\d{1,2})\b/i);
    if (!districtMatch || !/house|district|congress/i.test(heading)) continue;
    const id = `${districtMatch[1].toUpperCase()}-${districtMatch[2].toUpperCase() === "AL" ? "AL" : String(Number(districtMatch[2])).padStart(2, "0")}`;
    const district = districts.find((item) => item.id === id);
    if (!district) continue;
    const window = lines.slice(index, index + 22).join(" ");
    const demLast = String(district.demCandidate || "").split(/\s+/).at(-1).replace(/[^a-z]/gi, "");
    const repLast = String(district.repCandidate || "").split(/\s+/).at(-1).replace(/[^a-z]/gi, "");
    const spread = window.match(/([A-Za-z.'-]+)\s*\+\s*(\d+(?:\.\d+)?)/);
    if (!spread || !demLast || !repLast) continue;
    const leading = spread[1].toLowerCase();
    const side = leading.includes(demLast.toLowerCase()) ? "D" : leading.includes(repLast.toLowerCase()) ? "R" : null;
    if (!side) continue;
    const endDate = parseHousePollDate(lines, index);
    if (!endDate) continue;
    const sampleMatch = window.match(/([\d,]+)\s*(?:LV|RV|adults?|voters?)/i);
    byDistrict[id] ||= [];
    byDistrict[id].push({
      margin: side === "D" ? Number(spread[2]) : -Number(spread[2]),
      source,
      pollster: lines[index + 1] || source,
      endDate,
      sampleSize: sampleMatch ? Number(sampleMatch[1].replace(/,/g, "")) : null,
      population: /\bLV\b|likely voters/i.test(window) ? "lv" : /\bRV\b|registered voters/i.test(window) ? "rv" : "a"
    });
  }
  return byDistrict;
}

function mergeDistrictPollSources(...sources) {
  const merged = {};
  for (const source of sources) {
    for (const [id, polls] of Object.entries(source || {})) merged[id] = [...(merged[id] || []), ...polls];
  }
  return Object.fromEntries(Object.entries(merged).map(([id, polls]) => [id, dedupeHousePolls(polls)]));
}

function readDirectHousePollLedger() {
  const byDistrict = {};
  let skipped = 0;
  // Build only for districts already in the model. This keeps the ledger
  // permissive while avoiding a free-form district id becoming model input.
  for (const state of [...new Set([...Object.keys(STATE_COALITION_TRAITS), "DC"])]) {
    for (const suffix of ["AL", ...Array.from({ length: 53 }, (_, index) => String(index + 1).padStart(2, "0"))]) {
      const id = `${state}-${suffix}`;
      const result = directPollLedger({ office: "house", district: id });
      skipped += result.skipped;
      if (result.polls.length) byDistrict[id] = result.polls;
    }
  }
  return { byDistrict, polls: Object.values(byDistrict).reduce((sum, rows) => sum + rows.length, 0), skipped };
}

function toNumber(value) {
  const number = Number(String(value ?? "").replace(/[$,%]/g, "").trim());
  return Number.isFinite(number) ? number : null;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [headers = [], ...body] = rows;
  return body
    .filter((line) => line.some((value) => value !== ""))
    .map((line) => Object.fromEntries(headers.map((header, index) => [header, line[index] ?? ""])));
}

async function fetchHouseSources() {
  const status = { checkedAt: new Date().toISOString() };
  const [cookHtml, insideHtml, mapHtml, pollingHtml, raceToTheWhHouse, raceToTheWhGeneric, realClearGeneric, latestHousePolls, raceToTheWhAllPolls, censusHtml, fec, genericPolling] = await Promise.all([
    fetchText("https://www.cookpolitical.com/ratings/house-race-ratings", "cookHouseRatings", status),
    fetchText("https://www.270towin.com/2026-house-election/table/inside-elections-2026-house-ratings", "insideElections270ToWinRatings", status),
    fetchText("https://www.270towin.com/2026-house-election/inside-elections-2026-house-ratings", "twoSeventyToWinHouseMapData", status),
    fetchText("https://www.270towin.com/2026-house-election/polls/", "twoSeventyToWinHousePolls", status, { timeoutMs: 12000 }),
    fetchText("https://www.racetothewh.com/house-3", "raceToTheWhHouseForecast", status, { timeoutMs: 12000 }),
    fetchText("https://www.racetothewh.com/polls/genericballot", "raceToTheWhGenericBallot", status, { timeoutMs: 12000 }),
    fetchText("https://www.realclearpolitics.com/epolls/other/2026_generic_congressional_vote-8670.html", "realClearPoliticsGenericBallot", status, { timeoutMs: 12000 }),
    fetchText("https://www.realclearpolling.com/latest-polls/house", "realClearPollingHousePolls", status, { timeoutMs: 12000 }),
    fetchText("https://www.racetothewh.com/allpolls", "raceToTheWhAllPolls", status, { timeoutMs: 12000 }),
    fetchText("https://www.census.gov/geographies/mapping-files/2025/geo/carto-boundary-file.html", "censusDistrictBoundaries", status, { timeoutMs: 12000 }),
    fetchHouseFec(status),
    fetchGenericPolling(status)
  ]);
  let mapDistricts = parse270MapDistricts(mapHtml);
  const cookDistricts = parseCookDistricts(cookHtml);
  const ratingsUnavailable = mapDistricts.length < 400 && cookDistricts.length < 400;
  const cachedDistricts = Array.isArray(previousForecast?.districts) ? previousForecast.districts : [];
  const usingCachedDistricts = ratingsUnavailable && cachedDistricts.length >= 400;
  if (usingCachedDistricts) {
    // A public ratings page is optional source context, not the district
    // universe. Preserve the last checked-in universe when it is unavailable.
    mapDistricts = cachedDistricts.map((district) => ({ ...district, ratingSource: "Cached prior house forecast" }));
    status.houseDistrictFallback = {
      health: "STALE",
      ok: false,
      status: "STALE",
      districts: mapDistricts.length,
      reason: "Ratings/map pages were unavailable; using the prior checked-in district universe."
    };
  }
  const pollingDistricts = mapDistricts.length ? mapDistricts : cookDistricts;
  const directPolls = readDirectHousePollLedger();
  const fiftyPlusOne = loadFiftyPlusOnePolls("house", status);
  const fiftyPlusOneByDistrict = Object.groupBy(fiftyPlusOne.polls.filter((poll) => poll.district), (poll) => poll.district);
  const wikipediaPolling = readWikipediaPollingCache("house");
  const wikipediaByDistrict = Object.groupBy((wikipediaPolling.rows || [])
    .filter((poll) => poll.district)
    .map((poll) => ({
      ...poll,
      source: poll.source || "Wikipedia",
      secondaryReported: true
    })), (poll) => poll.district);
  status.directPollLedger = {
    health: directPolls.polls ? "OK_PARSED" : "OK_NO_ROWS",
    ok: true,
    status: directPolls.polls ? "OK_PARSED" : "OK_NO_ROWS",
    rows: directPolls.polls,
    skipped: directPolls.skipped,
    url: "data/direct-poll-ledger.json"
  };
  const districtPolls = mergeDistrictPollSources(
    parseHousePollReferences(pollingHtml, "270toWin", pollingDistricts),
    parseHousePollReferences(latestHousePolls, "RealClearPolling", pollingDistricts),
    parseHousePollReferences(raceToTheWhHouse, "Race to the WH", pollingDistricts),
    parseHousePollReferences(raceToTheWhAllPolls, "Race to the WH", pollingDistricts),
    directPolls.byDistrict,
    fiftyPlusOneByDistrict,
    wikipediaByDistrict
  );
  status.houseDistrictPolls = {
    ok: true,
    status: "parsed",
    districts: Object.keys(districtPolls).length,
    polls: Object.values(districtPolls).reduce((sum, polls) => sum + polls.length, 0),
    directPolls: directPolls.polls,
    skippedDirectPolls: directPolls.skipped,
    note: "Only structured/current district matchups are blended; generic ballot data remains a separate national signal."
  };
  status.wikipediaHousePolling = {
    ok: true,
    health: wikipediaPolling.status || "MANUAL_NOT_CONFIGURED",
    status: wikipediaPolling.status || "MANUAL_NOT_CONFIGURED",
    rawRows: wikipediaPolling.rawRows?.length || 0,
    usableRows: wikipediaPolling.usableRows?.length || 0,
    rejectedRows: wikipediaPolling.rejectedRows?.length || 0,
    rows: wikipediaPolling.rows?.length || 0,
    usedInModel: wikipediaPolling.usedInModel === true,
    pollingValidation: wikipediaPolling.pollingValidation || null,
    averages: wikipediaPolling.averages?.length || 0,
    warnings: wikipediaPolling.warnings || [],
    url: "data/cache/polls/wikipedia-house-2026.json"
  };
  const sourceHealth = sourceHealthSummary(status, {
    critical: ["votehubGenericBallot", "pollfinityAverages", "twoSeventyToWinHousePolls"]
  });
  return {
    status,
    sourceHealth,
    cookDistricts,
    mapDistricts,
    insideRatings: parseInsideRatings(insideHtml),
    fec,
    genericPolling,
    wikipediaPolling,
    districtPolls,
    housePollingReferenceReachable: Boolean(pollingHtml),
    raceToTheWhHouseReachable: Boolean(raceToTheWhHouse),
    raceToTheWhGenericReachable: Boolean(raceToTheWhGeneric),
    realClearGenericReachable: Boolean(realClearGeneric),
    realClearHousePollsReachable: Boolean(latestHousePolls),
    censusDistrictBoundaryPageReachable: Boolean(censusHtml),
    usingCachedDistricts
  };
}

function adjustedDistricts(sourceData) {
  const genericBallotRawMargin = Number(sourceData.genericPolling?.margin);
  const genericBallotElasticity = .38;
  const genericShift = clamp(genericBallotRawMargin * genericBallotElasticity, -3.4, 3.4);
  const nationalFinanceShift = (sourceData.fec.__national?.financeSignal || 0) * MODEL_WEIGHTS.nationalFinance;
  const baseDistricts = sourceData.mapDistricts.length >= 400 ? sourceData.mapDistricts : sourceData.cookDistricts;
  return baseDistricts.map((sourceDistrict) => {
    const districtWithCandidates = applyRedistrictingOverride(applyCandidateData(sourceDistrict, sourceData.fec[sourceDistrict.id]));
    const initialFundamentalsPrior = houseFundamentalsPrior(districtWithCandidates, sourceData);
    const district = applyHouseFundamentalsPrior(districtWithCandidates, initialFundamentalsPrior);
    const fundamentalsPrior = houseFundamentalsPrior(district, sourceData);
    const nomination = houseNominationInfo(district);
    const contextMargin = contextualDistrictMargin(district);
    const baselineMargin = contextMargin * MODEL_WEIGHTS.districtBaseline;
    const incumbentParty = district.seatParty === "D" ? 1 : district.seatParty === "R" ? -1 : 0;
    const challengerStrength = districtChallengerStrength(district);
    const incumbencyAdjustment = district.open ? 0 : incumbentParty * MODEL_WEIGHTS.seatPartyIncumbency * (1 - (CHALLENGER_STRENGTH_DISCOUNTS[challengerStrength] || 0));
    const openPenalty = district.open ? (baselineMargin > 0 ? -MODEL_WEIGHTS.incumbencyOpenPenalty : MODEL_WEIGHTS.incumbencyOpenPenalty) : 0;
    const financeSignal = sourceData.fec[district.id]?.financeSignal ?? 0;
    const demographicPull = houseDemographicPull(district, challengerStrength);
    const candidateQualityAdjustment = houseCandidateQualityAdjustment(district, nomination);
    const nominationAdjustment = nomination.marginAdjustment * MODEL_WEIGHTS.nominationCertainty;
    const districtPollRows = sourceData.districtPolls?.[district.id] || [];
    const pollingSummary = classifyPollingInputs(districtPollRows, sourceData.status || {});
    const districtPollSignal = housePollSignal(districtPollRows);
    const districtPollingAdjustment = districtPollSignal
      ? clamp(districtPollSignal.margin * districtPollSignal.blendWeight, -3.4, 3.4)
      : 0;
    const preMarketMargin = baselineMargin + genericShift + nationalFinanceShift + MODEL_WEIGHTS.historicalMidterm + incumbencyAdjustment + openPenalty + demographicPull.adjustment + financeSignal * MODEL_WEIGHTS.finance + candidateQualityAdjustment + nominationAdjustment + districtPollingAdjustment;
    const provisionalError = houseRaceError(district, contextMargin, nomination);
    const marketSignal = houseMarketSignal(district, provisionalError);
    const rawMargin = marketSignal
      ? preMarketMargin * (1 - marketSignal.weight) + marketSignal.impliedMargin * marketSignal.weight
      : preMarketMargin;
    const guardrail = houseMarginGuardrail(district, rawMargin, contextMargin, districtPollSignal);
    const rawProbabilityMargin = guardrail.margin;
    const rawProjectedMargin = projectedHouseResultMargin(district, rawMargin, contextMargin, districtPollSignal, guardrail);
    const mapConflict = district.redistrictingConfidence === "CONFLICTING_SOURCES";
    const ratingBenchmark = benchmarkFor(`${district.id}-2026`);
    const fundamentalsQuality = fundamentalsPrior.qualityForRating;
    const publicRatingFallback = publicHouseRatingFallback(district, sourceData);
    const ratingsPrior = buildRatingPrior({
      office: "house",
      raceId: `${district.id}-2026`,
      benchmark: ratingBenchmark,
      fallbackRating: publicRatingFallback.rating,
      fallbackSource: publicRatingFallback.source || "Public district source",
      rawModelMargin: rawProbabilityMargin,
      pollingSummary,
      fundamentalsQuality,
      sourceDegraded: Boolean(sourceData.sourceHealth?.degraded),
      mapConflict,
      ratingSourceType: ratingBenchmark?.cacheMeta?.ratingSourceType || null,
      config: RATING_WEIGHT_CONFIG
    });
    const priorAdjustedProbabilityMargin = applyRatingPrior(rawProbabilityMargin, ratingsPrior, ratingsPrior.probabilityPullStrength);
    const probabilityRatingGuardrail = applyRatingGuardrail(priorAdjustedProbabilityMargin, ratingsPrior);
    const probabilityMargin = probabilityRatingGuardrail.margin;
    const priorAdjustedProjectedMargin = applyRatingPrior(rawProjectedMargin, ratingsPrior, ratingsPrior.projectedResultPullStrength);
    const projectedRatingGuardrail = applyRatingGuardrail(priorAdjustedProjectedMargin, ratingsPrior);
    const projectedMargin = clamp(projectedRatingGuardrail.margin, -68, 68);
    const ratingGuardrail = {
      probability: probabilityRatingGuardrail,
      projected: projectedRatingGuardrail,
      triggered: Boolean(probabilityRatingGuardrail.triggered || projectedRatingGuardrail.triggered)
    };
    const raceSourceHealth = houseRaceSourceHealth({ sourceData, pollingSummary, fundamentalsPrior, ratingsPrior, mapConflict });
    const historicalComparison = houseHistoricalComparison(district, projectedMargin, realisticDistrictBaseline(district, contextMargin), districtPollSignal, marketSignal);
    const error = houseRaceError(district, contextMargin, nomination, districtPollSignal);
    const demProbability = logistic(probabilityMargin, error);
    const { sourceRating: _legacySourceRating, ...districtWithoutLegacyRating } = district;
    const modelRating = ratingFromMargin(projectedMargin);
    const confidence = houseConfidence(district, probabilityMargin, pollingSummary, raceSourceHealth, mapConflict);
    const inputBalance = buildInputBalance({
      fundamentals: districtPollSignal ? 62 : 76,
      polling: districtPollSignal ? 22 : 0,
      nationalEnvironment: 10,
      finance: 7,
      ratings: ratingsPrior.inputWeight
    });
    const marginFields = marginSplit(projectedMargin, probabilityMargin, ratingsPrior.impliedMargin ?? projectedMargin);
    const benchmarkComparison = houseBenchmarkComparison(district, projectedMargin, demProbability, districtPollSignal, raceSourceHealth);
    const dataQualityWarnings = [
      ...benchmarkComparison.benchmarkWarnings,
      ...(ratingsPrior.warnings || []),
      ...(ratingGuardrail.triggered ? [{
        severity: "warning",
        type: "rating-guardrail-applied",
        message: `External rating guardrail constrained ${district.id} because race-specific inputs were thin.`
      }] : []),
      ...(raceSourceHealth.warnings || []),
      pollingStatusWarning(pollingSummary),
      ...(district.redistrictingWarnings || []).map((message) => ({ severity: "warning", type: "redistricting-conflict", message }))
    ].filter(Boolean);
    return {
      ...districtWithoutLegacyRating,
      baselineRating: ratingFromMargin(contextMargin),
      rating: mapConflict ? "Map Conflict" : modelRating,
      modelRating,
      ratingIsConditional: mapConflict,
      forecastStatus: mapConflict ? "SCENARIO_ONLY" : raceSourceHealth.forecastStatus,
      margin: Number(projectedMargin.toFixed(2)),
      projectedMargin: Number(projectedMargin.toFixed(2)),
      probabilityEngineMargin: Number(probabilityMargin.toFixed(2)),
      preRatingProbabilityMargin: Number(rawProbabilityMargin.toFixed(2)),
      preRatingProjectedMargin: Number(rawProjectedMargin.toFixed(2)),
      priorAdjustedProbabilityMargin: Number(priorAdjustedProbabilityMargin.toFixed(2)),
      priorAdjustedProjectedMargin: Number(priorAdjustedProjectedMargin.toFixed(2)),
      ratingsPrior,
      ratingGuardrail,
      ...marginFields,
      inputBalance,
      pollCount: pollingSummary.usablePollCount,
      usablePollCount: pollingSummary.usablePollCount,
      livePollCount: pollingSummary.livePollCount,
      manualPollCount: pollingSummary.manualPollCount,
      legacyFallbackPollCount: pollingSummary.legacyFallbackPollCount,
      totalPollInputsUsed: pollingSummary.totalPollInputsUsed,
      pollingStatus: pollingSummary.pollingStatus,
      forecastMode: pollingSummary.usablePollCount ? "POLL_INFORMED" : "FUNDAMENTALS_ONLY",
      mapVersion: district.mapVersion || "2026 enacted map / 119th Congress geometry",
      districtDataSource: sourceData.usingCachedDistricts ? "Cached prior forecast district universe" : (district.ratingSource || "Public district source"),
      lastUpdated: new Date().toISOString(),
      previousResultComparable: Boolean(district.previousResult?.comparable),
      previousResult: district.previousResult || null,
      redistrictingConfidence: district.redistrictingConfidence || "UNKNOWN",
      redistrictingAsOf: district.redistrictingAsOf || null,
      redistrictingSources: district.redistrictingSources || [],
      redistrictingWarnings: district.redistrictingWarnings || [],
      demProbability: Number(demProbability.toFixed(4)),
      repProbability: Number((1 - demProbability).toFixed(4)),
      winnerParty: demProbability >= .5 ? "D" : "R",
      winnerProbability: Number(Math.max(demProbability, 1 - demProbability).toFixed(4)),
      error,
      competitive: Math.abs(probabilityMargin) < 8,
      historicalComparison,
      sourceInputs: {
        // genericBallotShift remains for backwards-compatible clients only.
        genericBallotShift: Number(genericShift.toFixed(2)),
        genericBallotRawMargin: Number.isFinite(genericBallotRawMargin) ? Number(genericBallotRawMargin.toFixed(2)) : null,
        genericBallotAppliedEffect: Number(genericShift.toFixed(2)),
        genericBallotElasticity,
        nationalFinanceShift: Number(nationalFinanceShift.toFixed(2)),
        presidentialBaseline: Number.isFinite(district.presidentialMargin) ? Number(district.presidentialMargin.toFixed(2)) : null,
        congressionalBaseline: Number.isFinite(district.congressionalMargin) ? Number(district.congressionalMargin.toFixed(2)) : null,
        districtFundamentalMargin: Number.isFinite(district.fundamentalMargin) ? Number(district.fundamentalMargin.toFixed(2)) : null,
        realisticBaseline: Number(realisticDistrictBaseline(district, contextMargin).toFixed(2)),
        contextualBaseline: Number(contextMargin.toFixed(2)),
        districtBaseline: Number(contextMargin.toFixed(2)),
        fundamentalsQuality,
        fundamentalsPrior,
        openPenalty: Number(openPenalty.toFixed(2)),
        incumbencyAdjustment: Number(incumbencyAdjustment.toFixed(2)),
        nomination,
        candidateQualityAdjustment: Number(candidateQualityAdjustment.toFixed(2)),
        nominationAdjustment: Number(nominationAdjustment.toFixed(2)),
        districtPolling: districtPollSignal ? {
          ...districtPollSignal,
          adjustment: Number(districtPollingAdjustment.toFixed(2)),
          polls: (sourceData.districtPolls?.[district.id] || []).slice(0, 8).map(({ source, pollster, endDate, margin, sampleSize, population }) => ({ source, pollster, endDate, margin, sampleSize, population }))
        } : null,
        marketSignal,
        ratingsPrior,
        ratingGuardrail,
        demographicPull,
        challengerStrength,
        finance: sourceData.fec[district.id] || null,
        sourceHealth: {
          forecast: raceSourceHealth.health,
          degraded: raceSourceHealth.degraded,
          reasons: raceSourceHealth.reasons,
          globalForecast: sourceData.sourceHealth?.health || "UNKNOWN",
          racePolling: districtPollSignal ? "OK_PARSED" : "OK_NO_ROWS",
          unavailableSources: sourceData.sourceHealth?.unavailableSources || []
        }
      },
      modelConfidence: houseModelConfidence(districtPollSignal, nomination, raceSourceHealth, pollingSummary),
      confidence,
      sourceHealth: {
        forecast: raceSourceHealth.health,
        degraded: raceSourceHealth.degraded,
        reasons: raceSourceHealth.reasons,
        globalForecast: sourceData.sourceHealth?.health || "UNKNOWN",
        racePolling: pollingSummary.pollingStatus,
        unavailableSources: sourceData.sourceHealth?.unavailableSources || []
      },
      matchupStatus: houseMatchupStatus(nomination),
      marginDecomposition: houseMarginDecomposition(district, realisticDistrictBaseline(district, contextMargin), genericShift, nationalFinanceShift, incumbencyAdjustment, openPenalty, demographicPull.adjustment, financeSignal, candidateQualityAdjustment, nominationAdjustment, districtPollingAdjustment, ratingsPrior.ratingPull * ratingsPrior.projectedResultPullStrength, guardrail, projectedMargin, ratingGuardrail),
      benchmarkComparison,
      dataQualityWarnings,
      primaryDate: nomination.primaryDate,
      primaryStatus: nomination.status,
      primarySummary: nomination.summary,
      demStatus: nomination.demStatus,
      repStatus: nomination.repStatus,
      demProfile: nomination.demProfile,
      repProfile: nomination.repProfile,
      sourceBlend: district.ratingSource
    };
  });
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function blendedFundamentalMargin(presidentialMargin, houseMargin) {
  const pres = finiteNumber(presidentialMargin);
  const house = finiteNumber(houseMargin);
  if (Number.isFinite(pres) && Number.isFinite(house)) return pres * .55 + house * .45;
  if (Number.isFinite(house)) return house;
  if (Number.isFinite(pres)) return pres;
  return null;
}

function houseFundamentalsPrior(district, sourceData) {
  const cached = HOUSE_FUNDAMENTALS_CACHE.get(district.id) || null;
  const cachedPresidential = finiteNumber(cached?.presidentialMargin2024);
  const rawCachedHouse = finiteNumber(cached?.houseMargin2024);
  const cachedHouseComparable = cached?.houseMargin2024Comparable !== false
    && Number.isFinite(rawCachedHouse)
    && Math.abs(rawCachedHouse) > .01
    && Math.abs(rawCachedHouse) <= 70;
  const cachedHouse = cachedHouseComparable ? rawCachedHouse : null;
  const cachedMargin = blendedFundamentalMargin(cachedPresidential, cachedHouse);
  if (cached && Number.isFinite(cachedMargin)) {
    return {
      district: district.id,
      source: "SOURCE_BACKED",
      independent: cached.independent !== false,
      confidence: cached.confidence || "MEDIUM",
      qualityForRating: cached.confidence === "LOW" ? "LOW" : "MEDIUM",
      margin: Number(cachedMargin.toFixed(2)),
      presidentialMargin2024: Number.isFinite(cachedPresidential) ? Number(cachedPresidential.toFixed(2)) : null,
      houseMargin2024: Number.isFinite(cachedHouse) ? Number(cachedHouse.toFixed(2)) : null,
      houseMargin2024Comparable: cachedHouseComparable,
      warnings: cached.warnings || [],
      sources: cached.sources || []
    };
  }
  const liveMargin = blendedFundamentalMargin(district.presidentialMargin, Number.isFinite(district.congressionalMargin) && Math.abs(district.congressionalMargin) <= 70 ? district.congressionalMargin : null);
  if (!sourceData.usingCachedDistricts && Number.isFinite(liveMargin)) {
    return {
      district: district.id,
      source: "LIVE_PUBLIC_MAP_SOURCE",
      independent: true,
      confidence: district.districtBaseline?.status === "MISSING" ? "LOW" : "MEDIUM",
      qualityForRating: district.districtBaseline?.status === "MISSING" ? "LOW" : "MEDIUM",
      margin: Number(liveMargin.toFixed(2)),
      presidentialMargin2024: Number.isFinite(district.presidentialMargin) ? Number(district.presidentialMargin.toFixed(2)) : null,
      houseMargin2024: Number.isFinite(district.congressionalMargin) && Math.abs(district.congressionalMargin) <= 70 ? Number(district.congressionalMargin.toFixed(2)) : null,
      houseMargin2024Comparable: Number.isFinite(district.congressionalMargin) && Math.abs(district.congressionalMargin) <= 70,
      warnings: [],
      sources: [district.ratingSource || "Public district source"]
    };
  }
  if (sourceData.usingCachedDistricts && Number.isFinite(district.fundamentalMargin)) {
    return {
      district: district.id,
      source: "DERIVED_FROM_PRIOR_FORECAST",
      independent: false,
      confidence: "LOW",
      qualityForRating: "DERIVED_FROM_PRIOR_FORECAST",
      margin: Number(district.fundamentalMargin.toFixed(2)),
      presidentialMargin2024: Number.isFinite(district.presidentialMargin) ? Number(district.presidentialMargin.toFixed(2)) : null,
      houseMargin2024: Number.isFinite(district.congressionalMargin) && Math.abs(district.congressionalMargin) <= 70 ? Number(district.congressionalMargin.toFixed(2)) : null,
      houseMargin2024Comparable: Number.isFinite(district.congressionalMargin) && Math.abs(district.congressionalMargin) <= 70,
      warnings: ["Fallback baseline came from a prior generated forecast and is low confidence."],
      sources: ["data/house-forecast.json"]
    };
  }
  return {
    district: district.id,
    source: "MISSING",
    independent: false,
    confidence: "MISSING",
    qualityForRating: "MISSING",
    margin: null,
    presidentialMargin2024: null,
    houseMargin2024: null,
    houseMargin2024Comparable: null,
    warnings: ["No independent district baseline was available."],
    sources: []
  };
}

function applyHouseFundamentalsPrior(district, prior) {
  if (!prior || !Number.isFinite(prior.margin) || prior.source === "DERIVED_FROM_PRIOR_FORECAST") return district;
  const priorHouseComparable = prior.houseMargin2024Comparable !== false
    && Number.isFinite(prior.houseMargin2024)
    && Math.abs(prior.houseMargin2024) > .01
    && Math.abs(prior.houseMargin2024) <= 70;
  return {
    ...district,
    presidentialMargin: Number.isFinite(prior.presidentialMargin2024) ? prior.presidentialMargin2024 : district.presidentialMargin,
    congressionalMargin: priorHouseComparable ? prior.houseMargin2024 : null,
    fundamentalMargin: prior.margin,
    districtBaseline: {
      ...(district.districtBaseline || {}),
      presidentialMargin: Number.isFinite(prior.presidentialMargin2024) ? prior.presidentialMargin2024 : district.districtBaseline?.presidentialMargin ?? null,
      congressionalMargin: priorHouseComparable ? prior.houseMargin2024 : null,
      status: "AVAILABLE",
      source: prior.source,
      independentInput: prior.independent,
      confidence: prior.confidence
    },
    previousResult: {
      ...(district.previousResult || {}),
      congressionalMargin: priorHouseComparable ? prior.houseMargin2024 : null,
      comparable: priorHouseComparable
    }
  };
}

function houseRaceSourceHealth({ sourceData, pollingSummary, fundamentalsPrior, ratingsPrior, mapConflict }) {
  const hasUsablePolls = Number(pollingSummary?.usablePollCount || 0) > 0;
  const hasIndependentBaseline = Boolean(fundamentalsPrior?.independent && Number.isFinite(fundamentalsPrior.margin));
  const hasBenchmark = Boolean(ratingsPrior?.consensusRating && !["RATING_UNAVAILABLE", "MAP_CONFLICT_RATING_DISABLED"].includes(ratingsPrior.ratingSourceType));
  const reasons = [];
  if (hasUsablePolls) reasons.push("usable race polling");
  else reasons.push("no usable district polling");
  if (hasIndependentBaseline) reasons.push("source-backed district baseline");
  if (hasBenchmark) reasons.push(`${ratingsPrior.ratingSourceType === "INFERRED_SAFE_RATING" ? "inferred safe" : "external"} rating benchmark`);
  if (ratingsPrior?.ratingsHeavy) reasons.push("ratings-heavy forecast");
  if (sourceData.sourceHealth?.degraded) reasons.push("global source degradation");
  if (mapConflict) {
    return {
      health: "DEGRADED",
      degraded: true,
      forecastStatus: "SCENARIO_ONLY",
      reasons: ["district map conflict", ...reasons],
      warnings: [{ severity: "warning", type: "map-conflict", message: "District map assumptions conflict; model output is scenario-only." }]
    };
  }
  if (hasUsablePolls && hasIndependentBaseline) {
    return {
      health: sourceData.sourceHealth?.degraded ? "PARTIAL" : "HEALTHY",
      degraded: Boolean(sourceData.sourceHealth?.degraded),
      forecastStatus: "NORMAL",
      reasons,
      warnings: []
    };
  }
  if (hasUsablePolls || hasIndependentBaseline || hasBenchmark) {
    const warning = !hasUsablePolls && !hasIndependentBaseline
      ? "Race has a benchmark rating but no usable polling or independent baseline."
      : !hasUsablePolls
        ? "Race has no usable live/manual district polling."
        : "Race lacks an independent district baseline.";
    return {
      health: !hasUsablePolls || ratingsPrior?.ratingsHeavy ? "PARTIAL" : "LIMITED_DATA",
      degraded: !hasUsablePolls && !hasIndependentBaseline,
      forecastStatus: !hasUsablePolls ? "LIMITED_DATA" : "NORMAL",
      reasons,
      warnings: [{ severity: "warning", type: "partial-house-race-inputs", message: warning }]
    };
  }
  return {
    health: "DEGRADED",
    degraded: true,
    forecastStatus: "DEGRADED",
    reasons: ["no usable polling", "missing or derived fundamentals", "no usable benchmark rating"],
    warnings: [{
      severity: "high",
      type: "degraded-house-race-inputs",
      message: "House race has no usable polling, no independent district baseline, and no usable benchmark rating."
    }]
  };
}

function houseToplineDivergenceExplanation(toplineComparison, noDistrictPolling, sourceData) {
  if (!toplineComparison?.warning) return null;
  const modelDemProbability = Number(toplineComparison.modelDemProbability);
  const benchmarkDemProbability = Number(toplineComparison.benchmarkDemProbability);
  const highSeverity = Number.isFinite(modelDemProbability)
    && Number.isFinite(benchmarkDemProbability)
    && modelDemProbability < 0.5
    && benchmarkDemProbability >= 0.65;
  const mainReasons = [];
  if (noDistrictPolling) mainReasons.push("No usable district-level polling.");
  mainReasons.push("House output remains heavily dependent on fundamentals and public ratings priors.");
  if (sourceData.sourceHealth?.degraded) mainReasons.push("One or more upstream source fetches were degraded during generation.");
  mainReasons.push("Review race-level guardrails where no-poll districts disagree with public benchmarks.");
  return {
    triggered: true,
    severity: highSeverity ? "high" : "warning",
    modelDemProbability: Number.isFinite(modelDemProbability) ? modelDemProbability : null,
    benchmarkDemProbability: Number.isFinite(benchmarkDemProbability) ? benchmarkDemProbability : null,
    difference: Number.isFinite(Number(toplineComparison.difference)) ? Number(toplineComparison.difference) : null,
    mainReasons,
    reviewRequired: true
  };
}

function houseMarginGuardrail(district, rawMargin, contextMargin, pollSignal = null) {
  const anchor = contextMargin;
  let margin = rawMargin * .86 + anchor * .14;
  const fundamentalSide = Math.sign(contextMargin);
  if (fundamentalSide && Math.sign(margin) !== fundamentalSide && Math.abs(contextMargin) >= 12 && !pollSignal) {
    margin = fundamentalSide * Math.max(6, Math.abs(margin) * .55);
  }
  if (isAtLargeDistrict(district) && Math.abs(district.fundamentalMargin || 0) >= 25 && fundamentalSide) {
    margin = fundamentalSide * Math.max(Math.abs(margin), 15);
  }
  const noPollCap = Math.abs(contextMargin) >= 18 ? 7 : Math.abs(contextMargin) >= 12 ? 9 : 12;
  const capped = pollSignal ? margin : clamp(margin, contextMargin - noPollCap, contextMargin + noPollCap);
  return {
    margin: capped,
    adjustment: Number((capped - rawMargin).toFixed(2)),
    reason: pollSignal ? "usable district polling available" : `fundamentals-only shift capped at ${noPollCap} points from district baseline`
  };
}

function realisticDistrictBaseline(district, contextMargin) {
  if (Number.isFinite(district.fundamentalMargin)) return clamp(district.fundamentalMargin, -62, 62);
  if (Number.isFinite(district.presidentialMargin) && Number.isFinite(district.congressionalMargin) && Math.abs(district.congressionalMargin) <= 70) {
    return clamp(district.presidentialMargin * .55 + district.congressionalMargin * .45, -62, 62);
  }
  if (Number.isFinite(district.presidentialMargin)) return clamp(district.presidentialMargin, -56, 56);
  return contextMargin;
}

function projectedHouseResultMargin(district, rawMargin, contextMargin, pollSignal, probabilityGuardrail) {
  const realisticBaseline = realisticDistrictBaseline(district, contextMargin);
  const modelAdjustment = rawMargin - contextMargin;
  let projected = realisticBaseline + modelAdjustment * (pollSignal ? .92 : .74);
  if (!pollSignal && Math.abs(realisticBaseline) >= 22) {
    const side = Math.sign(realisticBaseline);
    const floor = Math.min(44, Math.abs(realisticBaseline) * .72);
    projected = side * Math.max(Math.abs(projected), floor);
  }
  if (district.previousResult && !district.previousResult.comparable && !pollSignal) {
    projected = realisticBaseline + modelAdjustment * .55;
  }
  if (!Number.isFinite(projected)) return probabilityGuardrail.margin;
  return clamp(projected, -68, 68);
}

function houseMatchupStatus(nomination) {
  if (nomination?.demStatus === "unresolved" || nomination?.repStatus === "unresolved") return "PRIMARY_UNRESOLVED";
  if (nomination?.demProfile === "placeholder" || nomination?.repProfile === "placeholder") return "GENERIC_MATCHUP";
  if (nomination?.demStatus === "nominee" && nomination?.repStatus === "nominee") return "CONFIRMED_MATCHUP";
  return "LIKELY_MATCHUP";
}

function houseModelConfidence(pollSignal, nomination, sourceHealth, pollingSummary = {}) {
  let score = 46 + (pollingSummary.usablePollCount ? Math.min(28, 10 + pollingSummary.usablePollCount * 3 + (pollSignal?.pollsters || 0) * 2) : 0);
  if (nomination?.status === "resolved") score += 12;
  if (!pollingSummary.usablePollCount) score -= 8;
  if (sourceHealth?.degraded) score -= 12;
  score = Math.round(clamp(score, 20, 92));
  const label = score >= 72 ? "High" : score >= 50 ? "Medium" : "Low";
  return {
    score,
    label,
    level: sourceHealth?.degraded ? "DEGRADED" : label.toUpperCase(),
    reason: pollingSummary.usablePollCount ? "district polls and structural inputs" : "fundamentals-only or limited race polling",
    reasons: pollingSummary.usablePollCount ? ["usable district polling", "structural district inputs"] : ["no usable live/manual district polling", "structural district inputs"]
  };
}

function houseConfidence(district, margin, pollingSummary, sourceHealth, mapConflict) {
  const winConfidence = mapConflict ? "DEGRADED" : Math.abs(margin) >= 10 ? "HIGH" : Math.abs(margin) >= 4 ? "MEDIUM" : "LOW";
  const marginConfidence = pollingSummary.usablePollCount
    ? (pollingSummary.usablePollCount >= 2 ? "HIGH" : "MEDIUM")
    : "LOW";
  const dataConfidence = mapConflict || !district.districtBaseline || district.districtBaseline.status === "MISSING" || sourceHealth?.degraded
    ? "DEGRADED"
    : pollingSummary.usablePollCount ? "MEDIUM" : "LOW";
  const reasons = [];
  if (!pollingSummary.usablePollCount) reasons.push("No usable live/manual district polling.");
  if (district.previousResult && !district.previousResult.comparable) reasons.push("Previous congressional result is not comparable.");
  if (district.districtBaseline?.status === "MISSING") reasons.push("District baseline is missing; contextual fallback applied.");
  if (mapConflict) reasons.push("Map assumption requires review; scenario-only output.");
  return { winConfidence, marginConfidence, dataConfidence, reasons };
}

function houseMarginDecomposition(district, previousMargin, genericBallotEffect, nationalFinanceEffect, incumbencyEffect, openSeatEffect, demographicEffect, financeEffect, candidateEffect, nominationEffect, pollingEffect, ratingsEffect, guardrail, finalMargin, ratingGuardrail = null) {
  return {
    previousMargin: Number(previousMargin.toFixed(2)),
    partisanBaselineEffect: Number((previousMargin - previousMargin).toFixed(2)),
    nationalEnvironmentEffect: Number(genericBallotEffect.toFixed(2)),
    pollingEffect: Number(pollingEffect.toFixed(2)),
    incumbencyEffect: Number(incumbencyEffect.toFixed(2)),
    candidateQualityEffect: Number((candidateEffect + nominationEffect + demographicEffect).toFixed(2)),
    fundraisingEffect: Number((financeEffect + nationalFinanceEffect).toFixed(2)),
    ratingsAdjustment: Number((ratingsEffect || 0).toFixed(2)),
    ratingGuardrailApplied: Boolean(ratingGuardrail?.triggered),
    ratingGuardrailReason: ratingGuardrail?.projected?.reason || ratingGuardrail?.probability?.reason || null,
    guardrailAdjustment: guardrail.adjustment,
    guardrailReason: guardrail.reason,
    openSeatEffect: Number(openSeatEffect.toFixed(2)),
    finalProjectedMargin: Number(finalMargin.toFixed(2))
  };
}

function houseBenchmarkComparison(district, margin, demProbability, pollSignal, sourceHealth) {
  const manual = benchmarkFor(`${district.id}-2026`);
  const warnings = [];
  if (!pollSignal && Math.abs(margin) < 6) warnings.push("competitive-race-no-usable-polls");
  if (sourceHealth?.degraded && Math.abs(margin) < 6) warnings.push("source-failure-affects-competitive-race");
  if (district.redistricting?.status && !district.redistricting?.effectiveFor2026) warnings.push("redistricting-map-version-watch");
  warnings.push(...benchmarkWarnings(manual, margin, demProbability));
  return {
    model: { projectedMargin: Number(margin.toFixed(2)), demProbability: Number(demProbability.toFixed(5)) },
    previousResult: district.fundamentalMargin ?? null,
    external: {
      cook: manual?.cook || (district.ratingSource?.includes("Cook") ? district.baselineRating : null),
      sabato: manual?.sabato || null,
      insideElections: manual?.insideElections || (district.ratingSource?.includes("Inside") ? district.baselineRating : null),
      splitTicket: manual?.splitTicket || null,
      raceToWH: manual?.raceToWH || null,
      voteHub: manual?.voteHub || null,
      economist: manual?.economist || null,
      market: manual?.market || null
    },
    usablePolls: pollSignal?.pollCount || 0,
    sourceHealth,
    warnings,
    benchmarkWarnings: warnings.map((warning) => ({
      type: String(warning).startsWith("rating-divergence") ? "RATING_DIVERGENCE" : String(warning).includes("benchmark") ? "BENCHMARK_DIVERGENCE" : "DATA_QUALITY",
      severity: String(warning).startsWith("rating-divergence") ? "HIGH" : "WARNING",
      message: String(warning)
    }))
  };
}

function houseHistoricalComparison(district, projectedMargin, contextualBaseline, pollSignal, marketSignal) {
  const shift = projectedMargin - contextualBaseline;
  const absoluteShift = Math.abs(shift);
  const level = absoluteShift >= 10 ? "large" : absoluteShift >= 6 ? "notable" : "normal";
  const hasExternalRaceSignal = Boolean(pollSignal || marketSignal);
  const expectedRegression = Math.sign(projectedMargin) === Math.sign(contextualBaseline) &&
    Math.abs(contextualBaseline) >= 14 && Math.abs(projectedMargin) >= 10;
  return {
    priorComparableMargin: Number(contextualBaseline.toFixed(2)),
    projectedMargin: Number(projectedMargin.toFixed(2)),
    shift: Number(shift.toFixed(2)),
    level,
    expectedRegression,
    needsReview: level === "large" && !hasExternalRaceSignal && !expectedRegression,
    basis: hasExternalRaceSignal ? "district poll or market signal available" : "district fundamentals and candidate inputs only"
  };
}

function houseRaceError(district, contextMargin, nomination, pollSignal = null) {
  const structuralCertainty = Math.min(2.2, Math.abs(contextMargin) * .12);
  const openSeatUncertainty = district.open ? .65 : 0;
  const pollingCertainty = pollSignal ? Math.min(.9, .22 + Math.log1p(pollSignal.pollCount || 0) * .18 + (pollSignal.pollsters || 0) * .06) : 0;
  const disagreementPenalty = pollSignal ? Math.min(1.2, (pollSignal.disagreement || 0) * .16) : 0;
  return clamp(9.2 - structuralCertainty - pollingCertainty + disagreementPenalty + openSeatUncertainty + (nomination.errorAdjustment || 0), 5.2, 11.5);
}

function houseMarketSignal(district, error) {
  const rawPrice = Number(district.kalshiPrice);
  if (district.open || !district.seatParty || !Number.isFinite(rawPrice)) return null;
  const price = rawPrice > 1 ? rawPrice / 100 : rawPrice;
  if (price < .05 || price > .95) return null;
  // 270toWin's market field is an incumbent-side contract. Convert it to a
  // Democratic win probability before mapping it onto our margin scale.
  const demProbability = district.seatParty === "D" ? price : 1 - price;
  const bounded = clamp(demProbability, .05, .95);
  const impliedMargin = clamp(Math.log(bounded / (1 - bounded)) * Math.max(error, 5.5) / 1.55, -16, 16);
  const days = Math.max(0, (new Date("2026-11-03T12:00:00Z") - new Date()) / 86400000);
  const progress = clamp(1 - days / 306, 0, 1);
  return {
    demProbability: Number(demProbability.toFixed(4)),
    impliedMargin: Number(impliedMargin.toFixed(2)),
    // Market data is informative, not decisive, this far from Election Day.
    weight: Number((.035 + .055 * progress).toFixed(3))
  };
}

function isAtLargeDistrict(district) {
  return district?.district === "AL" || /-AL$/.test(district?.id || "");
}

function applyRedistrictingOverride(district) {
  const stateStatus = REDISTRICTING_STATE_STATUS[district.state] || null;
  const override = DISTRICT_REDISTRICTING_OVERRIDES[district.id];
  if (!override && !stateStatus) {
    return { ...district, redistrictingConfidence: "SETTLED", redistrictingAsOf: MODEL_DATE_KEY, redistrictingSources: [], redistrictingWarnings: [] };
  }
  const conflict = district.id === "AL-02";
  const confidence = conflict ? "CONFLICTING_SOURCES"
    : stateStatus?.status === "litigation-pending" ? "LITIGATION_PENDING"
      : stateStatus?.effectiveFor2026 ? "LIKELY_ACTIVE" : "SETTLED";
  const warnings = conflict ? ["AL-02 map assumption requires review: current local model uses court-remedial map, while at least one external rating source describes a GOP-favorable Trump+14 district."] : [];
  return {
    ...district,
    ...(override || {}),
    ratingSource: override ? `${district.ratingSource}; local redistricting override` : district.ratingSource,
    redistrictingStatus: stateStatus?.status || "current",
    redistrictingTreatment: stateStatus?.modelTreatment || "current map",
    redistrictingEffectiveFor2026: Boolean(stateStatus?.effectiveFor2026),
    redistrictingNote: override?.redistrictingNote || stateStatus?.note || null,
    redistrictingOverride: Boolean(override),
    redistrictingConfidence: confidence,
    redistrictingAsOf: MODEL_DATE_KEY,
    redistrictingSources: stateStatus?.source ? [stateStatus.source] : [],
    redistrictingWarnings: warnings
  };
}

function applyCandidateData(district, finance) {
  const incumbentCandidate = incumbentNameFromLabel(district.label || district.incumbent);
  const manual = MANUAL_HOUSE_CANDIDATE_OVERRIDES[district.id] || {};
  const demCandidate = isPlaceholderCandidate(district.demCandidate, "D")
    ? manual.D || (district.seatParty === "D" && !district.open ? incumbentCandidate : null) || finance?.demCandidate?.name || district.demCandidate
    : manual.D || district.demCandidate;
  const repCandidate = isPlaceholderCandidate(district.repCandidate, "R")
    ? manual.R || (district.seatParty === "R" && !district.open ? incumbentCandidate : null) || finance?.repCandidate?.name || district.repCandidate
    : manual.R || district.repCandidate;
  return {
    ...district,
    demCandidate,
    repCandidate,
    fecDemCandidate: finance?.demCandidate || null,
    fecRepCandidate: finance?.repCandidate || null
  };
}

function incumbentNameFromLabel(label) {
  const cleaned = String(label || "")
    .replace(/\s*\/\s*open\b.*$/i, "")
    .replace(/\bOPEN\b|\bVACANT\b/gi, "")
    .trim();
  if (!cleaned || cleaned.length < 3) return null;
  if (/^(democrat|republican|redrawn seat|open seat)$/i.test(cleaned)) return null;
  return cleaned;
}

function isPlaceholderCandidate(name, party) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return true;
  if (party === "D" && ["democrat", "democratic candidate"].includes(normalized)) return true;
  if (party === "R" && ["republican", "republican candidate"].includes(normalized)) return true;
  return /\/|tbd|unknown|placeholder/.test(normalized);
}

function housePrimaryDate(district) {
  const override = HOUSE_PRIMARY_OVERRIDES[district.id] || HOUSE_PRIMARY_OVERRIDES[district.state] || {};
  return override.primaryDate || HOUSE_PRIMARY_DATES[district.state] || null;
}

function primaryHasPassed(date) {
  return Boolean(date && date <= MODEL_DATE_KEY);
}

function candidateProfileForDistrict(district, party, status) {
  const candidateName = party === "D" ? district.demCandidate : district.repCandidate;
  const placeholder = isPlaceholderCandidate(candidateName, party);
  const incumbent = district.seatParty === party && !district.open;
  const challengerStrength = districtChallengerStrength(district);
  let key = placeholder ? "placeholder" : status === "nominee" ? "resolvedNominee" : status === "presumptive" ? "presumptiveNominee" : district.open ? "openSeatKnown" : "unresolved";
  if (incumbent) key = "incumbent";
  if (!incumbent && challengerStrength !== "none" && ((party === "D" && district.seatParty === "R") || (party === "R" && district.seatParty === "D"))) key = "strongChallenger";
  return {
    key,
    name: candidateName || (party === "D" ? "Democrat" : "Republican"),
    party,
    placeholder,
    incumbent,
    strength: challengerStrength,
    ...HOUSE_CANDIDATE_PROFILE_SCORES[key]
  };
}

function houseNominationInfo(district) {
  const primaryDate = housePrimaryDate(district);
  const override = HOUSE_PRIMARY_OVERRIDES[district.id] || HOUSE_PRIMARY_OVERRIDES[district.state] || {};
  const statusOverride = HOUSE_CANDIDATE_STATUS_OVERRIDES[district.id] || {};
  const passed = primaryHasPassed(primaryDate);
  const demKnown = !isPlaceholderCandidate(district.demCandidate, "D");
  const repKnown = !isPlaceholderCandidate(district.repCandidate, "R");
  const demIncumbent = district.seatParty === "D" && !district.open && demKnown;
  const repIncumbent = district.seatParty === "R" && !district.open && repKnown;
  const demPresumptive = demKnown && (demIncumbent || isPresumptiveByFinance(district.fecDemCandidate));
  const repPresumptive = repKnown && (repIncumbent || isPresumptiveByFinance(district.fecRepCandidate));
  const demStatus = statusOverride.D || (passed && demKnown ? "nominee" : demPresumptive ? "presumptive" : demKnown ? "filed" : "unresolved");
  const repStatus = statusOverride.R || (passed && repKnown ? "nominee" : repPresumptive ? "presumptive" : repKnown ? "filed" : "unresolved");
  const demProfile = candidateProfileForDistrict(district, "D", demStatus);
  const repProfile = candidateProfileForDistrict(district, "R", repStatus);
  const demCertainty = demStatus === "nominee" ? 1 : demStatus === "presumptive" ? .78 : demStatus === "filed" ? .5 : .2;
  const repCertainty = repStatus === "nominee" ? 1 : repStatus === "presumptive" ? .78 : repStatus === "filed" ? .5 : .2;
  const marginAdjustment = clamp((demCertainty - repCertainty) * .55, -.45, .45);
  const unknownCount = (demStatus === "unresolved" ? 1 : 0) + (repStatus === "unresolved" ? 1 : 0);
  const errorAdjustment = passed ? Math.max(0, unknownCount * .35) : .75 + unknownCount * .45;
  const status = passed ? "resolved-or-filed" : "pending";
  const summary = override.primarySummary || (primaryDate
    ? `${passed ? "Primary date has passed" : "Primary scheduled"} for ${primaryDate}; known candidates are treated as ${passed ? "nominees unless the source still has placeholders" : "filed or presumptive candidates"}.`
    : "Primary date not entered; candidate status is inferred from incumbency and available candidate names.");
  return {
    status,
    primaryDate,
    demStatus,
    repStatus,
    demCertainty: Number(demCertainty.toFixed(2)),
    repCertainty: Number(repCertainty.toFixed(2)),
    marginAdjustment: Number(marginAdjustment.toFixed(2)),
    errorAdjustment: Number(errorAdjustment.toFixed(2)),
    demProfile,
    repProfile,
    summary
  };
}

function isPresumptiveByFinance(candidate) {
  if (!candidate) return false;
  if (/incumbent/i.test(candidate.status || "")) return true;
  return candidate.score >= 500_000 && (candidate.primaryShare ?? 0) >= .72;
}

function houseCandidateQualityAdjustment(district, nomination) {
  const demQuality = nomination.demProfile?.quality || 0;
  const repQuality = nomination.repProfile?.quality || 0;
  const demUncertainty = nomination.demProfile?.uncertainty || 0;
  const repUncertainty = nomination.repProfile?.uncertainty || 0;
  return clamp(((demQuality - repQuality) * MODEL_WEIGHTS.candidateQuality) + ((repUncertainty - demUncertainty) * .12), -.75, .75);
}

function districtChallengerStrength(district) {
  const override = MANUAL_HOUSE_CHALLENGER_STRENGTH[district.id];
  if (!override || district.open) return "none";
  if (district.seatParty === "D") return override.R || "none";
  if (district.seatParty === "R") return override.D || "none";
  return "none";
}

function validateDistricts(districts, phase) {
  const ids = new Set();
  const failures = [];
  for (const district of districts) {
    if (ids.has(district.id)) failures.push(`${district.id}: duplicate id`);
    ids.add(district.id);
    if (!Number.isFinite(district.margin)) failures.push(`${district.id}: non-finite margin`);
    if (!Number.isFinite(district.demProbability) || !Number.isFinite(district.repProbability)) failures.push(`${district.id}: non-finite probability`);
  }
  if (districts.length !== 435) failures.push(`expected 435 districts, found ${districts.length}`);
  if (failures.length) {
    throw new Error(`House district validation failed during ${phase}: ${failures.slice(0, 12).join("; ")}`);
  }
}

async function fetchHouseFec(status) {
  const text = await fetchText("https://www.fec.gov/files/bulk-downloads/2026/candidate_summary_2026.csv", "openFecHouseCandidateSummary", status, { timeoutMs: 16000 });
  if (!text) return {};
  const rows = parseCsv(text);
  const byDistrict = {};
  const national = { demReceipts: 0, repReceipts: 0, demCash: 0, repCash: 0, demDebts: 0, repDebts: 0, demCandidates: 0, repCandidates: 0 };
  for (const row of rows) {
    if (row.Cand_Office !== "H") continue;
    const state = row.Cand_Office_St;
    const rawDistrict = String(row.Cand_Office_Dist || row.Cand_District || "").trim();
    if (!state || !rawDistrict) continue;
    const district = rawDistrict === "0" || rawDistrict.toUpperCase() === "AL" ? "AL" : String(Number(rawDistrict)).padStart(2, "0");
    const id = `${state}-${district}`;
    const party = String(row.Cand_Party_Affiliation || "").toUpperCase();
    const side = party.startsWith("DEM") ? "dem" : party.startsWith("REP") ? "rep" : "other";
    byDistrict[id] ||= { demReceipts: 0, repReceipts: 0, demCash: 0, repCash: 0, demDebts: 0, repDebts: 0, candidates: 0, demCandidates: [], repCandidates: [] };
    byDistrict[id].candidates += 1;
    if (side === "dem") {
      const receipts = nonNegative(row.Total_Receipt);
      const cash = nonNegative(row.Cash_On_Hand_COP) || nonNegative(row.Cash_On_Hand);
      const debts = nonNegative(row.Debts_Owed_By_Committee) || nonNegative(row.Debt_Owed_By_Committee) || nonNegative(row.Debts_Owed);
      byDistrict[id].demReceipts += receipts;
      byDistrict[id].demCash += cash;
      byDistrict[id].demDebts += debts;
      byDistrict[id].demCandidates.push(candidateRecord(row, receipts, cash, debts));
      national.demReceipts += receipts;
      national.demCash += cash;
      national.demDebts += debts;
      national.demCandidates += 1;
    }
    if (side === "rep") {
      const receipts = nonNegative(row.Total_Receipt);
      const cash = nonNegative(row.Cash_On_Hand_COP) || nonNegative(row.Cash_On_Hand);
      const debts = nonNegative(row.Debts_Owed_By_Committee) || nonNegative(row.Debt_Owed_By_Committee) || nonNegative(row.Debts_Owed);
      byDistrict[id].repReceipts += receipts;
      byDistrict[id].repCash += cash;
      byDistrict[id].repDebts += debts;
      byDistrict[id].repCandidates.push(candidateRecord(row, receipts, cash, debts));
      national.repReceipts += receipts;
      national.repCash += cash;
      national.repDebts += debts;
      national.repCandidates += 1;
    }
  }
  for (const value of Object.values(byDistrict)) {
    const demScore = Math.log1p(value.demReceipts + value.demCash * 1.3) - Math.log1p(value.demDebts * 1.2);
    const repScore = Math.log1p(value.repReceipts + value.repCash * 1.3) - Math.log1p(value.repDebts * 1.2);
    value.financeSignal = Number(clamp((demScore - repScore) / 3.4, -1.4, 1.4).toFixed(3));
    value.demCandidate = topCandidate(value.demCandidates);
    value.repCandidate = topCandidate(value.repCandidates);
    delete value.demCandidates;
    delete value.repCandidates;
  }
  national.financeSignal = nationalFinanceSignal(national);
  byDistrict.__national = national;
  status.openFecHouseCandidateSummary.rows = rows.length;
  status.openFecHouseCandidateSummary.districts = Object.keys(byDistrict).filter((id) => id !== "__national").length;
  status.openFecHouseCandidateSummary.nationalFinanceSignal = national.financeSignal;
  return byDistrict;
}

function candidateRecord(row, receipts, cash, debts) {
  const status = String(row.Cand_Incumbent_Challenger_Open_Seat || "").toLowerCase();
  const incumbentBonus = status.includes("incumbent") ? 9_000_000 : 0;
  const score = receipts + cash * 1.3 - debts * 1.2 + incumbentBonus;
  return {
    name: publicCandidateName(row.Cand_Name),
    fecName: row.Cand_Name || "",
    id: row.Cand_Id || "",
    party: row.Cand_Party_Affiliation || "",
    status: row.Cand_Incumbent_Challenger_Open_Seat || "",
    receipts: Number(receipts.toFixed(2)),
    cash: Number(cash.toFixed(2)),
    debts: Number(debts.toFixed(2)),
    score: Number(score.toFixed(2))
  };
}

function topCandidate(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const viable = candidates.filter((candidate) => candidate.name && candidate.score > 0);
  const pool = [...(viable.length ? viable : candidates)].sort((a, b) => b.score - a.score);
  const top = pool[0] || null;
  if (!top) return null;
  const totalScore = pool.reduce((sum, candidate) => sum + Math.max(candidate.score, 0), 0);
  return {
    ...top,
    primaryShare: totalScore ? Number((Math.max(top.score, 0) / totalScore).toFixed(3)) : null,
    fieldSize: pool.length
  };
}

function publicCandidateName(name) {
  const cleaned = String(name || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (!cleaned.includes(",")) return titleCaseName(cleaned);
  const [last, rest = ""] = cleaned.split(",", 2);
  return titleCaseName(`${rest} ${last}`.replace(/\b(MR|MRS|MS|DR)\.?\b/gi, "").trim());
}

function titleCaseName(name) {
  return String(name || "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => {
      if (/^(jr|sr|ii|iii|iv|v)\.?$/.test(part)) return part.replace(".", "").toUpperCase();
      return part.split("-").map((piece) => piece ? piece[0].toUpperCase() + piece.slice(1) : piece).join("-");
    })
    .join(" ");
}

function nonNegative(value) {
  return Math.max(toNumber(value) || 0, 0);
}

function nationalFinanceSignal(finance) {
  const demScore = Math.log1p(finance.demReceipts + finance.demCash * 1.1) - Math.log1p(finance.demDebts * 1.2);
  const repScore = Math.log1p(finance.repReceipts + finance.repCash * 1.1) - Math.log1p(finance.repDebts * 1.2);
  return Number(clamp((demScore - repScore) / 5, -.8, .8).toFixed(3));
}

function contextualDistrictMargin(district) {
  // Probability-engine anchor. The public projected result margin uses
  // realisticDistrictBaseline so safe districts do not display as fake-tight.
  if (Number.isFinite(district.fundamentalMargin)) return clamp(district.fundamentalMargin, -16.5, 16.5);
  // Missing federal-return rows should not start at a tossup. Use a guarded
  // incumbent-party anchor until the upstream district return is available.
  if (district.seatParty === "D") return 12;
  if (district.seatParty === "R") return -12;
  return 0;
}

function districtCoalitionWeights(district) {
  const traits = STATE_COALITION_TRAITS[district.state] || [];
  const pres = Number.isFinite(district.presidentialMargin) ? district.presidentialMargin : 0;
  const urbanized = pres > 10;
  const exurban = pres < -10;
  const highCollege = urbanized || traits.includes("college") || traits.includes("suburban");
  const highNoncollege = exurban || traits.includes("rural") || traits.includes("working_class") || traits.includes("appalachian") || traits.includes("frontier");
  const highBlack = traits.includes("black_belt") || ["GA", "NC", "SC", "MS", "LA", "AL", "MD", "VA"].includes(district.state);
  const highLatino = traits.includes("latino") || ["AZ", "CA", "FL", "NV", "NM", "TX"].includes(district.state);
  const highAsianOther = ["CA", "HI", "NJ", "NY", "WA", "VA", "MD", "NV"].includes(district.state);
  return {
    white_college: highCollege ? .28 : highNoncollege ? .13 : .2,
    white_noncollege: highNoncollege ? .35 : highCollege ? .19 : .27,
    black: highBlack ? .18 : urbanized ? .11 : .07,
    latino: highLatino ? .17 : .06,
    asian_other: highAsianOther ? .1 : .05,
    youth: urbanized || traits.includes("college") ? .11 : .08,
    senior: traits.includes("senior") || exurban ? .14 : .09
  };
}

function houseDemographicPull(district, challengerStrength) {
  const weights = districtCoalitionWeights(district);
  const demProfile = district.seatParty === "D" && !district.open ? HOUSE_COALITION_PROFILES.demIncumbent : HOUSE_COALITION_PROFILES.democrat;
  const repProfile = district.seatParty === "R" && !district.open ? HOUSE_COALITION_PROFILES.repIncumbent : HOUSE_COALITION_PROFILES.republican;
  const openProfile = district.open ? HOUSE_COALITION_PROFILES.openSeat : {};
  const challengerBonus = CHALLENGER_STRENGTH_DISCOUNTS[challengerStrength] || 0;
  const challengerDirection = district.seatParty === "R" ? 1 : district.seatParty === "D" ? -1 : 0;
  const groups = Object.keys(weights).map((group) => {
    const profileGap = (demProfile[group] || 0) - (repProfile[group] || 0) + (openProfile[group] || 0);
    const effect = weights[group] * profileGap * 1.35;
    return { group, label: DEMOGRAPHIC_GROUP_LABELS[group] || group, weight: Number(weights[group].toFixed(2)), effect: Number(effect.toFixed(2)) };
  });
  const raw = groups.reduce((sum, item) => sum + item.effect, 0) + challengerDirection * challengerBonus * .32;
  const saturation = Math.abs(district.presidentialMargin || district.fundamentalMargin || 0) > 18 ? .6 : Math.abs(district.presidentialMargin || district.fundamentalMargin || 0) > 10 ? .78 : 1;
  return {
    adjustment: Number(clamp(raw * saturation, -0.95, 0.95).toFixed(2)),
    demProfile: district.seatParty === "D" && !district.open ? "demIncumbent" : "democrat",
    repProfile: district.seatParty === "R" && !district.open ? "repIncumbent" : "republican",
    topGroups: groups
      .filter((item) => Math.abs(item.effect) >= .02)
      .sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
      .slice(0, 5)
  };
}

function runModel(districts) {
  const seatCounts = {};
  const districtWins = Object.fromEntries(districts.map((district) => [district.id, 0]));
  const controlWins = { dem: 0, rep: 0 };
  const demControlPath = { tossupWins: 0, tiltRWins: 0, leanRWins: 0, vulnerableDHolds: 0, controlSims: 0 };
  const repControlPath = { tossupWins: 0, tiltDWins: 0, leanDWins: 0, vulnerableRHolds: 0, controlSims: 0 };
  for (let sim = 0; sim < SETTINGS.simulations; sim += 1) {
    const nationalError = normalRandom() * MODEL_WEIGHTS.nationalEnvironmentSd;
    const stateErrors = {};
    let demSeats = 0;
    const pathCounts = { tossupD: 0, tossupR: 0, tiltRD: 0, leanRD: 0, vulnerableDHolds: 0, tiltDR: 0, leanDR: 0, vulnerableRHolds: 0 };
    for (const district of districts) {
      stateErrors[district.state] ??= normalRandom() * MODEL_WEIGHTS.stateCorrelationSd;
      const simulatedMargin = (district.probabilityEngineMargin ?? district.margin) + nationalError + stateErrors[district.state] + normalRandom() * (district.error ?? 8);
      const demWin = simulatedMargin > 0;
      if (demWin) {
        demSeats += 1;
        districtWins[district.id] += 1;
      }
      if (district.baselineRating === "Toss-up") {
        if (demWin) pathCounts.tossupD += 1;
        else pathCounts.tossupR += 1;
      }
      if (demWin && district.baselineRating === "Tilt R") pathCounts.tiltRD += 1;
      if (demWin && district.baselineRating === "Lean R") pathCounts.leanRD += 1;
      if (!demWin && district.baselineRating === "Tilt D") pathCounts.tiltDR += 1;
      if (!demWin && district.baselineRating === "Lean D") pathCounts.leanDR += 1;
      if (demWin && district.seatParty === "D" && district.competitive) pathCounts.vulnerableDHolds += 1;
      if (!demWin && district.seatParty === "R" && district.competitive) pathCounts.vulnerableRHolds += 1;
    }
    seatCounts[demSeats] = (seatCounts[demSeats] || 0) + 1;
    if (demSeats >= SETTINGS.controlThreshold) {
      controlWins.dem += 1;
      demControlPath.controlSims += 1;
      demControlPath.tossupWins += pathCounts.tossupD;
      demControlPath.tiltRWins += pathCounts.tiltRD;
      demControlPath.leanRWins += pathCounts.leanRD;
      demControlPath.vulnerableDHolds += pathCounts.vulnerableDHolds;
    } else {
      controlWins.rep += 1;
      repControlPath.controlSims += 1;
      repControlPath.tossupWins += pathCounts.tossupR;
      repControlPath.tiltDWins += pathCounts.tiltDR;
      repControlPath.leanDWins += pathCounts.leanDR;
      repControlPath.vulnerableRHolds += pathCounts.vulnerableRHolds;
    }
  }
  const sortedSeatCounts = Object.entries(seatCounts).map(([seat, count]) => ({ seat: Number(seat), count })).sort((a, b) => a.seat - b.seat);
  let cumulative = 0;
  const medianSeats = sortedSeatCounts.find((entry) => {
    cumulative += entry.count;
    return cumulative >= SETTINGS.simulations / 2;
  })?.seat ?? Math.round(districts.reduce((sum, district) => sum + district.demProbability, 0));
  const modeledDistricts = districts.map((district) => ({
    ...district,
    demProbability: Number((districtWins[district.id] / SETTINGS.simulations).toFixed(4)),
    repProbability: Number((1 - districtWins[district.id] / SETTINGS.simulations).toFixed(4)),
    winnerParty: districtWins[district.id] / SETTINGS.simulations >= .5 ? "D" : "R",
    winnerProbability: Number(Math.max(districtWins[district.id] / SETTINGS.simulations, 1 - districtWins[district.id] / SETTINGS.simulations).toFixed(4))
  }));
  return {
    demControlProbability: controlWins.dem / SETTINGS.simulations,
    repControlProbability: controlWins.rep / SETTINGS.simulations,
    medianSeats,
    seatCounts,
    controlPaths: {
      dem: averageHousePath(demControlPath),
      rep: averageHousePath(repControlPath)
    },
    districts: modeledDistricts,
    decisiveDistricts: modeledDistricts
      .map((district) => ({ ...district, leverage: district.competitive ? (1 - Math.abs(district.demProbability - .5) * 2) : 0 }))
      .sort((a, b) => b.leverage - a.leverage)
      .slice(0, 16)
  };
}

function averageHousePath(path) {
  const sims = path.controlSims || 0;
  const average = (value) => sims && Number.isFinite(value) ? Number((value / sims).toFixed(1)) : 0;
  return {
    controlSimulations: sims,
    tossupWins: average(path.tossupWins),
    tiltRWins: average(path.tiltRWins),
    leanRWins: average(path.leanRWins),
    vulnerableDHolds: average(path.vulnerableDHolds),
    tiltDWins: average(path.tiltDWins),
    leanDWins: average(path.leanDWins),
    vulnerableRHolds: average(path.vulnerableRHolds)
  };
}

function appendControlHistory(model) {
  const current = { date: MODEL_DATE_KEY, dem: model.demControlProbability, rep: model.repControlProbability };
  const stored = Array.isArray(previousForecast?.controlHistory) ? previousForecast.controlHistory : [];
  return [...stored.filter((point) => point.date !== current.date && point.date <= MODEL_DATE_KEY), current]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-365);
}

function appendSeatHistory(model) {
  const current = { date: MODEL_DATE_KEY, dem: model.medianSeats, rep: 435 - model.medianSeats };
  const stored = Array.isArray(previousForecast?.seatHistory) ? previousForecast.seatHistory : [];
  return [...stored.filter((point) => point.date !== current.date && point.date <= MODEL_DATE_KEY), current]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-365);
}

function appendDistrictHistories(districts) {
  const stored = new Map((previousForecast?.districts || []).map((district) => [district.id, district.history || []]));
  return districts.map((district) => {
    const current = { date: MODEL_DATE_KEY, dem: district.demProbability, rep: district.repProbability };
    const history = [...(stored.get(district.id) || []).filter((point) => point.date !== current.date && point.date <= MODEL_DATE_KEY), current]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-365);
    return { ...district, history };
  });
}

function ratingSummary(districts) {
  return RATING_ORDER.map((rating) => ({
    rating,
    count: districts.filter((district) => district.rating === rating).length
  }));
}

function redistrictingSummary(districts) {
  const overriddenDistricts = districts
    .filter((district) => district.redistrictingOverride)
    .map((district) => district.id);
  const states = Object.fromEntries(Object.entries(REDISTRICTING_STATE_STATUS).map(([state, value]) => [state, value]));
  const seatRatingsByState = {};
  for (const district of districts) {
    if (!REDISTRICTING_STATE_STATUS[district.state]) continue;
    seatRatingsByState[district.state] ||= { D: 0, R: 0, tossup: 0, districts: 0 };
    seatRatingsByState[district.state].districts += 1;
    if (district.rating.endsWith("D")) seatRatingsByState[district.state].D += 1;
    else if (district.rating.endsWith("R")) seatRatingsByState[district.state].R += 1;
    else seatRatingsByState[district.state].tossup += 1;
  }
  return {
    reviewedAt: new Date().toISOString(),
    sourceNote: "State statuses are maintained locally so stale public rating feeds do not silently drive the House model after mid-decade map changes.",
    states,
    overriddenDistricts,
    seatRatingsByState
  };
}

function houseControlDecomposition(districts) {
  const rated = districts.filter((district) => district.ratingsPrior?.enabled);
  const ratingsHeavy = rated.filter((district) => district.ratingsPrior?.ratingsHeavy);
  const guardrailed = districts.filter((district) => district.ratingGuardrail?.triggered);
  const ratingSourceTypes = districts.reduce((counts, district) => {
    const type = district.ratingsPrior?.ratingSourceType || "RATING_UNAVAILABLE";
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {});
  const raceSourceHealth = districts.reduce((counts, district) => {
    const health = district.sourceHealth?.forecast || "UNKNOWN";
    counts[health] = (counts[health] || 0) + 1;
    return counts;
  }, {});
  const averageWeight = rated.length
    ? rated.reduce((sum, district) => sum + Number(district.ratingsPrior.weight || 0), 0) / rated.length
    : 0;
  const averageProbabilityPull = rated.length
    ? rated.reduce((sum, district) => sum + Math.abs(Number(district.ratingsPrior.ratingPull || 0)), 0) / rated.length
    : 0;
  const seatsChangedByPrior = districts.filter((district) => {
    const raw = Number(district.preRatingProbabilityMargin);
    const final = Number(district.probabilityEngineMargin);
    return Number.isFinite(raw) && Number.isFinite(final) && Math.sign(raw) !== Math.sign(final);
  }).map((district) => district.id);
  return {
    ratedDistricts: rated.length,
    ratingsHeavyDistricts: ratingsHeavy.length,
    guardrailedDistricts: guardrailed.map((district) => district.id),
    ratingSourceTypes,
    raceSourceHealth,
    averageRatingsWeight: Number(averageWeight.toFixed(3)),
    averageAbsoluteRatingPull: Number(averageProbabilityPull.toFixed(2)),
    seatsChangedBySoftPrior: seatsChangedByPrior,
    note: "Ratings are a transparent soft prior. They constrain low-information districts but do not replace fundamentals, national environment, finance, candidate data, or polling."
  };
}

function readPreviousForecast() {
  try {
    return JSON.parse(readFileSync(OUTPUT_URL, "utf8"));
  } catch {
    return null;
  }
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function next() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalRandom() {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function logistic(margin, error) {
  return 1 / (1 + Math.exp(-margin / Math.max(error, .1) * 1.55));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

async function writeHouseForecast() {
  const sourceData = await fetchHouseSources();
  if (sourceData.mapDistricts.length < 400 && sourceData.cookDistricts.length < 400) {
    throw new Error(`House district universe unavailable: parsed ${sourceData.mapDistricts.length} map districts and ${sourceData.cookDistricts.length} Cook districts, with no usable cached forecast fallback.`);
  }
  const districts = adjustedDistricts(sourceData);
  validateDistricts(districts, "district adjustment");
  const model = runModel(districts);
  model.districts = appendDistrictHistories(model.districts);
  const pollingCoverage = {
    districts: model.districts.length,
    usablePollDistricts: model.districts.filter((district) => district.usablePollCount > 0).length,
    sourceFailureDistricts: model.districts.filter((district) => district.pollingStatus === "SOURCE_FAILURE").length
  };
  const noDistrictPolling = pollingCoverage.usablePollDistricts === 0;
  const toplineComparison = toplineBenchmark("house", { demControlProbability: model.demControlProbability });
  const toplineDivergenceExplanation = houseToplineDivergenceExplanation(toplineComparison, noDistrictPolling, sourceData);
  const sourceHealth = noDistrictPolling ? {
    ...sourceData.sourceHealth,
    degraded: true,
    health: "PARTIAL",
    message: "House forecast limited: no usable district-level polling was available; output is ratings/fundamentals-driven."
  } : sourceData.sourceHealth;
  validateDistricts(model.districts, "simulation");
  const cacheFreshness = forecastInputCacheFreshness({
    genericBallot: "data/cache/polls/generic-ballot-2026.json",
    polls: "data/cache/polls/house-2026.json",
    ratings: "data/cache/ratings/house-2026.json",
    fundamentals: "data/cache/fundamentals/house-district-baselines-2026.json",
    finance: "data/cache/finance/house-2026.json"
  });
  model.decisiveDistricts = model.decisiveDistricts.map((district) => ({
    ...(model.districts.find((item) => item.id === district.id) || district),
    leverage: district.leverage
  }));
  const historicalMarginWarnings = model.districts
    .filter((district) => district.historicalComparison?.needsReview)
    .map((district) => ({
      severity: "warning",
      type: "historical-margin-discrepancy",
      race: district.id,
      message: `Projected ${district.margin >= 0 ? "D+" : "R+"}${Math.abs(district.margin).toFixed(1)} differs by ${Math.abs(district.historicalComparison.shift).toFixed(1)} points from the district's contextual baseline without a district-level signal.`
    }));
  const output = {
    modelVersion: "2026.06.reliability.1",
    forecastStatus: noDistrictPolling || toplineComparison.warning || sourceData.sourceHealth?.degraded || sourceData.usingCachedDistricts ? "DEGRADED" : "NORMAL",
    generatedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    modelDate: MODEL_DATE_KEY,
    runDate: new Date(`${MODEL_DATE_KEY}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    updateTime: SETTINGS.updateTime,
    settings: { ...SETTINGS, modelWeights: MODEL_WEIGHTS },
    mapBasis: {
      display: "district cartogram",
      boundarySource: "Census 2025 cartographic boundary files for the 119th congressional districts",
      districtShapeMapStatus: sourceData.censusDistrictBoundaryPageReachable ? "boundary source reachable; local GeoJSON bundled for pre-redraw 119th shapes only" : "boundary source not reached during this run",
      redistrictingTreatment: "District fundamentals and candidate data use local redistricting overrides where public map feeds lag enacted or court-ordered maps.",
      redistrictingShapeWarning: "The visible shape map may lag enacted 2026 redistricting in states with new maps. The model uses the local redistricting override layer even when temporary map geometry has not been replaced."
    },
    sourceStatus: sourceData.status,
    sourceHealth,
    generationMode: generationNetworkStatus(sourceData.status, OFFLINE).mode,
    networkStatus: generationNetworkStatus(sourceData.status, OFFLINE),
    ...cacheFreshness,
    canonicalGenericBallot: sourceData.genericPolling,
    benchmarkComparison: toplineComparison,
    toplineDivergenceExplanation,
    raceBenchmarkStatus: benchmarkConfiguration(),
    racePollCoverage: pollingCoverage,
    pollCoverage: {
      usableDistrictPolls: pollingCoverage.usablePollDistricts,
      totalDistricts: pollingCoverage.districts,
      sourceFailureDistricts: pollingCoverage.sourceFailureDistricts
    },
    guardrailedDistricts: model.districts.filter((district) => district.ratingGuardrail?.triggered).map((district) => district.id),
    guardrailCount: model.districts.filter((district) => district.ratingGuardrail?.triggered).length,
    mapConflictDistricts: model.districts.filter((district) => district.ratingIsConditional || district.forecastStatus === "SCENARIO_ONLY").map((district) => district.id),
    dataQualityWarnings: [
      ...(sourceData.usingCachedDistricts ? [{ severity: "warning", type: "house-district-fallback", message: "House forecast degraded: ratings/district map source failed; using fallback baselines." }] : []),
      ...(noDistrictPolling ? [{ severity: "warning", type: "no-district-polling", message: "House forecast limited: no usable district-level polling was available; output is ratings/fundamentals-driven." }] : []),
      ...(benchmarkConfiguration().status === "EMPTY" ? [{ severity: "warning", type: "benchmark-file-empty", message: "External race benchmark file is empty; race-level benchmark comparisons are schema-only." }] : []),
      ...(toplineComparison.warning ? [{
        severity: toplineDivergenceExplanation?.severity || "warning",
        type: "public-model-topline-divergence",
        message: `House forecast review required: model gives Democrats ${(model.demControlProbability * 100).toFixed(1)}% while benchmark sources favor Democrats for House control.`
      }] : []),
      ...cacheFreshness.staleInputWarnings,
      ...sourceHealthWarnings(sourceHealth, "House")
    ],
    sourceSummary: {
      cookDistricts: sourceData.cookDistricts.length,
      mapDistricts: sourceData.mapDistricts.length,
      insideRatings: Object.keys(sourceData.insideRatings).length,
      cachedHouseRatings: benchmarkConfiguration().cachedHouseRatings || 0,
      cachedHouseExternalRatings: benchmarkConfiguration().cachedHouseExternalRatings || 0,
      cachedHouseInferredSafeRatings: benchmarkConfiguration().cachedHouseInferredSafeRatings || 0,
      cachedHouseFundamentals: HOUSE_FUNDAMENTALS_CACHE.size,
      fecDistricts: Object.keys(sourceData.fec).filter((id) => id !== "__national").length,
      nationalFinance: sourceData.fec.__national || null,
      genericPolling: sourceData.genericPolling,
      wikipediaPolling: wikipediaPollingSummary(sourceData.wikipediaPolling),
      districtPolling: {
        districts: Object.keys(sourceData.districtPolls || {}).length,
        polls: Object.values(sourceData.districtPolls || {}).reduce((sum, polls) => sum + polls.length, 0),
        note: "Race-level polls are blended only when a current, structured matchup can be matched to the district and both major-party candidates. Generic ballot remains separate."
      },
      housePollingReferenceReachable: sourceData.housePollingReferenceReachable,
      raceToTheWhHouseReachable: sourceData.raceToTheWhHouseReachable,
      raceToTheWhGenericReachable: sourceData.raceToTheWhGenericReachable,
      realClearGenericReachable: sourceData.realClearGenericReachable,
      realClearHousePollsReachable: sourceData.realClearHousePollsReachable,
      censusDistrictBoundaryPageReachable: sourceData.censusDistrictBoundaryPageReachable,
      redistricting: redistrictingSummary(districts)
    },
    pollingValidation: {
      wikipediaPolling: sourceData.wikipediaPolling?.pollingValidation || null
    },
    ratingSummary: ratingSummary(districts),
    houseControlDecomposition: houseControlDecomposition(model.districts),
    modelWarnings: [
      ...sourceHealthWarnings(sourceHealth, "House"),
      ...forecastSanityWarnings(model.districts, {
        model: "house",
        id: (district) => district.id,
        name: (district) => district.displayName || district.id,
        baseline: (district) => district.sourceInputs?.districtBaseline,
        partisanship: (district) => district.sourceInputs?.presidentialBaseline,
        candidateAdjustment: (district) => district.sourceInputs?.candidateQualityAdjustment
      }),
      ...historicalMarginWarnings
    ],
    controlHistory: appendControlHistory(model),
    seatHistory: appendSeatHistory(model),
    ...model
  };
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(OUTPUT_URL, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote data/house-forecast.json for ${MODEL_DATE_KEY}`);
}

await writeHouseForecast();
