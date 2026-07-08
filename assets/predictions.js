(() => {
  const validFiles = new Map([
    ["senate", "data/predictions/2026-senate-predictions.json"],
    ["house", "data/predictions/2026-house-predictions.json"],
    ["governor", "data/predictions/2026-governor-predictions.json"],
    ["president", "data/predictions/2028-presidential-predictions.json"]
  ]);

  const state = {
    data: null,
    selectedRaceId: ""
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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

  function formatMargin(race) {
    const winner = race?.prediction?.winner || "";
    const margin = Number(race?.prediction?.projectedMargin);
    if (!Number.isFinite(margin)) return "--";
    if (winner === "Toss-up" || Math.abs(margin) < 0.05) return "Even";
    return `${winner}+${margin.toFixed(1)}`;
  }

  function candidateName(race, party) {
    return race?.candidates?.[party]?.name || (party === "D" ? "Democrat" : party === "R" ? "Republican" : "Independent");
  }

  function sortedRaces(races = []) {
    const ratingOrder = {
      "Toss-up": 0,
      "Tilt D": 1, "Tilt R": 1,
      "Lean D": 2, "Lean R": 2,
      "Likely D": 3, "Likely R": 3,
      "Safe D": 4, "Safe R": 4,
      "Tilt I": 1, "Lean I": 2, "Likely I": 3, "Safe I": 4
    };
    return [...races].sort((a, b) => {
      const ar = ratingOrder[a.prediction?.rating] ?? 9;
      const br = ratingOrder[b.prediction?.rating] ?? 9;
      return ar - br
        || String(a.state || "").localeCompare(String(b.state || ""))
        || String(a.district || "").localeCompare(String(b.district || ""), undefined, { numeric: true })
        || String(a.displayName || "").localeCompare(String(b.displayName || ""));
    });
  }

  function projectedCounts(data) {
    const counts = data?.summary?.counts || {};
    return {
      D: Number(counts.D || 0),
      R: Number(counts.R || 0),
      I: Number(counts.I || 0),
      toss: Number(counts["Toss-up"] || 0)
    };
  }

  function renderTopline(data) {
    const container = $("prediction-topline");
    if (!container) return;
    const counts = projectedCounts(data);
    const raceCount = Number(data?.summary?.raceCount || data?.races?.length || 0);
    const competitive = (data?.races || []).filter((race) => /Toss-up|Tilt|Lean/.test(race.prediction?.rating || "")).length;
    const leader = counts.D === counts.R ? "No clear edge" : counts.D > counts.R ? "Democratic edge" : "Republican edge";
    const modelStatus = data?.sourceModelRunId ? "Model reference loaded" : "Manual only";
    container.innerHTML = `
      <article class="prediction-card">
        <span>Team edge</span>
        <strong class="${counts.D >= counts.R ? "prediction-party-d" : "prediction-party-r"}">${escapeHtml(leader)}</strong>
        <small>${counts.D} D / ${counts.R} R${counts.I ? ` / ${counts.I} I` : ""}</small>
      </article>
      <article class="prediction-card">
        <span>Tracked races</span>
        <strong>${raceCount}</strong>
        <small>${competitive} competitive or near-competitive</small>
      </article>
      <article class="prediction-card">
        <span>Toss-ups</span>
        <strong>${counts.toss}</strong>
        <small>Editable team calls, not model release gates</small>
      </article>
      <article class="prediction-card">
        <span>Status</span>
        <strong>${escapeHtml(data?.pageStatus || "Published")}</strong>
        <small>${escapeHtml(modelStatus)}</small>
      </article>
    `;
  }

  function renderMap(data) {
    const container = $("prediction-map");
    if (!container) return;
    container.innerHTML = sortedRaces(data?.races || []).map((race) => `
      <button class="prediction-map-tile ${ratingClass(race.prediction?.rating)}" type="button" data-race-id="${escapeHtml(race.raceId)}">
        <b>${escapeHtml(race.district ? `${race.state}-${race.district}` : race.state)}</b>
        <small>${escapeHtml(race.prediction?.rating || "--")}</small>
        <small>${escapeHtml(formatMargin(race))}</small>
      </button>
    `).join("");
    container.querySelectorAll("[data-race-id]").forEach((button) => {
      button.addEventListener("click", () => selectRace(button.dataset.raceId));
    });
  }

  function renderTable(data) {
    const tbody = $("prediction-table-body");
    if (!tbody) return;
    tbody.innerHTML = sortedRaces(data?.races || []).map((race) => {
      const winner = race.prediction?.winner || "Uncalled";
      const winnerName = ["D", "R", "I"].includes(winner) ? candidateName(race, winner) : winner;
      return `
        <tr data-race-id="${escapeHtml(race.raceId)}">
          <td><strong>${escapeHtml(race.displayName || race.raceId)}</strong><br><small>${escapeHtml(race.state)}${race.district ? `-${escapeHtml(race.district)}` : ""}</small></td>
          <td>${escapeHtml(candidateName(race, "D"))}</td>
          <td>${escapeHtml(candidateName(race, "R"))}</td>
          <td><span class="prediction-pill ${ratingClass(race.prediction?.rating)}">${escapeHtml(race.prediction?.rating || "--")}</span></td>
          <td class="${partyClass(winner)}"><strong>${escapeHtml(winnerName)}</strong></td>
          <td>${escapeHtml(formatMargin(race))}</td>
          <td>${escapeHtml(race.prediction?.confidence || "--")}</td>
        </tr>
      `;
    }).join("");
    tbody.querySelectorAll("[data-race-id]").forEach((row) => row.addEventListener("click", () => selectRace(row.dataset.raceId)));
  }

  function renderDetail(race) {
    const panel = $("prediction-detail");
    if (!panel) return;
    if (!race) {
      panel.innerHTML = `
        <div class="prediction-detail-card">
          <div class="prediction-detail-head">
            <span class="prediction-kicker">Race detail</span>
            <h3>Select a race</h3>
          </div>
          <div class="prediction-detail-body">
            <p class="prediction-note">Choose a state, district, or row to view the FEA Team Prediction and model reference notes.</p>
          </div>
        </div>`;
      return;
    }
    panel.innerHTML = `
      <div class="prediction-detail-card">
        <div class="prediction-detail-head">
          <span class="prediction-pill ${ratingClass(race.prediction?.rating)}">${escapeHtml(race.prediction?.rating || "--")}</span>
          <h3>${escapeHtml(race.displayName || race.raceId)}</h3>
        </div>
        <div class="prediction-detail-body">
          <div class="prediction-mini-grid">
            <div><span class="prediction-kicker">Winner</span><strong class="${partyClass(race.prediction?.winner)}">${escapeHtml(race.prediction?.winner || "--")}</strong></div>
            <div><span class="prediction-kicker">Margin</span><strong>${escapeHtml(formatMargin(race))}</strong></div>
            <div><span class="prediction-kicker">Confidence</span><strong>${escapeHtml(race.prediction?.confidence || "--")}</strong></div>
            <div><span class="prediction-kicker">Status</span><strong>${escapeHtml(race.prediction?.status || "published")}</strong></div>
          </div>
          <div class="prediction-admin-note">
            <span class="prediction-kicker">Why we rate it this way</span>
            <p>${escapeHtml(race.notes?.whyWeRateItThisWay || race.notes?.short || "Team reasoning has not been added yet.")}</p>
          </div>
          <div class="prediction-admin-note">
            <span class="prediction-kicker">Model diagnostic reference</span>
            <p>${escapeHtml(race.notes?.modelSignal || "No model diagnostic summary attached.")}</p>
          </div>
          <div class="prediction-admin-note">
            <span class="prediction-kicker">Candidates</span>
            <p><b class="prediction-party-d">D:</b> ${escapeHtml(candidateName(race, "D"))}</p>
            <p><b class="prediction-party-r">R:</b> ${escapeHtml(candidateName(race, "R"))}</p>
            ${race.candidates?.I ? `<p><b class="prediction-party-i">I:</b> ${escapeHtml(candidateName(race, "I"))}</p>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  function selectRace(raceId) {
    state.selectedRaceId = raceId;
    document.querySelectorAll("[data-race-id]").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.raceId === raceId);
    });
    const race = (state.data?.races || []).find((item) => item.raceId === raceId);
    renderDetail(race);
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

  async function init() {
    const root = $("prediction-root");
    try {
      const data = await loadPrediction();
      state.data = data;
      if ($("prediction-title")) $("prediction-title").textContent = data.title || "FEA Team Predictions";
      if ($("prediction-subtitle")) $("prediction-subtitle").textContent = data.notes?.publicSummary || "";
      if ($("prediction-updated")) $("prediction-updated").textContent = formatDate(data.lastPublishedAt || data.generatedAt);
      renderTopline(data);
      renderMap(data);
      renderTable(data);
      renderDetail(sortedRaces(data.races || [])[0]);
      selectRace(sortedRaces(data.races || [])[0]?.raceId || "");
      if (root) root.dataset.loaded = "true";
    } catch (error) {
      if (root) {
        root.innerHTML = `
          <section class="prediction-panel">
            <span class="prediction-kicker">Data</span>
            <h2 class="prediction-gradient-title">Prediction file could not load.</h2>
            <p class="prediction-note">${escapeHtml(error.message || String(error))}</p>
          </section>
        `;
      }
    }
  }

  init();
})();
