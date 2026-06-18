const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia"
};

const FIPS_TO_STATE = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"
};

const RATING_BUCKET = {
  "Safe D": "safe-d", "Likely D": "likely-d", "Lean D": "lean-d", "Tilt D": "tilt-d", "Toss-up": "tossup",
  "Tilt R": "tilt-r", "Lean R": "lean-r", "Likely R": "likely-r", "Safe R": "safe-r"
};

const MAP_COLOR_MODES = {
  rating: "Rating",
  margin: "Projected margin",
  probability: "Win probability"
};

const CHART_ANNOTATIONS = [
  { date: "2026-05-17", label: "Model reworked", marker: "*" },
  { date: "2026-05-20", label: "Model reworked", marker: "*" },
  { date: "2026-06-01", label: "Model reworked", marker: "*" }
];

const MONTANA_CHART_ANNOTATIONS = [
  { date: "2026-05-19", label: "Bodnar modeled" }
];

const PRESIDENT_PRIMARY_MARKERS = [
  { date: "2026-05-27", label: "Model reworked", fullOnly: true },
  { date: "2028-02-01", label: "Presidential primaries", className: "history-primary-marker", fullOnly: true }
];

const SENATE_NATIONAL_MARKERS = [
  { date: "2026-09-15", label: "All primaries resolved", className: "history-primary-marker" }
];

let forecast = null;
let houseForecast = null;
let governorForecast = null;
let presidentForecasts = null;
let houseShapeGeo = null;
let houseShapeGeoPromise = null;
let usStatesGeo = null;
let usStatesGeoPromise = null;
let articles = [];
let mapColorMode = "rating";
let houseViewMode = "shape";
let selectedHouseDistrictId = null;

const PRESIDENT_DEM_CANDIDATES = ["newsom", "beshear", "shapiro", "buttigieg", "harris", "aoc"];
const PRESIDENT_REP_CANDIDATES = ["vance", "rubio", "desantis", "haley", "cruz"];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function componentToHex(value) {
  return Math.round(value).toString(16).padStart(2, "0").toUpperCase();
}

function mixColor(start, end, amount) {
  return start.map((channel, index) => channel + (end[index] - channel) * amount);
}

function scoreToHex(score) {
  const S = clamp(score, -100, 100);
  const abs = Math.abs(S);
  const center = [248, 245, 235];
  const dem = [16, 48, 178];
  const rep = [178, 34, 34];
  const endpoint = S >= 0 ? dem : rep;
  const base = abs / 100;
  const intensity = abs <= 50
    ? base * 1.08
    : .54 + Math.pow((abs - 50) / 50, .52) * .46;
  const [r, g, b] = mixColor(center, endpoint, clamp(intensity, 0, 1));

  return `#${componentToHex(r)}${componentToHex(g)}${componentToHex(b)}`;
}

function getPartisanScore(demProbability, projectedDemMargin) {
  const P = (demProbability - 0.5) * 200;
  const M = clamp(projectedDemMargin / 25, -1, 1) * 100;
  return clamp((0.55 * P) + (0.45 * M), -100, 100);
}

function getRaceColor(demProbability, projectedDemMargin) {
  const score = getPartisanScore(demProbability, projectedDemMargin);
  return {
    score,
    color: scoreToHex(score)
  };
}

const RATING_SCORES = {
  "Safe D": 100,
  "Likely D": 66,
  "Lean D": 40,
  "Tilt D": 18,
  "Toss-up": 0,
  "Tilt R": -18,
  "Lean R": -40,
  "Likely R": -66,
  "Safe R": -100
};

const HOUSE_VIEW_MODES = {
  shape: "Map",
  board: "Original board",
  list: "List"
};

function colorForRating(rating) {
  return scoreToHex(RATING_SCORES[rating] ?? 0);
}

function spectrumLegendHtml() {
  return `
    <div class="map-spectrum-legend" aria-label="Partisan color spectrum">
      <span class="spectrum-end spectrum-rep">Strong R</span>
      <i></i>
      <span class="spectrum-mid">Toss-up</span>
      <span class="spectrum-end spectrum-dem">Strong D</span>
    </div>
  `;
}

function pct(value) {
  if (Number.isFinite(value) && value === 1) return ">99%";
  if (Number.isFinite(value) && value === 0) return "<1%";
  return `${Math.round(value * 100)}%`;
}

function oneDecimal(value) {
  if (Number.isFinite(value) && value === 1) return ">99%";
  if (Number.isFinite(value) && value === 0) return "<1%";
  return `${(value * 100).toFixed(1)}%`;
}

function houseProbability(value) {
  if (Number.isFinite(value) && value > .99) return ">99%";
  if (Number.isFinite(value) && value < .01) return "<1%";
  return oneDecimal(value);
}

function candidateDisplayName(race, party) {
  const name = party === "D" ? race.dem : race.rep;
  const status = party === "D" ? race.demStatus : race.repStatus;
  if (status === "unresolved") return party === "D" ? "Democrat" : "Republican";
  return name || (party === "D" ? "Democrat" : "Republican");
}

function candidateStatusBadge(race, party) {
  const name = party === "D" ? race.dem : race.rep;
  const status = party === "D" ? race.demStatus : race.repStatus;
  const displayParty = party === "D" ? race.demDisplayParty : race.repDisplayParty;
  if (displayParty) return displayParty;
  if (status === "unresolved") return party;
  if (String(name || "").toLowerCase().includes("independent")) return "I";
  return party;
}

function candidateBadgeClass(badge, party) {
  if (badge === "I") return "ind-badge";
  if (party === "D") return "party-badge dem-badge";
  if (party === "R") return "party-badge rep-badge";
  return "";
}

function candidateRowClass(race, party) {
  const name = party === "D" ? race.dem : race.rep;
  const displayParty = party === "D" ? race.demDisplayParty : race.repDisplayParty;
  if (displayParty === "I" || String(name || "").toLowerCase().includes("independent")) return "candidate-row independent-row";
  return `candidate-row ${party === "D" ? "dem-row" : "rep-row"}`;
}

function candidateChanceLabel(race, party) {
  const name = party === "D" ? race.dem : race.rep;
  const displayParty = party === "D" ? race.demDisplayParty : race.repDisplayParty;
  if (displayParty === "I" || String(name || "").toLowerCase().includes("independent")) return "Independent";
  return party === "D" ? "Democrat" : "Republican";
}

function candidateForecastName(race, party) {
  const name = party === "D" ? race.dem : race.rep;
  const status = party === "D" ? race.demStatus : race.repStatus;
  const fallback = party === "D" ? "Democratic field" : "Republican field";
  if (status === "unresolved") {
    if (name && !["Democrat", "Republican"].includes(name)) return name;
    return fallback;
  }
  return candidateDisplayName(race, party);
}

function leaderClassForRace(race) {
  if (race.winnerParty === "D" && (race.demDisplayParty === "I" || String(race.dem || "").toLowerCase().includes("independent"))) return "leads-ind";
  if (race.rating === "Toss-up") return "leads-tossup";
  return race.winnerParty === "D" ? "leads-dem" : "leads-rep";
}

function extraCandidateRows(race) {
  const mainCandidateKeys = new Set([race.dem, race.rep].map((name) => String(name || "").toLowerCase().trim()).filter(Boolean));
  const latestExtra = new Map((race.extraHistory?.at(-1) ? Object.entries(race.extraHistory.at(-1)) : []).filter(([key]) => key !== "date"));
  return (race.extraCandidates || []).filter((candidate) => !mainCandidateKeys.has(String(candidate.name || "").toLowerCase().trim())).map((candidate) => {
    const party = candidate.party || "D";
    const badgeClass = party === "D" ? "party-badge dem-badge" : party === "R" ? "party-badge rep-badge" : "ind-badge";
    const modeledShare = latestExtra.get(candidate.name);
    const label = Number.isFinite(modeledShare) ? `${oneDecimal(modeledShare)} path` : Number.isFinite(candidate.probabilityShare) ? `${oneDecimal(candidate.probabilityShare)} path` : party === "D" ? "Democratic alternative" : party === "R" ? "Republican alternative" : "Independent path";
    return `
      <div class="candidate-row extra-row">
        <span>${escapeHtml(candidate.name)} <i class="${badgeClass}">${party}</i></span>
        <strong>${escapeHtml(label)}</strong>
      </div>
    `;
  }).join("");
}

function presumptiveBadge(race, party) {
  const status = party === "D" ? race.demStatus : race.repStatus;
  return status === "presumptive" ? `<i class="presumptive-badge">P</i>` : "";
}

function signedMargin(demProbability) {
  const margin = (demProbability - .5) * 100;
  if (Math.abs(margin) < .05) return "Even";
  return `${margin > 0 ? "D" : "R"}+${Math.abs(margin).toFixed(1)} pts`;
}

function signedPointMargin(value) {
  if (!Number.isFinite(value) || Math.abs(value) < .05) return "Even";
  return `${value > 0 ? "D" : "R"}+${Math.abs(value).toFixed(1)} pts`;
}

function ratingFromSignedValue(value, thresholds) {
  if (!Number.isFinite(value)) return "Toss-up";
  const abs = Math.abs(value);
  if (abs < thresholds.tilt) return "Toss-up";
  const side = value > 0 ? "D" : "R";
  if (abs >= thresholds.safe) return `Safe ${side}`;
  if (abs >= thresholds.likely) return `Likely ${side}`;
  if (abs >= thresholds.lean) return `Lean ${side}`;
  return `Tilt ${side}`;
}

function pollingInputText(race) {
  if (race.pollMargin === null) return "No recent public race-poll margin";
  return `${signedPointMargin(race.pollMargin)} weighted race-poll margin`;
}

function movementText(race) {
  const party = movementGainingParty(race);
  const value = Math.abs(race?.movement?.sinceLastRun || 0);
  if (!party || !Number.isFinite(value) || value < .05) return "No change since last run";
  return `${racePartyCandidateLabel(race, party)} up ${value.toFixed(1)} pts since last run`;
}

function movementPartyLabel(party) {
  if (party === "D") return "Democrats";
  if (party === "R") return "Republicans";
  return "the race";
}

function racePartyCandidateLabel(race, party) {
  if (party === "D" || party === "R") return candidateForecastName(race, party);
  return "the race";
}

function raceLeaderParty(race) {
  return (race?.demProbability ?? 0) >= .5 ? "D" : "R";
}

function raceLeaderName(race) {
  const party = raceLeaderParty(race);
  return racePartyCandidateLabel(race, party);
}

function probabilityChangeForParty(race, party, period = "sinceLastRun") {
  const value = race?.movement?.[period];
  if (!Number.isFinite(value)) return null;
  return party === "D" ? value : -value;
}

function movementGainingParty(race, period = "sinceLastRun") {
  const value = race?.movement?.[period];
  if (!Number.isFinite(value) || Math.abs(value) < .05) return null;
  return value > 0 ? "D" : "R";
}

function movementSideClass(race, party) {
  if (party === "D" && (race?.demDisplayParty === "I" || String(race?.dem || "").toLowerCase().includes("independent"))) return "moved-ind";
  if (party === "D") return "moved-dem";
  if (party === "R") return "moved-rep";
  return "moved-flat";
}

function formatProbabilityShift(value) {
  if (!Number.isFinite(value) || Math.abs(value) < .05) return "flat";
  return `${value > 0 ? "up" : "down"} ${Math.abs(value).toFixed(1)} pts`;
}

function movementImpactLabel(value) {
  const abs = Math.abs(value || 0);
  if (abs >= 2) return "large";
  if (abs >= .75) return "noticeable";
  if (abs >= .2) return "small";
  return "tiny";
}

function movementDriverCopy(race, driver) {
  const label = driver?.label || "Model input";
  const change = driver?.change;
  const hasChange = Number.isFinite(change);
  const party = !hasChange ? null : change > 0 ? "D" : "R";
  const toward = party ? racePartyCandidateLabel(race, party) : "";
  const magnitude = hasChange ? `${Math.abs(change).toFixed(1)} pts` : "";
  const ratingDetail = driver?.detail && / to /.test(driver.detail) ? driver.detail : "";
  const templates = {
    Polling: `Race polling shifted ${magnitude} toward ${toward}.`,
    "Projected margin": `The combined forecast margin moved ${magnitude} toward ${toward}.`,
    "Primary risk": `Nomination uncertainty moved ${magnitude} toward ${toward}.`,
    Finance: `Candidate finance moved ${magnitude} toward ${toward}.`,
    "Generic ballot": `The national polling environment moved ${magnitude} toward ${toward}'s side.`,
    "National finance": `The national finance environment moved ${magnitude} toward ${toward}'s side.`,
    "Demographic pull": `Coalition and demographic adjustments moved ${magnitude} toward ${toward}.`,
    Rating: ratingDetail ? `Public rating input changed from ${ratingDetail}.` : "Public rating input changed."
  };
  if (!hasChange) return templates[label] || (driver?.detail || "Input changed.");
  return templates[label] || `${label} moved ${magnitude} toward ${toward}.`;
}

function movementDriverScope(race) {
  const labels = new Set((race?.movementDrivers || []).map((driver) => driver.label));
  const hasStateDriver = ["Polling", "Primary risk", "Finance", "Demographic pull", "Rating"].some((label) => labels.has(label));
  if (hasStateDriver) return "This run includes race-specific movement.";
  if (labels.has("Generic ballot") || labels.has("Projected margin")) return "Mostly a national-environment move in this run.";
  if ((race?.history || []).length > 1) return "Small probability move; the largest saved effect is grouped below.";
  return "No previous saved run to compare.";
}

function dateOnlyTime(value) {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function recentRaceEvent(race) {
  const history = race?.history || [];
  if (history.length < 2) return null;
  const previous = dateOnlyTime(history.at(-2)?.date);
  const current = dateOnlyTime(history.at(-1)?.date);
  if (!previous || !current) return null;
  return (race.primaryEvents || []).find((event) => {
    const eventTime = dateOnlyTime(event.date);
    return eventTime && eventTime > previous && eventTime <= current;
  }) || null;
}

function inferredMovementDriver(race, gainingParty) {
  const event = recentRaceEvent(race);
  const toward = gainingParty ? racePartyCandidateLabel(race, gainingParty) : raceLeaderName(race);
  if (event) {
    const isRunoff = /runoff/i.test(event.label || "");
    return {
      label: isRunoff ? "Candidate field" : "Primary result",
      detail: isRunoff
        ? `${event.label} on ${event.date} changed the nomination field; the move is grouped toward ${toward}.`
        : `${event.label} on ${event.date} locked in candidate assumptions; the move is grouped toward ${toward}.`,
      kind: isRunoff ? "nomination update" : "primary update"
    };
  }
  if (race.demographicPull) {
    const topGroup = (race.demographicPull.topGroups || [])[0];
    return {
      label: "Base support",
      detail: topGroup
        ? `${topGroup.label || topGroup.group} and candidate coalition assumptions are the largest saved context for this move.`
        : "Candidate coalition and demographic support assumptions are the largest saved context for this move.",
      kind: "demographic support"
    };
  }
  if (race.pollSignal?.pollCount) {
    return {
      label: "Polling base",
      detail: `${race.pollSignal.pollCount} usable race-poll row${race.pollSignal.pollCount === 1 ? "" : "s"} anchor the move, but no single poll delta crossed the saved threshold.`,
      kind: "polling support"
    };
  }
  return {
    label: "National environment",
    detail: `The move is mostly from shared national conditions and baseline support rather than a single state-only update.`,
    kind: "baseline update"
  };
}

function renderMovementPanel(race) {
  const movement = race?.movement || {};
  const gainingParty = movementGainingParty(race);
  const gainingChange = gainingParty ? Math.abs(movement.sinceLastRun || 0) : 0;
  const weekParty = movementGainingParty(race, "sinceWeek") || gainingParty || raceLeaderParty(race);
  const weekChange = weekParty ? probabilityChangeForParty(race, weekParty, "sinceWeek") : null;
  const summaryClass = movementSideClass(race, gainingParty);
  const drivers = (race.movementDrivers || []).filter(Boolean);
  const hasPriorRun = (race.history || []).length > 1;
  const inferredDriver = inferredMovementDriver(race, gainingParty);
  const inferredClass = gainingParty ? movementSideClass(race, gainingParty).replace("moved-", "toward-") : "toward-neutral";
  const fallbackDriver = hasPriorRun
    ? `<li class="${inferredClass}"><span class="movement-driver-label">${escapeHtml(inferredDriver.label)}</span><strong>${escapeHtml(inferredDriver.detail)}</strong><em>${escapeHtml(inferredDriver.kind)}</em></li>`
    : `<li class="toward-neutral"><span class="movement-driver-label">No prior run</span><strong>No previous generated race file to compare.</strong><em>first saved point</em></li>`;
  const driverCards = drivers.length
    ? drivers.map((driver) => {
        const party = Number.isFinite(driver.change) ? (driver.change > 0 ? "D" : "R") : "";
        const className = party ? movementSideClass(race, party).replace("moved-", "toward-") : "toward-neutral";
        const impact = Number.isFinite(driver.change) ? movementImpactLabel(driver.change) : "changed";
        return `
          <li class="${className}">
            <span class="movement-driver-label">${escapeHtml(driver.label || "Input")}</span>
            <strong>${escapeHtml(movementDriverCopy(race, driver))}</strong>
            <em>${escapeHtml(impact)} input move</em>
          </li>
        `;
      }).join("")
    : fallbackDriver;
  const movedName = gainingParty ? racePartyCandidateLabel(race, gainingParty) : raceLeaderName(race);
  const leaderCopy = gainingParty
    ? `${movedName} up ${gainingChange.toFixed(1)} pts since the last run.`
    : "No meaningful probability change since the last run.";
  const weekCopy = Number.isFinite(weekChange) && Math.abs(weekChange) >= .05
    ? `${formatProbabilityShift(weekChange)} this week`
    : "flat this week";
  return `
    <section class="movement-panel ${summaryClass}" aria-label="Race movement">
      <div class="movement-summary">
        <span class="movement-arrow" aria-hidden="true"></span>
        <div>
          <span class="panel-label">Since last run</span>
          <strong>${escapeHtml(leaderCopy)}</strong>
          <small>${escapeHtml(racePartyCandidateLabel(race, weekParty))} is ${escapeHtml(weekCopy)}. ${escapeHtml(movementDriverScope(race))}</small>
        </div>
      </div>
      <ol class="movement-driver-list">${driverCards}</ol>
      <p class="movement-note">These are input changes, not a claim that one single factor caused the whole probability move.</p>
    </section>
  `;
}

function compactMovementText(race) {
  const value = race?.movement?.sinceLastRun;
  if (!Number.isFinite(value) || Math.abs(value) < .05) return "0.0";
  return `${value > 0 ? "D" : "R"} +${Math.abs(value).toFixed(1)}`;
}

function inputQualityText(race) {
  const quality = race?.inputQuality;
  if (!quality) return "Not scored";
  return `${quality.label} (${quality.score}/100)`;
}

function pollWeightLabel(race) {
  const weight = race?.pollSignal?.blendWeight;
  if (!Number.isFinite(weight) || weight <= 0) return "No current race-poll signal";
  if (weight >= .45) return "Heavy race-poll signal";
  if (weight >= .2) return "Moderate race-poll signal";
  return "Light race-poll signal";
}

function candidateTiltText(race, value) {
  if (!Number.isFinite(value) || Math.abs(value) < .05) return "No clear tilt";
  const party = value > 0 ? "D" : "R";
  return `${racePartyCandidateLabel(race, party)} by ${Math.abs(value).toFixed(1)} pts`;
}

function signedInputText(race, value) {
  if (!Number.isFinite(value) || Math.abs(value) < .05) return "Even";
  return candidateTiltText(race, value);
}

function financeInputText(race) {
  const signal = race?.sourceInputs?.openFec?.financeSignal;
  if (!Number.isFinite(signal) || Math.abs(signal) < .05) return "No clear finance edge";
  return candidateTiltText(race, signal);
}

function primaryInputText(race) {
  if (race?.primary === "resolved") return "Nominees set";
  if (race?.primary === "runoff") return "Runoff pending";
  return "Primary unresolved";
}

function senatePrimaryMarkers(race) {
  const events = Array.isArray(race?.primaryEvents) && race.primaryEvents.length
    ? race.primaryEvents
    : race?.primaryDate
      ? [{ date: race.primaryDate, label: race.primary === "runoff" ? "Runoff" : "Primary" }]
      : [];
  return events.map((event) => ({
    date: event.date,
    label: event.conditional ? `${event.label} if needed` : event.label,
    className: "history-primary-marker"
  }));
}

function houseInputConfidence(district) {
  if (!district) return { score: 0, label: "Unscored", reasons: [] };
  let score = 56;
  const reasons = [];
  if (district.sourceRating || district.insideRating || district.baselineRating) score += 12;
  else reasons.push("rating fallback");
  if (Number.isFinite(district.presidentialMargin)) score += 8;
  else reasons.push("missing presidential baseline");
  if (Number.isFinite(district.congressionalMargin)) score += 7;
  else reasons.push("missing recent House baseline");
  if (district.open) {
    score -= 7;
    reasons.push("open seat");
  }
  if (Math.abs(district.margin || 0) < 4) {
    score -= 5;
    reasons.push("close district");
  }
  if (!district.demCandidate || !district.repCandidate) {
    score -= 8;
    reasons.push("candidate field incomplete");
  }
  const label = score >= 75 ? "High input confidence" : score >= 55 ? "Medium input confidence" : "Low input confidence";
  return { score: Math.round(clamp(score, 25, 90)), label, reasons };
}

function houseMovementText(district) {
  const history = district?.history || [];
  if (history.length < 2) return "No prior run";
  const latest = history.at(-1);
  const previous = history.at(-2);
  const change = (latest.dem ?? district.demProbability) - (previous.dem ?? previous.demProbability ?? district.demProbability);
  if (!Number.isFinite(change) || Math.abs(change) < .0005) return "No change";
  return `${change > 0 ? "D" : "R"} +${Math.abs(change * 100).toFixed(1)} since last run`;
}

function signedDriverChange(value) {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) < .05) return "0.0";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(1)}`;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
}

function setMapProbBar(prefix, demProbability, repProbability, label = "Control") {
  const demBar = document.getElementById(`${prefix}-map-probbar-dem`);
  const repBar = document.getElementById(`${prefix}-map-probbar-rep`);
  const text = document.getElementById(`${prefix}-map-probbar-label`);
  const dem = Number(demProbability || 0);
  const rep = Number(repProbability || 0);
  const total = Math.max(.0001, dem + rep);
  if (demBar) demBar.style.width = `${(dem / total) * 100}%`;
  if (repBar) repBar.style.width = `${(rep / total) * 100}%`;
  if (text) text.innerHTML = `<em>D ${oneDecimal(dem)}</em><em>R ${oneDecimal(rep)}</em>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function getRace(state) {
  return forecast?.races?.find((race) => race.state === state);
}

