import { readFileSync, writeFileSync } from "node:fs";

const FORECAST_URL = new URL("../data/governor-forecast.json", import.meta.url);
const previousForecast = readPreviousForecast();

const SETTINGS = {
  simulations: 40000,
  electionDate: "2026-11-03",
  currentDemGovernors: 24,
  currentRepGovernors: 26,
  demNotUp: 6,
  repNotUp: 8,
  dataSources: [
    "Manual 2026 gubernatorial race ledger",
    "Sabato's Crystal Ball governor ratings reference",
    "Cook Political Report governor rating reference",
    "National Governors Association 2026 election list",
    "Current Senate model generic ballot and approval signals when available"
  ]
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IA: "Iowa", KS: "Kansas", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NM: "New Mexico", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", VT: "Vermont", WI: "Wisconsin", WY: "Wyoming"
};

const RATING_TO_MARGIN = {
  "Safe D": 17, "Likely D": 10, "Lean D": 5.5, "Tilt D": 2.2, "Toss-up": 0,
  "Tilt R": -2.2, "Lean R": -5.5, "Likely R": -10, "Safe R": -17
};

const RATING_TO_ERROR = {
  "Safe D": 6, "Likely D": 7, "Lean D": 8, "Tilt D": 9.5, "Toss-up": 10.5,
  "Tilt R": 9.5, "Lean R": 8, "Likely R": 7, "Safe R": 6
};

