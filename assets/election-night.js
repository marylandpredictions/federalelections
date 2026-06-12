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
  U: "#6f7d95"
};

const MODE_LABELS = {
  house: "House",
  senate: "Senate",
  governor: "Governor"
};

const CHAMBER_CONFIG = {
  house: { total: 435, majority: 218, unit: "seats" },
  senate: { total: 100, majority: 51, unit: "seats" }
};

function partyColor(party) {
  return PARTY_COLORS[String(party || "U").toUpperCase()] || PARTY_COLORS.U;
}

function partyLabel(party) {
  const value = String(party || "U").toUpperCase();
  if (value === "D") return "Democratic";
  if (value === "R") return "Republican";
  if (value === "I") return "Independent";
  if (value === "L") return "Libertarian";
  if (value === "G") return "Green";
  return "Other";
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(digits)}%`;
}

function formatVotes(value) {
  return Number.isFinite(value) && value > 0 ? value.toLocaleString() : "0";
}

function safePercent(candidate, raceTotal) {
  if (Number.isFinite(candidate.percent) && candidate.percent > 0) return candidate.percent;
  if (raceTotal > 0 && Number.isFinite(candidate.votes)) return (candidate.votes / raceTotal) * 100;
  return Number.isFinite(candidate.percent) ? candidate.percent : 0;
}

function hasVotes(race) {
  return (race?.candidates || []).some((candidate) => Number.isFinite(candidate.votes) && candidate.votes > 0);
}

function hasActiveResults(race) {
  return hasVotes(race) || Number(race?.reportingPercent || 0) > 0;
}

function isActuallyCalled(race) {
  return hasActiveResults(race) && (race?.status === "called" || (race?.candidates || []).some((candidate) => candidate.isWinner));
}

function totalVotes(race) {
  return (race?.candidates || []).reduce((sum, candidate) => sum + (Number(candidate.votes) || 0), 0);
}

function topCandidates(race, limit = 3) {
  const total = totalVotes(race);
  return (race?.candidates || [])
    .map((candidate) => ({ ...candidate, percent: safePercent(candidate, total) }))
    .sort((a, b) => (b.votes || b.percent || 0) - (a.votes || a.percent || 0))
    .slice(0, limit);
}

function raceLeader(race) {
  if (!hasActiveResults(race)) return null;
  return topCandidates(race, 1)[0] || null;
}

function raceWinnerParty(race) {
  const winner = (race?.candidates || []).find((candidate) => candidate.isWinner && hasActiveResults(race));
  return (winner || raceLeader(race))?.party || "U";
}

function raceColor(race) {
  if (!race || !hasActiveResults(race)) return "#5f6b80";
  const candidates = topCandidates(race, 2);
  const leader = candidates[0];
  const runnerUp = candidates[1];
  if (!leader) return "#5f6b80";
  const margin = Math.max(0, (leader.percent || 0) - (runnerUp?.percent || 0));
  const strength = Math.max(0.44, Math.min(1, 0.46 + margin / 32));
  return d3.interpolateRgb("#cfd6e5", partyColor(leader.party))(strength);
}

function cleanStatus(status) {
  return String(status || "").toLowerCase();
}

function hasRealNominee(status) {
  const value = cleanStatus(status);
  return value === "nominee" || value === "presumptive" || value === "resolved-or-filed";
}

function candidateName(name, party, status) {
  if (!name || !hasRealNominee(status)) {
    if (party === "D") return "Democrat";
    if (party === "R") return "Republican";
    return "Candidate";
  }
  return name;
}

function normalizeCandidate(candidate) {
  const party = String(candidate.party || candidate.partyCode || "U").toUpperCase();
  return {
    name: candidate.name || candidate.candidateName || partyLabel(party),
    party,
    votes: Number(candidate.votes) || 0,
    percent: Number.isFinite(Number(candidate.percent)) ? Number(candidate.percent) : 0,
    isWinner: Boolean(candidate.isWinner || candidate.winner),
    incumbent: Boolean(candidate.incumbent || candidate.isIncumbent)
  };
}

function buildFallbackCandidate(party, name, status) {
  return {
    name: candidateName(name, party, status),
    party,
    votes: 0,
    percent: 0,
    isWinner: false,
    incumbent: false
  };
}

function houseGeometryId(race) {
  const state = race?.state;
  const district = race?.district;
  if (!state) return null;
  if (district === "AL" || district === 0 || district === "0" || district == null) return `${state}-AL`;
  return `${state}-${String(district).padStart(2, "0")}`;
}

function raceIdFromHouseGeometryId(id) {
  const [state, district] = String(id || "").split("-");
  if (!state || !district) return "";
  return `house-${state}-${district === "AL" ? "AL" : String(Number(district))}`;
}

function normalizeElectionRace(race, fallbackCandidates) {
  const candidates = (race.candidates || []).map(normalizeCandidate);
  const normalized = {
    id: race.id,
    type: race.type,
    state: race.state,
    district: race.district,
    title: race.electionName || race.title || `${STATE_NAMES[race.state] || race.state} ${MODE_LABELS[race.type] || "Race"}`,
    subtitle: race.subtitle || "",
    status: race.status || "",
    reportingPercent: Number.isFinite(Number(race.reportingPercent)) ? Number(race.reportingPercent) : null,
    candidates
  };

  if (!hasActiveResults(normalized) && fallbackCandidates?.length) {
    normalized.candidates = fallbackCandidates;
    normalized.status = "";
    normalized.reportingPercent = null;
  }

  return normalized;
}

function buildNameLookups(house, senate, governor) {
  const lookups = { house: new Map(), senate: new Map(), governor: new Map() };

  for (const district of house?.districts || []) {
    const id = district.id || `${district.state}-${String(district.district).padStart(2, "0")}`;
    lookups.house.set(id, [
      buildFallbackCandidate("D", district.demCandidate, district.demStatus),
      buildFallbackCandidate("R", district.repCandidate, district.repStatus)
    ]);
  }

  for (const race of senate?.races || []) {
    lookups.senate.set(race.state, [
      buildFallbackCandidate("D", race.dem, race.demStatus),
      buildFallbackCandidate("R", race.rep, race.repStatus)
    ]);
  }

  for (const race of governor?.races || []) {
    lookups.governor.set(race.state, [
      buildFallbackCandidate("D", race.demCandidate || race.dem, race.demStatus),
      buildFallbackCandidate("R", race.repCandidate || race.rep, race.repStatus)
    ]);
  }

  return lookups;
}

function fallbackCandidatesForRace(race, lookups) {
  if (race.type === "house") return lookups.house.get(houseGeometryId(race)) || null;
  if (race.type === "senate") return lookups.senate.get(race.state) || null;
  if (race.type === "governor") return lookups.governor.get(race.state) || null;
  return null;
}

function tooltipMarkup(race, title) {
  if (!race) {
    return `<div class="election-map-tooltip-title">${title}</div><div class="election-map-tooltip-muted">No tracked race</div>`;
  }

  const live = hasActiveResults(race);
  const rows = topCandidates(race, 3).map((candidate, index) => {
    const color = partyColor(candidate.party);
    const value = live ? formatPercent(candidate.percent || 0) : "Awaiting";
    return `
      <tr class="${index === 0 && live ? "leading" : ""}">
        <td><span class="tooltip-party-bar" style="background:${color}"></span>${candidate.name}${candidate.incumbent ? "*" : ""}</td>
        <td>${value}</td>
        <td>${live ? formatVotes(candidate.votes) : ""}</td>
      </tr>
    `;
  }).join("");

  const status = live
    ? `${formatPercent(race.reportingPercent || 0, 0)} reporting`
    : "No results yet";
  return `
    <div class="election-map-tooltip-title">${race.title || title}</div>
    <table class="election-map-tooltip-table">
      <tbody>${rows}</tbody>
    </table>
    <div class="election-map-tooltip-foot">
      <span>${status}</span>
      <span>${isActuallyCalled(race) ? "Called" : "Uncalled"}</span>
    </div>
  `;
}

class ElectionNightPage {
  constructor() {
    this.selectedMode = localStorage.getItem("electionNightMode") || "house";
    this.dataByMode = { house: [], senate: [], governor: [] };
    this.geo = null;
    this.stateFeatures = null;
    this.nameLookups = { house: new Map(), senate: new Map(), governor: new Map() };
    this.houseExpandedFromGeometry = false;
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
    this.bindFocusPanelDrag();
  }

  async loadData() {
    const [results, house, senate, governor] = await Promise.all([
      this.safeJson("data/election-night-races.json"),
      this.safeJson("data/house-forecast.json"),
      this.safeJson("data/forecast.json"),
      this.safeJson("data/governor-forecast.json")
    ]);

    const lookups = buildNameLookups(house, senate, governor);
    this.nameLookups = lookups;
    const races = (results?.races || []).map((race) => normalizeElectionRace(race, fallbackCandidatesForRace(race, lookups)));
    this.dataByMode.house = races.filter((race) => race.type === "house");
    this.dataByMode.senate = races.filter((race) => race.type === "senate");
    this.dataByMode.governor = races.filter((race) => race.type === "governor");
  }

  ensureAllHouseRacesFromGeometry() {
    if (this.houseExpandedFromGeometry || !this.geo?.features?.length) return;
    const existing = new Map(this.dataByMode.house.map((race) => [houseGeometryId(race), race]));
    for (const feature of this.geo.features) {
      const geometryId = feature.properties?.id;
      if (!geometryId || existing.has(geometryId)) continue;
      const [state, district] = geometryId.split("-");
      const fallback = this.nameLookups.house.get(geometryId) || [
        buildFallbackCandidate("D", null, null),
        buildFallbackCandidate("R", null, null)
      ];
      existing.set(geometryId, {
        id: raceIdFromHouseGeometryId(geometryId),
        type: "house",
        state,
        district: district === "AL" ? "AL" : Number(district),
        title: `${STATE_NAMES[state] || state} US House ${district === "AL" ? "At-Large" : Number(district)}`,
        subtitle: "",
        status: "",
        reportingPercent: null,
        candidates: fallback
      });
    }
    this.dataByMode.house = [...existing.values()].sort((a, b) => {
      if (a.state !== b.state) return String(a.state).localeCompare(String(b.state));
      const ad = a.district === "AL" ? 0 : Number(a.district) || 0;
      const bd = b.district === "AL" ? 0 : Number(b.district) || 0;
      return ad - bd;
    });
    this.houseExpandedFromGeometry = true;
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
    const called = races.filter(isActuallyCalled);
    const reporting = races.filter(hasActiveResults).length;
    const dem = called.filter((race) => raceWinnerParty(race) === "D").length;
    const rep = called.filter((race) => raceWinnerParty(race) === "R").length;

    document.getElementById("summary-label").textContent = `${MODE_LABELS[this.selectedMode]} board`;
    document.getElementById("total-races").textContent = "Map";
    document.getElementById("called-races").textContent = "election night map";
    document.getElementById("dem-seats").textContent = String(dem);
    document.getElementById("rep-seats").textContent = String(rep);
    document.getElementById("dem-summary-label").textContent = this.selectedMode === "governor" ? "Dem wins" : "Dem called";
    document.getElementById("rep-summary-label").textContent = this.selectedMode === "governor" ? "GOP wins" : "GOP called";
    document.getElementById("dem-share-label").textContent = "actual calls";
    document.getElementById("rep-share-label").textContent = "actual calls";
    document.getElementById("reporting-percent").textContent = reporting ? String(reporting) : "--";
    document.getElementById("last-updated").textContent = reporting ? "active result feeds" : "results pending";
    this.renderChamberBar(dem, rep, called.length);
  }

  renderChamberBar(dem, rep, called) {
    const board = document.querySelector(".election-chamber-board");
    if (board) board.hidden = this.selectedMode === "governor";
    if (this.selectedMode === "governor") return;
    const config = CHAMBER_CONFIG[this.selectedMode] || CHAMBER_CONFIG.house;
    const uncalled = Math.max(0, config.total - dem - rep);
    const demPct = (dem / config.total) * 100;
    const repPct = (rep / config.total) * 100;
    const majorityPct = (config.majority / config.total) * 100;

    const title = document.getElementById("chamber-board-title");
    const subtitle = document.getElementById("chamber-board-subtitle");
    const demLabel = document.getElementById("chamber-dem-count");
    const repLabel = document.getElementById("chamber-rep-count");
    const majorityLabel = document.getElementById("chamber-majority-label");
    const demBar = document.getElementById("chamber-bar-dem");
    const repBar = document.getElementById("chamber-bar-rep");
    const uncalledBar = document.getElementById("chamber-bar-uncalled");
    const majorityLine = document.getElementById("chamber-majority-line");

    if (title) title.textContent = `${MODE_LABELS[this.selectedMode]} call tracker`;
    if (subtitle) subtitle.textContent = called ? `${called} called from result data.` : "Calls will appear here.";
    if (demLabel) demLabel.textContent = `${dem} D`;
    if (repLabel) repLabel.textContent = `${rep} R`;
    if (majorityLabel) majorityLabel.textContent = `${config.majority} for majority`;
    if (demBar) demBar.style.width = `${demPct}%`;
    if (uncalledBar) uncalledBar.style.width = `${(uncalled / config.total) * 100}%`;
    if (repBar) repBar.style.width = `${repPct}%`;
    if (majorityLine) majorityLine.style.left = `${majorityPct}%`;
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
    this.viewport.selectAll(".state-result-shape")
      .data(this.stateFeatures)
      .join("path")
      .attr("class", (feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        return raceByState.has(state) ? "state-result-shape election-map-shape" : "state-result-shape election-map-shape election-map-muted";
      })
      .attr("d", this.path)
      .attr("fill", (feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        const race = raceByState.get(state);
        return race ? raceColor(race) : "#334054";
      })
      .attr("stroke", "#e2e8ff")
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
    if (!this.stateFeatures) {
      const us = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
      this.stateFeatures = topojson.feature(us, us.objects.states).features;
    }
    this.ensureAllHouseRacesFromGeometry();
    this.renderSummary();

    const width = 1160;
    const height = 720;
    const projection = d3.geoAlbersUsa().fitExtent([[20, 20], [width - 20, height - 20]], {
      type: "FeatureCollection",
      features: this.stateFeatures
    });
    this.path = d3.geoPath(projection);
    const raceById = new Map(this.modeRaces().map((race) => [houseGeometryId(race), race]));

    this.createSvg(container, width, height);
    this.viewport.selectAll(".state-base")
      .data(this.stateFeatures || [])
      .join("path")
      .attr("class", "state-base")
      .attr("d", this.path)
      .attr("fill", "#182945")
      .attr("stroke", "rgba(226,232,255,.32)")
      .attr("stroke-width", 0.45)
      .attr("pointer-events", "none");

    this.viewport.selectAll(".house-result-district")
      .data(this.geo.features || [])
      .join("path")
      .attr("class", (feature) => raceById.has(feature.properties?.id) ? "house-result-district election-map-shape" : "house-result-district election-map-shape election-map-muted")
      .attr("d", this.path)
      .attr("fill", (feature) => {
        const race = raceById.get(feature.properties?.id);
        return race ? raceColor(race) : "#334054";
      })
      .attr("stroke", "#e2e8ff")
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
      <button type="button" data-zoom="out" aria-label="Zoom out">-</button>
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

    const live = hasActiveResults(race);
    const leaderParty = raceWinnerParty(race);
    panel.hidden = false;
    panel.classList.remove("is-dragging");
    panel.style.setProperty("--focus-color", partyColor(leaderParty));
    panel.classList.toggle("party-dem", leaderParty === "D");
    panel.classList.toggle("party-rep", leaderParty === "R");
    title.textContent = race.title;
    if (rating) rating.textContent = isActuallyCalled(race) ? "Called" : live ? "Reporting" : "Awaiting results";

    const rows = topCandidates(race, 5).map((candidate, index) => `
      <tr class="${index === 0 && live ? "leading" : ""}">
        <td>
          <span class="selected-party-rail" style="background:${partyColor(candidate.party)}"></span>
          <strong>${candidate.name}${candidate.incumbent ? "*" : ""}</strong>
          <small>${partyLabel(candidate.party)}</small>
        </td>
        <td>${live ? formatPercent(candidate.percent || 0) : "--"}</td>
        <td>${live ? formatVotes(candidate.votes) : "Awaiting"}</td>
      </tr>
    `).join("");

    content.innerHTML = `
      <div class="selected-race-meta">
        <span>${live ? `${formatPercent(race.reportingPercent || 0)} reporting` : "No results yet"}</span>
        <span>${isActuallyCalled(race) ? "Race called" : "Uncalled"}</span>
      </div>
      <table class="selected-race-table">
        <thead><tr><th>Candidate</th><th>Percent</th><th>Votes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="selected-race-foot">
        <span>${MODE_LABELS[race.type] || "Race"}</span>
        <span>${STATE_NAMES[race.state] || race.state}</span>
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
    if (panel) {
      panel.hidden = true;
      this.resetFocusPanelPosition(panel);
    }
  }

  showTooltip(event, html) {
    let tooltip = document.querySelector(".election-map-tooltip");
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.className = "election-map-tooltip";
      document.body.appendChild(tooltip);
    }
    tooltip.innerHTML = html;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const rect = tooltip.getBoundingClientRect();
    let x = event.clientX + 14;
    let y = event.clientY + 14;
    if (x + rect.width > window.innerWidth - 12) x = event.clientX - rect.width - 14;
    if (y + rect.height > window.innerHeight - 12) y = event.clientY - rect.height - 14;
    tooltip.style.left = `${Math.max(12, x)}px`;
    tooltip.style.top = `${Math.max(12, y)}px`;
  }

  hideTooltip() {
    document.querySelector(".election-map-tooltip")?.remove();
  }

  resetFocusPanelPosition(panel = document.getElementById("focused-race-panel")) {
    if (!panel) return;
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    panel.style.bottom = "";
  }

  bindFocusPanelDrag() {
    const panel = document.getElementById("focused-race-panel");
    const handle = panel?.querySelector(".focused-card-head");
    const shell = document.querySelector(".election-map-shell");
    if (!panel || !handle || !shell) return;
    let drag = null;
    handle.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button")) return;
      const shellRect = shell.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      panel.style.left = `${panelRect.left - shellRect.left}px`;
      panel.style.top = `${panelRect.top - shellRect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: panelRect.left - shellRect.left,
        top: panelRect.top - shellRect.top
      };
      panel.classList.add("is-dragging");
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const shellRect = shell.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const nextLeft = Math.max(8, Math.min(shellRect.width - panelRect.width - 8, drag.left + event.clientX - drag.startX));
      const nextTop = Math.max(8, Math.min(shellRect.height - panelRect.height - 8, drag.top + event.clientY - drag.startY));
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });
    handle.addEventListener("pointerup", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      panel.classList.remove("is-dragging");
      drag = null;
      handle.releasePointerCapture(event.pointerId);
    });
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
