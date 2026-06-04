import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { forecastSanityWarnings } from "./forecast-sanity.mjs";

const OUTPUT_URL = new URL("../data/house-forecast.json", import.meta.url);
const SENATE_FORECAST_URL = new URL("../data/forecast.json", import.meta.url);
const previousForecast = readPreviousForecast();

const SETTINGS = {
  simulations: 100000,
  controlThreshold: 218,
  updateTime: "around 6:20 AM Central",
  updateZone: "America/Chicago",
  dataSources: [
    "270toWin / Inside Elections public House map data",
    "Cook Political Report public House ratings when reachable",
    "270toWin House polling reference page",
    "Race to the WH House and generic-ballot reference pages",
    "RealClearPolling generic-ballot reference pages when reachable",
    "Generic-ballot polling adapters shared with the Senate model",
    "OpenFEC House candidate finance bulk files",
    "Census 119th congressional district boundary files for map basis"
  ]
};

const RATING_TO_MARGIN = {
  "Safe D": 21,
  "Likely D": 9.5,
  "Lean D": 6,
  "Tilt D": 4,
  "Toss-up": 0,
  "Tilt R": -4,
  "Lean R": -6,
  "Likely R": -9.5,
  "Safe R": -21
};

const RATING_TO_ERROR = {
  "Safe D": 5.5,
  "Likely D": 6.45,
  "Lean D": 7,
  "Tilt D": 7.55,
  "Toss-up": 10.6,
  "Tilt R": 7.55,
  "Lean R": 7,
  "Likely R": 6.45,
  "Safe R": 5.5
};

const MODEL_WEIGHTS = {
  genericBallot: .65,
  genericBallotCap: 5.4,
  ratingBaseline: 1,
  districtPolls: .18,
  finance: .22,
  nationalFinance: .35,
  nominationCertainty: .32,
  candidateQuality: .36,
  incumbencyOpenPenalty: .45,
  seatPartyIncumbency: .45,
  districtFundamentals: .16,
  historicalMidterm: 1.0,
  stateCorrelationSd: 1.45,
  nationalEnvironmentSd: 3.35
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
  "CO-04": { D: "presumptive", R: "presumptive" }
};

const MANUAL_HOUSE_CANDIDATE_OVERRIDES = {
  "IA-01": { D: "Christina Bohannan", R: "Mariannette Miller-Meeks" },
  "IA-02": { D: "Lindsay James", R: "Joe Mitchell" },
  "IA-03": { D: "Sarah Trone Garriott", R: "Zach Nunn" },
  "IA-04": { D: "Dave Dawson", R: "Chris McGowan" },
  "MT-01": { D: "Sam Forstag", R: "Aaron Flint" },
  "MT-02": { D: "Brian Miller", R: "Troy Downing" },
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
  const now = new Date();
  const central = new Date(now.toLocaleString("en-US", { timeZone: SETTINGS.updateZone }));
  if (central.getHours() < 6 || (central.getHours() === 6 && central.getMinutes() < 20)) {
    central.setDate(central.getDate() - 1);
  }
  return central.toISOString().slice(0, 10);
}

const MODEL_DATE_KEY = modelDateKey();
const random = mulberry32(hashString(`house-${MODEL_DATE_KEY}`));

