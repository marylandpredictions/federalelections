import { readFileSync, writeFileSync } from "node:fs";

const FORECAST_URL = new URL("../data/governor-forecast.json", import.meta.url);
const previousForecast = readPreviousForecast();

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
    "Current Senate model generic ballot signal as a broad midterm environment input"
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

const GOVERNOR_RACES = [
  { state: "AL", incumbentParty: "R", incumbent: "Kay Ivey", status: "Term-limited", pvi: -15, lastMargin: -33.8, rating: "Safe R", demCandidate: "Doug Jones", repCandidate: "Tommy Tuberville", candidateEdge: 1.2 },
  { state: "AK", incumbentParty: "R", incumbent: "Mike Dunleavy", status: "Term-limited", pvi: -6, lastMargin: -5.7, rating: "Lean R", demCandidate: "Tom Begich / Matt Claman", repCandidate: "Republican field", candidateEdge: .4 },
  { state: "AZ", incumbentParty: "D", incumbent: "Katie Hobbs", status: "Incumbent running", pvi: -2, lastMargin: .6, rating: "Toss-up", demCandidate: "Katie Hobbs", repCandidate: "Andy Biggs / David Schweikert", candidateEdge: -.4 },
  { state: "AR", incumbentParty: "R", incumbent: "Sarah Huckabee Sanders", status: "Incumbent renominated", pvi: -15, lastMargin: -26, rating: "Safe R", demCandidate: "Fredrick Love", repCandidate: "Sarah Huckabee Sanders", candidateEdge: -1 },
  { state: "CA", incumbentParty: "D", incumbent: "Gavin Newsom", status: "Term-limited", pvi: 12, lastMargin: 18.4, rating: "Safe D", demCandidate: "Democratic field", repCandidate: "Steve Hilton / Chad Bianco", candidateEdge: .3 },
  { state: "CO", incumbentParty: "D", incumbent: "Jared Polis", status: "Term-limited", pvi: 6, lastMargin: 19.3, rating: "Safe D", demCandidate: "Michael Bennet / Phil Weiser", repCandidate: "Barbara Kirkmeyer / GOP field", candidateEdge: 1.3 },
  { state: "CT", incumbentParty: "D", incumbent: "Ned Lamont", status: "Incumbent running", pvi: 8, lastMargin: 12, rating: "Safe D", demCandidate: "Ned Lamont", repCandidate: "Ryan Fazio", candidateEdge: .6 },
  { state: "FL", incumbentParty: "R", incumbent: "Ron DeSantis", status: "Term-limited", pvi: -5, lastMargin: -19.4, rating: "Likely R", demCandidate: "Jerry Demings / David Jolly", repCandidate: "Byron Donalds / GOP field", candidateEdge: -.2 },
  { state: "GA", incumbentParty: "R", incumbent: "Brian Kemp", status: "Term-limited", pvi: -1, lastMargin: -7.5, rating: "Toss-up", demCandidate: "Keisha Lance Bottoms", repCandidate: "Burt Jones / Rick Jackson", candidateEdge: .5 },
  { state: "HI", incumbentParty: "D", incumbent: "Josh Green", status: "Incumbent running", pvi: 13, lastMargin: 26.4, rating: "Safe D", demCandidate: "Josh Green", repCandidate: "Gary Cordery", candidateEdge: 1 },
  { state: "ID", incumbentParty: "R", incumbent: "Brad Little", status: "Incumbent renominated", pvi: -18, lastMargin: -20.6, rating: "Safe R", demCandidate: "Terri Pickens", repCandidate: "Brad Little", candidateEdge: -1 },
  { state: "IL", incumbentParty: "D", incumbent: "JB Pritzker", status: "Incumbent renominated", pvi: 6, lastMargin: 12.5, rating: "Safe D", demCandidate: "JB Pritzker", repCandidate: "Darren Bailey", candidateEdge: 1.1 },
  { state: "IA", incumbentParty: "R", incumbent: "Kim Reynolds", status: "Incumbent retiring", pvi: -6, lastMargin: -18.6, rating: "Toss-up", demCandidate: "Rob Sand", repCandidate: "Randy Feenstra / GOP field", candidateEdge: 2.4 },
  { state: "KS", incumbentParty: "D", incumbent: "Laura Kelly", status: "Term-limited", pvi: -8, lastMargin: 2.2, rating: "Lean R", demCandidate: "Ethan Corson / Cindy Holscher", repCandidate: "Jeff Colyer / Vicki Schmidt / Scott Schwab", candidateEdge: .5 },
  { state: "ME", incumbentParty: "D", incumbent: "Janet Mills", status: "Term-limited", pvi: 4, lastMargin: 12.8, rating: "Likely D", demCandidate: "Shenna Bellows / Troy Jackson / Angus King III", repCandidate: "Garrett Mason / GOP field", candidateEdge: .4 },
  { state: "MD", incumbentParty: "D", incumbent: "Wes Moore", status: "Incumbent running", pvi: 15, lastMargin: 29.9, rating: "Safe D", demCandidate: "Wes Moore", repCandidate: "Republican field", candidateEdge: 1.5 },
  { state: "MA", incumbentParty: "D", incumbent: "Maura Healey", status: "Incumbent running", pvi: 14, lastMargin: 29.2, rating: "Safe D", demCandidate: "Maura Healey", repCandidate: "Republican field", candidateEdge: 1.2 },
  { state: "MI", incumbentParty: "D", incumbent: "Gretchen Whitmer", status: "Term-limited", pvi: 0, lastMargin: 10.6, rating: "Lean D", demCandidate: "Jocelyn Benson / Democratic field", repCandidate: "Republican field", candidateEdge: .8 },
  { state: "MN", incumbentParty: "D", incumbent: "Tim Walz", status: "Incumbent retiring", pvi: 3, lastMargin: 7.7, rating: "Safe D", demCandidate: "DFL field", repCandidate: "Republican field", candidateEdge: .4 },
  { state: "NE", incumbentParty: "R", incumbent: "Jim Pillen", status: "Incumbent running", pvi: -10, lastMargin: -23.8, rating: "Safe R", demCandidate: "Democratic field", repCandidate: "Jim Pillen", candidateEdge: -1 },
  { state: "NV", incumbentParty: "R", incumbent: "Joe Lombardo", status: "Incumbent running", pvi: -1, lastMargin: -1.5, rating: "Toss-up", demCandidate: "Democratic field", repCandidate: "Joe Lombardo", candidateEdge: -1.6 },
  { state: "NH", incumbentParty: "R", incumbent: "Kelly Ayotte", status: "Incumbent running", pvi: 2, lastMargin: -9.2, rating: "Likely R", demCandidate: "Democratic field", repCandidate: "Kelly Ayotte", candidateEdge: -1.6 },
  { state: "NM", incumbentParty: "D", incumbent: "Michelle Lujan Grisham", status: "Term-limited", pvi: 4, lastMargin: 6.4, rating: "Likely D", demCandidate: "Democratic field", repCandidate: "Republican field", candidateEdge: .2 },
  { state: "NY", incumbentParty: "D", incumbent: "Kathy Hochul", status: "Incumbent running", pvi: 8, lastMargin: 6.4, rating: "Likely D", demCandidate: "Kathy Hochul", repCandidate: "Republican field", candidateEdge: .3 },
  { state: "OH", incumbentParty: "R", incumbent: "Mike DeWine", status: "Term-limited", pvi: -5, lastMargin: -25.4, rating: "Lean R", demCandidate: "Democratic field", repCandidate: "Vivek Ramaswamy / GOP field", candidateEdge: -.6 },
  { state: "OK", incumbentParty: "R", incumbent: "Kevin Stitt", status: "Term-limited", pvi: -17, lastMargin: -13.7, rating: "Safe R", demCandidate: "Democratic field", repCandidate: "Republican field", candidateEdge: -.4 },
  { state: "OR", incumbentParty: "D", incumbent: "Tina Kotek", status: "Incumbent running", pvi: 8, lastMargin: 3.4, rating: "Likely D", demCandidate: "Tina Kotek", repCandidate: "Republican field", candidateEdge: .2 },
  { state: "PA", incumbentParty: "D", incumbent: "Josh Shapiro", status: "Incumbent running", pvi: -1, lastMargin: 14.8, rating: "Safe D", demCandidate: "Josh Shapiro", repCandidate: "Republican field", candidateEdge: 3.8 },
  { state: "RI", incumbentParty: "D", incumbent: "Dan McKee", status: "Incumbent running", pvi: 8, lastMargin: 19.3, rating: "Safe D", demCandidate: "Dan McKee", repCandidate: "Republican field", candidateEdge: .5 },
  { state: "SC", incumbentParty: "R", incumbent: "Henry McMaster", status: "Term-limited", pvi: -8, lastMargin: -17.8, rating: "Likely R", demCandidate: "Democratic field", repCandidate: "Pamela Evette / Nancy Mace / Alan Wilson", candidateEdge: -.5 },
  { state: "SD", incumbentParty: "R", incumbent: "Larry Rhoden", status: "Incumbent running", pvi: -15, lastMargin: -24, rating: "Safe R", demCandidate: "Dan Ahlers", repCandidate: "Larry Rhoden / GOP field", candidateEdge: -.8 },
  { state: "TN", incumbentParty: "R", incumbent: "Bill Lee", status: "Term-limited", pvi: -14, lastMargin: -32.7, rating: "Safe R", demCandidate: "Democratic field", repCandidate: "Marsha Blackburn / John Rose / GOP field", candidateEdge: -.8 },
  { state: "TX", incumbentParty: "R", incumbent: "Greg Abbott", status: "Incumbent renominated", pvi: -6, lastMargin: -10.9, rating: "Safe R", demCandidate: "Gina Hinojosa", repCandidate: "Greg Abbott", candidateEdge: -1.7 },
  { state: "VT", incumbentParty: "R", incumbent: "Phil Scott", status: "Incumbent running", pvi: 17, lastMargin: -46.9, rating: "Safe R", demCandidate: "Amanda Janoo / Aly Richards", repCandidate: "Phil Scott", candidateEdge: -6.5 },
  { state: "WI", incumbentParty: "D", incumbent: "Tony Evers", status: "Incumbent retiring", pvi: 0, lastMargin: 3.4, rating: "Toss-up", demCandidate: "Mandela Barnes / Democratic field", repCandidate: "Tom Tiffany", candidateEdge: .4 },
  { state: "WY", incumbentParty: "R", incumbent: "Mark Gordon", status: "Term-limited", pvi: -23, lastMargin: -53.8, rating: "Safe R", demCandidate: "Gabriel Green", repCandidate: "Megan Degenfelder / Eric Barlow", candidateEdge: -.8 }
];

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

