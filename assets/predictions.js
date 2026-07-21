(() => {
  const validFiles = new Map([
    ["senate", "data/predictions/2026-senate-predictions.json"],
    ["house", "data/predictions/2026-house-predictions.json"],
    ["governor", "data/predictions/2026-governor-predictions.json"]
  ]);

  const state = {
    baseData: null,
    data: null,
    selectedRaceId: "",
    mapRenderToken: 0,
    snapshots: [],
    activeSnapshotIndex: -1
  };

  const $ = (id) => document.getElementById(id);
  const ratingOrder = [
    "Safe D", "Likely D", "Lean D", "Tilt D", "Toss-up",
    "Tilt R", "Lean R", "Likely R", "Safe R",
    "Safe I", "Likely I", "Lean I", "Tilt I"
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function numberValue(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function formatNumber(value, digits = 0) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    return number.toLocaleString("en-US", {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    });
  }

  function ratingClass(rating) {
    return `rating-${String(rating || "toss-up").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  }

  function partyClass(party) {
    const normalized = String(party || "").toUpperCase();
    if (normalized === "D") return "prediction-party-d";
    if (normalized === "R") return "prediction-party-r";
    if (normalized === "I") return "prediction-party-i";
    return "";
  }

  function partyName(party) {
    const normalized = String(party || "").toUpperCase();
    if (normalized === "D") return "Democrat";
    if (normalized === "R") return "Republican";
    if (normalized === "I") return "Independent";
    if (normalized === "T") return "Toss-up";
    return normalized || "Other";
  }

  function ratingParty(rating) {
    const text = String(rating || "");
    if (/\bD\b/.test(text)) return "D";
    if (/\bR\b/.test(text)) return "R";
    if (/\bI\b/.test(text)) return "I";
    if (/toss/i.test(text)) return "T";
    return "";
  }

  function formatDate(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function formatSnapshotDate(value) {
    if (!value) return "Current ratings";
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }

  function normalizedConfidence(value) {
    const text = String(value || "").trim();
    if (!text || /^model[_ -]?derived$/i.test(text)) return "Model-informed";
    return text.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function candidateName(race, party) {
    return race?.candidates?.[party]?.name || partyName(party);
  }

  function favoredParty(race) {
    const winner = String(race?.prediction?.winner || "").toUpperCase();
    if (winner === "D" || winner === "R" || winner === "I") return winner;
    return ratingParty(race?.prediction?.rating);
  }

  function favoredName(race) {
    const party = favoredParty(race);
    if (!party || party === "T") return "No clear edge";
    return candidateName(race, party);
  }

  function raceTitle(race) {
    if (!race) return "Selected race";
    const office = String(race.office || state.data?.office || "").toLowerCase();
    if (office === "house") {
      const district = String(race.district || "").toUpperCase();
      return `${race.state || ""} House ${district}`.trim();
    }
    if (office === "senate") return `${race.state || ""} Senate`.trim();
    if (office === "governor") return `${race.state || ""} Governor`.trim();
    return race.displayName || race.raceId || "Selected race";
  }

  function sortedRaces(races = []) {
    return [...races].sort((a, b) => {
      const ar = ratingOrder.indexOf(a.prediction?.rating);
      const br = ratingOrder.indexOf(b.prediction?.rating);
      return (ar < 0 ? 99 : ar) - (br < 0 ? 99 : br)
        || String(a.state || "").localeCompare(String(b.state || ""))
        || String(a.district || "").localeCompare(String(b.district || ""), undefined, { numeric: true })
        || String(a.displayName || "").localeCompare(String(b.displayName || ""));
    });
  }

  function ratingCounts(data) {
    const counts = data?.summary?.counts || {};
    return {
      D: numberValue(counts.D),
      R: numberValue(counts.R),
      I: numberValue(counts.I),
      toss: numberValue(counts["Toss-up"] ?? counts.toss),
      uncalled: numberValue(counts.Uncalled ?? counts.uncalled)
    };
  }

  function displayCounts(data) {
    const counts = ratingCounts(data);
    if (data?.office !== "senate") return counts;
    const notUp = data?.summary?.notUpSeats || data?.summary?.incumbentsNotUp || { D: 33, R: 32, I: 0 };
    return {
      ...counts,
      D: counts.D + numberValue(notUp.D),
      R: counts.R + numberValue(notUp.R),
      I: counts.I + numberValue(notUp.I)
    };
  }

  function raceUnit(data) {
    if (data?.office === "house") return "seats";
    if (data?.office === "governor") return "races";
    return "seats";
  }

  function officeTitle(data) {
    if (data?.office === "house") return "House";
    if (data?.office === "senate") return "Senate";
    if (data?.office === "governor") return "Governors";
    return "Ratings";
  }

  function renderSeatBar(data) {
    const counts = displayCounts(data);
    const total = Math.max(1, counts.D + counts.R + counts.I + counts.toss + counts.uncalled);
    const dWidth = Math.max(0, (counts.D / total) * 100);
    const rWidth = Math.max(0, (counts.R / total) * 100);
    const iWidth = Math.max(0, (counts.I / total) * 100);
    const tossWidth = Math.max(0, ((counts.toss + counts.uncalled) / total) * 100);
    const majority = data?.office === "house" ? 218 : data?.office === "senate" ? 50 : null;
    const majorityPct = majority ? Math.min(100, Math.max(0, (majority / total) * 100)) : 50;
    return `
      <div class="prediction-seatbar" aria-label="FEA ratings balance">
        <span class="prediction-seatbar-segment prediction-seatbar-d" style="width:${dWidth}%"></span>
        <span class="prediction-seatbar-segment prediction-seatbar-i" style="width:${iWidth}%"></span>
        <span class="prediction-seatbar-segment prediction-seatbar-toss" style="width:${tossWidth}%"></span>
        <span class="prediction-seatbar-segment prediction-seatbar-r" style="width:${rWidth}%"></span>
        ${majority ? `<i class="prediction-seatbar-marker" style="left:${majorityPct}%"></i>` : ""}
      </div>
    `;
  }

  function renderPredictionBoard(data) {
    const counts = displayCounts(data);
    const total = Math.max(1, counts.D + counts.R + counts.I + counts.toss + counts.uncalled);
    const demLabel = $("prediction-dem-count");
    const repLabel = $("prediction-rep-count");
    const majorityLabel = $("prediction-majority-label");
    const demBar = $("prediction-bar-dem");
    const repBar = $("prediction-bar-rep");
    const tossBar = $("prediction-bar-toss");
    const majorityLine = $("prediction-majority-line");
    const majority = data?.office === "house" ? 218 : data?.office === "senate" ? 50 : null;
    if (demLabel) demLabel.textContent = `${formatNumber(counts.D)} D`;
    if (repLabel) repLabel.textContent = `${formatNumber(counts.R)} R`;
    if (majorityLabel) majorityLabel.textContent = majority ? `${majority} for majority` : "Rated race balance";
    if (demBar) demBar.style.width = `${Math.max(0, (counts.D / total) * 100)}%`;
    if (repBar) repBar.style.width = `${Math.max(0, (counts.R / total) * 100)}%`;
    if (tossBar) tossBar.style.width = `${Math.max(0, ((counts.toss + counts.uncalled + counts.I) / total) * 100)}%`;
    if (majorityLine) {
      majorityLine.hidden = !majority;
      majorityLine.style.left = majority ? `${Math.max(0, Math.min(100, (majority / total) * 100))}%` : "50%";
    }
  }

  function renderRatingDistribution(data) {
    const ratings = data?.summary?.ratings || {};
    const total = Math.max(1, Object.values(ratings).reduce((sum, value) => sum + numberValue(value), 0));
    const rows = ratingOrder
      .filter((rating) => ratings[rating])
      .map((rating) => {
        const count = numberValue(ratings[rating]);
        const width = Math.max(2, (count / total) * 100);
        return `
          <div class="prediction-rating-row">
            <span class="prediction-pill ${ratingClass(rating)}">${escapeHtml(rating)}</span>
            <div class="prediction-rating-track"><i class="${ratingClass(rating)}" style="width:${width}%"></i></div>
            <b>${count}</b>
          </div>
        `;
      }).join("");
    return rows || `<p class="prediction-note">No rating distribution available.</p>`;
  }

  function renderTopline(data) {
    const container = $("prediction-topline");
    if (!container) return;
    const rawCounts = ratingCounts(data);
    const counts = displayCounts(data);
    const unit = raceUnit(data);
    const raceCount = numberValue(data?.summary?.raceCount || data?.races?.length);
    const competitive = (data?.races || []).filter((race) => /Toss-up|Tilt|Lean/.test(race.prediction?.rating || "")).length;
    const leader = counts.D === counts.R ? "No clear ratings edge" : counts.D > counts.R ? "Democratic ratings edge" : "Republican ratings edge";
    const status = data?.pageStatus || "Published";
    const snapshot = state.snapshots[state.activeSnapshotIndex];
    const snapshotLabel = snapshot ? formatSnapshotDate(snapshot.snapshotDate) : "Newest live file";
    const senateNotUp = data?.office === "senate"
      ? ` Includes ${formatNumber(counts.D - rawCounts.D)} D / ${formatNumber(counts.R - rawCounts.R)} R not up.`
      : "";
    container.innerHTML = `
      <section class="prediction-command-board prediction-command-board-compact">
        <div class="prediction-command-left">
          <span>Democratic-rated ${unit}</span>
          <strong class="prediction-party-d">${formatNumber(counts.D)}</strong>
          <small>Categorical FEA Ratings</small>
        </div>
        <div class="prediction-command-center">
          <span class="prediction-kicker">${escapeHtml(officeTitle(data))} board</span>
          <b>${escapeHtml(leader)}</b>
          ${renderSeatBar(data)}
          <small>${formatNumber(rawCounts.D)} D-rated / ${formatNumber(rawCounts.R)} R-rated current races.${senateNotUp}</small>
        </div>
        <div class="prediction-command-right">
          <span>Republican-rated ${unit}</span>
          <strong class="prediction-party-r">${formatNumber(counts.R)}</strong>
          <small>Categorical FEA Ratings</small>
        </div>
      </section>
      <section class="prediction-summary-strip prediction-summary-strip-compact">
        <span><b>${escapeHtml(status)}</b> ratings board</span>
        <span><b>${formatNumber(raceCount)}</b> rated / <b>${formatNumber(competitive)}</b> competitive</span>
        <span><b>${formatNumber(counts.toss)}</b> toss-up / <b>${formatNumber(counts.uncalled)}</b> unresolved</span>
        <span>Showing <b>${escapeHtml(snapshotLabel)}</b></span>
      </section>
      <section class="prediction-chart-panel prediction-chart-panel-compact">
        <div class="prediction-rating-heading">
          <span class="prediction-kicker">Rating spectrum</span>
          <h2 class="prediction-gradient-title">Where the map stands.</h2>
        </div>
        <div class="prediction-rating-list">${renderRatingDistribution(data)}</div>
      </section>
    `;
  }

  function ensureTimelineNode() {
    const existing = $("prediction-rating-timeline");
    if (existing) return existing;
    const panel = document.querySelector(".prediction-map-panel");
    const shell = document.querySelector(".prediction-map-shell");
    if (!panel || !shell) return null;
    const node = document.createElement("section");
    node.id = "prediction-rating-timeline";
    node.className = "prediction-rating-timeline";
    panel.insertBefore(node, shell);
    return node;
  }

  function renderTimeline() {
    const node = ensureTimelineNode();
    if (!node) return;
    const snapshots = state.snapshots;
    const selected = snapshots[state.activeSnapshotIndex];
    if (!snapshots.length) {
      node.innerHTML = `
        <div class="prediction-rating-timeline-header">
          <span>Ratings timeline</span>
          <strong>Newest live file</strong>
        </div>
        <p class="prediction-note">Weekly rating snapshots will appear here after the first scheduled save.</p>
      `;
      return;
    }
    const active = Math.max(0, state.activeSnapshotIndex);
    node.innerHTML = `
      <div class="prediction-rating-timeline-header">
        <span>Ratings timeline</span>
        <strong>${escapeHtml(formatSnapshotDate(selected?.snapshotDate))}</strong>
      </div>
      <div class="prediction-rating-slider-wrap">
        <input id="prediction-rating-slider" type="range" min="0" max="${snapshots.length - 1}" step="1" value="${active}" aria-label="Select ratings snapshot week">
        <div class="prediction-rating-ticks">
          ${snapshots.map((snapshot, index) => `
            <button type="button" class="prediction-rating-tick ${index === active ? "is-active" : ""}" data-snapshot-index="${index}">
              <i></i><span>${escapeHtml(formatSnapshotDate(snapshot.snapshotDate))}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
    node.querySelector("#prediction-rating-slider")?.addEventListener("input", (event) => {
      selectSnapshot(Number(event.target.value));
    });
    node.querySelectorAll("[data-snapshot-index]").forEach((button) => {
      button.addEventListener("click", () => selectSnapshot(Number(button.dataset.snapshotIndex)));
    });
  }

  function compactCandidate(candidate, party) {
    if (!candidate) return undefined;
    return {
      name: candidate.name || partyName(party),
      party: candidate.party || party,
      status: candidate.status || "",
      incumbent: Boolean(candidate.incumbent)
    };
  }

  function applySnapshot(baseData, snapshot) {
    if (!snapshot) return cloneJson(baseData);
    const data = cloneJson(baseData);
    const snapshotById = new Map((snapshot.races || []).map((race) => [race.raceId, race]));
    data.snapshotDate = snapshot.snapshotDate;
    data.generatedAt = snapshot.generatedAt || data.generatedAt;
    data.lastPublishedAt = snapshot.snapshotDate || data.lastPublishedAt;
    data.summary = {
      ...(data.summary || {}),
      ...(snapshot.summary || {}),
      counts: { ...(data.summary?.counts || {}), ...(snapshot.summary?.counts || {}) },
      ratings: { ...(data.summary?.ratings || {}), ...(snapshot.summary?.ratings || {}) }
    };
    data.races = (data.races || []).map((race) => {
      const saved = snapshotById.get(race.raceId);
      if (!saved) return race;
      return {
        ...race,
        displayName: saved.displayName || race.displayName,
        prediction: {
          ...(race.prediction || {}),
          rating: saved.prediction?.rating || race.prediction?.rating,
          winner: saved.prediction?.winner || race.prediction?.winner,
          confidence: saved.prediction?.confidence || race.prediction?.confidence,
          status: saved.prediction?.status || race.prediction?.status
        },
        candidates: {
          ...(race.candidates || {}),
          ...(saved.candidates || {})
        },
        countyPredictions: saved.countyPredictions || race.countyPredictions || {}
      };
    });
    return data;
  }

  async function loadSnapshotIndex(key) {
    try {
      const response = await fetch("/data/predictions/rating-snapshots/index.json", { cache: "no-store" });
      if (!response.ok) return [];
      const index = await response.json();
      return [...(index.snapshots?.[key] || [])].sort((a, b) => String(a.snapshotDate).localeCompare(String(b.snapshotDate)));
    } catch {
      return [];
    }
  }

  async function loadSnapshots(key) {
    const entries = await loadSnapshotIndex(key);
    const snapshots = [];
    for (const entry of entries) {
      try {
        const response = await fetch(`/${entry.file}`, { cache: "no-store" });
        if (!response.ok) continue;
        snapshots.push(await response.json());
      } catch {
        // A missing historical snapshot should not block the current page.
      }
    }
    return snapshots.sort((a, b) => String(a.snapshotDate).localeCompare(String(b.snapshotDate)));
  }

  function refreshHeader(data) {
    if ($("prediction-title")) $("prediction-title").textContent = data.title || "FEA Ratings";
    if ($("prediction-subtitle")) $("prediction-subtitle").textContent = data.notes?.publicSummary || "Categorical FEA Ratings for the current board.";
    if ($("prediction-updated")) {
      const snapshot = state.snapshots[state.activeSnapshotIndex];
      $("prediction-updated").textContent = snapshot
        ? `${formatSnapshotDate(snapshot.snapshotDate)} snapshot`
        : formatDate(data.lastPublishedAt || data.generatedAt);
    }
  }

  async function renderMap(data) {
    const container = $("prediction-map");
    if (!container) return;
    const token = ++state.mapRenderToken;
    if (!window.FeaPredictionMaps?.renderRaceShapeMap) {
      container.innerHTML = `<p class="prediction-note">Prediction map tools could not load.</p>`;
      return;
    }
    const selectedRace = (data?.races || []).find((item) => item.raceId === state.selectedRaceId);
    container.innerHTML = `<p class="prediction-note">Loading ratings map...</p>`;
    container.classList.remove("is-detail-map");
    if (selectedRace && window.FeaPredictionMaps?.renderCountyShapeMap) {
      try {
        container.classList.add("is-detail-map");
        await window.FeaPredictionMaps.renderCountyShapeMap({
          container,
          race: { ...selectedRace, office: data?.office || selectedRace.office },
          countyValues: selectedRace.countyPredictions || {},
          allRaces: (data?.races || []).map((race) => ({ ...race, office: data?.office || race.office })),
          onRaceSelect: (raceId) => selectRace(raceId),
          isCurrent: () => token === state.mapRenderToken && state.selectedRaceId === selectedRace.raceId
        });
        return;
      } catch (error) {
        if (token !== state.mapRenderToken) return;
        container.classList.remove("is-detail-map");
        container.innerHTML = `<p class="prediction-note">${escapeHtml(error.message || "County-level ratings map unavailable. Showing full board instead.")}</p>`;
      }
    }
    if (token !== state.mapRenderToken) return;
    await window.FeaPredictionMaps.renderRaceShapeMap({
      container,
      data,
      selectedRaceId: state.selectedRaceId,
      onSelect: (raceId) => selectRace(raceId)
    });
  }

  function renderTable(data) {
    const tbody = $("prediction-table-body");
    if (!tbody) return;
    tbody.innerHTML = sortedRaces(data?.races || []).map((race) => {
      const party = favoredParty(race);
      const winnerName = party && party !== "T" ? candidateName(race, party) : "No clear edge";
      return `
        <tr data-race-id="${escapeHtml(race.raceId)}">
          <td><strong>${escapeHtml(raceTitle(race))}</strong><br><small>${escapeHtml(race.state)}${race.district ? `-${escapeHtml(race.district)}` : ""}</small></td>
          <td><span class="prediction-pill ${ratingClass(race.prediction?.rating)}">${escapeHtml(race.prediction?.rating || "--")}</span></td>
          <td class="${partyClass(party)}"><strong>${escapeHtml(winnerName)}</strong></td>
          <td>${escapeHtml(normalizedConfidence(race.prediction?.confidence))}</td>
        </tr>
      `;
    }).join("");
    tbody.querySelectorAll("[data-race-id]").forEach((row) => row.addEventListener("click", () => selectRace(row.dataset.raceId)));
  }

  function winnerRows(race) {
    const order = ["D", "R", "I"];
    const candidates = race?.candidates || {};
    const rows = Object.entries(candidates)
      .sort(([a], [b]) => {
        const ai = order.indexOf(a);
        const bi = order.indexOf(b);
        return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.localeCompare(b);
      })
      .map(([party, candidate]) => ({ party, candidate }));
    if (!rows.length) {
      rows.push({ party: "D", candidate: { name: "Democrat", party: "D" } }, { party: "R", candidate: { name: "Republican", party: "R" } });
    }
    return rows;
  }

  function renderDiagnosticReference(race) {
    const party = favoredParty(race);
    return `
      <div class="prediction-diagnostic-grid">
        <div><span>FEA rating</span><strong>${escapeHtml(race?.prediction?.rating || "Unrated")}</strong></div>
        <div><span>Rated edge</span><strong>${escapeHtml(party && party !== "T" ? partyName(party) : "Toss-up")}</strong></div>
        <div><span>Confidence</span><strong>${escapeHtml(normalizedConfidence(race?.prediction?.confidence))}</strong></div>
        <div><span>Status</span><strong>${escapeHtml(race?.prediction?.status || "Published")}</strong></div>
      </div>
    `;
  }

  function renderDetail(race) {
    const panel = $("prediction-detail");
    if (!panel) return;
    if (!race) {
      panel.hidden = true;
      panel.innerHTML = "";
      return;
    }
    const party = favoredParty(race);
    const rating = race.prediction?.rating || "Unrated";
    const edge = party && party !== "T" ? candidateName(race, party) : "No clear edge";
    const rows = winnerRows(race).map(({ party: rowParty, candidate }) => {
      const isFavored = party === rowParty && party !== "T";
      const rowRating = isFavored ? rating : party === "T" ? "Toss-up" : "--";
      return `
        <tr class="${isFavored ? "leading" : ""}">
          <td>
            <span class="selected-party-rail" style="background:${rowParty === "R" ? "#ff3b45" : rowParty === "D" ? "#2d7cff" : "#48d38a"}"></span>
            <strong>${escapeHtml(candidate?.name || partyName(rowParty))}${candidate?.incumbent ? "*" : ""}</strong>
            <small>${escapeHtml(partyName(candidate?.party || rowParty))}${candidate?.status ? ` / ${escapeHtml(candidate.status)}` : ""}</small>
          </td>
          <td>${escapeHtml(partyName(candidate?.party || rowParty))}</td>
          <td>${escapeHtml(rowRating)}</td>
        </tr>
      `;
    }).join("");
    panel.hidden = false;
    panel.classList.toggle("party-dem", party === "D");
    panel.classList.toggle("party-rep", party === "R");
    panel.style.setProperty("--focus-color", party === "R" ? "#ff3b45" : party === "D" ? "#2d7cff" : "#48d38a");
    panel.innerHTML = `
      <div class="focused-card-head">
        <span class="focused-pill">${escapeHtml(rating)}</span>
        <span class="focused-pill focused-pill-light">${escapeHtml(race.prediction?.status || "Published")}</span>
        <button class="focused-close" type="button" data-close-prediction-detail aria-label="Close selected race">x</button>
      </div>
      <h3 id="focused-race-title">${escapeHtml(raceTitle(race))}</h3>
      <div id="focused-race-content">
        <div class="selected-race-meta">
          <span class="race-meta-chip is-status">${escapeHtml(edge)}</span>
          <span class="race-meta-chip">${escapeHtml(rating)}</span>
          <span class="race-meta-chip">${escapeHtml(normalizedConfidence(race.prediction?.confidence))}</span>
        </div>
        <table class="selected-race-table">
          <thead><tr><th>Candidate</th><th>Party</th><th>FEA rating</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <section class="prediction-focus-note">
          <span class="prediction-kicker">Why we rate it this way</span>
          <p>${escapeHtml(race.notes?.whyWeRateItThisWay || race.notes?.short || "Team reasoning has not been added yet.")}</p>
        </section>
        <section class="prediction-focus-note">
          <span class="prediction-kicker">Rating reference</span>
          ${renderDiagnosticReference(race)}
        </section>
        <div class="selected-race-foot">
          <span>${escapeHtml(state.data?.office || "Prediction")}</span>
          <span>${escapeHtml(race.state || "")}${race.district ? `-${escapeHtml(race.district)}` : ""}</span>
        </div>
      </div>
    `;
    panel.querySelector("[data-close-prediction-detail]")?.addEventListener("click", () => {
      state.mapRenderToken += 1;
      state.selectedRaceId = "";
      document.querySelectorAll("[data-race-id]").forEach((node) => node.classList.remove("is-selected"));
      renderDetail(null);
      renderMap(state.data);
    });
  }

  function selectRace(raceId) {
    state.selectedRaceId = raceId;
    document.querySelectorAll("[data-race-id]").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.raceId === raceId);
    });
    const race = (state.data?.races || []).find((item) => item.raceId === raceId);
    renderDetail(race);
    renderMap(state.data);
  }

  async function selectSnapshot(index) {
    const nextIndex = Math.max(0, Math.min(state.snapshots.length - 1, Number(index)));
    if (!state.snapshots[nextIndex]) return;
    state.activeSnapshotIndex = nextIndex;
    state.selectedRaceId = "";
    state.data = applySnapshot(state.baseData, state.snapshots[nextIndex]);
    await renderPage();
  }

  async function loadPrediction() {
    const body = document.body;
    const key = body?.dataset.predictionKey || "";
    const file = body?.dataset.predictionFile || validFiles.get(key);
    if (!file) throw new Error("Prediction file is not configured.");
    const response = await fetch(`/${file}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Prediction file returned ${response.status}.`);
    return response.json();
  }

  async function renderPage() {
    refreshHeader(state.data);
    renderTopline(state.data);
    renderPredictionBoard(state.data);
    renderTimeline();
    renderDetail(null);
    renderTable(state.data);
    await renderMap(state.data);
  }

  async function init() {
    const root = $("prediction-root");
    try {
      const data = await loadPrediction();
      const key = document.body?.dataset.predictionKey || data.key || data.office;
      state.baseData = data;
      state.snapshots = await loadSnapshots(key);
      state.activeSnapshotIndex = state.snapshots.length ? state.snapshots.length - 1 : -1;
      state.data = state.activeSnapshotIndex >= 0 ? applySnapshot(data, state.snapshots[state.activeSnapshotIndex]) : data;
      await renderPage();
      if (root) root.dataset.loaded = "true";
    } catch (error) {
      if (root) {
        root.innerHTML = `
          <section class="prediction-panel">
            <span class="prediction-kicker">Data</span>
            <h2 class="prediction-gradient-title">Ratings file could not load.</h2>
            <p class="prediction-note">${escapeHtml(error.message || String(error))}</p>
          </section>
        `;
      }
    }
  }

  init();
})();