function bucketForRace(race, mode = mapColorMode) {
  if (!race) return "state-muted";
  if (mode === "margin") return RATING_BUCKET[ratingFromSignedValue(race.margin, { tilt: 1, lean: 3, likely: 7, safe: 12 })] || "tossup";
  if (mode === "probability") {
    const probMargin = (race.demProbability - .5) * 100;
    return RATING_BUCKET[ratingFromSignedValue(probMargin, { tilt: 2.5, lean: 10, likely: 25, safe: 45 })] || "tossup";
  }
  return RATING_BUCKET[race.rating] || "tossup";
}

function ratingLabelForRace(race, mode = mapColorMode) {
  if (!race) return "No race";
  if (mode === "margin") return ratingFromSignedValue(race.margin, { tilt: 1, lean: 3, likely: 7, safe: 12 });
  if (mode === "probability") return ratingFromSignedValue((race.demProbability - .5) * 100, { tilt: 2.5, lean: 10, likely: 25, safe: 45 });
  return race.rating;
}

function ratingColor(race, mode = mapColorMode) {
  if (!race) return null;
  const colorData = getRaceColor(race.demProbability, race.margin);
  return colorData.color;
}

function ensurePanelTooltip(panel) {
  let tooltip = panel.querySelector(".panel-hover-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "panel-hover-tooltip";
    panel.append(tooltip);
  }
  return tooltip;
}

function showPanelTooltip(source, html) {
  const panel = source.closest(".chart-panel, .detail-panel, .map-panel");
  if (!panel) return;
  const tooltip = ensurePanelTooltip(panel);
  tooltip.innerHTML = html;
  tooltip.classList.add("visible");

  const panelRect = panel.getBoundingClientRect();
  const sourceRect = source.getBoundingClientRect();
  const tooltipWidth = Math.min(240, panelRect.width - 20);
  const sourceCenter = sourceRect.left - panelRect.left + sourceRect.width / 2;
  const left = clamp(sourceCenter - tooltipWidth / 2, 10, panelRect.width - tooltipWidth - 10);
  const above = sourceRect.top - panelRect.top - tooltip.offsetHeight - 10;
  const below = sourceRect.bottom - panelRect.top + 10;
  const isAbove = above > 8;
  const top = isAbove ? above : below;

  tooltip.style.width = `${tooltipWidth}px`;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.classList.toggle("below-source", !isAbove);
}

function hideAllPanelTooltips() {
  document.querySelectorAll(".panel-hover-tooltip.visible").forEach((tooltip) => {
    tooltip.classList.remove("visible");
  });
}

function hideAllChartHovers() {
  document.querySelectorAll(".history-hover").forEach((hover) => {
    hover.style.display = "none";
  });
}

function installInteractionDismiss() {
  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".seat-bin, .leverage-row, .poll-row, .panel-hover-tooltip")) {
      hideAllPanelTooltips();
    }
    if (!event.target.closest(".history-chart")) {
      hideAllChartHovers();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideAllPanelTooltips();
      hideAllChartHovers();
    }
  });
}

function hidePanelTooltip(source) {
  const panel = source.closest(".chart-panel, .detail-panel, .map-panel");
  const tooltip = panel?.querySelector(".panel-hover-tooltip");
  if (tooltip) tooltip.classList.remove("visible");
}

function bindPanelTooltip(selector, getHtml) {
  bindPanelTooltipFor(document, selector, getHtml);
}

function bindPanelTooltipFor(root, selector, getHtml) {
  root.querySelectorAll(selector).forEach((node) => {
    const handler = (event) => {
      event.stopPropagation();
      showPanelTooltip(node, getHtml(node));
    };
    node.addEventListener("mouseenter", handler);
    node.addEventListener("focus", handler);
    node.addEventListener("click", handler);
    node.addEventListener("mouseleave", () => hidePanelTooltip(node));
    node.addEventListener("blur", () => hidePanelTooltip(node));
  });
}

function updateSummary() {
  if (!forecast) return;
  const settings = forecast.settings || {};
  setText("run-date", forecast.runDate || forecast.modelDate || "--");
  setText("sim-count", Number(settings.simulations || 0).toLocaleString("en-US"));
  setText("watch-count", forecast.races.filter((race) => race.competitive).length);
  setText("dem-control", oneDecimal(forecast.demControlProbability));
  setText("rep-control", oneDecimal(forecast.repControlProbability));
  setText("median-seats", `${forecast.medianSeats} D`);
  const favoredIsDem = forecast.demControlProbability >= forecast.repControlProbability;
  setText("control-headline", favoredIsDem ? "Democrats narrowly favored" : "Republicans narrowly favored");
  const favoredSide = forecast.demControlProbability >= forecast.repControlProbability ? "Democrats" : "Republicans";
  const favoredProbability = Math.max(forecast.demControlProbability, forecast.repControlProbability);
  const senateSeatLine = `${forecast.medianSeats} D / ${100 - forecast.medianSeats} R projected seats`;
  const senateDemSeats = Number(forecast.medianSeats || 0);
  const senateRepSeats = Math.max(0, 100 - senateDemSeats);
  setText("seat-count-headline", senateSeatLine);
  const senateSeatbarLabel = document.getElementById("senate-map-seatbar-label");
  if (senateSeatbarLabel) {
    senateSeatbarLabel.innerHTML = `<em>${senateDemSeats} D</em><em>${senateRepSeats} R</em>`;
  }
  const mapSeatbarDem = document.getElementById("senate-map-seatbar-dem");
  const mapSeatbarRep = document.getElementById("senate-map-seatbar-rep");
  if (mapSeatbarDem) {
    mapSeatbarDem.style.width = `${senateDemSeats}%`;
    mapSeatbarDem.style.setProperty("--seat-units", Math.max(1, senateDemSeats));
  }
  if (mapSeatbarRep) {
    mapSeatbarRep.style.width = `${senateRepSeats}%`;
    mapSeatbarRep.style.setProperty("--seat-units", Math.max(1, senateRepSeats));
  }
  setMapProbBar("senate", forecast.demControlProbability, forecast.repControlProbability, "Control");
  const oddsNode = document.getElementById("odds-phrase");
  if (oddsNode) {
    oddsNode.innerHTML = `<span>${favoredSide} favored</span><strong>${pct(favoredProbability)}</strong>`;
  }
  setText("home-senate-favored", `${favoredSide} ${pct(favoredProbability)}`);
  setText("home-senate-seats", senateSeatLine);
  setText("home-senate-dem", oneDecimal(forecast.demControlProbability));
  setText("home-senate-rep", oneDecimal(forecast.repControlProbability));
  setText("home-senate-run", forecast.runDate || forecast.modelDate || "--");
  setText("home-senate-median", `${forecast.medianSeats} D / ${100 - forecast.medianSeats} R`);
  setText("home-senate-note", `${forecast.races.filter((race) => race.competitive).length} competitive races`);
  const senateCard = document.getElementById("home-senate-card");
  if (senateCard) {
    senateCard.classList.toggle("control-dem", favoredIsDem);
    senateCard.classList.toggle("control-rep", !favoredIsDem);
  }
  document.querySelectorAll(".odds-panel").forEach((panel) => {
    panel.classList.toggle("control-dem", favoredIsDem);
    panel.classList.toggle("control-rep", !favoredIsDem);
  });
  setText("update-time", "Fires daily");

  const demBar = document.getElementById("dem-control-bar");
  const repBar = document.getElementById("rep-control-bar");
  if (demBar && repBar) {
    demBar.style.width = `${forecast.demControlProbability * 100}%`;
    repBar.style.width = `${forecast.repControlProbability * 100}%`;
  }
}

function updateHomeHouseSummary() {
  console.log("[wiki.js] updateHomeHouseSummary called, houseForecast:", houseForecast);
  if (!houseForecast) {
    console.log("[wiki.js] houseForecast is null, skipping update");
    return;
  }
  const favoredIsDem = houseForecast.demControlProbability >= houseForecast.repControlProbability;
  const favoredSide = favoredIsDem ? "Democrats" : "Republicans";
  const favoredProbability = Math.max(houseForecast.demControlProbability, houseForecast.repControlProbability);
  const houseSeatLine = `${houseForecast.medianSeats} D / ${435 - houseForecast.medianSeats} R projected seats`;
  setText("home-house-status", "Live");
  setText("home-house-favored", `${favoredSide} ${houseProbability(favoredProbability)}`);
  setText("home-house-seats", houseSeatLine);
  setText("home-house-dem", houseProbability(houseForecast.demControlProbability));
  setText("home-house-rep", houseProbability(houseForecast.repControlProbability));
  setText("home-house-run", houseForecast.runDate || houseForecast.modelDate || "--");
  setText("home-house-median", `${houseForecast.medianSeats} D / ${435 - houseForecast.medianSeats} R`);
  setText("home-house-note", `${houseForecast.districts?.filter((district) => district.competitive).length ?? "--"} competitive districts`);
  const houseCard = document.getElementById("home-house-card");
  if (houseCard) {
    houseCard.classList.toggle("control-dem", favoredIsDem);
    houseCard.classList.toggle("control-rep", !favoredIsDem);
  }
}

function updateHomeGovernorSummary() {
  console.log("[wiki.js] updateHomeGovernorSummary called, governorForecast:", governorForecast);
  if (!governorForecast) {
    console.log("[wiki.js] governorForecast is null, skipping update");
    return;
  }
  const demRaces = governorForecast.projectedDemRaceWins ?? governorForecast.races?.filter((race) => race.demProbability >= .5).length ?? 0;
  const repRaces = governorForecast.projectedRepRaceWins ?? Math.max(0, (governorForecast.races?.length ?? 36) - demRaces);
  const favoredIsDem = demRaces >= repRaces;
  const favoredSide = favoredIsDem ? "Democrats" : "Republicans";
  setText("home-governor-run", governorForecast.runDate || governorForecast.modelDate || "--");
  setText("home-governor-favored", `${favoredSide} lead`);
  setText("home-governor-dem", demRaces);
  setText("home-governor-rep", repRaces);
  setText("home-governor-note", `${governorForecast.races?.filter((race) => race.competitive).length ?? "--"} competitive races`);
  const card = document.getElementById("home-governor-card");
  if (card) {
    card.classList.toggle("control-dem", favoredIsDem);
    card.classList.toggle("control-rep", !favoredIsDem);
  }
}

