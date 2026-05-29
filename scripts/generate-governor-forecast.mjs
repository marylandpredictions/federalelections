import { readFileSync, writeFileSync } from "node:fs";

const FORECAST_URL = new URL("../data/governor-forecast.json", import.meta.url);
const previousForecast = readPreviousForecast();

async function fetchText(url, label, status, options = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);

  try {
    const response = await fetch(url, {
      headers: options.headers || {},
      signal: controller.signal
    });
    const text = await response.text();
    status[label] = {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - startedAt,
      url
    };
    if (!response.ok) {
      status[label].error = text.slice(0, 180);
    }
    return response.ok ? text : null;
  } catch (error) {
    status[label] = {
      ok: false,
      status: "fetch-error",
      ms: Date.now() - startedAt,
      url,
      error: error.message
    };
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === "\"" && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (!quoted && char === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => value !== "")) rows.push(row);
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
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function toNumber(value) {
  const number = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function rowNumber(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== "") return toNumber(row[name]);
  }
  return 0;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stateSlug(state) {
  return STATE_NAMES[state]?.toLowerCase().replace(/\s+/g, "-") || state.toLowerCase();
}

async function fetchFec(status) {
  const text = await fetchText("https://www.fec.gov/files/bulk-downloads/2026/candidate_summary_2026.csv", "openFecCandidateSummary", status);
  const byState = {};
  const national = {
    demReceipts: 0, repReceipts: 0,
    demCash: 0, repCash: 0,
    demDebts: 0, repDebts: 0,
    demDisbursements: 0, repDisbursements: 0,
    demIndividual: 0, repIndividual: 0,
    otherReceipts: 0, otherCash: 0, otherDebts: 0, otherDisbursements: 0, otherIndividual: 0
  };
  if (!text) return { byState, national };
  const rows = parseCsv(text);
  for (const row of rows) {
    const stateCode = row["cand_st"] || row["CAND_ST"];
    const party = (row["cand_party_affiliation"] || row["CAND_PARTY_AFFILIATION"] || "").toUpperCase();
    const receipts = rowNumber(row, ["net_contributions", "NET_CONTRIBUTIONS", "total_receipts", "TOTAL_RECEIPTS"]);
    const cash = rowNumber(row, ["cash_on_hand_end_period", "CASH_ON_HAND_END_PERIOD"]);
    const debts = rowNumber(row, ["debts_owed_by_committee", "DEBTS_OWED_BY_COMMITTEE"]);
    const disbursements = rowNumber(row, ["total_disbursements", "TOTAL_DISBURSEMENTS"]);
    const individual = rowNumber(row, ["contributions_from_individuals", "CONTRIBUTIONS_FROM_INDIVIDUALS"]);
    if (!stateCode || !STATE_NAMES[stateCode]) continue;
    if (!byState[stateCode]) {
      byState[stateCode] = {
        demReceipts: 0, repReceipts: 0,
        demCash: 0, repCash: 0,
        demDebts: 0, repDebts: 0,
        demDisbursements: 0, repDisbursements: 0,
        demIndividual: 0, repIndividual: 0,
        otherReceipts: 0, otherCash: 0, otherDebts: 0, otherDisbursements: 0, otherIndividual: 0
      };
    }
    const stateData = byState[stateCode];
    if (party === "DEM" || party === "D") {
      stateData.demReceipts += receipts;
      stateData.demCash += cash;
      stateData.demDebts += debts;
      stateData.demDisbursements += disbursements;
      stateData.demIndividual += individual;
      national.demReceipts += receipts;
      national.demCash += cash;
      national.demDebts += debts;
      national.demDisbursements += disbursements;
      national.demIndividual += individual;
    } else if (party === "REP" || party === "R") {
      stateData.repReceipts += receipts;
      stateData.repCash += cash;
      stateData.repDebts += debts;
      stateData.repDisbursements += disbursements;
      stateData.repIndividual += individual;
      national.repReceipts += receipts;
      national.repCash += cash;
      national.repDebts += debts;
      national.repDisbursements += disbursements;
      national.repIndividual += individual;
    } else {
      stateData.otherReceipts += receipts;
      stateData.otherCash += cash;
      stateData.otherDebts += debts;
      stateData.otherDisbursements += disbursements;
      stateData.otherIndividual += individual;
      national.otherReceipts += receipts;
      national.otherCash += cash;
      national.otherDebts += debts;
      national.otherDisbursements += disbursements;
      national.otherIndividual += individual;
    }
  }
  national.financeSignal = nationalFinanceSignal(national);
  byState.__national = national;
  status.openFecCandidateSummary = { rows: rows.length, governorStates: Object.keys(byState).filter((state) => STATE_NAMES[state]).length, nationalFinanceSignal: national.financeSignal };
  return byState;
}

async function fetchDdhqGenericBallot(status) {
  const url = "https://polls.decisiondeskhq.com/averages/generic-ballot/national/lv-rv-adults";
  const text = await fetchText(url, "ddhqGenericBallot", status, { timeoutMs: 15000 });
  if (!text) return { genericBallotMargin: null, polls: 0 };
  if (/Vercel Security Checkpoint/i.test(text)) {
    status.ddhqGenericBallot.ok = false;
    status.ddhqGenericBallot.error = "Vercel security checkpoint";
    return { genericBallotMargin: null, polls: 0 };
  }
  const match = text.match(/"margin":\s*([0-9.-]+)/);
  const margin = match ? Number(match[1]) : null;
  const pollsMatch = text.match(/"polls":\s*([0-9]+)/);
  const polls = pollsMatch ? Number(pollsMatch[1]) : 0;
  return { genericBallotMargin: margin, polls };
}

async function fetchPollfinityAverages(status) {
  const url = "https://pollfinity.com/averages.json";
  const text = await fetchText(url, "pollfinityAverages", status, {
    headers: { accept: "application/json" },
    timeoutMs: 15000
  });
  if (!text) return { genericBallotMargin: null, governorPolls: {} };
  try {
    const data = JSON.parse(text);
    const generic = data.generic_ballot?.national?.margin;
    const governorPolls = {};
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith("governor_")) {
        const state = key.replace("governor_", "").toUpperCase();
        if (value.margin !== undefined && STATE_NAMES[state]) {
          governorPolls[state] = { margin: value.margin, polls: value.poll_count || 0 };
        }
      }
    }
    return { genericBallotMargin: generic, governorPolls };
  } catch {
    return { genericBallotMargin: null, governorPolls: {} };
  }
}

