import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const OUTPUT_URL = new URL("../data/house-forecast.json", import.meta.url);
const SENATE_FORECAST_URL = new URL("../data/forecast.json", import.meta.url);
const previousForecast = readPreviousForecast();

const SETTINGS = {
  simulations: 30000,
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
  "Safe D": 5.1,
  "Likely D": 6,
  "Lean D": 6.5,
  "Tilt D": 7,
  "Toss-up": 9.8,
  "Tilt R": 7,
  "Lean R": 6.5,
  "Likely R": 6,
  "Safe R": 5.1
};

const MODEL_WEIGHTS = {
  genericBallot: .65,
  genericBallotCap: 5.4,
  ratingBaseline: 1,
  districtPolls: .18,
  finance: .22,
  nationalFinance: .35,
  incumbencyOpenPenalty: .45,
  seatPartyIncumbency: .45,
  districtFundamentals: .07,
  historicalMidterm: 1.0,
  stateCorrelationSd: 1.3,
  nationalEnvironmentSd: 3.1
};

const CHALLENGER_STRENGTH_DISCOUNTS = {
  sameDistrict: .85,
  statewide: .55,
  majorOffice: .35,
  notable: .22,
  none: 0
};

const MANUAL_HOUSE_CHALLENGER_STRENGTH = {
  // Use entries such as "PA-07": { D: "notable" } when a challenger has prior office strength.
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
  const genericShift = clamp(sourceData.genericPolling.margin * MODEL_WEIGHTS.genericBallot, -MODEL_WEIGHTS.genericBallotCap, MODEL_WEIGHTS.genericBallotCap);
  const nationalFinanceShift = (sourceData.fec.__national?.financeSignal || 0) * MODEL_WEIGHTS.nationalFinance;
  const baseDistricts = sourceData.mapDistricts.length >= 400 ? sourceData.mapDistricts : sourceData.cookDistricts;
  return baseDistricts.map((district) => {
    const inside = sourceData.insideRatings[district.id];
    const sourceRating = inside?.rating || district.sourceRating || district.rating;
    const ratingMargin = RATING_TO_MARGIN[sourceRating] ?? 0;
    const contextMargin = contextualDistrictMargin(district, ratingMargin);
    const baselineMargin = ratingMargin * .88 + contextMargin * MODEL_WEIGHTS.districtFundamentals;
    const incumbentParty = district.seatParty === "D" ? 1 : district.seatParty === "R" ? -1 : 0;
    const challengerStrength = districtChallengerStrength(district);
    const incumbencyAdjustment = district.open ? 0 : incumbentParty * MODEL_WEIGHTS.seatPartyIncumbency * (1 - (CHALLENGER_STRENGTH_DISCOUNTS[challengerStrength] || 0));
    const openPenalty = district.open ? (baselineMargin > 0 ? -MODEL_WEIGHTS.incumbencyOpenPenalty : MODEL_WEIGHTS.incumbencyOpenPenalty) : 0;
    const financeSignal = sourceData.fec[district.id]?.financeSignal ?? 0;
    const demographicPull = houseDemographicPull(district, challengerStrength);
    const margin = baselineMargin * MODEL_WEIGHTS.ratingBaseline + genericShift + nationalFinanceShift + MODEL_WEIGHTS.historicalMidterm + incumbencyAdjustment + openPenalty + demographicPull.adjustment + financeSignal * MODEL_WEIGHTS.finance;
    const error = Math.max(RATING_TO_ERROR[sourceRating] ?? 8, inside ? RATING_TO_ERROR[inside.rating] ?? 8 : 0);
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
        demographicPull,
        challengerStrength,
        finance: sourceData.fec[district.id] || null
      },
      sourceBlend: inside ? `${district.ratingSource} + table cross-check` : district.ratingSource
    };
  });
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
    byDistrict[id] ||= { demReceipts: 0, repReceipts: 0, demCash: 0, repCash: 0, demDebts: 0, repDebts: 0, candidates: 0 };
    byDistrict[id].candidates += 1;
    if (side === "dem") {
      const receipts = nonNegative(row.Total_Receipt);
      const cash = nonNegative(row.Cash_On_Hand_COP) || nonNegative(row.Cash_On_Hand);
      const debts = nonNegative(row.Debts_Owed_By_Committee) || nonNegative(row.Debts_Owed);
      byDistrict[id].demReceipts += receipts;
      byDistrict[id].demCash += cash;
      byDistrict[id].demDebts += debts;
      national.demReceipts += receipts;
      national.demCash += cash;
      national.demDebts += debts;
      national.demCandidates += 1;
    }
    if (side === "rep") {
      const receipts = nonNegative(row.Total_Receipt);
      const cash = nonNegative(row.Cash_On_Hand_COP) || nonNegative(row.Cash_On_Hand);
      const debts = nonNegative(row.Debts_Owed_By_Committee) || nonNegative(row.Debts_Owed);
      byDistrict[id].repReceipts += receipts;
      byDistrict[id].repCash += cash;
      byDistrict[id].repDebts += debts;
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
  }
  national.financeSignal = nationalFinanceSignal(national);
  byDistrict.__national = national;
  status.openFecHouseCandidateSummary.rows = rows.length;
  status.openFecHouseCandidateSummary.districts = Object.keys(byDistrict).filter((id) => id !== "__national").length;
  status.openFecHouseCandidateSummary.nationalFinanceSignal = national.financeSignal;
  return byDistrict;
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
  return 1 / (1 + Math.exp(-margin / Math.max(error, .1) * 1.7));
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
      districtShapeMapStatus: sourceData.censusDistrictBoundaryPageReachable ? "boundary source reachable; local GeoJSON not bundled yet" : "boundary source not reached during this run",
      redistrictingTreatment: "Current district-by-district ratings and margins are used directly; no separate redistricting bonus is added on top of the seat ratings."
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
      censusDistrictBoundaryPageReachable: sourceData.censusDistrictBoundaryPageReachable
    },
    ratingSummary: ratingSummary(districts),
    controlHistory: appendControlHistory(model),
    seatHistory: appendSeatHistory(model),
    ...model
  };
  mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
  writeFileSync(OUTPUT_URL, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`Wrote data/house-forecast.json for ${MODEL_DATE_KEY}`);
}

await writeHouseForecast();