function presidentCandidateShortName(name) {
  if (!name) return "--";
  if (String(name).includes("Ocasio-Cortez")) return "AOC";
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

function presidentSummary() {
  if (!presidentForecasts?.length) return null;
  const count = presidentForecasts.length;
  const demWin = presidentForecasts.reduce((sum, item) => sum + (item.national?.demWinProbability || 0), 0) / count;
  const repWin = presidentForecasts.reduce((sum, item) => sum + (item.national?.repWinProbability || 0), 0) / count;
  const demEv = presidentForecasts.reduce((sum, item) => sum + (item.electoralCollege?.demExpectedEV || 0), 0) / count;
  const repEv = presidentForecasts.reduce((sum, item) => sum + (item.electoralCollege?.repExpectedEV || 0), 0) / count;
  const sortedDem = [...presidentForecasts].sort((a, b) => (b.national?.demWinProbability || 0) - (a.national?.demWinProbability || 0));
  const sortedRep = [...presidentForecasts].sort((a, b) => (b.national?.repWinProbability || 0) - (a.national?.repWinProbability || 0));
  const runDate = presidentForecasts.map((item) => item.date).filter(Boolean).sort().at(-1);
  return { count, demWin, repWin, demEv, repEv, sortedDem, sortedRep, runDate };
}

function updateHomePresidentSummary() {
  console.log("[wiki.js] updateHomePresidentSummary called, presidentForecasts:", presidentForecasts);
  const summary = presidentSummary();
  console.log("[wiki.js] presidentSummary:", summary);
  if (!summary) {
    console.log("[wiki.js] presidentSummary is null, skipping update");
    return;
  }
  const favoredIsDem = summary.demWin >= summary.repWin;
  const favoredSide = favoredIsDem ? "Democrats" : "Republicans";
  const favoredProbability = Math.max(summary.demWin, summary.repWin);
  setText("home-president-favored", `${favoredSide} ${pct(favoredProbability)}`);
  setText("home-president-dem", oneDecimal(summary.demWin));
  setText("home-president-rep", oneDecimal(summary.repWin));
  setText("home-president-run", summary.runDate || "--");
  setText("home-president-ev", `${Math.round(summary.demEv)} D / ${Math.round(summary.repEv)} R`);
  setText("home-president-note", `${summary.count} tested matchups`);
  const card = document.getElementById("home-president-card");
  if (card) {
    card.classList.toggle("control-dem", favoredIsDem);
    card.classList.toggle("control-rep", !favoredIsDem);
  }
}

function metricTone(partyOrValue) {
  if (partyOrValue === "D" || Number(partyOrValue) > 0) return "metric-dem";
  if (partyOrValue === "R" || Number(partyOrValue) < 0) return "metric-rep";
  return "metric-toss";
}

function radarRow({ className, href, id, probability, probabilityParty, margin, marginParty }) {
  return `
    <a class="home-radar-row ${className || ""}" href="${escapeHtml(href)}">
      <strong>${escapeHtml(id)}</strong>
      <b class="${metricTone(probabilityParty)}">${escapeHtml(probability)}</b>
      <i class="${metricTone(marginParty)}">${escapeHtml(margin)}</i>
    </a>
  `;
}

function renderHomeRadar() {
  const rowLimit = 5;
  const senate = document.getElementById("home-senate-radar");
  if (senate && forecast) {
    const races = [...forecast.races]
      .filter((race) => race.competitive || race.tippingPower > .05)
      .sort((a, b) => a.winnerProbability - b.winnerProbability)
      .slice(0, rowLimit);
    senate.innerHTML = races.map((race) => radarRow({
      className: leaderClassForRace(race),
      href: `race.html?state=${race.state}`,
      id: race.state,
      probability: `${race.winnerParty} ${oneDecimal(race.winnerProbability)}`,
      probabilityParty: race.winnerParty,
      margin: signedPointMargin(race.margin),
      marginParty: race.margin
    })).join("");
  }

  const house = document.getElementById("home-house-radar");
  if (house && houseForecast) {
    const districts = [...(houseForecast.districts || houseForecast.decisiveDistricts || [])]
      .filter((district) => district.competitive || district.winnerProbability < .75)
      .sort((a, b) => a.winnerProbability - b.winnerProbability)
      .slice(0, rowLimit);
    house.innerHTML = districts.map((district) => radarRow({
      className: houseLeaderClass(district),
      href: "house.html",
      id: district.id,
      probability: `${district.winnerParty === "D" ? "D" : "R"} ${houseProbability(district.winnerProbability)}`,
      probabilityParty: district.winnerParty,
      margin: signedPointMargin(district.margin),
      marginParty: district.margin
    })).join("");
  }

  const governors = document.getElementById("home-governor-radar");
  if (governors && governorForecast) {
    const races = [...governorForecast.races]
      .filter((race) => race.competitive || race.tippingPower > .05)
      .sort((a, b) => Math.max(a.demProbability, a.repProbability) - Math.max(b.demProbability, b.repProbability))
      .slice(0, rowLimit);
    governors.innerHTML = races.map((race) => {
      const leader = race.demProbability >= .5 ? "D" : "R";
      const probability = Math.max(race.demProbability, race.repProbability);
      return radarRow({
        className: governorLeaderClass(race),
        href: "governor.html",
        id: race.state,
        probability: `${leader} ${oneDecimal(probability)}`,
        probabilityParty: leader,
        margin: signedPointMargin(race.margin),
        marginParty: race.margin
      });
    }).join("");
  }

  const president = document.getElementById("home-president-radar");
  const summary = presidentSummary();
  if (president && summary) {
    const rows = [
      ...summary.sortedDem.slice(0, 3).map((item) => ({
        type: "leads-dem",
        id: `${presidentCandidateShortName(item.demCandidateName)}-${presidentCandidateShortName(item.repCandidateName)}`,
        value: oneDecimal(item.national?.demWinProbability || 0),
        party: "D",
        margin: (item.national?.demPopularVote || 0) - (item.national?.repPopularVote || 0)
      })),
      ...summary.sortedRep.slice(0, 3).map((item) => ({
        type: "leads-rep",
        id: `${presidentCandidateShortName(item.repCandidateName)}-${presidentCandidateShortName(item.demCandidateName)}`,
        value: oneDecimal(item.national?.repWinProbability || 0),
        party: "R",
        margin: (item.national?.demPopularVote || 0) - (item.national?.repPopularVote || 0)
      }))
    ].slice(0, rowLimit);
    president.innerHTML = rows.map((row) => radarRow({
      className: row.type,
      href: "president.html",
      id: row.id,
      probability: `${row.party} ${row.value}`,
      probabilityParty: row.party,
      margin: signedPointMargin(row.margin),
      marginParty: row.margin
    })).join("");
  }
}

async function renderHomeLatestVideo() {
  const container = document.getElementById("home-latest-video");
  if (!container) return;
  try {
    const response = await fetch("data/videos.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Video data returned ${response.status}`);
    const data = await response.json();
    const video = (data.latestUploads || [])[0] || data.latestLivestream;
    if (!video?.id) {
      container.innerHTML = `<p class="meta">No public video found.</p>`;
      return;
    }
    container.innerHTML = `
      <iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(video.id)}" title="${escapeHtml(video.title || "Federal Elections Analysis video")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      <div>
        <span class="video-section-label video-section-label-upload">Latest upload</span>
        <h3><strong>${escapeHtml(video.title || "Federal Elections Analysis video")}</strong></h3>
        <p><a class="button-link" href="${escapeHtml(video.url || `https://www.youtube.com/watch?v=${video.id}`)}" target="_blank" rel="noreferrer">Watch on YouTube</a></p>
      </div>
    `;
  } catch {
    container.innerHTML = `<p class="meta">Video data unavailable.</p>`;
  }
}

function renderHomeDiagnostics() {
  const movers = document.getElementById("home-senate-movers");
  if (movers && forecast) {
    const rows = [...forecast.races]
      .filter((race) => Number.isFinite(race.movement?.sinceLastRun))
      .sort((a, b) => Math.abs(b.movement.sinceLastRun) - Math.abs(a.movement.sinceLastRun))
      .slice(0, 6);
    movers.innerHTML = rows.length ? rows.map((race) => `
      <a class="home-radar-row ${leaderClassForRace(race)}" href="race.html?state=${race.state}">
        <strong>${escapeHtml(race.state)}</strong>
        <span>${escapeHtml(race.displayName.replace(" Senate", ""))}</span>
        <b>${escapeHtml(compactMovementText(race))}</b>
        <i>${oneDecimal(race.winnerProbability)}</i>
      </a>
    `).join("") : `<p class="meta">No prior run yet.</p>`;
  }

  const confidence = document.getElementById("home-low-confidence");
  if (confidence && forecast) {
    const senateRows = forecast.races
      .filter((race) => race.inputQuality)
      .map((race) => ({
        type: "Senate",
        id: race.state,
        label: race.displayName.replace(" Senate", ""),
        score: race.inputQuality.score,
        href: `race.html?state=${race.state}`,
        className: leaderClassForRace(race)
      }));
    confidence.innerHTML = senateRows
      .sort((a, b) => a.score - b.score)
      .slice(0, 6)
      .map((row) => `
        <a class="home-radar-row ${row.className}" href="${escapeHtml(row.href)}">
          <strong>${escapeHtml(row.id)}</strong>
          <span>${escapeHtml(row.type)} / ${escapeHtml(row.label)}</span>
          <b>${row.score}/100</b>
          <i>input</i>
        </a>
      `).join("");
  }
}

function normalizedMapMode(mode) {
  return Object.prototype.hasOwnProperty.call(MAP_COLOR_MODES, mode) ? mode : mapColorMode;
}

function hoverMarkup(race, mode = mapColorMode) {
  const activeMode = normalizedMapMode(mode);
  if (!race) {
    return `<span class="panel-label">State detail</span><h3>No Senate race</h3><p>This state is not on the regular 2026 Senate board.</p>`;
  }
  const ratingLabel = ratingLabelForRace(race, activeMode);
  const ratingBucket = bucketForRace(race, activeMode);
  const ratingModeLabel = MAP_COLOR_MODES[activeMode];
  const winner = candidateForecastName(race, race.winnerParty);
  const demCandidate = candidateDisplayName(race, "D");
  const repCandidate = candidateDisplayName(race, "R");
  const demBadge = candidateStatusBadge(race, "D");
  const repBadge = candidateStatusBadge(race, "R");
  const demIsIndependent = race.demDisplayParty === "I" || String(race.dem || "").toLowerCase().includes("independent");
  return `
    <span class="race-kicker">${race.displayName}</span>
    <div class="map-card-title">
      <div class="state-code">${race.state}</div>
      <span class="rating-pill ${ratingBucket}" title="${escapeHtml(ratingModeLabel)}">${ratingLabel}</span>
    </div>
    <h3>${winner} has a ${oneDecimal(race.winnerProbability)} chance.</h3>
    <div class="candidate-table" aria-label="${race.state} candidate forecast">
      <div class="candidate-table-head"><span>Candidate</span><span>Chance</span></div>
      <div class="${candidateRowClass(race, "D")}">
        <span>${escapeHtml(demCandidate)} <i class="${candidateBadgeClass(demBadge, "D")}">${demBadge}</i>${presumptiveBadge(race, "D")}</span>
        <strong>${oneDecimal(race.demProbability)}</strong>
      </div>
      ${extraCandidateRows(race)}
      <div class="${candidateRowClass(race, "R")}">
        <span>${escapeHtml(repCandidate)} <i class="${candidateBadgeClass(repBadge, "R")}">${repBadge}</i>${presumptiveBadge(race, "R")}</span>
        <strong>${oneDecimal(1 - race.demProbability)}</strong>
      </div>
      <div class="candidate-margin"><span>Projected margin</span><strong>${signedPointMargin(race.margin)}</strong></div>
    </div>
    <div class="prob-track ${demIsIndependent ? "independent-track" : ""}" aria-label="${race.state} probability split">
      <span style="width:${race.demProbability * 100}%"></span>
      <span style="width:${(1 - race.demProbability) * 100}%"></span>
    </div>
    <p class="candidate-key"><b>P</b> Presumptive nominee. <b>I</b> Independent.</p>
    <div class="badge-row">${(race.uncertaintyBadges || []).slice(0, 4).map((badge) => `<span>${escapeHtml(badge)}</span>`).join("")}</div>
    <p>${escapeHtml(race.summary || race.note || "")}</p>
    <p class="meta">Color mode: ${escapeHtml(ratingModeLabel)} / Primary: ${race.primary} / Tipping power: ${oneDecimal(race.tippingPower)}</p>
    <a class="button-link" href="race.html?state=${race.state}">Open race page</a>
  `;
}

function updateHoverCard(race) {
  const card = document.getElementById("map-hover-card");
  if (card) card.innerHTML = hoverMarkup(race, mapColorMode);
}

function renderFallbackMap() {
  const container = document.getElementById("senate-map");
  if (!container || !forecast) return;
  container.innerHTML = `
    <div class="fallback-list">
      ${forecast.races.map((race) => `<a href="race.html?state=${race.state}" style="background:${ratingColor(race)}" title="${escapeHtml(ratingLabelForRace(race))}">${race.state}</a>`).join("")}
    </div>
    <p class="map-note">State map library unavailable. Race links remain available.</p>
  `;
}

async function renderStateMap() {
  const container = document.getElementById("senate-map");
  if (!container || !forecast) return;
  if (!window.d3 || !window.topojson) {
    renderFallbackMap();
    return;
  }
  try {
    const us = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
    const features = topojson.feature(us, us.objects.states).features;
    const width = 960;
    const height = 610;
    const projection = d3.geoAlbersUsa().fitSize([width, height], { type: "FeatureCollection", features });
    const path = d3.geoPath(projection);
    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "United States map of 2026 Senate race ratings");
    svg.selectAll("path")
      .data(features)
      .join("path")
      .attr("class", (feature) => {
        const race = getRace(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]);
        return race ? `state-shape` : "state-shape state-muted";
      })
      .attr("d", path)
      .attr("fill", (feature) => {
        const race = getRace(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]);
        return race ? ratingColor(race) : null;
      })
      .attr("opacity", (feature) => {
        const race = getRace(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]);
        return race ? clamp(.58 + race.winnerProbability * .42, .74, 1) : null;
      })
      .attr("tabindex", (feature) => getRace(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]) ? 0 : -1)
      .on("mouseenter focus", (event, feature) => updateHoverCard(getRace(FIPS_TO_STATE[String(feature.id).padStart(2, "0")])) )
      .on("click keydown", (event, feature) => {
        if (event.type === "keydown" && event.key !== "Enter") return;
        const race = getRace(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]);
        if (race) window.location.href = `race.html?state=${race.state}`;
      })
      .append("title")
      .text((feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        const race = getRace(state);
        return race ? `${STATE_NAMES[state]}: ${ratingLabelForRace(race)}, ${race.winnerParty} ${pct(race.winnerProbability)}` : STATE_NAMES[state];
      });
    updateHoverCard([...forecast.races].sort((a, b) => b.tippingPower - a.tippingPower)[0]);
  } catch (error) {
    renderFallbackMap();
  }
}

function renderLegend() {
  const legend = document.getElementById("map-legend");
  if (!legend) return;
  legend.innerHTML = spectrumLegendHtml();
}

function renderMapColorControls() {
  const container = document.getElementById("map-color-controls");
  if (!container) return;
  container.innerHTML = Object.entries(MAP_COLOR_MODES).map(([mode, label]) => (
    `<button type="button" class="${mode === mapColorMode ? "active" : ""}" data-map-color="${mode}">${label}</button>`
  )).join("");
  container.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      mapColorMode = button.dataset.mapColor || "rating";
      renderMapColorControls();
      renderLegend();
      renderStateMap();
    });
  });
}

function renderHistogram() {
  const container = document.getElementById("seat-histogram");
  if (!container || !forecast) return;
  renderSeatHistogramInto(container);
}

function renderSeatHistogramInto(container, model = forecast, options = {}) {
  const counts = model?.seatCounts || {};
  const seats = Object.keys(counts).map(Number).sort((a, b) => a - b);
  if (!seats.length) return;
  const minSeat = Math.max(options.minSeat ?? 42, Math.min(...seats));
  const maxSeat = Math.min(options.maxSeat ?? 57, Math.max(...seats));
  const maxCount = Math.max(...Object.values(counts));
  const sims = model?.settings?.simulations || Object.values(counts).reduce((a, b) => a + b, 0);
  const binCount = maxSeat - minSeat + 1;
  container.style.gridTemplateColumns = `repeat(${binCount}, minmax(0, 1fr))`;
  container.innerHTML = Array.from({ length: binCount }, (_, i) => {
    const seat = minSeat + i;
    const value = counts[seat] || 0;
    const share = sims ? value / sims : 0;
    const height = maxCount ? clamp((value / maxCount), .02, 1) : .02;
    return `<button class="seat-bin" type="button" data-tip="${seat} Democratic seats<br>${pct(share)} of simulations"><i style="--bar-scale:${height}"></i><span>${seat}</span></button>`;
  }).join("");
  bindPanelTooltipFor(container, ".seat-bin", (node) => node.dataset.tip);
}

function renderGovernorDistributionInto(container, model = governorForecast, options = {}) {
  const counts = model?.distribution || {};
  const seats = Object.keys(counts).map(Number).sort((a, b) => a - b);
  if (!seats.length) return;
  const center = model?.medianDemGovernors || 25;
  const minSeat = Math.max(options.minSeat ?? 12, Math.min(...seats, center - 8));
  const maxSeat = Math.min(options.maxSeat ?? 38, Math.max(...seats, center + 8));
  const maxCount = Math.max(...Object.values(counts));
  const sims = model?.settings?.simulations || Object.values(counts).reduce((a, b) => a + b, 0);
  const binCount = maxSeat - minSeat + 1;
  container.style.gridTemplateColumns = `repeat(${binCount}, minmax(0, 1fr))`;
  container.innerHTML = Array.from({ length: binCount }, (_, i) => {
    const seat = minSeat + i;
    const value = counts[seat] || 0;
    const share = sims ? value / sims : 0;
    const height = maxCount ? clamp((value / maxCount), .02, 1) : .02;
    return `<button class="seat-bin" type="button" data-tip="${seat} Democratic governor races<br>${pct(share)} of simulations"><i style="--bar-scale:${height}"></i><span>${seat}</span></button>`;
  }).join("");
  bindPanelTooltipFor(container, ".seat-bin", (node) => node.dataset.tip);
}

function governorLeaderClass(race) {
  return race.demProbability >= .5 ? "leads-dem" : "leads-rep";
}

function updateGovernorSummary() {
  if (!governorForecast) return;
  const demProb = governorForecast.demMajorityProbability || 0;
  const repProb = governorForecast.repMajorityProbability || 0;
  const favoredIsDem = demProb >= repProb;
  const favoredSide = favoredIsDem ? "Democrats" : "Republicans";
  const favoredProbability = Math.max(demProb, repProb);
  setText("governor-run-date", governorForecast.runDate || governorForecast.modelDate || "--");
  setText("governor-sim-count", Number(governorForecast.settings?.simulations || 0).toLocaleString("en-US"));
  setText("governor-watch-count", governorForecast.races?.filter((race) => race.competitive).length ?? "--");
  setText("governor-dem-majority", oneDecimal(demProb));
  setText("governor-rep-majority", oneDecimal(repProb));
  setText("governor-no-majority", oneDecimal(tieProb));
  setText("governor-median", `${governorForecast.medianDemGovernors} D / ${governorForecast.medianRepGovernors} R`);
  setText("governor-control-headline", `${favoredSide} favored for governor majority`);
  const oddsNode = document.getElementById("governor-odds-phrase");
  if (oddsNode) oddsNode.innerHTML = `<span>${favoredSide} favored</span><strong>${pct(favoredProbability)}</strong>`;
  const demBar = document.getElementById("governor-dem-bar");
  const repBar = document.getElementById("governor-rep-bar");
  if (demBar && repBar) {
    demBar.style.width = `${demProb * 100}%`;
    repBar.style.width = `${repProb * 100}%`;
  }
  setMapProbBar("governor", demProb, repProb, "Majority");
  const panel = document.querySelector("#governor-odds-phrase")?.closest(".odds-panel");
  if (panel) {
    panel.classList.toggle("control-dem", favoredIsDem);
    panel.classList.toggle("control-rep", !favoredIsDem);
  }
}

function governorHoverMarkup(race) {
  if (!race) return `<span class="panel-label">State detail</span><h3>No 2026 governor race</h3><p>This state is not on the 2026 governor board.</p>`;
  const leader = race.demProbability >= .5 ? "Democrat" : "Republican";
  const leaderProb = Math.max(race.demProbability, race.repProbability);
  return `
    <span class="race-kicker">${escapeHtml(race.displayName)}</span>
    <div class="map-card-title">
      <div class="state-code">${escapeHtml(race.state)}</div>
      <span class="rating-pill ${bucketForRace(race)}">${escapeHtml(race.rating)}</span>
    </div>
    <h3>${leader} has a ${oneDecimal(leaderProb)} chance.</h3>
    <div class="candidate-table" aria-label="${escapeHtml(race.displayName)} forecast">
      <div class="candidate-table-head"><span>Party</span><span>Chance</span></div>
      <div class="candidate-row dem-row"><span>Democrat <i class="party-badge dem-badge">D</i></span><strong>${oneDecimal(race.demProbability)}</strong></div>
      <div class="candidate-row rep-row"><span>Republican <i class="party-badge rep-badge">R</i></span><strong>${oneDecimal(race.repProbability)}</strong></div>
      <div class="candidate-margin"><span>Projected margin</span><strong>${signedPointMargin(race.margin)}</strong></div>
    </div>
    <p>${escapeHtml(race.status)}. Incumbent party: ${escapeHtml(race.incumbentParty)}.</p>
    ${renderMovementPanel(race)}
    <p class="meta">Tipping power: ${oneDecimal(race.tippingPower || 0)}</p>
  `;
}

function updateGovernorHoverCard(race) {
  const card = document.getElementById("governor-map-hover-card");
  if (card) card.innerHTML = governorHoverMarkup(race);
}

function renderGovernorFallbackMap() {
  const container = document.getElementById("governor-map");
  if (!container || !governorForecast) return;
  container.innerHTML = `
    <div class="fallback-list">
      ${governorForecast.races.map((race) => `<button type="button" style="background:${ratingColor(race)}" title="${escapeHtml(race.rating)}">${escapeHtml(race.state)}</button>`).join("")}
    </div>
    <p class="map-note">State map library unavailable.</p>
  `;
}

async function renderGovernorMap() {
  const container = document.getElementById("governor-map");
  if (!container || !governorForecast) return;
  if (!window.d3 || !window.topojson) {
    renderGovernorFallbackMap();
    return;
  }
  try {
    const us = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
    const features = topojson.feature(us, us.objects.states).features;
    const width = 960;
    const height = 610;
    const projection = d3.geoAlbersUsa().fitSize([width, height], { type: "FeatureCollection", features });
    const path = d3.geoPath(projection);
    const racesByState = new Map(governorForecast.races.map((race) => [race.state, race]));
    container.innerHTML = "";
    const svg = d3.select(container).append("svg").attr("viewBox", `0 0 ${width} ${height}`).attr("role", "img").attr("aria-label", "United States map of 2026 governor race ratings");
    svg.selectAll("path")
      .data(features)
      .join("path")
      .attr("class", (feature) => racesByState.has(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]) ? "state-shape" : "state-shape state-muted")
      .attr("d", path)
      .attr("fill", (feature) => {
        const race = racesByState.get(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]);
        return race ? ratingColor(race) : null;
      })
      .attr("opacity", (feature) => racesByState.has(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]) ? 1 : null)
      .attr("tabindex", (feature) => racesByState.has(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]) ? 0 : -1)
      .on("mouseenter focus", (event, feature) => updateGovernorHoverCard(racesByState.get(FIPS_TO_STATE[String(feature.id).padStart(2, "0")])))
      .append("title")
      .text((feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        const race = racesByState.get(state);
        return race ? `${STATE_NAMES[state]}: ${race.rating}` : STATE_NAMES[state];
      });
    updateGovernorHoverCard([...governorForecast.races].sort((a, b) => b.tippingPower - a.tippingPower)[0]);
  } catch {
    renderGovernorFallbackMap();
  }
}

function renderGovernorLegend() {
  const legend = document.getElementById("governor-map-legend");
  if (!legend) return;
  legend.innerHTML = spectrumLegendHtml();
}

function renderGovernorHistogram() {
  const container = document.getElementById("governor-seat-histogram");
  if (!container || !governorForecast) return;
  const counts = governorForecast.distribution || {};
  const seats = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const minSeat = Math.min(...seats);
  const maxSeat = Math.max(...seats);
  const maxCount = Math.max(...Object.values(counts));
  const sims = governorForecast.settings?.simulations || Object.values(counts).reduce((a, b) => a + b, 0);
  container.style.gridTemplateColumns = `repeat(${maxSeat - minSeat + 1}, minmax(0, 1fr))`;
  container.innerHTML = Array.from({ length: maxSeat - minSeat + 1 }, (_, index) => {
    const seat = minSeat + index;
    const value = counts[seat] || 0;
    const share = sims ? value / sims : 0;
    const height = maxCount ? clamp(value / maxCount, .02, 1) : .02;
    return `<button class="seat-bin" type="button" data-tip="${seat} Democratic governors<br>${pct(share)} of simulations"><i style="--bar-scale:${height}"></i><span>${seat}</span></button>`;
  }).join("");
  bindPanelTooltipFor(container, ".seat-bin", (node) => node.dataset.tip);
}

function renderGovernorLeverage() {
  const chart = document.getElementById("governor-leverage-chart");
  if (!chart || !governorForecast) return;
  const ranked = [...governorForecast.races].sort((a, b) => b.tippingPower - a.tippingPower).slice(0, 10);
  const max = Math.max(...ranked.map((race) => race.tippingPower));
  chart.innerHTML = ranked.map((race) => {
    const width = max ? clamp((race.tippingPower / max) * 100, 8, 100) : 8;
    return `<button class="leverage-row ${governorLeaderClass(race)}" type="button" data-tip="${escapeHtml(race.displayName)}<br>${oneDecimal(race.tippingPower)} tipping power<br>${escapeHtml(race.rating)}"><strong>${escapeHtml(race.state)}</strong><i style="width:${width}%"></i><span>${oneDecimal(race.tippingPower)}</span></button>`;
  }).join("");
  bindPanelTooltipFor(chart, ".leverage-row", (node) => node.dataset.tip);
}

function renderGovernorHistory() {
  const chart = document.getElementById("governor-history-chart");
  if (!chart || !governorForecast) return;
  const points = governorForecast.controlHistory?.length ? governorForecast.controlHistory : governorForecast.governorCountHistory?.length ? governorForecast.governorCountHistory.map((point) => ({ date: point.date, dem: point.demGovernors / 36, rep: point.repGovernors / 36 })) : [{ date: governorForecast.modelDate, dem: governorForecast.demMajorityProbability, rep: governorForecast.repMajorityProbability }];
  renderLineChart(chart, points, {
    label: "Governor majority probability history",
    pointHtml: (point) => `${point.date}<br>D ${pct(point.dem)} / R ${pct(point.rep ?? 1 - point.dem)}`,
    value: (point) => point.dem,
    electionDate: governorForecast.settings?.electionDate || "2026-11-03",
    singleNote: "Governor history starts with the first generated forecast and grows each daily run."
  });
}

function renderGovernorRaceBoard() {
  const board = document.getElementById("governor-race-board");
  if (!board || !governorForecast) return;
  const rows = [...governorForecast.races].sort((a, b) => Math.abs(a.demProbability - .5) - Math.abs(b.demProbability - .5));
  board.innerHTML = rows.map((race) => {
    const leader = race.demProbability >= .5 ? "D" : "R";
    const probability = Math.max(race.demProbability, race.repProbability);
    return `
      <div class="race-board-row governor-race-row ${governorLeaderClass(race)}">
        <strong>${escapeHtml(race.state)}</strong>
        <span>${escapeHtml(race.displayName)}</span>
        <span>${escapeHtml(race.status)}</span>
        <span>${escapeHtml(race.rating)}</span>
        <span>${signedPointMargin(race.margin)}</span>
        <span>${leader} ${oneDecimal(probability)}</span>
        <span>${escapeHtml(movementText(race))}</span>
      </div>
    `;
  }).join("");
}

function renderGovernorPage() {
  if (!document.getElementById("governor-race-board")) return;
  updateGovernorSummary();
  renderGovernorMap();
  renderGovernorLegend();
  renderGovernorHistogram();
  renderGovernorLeverage();
  renderGovernorHistory();
  renderGovernorRaceBoard();
}

function renderLeverageChart() {
  const chart = document.getElementById("leverage-chart");
  if (!chart || !forecast) return;
  renderLeverageInto(chart);
}

function renderLeverageInto(chart) {
  const ranked = [...forecast.races].sort((a, b) => b.tippingPower - a.tippingPower).slice(0, 9);
  const max = Math.max(...ranked.map((race) => race.tippingPower));
  chart.innerHTML = ranked.map((race) => {
    const width = max ? clamp((race.tippingPower / max) * 100, 8, 100) : 8;
    const leaderClass = leaderClassForRace(race);
    return `<a class="leverage-row ${leaderClass}" href="race.html?state=${race.state}" data-tip="${race.displayName}<br>${oneDecimal(race.tippingPower)} control tipping power<br>${pct(race.demProbability)} Democrat"><strong>${race.state}</strong><i style="width:${width}%"></i><span>${oneDecimal(race.tippingPower)}</span></a>`;
  }).join("");
  bindPanelTooltipFor(chart, ".leverage-row", (node) => node.dataset.tip);
}

function renderSenateControlPath() {
  const container = document.getElementById("senate-control-path");
  if (!container || !forecast) return;
  const demPath = forecast.controlPaths?.dem?.commonWins || [];
  const repPath = forecast.controlPaths?.rep?.commonWins || [];
  const row = (item, party) => `
    <a class="path-chip ${party === "D" ? "leads-dem" : "leads-rep"}" href="race.html?state=${escapeHtml(item.state)}">
      <strong>${escapeHtml(item.state)}</strong>
      <span>${escapeHtml((item.displayName || "").replace(" Senate", ""))}</span>
      <b>${oneDecimal(item.probability)}</b>
    </a>`;
  container.innerHTML = `
    <div>
      <h3>Democratic-control simulations</h3>
      <p>${demPath.slice(0, 8).map((item) => item.state).join(", ") || "--"}</p>
      <div class="path-chip-grid">${demPath.slice(0, 8).map((item) => row(item, "D")).join("")}</div>
    </div>
    <div>
      <h3>Republican-control simulations</h3>
      <p>${repPath.slice(0, 8).map((item) => item.state).join(", ") || "--"}</p>
      <div class="path-chip-grid">${repPath.slice(0, 8).map((item) => row(item, "R")).join("")}</div>
    </div>
  `;
}

function renderControlHistory() {
  const chart = document.getElementById("control-history-chart");
  if (!chart || !forecast) return;
  const points = forecast.controlHistory?.length ? forecast.controlHistory : [{ date: forecast.modelDate, dem: forecast.demControlProbability, rep: forecast.repControlProbability }];
  renderLineChart(chart, points, {
    label: "Chamber control probability history",
    pointHtml: (point) => `${point.date}<br>D ${pct(point.dem)} / R ${pct(point.rep ?? 1 - point.dem)}`,
    value: (point) => point.dem,
    electionDate: forecast.settings?.electionDate || "2026-11-03",
    eventMarkers: SENATE_NATIONAL_MARKERS,
    mobileZoomControls: true,
    singleNote: "Control history starts with the first generated forecast and grows each daily run."
  });
}

function renderSeatHistory() {
  const chart = document.getElementById("seat-history-chart");
  if (!chart || !forecast) return;
  const points = forecast.seatHistory?.length ? forecast.seatHistory : [{ date: forecast.modelDate, dem: forecast.medianSeats, rep: 100 - forecast.medianSeats }];
  renderLineChart(chart, points, {
    label: "Projected Senate seats history",
    domain: [30, 70],
    ticks: [70, 60, 50, 40, 30],
    band: 3.2,
    valueFormat: (value) => value.toFixed(0),
    endLabel: (party, value) => `${party === "dem" ? "Democrat" : "Republican"} ${value.toFixed(0)}`,
    hoverLabel: (party, value) => `${party === "dem" ? "Democratic seats" : "Republican seats"} ${value.toFixed(0)}`,
    electionDate: forecast.settings?.electionDate || "2026-11-03",
    eventMarkers: SENATE_NATIONAL_MARKERS,
    singleNote: "Seat-count history starts with the first generated forecast and grows each daily run."
  });
}

function renderRaceSelector() {
  const container = document.getElementById("race-selector");
  if (!container || !forecast) return;
  const activeState = new URLSearchParams(window.location.search).get("state")?.toUpperCase() || "OH";
  const ranked = [...forecast.races].sort((a, b) => b.tippingPower - a.tippingPower);
  container.innerHTML = ranked.map((race) => `<a class="${race.state === activeState ? "active" : ""}" href="race.html?state=${race.state}">${race.state}</a>`).join("");
}

function renderLineChart(chart, points, options) {
  points = (Array.isArray(points) ? points : []).filter((point) => point && Number.isFinite(Number(point.dem)));
  if (!points.length) {
    chart.innerHTML = `<div class="history-empty">${escapeHtml(options?.singleNote || "Forecast history will appear after the next saved run.")}</div>`;
    return;
  }
  const width = 760;
  const height = 310;
  const plot = { left: 54, right: 110, top: 20, bottom: 48 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const demValue = (point) => point.dem;
  const repValue = (point) => point.rep ?? 1 - point.dem;
  const extraSeries = options.extraSeries;
  const extraValue = (point) => Number.isFinite(point?.[extraSeries?.key]) ? point[extraSeries.key] : null;
  const values = points.flatMap((point) => [demValue(point), repValue(point), extraValue(point)]).filter((value) => value !== null);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const compactDomain = () => {
    if (minValue >= 0 && maxValue <= 1) {
      return [0, 1];
    }
    const span = Math.max(1, maxValue - minValue);
    const min = Math.floor((minValue - span * .18) / 5) * 5;
    const max = Math.ceil((maxValue + span * .18) / 5) * 5;
    return min === max ? [min - 5, max + 5] : [min, max];
  };
  const domain = options.domain || compactDomain();
  const band = options.band ?? .055;
  const ticks = options.ticks || (() => {
    const step = (domain[1] - domain[0]) / 4;
    return [4, 3, 2, 1, 0].map((index) => domain[0] + step * index);
  })();
  const valueFormat = options.valueFormat || ((value) => (value * 100).toFixed(domain[1] - domain[0] <= .3 ? 1 : 0));
  const endLabel = options.endLabel || ((party, value) => `${party === "dem" ? "Democrat" : "Republican"} ${oneDecimal(value)}`);
  const hoverLabel = options.hoverLabel || ((party, value) => `${party === "dem" ? "Democrat" : "Republican"} ${oneDecimal(value)}`);
  const demSeriesClass = options.demSeriesClass || "history-line-dem";
  const demBandClass = options.demBandClass || "history-band-dem";
  const demDotClass = options.demDotClass || "history-dot-dem";
  const demHoverDotClass = options.demHoverDotClass || "history-hover-dot-dem";
  const demEndLabelClass = options.demEndLabelClass || "history-end-label-dem";
  const demHoverTextClass = options.demHoverTextClass || "";
  const parseChartDate = (value) => {
    if (!value) return null;
    const text = String(value);
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00` : /T\d{2}:\d{2}/.test(text) ? text : `${text} 12:00:00`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const chartDates = points.map((point) => parseChartDate(point.date));
  const hasUsableDates = chartDates.every(Boolean);
  const rawEventMarkers = options.eventMarkers || [];
  const firstChartDate = hasUsableDates ? chartDates[0] : null;
  const latestChartDate = hasUsableDates ? chartDates.at(-1) : null;
  const electionDate = parseChartDate(options.electionDate);
  const mobileZoomActive = Boolean(options.mobileZoomControls && typeof window !== "undefined" && window.matchMedia?.("(max-width: 760px)").matches);
  const hasZoomControls = Boolean(options.zoomControls || mobileZoomActive);
  const zoomMode = hasZoomControls && chart.dataset.historyZoom ? chart.dataset.historyZoom : "recent";
  const useFullRunway = !hasZoomControls || zoomMode === "full";
  const recentPadDate = (() => {
    if (!hasUsableDates || !latestChartDate) return latestChartDate;
    const observedSpan = Math.max(86400000, latestChartDate - firstChartDate);
    const padMs = Math.min(30 * 86400000, Math.max(86400000, observedSpan * .22));
    const padded = new Date(latestChartDate.getTime() + padMs);
    return electionDate && padded > electionDate ? electionDate : padded;
  })();
  const axisEndDate = hasUsableDates && electionDate && electionDate > latestChartDate
    ? (useFullRunway ? electionDate : recentPadDate)
    : latestChartDate;
  const dateSpan = hasUsableDates ? Math.max(1, axisEndDate - firstChartDate) : 1;
  const xFor = (index) => {
    if (hasUsableDates) return plot.left + ((chartDates[index] - firstChartDate) / dateSpan) * plotWidth;
    return points.length === 1 ? plot.left + plotWidth / 2 : plot.left + index * (plotWidth / (points.length - 1));
  };
  const yFor = (value) => plot.top + ((domain[1] - value) / (domain[1] - domain[0])) * plotHeight;
  const coords = points.map((point, index) => ({
    point,
    x: xFor(index),
    demY: yFor(demValue(point)),
    repY: yFor(repValue(point))
  }));
  const linePath = (series) => {
    if (coords.length === 1) {
      const y = series === "dem" ? coords[0].demY : coords[0].repY;
      return `M ${clamp(coords[0].x - 26, plot.left, width - plot.right)} ${y} L ${clamp(coords[0].x + 26, plot.left, width - plot.right)} ${y}`;
    }
    return coords.map((coord, index) => `${index ? "L" : "M"} ${coord.x} ${series === "dem" ? coord.demY : coord.repY}`).join(" ");
  };
  const areaPath = (series) => {
    const upper = coords.map((coord, index) => {
      const value = series === "dem" ? demValue(coord.point) : repValue(coord.point);
      return `${index ? "L" : "M"} ${coord.x} ${yFor(clamp(value + band, domain[0], domain[1]))}`;
    }).join(" ");
    const lower = [...coords].reverse().map((coord) => {
      const value = series === "dem" ? demValue(coord.point) : repValue(coord.point);
      return `L ${coord.x} ${yFor(clamp(value - band, domain[0], domain[1]))}`;
    }).join(" ");
    return `${upper} ${lower} Z`;
  };
  const extraAreaPath = () => {
    if (!extraSeries) return "";
    const upper = coords.map((coord, index) => {
      const value = extraValue(coord.point);
      return `${index ? "L" : "M"} ${coord.x} ${yFor(clamp((value ?? demValue(coord.point)) + band, domain[0], domain[1]))}`;
    }).join(" ");
    const lower = [...coords].reverse().map((coord) => {
      const value = extraValue(coord.point);
      return `L ${coord.x} ${yFor(clamp((value ?? demValue(coord.point)) - band, domain[0], domain[1]))}`;
    }).join(" ");
    return `${upper} ${lower} Z`;
  };
  const formatChartDate = (value) => {
    const date = parseChartDate(value);
    if (!date) return String(value || "").slice(5);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const firstDate = formatChartDate(points[0].date);
  const lastDate = formatChartDate(points[points.length - 1].date);
  const electionDateLabel = electionDate ? "Election Day" : "";
  const latest = coords[coords.length - 1];
  const latestExtraValue = extraSeries ? extraValue(latest.point) : null;
  const latestExtraY = latestExtraValue === null ? null : yFor(latestExtraValue);
  const closeEndLabels = Math.abs(latest.demY - latest.repY) < 22;
  const demLabelY = closeEndLabels ? latest.demY - 12 : latest.demY <= latest.repY ? latest.demY - 4 : latest.demY + 14;
  const repLabelY = closeEndLabels ? latest.repY + 22 : latest.repY <= latest.demY ? latest.repY - 4 : latest.repY + 14;
  const extraLabelY = latestExtraY === null ? null : latestExtraY - 6;
  const visibleAnnotations = !useFullRunway && hasZoomControls ? [] : (options.annotations || CHART_ANNOTATIONS);
  const annotations = visibleAnnotations.map((annotation) => {
    const index = points.findIndex((point) => point.date === annotation.date);
    if (index === -1) return null;
    const x = coords[index].x;
    if (annotation.marker) {
      const markerY = height - plot.bottom - 8;
      return `<g class="history-annotation history-annotation-compact"><path d="M${x} ${plot.top}V${height - plot.bottom}"></path><text x="${x + 4}" y="${markerY}">${annotation.marker}</text></g>`;
    }
    const labelX = clamp(x + (annotation.align === "right" ? 14 : -12), plot.left + 18, width - plot.right - 18);
    const labelY = plot.top + 96;
    return `<g class="history-annotation"><path d="M${x} ${plot.top}V${height - plot.bottom}"></path><text x="${labelX}" y="${labelY}" transform="rotate(-90 ${labelX} ${labelY})">${annotation.label}</text></g>`;
  }).filter(Boolean).join("");
  const annotationKey = visibleAnnotations.some((annotation) => (
    annotation.marker && points.some((point) => point.date === annotation.date)
  )) ? `<div class="history-annotation-key"><span>*</span> Model reworked</div>` : "";
  const electionX = hasUsableDates && electionDate && electionDate > latestChartDate && useFullRunway ? width - plot.right : null;
  const currentX = hasUsableDates ? latest.x : null;
  const eventMarkers = hasUsableDates ? rawEventMarkers.map((marker) => {
    const markerDate = parseChartDate(marker.date);
    if (!markerDate || markerDate < firstChartDate || markerDate > axisEndDate) return null;
    if (marker.fullOnly && !useFullRunway) return null;
    const x = plot.left + ((markerDate - firstChartDate) / dateSpan) * plotWidth;
    const textX = clamp(x + (marker.align === "left" ? -9 : 9), plot.left + 10, width - plot.right - 10);
    const textY = plot.top + 18;
    const rotation = marker.align === "left" ? -90 : 90;
    return `<g class="${marker.className || "history-event-marker"}"><path d="M${x} ${plot.top}V${height - plot.bottom}"></path><text x="${textX}" y="${textY}" transform="rotate(${rotation} ${textX} ${textY})">${marker.label}</text></g>`;
  }).filter(Boolean).join("") : "";
  const showLastDate = !currentX || Math.abs(currentX - coords[0].x) > 78;
  const backgroundBands = hasUsableDates && electionX ? `
    <rect class="history-runway" x="${currentX}" y="${plot.top}" width="${electionX - currentX}" height="${plotHeight}"></rect>
  ` : "";
  const dataGaps = useFullRunway && hasUsableDates && coords.length > 1 ? (() => {
    const gaps = [];
    const oneDay = 86400000;
    for (let i = 0; i < coords.length - 1; i++) {
      const currentDate = chartDates[i];
      const nextDate = chartDates[i + 1];
      const gapDays = (nextDate - currentDate) / oneDay;
      if (gapDays > 7) {
        const startX = coords[i].x;
        const endX = coords[i + 1].x;
        const gapWidth = endX - startX;
        if (gapWidth > 10) {
          gaps.push({
            x: startX,
            width: gapWidth,
            days: Math.round(gapDays)
          });
        }
      }
    }
    return gaps.map((gap) => `
      <rect class="history-data-gap" x="${gap.x}" y="${plot.top}" width="${gap.width}" height="${plotHeight}"></rect>
      ${gap.width > 40 ? `<text class="history-data-gap-label" x="${gap.x + gap.width / 2}" y="${plot.top + plotHeight / 2}" text-anchor="middle" dominant-baseline="middle">Data lost (${gap.days} days)</text>` : ""}
    `).join("");
  })() : "";
  const dotRadius = options.dotRadius ?? (coords.length === 1 ? 3.2 : 1.8);
  const zoomControls = hasZoomControls && hasUsableDates && electionDate && electionDate > latestChartDate ? `
    <div class="history-zoom-controls ${mobileZoomActive && !options.zoomControls ? "mobile-only" : ""}" aria-label="Chart time range">
      <button type="button" class="${zoomMode !== "full" ? "active" : ""}" data-history-zoom="recent">Recent</button>
      <button type="button" class="${zoomMode === "full" ? "active" : ""}" data-history-zoom="full">Full timeline</button>
    </div>
  ` : "";
  chart.innerHTML = `
    ${zoomControls}
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${options.label}">
      ${backgroundBands}
      ${dataGaps}
      ${ticks.map((tick) => `<path class="history-grid ${tick === (options.midline ?? .5) ? "history-midline" : ""}" d="M${plot.left} ${yFor(tick)}H${width - plot.right}"></path><text class="history-axis" x="${plot.left - 12}" y="${yFor(tick) + 4}">${valueFormat(tick)}</text>`).join("")}
      ${[1, 2, 3, 4, 5].map((step) => {
        const x = plot.left + (plotWidth / 6) * step;
        return `<path class="history-vgrid" d="M${x} ${plot.top}V${height - plot.bottom}"></path>`;
      }).join("")}
      ${currentX ? `<g class="history-current-marker"><path d="M${currentX} ${plot.top}V${height - plot.bottom}"></path></g>` : ""}
      ${eventMarkers}
      ${electionX ? `<g class="history-election-marker"><path d="M${electionX} ${plot.top}V${height - plot.bottom}"></path><text x="${electionX + 9}" y="${plot.top + 16}" transform="rotate(90 ${electionX + 9} ${plot.top + 16})">${electionDateLabel}</text></g>` : ""}
      <path class="history-band ${demBandClass}" d="${areaPath("dem")}"></path>
      <path class="history-band history-band-rep" d="${areaPath("rep")}"></path>
      ${extraSeries ? `<path class="history-band history-band-extra" d="${extraAreaPath()}"></path>` : ""}
      <path class="history-line ${demSeriesClass}" d="${linePath("dem")}"></path>
      <path class="history-line history-line-rep" d="${linePath("rep")}"></path>
      ${extraSeries ? `<path class="history-line ${extraSeries.className}" d="${coords.filter((coord) => extraValue(coord.point) !== null).map((coord, index) => `${index ? "L" : "M"} ${coord.x} ${yFor(extraValue(coord.point))}`).join(" ")}"></path>` : ""}
      ${annotations}
      ${coords.map(({ x, demY, repY }, index) => `<g class="history-point" tabindex="0" data-index="${index}"><circle class="history-dot ${demDotClass}" cx="${x}" cy="${demY}" r="${dotRadius}"></circle><circle class="history-dot history-dot-rep" cx="${x}" cy="${repY}" r="${dotRadius}"></circle></g>`).join("")}
      ${extraSeries ? coords.map(({ x, point }, index) => {
        const value = extraValue(point);
        return value === null ? "" : `<g class="history-extra-point" tabindex="0" data-index="${index}"><circle class="history-dot ${extraSeries.dotClassName}" cx="${x}" cy="${yFor(value)}" r="${dotRadius}"></circle></g>`;
      }).join("") : ""}
      <text class="history-date history-date-start" x="${coords[0].x}" y="${height - 18}">${firstDate}</text>
      ${showLastDate ? `<text class="history-date history-date-end" x="${latest.x}" y="${height - 18}">${lastDate}</text>` : ""}
      <text class="history-end-label ${demEndLabelClass}" x="${latest.x + 11}" y="${demLabelY}">${endLabel("dem", demValue(latest.point))}</text>
      <text class="history-end-label history-end-label-rep" x="${latest.x + 11}" y="${repLabelY}">${endLabel("rep", repValue(latest.point))}</text>
      ${extraSeries && latestExtraY !== null ? `<text class="history-end-label ${extraSeries.labelClassName}" x="${latest.x + 11}" y="${extraLabelY}">${extraSeries.name} ${oneDecimal(latestExtraValue)}</text>` : ""}
      <g class="history-hover" style="display:none">
        <path class="history-hover-rule"></path>
        <circle class="history-hover-dot history-hover-dot-dem ${demHoverDotClass === "history-hover-dot-dem" ? "" : demHoverDotClass}" r="3.2"></circle>
        <circle class="history-hover-dot history-hover-dot-rep" r="3.2"></circle>
        ${extraSeries ? `<circle class="history-hover-dot history-hover-dot-extra" r="3.2"></circle>` : ""}
        <rect class="history-hover-box" width="150" height="${extraSeries ? 72 : 56}" rx="2"></rect>
        <text class="history-hover-title"></text>
        <text class="history-hover-dem ${demHoverTextClass}"></text>
        <text class="history-hover-rep"></text>
        ${extraSeries ? `<text class="history-hover-extra"></text>` : ""}
      </g>
      <rect class="history-overlay" x="${plot.left}" y="${plot.top}" width="${plotWidth}" height="${plotHeight}" tabindex="0"></rect>
    </svg>
    ${annotationKey}
  `;
  const svg = chart.querySelector("svg");
  if (svg) {
    svg.querySelectorAll(".history-line").forEach((path) => {
      try {
        const length = Math.max(1, Math.ceil(path.getTotalLength()));
        path.style.setProperty("--line-length", String(length));
      } catch (error) {
        path.style.setProperty("--line-length", "700");
      }
    });
  }
  chart.querySelectorAll("[data-history-zoom]").forEach((button) => {
    button.addEventListener("click", () => {
      chart.dataset.historyZoom = button.dataset.historyZoom || "recent";
      renderLineChart(chart, points, options);
    });
  });
  const overlay = chart.querySelector(".history-overlay");
  const hover = chart.querySelector(".history-hover");
  const hoverRule = chart.querySelector(".history-hover-rule");
  const hoverDemDot = chart.querySelector(".history-hover-dot-dem");
  const hoverRepDot = chart.querySelector(".history-hover-dot-rep");
  const hoverExtraDot = chart.querySelector(".history-hover-dot-extra");
  const hoverBox = chart.querySelector(".history-hover-box");
  const hoverTitle = chart.querySelector(".history-hover-title");
  const hoverDem = chart.querySelector(".history-hover-dem");
  const hoverRep = chart.querySelector(".history-hover-rep");
  const hoverExtra = chart.querySelector(".history-hover-extra");
  const showIndex = (index) => {
    const coord = coords[clamp(index, 0, coords.length - 1)];
    const dem = demValue(coord.point);
    const rep = repValue(coord.point);
    const extra = extraSeries ? extraValue(coord.point) : null;
    const activeYs = [coord.demY, coord.repY, extra === null ? null : yFor(extra)].filter((value) => value !== null);
    const boxX = clamp(coord.x + 12, plot.left + 4, width - plot.right - 154);
    const boxY = clamp(Math.min(...activeYs) - (extraSeries ? 84 : 68), plot.top + 4, height - plot.bottom - (extraSeries ? 78 : 62));
    hover.style.display = "block";
    hoverRule.setAttribute("d", `M${coord.x} ${plot.top}V${height - plot.bottom}`);
    hoverDemDot.setAttribute("cx", coord.x);
    hoverDemDot.setAttribute("cy", coord.demY);
    hoverRepDot.setAttribute("cx", coord.x);
    hoverRepDot.setAttribute("cy", coord.repY);
    if (extraSeries && hoverExtraDot && extra !== null) {
      hoverExtraDot.setAttribute("cx", coord.x);
      hoverExtraDot.setAttribute("cy", yFor(extra));
    }
    hoverBox.setAttribute("x", boxX);
    hoverBox.setAttribute("y", boxY);
    hoverTitle.setAttribute("x", boxX + 9);
    hoverTitle.setAttribute("y", boxY + 16);
    hoverDem.setAttribute("x", boxX + 9);
    hoverDem.setAttribute("y", boxY + 34);
    hoverRep.setAttribute("x", boxX + 9);
    hoverRep.setAttribute("y", boxY + 48);
    if (extraSeries && hoverExtra && extra !== null) {
      hoverExtra.setAttribute("x", boxX + 9);
      hoverExtra.setAttribute("y", boxY + 62);
      hoverExtra.textContent = `${extraSeries.name} ${oneDecimal(extra)}`;
    }
    hoverTitle.textContent = coord.point.date;
    hoverDem.textContent = hoverLabel("dem", dem);
    hoverRep.textContent = hoverLabel("rep", rep);
  };
  const indexFromEvent = (event) => {
    const rect = svg.getBoundingClientRect();
    const ratio = width / rect.width;
    const x = (event.clientX - rect.left) * ratio;
    return coords.reduce((best, coord, index) => {
      const distance = Math.abs(coord.x - x);
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Infinity }).index;
  };
  overlay.addEventListener("pointerenter", (event) => showIndex(indexFromEvent(event)));
  overlay.addEventListener("pointermove", (event) => showIndex(indexFromEvent(event)));
  overlay.addEventListener("click", (event) => showIndex(indexFromEvent(event)));
  overlay.addEventListener("pointerleave", () => {
    hover.style.display = "none";
  });
  overlay.addEventListener("focus", () => showIndex(points.length - 1));
  chart.querySelectorAll(".history-point").forEach((node) => {
    const handler = () => showIndex(Number(node.dataset.index));
    node.addEventListener("mouseenter", handler);
    node.addEventListener("focus", handler);
    node.addEventListener("click", handler);
  });
}

function renderHistory(race) {
  const chart = document.getElementById("race-history");
  if (!chart) return;
  let points = race.history?.length ? race.history : [{ date: forecast.modelDate, dem: race.demProbability }];
  const bodnar = (race.extraCandidates || []).find((candidate) => candidate.name === "Seth Bodnar");
  if (bodnar) {
    const bodnarHistory = new Map((race.extraHistory || []).map((point) => [point.date, point["Seth Bodnar"]]));
    points = points.map((point) => ({ ...point, extra: bodnarHistory.get(point.date) ?? null }));
  }
  const demIsIndependent = race.demDisplayParty === "I" || race.dem.toLowerCase().includes("independent");
  const demHistoryLabel = demIsIndependent ? candidateDisplayName(race, "D") : "Democrat";
  renderLineChart(chart, points, {
    label: `${race.displayName} probability history`,
    pointHtml: (point) => `${point.date}<br>D ${pct(point.dem)} / R ${pct(1 - point.dem)}`,
    extraSeries: bodnar ? { key: "extra", name: "Seth Bodnar", className: "history-line-extra", dotClassName: "history-dot-extra", labelClassName: "history-end-label-extra", colorLabel: "Seth Bodnar" } : null,
    demSeriesClass: demIsIndependent ? "history-line-ind" : "history-line-dem",
    demBandClass: demIsIndependent ? "history-band-ind" : "history-band-dem",
    demDotClass: demIsIndependent ? "history-dot-ind" : "history-dot-dem",
    demHoverDotClass: demIsIndependent ? "history-hover-dot-ind" : "history-hover-dot-dem",
    demEndLabelClass: demIsIndependent ? "history-end-label-ind" : "history-end-label-dem",
    demHoverTextClass: demIsIndependent ? "history-hover-ind" : "",
    endLabel: demIsIndependent ? (party, value) => `${party === "dem" ? demHistoryLabel : "Republican"} ${oneDecimal(value)}` : null,
    hoverLabel: demIsIndependent ? (party, value) => `${party === "dem" ? demHistoryLabel : "Republican"} ${oneDecimal(value)}` : null,
    annotations: race.state === "MT" ? [...CHART_ANNOTATIONS, ...MONTANA_CHART_ANNOTATIONS] : CHART_ANNOTATIONS,
    eventMarkers: senatePrimaryMarkers(race),
    electionDate: forecast.settings?.electionDate || "2026-11-03",
    mobileZoomControls: true,
    value: (point) => point.dem,
    singleNote: "State history starts with the first generated forecast and grows each daily run."
  });
}

function renderPrimaryPanel(race) {
  const primarySchedule = (race.primaryEvents || []).length
    ? race.primaryEvents.map((event) => `${event.label}${event.conditional ? " if needed" : ""}: ${event.date}`).join(" / ")
    : `${race.primary} / ${race.primaryDate}`;
  setText("race-primary", primarySchedule);
  setText("race-independent", race.independent);
  setText("race-caucus", race.caucusTarget === "D" ? "Counts as Democrat for control if elected" : "Counts as Republican for control");
  setText("race-dem-candidate", race.dem);
  setText("race-rep-candidate", race.rep);
  const extras = (race.extraCandidates || []).map((candidate) => `${candidate.name} (${candidate.note || candidate.party || "additional option"})`).join("; ");
  setText("race-primary-summary", extras ? `${race.primarySummary} Additional tracked option: ${extras}.` : race.primarySummary);
  const demNode = document.getElementById("race-dem-candidate");
  if (demNode && demNode.parentElement) {
    const isIndependent = race.demDisplayParty === "I" || race.dem.toLowerCase().includes("independent");
    demNode.parentElement.classList.toggle("independent-candidate", isIndependent);
    const label = demNode.parentElement.querySelector(".meta");
    if (label) label.textContent = isIndependent ? "Independent" : "Democrat";
  }
}

function renderRaceInputCards(race) {
  const container = document.getElementById("race-input-cards");
  if (!container) return;
  const finance = race.sourceInputs?.openFec;
  const pollCount = race.pollSignal?.pollCount || 0;
  const pollsterCount = race.pollSignal?.pollsters || 0;
  const sourceCount = [
    race.sourceInputs?.twoSeventyToWin,
    race.sourceInputs?.realClearPolling
  ].filter(Boolean).length;
  const inputSnapshot = [
    {
      label: "Polling",
      value: pollWeightLabel(race),
      detail: pollCount ? `${pollCount} usable polls from ${pollsterCount} pollster${pollsterCount === 1 ? "" : "s"}` : "No recent usable public race polls"
    },
    {
      label: "Forecast margin",
      value: signedInputText(race, race.margin),
      detail: "Projected vote margin, not probability margin"
    },
    {
      label: "Rating",
      value: race.rating,
      detail: `${primaryInputText(race)}`
    },
    {
      label: "Money",
      value: financeInputText(race),
      detail: finance ? "Matched campaign-finance signal" : "No matched campaign-finance row"
    },
    {
      label: "Candidate field",
      value: `${candidateDisplayName(race, "D")} / ${candidateDisplayName(race, "R")}`,
      detail: race.primarySummary || "Candidate status tracked"
    },
    {
      label: "Input confidence",
      value: inputQualityText(race),
      detail: (race.uncertaintyBadges || []).slice(0, 2).join(" / ") || "No major data warning"
    }
  ];
  const snapshotCards = inputSnapshot.map((item) => `
    <article class="input-snapshot-card">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </article>
  `).join("");
  const pollRows = [
    `<li>${pollingInputText(race)}</li>`,
    race.pollSignal ? `<li>${pollWeightLabel(race)} from ${race.pollSignal.pollCount} usable poll rows.</li>` : `<li>No usable race-poll signal in this run.</li>`,
    sourceCount ? `<li>${sourceCount} public polling source${sourceCount === 1 ? "" : "s"} contributed race-level rows.</li>` : ""
  ].filter(Boolean).join("");
  const fundamentalRows = [
    `<li>Rating input: ${escapeHtml(race.rating)}</li>`,
    `<li>Baseline margin: ${signedPointMargin(race.margin)}</li>`,
    `<li>Primary risk: ${Number(race.primaryRisk || 0).toFixed(1)} pts</li>`,
    `<li>Incumbency adjustment: ${signedPointMargin(race.incumbencyAdjustment || 0)}</li>`,
    `<li>Candidate-history adjustment: ${signedPointMargin(race.candidateHistoryAdjustment || 0)}</li>`
  ].join("");
  const demFinanceLabel = finance?.demFinanceLabel || "Democratic side";
  const repFinanceLabel = finance?.repFinanceLabel || "Republican side";
  const financeRows = finance ? [
    `<li>Finance signal: ${Number(finance.financeSignal || 0).toFixed(2)} pts</li>`,
    `<li>${escapeHtml(demFinanceLabel)} receipts: $${Math.round(finance.demReceipts || 0).toLocaleString()}</li>`,
    `<li>${escapeHtml(repFinanceLabel)} receipts: $${Math.round(finance.repReceipts || 0).toLocaleString()}</li>`,
    `<li>${escapeHtml(demFinanceLabel)} cash: $${Math.round(finance.demCash || 0).toLocaleString()}</li>`,
    `<li>${escapeHtml(repFinanceLabel)} cash: $${Math.round(finance.repCash || 0).toLocaleString()}</li>`,
    finance.financeTreatment ? `<li>${escapeHtml(finance.financeTreatment)}</li>` : ""
  ].join("") : `<li>No matched OpenFEC state-race finance row in this run.</li>`;
  const candidateRows = [
    `<li>${escapeHtml(candidateDisplayName(race, "D"))}: ${escapeHtml(race.demStatus || "unresolved")}</li>`,
    `<li>${escapeHtml(candidateDisplayName(race, "R"))}: ${escapeHtml(race.repStatus || "unresolved")}</li>`,
    `<li>${escapeHtml(race.primarySummary || "")}</li>`,
    ...(race.extraCandidates || []).map((candidate) => `<li>${escapeHtml(candidate.name)}: ${escapeHtml(candidate.note || candidate.party || "tracked option")}</li>`)
  ].join("");
  const badgeRows = (race.uncertaintyBadges || []).map((badge) => `<li>${escapeHtml(badge)}</li>`).join("");
  const demographic = race.demographicPull;
  const electorate = race.electorateComposition;
  const demographicProfileLabel = (profile) => {
    if (!profile) return "standard";
    if (typeof profile === "string") return profile;
    const source = profile.source === "candidate" ? "candidate profile" : "generic profile";
    return `${profile.label || profile.key || "standard"} (${source})`;
  };
  const blocLabels = {
    white_college: "White college",
    white_noncollege: "White non-college",
    black: "Black",
    latino: "Latino",
    asian_other: "Asian/other",
    youth: "18-29",
    core_age: "30-64",
    senior: "65+"
  };
  const blocLabel = (key) => blocLabels[key] || key.replace(/_/g, " ");
  const electorateRows = electorate ? [
    `<li><strong>Expected electorate:</strong> ${(Object.entries(electorate.raceEducation || {})).map(([key, value]) => `${escapeHtml(blocLabel(key))} ${pct(value)}`).join(" / ")}</li>`,
    `<li><strong>Age overlay:</strong> ${(Object.entries(electorate.age || {})).map(([key, value]) => `${escapeHtml(blocLabel(key))} ${pct(value)}`).join(" / ")}</li>`,
    `<li>${escapeHtml(electorate.source || "Modeled expected-voter composition")}</li>`
  ].join("") : `<li>No expected-electorate composition saved for this race.</li>`;
  const demographicRows = demographic ? [
    electorateRows,
    `<li>Adjustment: ${signedPointMargin(demographic.adjustment || 0)}</li>`,
    `<li>Democratic profile: ${escapeHtml(demographicProfileLabel(demographic.demProfile))}</li>`,
    `<li>Republican profile: ${escapeHtml(demographicProfileLabel(demographic.repProfile))}</li>`,
    ...((demographic.topGroups || []).map((item) => `<li>${escapeHtml(item.label || item.group)}: ${signedPointMargin(item.effect || 0)}</li>`))
  ].join("") : `<li>No separate demographic-pull adjustment in this saved run.</li>`;
  container.innerHTML = `
    ${renderMovementPanel(race)}
    <div class="input-snapshot-grid">${snapshotCards}</div>
    <details><summary>Polling notes</summary><ul>${pollRows}</ul></details>
    <details><summary>Fundamentals</summary><ul>${fundamentalRows}</ul></details>
    <details><summary>Demographic pull</summary><ul>${demographicRows}</ul></details>
    <details><summary>Finance</summary><ul>${financeRows}</ul></details>
    <details><summary>Candidates</summary><ul>${candidateRows}</ul></details>
    <details><summary>Input warnings</summary><ul><li>${inputQualityText(race)}</li>${badgeRows}${(race.inputQuality?.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></details>
  `;
}

function renderRacePage() {
  const page = document.getElementById("race-detail-page");
  if (!page || !forecast) return;
  const state = new URLSearchParams(window.location.search).get("state")?.toUpperCase() || "OH";
  const race = getRace(state) || getRace("OH") || forecast.races[0];
  document.title = `${race.displayName} | Capitol Forecast`;
  setText("race-state", race.state);
  setText("race-name", race.displayName);
  setText("race-incumbent", race.incumbent);
  setText("race-seat", race.seat);
  setText("race-rating", race.rating);
  setText("race-winner", `${candidateForecastName(race, race.winnerParty)} ${pct(race.winnerProbability)}`);
  setText("race-note", race.summary || race.note);
  setText("race-dem", pct(race.demProbability));
  setText("race-rep", pct(1 - race.demProbability));
  const demWinNode = document.getElementById("race-dem");
  if (demWinNode?.parentElement) {
    const label = demWinNode.parentElement.querySelector("dt");
    if (label) label.textContent = `${candidateChanceLabel(race, "D")} win`;
  }
  setText("race-margin", signedPointMargin(race.margin));
  setText("race-prob-margin", signedMargin(race.demProbability));
  setText("race-movement", movementText(race));
  setText("race-input-quality", inputQualityText(race));
  setText("race-tipping", oneDecimal(race.tippingPower));
  setText("race-polling", pollingInputText(race));
  const demTrack = document.getElementById("race-dem-track");
  const repTrack = document.getElementById("race-rep-track");
  if (demTrack && repTrack) {
    demTrack.style.width = `${race.demProbability * 100}%`;
    repTrack.style.width = `${(1 - race.demProbability) * 100}%`;
    demTrack.parentElement?.classList.toggle("independent-track", race.demDisplayParty === "I" || race.dem.toLowerCase().includes("independent"));
  }
  renderHistory(race);
  renderPrimaryPanel(race);
  renderRaceInputCards(race);
}

function renderSourceStatus() {
  const container = document.getElementById("source-status");
  if (!container || !forecast) return;
  const status = forecast.sourceStatus || {};
  const summary = forecast.sourceSummary || {};
  const rows = [
    ["VoteHub polling", status.votehubGenericBallot, `${summary.votehub?.usableGenericBallotPolls ?? 0} usable generic-ballot polls / D ${summary.votehub?.genericBallotMargin?.toFixed?.(1) ?? "--"}`],
    ["Generic blend", status.checkedAt ? { ok: summary.genericPolling?.sources?.length > 0, status: "computed", ms: 0 } : null, `${summary.genericPolling?.sources?.length ?? 0} sources / D ${summary.genericPolling?.genericBallotMargin?.toFixed?.(1) ?? "--"}`],
    ["DDHQ generic ballot", status.ddhqGenericBallot, `${summary.ddhqGeneric?.polls ?? 0} polls / D ${summary.ddhqGeneric?.genericBallotMargin?.toFixed?.(1) ?? "--"}`],
    ["Pollfinity averages", status.pollfinityAverages, `${summary.pollfinity?.genericBallotPolls ?? 0} generic polls / approval net ${summary.pollfinity?.approvalNet?.toFixed?.(1) ?? "--"}`],
    ["USPollingData generic", status.usPollingDataGenericBallot, `D ${summary.usPollingDataGeneric?.genericBallotMargin?.toFixed?.(1) ?? "--"}`],
    ["RealClearPolling", status.realClearPollingSenate, `${summary.realClearPolling?.usablePolls ?? 0} usable race polls / ${summary.realClearPolling?.states ?? 0} states`],
    ["270toWin race polls", status.twoSeventyToWinRacePolls, `${summary.twoSeventyToWin?.usablePolls ?? 0} usable race polls / ${summary.twoSeventyToWin?.states ?? 0} states`],
    ["270toWin latest polls", status.twoSeventyToWinLatestPolls, status.twoSeventyToWinLatestPolls?.ok ? "Reference page reachable" : "Reference page not loaded"],
    ["Race to the WH polls", status.raceToTheWhSenatePolls, status.raceToTheWhSenatePolls?.ok ? "Reference page reachable" : "Reference page not loaded"],
    ["Electoral-Vote CSV", status.electoralVoteSenatePolls, `${status.electoralVoteSenatePolls?.currentCycleRows ?? 0} current poll rows`],
    ["USPollingData Senate", status.usPollingDataSenatePolling, status.usPollingDataSenatePolling?.ok ? "Reference page reachable" : "Reference page not loaded"],
    ["OpenFEC finance", status.openFecCandidateSummary, `${summary.fecStates ?? 0} Senate states`],
    ["Census population", status.censusPopulation, `${summary.censusStates ?? 0} states from no-key CSV`],
    ["Historical results", status.mitSenateReturns, `${summary.mitStates ?? 0} states from MIT/MEDSL; used instead of broken civicAPI endpoints`]
  ];
  container.innerHTML = rows.map(([label, item, detail]) => {
    const ok = Boolean(item?.ok);
    const state = ok ? "Loaded" : item?.status === "missing-key" ? "Needs key" : "Not loaded";
    const meta = item?.ms ? `${item.ms} ms` : item?.status || "";
    return `
      <div class="source-status-card ${ok ? "is-ok" : "is-warn"}">
        <span class="source-tag">${state}</span>
        <h3>${label}</h3>
        <p>${detail}</p>
        <p class="meta">${meta}</p>
      </div>
    `;
  }).join("");
}

function houseDistrictBucket(district) {
  if (!district) return "tossup";
  return RATING_BUCKET[district.rating] || "tossup";
}

function houseDistrictColorLabel(district) {
  if (!district) return "Toss-up";
  return district.rating;
}

function houseRatingOrder(district) {
  const order = Object.keys(RATING_BUCKET);
  const index = order.indexOf(houseDistrictColorLabel(district));
  return index === -1 ? order.indexOf("Toss-up") : index;
}

function compareHouseByCustomRating(a, b) {
  return houseRatingOrder(a) - houseRatingOrder(b)
    || Math.abs(a.margin) - Math.abs(b.margin)
    || a.id.localeCompare(b.id, undefined, { numeric: true });
}

function houseLeaderClass(district) {
  if (!district) return "";
  if (district.rating === "Toss-up") return "leads-tossup";
  return district.winnerParty === "D" ? "leads-dem" : "leads-rep";
}

function houseDistrictLabel(district) {
  return `${district.id} ${district.label || ""}`.trim();
}

function getHouseDistrict(id) {
  const normalized = String(id || "").toUpperCase().replace(/\s+/g, "");
  if (!houseForecast || !normalized) return null;
  const match = normalized.match(/^([A-Z]{2})-?(AL|\d{1,2})$/);
  if (!match) return null;
  const districtId = `${match[1]}-${match[2] === "AL" ? "AL" : String(Number(match[2])).padStart(2, "0")}`;
  return houseForecast.districts.find((district) => district.id === districtId) || null;
}

function houseDistrictMarkup(district) {
  if (!district) return "";
  const winner = district.winnerParty === "D" ? "Democrat" : "Republican";
  const colorLabel = houseDistrictColorLabel(district);
  const inputs = district.sourceInputs || {};
  const nomination = inputs.nomination || {};
  const quality = houseInputConfidence(district);
  const statusText = [
    nomination.demStatus ? `D ${nomination.demStatus}` : null,
    nomination.repStatus ? `R ${nomination.repStatus}` : null,
    nomination.primaryDate || null
  ].filter(Boolean).join(" / ");
  return `
    <span class="race-kicker">${escapeHtml(houseDistrictLabel(district))}</span>
    <div class="map-card-title">
      <div class="state-code">${escapeHtml(district.id)}</div>
      <span class="rating-pill ${houseDistrictBucket(district)}">${escapeHtml(colorLabel)}</span>
    </div>
    <h3>${winner} ${houseProbability(district.winnerProbability)}</h3>
    <div class="candidate-table" aria-label="${district.id} district forecast">
      <div class="candidate-table-head"><span>Candidate</span><span>Chance</span></div>
      <div class="candidate-row dem-row"><span>${escapeHtml(district.demCandidate || "Democrat")} <i class="party-badge dem-badge">D</i></span><strong>${houseProbability(district.demProbability)}</strong></div>
      <div class="candidate-row rep-row"><span>${escapeHtml(district.repCandidate || "Republican")} <i class="party-badge rep-badge">R</i></span><strong>${houseProbability(district.repProbability)}</strong></div>
      <div class="candidate-margin"><span>Projected margin</span><strong>${signedPointMargin(district.margin)}</strong></div>
    </div>
    <div class="badge-row">
      <span>${escapeHtml(quality.label)}</span>
      <span>${escapeHtml(houseMovementText(district))}</span>
      ${statusText ? `<span>${escapeHtml(statusText)}</span>` : ""}
    </div>
    <div class="house-signal-grid" aria-label="House district model signals">
      <div><span>Rating</span><strong>${signedPointMargin(inputs.ratingBaseline)}</strong></div>
      <div><span>Context</span><strong>${signedPointMargin(inputs.contextualBaseline)}</strong></div>
      <div><span>Generic</span><strong>${signedPointMargin(inputs.genericBallotShift)}</strong></div>
      <div><span>Profile</span><strong>${signedPointMargin(inputs.candidateQualityAdjustment ?? inputs.demographicPull?.adjustment)}</strong></div>
    </div>
    <details class="house-card-details">
      <summary>Model detail</summary>
      <p>${escapeHtml(district.sourceBlend || "Cook")} / ${district.open ? "open seat" : "incumbent seat"}</p>
      <p>2024 pres ${signedPointMargin(inputs.presidentialBaseline)} / 2022 House ${signedPointMargin(inputs.congressionalBaseline)} / demographic ${signedPointMargin(inputs.demographicPull?.adjustment)}</p>
      ${nomination.summary ? `<p>${escapeHtml(nomination.summary)}</p>` : ""}
      ${inputs.demographicPull?.topGroups?.length ? `<p>Demographic pull: ${inputs.demographicPull.topGroups.map((item) => `${escapeHtml(item.label || item.group)} ${signedPointMargin(item.effect)}`).join(" / ")}</p>` : ""}
    </details>
  `;
}

function controlProbabilityPhrase(probability) {
  if (probability >= .9) return "strongly favored";
  if (probability >= .75) return "clearly favored";
  if (probability >= .6) return "favored";
  return "narrowly favored";
}

function updateHouseDistrictCard(district) {
  if (district?.id) selectedHouseDistrictId = district.id;
  const card = document.getElementById("house-district-card");
  if (card) card.innerHTML = houseDistrictMarkup(district);
  highlightHouseShapeSelection();
}

function highlightHouseShapeSelection() {
  document.querySelectorAll("#house-shape-map .district-shape").forEach((node) => {
    node.classList.toggle("is-selected", Boolean(selectedHouseDistrictId && node.dataset.district === selectedHouseDistrictId));
  });
}

function renderHouseViewModeControls() {
  const container = document.getElementById("house-view-mode-controls");
  if (!container) return;
  container.innerHTML = Object.entries(HOUSE_VIEW_MODES).map(([mode, label]) => (
    `<button type="button" class="${mode === houseViewMode ? "active" : ""}" data-house-view="${mode}">${label}</button>`
  )).join("");
  container.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      houseViewMode = button.dataset.houseView || "shape";
      renderHouseViewModeControls();
      applyHouseViewMode();
      if (houseViewMode === "shape") renderHouseShapeMap();
    });
  });
}