async function fetchAllSources() {
  const status = { checkedAt: new Date().toISOString() };
  const [fec, ddhqGeneric, pollfinity] = await Promise.all([
    fetchFec(status),
    fetchDdhqGenericBallot(status),
    fetchPollfinityAverages(status)
  ]);
  return { fec, ddhqGeneric, pollfinity, status };
}

const SETTINGS = {
  simulations: 50000,
  electionDate: "2026-11-03",
  currentDemGovernors: 24,
  currentRepGovernors: 26,
  demNotUp: 6,
  repNotUp: 8,
  dataSources: [
    "Manual 2026 gubernatorial race ledger with candidates, incumbency, PVI, and last gubernatorial margin",
    "Cook Political Report, Inside Elections, Sabato's Crystal Ball, WH, VoteHub, and RCP rating references",
    "Current Senate model generic ballot signal as a broad midterm environment input",
    "OpenFEC candidate finance bulk files"
  ]
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IA: "Iowa", KS: "Kansas", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NM: "New Mexico", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", VT: "Vermont", WI: "Wisconsin", WY: "Wyoming"
};

const RATING_TO_MARGIN = {
  "Safe D": 18, "Likely D": 10.5, "Lean D": 5, "Tilt D": 2.1, "Toss-up": 0,
  "Tilt R": -2.1, "Lean R": -5, "Likely R": -10.5, "Safe R": -18
};

const RATING_TO_ERROR = {
  "Safe D": 7.5, "Likely D": 8.5, "Lean D": 9.5, "Tilt D": 10.5, "Toss-up": 11,
  "Tilt R": 10.5, "Lean R": 9.5, "Likely R": 8.5, "Safe R": 7.5
};

const MODEL_WEIGHTS = {
  nationalFinance: .45
};

