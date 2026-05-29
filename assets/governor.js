(function () {
  const FIPS_TO_STATE_LOCAL = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"
  };

  const STATE_NAMES_LOCAL = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
  };

  const ratings = {
    "Safe D": "safe-d", "Likely D": "likely-d", "Lean D": "lean-d", "Tilt D": "tilt-d", "Toss-up": "tossup",
    "Tilt R": "tilt-r", "Lean R": "lean-r", "Likely R": "likely-r", "Safe R": "safe-r"
  };

  const MAP_COLOR_MODES = {
    rating: "Rating",
    margin: "Projected margin",
    probability: "Win probability"
  };

  let mapColorMode = "rating";
  let governorData = null;

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
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

  function oneDecimal(value) {
    return `${((Number(value) || 0) * 100).toFixed(1)}%`;
  }

  function signedMargin(value) {
    const margin = Number(value) || 0;
    if (Math.abs(margin) < 0.05) return "Tie";
    return `${margin > 0 ? "D" : "R"}+${Math.abs(margin).toFixed(1)}`;
  }

  function leaderClass(race) {
    return race.demProbability >= .5 ? "leads-dem" : "leads-rep";
  }

  function candidateDisplayName(race, party) {
    const name = party === "D" ? race.dem : race.rep;
    const status = party === "D" ? race.demStatus : race.repStatus;
    if (status === "unresolved" && (name === "Democrat" || name === "Republican")) return name;
    if (status === "unresolved" && ["Democratic field", "Republican field"].includes(name)) return party === "D" ? "Democratic field" : "Republican field";
    return name || (party === "D" ? "Democrat" : "Republican");
  }

  function candidateBadge(race, party) {
    const status = party === "D" ? race.demStatus : race.repStatus;
    const displayParty = party === "D" ? race.demDisplayParty : race.repDisplayParty;
    if (displayParty) return displayParty;
    if (status === "unresolved") return party;
    return party;
  }

  function presumptiveBadge(race, party) {
    const status = party === "D" ? race.demStatus : race.repStatus;
    return status === "presumptive" ? `<i class="presumptive-badge">P</i>` : "";
  }

  function extraCandidateRows(race) {
    const competitiveIndependents = (race.extraCandidates || []).filter((candidate) => {
      return candidate.party === "I" && candidate.note && candidate.note.toLowerCase().includes("competitive");
    });
    return competitiveIndependents.map((candidate) => {
      const party = candidate.party || "I";
      const badgeClass = party === "D" ? "party-badge dem-badge" : party === "R" ? "party-badge rep-badge" : "ind-badge";
      const label = party === "I" ? "Independent" : party === "D" ? "Democratic option" : "Republican option";
      return `
        <div class="candidate-row extra-row">
          <span>${escapeHtml(candidate.name)} <i class="${badgeClass}">${escapeHtml(party)}</i></span>
          <strong>${escapeHtml(label)}</strong>
        </div>
      `;
    }).join("");
  }

  function ratingColor(race) {
    const cssVar = {
      "Safe D": "--safe-d", "Likely D": "--likely-d", "Lean D": "--lean-d", "Tilt D": "--tilt-d", "Toss-up": "--toss",
      "Tilt R": "--tilt-r", "Lean R": "--lean-r", "Likely R": "--likely-r", "Safe R": "--safe-r"
    }[race.modelRating || race.rating] || "--toss";
    return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  }

  function marginColor(race) {
    const margin = race.margin || 0;
    if (margin > 0) {
      return getComputedStyle(document.documentElement).getPropertyValue("--dem").trim();
    } else if (margin < 0) {
      return getComputedStyle(document.documentElement).getPropertyValue("--rep").trim();
    } else {
      return getComputedStyle(document.documentElement).getPropertyValue("--toss").trim();
    }
  }

  function probabilityColor(race) {
    const demProb = race.demProbability || 0.5;
    if (demProb > 0.6) {
      return getComputedStyle(document.documentElement).getPropertyValue("--dem").trim();
    } else if (demProb < 0.4) {
      return getComputedStyle(document.documentElement).getPropertyValue("--rep").trim();
    } else {
      return getComputedStyle(document.documentElement).getPropertyValue("--toss").trim();
    }
  }

  function getColorForMode(race, mode) {
    switch (mode) {
      case "margin":
        return marginColor(race);
      case "probability":
        return probabilityColor(race);
      default:
        return ratingColor(race);
    }
  }

  function renderSummary(data) {
    const demRaces = data.projectedDemRaceWins ?? data.races.filter((race) => race.demProbability >= .5).length;
    const repRaces = data.projectedRepRaceWins ?? data.races.length - demRaces;
    const demGovernors = Number(data.averageDemGovernors ?? data.medianDemGovernors ?? 0);
    const repGovernors = Number(data.averageRepGovernors ?? data.medianRepGovernors ?? 0);
    setText("governor-run-date", data.runDate || data.modelDate || "--");
    setText("governor-sim-count", Number(data.settings?.simulations || 0).toLocaleString("en-US"));
    setText("governor-watch-count", data.races.filter((race) => race.competitive).length);
    setText("governor-dem-races", demRaces);
    setText("governor-rep-races", repRaces);
    setText("governor-average", `${demGovernors.toFixed(1)} D / ${repGovernors.toFixed(1)} R`);
    setText("governor-median", `${data.medianDemGovernors} D / ${data.medianRepGovernors} R`);
    setText("governor-control-headline", `Democrats lead ${demRaces} of 36 races; Republicans lead ${repRaces}.`);
    const odds = document.getElementById("governor-odds-phrase");
    if (odds) odds.innerHTML = `<span>Race leads</span><strong>${demRaces} D / ${repRaces} R</strong>`;
    const demBar = document.getElementById("governor-dem-bar");
    const repBar = document.getElementById("governor-rep-bar");
    if (demBar) demBar.style.width = `${(demRaces / 36) * 100}%`;
    if (repBar) repBar.style.width = `${(repRaces / 36) * 100}%`;
  }

  function renderFallbackMap(data) {
    const map = document.getElementById("governor-map");
    if (!map) return;
    map.innerHTML = `
      <div class="fallback-list governor-state-grid">
        ${data.races.map((race) => `
          <button type="button" class="${leaderClass(race)}" style="background:${ratingColor(race)}" title="${escapeHtml(race.displayName)}: ${escapeHtml(race.modelRating || race.rating)}">
            ${escapeHtml(race.state)}
          </button>
        `).join("")}
      </div>
      <p class="map-note">State-shape map could not load, so the page is showing compact state tiles.</p>
    `;
    const hover = document.getElementById("governor-map-hover-card");
    const top = [...data.races].sort((a, b) => b.tippingPower - a.tippingPower)[0];
    if (hover && top) renderHover(hover, top);
    map.querySelectorAll("button").forEach((button, index) => {
      button.addEventListener("mouseenter", () => renderHover(hover, data.races[index]));
      button.addEventListener("focus", () => renderHover(hover, data.races[index]));
    });
  }

  async function renderMap(data) {
    const map = document.getElementById("governor-map");
    if (!map) return;
    if (!window.d3 || !window.topojson) {
      renderFallbackMap(data);
      return;
    }
    try {
      const us = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
      const features = topojson.feature(us, us.objects.states).features;
      const racesByState = new Map(data.races.map((race) => [race.state, race]));
      const width = 960;
      const height = 610;
      const projection = d3.geoAlbersUsa().fitSize([width, height], { type: "FeatureCollection", features });
      const path = d3.geoPath(projection);
      map.innerHTML = "";
      const svg = d3.select(map).append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "State-shape map of 2026 gubernatorial race ratings");
      svg.selectAll("path")
        .data(features)
        .join("path")
        .attr("class", (feature) => {
          const state = FIPS_TO_STATE_LOCAL[String(feature.id).padStart(2, "0")];
          return racesByState.has(state) ? "state-shape" : "state-shape state-muted";
        })
        .attr("d", path)
        .attr("fill", (feature) => {
          const state = FIPS_TO_STATE_LOCAL[String(feature.id).padStart(2, "0")];
          const race = racesByState.get(state);
          return race ? getColorForMode(race, mapColorMode) : null;
        })
        .attr("tabindex", (feature) => {
          const state = FIPS_TO_STATE_LOCAL[String(feature.id).padStart(2, "0")];
          return racesByState.has(state) ? 0 : -1;
        })
        .on("mouseenter focus", (event, feature) => {
          const state = FIPS_TO_STATE_LOCAL[String(feature.id).padStart(2, "0")];
          renderHover(document.getElementById("governor-map-hover-card"), racesByState.get(state));
        })
        .on("click", (event, feature) => {
          const state = FIPS_TO_STATE_LOCAL[String(feature.id).padStart(2, "0")];
          if (racesByState.has(state)) window.location.href = `governor-race.html?state=${state}`;
        })
        .append("title")
        .text((feature) => {
          const state = FIPS_TO_STATE_LOCAL[String(feature.id).padStart(2, "0")];
          const race = racesByState.get(state);
          return race ? `${STATE_NAMES_LOCAL[state]}: ${race.modelRating || race.rating}` : STATE_NAMES_LOCAL[state];
        });
      renderHover(document.getElementById("governor-map-hover-card"), [...data.races].sort((a, b) => b.tippingPower - a.tippingPower)[0]);
    } catch {
      renderFallbackMap(data);
    }
  }

  function renderHover(hover, race) {
    if (!hover || !race) return;
    const leader = race.demProbability >= .5 ? "Democrat" : "Republican";
    const probability = Math.max(race.demProbability, race.repProbability);
    hover.innerHTML = `
      <span class="race-kicker">${escapeHtml(race.displayName)}</span>
      <div class="map-card-title">
        <div class="state-code">${escapeHtml(race.state)}</div>
        <span class="rating-pill ${ratings[race.modelRating || race.rating] || "tossup"}">${escapeHtml(race.modelRating || race.rating)}</span>
      </div>
      <h3>${leader} leads with a ${oneDecimal(probability)} race win chance.</h3>
      <div class="candidate-table">
        <div class="candidate-table-head"><span>Side</span><span>Chance</span></div>
        <div class="candidate-row dem-row"><span>${escapeHtml(candidateDisplayName(race, "D"))} <i class="party-badge dem-badge">${escapeHtml(candidateBadge(race, "D"))}</i>${presumptiveBadge(race, "D")}</span><strong>${oneDecimal(race.demProbability)}</strong></div>
        <div class="candidate-row rep-row"><span>${escapeHtml(candidateDisplayName(race, "R"))} <i class="party-badge rep-badge">${escapeHtml(candidateBadge(race, "R"))}</i>${presumptiveBadge(race, "R")}</span><strong>${oneDecimal(race.repProbability)}</strong></div>
        ${extraCandidateRows(race)}
        <div class="candidate-margin"><span>Projected margin</span><strong>${signedMargin(race.margin)}</strong></div>
      </div>
      <p>${escapeHtml(race.status)}. Incumbent party: ${escapeHtml(race.incumbentParty)}.</p>
      <p class="meta">Inputs: ${escapeHtml(race.rating)} rating, ${escapeHtml(String(race.pvi))} PVI, ${signedMargin(race.lastMargin)} last governor margin.</p>
      <a class="button-link" href="governor-race.html?state=${escapeHtml(race.state)}">Open race page</a>
    `;
  }

  function renderLegend() {
    const legend = document.getElementById("governor-map-legend");
    if (!legend) return;
    if (mapColorMode === "rating") {
      legend.innerHTML = Object.keys(ratings).map((rating) => `<span><i class="${ratings[rating]}"></i>${rating}</span>`).join("");
    } else if (mapColorMode === "margin") {
      legend.innerHTML = `<span><i style="background:var(--dem)"></i>Democratic margin</span><span><i style="background:var(--rep)"></i>Republican margin</span><span><i style="background:var(--toss)"></i>Tie</span>`;
    } else if (mapColorMode === "probability") {
      legend.innerHTML = `<span><i style="background:var(--dem)"></i>Democratic favored</span><span><i style="background:var(--rep)"></i>Republican favored</span><span><i style="background:var(--toss)"></i>Toss-up</span>`;
    }
  }

  function renderMapColorControls() {
    const container = document.getElementById("governor-map-color-controls");
    if (!container) return;
    container.innerHTML = Object.entries(MAP_COLOR_MODES).map(([mode, label]) => (
      `<button type="button" class="${mode === mapColorMode ? "active" : ""}" data-map-color="${mode}">${label}</button>`
    )).join("");
    container.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        mapColorMode = button.dataset.mapColor || "rating";
        renderMapColorControls();
        renderLegend();
        if (governorData) renderMap(governorData);
      });
    });
  }

  function renderGovernorCountHistory(data) {
    const chart = document.getElementById("governor-count-history-chart");
    if (!chart) return;
    const points = data.governorCountHistory?.length ? data.governorCountHistory : [{ date: data.modelDate, demGovernors: data.medianDemGovernors, repGovernors: data.medianRepGovernors }];
    const convertedPoints = points.map((point) => ({
      date: point.date,
      dem: point.demGovernors,
      rep: point.repGovernors
    }));
    if (typeof renderLineChart === "function") {
      renderLineChart(chart, convertedPoints, {
        label: "Projected governor count history",
        domain: [15, 35],
        ticks: [35, 30, 25, 20, 15],
        band: 1.5,
        valueFormat: (value) => value.toFixed(0),
        endLabel: (party, value) => `${party === "dem" ? "Democratic" : "Republican"} governors ${value.toFixed(0)}`,
        hoverLabel: (party, value) => `${party === "dem" ? "Democratic" : "Republican"} governors ${value.toFixed(0)}`,
        electionDate: data.settings?.electionDate || "2026-11-03",
        singleNote: "Governor count history starts with the first generated forecast and grows each daily run."
      });
    } else {
      chart.innerHTML = `<p class="meta">Chart rendering not available. Median: ${data.medianDemGovernors} D / ${data.medianRepGovernors} R</p>`;
    }
  }

  function renderBoard(data) {
    const board = document.getElementById("governor-race-board");
    if (!board) return;
    const rows = [...data.races].sort((a, b) => Math.abs(a.demProbability - .5) - Math.abs(b.demProbability - .5));
    board.innerHTML = rows.map((race) => {
      const leader = race.demProbability >= .5 ? "D" : "R";
      const probability = Math.max(race.demProbability, race.repProbability);
      return `
        <a class="race-board-row governor-race-row ${leaderClass(race)}" href="governor-race.html?state=${escapeHtml(race.state)}">
          <strong>${escapeHtml(race.state)}</strong>
          <span>${escapeHtml(race.displayName)}</span>
          <span>${escapeHtml(candidateDisplayName(race, "D"))}</span>
          <span>${escapeHtml(candidateDisplayName(race, "R"))}</span>
          <span>${escapeHtml(race.modelRating || race.rating)}</span>
          <span>${signedMargin(race.margin)}</span>
          <span>${leader} ${oneDecimal(probability)}</span>
        </a>
      `;
    }).join("");
  }

  function renderError(error) {
    const board = document.getElementById("governor-race-board");
    if (board) {
      board.innerHTML = `<p class="meta">Governor forecast data did not load. Run <code>npm start</code> and open <code>http://127.0.0.1:8000/governor.html</code>. ${escapeHtml(error.message || "")}</p>`;
    }
  }

  async function initGovernorPage() {
    if (!document.getElementById("governor-race-board")) return;
    try {
      const response = await fetch("data/governor-forecast.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      governorData = data;
      renderSummary(data);
      renderMap(data);
      renderLegend();
      renderMapColorControls();
      renderGovernorCountHistory(data);
      renderBoard(data);
    } catch (error) {
      renderError(error);
    }
  }

  initGovernorPage();
})();