function applyHouseViewMode() {
  const isShape = houseViewMode === "shape";
  const isBoard = houseViewMode === "board";
  const isList = houseViewMode === "list";
  const toolbar = document.getElementById("house-map-toolbar");
  const shape = document.getElementById("house-shape-map");
  const board = document.getElementById("house-district-cartogram");
  const list = document.getElementById("house-district-list");
  if (toolbar) toolbar.hidden = !isShape;
  if (shape) shape.hidden = !isShape;
  if (board) board.hidden = !isBoard;
  if (list) list.hidden = !isList;
  if (toolbar) toolbar.style.display = isShape ? "" : "none";
  if (shape) shape.style.display = isShape ? "" : "none";
  if (board) board.style.display = isBoard ? "" : "none";
  if (list) list.style.display = isList ? "" : "none";
}

function projectedRingPath(ring, projection) {
  const points = ring
    .map((point) => projection(point))
    .filter(Boolean);
  if (points.length < 3) return "";
  return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join("")}Z`;
}

function projectedFeaturePath(feature, projection) {
  const geometry = feature?.geometry;
  if (!geometry) return "";
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates || [];
  return polygons
    .flatMap((polygon) => polygon.map((ring) => projectedRingPath(ring, projection)))
    .filter(Boolean)
    .join("");
}

async function renderHouseShapeMap() {
  const container = document.getElementById("house-shape-map");
  if (!container || !houseForecast || houseViewMode !== "shape") return;
  if (!window.d3) {
    container.innerHTML = `<p class="map-note">Shape map rendering needs D3 to load.</p>`;
    return;
  }

  let geo;
  try {
    geo = houseShapeGeo || await loadHouseDistrictShapes();
  } catch (error) {
    container.innerHTML = `<p class="map-note">House district shape map could not load. ${escapeHtml(error.message || "")}</p>`;
    return;
  }

  let statesGeo;
  try {
    statesGeo = usStatesGeo || await loadUsStatesShapes();
  } catch (error) {
    console.warn("US states background could not load:", error);
  }

  const districtById = new Map(houseForecast.districts.map((district) => [district.id, district]));
  const width = 980;
  const height = 610;
  const projection = d3.geoAlbersUsa().fitSize([width, height], statesGeo?.features ? statesGeo : geo);

  container.innerHTML = "";
  const svg = d3.select(container)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Interactive 119th Congressional District shape map");
  const layer = svg.append("g");

  const zoom = d3.zoom()
    .scaleExtent([1, 8])
    .on("zoom", (event) => {
      layer.attr("transform", event.transform);
    });
  svg.call(zoom);

  if (statesGeo && statesGeo.features) {
    layer.selectAll(".state-border")
      .data(statesGeo.features || [])
      .join("path")
      .attr("class", "state-border")
      .attr("d", (feature) => projectedFeaturePath(feature, projection))
      .attr("fill", "none")
      .attr("stroke", "#ccc")
      .attr("stroke-width", "1")
      .attr("pointer-events", "none");
  }

  layer.selectAll(".district-shape")
    .data(geo.features || [])
    .join("path")
    .attr("class", (feature) => {
      const district = districtById.get(feature.properties?.id);
      return district ? `district-shape ${houseDistrictBucket(district)} ${houseLeaderClass(district)}` : "district-shape state-muted";
    })
    .attr("data-district", (feature) => feature.properties?.id || "")
    .attr("d", (feature) => projectedFeaturePath(feature, projection))
    .attr("fill-rule", "evenodd")
    .attr("fill", (feature) => {
      const district = districtById.get(feature.properties?.id);
      return district ? colorForRating(houseDistrictColorLabel(district)) : null;
    })
    .attr("tabindex", (feature) => districtById.has(feature.properties?.id) ? 0 : -1)
    .attr("aria-label", (feature) => {
      const district = districtById.get(feature.properties?.id);
      return district ? `${houseDistrictLabel(district)}, ${houseDistrictColorLabel(district)}` : `${feature.properties?.stateName || "District"} not modeled`;
    })
    .on("mouseenter focus", (event, feature) => {
      const district = districtById.get(feature.properties?.id);
      if (district) updateHouseDistrictCard(district);
    })
    .on("click keydown", (event, feature) => {
      if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
      const district = districtById.get(feature.properties?.id);
      if (district) updateHouseDistrictCard(district);
    })
    .append("title")
    .text((feature) => {
      const district = districtById.get(feature.properties?.id);
      return district ? `${houseDistrictLabel(district)}: ${houseDistrictColorLabel(district)}` : `${feature.properties?.stateName || "District"} not modeled`;
    });

  const zoomStep = 1.45;
  const zoomIn = document.getElementById("house-map-zoom-in");
  const zoomOut = document.getElementById("house-map-zoom-out");
  const reset = document.getElementById("house-map-reset");
  if (zoomIn) zoomIn.onclick = () => svg.transition().duration(180).call(zoom.scaleBy, zoomStep);
  if (zoomOut) zoomOut.onclick = () => svg.transition().duration(180).call(zoom.scaleBy, 1 / zoomStep);
  if (reset) reset.onclick = () => svg.transition().duration(180).call(zoom.transform, d3.zoomIdentity);

  highlightHouseShapeSelection();
}

function renderHouseCartogram() {
  const container = document.getElementById("house-district-cartogram");
  if (!container || !houseForecast) return;
  const districts = [...houseForecast.districts].sort(compareHouseByCustomRating);
  container.innerHTML = districts.map((district) => `
    <button class="district-cell ${houseDistrictBucket(district)} ${houseLeaderClass(district)}"
      type="button"
      aria-label="${escapeHtml(houseDistrictLabel(district))}, ${escapeHtml(houseDistrictColorLabel(district))}"
      data-district="${escapeHtml(district.id)}"
      style="background:${colorForRating(houseDistrictColorLabel(district))}"
      title="${escapeHtml(houseDistrictLabel(district))}">
      <span>${escapeHtml(district.id.replace("-", ""))}</span>
    </button>
  `).join("");
  container.querySelectorAll(".district-cell").forEach((node) => {
    const district = houseForecast.districts.find((item) => item.id === node.dataset.district);
    const handler = () => updateHouseDistrictCard(district);
    node.addEventListener("mouseenter", handler);
    node.addEventListener("focus", handler);
    node.addEventListener("click", handler);
  });
  updateHouseDistrictCard(houseForecast.districts.find((district) => district.id === selectedHouseDistrictId) || districts[0]);
}

function renderHouseDistrictList() {
  const container = document.getElementById("house-district-list");
  if (!container || !houseForecast) return;
  const districts = [...houseForecast.districts].sort(compareHouseByCustomRating);
  container.innerHTML = districts.map((district) => `
    <button class="district-list-row ${houseLeaderClass(district)}" type="button" data-district="${escapeHtml(district.id)}">
      <strong>${escapeHtml(district.id)}</strong>
      <span>${escapeHtml(district.label || (district.open ? "Open seat" : ""))}</span>
      <b class="rating-pill ${houseDistrictBucket(district)}">${escapeHtml(houseDistrictColorLabel(district))}</b>
      <em>${district.winnerParty === "D" ? "D" : "R"} ${houseProbability(district.winnerProbability)}</em>
      <i>${signedPointMargin(district.margin)}</i>
    </button>
  `).join("");
  container.querySelectorAll(".district-list-row").forEach((node) => {
    const district = houseForecast.districts.find((item) => item.id === node.dataset.district);
    const handler = () => updateHouseDistrictCard(district);
    node.addEventListener("mouseenter", handler);
    node.addEventListener("focus", handler);
    node.addEventListener("click", handler);
  });
  updateHouseDistrictCard(houseForecast.districts.find((district) => district.id === selectedHouseDistrictId) || districts[0]);
}

function renderHouseLegend() {
  const legend = document.getElementById("house-rating-legend");
  if (!legend) return;
  legend.innerHTML = spectrumLegendHtml();
}

function renderHouseSummary() {
  if (!houseForecast) return;
  const favoredIsDem = houseForecast.demControlProbability >= houseForecast.repControlProbability;
  const favoredSide = favoredIsDem ? "Democrats" : "Republicans";
  const favoredProbability = Math.max(houseForecast.demControlProbability, houseForecast.repControlProbability);
  const panel = document.getElementById("house-odds-panel");
  panel?.classList.toggle("control-dem", favoredIsDem);
  panel?.classList.toggle("control-rep", !favoredIsDem);
  const odds = document.getElementById("house-odds-phrase");
  if (odds) odds.innerHTML = `<span>${favoredSide} favored</span><strong>${houseProbability(favoredProbability)}</strong>`;
  const houseDemSeats = Number(houseForecast.medianSeats || 0);
  const houseRepSeats = Math.max(0, 435 - houseDemSeats);
  setText("house-seat-count-headline", `${houseDemSeats} D / ${houseRepSeats} R projected seats`);
  setText("house-control-headline", `${favoredSide} ${controlProbabilityPhrase(favoredProbability)}`);
  setText("house-dem-control", houseProbability(houseForecast.demControlProbability));
  setText("house-rep-control", houseProbability(houseForecast.repControlProbability));
  setText("house-median-seats", `${houseDemSeats} D / ${houseRepSeats} R`);
  setText("house-run-date", houseForecast.runDate || houseForecast.modelDate || "--");
  const houseSeatbarLabel = document.getElementById("house-map-seatbar-label");
  if (houseSeatbarLabel) {
    houseSeatbarLabel.innerHTML = `<em>${houseDemSeats} D</em><em>${houseRepSeats} R</em>`;
  }
  const houseSeatbarDem = document.getElementById("house-map-seatbar-dem");
  const houseSeatbarRep = document.getElementById("house-map-seatbar-rep");
  if (houseSeatbarDem) {
    houseSeatbarDem.style.width = `${(houseDemSeats / 435) * 100}%`;
    houseSeatbarDem.style.setProperty("--seat-units", Math.max(1, houseDemSeats));
  }
  if (houseSeatbarRep) {
    houseSeatbarRep.style.width = `${(houseRepSeats / 435) * 100}%`;
    houseSeatbarRep.style.setProperty("--seat-units", Math.max(1, houseRepSeats));
  }
  const demBar = document.getElementById("house-dem-control-bar");
  const repBar = document.getElementById("house-rep-control-bar");
  if (demBar && repBar) {
    demBar.style.width = `${houseForecast.demControlProbability * 100}%`;
    repBar.style.width = `${houseForecast.repControlProbability * 100}%`;
  }
  setMapProbBar("house", houseForecast.demControlProbability, houseForecast.repControlProbability, "Control");
}

function renderHouseSeatHistogram() {
  const container = document.getElementById("house-seat-histogram");
  if (!container || !houseForecast) return;
  const seats = Object.keys(houseForecast.seatCounts || {}).map(Number);
  const center = houseForecast.medianSeats || 218;
  const minSeat = Math.max(200, center - 7);
  const maxSeat = Math.min(235, center + 7);
  renderSeatHistogramInto(container, houseForecast, { minSeat, maxSeat });
}

function renderHouseControlHistory() {
  const chart = document.getElementById("house-control-history-chart");
  if (!chart || !houseForecast) return;
  const points = houseForecast.controlHistory?.length ? houseForecast.controlHistory : [{ date: houseForecast.modelDate, dem: houseForecast.demControlProbability, rep: houseForecast.repControlProbability }];
  renderLineChart(chart, points, {
    label: "House control probability history",
    pointHtml: (point) => `${point.date}<br>D ${pct(point.dem)} / R ${pct(point.rep ?? 1 - point.dem)}`,
    value: (point) => point.dem,
    electionDate: "2026-11-03",
    mobileZoomControls: true
  });
}

function renderHouseSeatHistory() {
  const chart = document.getElementById("house-seat-history-chart");
  if (!chart || !houseForecast) return;
  const points = houseForecast.seatHistory?.length ? houseForecast.seatHistory : [{ date: houseForecast.modelDate, dem: houseForecast.medianSeats, rep: 435 - houseForecast.medianSeats }];
  const values = points.flatMap((point) => [point.dem, point.rep ?? 435 - point.dem]);
  const min = Math.max(190, Math.floor((Math.min(...values) - 5) / 5) * 5);
  const max = Math.min(245, Math.ceil((Math.max(...values) + 5) / 5) * 5);
  const midpoint = 217.5;
  const ticks = Array.from(new Set([max, Math.round((max + midpoint) / 2), midpoint, Math.round((min + midpoint) / 2), min]));
  renderLineChart(chart, points, {
    label: "Projected House seats history",
    pointHtml: (point) => `${point.date}<br>D ${point.dem} / R ${point.rep ?? 435 - point.dem}`,
    value: (point) => point.dem,
    domain: [min, max],
    ticks,
    midline: midpoint,
    band: 3,
    valueFormat: (value) => Number.isInteger(value) ? String(value) : value.toFixed(1),
    endLabel: (party, value) => `${party === "dem" ? "Democrat" : "Republican"} ${Math.round(value)}`,
    hoverLabel: (party, value) => `${party === "dem" ? "Democrat" : "Republican"} ${Math.round(value)}`,
    electionDate: "2026-11-03"
  });
}

function renderHouseDecisiveDistricts() {
  const container = document.getElementById("house-decisive-districts");
  if (!container || !houseForecast) return;
  const ranked = houseForecast.decisiveDistricts || [];
  const max = Math.max(...ranked.map((district) => district.leverage || 0), .01);
  container.innerHTML = ranked.map((district) => {
    const width = clamp(((district.leverage || 0) / max) * 100, 8, 100);
    return `<button class="leverage-row ${houseLeaderClass(district)}" type="button" data-district="${escapeHtml(district.id)}" data-tip="${escapeHtml(houseDistrictLabel(district))}<br>${houseProbability(district.winnerProbability)} ${district.winnerParty === "D" ? "Democrat" : "Republican"}<br>${escapeHtml(district.rating)}"><strong>${escapeHtml(district.id)}</strong><i style="width:${width}%"></i><span>${oneDecimal(district.leverage || 0)}</span></button>`;
  }).join("");
  container.querySelectorAll(".leverage-row").forEach((node) => {
    const district = houseForecast.districts.find((item) => item.id === node.dataset.district);
    node.addEventListener("mouseenter", () => updateHouseDistrictCard(district));
    node.addEventListener("focus", () => updateHouseDistrictCard(district));
    node.addEventListener("click", () => updateHouseDistrictCard(district));
  });
  bindPanelTooltipFor(container, ".leverage-row", (node) => node.dataset.tip);
}

function renderHouseControlPath() {
  const container = document.getElementById("house-control-path");
  if (!container || !houseForecast) return;
  const dem = houseForecast.controlPaths?.dem || {};
  const rep = houseForecast.controlPaths?.rep || {};
  container.innerHTML = `
    <div>
      <h3>Democratic-control simulations</h3>
      <div class="path-stat-grid">
        <div><span>Toss-up districts won</span><strong>${dem.tossupWins ?? "--"}</strong></div>
        <div><span>Tilt R districts won</span><strong>${dem.tiltRWins ?? "--"}</strong></div>
        <div><span>Lean R districts won</span><strong>${dem.leanRWins ?? "--"}</strong></div>
        <div><span>Vulnerable D seats held</span><strong>${dem.vulnerableDHolds ?? "--"}</strong></div>
      </div>
    </div>
    <div>
      <h3>Republican-control simulations</h3>
      <div class="path-stat-grid">
        <div><span>Toss-up districts won</span><strong>${rep.tossupWins ?? "--"}</strong></div>
        <div><span>Tilt D districts won</span><strong>${rep.tiltDWins ?? "--"}</strong></div>
        <div><span>Lean D districts won</span><strong>${rep.leanDWins ?? "--"}</strong></div>
        <div><span>Vulnerable R seats held</span><strong>${rep.vulnerableRHolds ?? "--"}</strong></div>
      </div>
    </div>
  `;
}

function renderHouseDistrictHistoryInto(target, district) {
  if (!target || !district) return;
  const points = district.history?.length ? district.history : [{ date: houseForecast.modelDate, dem: district.demProbability, rep: district.repProbability }];
  renderLineChart(target, points, {
    label: `${district.id} probability history`,
    pointHtml: (point) => `${point.date}<br>D ${pct(point.dem)} / R ${pct(point.rep ?? 1 - point.dem)}`,
    value: (point) => point.dem,
    electionDate: "2026-11-03",
    mobileZoomControls: true
  });
}

function renderHouseSourceStatus() {
  const container = document.getElementById("house-source-status");
  if (!container || !houseForecast) return;
  const status = houseForecast.sourceStatus || {};
  const summary = houseForecast.sourceSummary || {};
  const rows = [
    ["Cook House ratings", status.cookHouseRatings, `${summary.cookDistricts ?? 0} districts`],
    ["Inside / 270toWin", status.insideElections270ToWinRatings, `${summary.insideRatings ?? 0} district ratings`],
    ["House polls", status.twoSeventyToWinHousePolls, summary.housePollingReferenceReachable ? "Reference page reachable" : "Reference page not loaded"],
    ["Race to the WH", status.raceToTheWhHouseForecast, summary.raceToTheWhHouseReachable ? "House page reachable" : "House page not loaded"],
    ["RttWH generic", status.raceToTheWhGenericBallot, summary.raceToTheWhGenericReachable ? "Generic page reachable" : "Generic page not loaded"],
    ["RealClearPolling", status.realClearPoliticsGenericBallot || status.realClearPollingHousePolls, summary.realClearGenericReachable || summary.realClearHousePollsReachable ? "Reference page reachable" : "Blocked or not loaded"],
    ["OpenFEC House", status.openFecHouseCandidateSummary, `${summary.fecDistricts ?? 0} districts`],
    ["Generic ballot", status.senateGenericPollingFallback || status.votehubGenericBallot, `${summary.genericPolling?.sources?.length ?? 0} sources / D ${summary.genericPolling?.margin?.toFixed?.(1) ?? "--"}`],
    ["Census districts", status.censusDistrictBoundaries, houseForecast.mapBasis?.districtShapeMapStatus || "--"],
    ["Redistricting layer", { ok: Boolean(summary.redistricting) }, `${summary.redistricting?.overriddenDistricts?.length ?? 0} local district overrides / ${Object.keys(summary.redistricting?.states || {}).length} states tracked`]
  ];
  container.innerHTML = rows.map(([label, item, detail]) => {
    const ok = Boolean(item?.ok);
    return `
      <div class="source-status-card ${ok ? "is-ok" : "is-warn"}">
        <span class="source-tag">${ok ? "Loaded" : "Not loaded"}</span>
        <h3>${label}</h3>
        <p>${detail}</p>
        <p class="meta">${item?.ms ? `${item.ms} ms` : item?.status || ""}</p>
      </div>
    `;
  }).join("");
}

function renderCalibrationPage() {
  const buckets = document.getElementById("calibration-buckets");
  const backtest = document.getElementById("historical-backtest-status");
  const archivedBuckets = document.getElementById("archived-backtest-buckets");
  const archivedWorst = document.getElementById("archived-backtest-worst");
  if (!forecast || (!buckets && !backtest && !archivedBuckets && !archivedWorst)) return;
  const calibration = forecast.calibration || {};
  const rows = calibration.buckets || [];
  if (buckets) {
    buckets.innerHTML = `
      <table>
        <thead>
          <tr><th>Forecast bucket</th><th>Expected win rate</th><th>Historical win rate</th><th>Sample</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.label)}</td>
              <td>${oneDecimal(row.expectedWinRate)}</td>
              <td>${row.actualWinRate === null ? "--" : oneDecimal(row.actualWinRate)}</td>
              <td>${row.sample}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p class="meta">${escapeHtml(calibration.note || "")}</p>
    `;
  }
  setText("calibration-sample", `${calibration.sample ?? "--"} races`);
  setText("calibration-brier", Number.isFinite(calibration.meanBrier) ? calibration.meanBrier.toFixed(3) : "--");
  setText("calibration-margin-error", Number.isFinite(calibration.meanAbsoluteMarginError) ? `${calibration.meanAbsoluteMarginError.toFixed(1)} pts` : "--");
  const historical = calibration.historicalBacktest || {};
  if (backtest) {
    backtest.innerHTML = `
      <div class="backtest-card ${historical.status === "ready" ? "is-ok" : "is-warn"}">
        <strong>${escapeHtml(historical.label || "Historical backtest")}</strong>
        <span>${escapeHtml(historical.status || "not-ready")}</span>
        <p>${escapeHtml(historical.note || "")}</p>
        <p class="meta">Target cycles: ${(historical.cyclesTargeted || []).join(", ") || "--"} / archived cycles: ${(historical.availableCycles || []).join(", ") || "none yet"} / sample: ${historical.sample ?? 0}</p>
      </div>
    `;
  }
  if (archivedBuckets) {
    const archivedRows = historical.buckets || [];
    archivedBuckets.innerHTML = `
      <table>
        <thead>
          <tr><th>Forecast bucket</th><th>Expected win rate</th><th>Actual win rate</th><th>Sample</th></tr>
        </thead>
        <tbody>
          ${archivedRows.map((row) => `
            <tr>
              <td>${escapeHtml(row.label)}</td>
              <td>${oneDecimal(row.expectedWinRate)}</td>
              <td>${row.actualWinRate === null ? "--" : oneDecimal(row.actualWinRate)}</td>
              <td>${row.sample}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p class="meta">Archived-input sample, not the current-cycle diagnostic.</p>
    `;
  }
  if (archivedWorst) {
    const worstRows = historical.worstRaces || [];
    const max = Math.max(...worstRows.map((row) => row.marginMiss || 0), 1);
    archivedWorst.innerHTML = worstRows.map((row) => {
      const width = clamp(((row.marginMiss || 0) / max) * 100, 12, 100);
      const notes = row.explanation?.length ? row.explanation.join("; ") : "No specific driver identified.";
      return `
        <div class="calibration-miss-row">
          <div class="leverage-row"><strong>${escapeHtml(`${row.cycle} ${row.state}`)}</strong><i style="width:${width}%"></i><span>${Number(row.marginMiss || 0).toFixed(1)}</span></div>
          <p>${escapeHtml(row.rating)} / ${escapeHtml(row.favorite)} ${oneDecimal(row.probability)} / ${escapeHtml(notes)}</p>
        </div>
      `;
    }).join("");
  }
  const breakdowns = document.getElementById("calibration-breakdowns");
  if (breakdowns) {
    const rows = calibration.breakdowns || [];
    breakdowns.innerHTML = `
      <table>
        <thead>
          <tr><th>Race type</th><th>Sample</th><th>Brier</th><th>Mean margin miss</th></tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.label)}</td>
              <td>${row.sample}</td>
              <td>${row.meanBrier === null ? "--" : row.meanBrier.toFixed(3)}</td>
              <td>${row.meanAbsoluteMarginError === null ? "--" : `${row.meanAbsoluteMarginError.toFixed(1)} pts`}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }
  const worst = document.getElementById("calibration-worst");
  if (worst) {
    const max = Math.max(...(calibration.worstStates || []).map((row) => row.absoluteMarginError || 0), 1);
    worst.innerHTML = (calibration.worstStates || []).map((row) => {
      const width = clamp(((row.absoluteMarginError || 0) / max) * 100, 12, 100);
      const notes = row.explanation?.notes?.length ? row.explanation.notes.join("; ") : "No specific driver identified.";
      return `
        <div class="calibration-miss-row">
          <div class="leverage-row"><strong>${escapeHtml(row.state)}</strong><i style="width:${width}%"></i><span>${Number(row.absoluteMarginError || 0).toFixed(1)}</span></div>
          <p>${escapeHtml(notes)}</p>
        </div>
      `;
    }).join("");
  }
}

function renderHousePage() {
  renderHouseSummary();
  renderHouseViewModeControls();
  applyHouseViewMode();
  renderHouseShapeMap();
  renderHouseCartogram();
  renderHouseDistrictList();
  renderHouseLegend();
  renderHouseControlHistory();
  renderHouseSeatHistory();
  renderHouseSeatHistogram();
  renderHouseDecisiveDistricts();
  renderHouseControlPath();
  renderHouseSourceStatus();
}

function renderBattlegroundList() {
  const container = document.getElementById("battleground-list");
  if (!container || !forecast) return;
  const races = [...forecast.races]
    .sort((a, b) => b.tippingPower - a.tippingPower);
  container.innerHTML = races.map((race) => {
    const leader = candidateForecastName(race, race.winnerParty);
    const leaderClass = leaderClassForRace(race);
    return `
      <a class="race-board-row ${leaderClass}" href="race.html?state=${race.state}">
        <strong>${escapeHtml(race.state)}</strong>
        <span>${escapeHtml(race.displayName.replace(" Senate", ""))}</span>
        <span>${escapeHtml(race.rating)}</span>
        <span>${leader} ${pct(race.winnerProbability)}</span>
        <span>${compactMovementText(race)}</span>
        <span>${inputQualityText(race)}</span>
        <span>${oneDecimal(race.tippingPower)}</span>
      </a>
    `;
  }).join("");
}

function sortedArticles() {
  return [...articles].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function articleUrl(article) {
  return `article.html?slug=${encodeURIComponent(article.slug)}`;
}

function articleLeadImage(article) {
  const raw = article.image || article.thumbnail || article.heroImage || article.coverImage || null;
  if (!raw) return null;
  if (typeof raw === "string") return { url: raw, alt: article.title || "Article image" };
  return raw;
}

function articleLeadImageMarkup(article, className = "article-lead-image") {
  const image = articleLeadImage(article);
  const url = safeArticleImageUrl(image?.url || image?.src);
  if (!url) return "";
  return `<img class="${className}" src="${escapeHtml(url)}" alt="${escapeHtml(image.alt || article.title || "Article image")}" loading="lazy">`;
}

function renderTopArticle() {
  const container = document.getElementById("top-article");
  if (!container) return;
  if (!articles.length) {
    container.innerHTML = `
      <p class="meta">Latest article</p>
      <h2 id="top-article-title">No articles yet.</h2>
      <p>Published writing will appear here once articles are added.</p>
      <a class="button-link" href="articles.html">See all articles</a>
    `;
    return;
  }
  const article = sortedArticles().find((item) => item.featured) || sortedArticles()[0];
  container.innerHTML = `
    ${articleLeadImageMarkup(article, "article-teaser-image")}
    <p class="meta">${escapeHtml(article.date)} / ${escapeHtml(article.author || "Federal Elections Analysis")}</p>
    <h2 id="top-article-title"><a href="${articleUrl(article)}">${escapeHtml(article.title)}</a></h2>
    <p>${escapeHtml(article.dek || "")}</p>
    <a class="button-link" href="${articleUrl(article)}">Read article</a>
  `;
}

function renderHomeArticleList() {
  const container = document.getElementById("home-article-list");
  if (!container) return;
  const list = sortedArticles().slice(0, 6);
  container.innerHTML = list.length ? list.map((article) => `
    <a href="${articleUrl(article)}">
      ${articleLeadImageMarkup(article, "home-article-thumb")}
      <strong>${escapeHtml(article.title)}</strong>
      <span>${escapeHtml(article.date)}</span>
    </a>
  `).join("") : `<p class="meta">No articles yet.</p>`;
}

function renderArticlesList() {
  const container = document.getElementById("articles-list");
  if (!container) return;
  const list = sortedArticles();
  container.innerHTML = list.length ? list.map((article) => `
    <article class="article-card">
      ${articleLeadImageMarkup(article, "article-card-image")}
      <p class="meta">${escapeHtml(article.date)} / ${escapeHtml(article.author || "Federal Elections Analysis")}</p>
      <h2><a href="${articleUrl(article)}">${escapeHtml(article.title)}</a></h2>
      <p>${escapeHtml(article.dek || "")}</p>
    </article>
  `).join("") : `<article class="article-card"><h2>No articles yet.</h2><p>Published writing will appear here once articles are added.</p></article>`;
}

function renderArticlePage() {
  const container = document.getElementById("article-page");
  if (!container) return;
  const slug = new URLSearchParams(window.location.search).get("slug") || sortedArticles()[0]?.slug;
  const article = articles.find((item) => item.slug === slug);
  if (!article) {
    container.innerHTML = `<p class="kicker">Article</p><h1>Article not found.</h1><p><a class="button-link" href="articles.html">Back to articles</a></p>`;
    return;
  }
  document.title = `${article.title} | Federal Elections Analysis`;
  container.innerHTML = `
    <p class="kicker">Article</p>
    <h1>${escapeHtml(article.title)}</h1>
    <p class="lede">${escapeHtml(article.dek || "")}</p>
    <p class="meta">${escapeHtml(article.date)} / ${escapeHtml(article.author || "Federal Elections Analysis")}</p>
    ${articleLeadImageMarkup(article, "article-hero-image")}
    <div id="article-body" class="article-body"></div>
    <p><a class="button-link" href="articles.html">Back to articles</a></p>
  `;
  renderArticleBody(article);
}

function renderArticleBody(article) {
  const container = document.getElementById("article-body");
  if (!container) return;
  const blocks = Array.isArray(article.content) ? article.content : legacyArticleBlocks(article);
  container.innerHTML = blocks.map((block, index) => {
    if (typeof block === "string") return `<p>${escapeHtml(block)}</p>`;
    if (block.type === "paragraph") return `<p>${escapeHtml(block.text || "")}</p>`;
    if (block.type === "image") return articleImageMarkup(block);
    if (block.type === "external-embed") return articleExternalEmbedMarkup(block);
    if (block.type === "embed") {
      const embed = block.embed || block;
      const previewTypes = ["state-card", "state-preview", "map-preview", "map-state", "house-district", "house-district-preview", "house-race", "district-preview", "president-state-preview", "president-state", "president-map-preview"];
      const previewClass = previewTypes.includes(embed.type) ? " article-embed-state-preview" : "";
      return `
        <section class="article-embed chart-panel article-embed-${escapeHtml(embed.size || "small")}${previewClass}" data-block-index="${index}">
          <span class="chart-label">${escapeHtml(embed.title || embedTitle(embed))}</span>
          <div class="article-embed-target"></div>
        </section>
      `;
    }
    return "";
  }).join("");

  container.querySelectorAll(".article-embed").forEach((node) => {
    const block = blocks[Number(node.dataset.blockIndex)];
    const embed = block.embed || block;
    const target = node.querySelector(".article-embed-target");
    renderEmbed(target, embed);
  });
}

function safeArticleImageUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^(https?:)?\/\//i.test(url) || /^assets\//i.test(url) || /^data\/article-images\//i.test(url)) return url;
  return "";
}

function articleImageMarkup(block) {
  const url = safeArticleImageUrl(block.url || block.src);
  if (!url) return "";
  const size = ["small", "medium", "large", "full"].includes(block.size) ? block.size : "medium";
  const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : "";
  return `
    <figure class="article-image article-image-${escapeHtml(size)}">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt || block.caption || "")}" loading="lazy">
      ${caption}
    </figure>
  `;
}

function normalizedExternalEmbedUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.href);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtube.com" || host === "m.youtube.com") {
      const videoId = url.searchParams.get("v");
      if (videoId && /^[a-zA-Z0-9_-]{6,}$/.test(videoId)) return `https://www.youtube.com/embed/${videoId}`;
      if (url.pathname.startsWith("/embed/")) return url.href;
    }
    if (host === "youtu.be") {
      const videoId = url.pathname.replace("/", "");
      if (videoId && /^[a-zA-Z0-9_-]{6,}$/.test(videoId)) return `https://www.youtube.com/embed/${videoId}`;
    }
    const allowedHosts = new Set([
      "youtube.com",
      "player.vimeo.com",
      "docs.google.com",
      "drive.google.com",
      "datawrapper.dwcdn.net",
      "flo.uri.sh",
      "public.flourish.studio",
      "observablehq.com"
    ]);
    if (!allowedHosts.has(host)) return "";
    if (url.protocol !== "https:") return "";
    return url.href;
  } catch {
    return "";
  }
}