const INDEPENDENT_CONTROL_FINANCE = {
  NE: { side: "dem", label: "Dan Osborn" }
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

const MIDTERM_LIKELY_VOTER_BASELINES = {
  AL: { white_college: .24, white_noncollege: .43, black: .27, latino: .03, asian_other: .03 },
  AK: { white_college: .31, white_noncollege: .42, black: .03, latino: .04, asian_other: .20 },
  AR: { white_college: .25, white_noncollege: .55, black: .14, latino: .03, asian_other: .03 },
  CO: { white_college: .47, white_noncollege: .31, black: .03, latino: .14, asian_other: .05 },
  DE: { white_college: .39, white_noncollege: .35, black: .18, latino: .05, asian_other: .03 },
  FL: { white_college: .31, white_noncollege: .36, black: .12, latino: .16, asian_other: .05 },
  GA: { white_college: .31, white_noncollege: .31, black: .30, latino: .04, asian_other: .04 },
  ID: { white_college: .32, white_noncollege: .54, black: .01, latino: .09, asian_other: .04 },
  IL: { white_college: .40, white_noncollege: .36, black: .13, latino: .07, asian_other: .04 },
  IA: { white_college: .32, white_noncollege: .58, black: .03, latino: .04, asian_other: .03 },
  KS: { white_college: .34, white_noncollege: .49, black: .06, latino: .07, asian_other: .04 },
  KY: { white_college: .28, white_noncollege: .59, black: .08, latino: .03, asian_other: .02 },
  LA: { white_college: .24, white_noncollege: .41, black: .29, latino: .03, asian_other: .03 },
  ME: { white_college: .42, white_noncollege: .51, black: .01, latino: .02, asian_other: .04 },
  MA: { white_college: .55, white_noncollege: .28, black: .07, latino: .06, asian_other: .04 },
  MI: { white_college: .35, white_noncollege: .49, black: .10, latino: .03, asian_other: .03 },
  MN: { white_college: .42, white_noncollege: .44, black: .06, latino: .04, asian_other: .04 },
  MS: { white_college: .21, white_noncollege: .41, black: .34, latino: .02, asian_other: .02 },
  MT: { white_college: .36, white_noncollege: .54, black: .01, latino: .03, asian_other: .06 },
  NE: { white_college: .33, white_noncollege: .54, black: .04, latino: .06, asian_other: .03 },
  NV: { white_college: .33, white_noncollege: .38, black: .08, latino: .16, asian_other: .05 },
  NH: { white_college: .47, white_noncollege: .47, black: .01, latino: .02, asian_other: .03 },
  NJ: { white_college: .43, white_noncollege: .31, black: .12, latino: .10, asian_other: .04 },
  NM: { white_college: .30, white_noncollege: .30, black: .02, latino: .33, asian_other: .05 },
  NY: { white_college: .43, white_noncollege: .31, black: .12, latino: .10, asian_other: .04 },
  NC: { white_college: .34, white_noncollege: .42, black: .19, latino: .03, asian_other: .02 },
  OH: { white_college: .33, white_noncollege: .53, black: .09, latino: .03, asian_other: .02 },
  OK: { white_college: .25, white_noncollege: .51, black: .07, latino: .06, asian_other: .11 },
  OR: { white_college: .43, white_noncollege: .40, black: .02, latino: .08, asian_other: .07 },
  PA: { white_college: .38, white_noncollege: .42, black: .10, latino: .04, asian_other: .02 },
  RI: { white_college: .43, white_noncollege: .36, black: .06, latino: .11, asian_other: .04 },
  SC: { white_college: .29, white_noncollege: .43, black: .24, latino: .02, asian_other: .02 },
  SD: { white_college: .31, white_noncollege: .56, black: .02, latino: .03, asian_other: .08 },
  TN: { white_college: .29, white_noncollege: .53, black: .13, latino: .03, asian_other: .02 },
  TX: { white_college: .29, white_noncollege: .37, black: .12, latino: .18, asian_other: .04 },
  UT: { white_college: .35, white_noncollege: .48, black: .01, latino: .10, asian_other: .06 },
  VA: { white_college: .43, white_noncollege: .33, black: .16, latino: .05, asian_other: .03 },
  WA: { white_college: .45, white_noncollege: .33, black: .04, latino: .08, asian_other: .10 },
  WV: { white_college: .23, white_noncollege: .72, black: .03, latino: .01, asian_other: .01 },
  WI: { white_college: .38, white_noncollege: .48, black: .06, latino: .03, asian_other: .05 },
  WY: { white_college: .30, white_noncollege: .61, black: .01, latino: .05, asian_other: .03 }
};

const MIDTERM_AGE_BASELINES = {
  AL: { youth: .13, core_age: .57, senior: .30 },
  AK: { youth: .16, core_age: .63, senior: .21 },
  AR: { youth: .13, core_age: .56, senior: .31 },
  CO: { youth: .17, core_age: .60, senior: .23 },
  DE: { youth: .13, core_age: .55, senior: .32 },
  FL: { youth: .12, core_age: .55, senior: .33 },
  GA: { youth: .15, core_age: .59, senior: .26 },
  ID: { youth: .15, core_age: .57, senior: .28 },
  IL: { youth: .15, core_age: .58, senior: .27 },
  IA: { youth: .14, core_age: .55, senior: .31 },
  KS: { youth: .15, core_age: .57, senior: .28 },
  KY: { youth: .13, core_age: .56, senior: .31 },
  LA: { youth: .14, core_age: .58, senior: .28 },
  ME: { youth: .11, core_age: .52, senior: .37 },
  MA: { youth: .15, core_age: .57, senior: .28 },
  MI: { youth: .14, core_age: .56, senior: .30 },
  MN: { youth: .15, core_age: .57, senior: .28 },
  MS: { youth: .14, core_age: .57, senior: .29 },
  MT: { youth: .13, core_age: .55, senior: .32 },
  NE: { youth: .15, core_age: .56, senior: .29 },
  NV: { youth: .16, core_age: .60, senior: .24 },
  NH: { youth: .12, core_age: .55, senior: .33 },
  NJ: { youth: .14, core_age: .57, senior: .29 },
  NM: { youth: .14, core_age: .56, senior: .30 },
  NC: { youth: .15, core_age: .58, senior: .27 },
  OH: { youth: .14, core_age: .56, senior: .30 },
  OK: { youth: .14, core_age: .57, senior: .29 },
  OR: { youth: .14, core_age: .57, senior: .29 },
  PA: { youth: .13, core_age: .56, senior: .31 },
  RI: { youth: .13, core_age: .56, senior: .31 },
  SC: { youth: .13, core_age: .56, senior: .31 },
  SD: { youth: .14, core_age: .55, senior: .31 },
  TN: { youth: .13, core_age: .57, senior: .30 },
  TX: { youth: .16, core_age: .60, senior: .24 },
  UT: { youth: .15, core_age: .57, senior: .28 },
  VA: { youth: .15, core_age: .58, senior: .27 },
  WA: { youth: .16, core_age: .59, senior: .25 },
  WV: { youth: .11, core_age: .54, senior: .35 },
  WI: { youth: .14, core_age: .56, senior: .30 },
  WY: { youth: .13, core_age: .56, senior: .31 }
};

const PATH_CENTRALITY = {
  OH: 1.85, TX: 1.65, AK: 1.6, MI: 1.35, GA: 1.25, NC: 1.12, ME: 1.1, NH: 1,
  IA: .75, NE: .72, MT: .68, SC: .55, KS: .45, FL: .25
};

const STATE_ELASTICITY = {
  AK: 1.18, AZ: 1.08, GA: 1.12, IA: 1.1, ME: .86, MI: 1.12, MN: .9, MT: 1.04,
  NC: 1.18, NH: .94, OH: 1.22, PA: 1.12, TX: 1.16, VA: .86, WI: 1.12
};

const CANDIDATE_HISTORY = {
  OH: 1.15, PA: 1.25, GA: .7, MI: .25, NE: 1.45, MT: .8, NC: 1.25
};

const GOVERNOR_RACES = [
  { state: "AL", incumbentParty: "R", incumbent: "Kay Ivey", status: "Term-limited", pvi: -15, lastMargin: -33.8, rating: "Safe R", demCandidate: "Doug Jones", repCandidate: "Tommy Tuberville", candidateEdge: 1.2 },
  { state: "AK", incumbentParty: "R", incumbent: "Mike Dunleavy", status: "Term-limited", pvi: -6, lastMargin: -5.7, rating: "Lean R", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .4 },
  { state: "AZ", incumbentParty: "D", incumbent: "Katie Hobbs", status: "Incumbent running", pvi: -2, lastMargin: .6, rating: "Toss-up", demCandidate: "Katie Hobbs", repCandidate: "Republican", candidateEdge: -.4 },
  { state: "AR", incumbentParty: "R", incumbent: "Sarah Huckabee Sanders", status: "Incumbent renominated", pvi: -15, lastMargin: -26, rating: "Safe R", demCandidate: "Fredrick Love", repCandidate: "Sarah Huckabee Sanders", candidateEdge: -1 },
  { state: "CA", incumbentParty: "D", incumbent: "Gavin Newsom", status: "Term-limited", pvi: 12, lastMargin: 18.4, rating: "Safe D", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .3 },
  { state: "CO", incumbentParty: "D", incumbent: "Jared Polis", status: "Term-limited", pvi: 6, lastMargin: 19.3, rating: "Safe D", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: 1.3 },
  { state: "CT", incumbentParty: "D", incumbent: "Ned Lamont", status: "Incumbent running", pvi: 8, lastMargin: 12, rating: "Safe D", demCandidate: "Ned Lamont", repCandidate: "Ryan Fazio", candidateEdge: .6 },
  { state: "FL", incumbentParty: "R", incumbent: "Ron DeSantis", status: "Term-limited", pvi: -5, lastMargin: -19.4, rating: "Likely R", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: -.2 },
  { state: "GA", incumbentParty: "R", incumbent: "Brian Kemp", status: "Term-limited", pvi: -1, lastMargin: -7.5, rating: "Toss-up", demCandidate: "Keisha Lance Bottoms", repCandidate: "Burt Jones / Rick Jackson", candidateEdge: .5 },
  { state: "HI", incumbentParty: "D", incumbent: "Josh Green", status: "Incumbent running", pvi: 13, lastMargin: 26.4, rating: "Safe D", demCandidate: "Josh Green", repCandidate: "Gary Cordery", candidateEdge: 1 },
  { state: "ID", incumbentParty: "R", incumbent: "Brad Little", status: "Incumbent renominated", pvi: -18, lastMargin: -20.6, rating: "Safe R", demCandidate: "Terri Pickens", repCandidate: "Brad Little", candidateEdge: -1 },
  { state: "IL", incumbentParty: "D", incumbent: "JB Pritzker", status: "Incumbent renominated", pvi: 6, lastMargin: 12.5, rating: "Safe D", demCandidate: "JB Pritzker", repCandidate: "Darren Bailey", candidateEdge: 1.1 },
  { state: "IA", incumbentParty: "R", incumbent: "Kim Reynolds", status: "Incumbent retiring", pvi: -6, lastMargin: -18.6, rating: "Toss-up", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: 2.4 },
  { state: "KS", incumbentParty: "D", incumbent: "Laura Kelly", status: "Term-limited", pvi: -8, lastMargin: 2.2, rating: "Lean R", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .5 },
  { state: "ME", incumbentParty: "D", incumbent: "Janet Mills", status: "Term-limited", pvi: 4, lastMargin: 12.8, rating: "Likely D", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .4 },
  { state: "MD", incumbentParty: "D", incumbent: "Wes Moore", status: "Incumbent running", pvi: 15, lastMargin: 29.9, rating: "Safe D", demCandidate: "Wes Moore", repCandidate: "Republican", candidateEdge: 1.5 },
  { state: "MA", incumbentParty: "D", incumbent: "Maura Healey", status: "Incumbent running", pvi: 14, lastMargin: 29.2, rating: "Safe D", demCandidate: "Maura Healey", repCandidate: "Republican", candidateEdge: 1.2 },
  { state: "MI", incumbentParty: "D", incumbent: "Gretchen Whitmer", status: "Term-limited", pvi: 0, lastMargin: 10.6, rating: "Lean D", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .8 },
  { state: "MN", incumbentParty: "D", incumbent: "Tim Walz", status: "Incumbent retiring", pvi: 3, lastMargin: 7.7, rating: "Safe D", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .4 },
  { state: "NE", incumbentParty: "R", incumbent: "Jim Pillen", status: "Incumbent running", pvi: -10, lastMargin: -23.8, rating: "Safe R", demCandidate: "Lynne Walz", repCandidate: "Jim Pillen", candidateEdge: -1 },
  { state: "NV", incumbentParty: "R", incumbent: "Joe Lombardo", status: "Incumbent running", pvi: -1, lastMargin: -1.5, rating: "Toss-up", demCandidate: "Democrat", repCandidate: "Joe Lombardo", candidateEdge: -1.6 },
  { state: "NH", incumbentParty: "R", incumbent: "Kelly Ayotte", status: "Incumbent running", pvi: 2, lastMargin: -9.2, rating: "Likely R", demCandidate: "Democrat", repCandidate: "Kelly Ayotte", candidateEdge: -1.6 },
  { state: "NM", incumbentParty: "D", incumbent: "Michelle Lujan Grisham", status: "Term-limited", pvi: 4, lastMargin: 6.4, rating: "Likely D", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: .2 },
  { state: "NY", incumbentParty: "D", incumbent: "Kathy Hochul", status: "Incumbent running", pvi: 8, lastMargin: 6.4, rating: "Likely D", demCandidate: "Kathy Hochul", repCandidate: "Republican", candidateEdge: .3 },
  { state: "OH", incumbentParty: "R", incumbent: "Mike DeWine", status: "Term-limited", pvi: -5, lastMargin: -25.4, rating: "Lean R", demCandidate: "Amy Acton", repCandidate: "Vivek Ramaswamy", candidateEdge: -.6 },
  { state: "OK", incumbentParty: "R", incumbent: "Kevin Stitt", status: "Term-limited", pvi: -17, lastMargin: -13.7, rating: "Safe R", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: -.4 },
  { state: "OR", incumbentParty: "D", incumbent: "Tina Kotek", status: "Incumbent running", pvi: 8, lastMargin: 3.4, rating: "Likely D", demCandidate: "Tina Kotek", repCandidate: "Christine Drazan", candidateEdge: .2 },
  { state: "PA", incumbentParty: "D", incumbent: "Josh Shapiro", status: "Incumbent running", pvi: -1, lastMargin: 14.8, rating: "Safe D", demCandidate: "Josh Shapiro", repCandidate: "Stacy Garrity", candidateEdge: 3.8 },
  { state: "RI", incumbentParty: "D", incumbent: "Dan McKee", status: "Incumbent running", pvi: 8, lastMargin: 19.3, rating: "Safe D", demCandidate: "Dan McKee", repCandidate: "Republican", candidateEdge: .5 },
  { state: "SC", incumbentParty: "R", incumbent: "Henry McMaster", status: "Term-limited", pvi: -8, lastMargin: -17.8, rating: "Likely R", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: -.5 },
  { state: "SD", incumbentParty: "R", incumbent: "Larry Rhoden", status: "Incumbent running", pvi: -15, lastMargin: -24, rating: "Safe R", demCandidate: "Daniel Ahlers", repCandidate: "Larry Rhoden", candidateEdge: -.8 },
  { state: "TN", incumbentParty: "R", incumbent: "Bill Lee", status: "Term-limited", pvi: -14, lastMargin: -32.7, rating: "Safe R", demCandidate: "Democrat", repCandidate: "Republican", candidateEdge: -.8 },
  { state: "TX", incumbentParty: "R", incumbent: "Greg Abbott", status: "Incumbent renominated", pvi: -6, lastMargin: -10.9, rating: "Safe R", demCandidate: "Gina Hinojosa", repCandidate: "Greg Abbott", candidateEdge: -1.7 },
  { state: "VT", incumbentParty: "R", incumbent: "Phil Scott", status: "Incumbent running", pvi: 17, lastMargin: -46.9, rating: "Safe R", demCandidate: "Democrat", repCandidate: "Phil Scott", candidateEdge: -6.5 },
  { state: "WI", incumbentParty: "D", incumbent: "Tony Evers", status: "Incumbent retiring", pvi: 0, lastMargin: 3.4, rating: "Toss-up", demCandidate: "Democrat", repCandidate: "Tom Tiffany", candidateEdge: .4 },
  { state: "WY", incumbentParty: "R", incumbent: "Mark Gordon", status: "Term-limited", pvi: -23, lastMargin: -53.8, rating: "Safe R", demCandidate: "Gabriel Green", repCandidate: "Republican", candidateEdge: -.8 }
];

const GOVERNOR_CANDIDATE_STATUS = {
  AL: { dem: "Doug Jones", rep: "Tommy Tuberville", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-19", primarySummary: "Jones won the Democratic primary and Tuberville won the Republican primary on May 19, 2026." },
  AK: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "top-four", primaryDate: "2026-08-18", primarySummary: "Alaska uses a nonpartisan top-four primary. Multiple Democrats, Republicans, and independents remain possible general-election options." },
  AZ: { dem: "Katie Hobbs", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-04", primarySummary: "Hobbs is the Democratic incumbent and treated as presumptive; the Republican primary remains open." },
  AR: { dem: "Fredrick Love", rep: "Sarah Huckabee Sanders", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-03-03", primarySummary: "Sanders and Love are treated as nominated after Arkansas' March primary." },
  CA: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "top-two", primaryDate: "2026-06-02", primarySummary: "California's top-two primary has a large field; the model treats both parties as unresolved." },
  CO: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-30", primarySummary: "Colorado's open-seat primaries remain unresolved." },
  CT: { dem: "Ned Lamont", rep: "Ryan Fazio", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Lamont is the Democratic incumbent and treated as presumptive while the Republican side remains unsettled." },
  FL: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-18", primarySummary: "Florida is an open seat with both major-party primaries unresolved." },
  GA: { dem: "Keisha Lance Bottoms", rep: "Burt Jones / Rick Jackson", demStatus: "nominee", repStatus: "runoff", primary: "runoff", primaryDate: "2026-06-16", primarySummary: "Bottoms won the Democratic primary on May 19, 2026. Jones and Jackson advanced to a Republican runoff on June 16, 2026." },
  HI: { dem: "Josh Green", rep: "Gary Cordery", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-08", primarySummary: "Green is the Democratic incumbent and treated as presumptive." },
  ID: { dem: "Terri Pickens", rep: "Brad Little", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-19", primarySummary: "Little and Pickens are treated as nominated after Idaho's May primary." },
  IL: { dem: "JB Pritzker", rep: "Darren Bailey", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-03-17", primarySummary: "Pritzker and Bailey are treated as nominated after Illinois' March primary." },
  IA: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-02", primarySummary: "Iowa is an open seat and both primaries remain unresolved." },
  KS: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-04", primarySummary: "Both Kansas primaries remain unresolved in the manual ledger." },
  ME: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-09", primarySummary: "Maine's open-seat field is unsettled." },
  MD: { dem: "Wes Moore", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-23", primarySummary: "Moore is the Democratic incumbent and treated as presumptive." },
  MA: { dem: "Maura Healey", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-09-01", primarySummary: "Healey is the Democratic incumbent and treated as presumptive." },
  MI: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-04", primarySummary: "Michigan is an open seat with both primaries unresolved." },
  MN: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Minnesota is an open seat and both primaries remain unresolved." },
  NE: { dem: "Lynne Walz", rep: "Jim Pillen", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-12", primarySummary: "Walz won the Democratic primary and Pillen won the Republican primary on May 12, 2026." },
  NV: { dem: "Democrat", rep: "Joe Lombardo", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-06-09", primarySummary: "Lombardo is the Republican incumbent and treated as presumptive." },
  NH: { dem: "Democrat", rep: "Kelly Ayotte", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-09-08", primarySummary: "Ayotte is the Republican incumbent and treated as presumptive." },
  NM: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-02", primarySummary: "New Mexico is an open seat and both primaries remain unresolved." },
  NY: { dem: "Kathy Hochul", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-23", primarySummary: "Hochul is the Democratic incumbent and treated as presumptive." },
  OH: { dem: "Amy Acton", rep: "Vivek Ramaswamy", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-05", primarySummary: "Acton won the Democratic primary and Ramaswamy won the Republican primary on May 5, 2026." },
  OK: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-16", primarySummary: "Oklahoma is an open seat and both primaries remain unresolved." },
  OR: { dem: "Tina Kotek", rep: "Christine Drazan", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-19", primarySummary: "Kotek won the Democratic primary and Drazan won the Republican primary on May 19, 2026." },
  PA: { dem: "Josh Shapiro", rep: "Stacy Garrity", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-05-19", primarySummary: "Shapiro won the Democratic primary and Garrity won the Republican primary on May 19, 2026." },
  RI: { dem: "Dan McKee", rep: "Republican", demStatus: "presumptive", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-09-09", primarySummary: "McKee is the Democratic incumbent and treated as presumptive." },
  SC: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-06-09", primarySummary: "South Carolina is an open seat and both primaries remain unresolved." },
  SD: { dem: "Daniel Ahlers", rep: "Larry Rhoden", demStatus: "presumptive", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-06-02", primarySummary: "Ahlers is the presumptive Democratic nominee. Rhoden is the Republican incumbent and treated as presumptive for the June 2 primary." },
  TN: { dem: "Democrat", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-06", primarySummary: "Tennessee is an open seat with crowded major-party candidate fields." },
  TX: { dem: "Gina Hinojosa", rep: "Greg Abbott", demStatus: "nominee", repStatus: "nominee", primary: "resolved", primaryDate: "2026-03-03", primarySummary: "Abbott and Hinojosa are treated as nominated after the Texas primary." },
  VT: { dem: "Democrat", rep: "Phil Scott", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Scott is the Republican incumbent and treated as presumptive; Democrats have multiple declared candidates." },
  WI: { dem: "Democrat", rep: "Tom Tiffany", demStatus: "unresolved", repStatus: "presumptive", primary: "unresolved", primaryDate: "2026-08-11", primarySummary: "Wisconsin is an open seat. Tiffany is treated as the Republican front-runner; the Democratic primary remains unresolved." },
  WY: { dem: "Gabriel Green", rep: "Republican", demStatus: "unresolved", repStatus: "unresolved", primary: "unresolved", primaryDate: "2026-08-18", primarySummary: "Wyoming is an open seat and both primaries remain unresolved." }
};

const GOVERNOR_DEMOGRAPHIC_PROFILES = {
  incumbentDemocrat: { white_college: .12, white_noncollege: -.06, black: .08, latino: .05, asian_other: .05, youth: .02, senior: .04 },
  incumbentRepublican: { white_college: -.02, white_noncollege: .12, black: -.07, latino: -.03, asian_other: -.02, youth: -.05, senior: .08 },
  statewideDemocrat: { white_college: .1, white_noncollege: -.02, black: .08, latino: .05, asian_other: .04, youth: .03, senior: .01 },
  statewideRepublican: { white_college: -.03, white_noncollege: .11, black: -.07, latino: -.03, asian_other: -.02, youth: -.05, senior: .06 },
  standardDemocrat: { white_college: .06, white_noncollege: -.05, black: .07, latino: .04, asian_other: .03, youth: .03, senior: -.01 },
  standardRepublican: { white_college: -.06, white_noncollege: .1, black: -.07, latino: -.04, asian_other: -.03, youth: -.04, senior: .05 },
  independent: { white_college: .04, white_noncollege: .12, black: .01, latino: .02, asian_other: .02, youth: .05, senior: .01 }
};

const GOVERNOR_CANDIDATE_DEMOGRAPHIC_PROFILES = {
  "phil scott": { profile: "popular Vermont Republican incumbent", scores: { white_college: .18, white_noncollege: .3, black: -.02, latino: .01, asian_other: .02, youth: .02, senior: .22 }, strengths: ["White college", "White non-college", "65+"], weaknesses: [] },
  "josh shapiro": { profile: "high-approval Pennsylvania Democratic incumbent", scores: { white_college: .18, white_noncollege: .08, black: .1, latino: .04, asian_other: .05, youth: .03, senior: .12 }, strengths: ["White college", "White non-college", "65+"], weaknesses: [] },
  "rob sand": { profile: "Iowa statewide Democratic auditor", scores: { white_college: .08, white_noncollege: .18, black: .04, latino: .03, asian_other: .02, youth: .04, senior: .06 }, strengths: ["White non-college", "White college"], weaknesses: [] },
  "joe lombardo": { profile: "Nevada Republican incumbent", scores: { white_college: -.02, white_noncollege: .12, black: -.06, latino: .02, asian_other: -.01, youth: -.04, senior: .08 }, strengths: ["White non-college", "65+", "Latino"], weaknesses: ["18-29"] },
  "kelly ayotte": { profile: "New Hampshire Republican incumbent", scores: { white_college: .02, white_noncollege: .1, black: -.05, latino: -.02, asian_other: -.01, youth: -.05, senior: .08 }, strengths: ["White college", "65+"], weaknesses: ["18-29"] },
  "katie hobbs": { profile: "Arizona Democratic incumbent", scores: { white_college: .12, white_noncollege: -.05, black: .06, latino: .08, asian_other: .04, youth: .03, senior: -.01 }, strengths: ["White college", "Latino"], weaknesses: ["White non-college"] },
  "greg abbott": { profile: "Texas Republican incumbent", scores: { white_college: -.08, white_noncollege: .2, black: -.09, latino: .02, asian_other: -.04, youth: -.08, senior: .12 }, strengths: ["White non-college", "65+", "Latino"], weaknesses: ["White college", "18-29"] },
  "amy acton": { profile: "Former Ohio health director, public health background", scores: { white_college: .08, white_noncollege: -.03, black: .09, latino: .05, asian_other: .04, youth: .05, senior: .01 }, strengths: ["White college", "Black", "Latino"], weaknesses: ["White non-college"] },
  "vivek ramaswamy": { profile: "Entrepreneur, Trump-aligned Republican", scores: { white_college: -.07, white_noncollege: .19, black: -.11, latino: -.04, asian_other: .02, youth: -.03, senior: .04 }, strengths: ["White non-college"], weaknesses: ["White college", "Black", "Latino"] },
  "keisha lance bottoms": { profile: "Former Atlanta mayor, Black woman, progressive Democrat", scores: { white_college: .05, white_noncollege: -.06, black: .15, latino: .04, asian_other: .03, youth: .04, senior: -.02 }, strengths: ["Black"], weaknesses: ["White non-college"] },
  "lynne walz": { profile: "Former Nebraska state senator, educator", scores: { white_college: .07, white_noncollege: -.04, black: .07, latino: .05, asian_other: .04, youth: .04, senior: 0 }, strengths: [], weaknesses: [] },
  "jim pillen": { profile: "Nebraska incumbent governor, rancher", scores: { white_college: -.01, white_noncollege: .14, black: -.07, latino: -.03, asian_other: -.02, youth: -.04, senior: .09 }, strengths: ["White non-college", "Senior"], weaknesses: [] },
  "tina kotek": { profile: "Oregon incumbent governor, progressive Democrat", scores: { white_college: .14, white_noncollege: -.04, black: .09, latino: .06, asian_other: .06, youth: .03, senior: .05 }, strengths: ["White college", "Asian/other", "Latino"], weaknesses: ["White non-college"] },
  "christine drazan": { profile: "Former Oregon Senate minority leader, 2022 Republican nominee", scores: { white_college: -.04, white_noncollege: .12, black: -.06, latino: -.03, asian_other: -.02, youth: -.03, senior: .06 }, strengths: ["White non-college", "Senior"], weaknesses: ["White college"] },
  "stacy garrity": { profile: "Pennsylvania state treasurer, former military officer", scores: { white_college: -.04, white_noncollege: .12, black: -.06, latino: -.03, asian_other: -.02, youth: -.03, senior: .07 }, strengths: ["White non-college", "Senior"], weaknesses: ["White college"] },
  "daniel ahlers": { profile: "South Dakota Democratic Party executive director, former state senator", scores: { white_college: .07, white_noncollege: -.04, black: .07, latino: .04, asian_other: .03, youth: .04, senior: -.01 }, strengths: [], weaknesses: [] },
  "larry rhoden": { profile: "South Dakota incumbent governor, former lieutenant governor", scores: { white_college: -.01, white_noncollege: .14, black: -.07, latino: -.03, asian_other: -.02, youth: -.04, senior: .09 }, strengths: ["White non-college", "Senior"], weaknesses: [] },
  "tom tiffany": { profile: "Wisconsin Republican congressional profile", scores: { white_college: -.08, white_noncollege: .18, black: -.08, latino: -.03, asian_other: -.03, youth: -.06, senior: .06 }, strengths: ["White non-college"], weaknesses: ["White college", "18-29"] }
};

function readPreviousForecast() {
  try {
    return JSON.parse(readFileSync(FORECAST_URL, "utf8"));
  } catch {
    return null;
  }
}

function readSenateSignals() {
  try {
    const senate = JSON.parse(readFileSync(new URL("../data/forecast.json", import.meta.url), "utf8"));
    const generic = Number(senate?.sourceSummary?.genericPolling?.genericBallotMargin);
    const approval = Number(senate?.sourceSummary?.trumpApproval?.netApproximation);
    return {
      genericBallotMargin: Number.isFinite(generic) ? generic : 0,
      approvalNet: Number.isFinite(approval) ? approval : null
    };
  } catch {
    return { genericBallotMargin: 0, approvalNet: null };
  }
}

function erf(value) {
  const sign = Math.sign(value);
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function normalCdf(value, mean, sd) {
  return 0.5 * (1 + erf((value - mean) / (sd * Math.sqrt(2))));
}

function sampleNormal(mean, sd) {
  const u1 = Math.max(Math.random(), Number.EPSILON);
  const u2 = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function candidateProfileKey(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function governorProfileKey(race, party) {
  const status = party === "D" ? race.demStatus : race.repStatus;
  const displayParty = party === "D" ? race.demDisplayParty : race.repDisplayParty;
  if (displayParty === "I") return "independent";
  if (party === "D" && race.incumbentParty === "D" && status === "presumptive") return "incumbentDemocrat";
  if (party === "R" && race.incumbentParty === "R" && status === "presumptive") return "incumbentRepublican";
  if (party === "D" && /(governor|auditor|secretary|attorney|senator|mayor|representative|statewide)/i.test(race.dem || "")) return "statewideDemocrat";
  if (party === "R" && /(governor|auditor|secretary|attorney|senator|mayor|representative|statewide)/i.test(race.rep || "")) return "statewideRepublican";
  return party === "D" ? "standardDemocrat" : "standardRepublican";
}

function governorCandidateProfile(race, party) {
  const name = party === "D" ? race.dem : race.rep;
  const specific = GOVERNOR_CANDIDATE_DEMOGRAPHIC_PROFILES[candidateProfileKey(name)];
  if (specific) {
    return { key: candidateProfileKey(name), label: name, source: "candidate", ...specific };
  }
  const genericKey = governorProfileKey(race, party);
  return {
    key: genericKey,
    label: genericKey.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
    source: "generic",
    scores: GOVERNOR_DEMOGRAPHIC_PROFILES[genericKey] || {},
    strengths: [],
    weaknesses: []
  };
}

function financeSideForRace(fec, race) {
  const independent = INDEPENDENT_CONTROL_FINANCE[race.state];
  if (independent?.side === "dem" && fec.otherReceipts > fec.demReceipts) {
    return {
      ...fec,
      demReceipts: fec.otherReceipts,
      demCash: fec.otherCash,
      demDebts: fec.otherDebts,
      demIndividual: fec.otherIndividual,
      demFinanceLabel: independent.label,
      demFinanceParty: "I",
      financeTreatment: `${independent.label} is an independent who counts with Democrats for control, so independent-side FEC money is compared against Republican money.`
    };
  }
  return { ...fec, demFinanceLabel: "Democratic side", repFinanceLabel: "Republican side" };
}

function nationalFinanceSignal(finance) {
  const demScore = Math.log1p(Math.max(finance.demReceipts, 0) + Math.max(finance.demCash, 0) * 1.1) - Math.log1p(Math.max(finance.demDebts, 0) * 1.2);
  const repScore = Math.log1p(Math.max(finance.repReceipts, 0) + Math.max(finance.repCash, 0) * 1.1) - Math.log1p(Math.max(finance.repDebts, 0) * 1.2);
  return Number(clamp((demScore - repScore) / 5, -.8, .8).toFixed(3));
}

function governorElectorateWeights(state) {
  const baseline = MIDTERM_LIKELY_VOTER_BASELINES[state] || { white_college: .3, white_noncollege: .4, black: .1, latino: .1, asian_other: .05 };
  const ageBaseline = MIDTERM_AGE_BASELINES[state] || { youth: .15, core_age: .6, senior: .25 };
  const weights = {
    white_college: baseline.white_college,
    white_noncollege: baseline.white_noncollege,
    black: baseline.black,
    latino: baseline.latino,
    asian_other: baseline.asian_other,
    youth: ageBaseline.youth,
    senior: ageBaseline.senior
  };
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number((value / total).toFixed(4))]));
}

function demographicPullAdjustment(race) {
  const weights = governorElectorateWeights(race.state);
  const demProfile = governorCandidateProfile(race, "D");
  const repProfile = governorCandidateProfile(race, "R");
  const groups = Object.keys(weights).map((group) => {
    const effect = weights[group] * ((demProfile.scores[group] || 0) - (repProfile.scores[group] || 0)) * 1.35;
    return { group, weight: weights[group], effect: Number(effect.toFixed(2)) };
  });
  const raw = groups.reduce((sum, group) => sum + group.effect, 0);
  const saturation = Math.abs(race.pvi) > 15 ? .5 : Math.abs(race.pvi) > 8 ? .75 : 1;
  return {
    adjustment: Number(clamp(raw * saturation, -1, 1).toFixed(2)),
    demProfile,
    repProfile,
    topGroups: groups.filter((group) => Math.abs(group.effect) >= .02).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)).slice(0, 5)
  };
}

function ratingFromProbability(probability, margin) {
  const side = probability >= 0.5 ? "D" : "R";
  const winnerProbability = Math.max(probability, 1 - probability);
  const absMargin = Math.abs(margin);
  if (winnerProbability >= 0.97 || absMargin >= 15) return `Safe ${side}`;
  if (winnerProbability >= 0.84 || absMargin >= 8) return `Likely ${side}`;
  if (winnerProbability >= 0.68 || absMargin >= 4) return `Lean ${side}`;
  if (winnerProbability >= 0.56 || absMargin >= 1.5) return `Tilt ${side}`;
  return "Toss-up";
}

function statusEffect(race) {
  if (race.status.includes("Incumbent")) return race.incumbentParty === "D" ? 2.4 : -2.4;
  if (race.status.includes("Term-limited") || race.status.includes("retiring")) return race.incumbentParty === "D" ? -.8 : .8;
  return 0;
}

function buildRace(baseRace, nationalShift, sourceData) {
  const candidateInfo = GOVERNOR_CANDIDATE_STATUS[baseRace.state] || {};
  const race = {
    ...baseRace,
    ...candidateInfo,
    dem: candidateInfo.dem || baseRace.demCandidate || "Democratic field",
    rep: candidateInfo.rep || baseRace.repCandidate || "Republican field",
    demStatus: candidateInfo.demStatus || "unresolved",
    repStatus: candidateInfo.repStatus || "unresolved",
    independent: candidateInfo.extraCandidates?.some((candidate) => candidate.party === "I") ? "tracked independent candidate" : "none",
    caucusTarget: "none"
  };
  const ratingMargin = RATING_TO_MARGIN[race.rating] ?? 0;
  const fundamentals = (race.pvi * .38) + (race.lastMargin * .24) + statusEffect(race);
  const candidateAndLocal = race.candidateEdge || 0;
  const demographicPull = demographicPullAdjustment(race);
  
  // Candidate history adjustment
  const candidateHistory = CANDIDATE_HISTORY[race.state] || 0;
  
  // Finance integration
  let financeSignal = 0;
  let nationalFinance = 0;
  const fec = sourceData?.fec?.[race.state];
  if (fec) {
    const raceFec = financeSideForRace(fec, race);
    const demEfficiency = (raceFec.demCash + raceFec.demIndividual * .45 - raceFec.demDebts * .7) / Math.sqrt(1 + Math.max(raceFec.demDisbursements, 1));
    const repEfficiency = (raceFec.repCash + raceFec.repIndividual * .45 - raceFec.repDebts * .7) / Math.sqrt(1 + Math.max(raceFec.repDisbursements, 1));
    const efficiencySignal = clamp((demEfficiency - repEfficiency) / 1800, -1.35, 1.35);
    const rawReceiptSignal = clamp((raceFec.demReceipts - raceFec.repReceipts) / 8000000, -1, 1);
    financeSignal = efficiencySignal * .72 + rawReceiptSignal * .28;
  }
  if (sourceData?.fec?.__national) {
    nationalFinance = sourceData.fec.__national.financeSignal * MODEL_WEIGHTS.nationalFinance;
  }
  
  // Polling integration
  let pollMargin = 0;
  const governorPoll = sourceData?.pollfinity?.governorPolls?.[race.state];
  if (governorPoll && governorPoll.polls > 0) {
    pollMargin = governorPoll.margin * .5;
  }
  
  const margin = (ratingMargin * .58) + (fundamentals * .34) + candidateAndLocal + nationalShift + demographicPull.adjustment + candidateHistory + financeSignal + pollMargin;
  const error = clamp((RATING_TO_ERROR[race.rating] ?? 9.5) + (race.status.includes("Term-limited") || race.status.includes("retiring") ? 1.2 : 0), 6.5, 13.5);
  const demProbability = clamp(normalCdf(margin, 0, error), 0.01, 0.99);
  const winnerParty = demProbability >= .5 ? "D" : "R";
  return {
    ...race,
    displayName: `${STATE_NAMES[race.state]} Governor`,
    demCandidate: race.dem,
    repCandidate: race.rep,
    margin: Number(margin.toFixed(2)),
    fundamentalsMargin: Number(fundamentals.toFixed(2)),
    ratingMargin: Number(ratingMargin.toFixed(2)),
    candidateAndLocal: Number(candidateAndLocal.toFixed(2)),
    demographicPull,
    sourceInputs: {
      financeSignal,
      nationalFinance,
      candidateHistory,
      pollMargin,
      pollCount: governorPoll?.polls || 0
    },
    modelRating: ratingFromProbability(demProbability, margin),
    demProbability: Number(demProbability.toFixed(5)),
    repProbability: Number((1 - demProbability).toFixed(5)),
    winnerParty,
    winnerProbability: Number(Math.max(demProbability, 1 - demProbability).toFixed(5)),
    competitive: demProbability > 0.25 && demProbability < 0.75
  };
}

function appendHistory(forecast) {
  const key = forecast.modelDate;
  const point = { date: key, demGovernors: forecast.medianDemGovernors, repGovernors: forecast.medianRepGovernors };
  const history = Array.isArray(previousForecast?.governorCountHistory) ? previousForecast.governorCountHistory.filter((item) => item.date !== key) : [];
  history.push(point);
  return history.slice(-365);
}

async function buildForecast() {
  const sourceData = await fetchAllSources();
  const senateSignals = readSenateSignals();
  const nationalShift = clamp(senateSignals.genericBallotMargin * 0.18, -1.8, 1.8);
  const modeledRaces = GOVERNOR_RACES.map((race) => buildRace(race, nationalShift, sourceData));
  const distribution = {};
  const decisive = Object.fromEntries(modeledRaces.map((race) => [race.state, 0]));
  const demCounts = [];
  let demWinningRaceTotal = 0;
  let repWinningRaceTotal = 0;
  let demCountTotal = 0;
  let repCountTotal = 0;

  for (let simulation = 0; simulation < SETTINGS.simulations; simulation += 1) {
    let demGovernors = SETTINGS.demNotUp;
    const sampled = [];
    for (const race of modeledRaces) {
      const error = clamp((RATING_TO_ERROR[race.rating] ?? 9.5) + (race.status.includes("Term-limited") || race.status.includes("retiring") ? 1.2 : 0), 6.5, 13.5);
      const sampledMargin = sampleNormal(race.margin, error);
      const demWin = sampledMargin > 0;
      if (demWin) demGovernors += 1;
      sampled.push({ state: race.state, demWin, distance: Math.abs(sampledMargin) });
    }
    demCounts.push(demGovernors);
    distribution[demGovernors] = (distribution[demGovernors] || 0) + 1;
    const closest = sampled.sort((a, b) => a.distance - b.distance)[0];
    if (closest) decisive[closest.state] += 1;
  }

  demCounts.sort((a, b) => a - b);
  for (const race of modeledRaces) {
    if (race.demProbability >= .5) demWinningRaceTotal += 1;
    else repWinningRaceTotal += 1;
    race.tippingPower = Number((decisive[race.state] / SETTINGS.simulations).toFixed(5));
  }
  for (const [count, simulations] of Object.entries(distribution)) {
    demCountTotal += Number(count) * simulations;
    repCountTotal += (50 - Number(count)) * simulations;
  }

  const medianDemGovernors = demCounts[Math.floor(demCounts.length / 2)];
  const forecast = {
    model: "2026 gubernatorial forecast",
    modelDate: localDateKey(),
    runDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    settings: SETTINGS,
    sourceSummary: {
      genericBallotMargin: senateSignals.genericBallotMargin,
      gubernatorialNationalShift: Number(nationalShift.toFixed(2)),
      approvalNet: senateSignals.approvalNet,
      dataSources: sourceData.status,
      nationalFinance: sourceData.fec?.__national || null
    },
    projectedDemRaceWins: demWinningRaceTotal,
    projectedRepRaceWins: repWinningRaceTotal,
    averageDemGovernors: Number((demCountTotal / SETTINGS.simulations).toFixed(2)),
    averageRepGovernors: Number((repCountTotal / SETTINGS.simulations).toFixed(2)),
    medianDemGovernors,
    medianRepGovernors: 50 - medianDemGovernors,
    distribution,
    races: modeledRaces.sort((a, b) => STATE_NAMES[a.state].localeCompare(STATE_NAMES[b.state]))
  };
  forecast.governorCountHistory = appendHistory(forecast);
  return forecast;
}

async function writeForecast() {
  const forecast = await buildForecast();
  writeFileSync(FORECAST_URL, JSON.stringify(forecast, null, 2), "utf8");
  console.log(`Wrote gubernatorial forecast for ${forecast.races.length} races`);
  console.log(`Data sources status:`, Object.keys(forecast.sourceSummary.dataSources || {}).join(", "));
}

writeForecast().catch((error) => {
  console.error("Error generating forecast:", error);
  process.exit(1);
});
