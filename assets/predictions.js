(() => {
  const validFiles = new Map([
    ["senate", "data/predictions/2026-senate-predictions.json"],
    ["house", "data/predictions/2026-house-predictions.json"],
    ["governor", "data/predictions/2026-governor-predictions.json"]
  ]);

  const state = {
    data: null,
    selectedRaceId: ""
  };

  const $ = (id) => document.getElementById(id);
  const ratingOrder = ["Safe D", "Likely D", "Lean D", "Tilt D", "Toss-up", "Tilt R", "Lean R", "Likely R", "Safe R", "Safe I", "Likely I", "Lean I", "Tilt I"];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
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

  function formatProbability(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "--";
    if (number === 1) return ">99%";
    if (number === 0) return "<1%";
    return `${(number * 100).toFixed(number > 0.995 || number < 0.005 ? 1 : 0)}%`;
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
    return normalized || "Other";
  }

  function ratingParty(rating) {
    const text = String(rating || "");
    if (/\bD\b/.test(text)) return "D";
    if (/\bR\b/.test(text)) return "R";
    if (/\bI\b/.test(text)) return "I";
    return "T";
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
    return [...races].sort((a, b) => {
      const ar = ratingOrder.indexOf(a.prediction?.rating);
      const br = ratingOrder.indexOf(b.prediction?.rating);
      return (ar < 0 ? 99 : ar) - (br < 0 ? 99 : br)
        || String(a.state || "").localeCompare(String(b.state || ""))
        || String(a.district || "").localeCompare(String(b.district || ""), undefined, { numeric: true })
        || String(a.displayName || "").localeCompare(String(b.displayName || ""));
    });
  }

  function projectedCounts(data) {
    const counts = data?.summary?.counts || {};
    return {
      D: numberValue(counts.D),
      R: numberValue(counts.R),
      I: numberValue(counts.I),
      toss: numberValue(counts["Toss-up"]),
      uncalled: numberValue(counts.Uncalled)
    };
  }

  function winnerRows(race) {
    const rows = ["D", "R", "I"]
      .filter((party) => race?.candidates?.[party])
      .map((party) => ({ party, candidate: race.candidates[party] }));
    if (!rows.length) {
      rows.push({ party: "D", candidate: { name: "Democrat" } }, { party: "R", candidate: { name: "Republican" } });
    }
    return rows;
  }

  function toplineCounts(data) {
    const counts = projectedCounts(data);
    const expected = data?.summary?.topline?.expectedSeatsOrWins || {};
    const median = data?.summary?.topline?.medianSeatsOrWins || {};
    return { counts, expected, median };
  }

  function renderSeatBar(data) {
    const { counts } = toplineCounts(data);
    const total = Math.max(1, counts.D + counts.R + counts.I + counts.toss + counts.uncalled);
    const dWidth = Math.max(0, (counts.D / total) * 100);
    const rWidth = Math.max(0, (counts.R / total) * 100);
    const iWidth = Math.max(0, (counts.I / total) * 100);
    const tossWidth = Math.max(0, ((counts.toss + counts.uncalled) / total) * 100);
    const majority = data?.office === "house" ? 218 : null;
    const majorityPct = majority ? Math.min(100, Math.max(0, (majority / total) * 100)) : 50;
    return `
      <div class="prediction-seatbar" aria-label="Projected result bar">
        <span class="prediction-seatbar-segment prediction-seatbar-d" style="width:${dWidth}%"></span>
        <span class="prediction-seatbar-segment prediction-seatbar-i" style="width:${iWidth}%"></span>
        <span class="prediction-seatbar-segment prediction-seatbar-toss" style="width:${tossWidth}%"></span>
        <span class="prediction-seatbar-segment prediction-seatbar-r" style="width:${rWidth}%"></span>
        ${majority ? `<i class="prediction-seatbar-marker" style="left:${majorityPct}%"></i>` : ""}
      </div>
    `;
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
    const { counts, expected, median } = toplineCounts(data);
    const raceCount = numberValue(data?.summary?.raceCount || data?.races?.length);
    const competitive = (data?.races || []).filter((race) => /Toss-up|Tilt|Lean/.test(race.prediction?.rating || "")).length;
    const control = data?.summary?.topline?.controlProbability || {};
    const leader = counts.D === counts.R ? "No clear edge" : counts.D > counts.R ? "Democratic edge" : "Republican edge";
    const leftLabel = data?.office === "house" ? "projected seats" : "projected race wins";
    const status = data?.pageStatus || "Published";
    container.innerHTML = `
      <section class="prediction-command-board">
        <div class="prediction-command-left">
          <span>Democratic ${leftLabel}</span>
          <strong class="prediction-party-d">${formatNumber(counts.D)}</strong>
          <small>${formatProbability(control.D)} control / lead chance</small>
        </div>
        <div class="prediction-command-center">
          <span class="prediction-kicker">${escapeHtml(data?.office || "prediction")} board</span>
          <b>${escapeHtml(leader)}</b>
          ${renderSeatBar(data)}
          <small>Median: ${formatNumber(median.D, 0)} D / ${formatNumber(median.R, 0)} R · Expected: ${formatNumber(expected.D, 1)} D / ${formatNumber(expected.R, 1)} R</small>
        </div>
        <div class="prediction-command-right">
          <span>Republican ${leftLabel}</span>
          <strong class="prediction-party-r">${formatNumber(counts.R)}</strong>
          <small>${formatProbability(control.R)} control / lead chance</small>
        </div>
      </section>
      <section class="prediction-stat-grid">
        <article class="prediction-card"><span>Published status</span><strong>${escapeHtml(status)}</strong><small>${escapeHtml(data?.sourceModelRunId ? "Model diagnostic attached" : "Manual team board")}</small></article>
        <article class="prediction-card"><span>Races rated</span><strong>${formatNumber(raceCount)}</strong><small>${formatNumber(competitive)} competitive or near-competitive</small></article>
        <article class="prediction-card"><span>Toss-ups</span><strong>${formatNumber(counts.toss)}</strong><small>${formatNumber(counts.uncalled)} uncalled / unresolved ratings</small></article>
        <article class="prediction-card"><span>Latest publish</span><strong>${escapeHtml(formatDate(data.lastPublishedAt || data.generatedAt))}</strong><small>Team prediction release</small></article>
      </section>
      <section class="prediction-chart-panel">
        <div>
          <span class="prediction-kicker">Rating spectrum</span>
          <h2 class="prediction-gradient-title">Where the map stands.</h2>
        </div>
        <div class="prediction-rating-list">${renderRatingDistribution(data)}</div>
      </section>
    `;
  }

  async function renderMap(data) {
    const container = $("prediction-map");
    if (!container) return;
    if (!window.FeaPredictionMaps?.renderRaceShapeMap) {
      container.innerHTML = `<p class="prediction-note">Prediction map tools could not load.</p>`;
      return;
    }
    container.innerHTML = `<p class="prediction-note">Loading shape map...</p>`;
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
            <p class="prediction-note">Choose a race tile or table row to view the FEA Team Prediction and model reference notes.</p>
          </div>
        </div>`;
      return;
    }
    const winner = race.prediction?.winner || "Toss-up";
    const winnerName = ["D", "R", "I"].includes(winner) ? candidateName(race, winner) : winner;
    const rows = winnerRows(race).map(({ party, candidate }) => {
      const isWinner = winner === party;
      return `
        <div class="prediction-candidate-row ${isWinner ? "is-projected" : ""}">
          <span class="prediction-candidate-party ${partyClass(party)}">${escapeHtml(party)}</span>
          <strong>${escapeHtml(candidate?.name || partyName(party))}</strong>
          <small>${escapeHtml(partyName(candidate?.party || party))}${candidate?.incumbent ? " · incumbent" : ""}${candidate?.status ? ` · ${escapeHtml(candidate.status)}` : ""}</small>
        </div>
      `;
    }).join("");
    panel.innerHTML = `
      <div class="prediction-detail-card">
        <div class="prediction-detail-head ${ratingClass(race.prediction?.rating)}">
          <span class="prediction-pill ${ratingClass(race.prediction?.rating)}">${escapeHtml(race.prediction?.rating || "--")}</span>
          <h3>${escapeHtml(race.displayName || race.raceId)}</h3>
          <p>${escapeHtml(winnerName)} · ${escapeHtml(formatMargin(race))}</p>
        </div>
        <div class="prediction-detail-body">
          <div class="prediction-mini-grid">
            <div><span class="prediction-kicker">Projected side</span><strong class="${partyClass(winner)}">${escapeHtml(winner)}</strong></div>
            <div><span class="prediction-kicker">Confidence</span><strong>${escapeHtml(race.prediction?.confidence || "--")}</strong></div>
            <div><span class="prediction-kicker">Status</span><strong>${escapeHtml(race.prediction?.status || "published")}</strong></div>
            <div><span class="prediction-kicker">Margin</span><strong>${escapeHtml(formatMargin(race))}</strong></div>
          </div>
          <section class="prediction-candidate-list">${rows}</section>
          <div class="prediction-admin-note">
            <span class="prediction-kicker">Why we rate it this way</span>
            <p>${escapeHtml(race.notes?.whyWeRateItThisWay || race.notes?.short || "Team reasoning has not been added yet.")}</p>
          </div>
          <div class="prediction-admin-note">
            <span class="prediction-kicker">Model diagnostic reference</span>
            <p>${escapeHtml(race.notes?.modelSignal || "No model diagnostic summary attached.")}</p>
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
      renderTable(data);
      const firstRace = sortedRaces(data.races || [])[0];
      renderDetail(firstRace);
      selectRace(firstRace?.raceId || "");
      await renderMap(data);
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