function articleExternalEmbedMarkup(block) {
  const url = normalizedExternalEmbedUrl(block.url || block.src);
  if (!url) {
    return `<p class="meta">External embed URL is not supported.</p>`;
  }
  const size = ["small", "medium", "large", "full"].includes(block.size) ? block.size : "large";
  const height = clamp(Number(block.height) || 420, 180, 900);
  const caption = block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : "";
  return `
    <figure class="article-external-embed article-external-embed-${escapeHtml(size)}">
      <iframe
        src="${escapeHtml(url)}"
        title="${escapeHtml(block.title || block.alt || "External embed")}"
        height="${height}"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
        allow="fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen></iframe>
      ${caption}
    </figure>
  `;
}

function legacyArticleBlocks(article) {
  const body = (article.body || []).map((text) => ({ type: "paragraph", text }));
  const embeds = (article.embeds || []).map((embed) => ({ type: "embed", embed }));
  return [...body, ...embeds];
}

function embedTitle(embed) {
  if (embed.type === "control-history") return "National chamber control probability";
  if (embed.type === "state-history") return `${embed.state} probability history`;
  if (["state-card", "state-preview", "map-preview", "map-state"].includes(embed.type)) return `${embed.state} forecast preview`;
  if (embed.type === "house-control-history") return "House control probability";
  if (embed.type === "house-seat-distribution") return "House seat distribution";
  if (embed.type === "house-district-history") return `${embed.district} probability history`;
  if (["house-district", "house-district-preview", "house-race", "district-preview"].includes(embed.type)) return `${embed.district} forecast preview`;
  if (embed.type === "house-closest") return "Closest House districts";
  if (embed.type === "president-win-history") return "Presidential win probability";
  if (embed.type === "president-ev-history") return "Expected electoral votes";
  if (["president-state-preview", "president-state", "president-map-preview"].includes(embed.type)) return `${embed.state} presidential preview`;
  if (embed.type === "president-state-history") return `${embed.state} presidential probability`;
  if (embed.type === "president-decisive") return "Most decisive presidential states";
  if (embed.type === "president-matchup-strength") return "Candidate and matchup strength";
  if (embed.type === "president-candidate-strength") return "Candidate strength";
  if (embed.type === "president-average") return "2028 matchup average";
  if (embed.type === "governor-history") return "Governor race count history";
  if (embed.type === "governor-seat-distribution") return "Governor race distribution";
  if (["governor-race-preview", "governor-state-preview"].includes(embed.type)) return `${embed.state} governor preview`;
  if (embed.type === "governor-leverage") return "Most decisive governor races";
  if (embed.type === "seat-distribution") return "Seat distribution";
  if (embed.type === "leverage") return "Most decisive races";
  return "Forecast chart";
}