function buildRace(race, nationalShift) {
  const ratingMargin = RATING_TO_MARGIN[race.rating] ?? 0;
  const fundamentals = (race.pvi * .38) + (race.lastMargin * .24) + statusEffect(race);
  const candidateAndLocal = race.candidateEdge || 0;
  const margin = (ratingMargin * .58) + (fundamentals * .34) + candidateAndLocal + nationalShift;
  const error = clamp((RATING_TO_ERROR[race.rating] ?? 9.5) + (race.status.includes("Term-limited") || race.status.includes("retiring") ? 1.2 : 0), 6.5, 13.5);
  const demProbability = clamp(normalCdf(margin, 0, error), 0.01, 0.99);
  return {
    ...race,
    displayName: `${STATE_NAMES[race.state]} Governor`,
    margin: Number(margin.toFixed(2)),
    fundamentalsMargin: Number(fundamentals.toFixed(2)),
    ratingMargin: Number(ratingMargin.toFixed(2)),
    candidateAndLocal: Number(candidateAndLocal.toFixed(2)),
    modelRating: ratingFromProbability(demProbability, margin),
    demProbability: Number(demProbability.toFixed(5)),
    repProbability: Number((1 - demProbability).toFixed(5)),
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

function buildForecast() {
  const senateSignals = readSenateSignals();
  const nationalShift = clamp(senateSignals.genericBallotMargin * 0.18, -1.8, 1.8);
  const modeledRaces = GOVERNOR_RACES.map((race) => buildRace(race, nationalShift));
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
      approvalNet: senateSignals.approvalNet
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

const forecast = buildForecast();
writeFileSync(FORECAST_URL, JSON.stringify(forecast, null, 2));
console.log(`Wrote gubernatorial forecast for ${forecast.races.length} races`);
