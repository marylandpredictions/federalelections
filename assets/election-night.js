const FIPS_TO_STATE = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS",
  "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO",
  "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC",
  "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

const PARTY_COLORS = {
  D: "#1687e8",
  R: "#df2e38",
  I: "#8b5cf6",
  L: "#d6a400",
  G: "#39b86b",
  U: "#9aa6b8"
};

const MODE_LABELS = {
  house: "House",
  senate: "Senate",
  governor: "Governor"
};

function partyColor(party) {
  return PARTY_COLORS[String(party || "U").toUpperCase()] || PARTY_COLORS.U;
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(digits)}%`;
}

function formatVotes(value) {
  return Number.isFinite(value) && value > 0 ? value.toLocaleString() : "0";
}

function hasVotes(race) {
  return (race?.candidates || []).some((candidate) => Number.isFinite(candidate.votes) && candidate.votes > 0);
}

function cleanStatus(status) {
  return String(status || "").toLowerCase();
}

function hasRealNominee(status) {
  const value = cleanStatus(status);
  return value === "nominee" || value === "presumptive" || value === "resolved-or-filed";
}

function candidateName(name, party, status) {
  if (!name || !hasRealNominee(status)) return party === "D" ? "Democrat" : party === "R" ? "Republican" : "Candidate";
  return name;
}

function raceWinnerParty(race) {
  if (!race) return "U";
  if (race.winnerParty) return race.winnerParty;
  if (Number.isFinite(race.margin)) return race.margin >= 0 ? "D" : "R";
  const leader = race.candidates?.slice().sort((a, b) => (b.modelChance || b.percent || 0) - (a.modelChance || a.percent || 0))[0];
  return leader?.party || "U";
}

function raceColor(race) {
  const party = raceWinnerParty(race);
  const base = partyColor(party);
  const probability = race?.winnerProbability ?? Math.max(race?.demProbability || 0, race?.repProbability || 0);
  const strength = Number.isFinite(probability) ? Math.max(0.24, Math.min(1, probability)) : 0.42;
  return d3.interpolateRgb("#cfd6e5", base)(strength);
}

function topCandidates(race, limit = 3) {
  return (race?.candidates || [])
    .slice()
    .sort((a, b) => (b.votes || b.modelChance || b.percent || 0) - (a.votes || a.modelChance || a.percent || 0))
    .slice(0, limit);
}

function buildCandidate(party, name, status, modelChance, votes = 0, percent = null, extra = {}) {
  return {
    name: candidateName(name, party, status),
    party,
    status,
    modelChance: Number.isFinite(modelChance) ? modelChance : null,
    percent: Number.isFinite(percent) ? percent : null,
    votes: Number.isFinite(votes) ? votes : 0,
    ...extra
  };
}

function normalizeHouseRace(district) {
  const demPercent = (district.demProbability || 0) * 100;
  const repPercent = (district.repProbability || 0) * 100;
  return {
    id: district.id,
    type: "house",
    state: district.state,
    district: district.district,
    title: `${STATE_NAMES[district.state] || district.state} ${district.district === "AL" ? "At-Large" : `District ${district.district}`}`,
    subtitle: district.rating || "Tracked race",
    rating: district.rating || "",
    margin: district.margin,
    winnerParty: district.winnerParty || (demPercent >= repPercent ? "D" : "R"),
    winnerProbability: Math.max(district.demProbability || 0, district.repProbability || 0),
    demProbability: district.demProbability,
    repProbability: district.repProbability,
    candidates: [
      buildCandidate("D", district.demCandidate, district.demStatus, demPercent, 0, null, { incumbent: district.demProfile?.incumbent }),
      buildCandidate("R", district.repCandidate, district.repStatus, repPercent, 0, null, { incumbent: district.repProfile?.incumbent })
    ],
    reportingPercent: null
  };
}

function normalizeSenateRace(race) {
  const demPercent = (race.demProbability || 0) * 100;
  const repPercent = (race.repProbability || 0) * 100;
  return {
    id: `senate-${race.state}`,
    type: "senate",
    state: race.state,
    title: `${STATE_NAMES[race.state] || race.state} Senate`,
    subtitle: race.rating || "Tracked race",
    rating: race.rating || "",
    margin: race.margin,
    winnerParty: demPercent >= repPercent ? "D" : "R",
    winnerProbability: Math.max(race.demProbability || 0, race.repProbability || 0),
    demProbability: race.demProbability,
    repProbability: race.repProbability,
    candidates: [
      buildCandidate("D", race.dem, race.demStatus, demPercent),
      buildCandidate("R", race.rep, race.repStatus, repPercent)
    ],
    reportingPercent: null
  };
}

function normalizeGovernorRace(race) {
  const demPercent = (race.demProbability || 0) * 100;
  const repPercent = (race.repProbability || 0) * 100;
  return {
    id: `governor-${race.state}`,
    type: "governor",
    state: race.state,
    title: race.displayName || `${STATE_NAMES[race.state] || race.state} Governor`,
    subtitle: race.rating || "Tracked race",
    rating: race.rating || "",
    margin: race.margin,
    winnerParty: demPercent >= repPercent ? "D" : "R",
    winnerProbability: Math.max(race.demProbability || 0, race.repProbability || 0),
    demProbability: race.demProbability,
    repProbability: race.repProbability,
    candidates: [
      buildCandidate("D", race.demCandidate || race.dem, race.demStatus, demPercent, 0, null, { incumbent: race.incumbentParty === "D" }),
      buildCandidate("R", race.repCandidate || race.rep, race.repStatus, repPercent, 0, null, { incumbent: race.incumbentParty === "R" })
    ],
    reportingPercent: null
  };
}

function tooltipMarkup(race, title) {
  if (!race) {
    return `<div class="election-map-tooltip-title">${title}</div><div class="election-map-tooltip-muted">No tracked race</div>`;
  }

  const rows = topCandidates(race, 2).map((candidate, index) => {
    const color = partyColor(candidate.party);
    const value = hasVotes(race) ? formatPercent(candidate.percent || 0) : formatPercent(candidate.modelChance);
    return `
      <tr class="${index === 0 ? "leading" : ""}">
        <td><span class="tooltip-party-bar" style="background:${color}"></span>${candidate.name}${candidate.incumbent ? "*" : ""}</td>
        <td>${value}</td>
        <td>${hasVotes(race) ? formatVotes(candidate.votes) : "Model"}</td>
      </tr>
    `;
  }).join("");

  const updated = race.reportingPercent == null ? "Forecast candidate view" : `${formatPercent(race.reportingPercent, 0)} est. vote in`;
  return `
    <div class="election-map-tooltip-title">${race.title || title}</div>
    <table class="election-map-tooltip-table">
      <tbody>${rows}</tbody>
    </table>
    <div class="election-map-tooltip-foot">
      <span>${updated}</span>
      <span>${race.rating || ""}</span>
    </div>
  `;
}

class ElectionNightPage {
  constructor() {
    this.selectedMode = localStorage.getItem("electionNightMode") || "house";
    this.dataByMode = { house: [], senate: [], governor: [] };
    this.geo = null;
    this.stateFeatures = null;
    this.currentRace = null;
    this.svg = null;
    this.viewport = null;
    this.zoom = null;
    this.path = null;
    this.init();
  }

  async init() {
    this.bindEvents();
    this.updateModeButtons();
    await this.loadData();
    this.renderSummary();
    await this.renderMap();
  }

  bindEvents() {
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => this.switchMode(button.dataset.mode));
    });

    document.querySelectorAll("[data-clear-focus]").forEach((button) => {
      button.addEventListener("click", () => this.clearFocus());
    });
  }

  async loadData() {
    const [house, senate, governor] = await Promise.all([
      this.safeJson("data/house-forecast.json"),
      this.safeJson("data/forecast.json"),
      this.safeJson("data/governor-forecast.json")
    ]);

    this.dataByMode.house = (house?.districts || []).map(normalizeHouseRace);
    this.dataByMode.senate = (senate?.races || []).map(normalizeSenateRace);
    this.dataByMode.governor = (governor?.races || []).map(normalizeGovernorRace);
  }

  async safeJson(url) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error(`Could not load ${url}`, error);
      return null;
    }
  }

  modeRaces() {
    return this.dataByMode[this.selectedMode] || [];
  }

  async switchMode(mode) {
    if (!MODE_LABELS[mode] || mode === this.selectedMode) return;
    this.selectedMode = mode;
    localStorage.setItem("electionNightMode", mode);
    this.currentRace = null;
    this.updateModeButtons();
    this.renderSummary();
    this.hideFocusPanel();
    await this.renderMap();
  }

  updateModeButtons() {
    document.querySelectorAll("[data-mode]").forEach((button) => {
      const active = button.dataset.mode === this.selectedMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  renderSummary() {
    const races = this.modeRaces();
    const total = races.length;
    const dem = races.filter((race) => raceWinnerParty(race) === "D").length;
    const rep = races.filter((race) => raceWinnerParty(race) === "R").length;
    const competitive = races.filter((race) => (race.winnerProbability || 0) < 0.75).length;

    document.getElementById("summary-label").textContent = `${MODE_LABELS[this.selectedMode]} board`;
    document.getElementById("total-races").textContent = total ? String(total) : "--";
    document.getElementById("called-races").textContent = this.selectedMode === "house" ? "district forecasts" : "state forecasts";
    document.getElementById("dem-seats").textContent = String(dem);
    document.getElementById("rep-seats").textContent = String(rep);
    document.getElementById("dem-summary-label").textContent = this.selectedMode === "governor" ? "Dem states" : "Dem seats";
    document.getElementById("rep-summary-label").textContent = this.selectedMode === "governor" ? "GOP states" : "GOP seats";
    document.getElementById("reporting-percent").textContent = String(competitive);
    document.getElementById("last-updated").textContent = "competitive races";
  }

  async renderMap() {
    const container = document.getElementById("election-map");
    if (!container) return;
    if (!window.d3 || !window.topojson) {
      container.innerHTML = `<p class="map-note">Map rendering needs D3 to load.</p>`;
      return;
    }

    container.innerHTML = `<div class="election-map-loading">Loading ${MODE_LABELS[this.selectedMode]} map...</div>`;
    if (this.selectedMode === "house") {
      await this.renderHouseMap(container);
    } else {
      await this.renderStateMap(container);
    }
  }

  async renderStateMap(container) {
    if (!this.stateFeatures) {
      const us = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
      this.stateFeatures = topojson.feature(us, us.objects.states).features;
    }

    const width = 1160;
    const height = 720;
    const projection = d3.geoAlbersUsa().fitExtent([[24, 24], [width - 24, height - 24]], {
      type: "FeatureCollection",
      features: this.stateFeatures
    });
    this.path = d3.geoPath(projection);
    const raceByState = new Map(this.modeRaces().map((race) => [race.state, race]));

    this.createSvg(container, width, height);
    this.viewport.selectAll("path")
      .data(this.stateFeatures)
      .join("path")
      .attr("class", (feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        return raceByState.has(state) ? "election-map-shape" : "election-map-shape election-map-muted";
      })
      .attr("d", this.path)
      .attr("fill", (feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        const race = raceByState.get(state);
        return race ? raceColor(race) : "#9aa6b8";
      })
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.55)
      .attr("tabindex", (feature) => raceByState.has(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]) ? 0 : -1)
      .on("click keydown", (event, feature) => {
        if (event.type === "keydown" && event.key !== "Enter") return;
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        const race = raceByState.get(state);
        if (race) this.selectRace(race, feature);
      })
      .on("mousemove", (event, feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        this.showTooltip(event, tooltipMarkup(raceByState.get(state), STATE_NAMES[state] || state));
      })
      .on("mouseleave blur", () => this.hideTooltip());

    this.addZoomControls();
  }

  async renderHouseMap(container) {
    if (!this.geo) {
      this.geo = await d3.json("data/house-districts-119.geojson");
    }

    const width = 1160;
    const height = 720;
    const projection = d3.geoAlbersUsa().fitExtent([[18, 18], [width - 18, height - 18]], this.geo);
    this.path = d3.geoPath(projection);
    const raceById = new Map(this.modeRaces().map((race) => [race.id, race]));

    this.createSvg(container, width, height);
    this.viewport.selectAll("path")
      .data(this.geo.features || [])
      .join("path")
      .attr("class", (feature) => raceById.has(feature.properties?.id) ? "election-map-shape" : "election-map-shape election-map-muted")
      .attr("d", this.path)
      .attr("fill", (feature) => {
        const race = raceById.get(feature.properties?.id);
        return race ? raceColor(race) : "#9aa6b8";
      })
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 0.22)
      .attr("tabindex", (feature) => raceById.has(feature.properties?.id) ? 0 : -1)
      .on("click keydown", (event, feature) => {
        if (event.type === "keydown" && event.key !== "Enter") return;
        const race = raceById.get(feature.properties?.id);
        if (race) this.selectRace(race, feature);
      })
      .on("mousemove", (event, feature) => {
        const race = raceById.get(feature.properties?.id);
        this.showTooltip(event, tooltipMarkup(race, feature.properties?.id || "District"));
      })
      .on("mouseleave blur", () => this.hideTooltip());

    this.addZoomControls();
  }

  createSvg(container, width, height) {
    container.innerHTML = "";
    this.svg = d3.select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `${MODE_LABELS[this.selectedMode]} election map`);

    this.viewport = this.svg.append("g").attr("class", "election-map-viewport");
    this.zoom = d3.zoom()
      .scaleExtent([1, 14])
      .on("zoom", (event) => {
        this.viewport.attr("transform", event.transform);
        if (this.currentRace && event.transform.k < 1.18) this.hideFocusPanel();
      });
    this.svg.call(this.zoom);
  }

  addZoomControls() {
    const container = document.getElementById("election-map");
    if (!container) return;
    const controls = document.createElement("div");
    controls.className = "election-map-controls";
    controls.innerHTML = `
      <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
      <button type="button" data-zoom="out" aria-label="Zoom out">−</button>
      <button type="button" data-zoom="reset" aria-label="Reset map">Reset</button>
    `;
    container.appendChild(controls);
    controls.addEventListener("click", (event) => {
      const action = event.target?.dataset?.zoom;
      if (!action || !this.svg || !this.zoom) return;
      if (action === "in") this.svg.transition().duration(220).call(this.zoom.scaleBy, 1.35);
      if (action === "out") this.svg.transition().duration(220).call(this.zoom.scaleBy, 0.75);
      if (action === "reset") this.clearFocus();
    });
  }

  selectRace(race, feature) {
    this.currentRace = race;
    this.renderFocusedRace(race);
    if (feature && this.path && this.zoom && this.svg) this.zoomToFeature(feature);
  }

  zoomToFeature(feature) {
    const [[x0, y0], [x1, y1]] = this.path.bounds(feature);
    const viewBox = this.svg.node().viewBox.baseVal;
    const dx = Math.max(1, x1 - x0);
    const dy = Math.max(1, y1 - y0);
    const scale = Math.min(10, Math.max(1.6, 0.72 / Math.max(dx / viewBox.width, dy / viewBox.height)));
    const tx = viewBox.width / 2 - scale * (x0 + x1) / 2;
    const ty = viewBox.height / 2 - scale * (y0 + y1) / 2;
    this.svg.transition().duration(500).call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  }

  renderFocusedRace(race) {
    const panel = document.getElementById("focused-race-panel");
    const title = document.getElementById("focused-race-title");
    const content = document.getElementById("focused-race-content");
    const rating = document.getElementById("focused-race-rating");
    if (!panel || !title || !content) return;

    const leaderParty = raceWinnerParty(race);
    panel.hidden = false;
    panel.style.setProperty("--focus-color", partyColor(leaderParty));
    panel.classList.toggle("party-dem", leaderParty === "D");
    panel.classList.toggle("party-rep", leaderParty === "R");
    title.textContent = race.title;
    if (rating) rating.textContent = race.rating || "Tracked";

    const rows = topCandidates(race, 4).map((candidate, index) => `
      <tr class="${index === 0 ? "leading" : ""}">
        <td>
          <span class="selected-party-rail" style="background:${partyColor(candidate.party)}"></span>
          <strong>${candidate.name}${candidate.incumbent ? "*" : ""}</strong>
          <small>${candidate.party === "D" ? "Democratic" : candidate.party === "R" ? "Republican" : "Other"}</small>
        </td>
        <td>${hasVotes(race) ? formatPercent(candidate.percent || 0) : formatPercent(candidate.modelChance)}</td>
        <td>${hasVotes(race) ? formatVotes(candidate.votes) : "Forecast"}</td>
      </tr>
    `).join("");

    const margin = Number.isFinite(race.margin) ? `${race.margin >= 0 ? "D" : "R"}+${Math.abs(race.margin).toFixed(1)}` : "No margin";
    const probability = Number.isFinite(race.winnerProbability) ? formatPercent(race.winnerProbability * 100) : "--";
    content.innerHTML = `
      <div class="selected-race-meta">
        <span>${probability} favored</span>
        <span>${margin}</span>
      </div>
      <table class="selected-race-table">
        <thead><tr><th>Candidate</th><th>${hasVotes(race) ? "Percent" : "Model chance"}</th><th>${hasVotes(race) ? "Votes" : "Source"}</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="selected-race-foot">
        <span>${race.reportingPercent == null ? "Forecast estimate" : `${formatPercent(race.reportingPercent)} reporting`}</span>
        <span>${race.subtitle || ""}</span>
      </div>
    `;
  }

  clearFocus() {
    this.currentRace = null;
    this.hideFocusPanel();
    if (this.svg && this.zoom) {
      this.svg.transition().duration(300).call(this.zoom.transform, d3.zoomIdentity);
    }
  }

  hideFocusPanel() {
    const panel = document.getElementById("focused-race-panel");
    if (panel) panel.hidden = true;
  }

  showTooltip(event, html) {
    let tooltip = document.querySelector(".election-map-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "election-map-tooltip";
      document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = html;
    const x = Math.min(window.innerWidth - 340, event.clientX + 8);
    const y = Math.min(window.innerHeight - 220, event.clientY + 8);
    tooltip.style.left = `${Math.max(12, x)}px`;
    tooltip.style.top = `${Math.max(12, y)}px`;
  }

  hideTooltip() {
    document.querySelector(".election-map-tooltip")?.remove();
  }
}

function initElectionNight() {
  if (!window.d3 || !window.topojson) {
    setTimeout(initElectionNight, 60);
    return;
  }
  new ElectionNightPage();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initElectionNight);
} else {
  initElectionNight();
}