const GOVERNOR_RACES = [
  { state: "AL", incumbentParty: "R", status: "Open seat", rating: "Safe R" },
  { state: "AK", incumbentParty: "R", status: "Incumbent running", rating: "Likely R" },
  { state: "AZ", incumbentParty: "D", status: "Incumbent running", rating: "Toss-up" },
  { state: "AR", incumbentParty: "R", status: "Incumbent running", rating: "Safe R" },
  { state: "CA", incumbentParty: "D", status: "Open seat", rating: "Safe D" },
  { state: "CO", incumbentParty: "D", status: "Open seat", rating: "Likely D" },
  { state: "CT", incumbentParty: "D", status: "Incumbent running", rating: "Likely D" },
  { state: "FL", incumbentParty: "R", status: "Open seat", rating: "Likely R" },
  { state: "GA", incumbentParty: "R", status: "Open seat", rating: "Toss-up" },
  { state: "HI", incumbentParty: "D", status: "Incumbent running", rating: "Safe D" },
  { state: "ID", incumbentParty: "R", status: "Open seat", rating: "Safe R" },
  { state: "IL", incumbentParty: "D", status: "Incumbent running", rating: "Safe D" },
  { state: "IA", incumbentParty: "R", status: "Open seat", rating: "Toss-up" },
  { state: "KS", incumbentParty: "D", status: "Open seat", rating: "Toss-up" },
  { state: "ME", incumbentParty: "D", status: "Open seat", rating: "Lean D" },
  { state: "MD", incumbentParty: "D", status: "Incumbent running", rating: "Safe D" },
  { state: "MA", incumbentParty: "D", status: "Incumbent running", rating: "Safe D" },
  { state: "MI", incumbentParty: "D", status: "Open seat", rating: "Toss-up" },
  { state: "MN", incumbentParty: "D", status: "Open seat", rating: "Lean D" },
  { state: "NE", incumbentParty: "R", status: "Incumbent running", rating: "Safe R" },
  { state: "NV", incumbentParty: "R", status: "Incumbent running", rating: "Toss-up" },
  { state: "NH", incumbentParty: "R", status: "Incumbent running", rating: "Toss-up" },
  { state: "NM", incumbentParty: "D", status: "Open seat", rating: "Likely D" },
  { state: "NY", incumbentParty: "D", status: "Incumbent running", rating: "Likely D" },
  { state: "OH", incumbentParty: "R", status: "Open seat", rating: "Lean R" },
  { state: "OK", incumbentParty: "R", status: "Open seat", rating: "Safe R" },
  { state: "OR", incumbentParty: "D", status: "Incumbent running", rating: "Likely D" },
  { state: "PA", incumbentParty: "D", status: "Incumbent running", rating: "Likely D" },
  { state: "RI", incumbentParty: "D", status: "Incumbent running", rating: "Safe D" },
  { state: "SC", incumbentParty: "R", status: "Open seat", rating: "Safe R" },
  { state: "SD", incumbentParty: "R", status: "Open seat", rating: "Safe R" },
  { state: "TN", incumbentParty: "R", status: "Open seat", rating: "Safe R" },
  { state: "TX", incumbentParty: "R", status: "Incumbent running", rating: "Likely R" },
  { state: "VT", incumbentParty: "R", status: "Open seat", rating: "Toss-up" },
  { state: "WI", incumbentParty: "D", status: "Open seat", rating: "Toss-up" },
  { state: "WY", incumbentParty: "R", status: "Open seat", rating: "Safe R" }
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

function appendHistory(forecast) {
  const key = forecast.modelDate;
  const point = { date: key, dem: forecast.demMajorityProbability, rep: forecast.repMajorityProbability };
  const history = Array.isArray(previousForecast?.controlHistory) ? previousForecast.controlHistory.filter((item) => item.date !== key) : [];
  history.push(point);
  return history.slice(-365);
}

function buildForecast() {
  const senateSignals = readSenateSignals();
  const nationalShift = clamp(senateSignals.genericBallotMargin * 0.22, -2.2, 2.2);
  const modeledRaces = GOVERNOR_RACES.map((race) => {
    const baseMargin = RATING_TO_MARGIN[race.rating] ?? 0;
    const openSeatPenalty = race.status === "Open seat" ? (race.incumbentParty === "D" ? -0.7 : 0.7) : 0;
    const incumbentBonus = race.status === "Incumbent running" ? (race.incumbentParty === "D" ? 1.1 : -1.1) : 0;
    const margin = baseMargin + nationalShift + openSeatPenalty + incumbentBonus;
    const error = RATING_TO_ERROR[race.rating] ?? 9;
    const demProbability = clamp(normalCdf(margin, 0, error), 0.01, 0.99);
    return {
      ...race,
      displayName: `${STATE_NAMES[race.state]} Governor`,
      margin: Number(margin.toFixed(2)),
      modelRating: ratingFromProbability(demProbability, margin),
      demProbability: Number(demProbability.toFixed(5)),
      repProbability: Number((1 - demProbability).toFixed(5)),
      competitive: demProbability > 0.25 && demProbability < 0.75
    };
  });

  const distribution = {};
  const decisive = Object.fromEntries(modeledRaces.map((race) => [race.state, 0]));
  const demCounts = [];
  let demMajorities = 0;
  let repMajorities = 0;
  let ties = 0;

  for (let simulation = 0; simulation < SETTINGS.simulations; simulation += 1) {
    let demGovernors = SETTINGS.demNotUp;
    const sampled = [];
    for (const race of modeledRaces) {
      const error = RATING_TO_ERROR[race.rating] ?? 9;
      const sampledMargin = sampleNormal(race.margin, error);
      const demWin = sampledMargin > 0;
      if (demWin) demGovernors += 1;
      sampled.push({ state: race.state, demWin, distance: Math.abs(sampledMargin) });
    }
    demCounts.push(demGovernors);
    distribution[demGovernors] = (distribution[demGovernors] || 0) + 1;
    if (demGovernors >= 26) demMajorities += 1;
    else if (demGovernors <= 24) repMajorities += 1;
    else ties += 1;
    const closest = sampled.sort((a, b) => a.distance - b.distance)[0];
    if (closest) decisive[closest.state] += 1;
  }

  demCounts.sort((a, b) => a - b);
  for (const race of modeledRaces) {
    race.tippingPower = Number((decisive[race.state] / SETTINGS.simulations).toFixed(5));
  }

  const forecast = {
    model: "2026 gubernatorial forecast",
    modelDate: new Date().toISOString().slice(0, 10),
    runDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    settings: SETTINGS,
    sourceSummary: {
      genericBallotMargin: senateSignals.genericBallotMargin,
      gubernatorialNationalShift: Number(nationalShift.toFixed(2)),
      approvalNet: senateSignals.approvalNet
    },
    demMajorityProbability: Number((demMajorities / SETTINGS.simulations).toFixed(5)),
    repMajorityProbability: Number((repMajorities / SETTINGS.simulations).toFixed(5)),
    noMajorityProbability: Number((ties / SETTINGS.simulations).toFixed(5)),
    medianDemGovernors: demCounts[Math.floor(demCounts.length / 2)],
    medianRepGovernors: 50 - demCounts[Math.floor(demCounts.length / 2)],
    distribution,
    races: modeledRaces.sort((a, b) => STATE_NAMES[a.state].localeCompare(STATE_NAMES[b.state]))
  };
  forecast.controlHistory = appendHistory(forecast);
  return forecast;
}

const forecast = buildForecast();
writeFileSync(FORECAST_URL, JSON.stringify(forecast, null, 2));
console.log(`Wrote gubernatorial forecast for ${forecast.races.length} races`);