async function fetchText(url, label, status, options = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 14000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "CapitolForecastBot/1.0 (+https://github.com/)",
        "accept": "text/html,application/json,text/plain,*/*"
      }
    });
    const text = await response.text();
    status[label] = {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      bytes: text.length,
      url
    };
    return response.ok ? text : "";
  } catch (error) {
    status[label] = {
      ok: false,
      status: error.name === "AbortError" ? "timeout" : "error",
      message: error.message,
      ms: Date.now() - started,
      url
    };
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function htmlToLines(html) {
  return html
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
  const json = extractJsonAssignment(html, "map_d3.seats =");
  if (!json) return [];
  const parsed = JSON.parse(json);
  return Object.values(parsed).flat().map((district) => {
    const state = district.state_abbr;
    const number = Number(district.district_number);
    const atLarge = String(district.district_id_combo || "").endsWith("00");
    const id = `${state}-${atLarge ? "AL" : String(number).padStart(2, "0")}`;
    const presidentialMargin = toNumber(district.margin_president);
    const congressionalMargin = toNumber(district.margin_congress);
    const fundamentalMargin = Number.isFinite(congressionalMargin) && Math.abs(congressionalMargin) > .01
      ? presidentialMargin * .55 + congressionalMargin * .45
      : presidentialMargin;
    const sourceRating = STATUS_TO_RATING[district.pro_status] || null;
    const rating = sourceRating || ratingFromMargin(fundamentalMargin);
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
      rating,
      sourceRating,
      ratingSource: "270toWin / Inside Elections",
      seatParty: district.seat_party || null,
      presidentialMargin,
      congressionalMargin,
      fundamentalMargin: Number.isFinite(fundamentalMargin) ? Number(fundamentalMargin.toFixed(2)) : null,
      rawMarginNote: "Raw 270toWin district margin fields are stored for context only; the model does not assume they are signed Democratic margins.",
      kalshiPrice: toNumber(district.kalshi_price),
      demCandidate,
      repCandidate
    };
  }).filter((district) => district.id && !STATELESS_DISTRICTS.has(district.id));
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
  const [votehubHtml, ddhqJson, pollfinityJson, usPollingHtml] = await Promise.all([
    fetchText("https://polls.votehub.us/polls/generic-ballot", "votehubGenericBallot", status, { timeoutMs: 12000 }),
    fetchText("https://static.dwcdn.net/data/9Jctg.json", "ddhqGenericBallot", status, { timeoutMs: 12000 }),
    fetchText("https://pollfinity.com/api/averages", "pollfinityAverages", status, { timeoutMs: 12000 }),
    fetchText("https://uspollingdata.com/polls/generic-ballot/", "usPollingDataGenericBallot", status, { timeoutMs: 12000 })
  ]);
  const sources = [
    parseVoteHubGeneric(votehubHtml),
    parseDdhqGeneric(ddhqJson),
    parsePollfinityGeneric(pollfinityJson),
    parseUsPollingDataGeneric(usPollingHtml)
  ].filter(Boolean);
  const senateFallback = readSenateGenericPolling();
  if (!sources.length && senateFallback) {
    status.senateGenericPollingFallback = { ok: true, status: "local", ms: 0 };
    return senateFallback;
  }
  const totalWeight = sources.reduce((sum, source) => sum + source.weight, 0);
  const margin = totalWeight ? sources.reduce((sum, source) => sum + source.margin * source.weight, 0) / totalWeight : 0;
  return { margin, sources };
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
  const [cookHtml, insideHtml, mapHtml, pollingHtml, raceToTheWhHouse, raceToTheWhGeneric, realClearGeneric, latestHousePolls, censusHtml, fec, genericPolling] = await Promise.all([
    fetchText("https://www.cookpolitical.com/ratings/house-race-ratings", "cookHouseRatings", status),
    fetchText("https://www.270towin.com/2026-house-election/table/inside-elections-2026-house-ratings", "insideElections270ToWinRatings", status),
    fetchText("https://www.270towin.com/2026-house-election/inside-elections-2026-house-ratings", "twoSeventyToWinHouseMapData", status),
    fetchText("https://www.270towin.com/2026-house-election/polls/", "twoSeventyToWinHousePolls", status, { timeoutMs: 12000 }),
    fetchText("https://www.racetothewh.com/house-3", "raceToTheWhHouseForecast", status, { timeoutMs: 12000 }),
    fetchText("https://www.racetothewh.com/polls/genericballot", "raceToTheWhGenericBallot", status, { timeoutMs: 12000 }),
    fetchText("https://www.realclearpolitics.com/epolls/other/2026_generic_congressional_vote-8670.html", "realClearPoliticsGenericBallot", status, { timeoutMs: 12000 }),
    fetchText("https://www.realclearpolling.com/latest-polls/house", "realClearPollingHousePolls", status, { timeoutMs: 12000 }),
    fetchText("https://www.census.gov/geographies/mapping-files/2025/geo/carto-boundary-file.html", "censusDistrictBoundaries", status, { timeoutMs: 12000 }),
    fetchHouseFec(status),
    fetchGenericPolling(status)
  ]);
  const mapDistricts = parse270MapDistricts(mapHtml);
  const cookDistricts = parseCookDistricts(cookHtml);
  return {
    status,
    cookDistricts,
    mapDistricts,
    insideRatings: parseInsideRatings(insideHtml),
    fec,
    genericPolling,
    housePollingReferenceReachable: Boolean(pollingHtml),
    raceToTheWhHouseReachable: Boolean(raceToTheWhHouse),
    raceToTheWhGenericReachable: Boolean(raceToTheWhGeneric),
    realClearGenericReachable: Boolean(realClearGeneric),
    realClearHousePollsReachable: Boolean(latestHousePolls),
    censusDistrictBoundaryPageReachable: Boolean(censusHtml)
  };
}