function presidentForecastForEmbed(embed = {}) {
  if (!presidentForecasts?.length) return null;
  const dem = String(embed.dem || embed.demCandidate || "newsom").toLowerCase();
  const rep = String(embed.rep || embed.repCandidate || "vance").toLowerCase();
  return presidentForecasts.find((item) => item.demCandidate === dem && item.repCandidate === rep) || presidentForecasts[0] || null;
}

function presidentHistoryPoints(model, mode) {
  const history = Array.isArray(model.history) ? model.history : [];
  if (history.length) {
    return history.map((point) => ({
      date: point.date,
      dem: mode === "ev" ? point.demExpectedEV : point.demWinProbability,
      rep: mode === "ev" ? point.repExpectedEV : point.repWinProbability
    })).filter((point) => Number.isFinite(point.dem));
  }
  return [{
    date: model.date || model.modelDate,
    dem: mode === "ev" ? model.electoralCollege?.demExpectedEV : model.national?.demWinProbability,
    rep: mode === "ev" ? model.electoralCollege?.repExpectedEV : model.national?.repWinProbability
  }];
}

function presidentStateHistoryPoints(model, state) {
  const stateHistory = Array.isArray(model.stateHistory?.[state]) ? model.stateHistory[state] : [];
  if (stateHistory.length) {
    return stateHistory.map((point) => ({ date: point.date, dem: point.demProbability, rep: 1 - point.demProbability }));
  }
  const stateData = model.states?.[state];
  return [{ date: model.date || model.modelDate, dem: stateData?.demProbability || 0, rep: 1 - (stateData?.demProbability || 0) }];
}