function adjustedDistricts(sourceData) {
  const genericShift = clamp(sourceData.genericPolling.margin * .56, -4.7, 4.7);
  const nationalFinanceShift = (sourceData.fec.__national?.financeSignal || 0) * MODEL_WEIGHTS.nationalFinance;
  const baseDistricts = sourceData.mapDistricts.length >= 400 ? sourceData.mapDistricts : sourceData.cookDistricts;
  return baseDistricts.map((sourceDistrict) => {
    const district = applyRedistrictingOverride(applyCandidateData(sourceDistrict, sourceData.fec[sourceDistrict.id]));
    const nomination = houseNominationInfo(district);
    const inside = sourceData.insideRatings[district.id];
    const sourceRating = district.redistrictingOverride ? district.sourceRating : inside?.rating || district.sourceRating || district.rating;
    const ratingMargin = RATING_TO_MARGIN[sourceRating] ?? 0;
    const contextMargin = contextualDistrictMargin(district, ratingMargin);
    const baselineMargin = ratingMargin * .78 + contextMargin * MODEL_WEIGHTS.districtFundamentals;
    const incumbentParty = district.seatParty === "D" ? 1 : district.seatParty === "R" ? -1 : 0;
    const challengerStrength = districtChallengerStrength(district);
    const incumbencyAdjustment = district.open ? 0 : incumbentParty * MODEL_WEIGHTS.seatPartyIncumbency * (1 - (CHALLENGER_STRENGTH_DISCOUNTS[challengerStrength] || 0));
    const openPenalty = district.open ? (baselineMargin > 0 ? -MODEL_WEIGHTS.incumbencyOpenPenalty : MODEL_WEIGHTS.incumbencyOpenPenalty) : 0;
    const financeSignal = sourceData.fec[district.id]?.financeSignal ?? 0;
    const demographicPull = houseDemographicPull(district, challengerStrength);
    const candidateQualityAdjustment = houseCandidateQualityAdjustment(district, nomination);
    const nominationAdjustment = nomination.marginAdjustment * MODEL_WEIGHTS.nominationCertainty;
    const rawMargin = baselineMargin * MODEL_WEIGHTS.ratingBaseline + genericShift + nationalFinanceShift + MODEL_WEIGHTS.historicalMidterm + incumbencyAdjustment + openPenalty + demographicPull.adjustment + financeSignal * MODEL_WEIGHTS.finance + candidateQualityAdjustment + nominationAdjustment;
    const margin = houseMarginGuardrail(district, rawMargin, ratingMargin, contextMargin, sourceRating);
    const error = Math.max(RATING_TO_ERROR[sourceRating] ?? 8, inside ? RATING_TO_ERROR[inside.rating] ?? 8 : 0) + nomination.errorAdjustment;
    const demProbability = logistic(margin, error);
    return {
      ...district,
      baselineRating: sourceRating,
      rating: ratingFromMargin(margin),
      insideRating: inside?.rating || null,
      margin: Number(margin.toFixed(2)),
      demProbability: Number(demProbability.toFixed(4)),
      repProbability: Number((1 - demProbability).toFixed(4)),
      winnerParty: demProbability >= .5 ? "D" : "R",
      winnerProbability: Number(Math.max(demProbability, 1 - demProbability).toFixed(4)),
      error,
      competitive: Math.abs(margin) < 8 || sourceRating === "Toss-up" || Boolean(inside),
      sourceInputs: {
        genericBallotShift: Number(genericShift.toFixed(2)),
        nationalFinanceShift: Number(nationalFinanceShift.toFixed(2)),
        presidentialBaseline: Number.isFinite(district.presidentialMargin) ? Number(district.presidentialMargin.toFixed(2)) : null,
        congressionalBaseline: Number.isFinite(district.congressionalMargin) ? Number(district.congressionalMargin.toFixed(2)) : null,
        districtFundamentalMargin: Number.isFinite(district.fundamentalMargin) ? Number(district.fundamentalMargin.toFixed(2)) : null,
        contextualBaseline: Number(contextMargin.toFixed(2)),
        ratingBaseline: Number(ratingMargin.toFixed(2)),
        openPenalty: Number(openPenalty.toFixed(2)),
        incumbencyAdjustment: Number(incumbencyAdjustment.toFixed(2)),
        nomination,
        candidateQualityAdjustment: Number(candidateQualityAdjustment.toFixed(2)),
        nominationAdjustment: Number(nominationAdjustment.toFixed(2)),
        demographicPull,
        challengerStrength,
        finance: sourceData.fec[district.id] || null
      },
      primaryDate: nomination.primaryDate,
      primaryStatus: nomination.status,
      primarySummary: nomination.summary,
      demStatus: nomination.demStatus,
      repStatus: nomination.repStatus,
      demProfile: nomination.demProfile,
      repProfile: nomination.repProfile,
      sourceBlend: district.redistrictingOverride ? district.ratingSource : inside ? `${district.ratingSource} + table cross-check` : district.ratingSource
    };
  });
}