function presidentRatingForState(stateData, mode = "rating") {
  const signedValue = mode === "probability" ? (stateData.demProbability - .5) * 100 : stateData.demMargin;
  const thresholds = mode === "probability"
    ? { tilt: 2.5, lean: 10, likely: 25, safe: 45 }
    : { tilt: 1, lean: 3, likely: 7, safe: 12 };
  return ratingFromSignedValue(signedValue, thresholds);
}

function presidentStateLeader(model, stateData) {
  const demLeads = stateData.demProbability >= .5;
  const probability = demLeads ? stateData.demProbability : 1 - stateData.demProbability;
  const projectedMargin = Math.abs(stateData.demMargin || 0);
  return {
    demLeads,
    probability,
    side: demLeads ? "D" : "R",
    candidate: demLeads ? model.demCandidateName : model.repCandidateName,
    projectedMargin
  };
}

function presidentStateMarkup(model, state, mode = "rating") {
  const stateData = model.states[state];
  const leader = presidentStateLeader(model, stateData);
  const rating = presidentRatingForState(stateData, mode);
  const demName = model.demCandidateName || "Democrat";
  const repName = model.repCandidateName || "Republican";
  const demProb = stateData.demProbability || 0;
  const repProb = 1 - demProb;
  return `
    <span class="race-kicker">${escapeHtml(STATE_NAMES[state] || state)} Presidential</span>
    <div class="map-card-title">
      <div class="state-code">${escapeHtml(state)}</div>
      <span class="rating-pill ${presidentRatingBucketClass(rating)}">${escapeHtml(rating)}</span>
    </div>
    <h3>${escapeHtml(leader.candidate)} has a ${oneDecimal(leader.probability)} chance.</h3>
    <div class="candidate-table" aria-label="${escapeHtml(STATE_NAMES[state] || state)} presidential forecast">
      <div class="candidate-table-head"><span>Candidate</span><span>Chance</span></div>
      <div class="candidate-row dem-row">
        <span>${escapeHtml(demName)} <i class="party-badge dem-badge">D</i></span>
        <strong>${oneDecimal(demProb)}</strong>
      </div>
      <div class="candidate-row rep-row">
        <span>${escapeHtml(repName)} <i class="party-badge rep-badge">R</i></span>
        <strong>${oneDecimal(repProb)}</strong>
      </div>
      <div class="candidate-margin"><span>Projected margin</span><strong>${leader.side}+${leader.projectedMargin.toFixed(1)} pts</strong></div>
    </div>
    <div class="prob-track" aria-label="${escapeHtml(state)} probability split">
      <span style="width:${demProb * 100}%"></span>
      <span style="width:${repProb * 100}%"></span>
    </div>
    <div class="badge-row">
      <span>${stateData.ev} EV</span>
      <span>${escapeHtml(presidentCandidateShortName(model.demCandidateName))} vs ${escapeHtml(presidentCandidateShortName(model.repCandidateName))}</span>
    </div>
  `;
}

function presidentRatingBucketClass(rating) {
  if (rating === "Toss-up") return "tossup";
  return String(rating || "Toss-up").toLowerCase().replace(/\s+/g, "-");
}

function renderPresidentLeverageInto(target, model, limit = 10) {
  const states = Object.entries(model.states || {})
    .map(([state, data]) => ({
      state,
      data,
      power: Math.min(data.demProbability, 1 - data.demProbability) * (data.ev || 0)
    }))
    .filter((item) => item.power > 0)
    .sort((a, b) => b.power - a.power)
    .slice(0, limit);
  const max = Math.max(...states.map((item) => item.power), .01);
  target.innerHTML = states.map((item) => {
    const leader = presidentStateLeader(model, item.data);
    const width = clamp((item.power / max) * 100, 8, 100);
    const leaderClass = item.data.demProbability > .55 ? "leads-dem" : item.data.demProbability < .45 ? "leads-rep" : "leads-tossup";
    return `<button class="leverage-row ${leaderClass}" type="button" data-tip="${escapeHtml(STATE_NAMES[item.state] || item.state)}<br>${escapeHtml(leader.candidate)} ${oneDecimal(leader.probability)}<br>${item.power.toFixed(1)} deciding power"><strong>${escapeHtml(item.state)}</strong><i style="width:${width}%"></i><span>${item.power.toFixed(1)}</span></button>`;
  }).join("");
  bindPanelTooltipFor(target, ".leverage-row", (node) => node.dataset.tip);
}

function renderPresidentMatchupStrengthInto(target, limit = 4) {
  const summary = presidentSummary();
  if (!summary) {
    target.innerHTML = `<p>Presidential forecasts not loaded.</p>`;
    return;
  }
  const maxDem = Math.max(...summary.sortedDem.map((item) => item.national?.demWinProbability || 0), .01);
  const maxRep = Math.max(...summary.sortedRep.map((item) => item.national?.repWinProbability || 0), .01);
  const row = (item, side, max) => {
    const prob = side === "dem" ? item.national.demWinProbability : item.national.repWinProbability;
    const ev = side === "dem" ? item.electoralCollege.demExpectedEV : item.electoralCollege.repExpectedEV;
    const name = side === "dem" ? `${presidentCandidateShortName(item.demCandidateName)} over ${presidentCandidateShortName(item.repCandidateName)}` : `${presidentCandidateShortName(item.repCandidateName)} over ${presidentCandidateShortName(item.demCandidateName)}`;
    return `<button class="matchup-strength-row ${side}" type="button" data-tip="${escapeHtml(name)}<br>${oneDecimal(prob)} win chance<br>${Math.round(ev)} EV"><strong>${escapeHtml(name)}</strong><i style="width:${clamp((prob / max) * 100, 8, 100)}%"></i><span>${oneDecimal(prob)}</span></button>`;
  };
  target.innerHTML = `
    <div class="matchup-strength-grid">
      <section><h3>Best Democratic matchups</h3>${summary.sortedDem.slice(0, limit).map((item) => row(item, "dem", maxDem)).join("")}</section>
      <section><h3>Best Republican matchups</h3>${summary.sortedRep.slice(0, limit).map((item) => row(item, "rep", maxRep)).join("")}</section>
    </div>
  `;
  bindPanelTooltipFor(target, "button", (node) => node.dataset.tip);
}

function renderPresidentCandidateStrengthInto(target, limit = 5) {
  if (!presidentForecasts?.length) {
    target.innerHTML = `<p>Presidential forecasts not loaded.</p>`;
    return;
  }
  const collect = (side) => {
    const groups = new Map();
    presidentForecasts.forEach((item) => {
      const candidate = side === "dem" ? item.demCandidateName : item.repCandidateName;
      const probability = side === "dem" ? item.national?.demWinProbability : item.national?.repWinProbability;
      const ev = side === "dem" ? item.electoralCollege?.demExpectedEV : item.electoralCollege?.repExpectedEV;
      if (!candidate || !Number.isFinite(probability)) return;
      if (!groups.has(candidate)) groups.set(candidate, { candidate, side, probabilities: [], evs: [] });
      groups.get(candidate).probabilities.push(probability);
      if (Number.isFinite(ev)) groups.get(candidate).evs.push(ev);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      averageProbability: group.probabilities.reduce((sum, value) => sum + value, 0) / group.probabilities.length,
      averageEv: group.evs.length ? group.evs.reduce((sum, value) => sum + value, 0) / group.evs.length : null,
      testedMatchups: group.probabilities.length
    })).sort((a, b) => b.averageProbability - a.averageProbability).slice(0, limit);
  };
  const demCandidates = collect("dem");
  const repCandidates = collect("rep");
  const maxDem = Math.max(...demCandidates.map((item) => item.averageProbability), .01);
  const maxRep = Math.max(...repCandidates.map((item) => item.averageProbability), .01);
  const row = (item, max) => {
    const name = presidentCandidateShortName(item.candidate);
    const evText = item.averageEv === null ? "--" : `${Math.round(item.averageEv)} average EV`;
    return `<button class="matchup-strength-row ${item.side}" type="button" data-tip="${escapeHtml(item.candidate)}<br>${oneDecimal(item.averageProbability)} average win chance<br>${escapeHtml(evText)}<br>${item.testedMatchups} tested matchups"><strong>${escapeHtml(name)}</strong><i style="width:${clamp((item.averageProbability / max) * 100, 8, 100)}%"></i><span>${oneDecimal(item.averageProbability)}</span></button>`;
  };
  target.innerHTML = `
    <div class="matchup-strength-grid">
      <section><h3>Best Democratic candidates</h3>${demCandidates.map((item) => row(item, maxDem)).join("")}</section>
      <section><h3>Best Republican candidates</h3>${repCandidates.map((item) => row(item, maxRep)).join("")}</section>
    </div>
  `;
  bindPanelTooltipFor(target, "button", (node) => node.dataset.tip);
}

function renderPresidentAverageInto(target) {
  const summary = presidentSummary();
  if (!summary) {
    target.innerHTML = `<p>Presidential forecasts not loaded.</p>`;
    return;
  }
  target.innerHTML = `
    <div class="source-status-grid article-average-grid">
      <div class="source-status-card is-ok"><span>Democratic average</span><h3>${oneDecimal(summary.demWin)}</h3><p>${Math.round(summary.demEv)} expected EV</p></div>
      <div class="source-status-card is-warn"><span>Republican average</span><h3>${oneDecimal(summary.repWin)}</h3><p>${Math.round(summary.repEv)} expected EV</p></div>
      <div class="source-status-card"><span>Matchups</span><h3>${summary.count}</h3><p>${escapeHtml(summary.runDate || "")}</p></div>
    </div>
  `;
}

function renderEmbed(target, embed) {
  if (!target) return;
  if (embed.type === "control-history") {
    target.className = "article-embed-target history-chart";
    const points = forecast.controlHistory?.length ? forecast.controlHistory : [{ date: forecast.modelDate, dem: forecast.demControlProbability, rep: forecast.repControlProbability }];
    renderLineChart(target, points, {
      label: embed.title || "National chamber control probability",
      pointHtml: (point) => `${point.date}<br>D ${pct(point.dem)} / R ${pct(point.rep ?? 1 - point.dem)}`,
      value: (point) => point.dem,
      electionDate: forecast?.settings?.electionDate || "2026-11-03",
      eventMarkers: SENATE_NATIONAL_MARKERS,
      mobileZoomControls: true
    });
    return;
  }
  if (embed.type === "state-history") {
    const race = getRace(String(embed.state || "").toUpperCase());
    target.className = "article-embed-target history-chart";
    if (!race) {
      target.innerHTML = `<p>State not found.</p>`;
      return;
    }
    const bodnar = (race.extraCandidates || []).find((candidate) => candidate.name === "Seth Bodnar");
    let points = race.history?.length ? race.history : [{ date: forecast.modelDate, dem: race.demProbability }];
    if (bodnar) {
      const bodnarHistory = new Map((race.extraHistory || []).map((point) => [point.date, point["Seth Bodnar"]]));
      points = points.map((point) => ({ ...point, extra: bodnarHistory.get(point.date) ?? null }));
    }
    const demIsIndependent = race.demDisplayParty === "I" || race.dem.toLowerCase().includes("independent");
    const demHistoryLabel = demIsIndependent ? candidateDisplayName(race, "D") : "Democrat";
    renderLineChart(target, points, {
      label: embed.title || `${race.displayName} probability history`,
      pointHtml: (point) => `${point.date}<br>D ${pct(point.dem)} / R ${pct(1 - point.dem)}`,
      extraSeries: bodnar ? { key: "extra", name: "Seth Bodnar", className: "history-line-extra", dotClassName: "history-dot-extra", labelClassName: "history-end-label-extra", colorLabel: "Seth Bodnar" } : null,
      demSeriesClass: demIsIndependent ? "history-line-ind" : "history-line-dem",
      demBandClass: demIsIndependent ? "history-band-ind" : "history-band-dem",
      demDotClass: demIsIndependent ? "history-dot-ind" : "history-dot-dem",
      demHoverDotClass: demIsIndependent ? "history-hover-dot-ind" : "history-hover-dot-dem",
      demEndLabelClass: demIsIndependent ? "history-end-label-ind" : "history-end-label-dem",
      demHoverTextClass: demIsIndependent ? "history-hover-ind" : "",
      endLabel: demIsIndependent ? (party, value) => `${party === "dem" ? demHistoryLabel : "Republican"} ${oneDecimal(value)}` : null,
      hoverLabel: demIsIndependent ? (party, value) => `${party === "dem" ? demHistoryLabel : "Republican"} ${oneDecimal(value)}` : null,
      annotations: race.state === "MT" ? [...CHART_ANNOTATIONS, ...MONTANA_CHART_ANNOTATIONS] : CHART_ANNOTATIONS,
      eventMarkers: senatePrimaryMarkers(race),
      value: (point) => point.dem,
      electionDate: forecast?.settings?.electionDate || "2026-11-03",
      mobileZoomControls: true
    });
    return;
  }
  if (["state-card", "state-preview", "map-preview", "map-state"].includes(embed.type)) {
    const race = getRace(String(embed.state || "").toUpperCase());
    const mode = normalizedMapMode(embed.mode || embed.colorMode);
    target.className = "article-embed-target state-preview-embed";
    target.innerHTML = race ? hoverMarkup(race, mode) : `<p>State not found.</p>`;
    return;
  }
  if (embed.type === "seat-distribution") {
    target.className = "article-embed-target seat-histogram";
    renderSeatHistogramInto(target);
    return;
  }
  if (embed.type === "house-control-history") {
    target.className = "article-embed-target history-chart";
    if (!houseForecast) {
      target.innerHTML = `<p>House forecast not loaded.</p>`;
      return;
    }
    const points = houseForecast.controlHistory?.length ? houseForecast.controlHistory : [{ date: houseForecast.modelDate, dem: houseForecast.demControlProbability, rep: houseForecast.repControlProbability }];
    renderLineChart(target, points, {
      label: embed.title || "House control probability",
      pointHtml: (point) => `${point.date}<br>D ${pct(point.dem)} / R ${pct(point.rep ?? 1 - point.dem)}`,
      value: (point) => point.dem,
      electionDate: "2026-11-03",
      mobileZoomControls: true
    });
    return;
  }
  if (embed.type === "house-seat-distribution") {
    target.className = "article-embed-target seat-histogram";
    if (!houseForecast) {
      target.innerHTML = `<p>House forecast not loaded.</p>`;
      return;
    }
    const seats = Object.keys(houseForecast.seatCounts || {}).map(Number);
    const center = houseForecast.medianSeats || 218;
    renderSeatHistogramInto(target, houseForecast, {
      minSeat: Math.max(180, Math.min(...seats, center - 16)),
      maxSeat: Math.min(255, Math.max(...seats, center + 16))
    });
    return;
  }
  if (["house-district", "house-district-preview", "house-race", "district-preview"].includes(embed.type)) {
    const district = getHouseDistrict(embed.district || embed.id);
    target.className = "article-embed-target state-preview-embed";
    target.innerHTML = district ? houseDistrictMarkup(district) : `<p>District not found.</p>`;
    return;
  }
  if (embed.type === "house-district-history") {
    const district = getHouseDistrict(embed.district || embed.id);
    target.className = "article-embed-target history-chart";
    if (!district) {
      target.innerHTML = `<p>District not found.</p>`;
      return;
    }
    renderHouseDistrictHistoryInto(target, district);
    return;
  }
  if (embed.type === "house-closest") {
    target.className = "article-embed-target leverage-chart";
    if (!houseForecast) {
      target.innerHTML = `<p>House forecast not loaded.</p>`;
      return;
    }
    const ranked = houseForecast.decisiveDistricts || [];
    const max = Math.max(...ranked.map((district) => district.leverage || 0), .01);
    target.innerHTML = ranked.slice(0, embed.limit || 10).map((district) => {
      const width = clamp(((district.leverage || 0) / max) * 100, 8, 100);
      return `<button class="leverage-row ${houseLeaderClass(district)}" type="button" data-tip="${escapeHtml(houseDistrictLabel(district))}<br>${houseProbability(district.winnerProbability)} ${district.winnerParty === "D" ? "Democrat" : "Republican"}<br>${escapeHtml(district.rating)}"><strong>${escapeHtml(district.id)}</strong><i style="width:${width}%"></i><span>${oneDecimal(district.leverage || 0)}</span></button>`;
    }).join("");
    bindPanelTooltipFor(target, ".leverage-row", (node) => node.dataset.tip);
    return;
  }
  if (embed.type === "president-win-history") {
    const model = presidentForecastForEmbed(embed);
    target.className = "article-embed-target history-chart";
    if (!model) {
      target.innerHTML = `<p>Presidential forecast not loaded.</p>`;
      return;
    }
    const points = presidentHistoryPoints(model, "win");
    renderLineChart(target, points, {
      label: embed.title || "Presidential win probability",
      pointHtml: (point) => `${point.date}<br>${presidentCandidateShortName(model.demCandidateName)} ${oneDecimal(point.dem)} / ${presidentCandidateShortName(model.repCandidateName)} ${oneDecimal(point.rep ?? 1 - point.dem)}`,
      endLabel: (party, value) => `${party === "dem" ? presidentCandidateShortName(model.demCandidateName) : presidentCandidateShortName(model.repCandidateName)} ${oneDecimal(value)}`,
      hoverLabel: (party, value) => `${party === "dem" ? presidentCandidateShortName(model.demCandidateName) : presidentCandidateShortName(model.repCandidateName)} ${oneDecimal(value)}`,
      singleNote: "History begins once daily presidential forecast files are saved.",
      value: (point) => point.dem,
      electionDate: "2028-11-07",
      eventMarkers: PRESIDENT_PRIMARY_MARKERS,
      zoomControls: true
    });
    return;
  }
  if (embed.type === "president-ev-history") {
    const model = presidentForecastForEmbed(embed);
    target.className = "article-embed-target history-chart";
    if (!model) {
      target.innerHTML = `<p>Presidential forecast not loaded.</p>`;
      return;
    }
    const points = presidentHistoryPoints(model, "ev");
    renderLineChart(target, points, {
      label: embed.title || "Expected electoral votes",
      pointHtml: (point) => `${point.date}<br>${presidentCandidateShortName(model.demCandidateName)} ${Math.round(point.dem)} / ${presidentCandidateShortName(model.repCandidateName)} ${Math.round(point.rep)}`,
      domain: [160, 380],
      ticks: [350, 300, 270, 240, 190],
      midline: 270,
      band: 12,
      valueFormat: (value) => String(Math.round(value)),
      endLabel: (party, value) => `${party === "dem" ? presidentCandidateShortName(model.demCandidateName) : presidentCandidateShortName(model.repCandidateName)} ${Math.round(value)}`,
      hoverLabel: (party, value) => `${party === "dem" ? presidentCandidateShortName(model.demCandidateName) : presidentCandidateShortName(model.repCandidateName)} ${Math.round(value)}`,
      electionDate: "2028-11-07",
      eventMarkers: PRESIDENT_PRIMARY_MARKERS,
      zoomControls: true
    });
    return;
  }
  if (["president-state-preview", "president-state", "president-map-preview"].includes(embed.type)) {
    const model = presidentForecastForEmbed(embed);
    const state = String(embed.state || "").toUpperCase();
    target.className = "article-embed-target state-preview-embed";
    target.innerHTML = model?.states?.[state] ? presidentStateMarkup(model, state, embed.mode || embed.colorMode || "rating") : `<p>State not found.</p>`;
    return;
  }
  if (embed.type === "president-state-history") {
    const model = presidentForecastForEmbed(embed);
    const state = String(embed.state || "").toUpperCase();
    target.className = "article-embed-target history-chart";
    if (!model?.states?.[state]) {
      target.innerHTML = `<p>State not found.</p>`;
      return;
    }
    const points = presidentStateHistoryPoints(model, state);
    renderLineChart(target, points, {
      label: embed.title || `${STATE_NAMES[state] || state} presidential probability`,
      pointHtml: (point) => `${point.date}<br>${presidentCandidateShortName(model.demCandidateName)} ${oneDecimal(point.dem)} / ${presidentCandidateShortName(model.repCandidateName)} ${oneDecimal(point.rep ?? 1 - point.dem)}`,
      endLabel: (party, value) => `${party === "dem" ? presidentCandidateShortName(model.demCandidateName) : presidentCandidateShortName(model.repCandidateName)} ${oneDecimal(value)}`,
      hoverLabel: (party, value) => `${party === "dem" ? presidentCandidateShortName(model.demCandidateName) : presidentCandidateShortName(model.repCandidateName)} ${oneDecimal(value)}`,
      singleNote: "History begins once daily presidential forecast files are saved.",
      value: (point) => point.dem,
      electionDate: "2028-11-07",
      eventMarkers: PRESIDENT_PRIMARY_MARKERS,
      zoomControls: true
    });
    return;
  }
  if (embed.type === "president-decisive") {
    const model = presidentForecastForEmbed(embed);
    target.className = "article-embed-target leverage-chart";
    if (!model) {
      target.innerHTML = `<p>Presidential forecast not loaded.</p>`;
      return;
    }
    renderPresidentLeverageInto(target, model, embed.limit || 10);
    return;
  }
  if (embed.type === "president-matchup-strength") {
    target.className = "article-embed-target matchup-strength";
    renderPresidentMatchupStrengthInto(target, embed.limit || 4);
    return;
  }
  if (embed.type === "president-candidate-strength") {
    target.className = "article-embed-target matchup-strength";
    renderPresidentCandidateStrengthInto(target, embed.limit || 5);
    return;
  }
  if (embed.type === "president-average") {
    target.className = "article-embed-target matchup-strength";
    renderPresidentAverageInto(target);
    return;
  }
  if (embed.type === "governor-history") {
    target.className = "article-embed-target history-chart";
    if (!governorForecast) {
      target.innerHTML = `<p>Governor forecast not loaded.</p>`;
      return;
    }
    const points = governorForecast.governorCountHistory?.length
      ? governorForecast.governorCountHistory.map((point) => ({ date: point.date, dem: point.demGovernors, rep: point.repGovernors }))
      : [{ date: governorForecast.modelDate, dem: governorForecast.projectedDemRaceWins, rep: governorForecast.projectedRepRaceWins }];
    renderLineChart(target, points, {
      label: embed.title || "Governor race count history",
      pointHtml: (point) => `${point.date}<br>D ${Math.round(point.dem)} / R ${Math.round(point.rep)}`,
      domain: [10, 40],
      ticks: [35, 30, 25, 20, 15],
      midline: 25,
      band: 2,
      valueFormat: (value) => String(Math.round(value)),
      endLabel: (party, value) => `${party === "dem" ? "D" : "R"} ${Math.round(value)}`,
      hoverLabel: (party, value) => `${party === "dem" ? "D" : "R"} ${Math.round(value)}`,
      value: (point) => point.dem,
      electionDate: governorForecast.settings?.electionDate || "2026-11-03",
      mobileZoomControls: true
    });
    return;
  }
  if (embed.type === "governor-seat-distribution") {
    target.className = "article-embed-target seat-histogram";
    if (!governorForecast) {
      target.innerHTML = `<p>Governor forecast not loaded.</p>`;
      return;
    }
    renderGovernorDistributionInto(target, governorForecast);
    return;
  }
  if (["governor-race-preview", "governor-state-preview"].includes(embed.type)) {
    const state = String(embed.state || "").toUpperCase();
    const race = governorForecast?.races?.find((item) => item.state === state);
    target.className = "article-embed-target state-preview-embed";
    target.innerHTML = race ? governorHoverMarkup(race) : `<p>Governor race not found.</p>`;
    return;
  }
  if (embed.type === "governor-leverage") {
    target.className = "article-embed-target leverage-chart";
    if (!governorForecast) {
      target.innerHTML = `<p>Governor forecast not loaded.</p>`;
      return;
    }
    const ranked = [...governorForecast.races].sort((a, b) => b.tippingPower - a.tippingPower).slice(0, embed.limit || 10);
    const max = Math.max(...ranked.map((race) => race.tippingPower || 0), .01);
    target.innerHTML = ranked.map((race) => {
      const width = clamp(((race.tippingPower || 0) / max) * 100, 8, 100);
      return `<button class="leverage-row ${governorLeaderClass(race)}" type="button" data-tip="${escapeHtml(race.displayName)}<br>${oneDecimal(race.tippingPower)} tipping power<br>${escapeHtml(race.rating)}"><strong>${escapeHtml(race.state)}</strong><i style="width:${width}%"></i><span>${oneDecimal(race.tippingPower || 0)}</span></button>`;
    }).join("");
    bindPanelTooltipFor(target, ".leverage-row", (node) => node.dataset.tip);
    return;
  }
  if (embed.type === "leverage") {
    target.className = "article-embed-target leverage-chart";
    renderLeverageInto(target);
    return;
  }
  target.innerHTML = `<p>Unknown embed type.</p>`;
}

async function loadArticles() {
  try {
    console.log("[wiki.js] Loading articles.json");
    const response = await fetch("data/articles.json", { cache: "no-store" });
    console.log("[wiki.js] articles.json status:", response.status);
    if (!response.ok) return [];
    const data = await response.json();
    console.log("[wiki.js] articles.json loaded, type:", typeof data, "isArray:", Array.isArray(data), "length:", Array.isArray(data) ? data.length : "N/A");
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("[wiki.js] articles.json error:", error);
    return [];
  }
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  const cleaned = text.includes("<<<<<<<")
    ? text.replace(/<<<<<<<[^\r\n]*\r?\n([\s\S]*?)\r?\n=======\r?\n[\s\S]*?\r?\n>>>>>>>[^\r\n]*(?:\r?\n)?/g, "$1\n")
    : text;
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const preview = cleaned.slice(0, 90).replace(/\s+/g, " ").trim();
    throw new Error(`${label} could not parse: ${error.message}${preview ? ` Preview: ${preview}` : ""}`);
  }
}

async function loadForecast() {
  console.log("[wiki.js] Loading forecast.json");
  const response = await fetch("data/forecast.json", { cache: "no-store" });
  console.log("[wiki.js] forecast.json status:", response.status);
  if (!response.ok) throw new Error(`Forecast data returned ${response.status}`);
  const data = await readJsonResponse(response, "data/forecast.json");
  console.log("[wiki.js] forecast.json loaded, keys:", Object.keys(data));
  console.log("[wiki.js] forecast.json settings:", data.settings);
  return data;
}

async function loadHouseForecast() {
  try {
    console.log("[wiki.js] Loading house-forecast.json");
    const response = await fetch("data/house-forecast.json", { cache: "no-store" });
    console.log("[wiki.js] house-forecast.json status:", response.status);
    if (!response.ok) return null;
    const data = await readJsonResponse(response, "data/house-forecast.json");
    console.log("[wiki.js] house-forecast.json loaded, keys:", Object.keys(data));
    return data;
  } catch (error) {
    console.error("[wiki.js] house-forecast.json error:", error);
    return null;
  }
}

async function loadHouseDistrictShapes() {
  if (!houseShapeGeoPromise) {
    houseShapeGeoPromise = fetch("data/house-districts-119.geojson", { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`House district shapes returned ${response.status}`);
        return response.json();
      });
  }
  houseShapeGeo = await houseShapeGeoPromise;
  return houseShapeGeo;
}

async function loadUsStatesShapes() {
  if (!usStatesGeoPromise) {
    usStatesGeoPromise = fetch("data/result-us-states.geojson", { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`US states shapes returned ${response.status}`);
        return response.json();
      });
  }
  usStatesGeo = await usStatesGeoPromise;
  return usStatesGeo;
}

async function loadGovernorForecast() {
  try {
    console.log("[wiki.js] Loading governor-forecast.json");
    const response = await fetch("data/governor-forecast.json", { cache: "no-store" });
    console.log("[wiki.js] governor-forecast.json status:", response.status);
    if (!response.ok) return null;
    const data = await readJsonResponse(response, "data/governor-forecast.json");
    console.log("[wiki.js] governor-forecast.json loaded, keys:", Object.keys(data));
    return data;
  } catch (error) {
    console.error("[wiki.js] governor-forecast.json error:", error);
    return null;
  }
}

async function loadPresidentForecasts() {
  console.log("[wiki.js] Loading president forecasts");
  const files = [];
  PRESIDENT_DEM_CANDIDATES.forEach((dem) => {
    PRESIDENT_REP_CANDIDATES.forEach((rep) => {
      files.push(`data/president-forecast-${dem}-${rep}.json`);
    });
  });
  console.log("[wiki.js] President forecast files to load:", files);
  const results = await Promise.all(files.map(async (file) => {
    try {
      console.log(`[wiki.js] Loading ${file}`);
      const response = await fetch(file, { cache: "no-store" });
      console.log(`[wiki.js] ${file} status:`, response.status);
      if (!response.ok) return null;
      const data = await readJsonResponse(response, file);
      console.log(`[wiki.js] ${file} loaded, keys:`, Object.keys(data));
      return data;
    } catch (error) {
      console.error(`[wiki.js] ${file} error:`, error);
      return null;
    }
  }));
  const filtered = results.filter(Boolean);
  console.log("[wiki.js] President forecasts loaded successfully:", filtered.length);
  return filtered;
}

function renderLoadError(error) {
  setText("control-headline", "Forecast data unavailable");
  setText("odds-phrase", "--");
  const main = document.querySelector("main");
  if (main) {
    const panel = document.createElement("section");
    panel.className = "text-panel";
    panel.innerHTML = `<p class="kicker">Data</p><h2>Saved forecast file could not load.</h2><p>${error.message}</p>`;
    main.prepend(panel);
  }
}

async function init() {
  installInteractionDismiss();
  articles = await loadArticles();
  houseForecast = await loadHouseForecast();
  governorForecast = await loadGovernorForecast();
  if (document.getElementById("home-president-card") || document.getElementById("article-page")) {
    presidentForecasts = await loadPresidentForecasts();
  }
  updateHomeHouseSummary();
  updateHomeGovernorSummary();
  updateHomePresidentSummary();
  renderHousePage();
  renderGovernorPage();
  try {
    forecast = await loadForecast();
  } catch (error) {
    renderLoadError(error);
    updateHomeHouseSummary();
    updateHomeGovernorSummary();
    renderHousePage();
    renderGovernorPage();
    renderHomeLatestVideo();
    renderHomeRadar();
    renderHomeDiagnostics();
    renderTopArticle();
    renderHomeArticleList();
    renderArticlesList();
    renderArticlePage();
    updateHomePresidentSummary();
    return;
  }
  updateSummary();
  updateHomeHouseSummary();
  updateHomeGovernorSummary();
  updateHomePresidentSummary();
  renderMapColorControls();
  renderStateMap();
  renderLegend();
  renderHistogram();
  renderLeverageChart();
  renderSenateControlPath();
  renderControlHistory();
  renderSeatHistory();
  renderRacePage();
  renderRaceSelector();
  renderSourceStatus();
  renderHousePage();
  renderGovernorPage();
  renderBattlegroundList();
  renderHomeLatestVideo();
  renderHomeRadar();
  renderHomeDiagnostics();
  renderTopArticle();
  renderHomeArticleList();
  renderArticlesList();
  renderArticlePage();
  renderCalibrationPage();
}

init();




