function houseMarginGuardrail(district, rawMargin, ratingMargin, contextMargin, sourceRating) {
  const anchor = ratingMargin * .58 + contextMargin * .42;
  let margin = rawMargin * .86 + anchor * .14;
  const ratingSide = Math.sign(ratingMargin);
  if (ratingSide && Math.sign(margin) !== ratingSide && Math.abs(ratingMargin) >= 9.5) {
    margin = ratingSide * Math.max(7.5, Math.abs(margin) * .42);
  }
  if (/^Safe/.test(sourceRating || "") && Math.abs(margin) < 12) {
    margin = ratingSide * 12;
  }
    return margin;
}

function applyRedistrictingOverride(district) {
  const stateStatus = REDISTRICTING_STATE_STATUS[district.state] || null;
  const override = DISTRICT_REDISTRICTING_OVERRIDES[district.id];
  if (!override && !stateStatus) return district;
  return {
    ...district,
    ...(override || {}),
    ratingSource: override ? `${district.ratingSource}; local redistricting override` : district.ratingSource,
    redistrictingStatus: stateStatus?.status || "current",
    redistrictingTreatment: stateStatus?.modelTreatment || "current map",
    redistrictingEffectiveFor2026: Boolean(stateStatus?.effectiveFor2026),
    redistrictingNote: override?.redistrictingNote || stateStatus?.note || null,
    redistrictingOverride: Boolean(override)
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
    if (district.sourceRating === "Safe D" && Number.isFinite(district.margin) && district.margin < 8) failures.push(`${district.id}: Safe D source collapsed to ${district.margin}`);
    if (district.sourceRating === "Safe R" && Number.isFinite(district.margin) && district.margin > -8) failures.push(`${district.id}: Safe R source collapsed to ${district.margin}`);
    if (phase === "simulation" && district.sourceRating === "Safe D" && district.demProbability < .9) failures.push(`${district.id}: Safe D source simulated at ${district.demProbability}`);
    if (phase === "simulation" && district.sourceRating === "Safe R" && district.repProbability < .9) failures.push(`${district.id}: Safe R source simulated at ${district.repProbability}`);
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

function contextualDistrictMargin(district, ratingMargin) {
  if (!Number.isFinite(district.fundamentalMargin)) return ratingMargin;
  const side = Math.sign(ratingMargin) || (district.seatParty === "D" ? 1 : district.seatParty === "R" ? -1 : 0);
  if (!side) return 0;
  return side * Math.min(Math.abs(district.fundamentalMargin), 16);
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
      const simulatedMargin = district.margin + nationalError + stateErrors[district.state] + normalRandom() * (district.error ?? RATING_TO_ERROR[district.rating] ?? 8);
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
    throw new Error(`House ratings parse returned ${sourceData.mapDistricts.length} map districts and ${sourceData.cookDistricts.length} Cook districts`);
  }
  const districts = adjustedDistricts(sourceData);
  validateDistricts(districts, "district adjustment");
  const model = runModel(districts);
  model.districts = appendDistrictHistories(model.districts);
  validateDistricts(model.districts, "simulation");
  model.decisiveDistricts = model.decisiveDistricts.map((district) => ({
    ...(model.districts.find((item) => item.id === district.id) || district),
    leverage: district.leverage
  }));
  const output = {
    generatedAt: new Date().toISOString(),
    modelDate: MODEL_DATE_KEY,
    runDate: new Date(`${MODEL_DATE_KEY}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    updateTime: SETTINGS.updateTime,
    settings: { ...SETTINGS, modelWeights: MODEL_WEIGHTS },
    mapBasis: {
      display: "district cartogram",
      boundarySource: "Census 2025 cartographic boundary files for the 119th congressional districts",
      districtShapeMapStatus: sourceData.censusDistrictBoundaryPageReachable ? "boundary source reachable; local GeoJSON bundled for pre-redraw 119th shapes only" : "boundary source not reached during this run",
      redistrictingTreatment: "District-by-district ratings and margins are used directly, with local redistricting overrides where public rating feeds lag enacted or court-ordered maps.",
      redistrictingShapeWarning: "The visible shape map may lag enacted 2026 redistricting in states with new maps. Forecast ratings use the redistricting override layer even when the temporary map geometry has not been replaced."
    },
    sourceStatus: sourceData.status,
    sourceSummary: {
      cookDistricts: sourceData.cookDistricts.length,
      mapDistricts: sourceData.mapDistricts.length,
      insideRatings: Object.keys(sourceData.insideRatings).length,
      fecDistricts: Object.keys(sourceData.fec).filter((id) => id !== "__national").length,
      nationalFinance: sourceData.fec.__national || null,
      genericPolling: sourceData.genericPolling,
      housePollingReferenceReachable: sourceData.housePollingReferenceReachable,
      raceToTheWhHouseReachable: sourceData.raceToTheWhHouseReachable,
      raceToTheWhGenericReachable: sourceData.raceToTheWhGenericReachable,
      realClearGenericReachable: sourceData.realClearGenericReachable,
      realClearHousePollsReachable: sourceData.realClearHousePollsReachable,
      censusDistrictBoundaryPageReachable: sourceData.censusDistrictBoundaryPageReachable,
      redistricting: redistrictingSummary(districts)
    },
    ratingSummary: ratingSummary(districts),
    modelWarnings: forecastSanityWarnings(model.districts, {
      model: "house",
      id: (district) => district.id,
      name: (district) => district.displayName || district.id,
      baseline: (district) => district.sourceInputs?.ratingBaseline,
      partisanship: (district) => district.sourceInputs?.presidentialBaseline,
      candidateAdjustment: (district) => district.sourceInputs?.candidateQualityAdjustment
    }),
    controlHistory: appendControlHistory(model),
    seatHistory: appendSeatHistory(model),
    ...model
  };
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(OUTPUT_URL, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote data/house-forecast.json for ${MODEL_DATE_KEY}`);
}

await writeHouseForecast();
