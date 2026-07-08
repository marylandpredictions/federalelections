(() => {
  const sourceByKey = {
    senate: "/data/v4/senate-forecast.json",
    house: "/data/v4/house-forecast.json",
    governor: "/data/v4/governor-forecast.json",
    president: "/data/president-forecast.json",
    index: "/data/v4/ui/forecast-ui-adapter.json"
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

  function pct(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "--";
  }

  function margin(row = {}) {
    return row.projectedResultMargin?.display || row.probabilityMargin?.display || "--";
  }

  function renderIndex(data) {
    const root = $("model-lab-root");
    const chambers = data?.chambers || {};
    root.innerHTML = `
      <section class="prediction-topline">
        ${Object.entries(chambers).map(([key, chamber]) => `
          <a class="prediction-card" href="/model-lab/${key === "governor" ? "2026/governor" : key === "house" ? "2026/house" : "2026/senate"}">
            <span>${escapeHtml(chamber.status || "Diagnostics")}</span>
            <strong>${escapeHtml(key === "governor" ? "Governors" : key[0].toUpperCase() + key.slice(1))}</strong>
            <small>${escapeHtml(chamber.raceCount || 0)} rows</small>
            <small>D ${pct(chamber.topline?.controlProbability?.D)} / R ${pct(chamber.topline?.controlProbability?.R)}</small>
          </a>
        `).join("")}
        <a class="prediction-card" href="/model-lab/2028/president">
          <span>Diagnostics</span>
          <strong>2028 President</strong>
          <small>Aggregate matchup model</small>
        </a>
      </section>
      <section class="prediction-panel model-lab-warning">
        <strong>Release gate status: ${escapeHtml(data?.publishStatus || "unknown")}</strong>
        <p>${escapeHtml((data?.blockingReasons || []).join(", ") || "No blocking reasons listed.")}</p>
      </section>
    `;
  }

  function renderRaceRows(rows = []) {
    return rows.slice(0, 80).map((row) => `
      <tr>
        <td><strong>${escapeHtml(row.displayName || row.raceId)}</strong><br><small>${escapeHtml(row.raceId || "")}</small></td>
        <td>${escapeHtml(row.evidence?.ratings?.consensusRating || row.ratingsPrior?.consensusRating || "--")}</td>
        <td>${escapeHtml(row.expectedWinner || "--")}</td>
        <td>${escapeHtml(margin(row))}</td>
        <td>D ${pct(row.probabilities?.D)} / R ${pct(row.probabilities?.R)}</td>
        <td>${escapeHtml(row.evidence?.polling?.status || "--")}</td>
      </tr>
    `).join("");
  }

  function renderChamber(data) {
    const root = $("model-lab-root");
    const rows = data?.races || [];
    root.innerHTML = `
      <section class="prediction-topline">
        <article class="prediction-card"><span>Status</span><strong>${escapeHtml(data.strictReleaseGates ? "Strict QA" : "Diagnostics")}</strong><small>${escapeHtml(data.artifactType || "")}</small></article>
        <article class="prediction-card"><span>Rows</span><strong>${rows.length}</strong><small>${escapeHtml(data.generatedAt || "")}</small></article>
        <article class="prediction-card"><span>D probability</span><strong class="prediction-party-d">${pct(data.topline?.controlProbability?.D)}</strong><small>Model Lab only</small></article>
        <article class="prediction-card"><span>R probability</span><strong class="prediction-party-r">${pct(data.topline?.controlProbability?.R)}</strong><small>Model Lab only</small></article>
      </section>
      <section class="prediction-panel">
        <h2 class="prediction-gradient-title">Automated model rows.</h2>
        <p class="prediction-note">These rows are diagnostic references for admins. They are not the official public FEA Team Predictions.</p>
        <div class="prediction-table-wrap">
          <table class="prediction-table">
            <thead><tr><th>Race</th><th>Model rating</th><th>Winner</th><th>Margin</th><th>Probability</th><th>Polling</th></tr></thead>
            <tbody>${renderRaceRows(rows)}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderPresident(data) {
    const root = $("model-lab-root");
    const rows = data?.matchups || [];
    root.innerHTML = `
      <section class="prediction-topline">
        <article class="prediction-card"><span>National D</span><strong class="prediction-party-d">${pct(data.national?.demWinProbability)}</strong><small>${escapeHtml(data.runDate || "")}</small></article>
        <article class="prediction-card"><span>National R</span><strong class="prediction-party-r">${pct(data.national?.repWinProbability)}</strong><small>Model Lab only</small></article>
        <article class="prediction-card"><span>Expected EV</span><strong>${escapeHtml(data.electoralCollege?.demExpectedEV ?? "--")} D</strong><small>${escapeHtml(data.electoralCollege?.repExpectedEV ?? "--")} R</small></article>
        <article class="prediction-card"><span>Matchups</span><strong>${rows.length}</strong><small>Diagnostic rows</small></article>
      </section>
      <section class="prediction-panel">
        <h2 class="prediction-gradient-title">Presidential matchup model.</h2>
        <div class="prediction-table-wrap">
          <table class="prediction-table">
            <thead><tr><th>Matchup</th><th>D probability</th><th>R probability</th><th>D EV</th><th>R EV</th></tr></thead>
            <tbody>${rows.map((row) => `
              <tr>
                <td><strong>${escapeHtml(row.demCandidateName)} vs. ${escapeHtml(row.repCandidateName)}</strong></td>
                <td>${pct(row.demWinProbability)}</td>
                <td>${pct(row.repWinProbability)}</td>
                <td>${escapeHtml(row.demExpectedEV ?? "--")}</td>
                <td>${escapeHtml(row.repExpectedEV ?? "--")}</td>
              </tr>
            `).join("")}</tbody>
          </table>
        </div>
      </section>
    `;
  }

  async function init() {
    const key = document.body.dataset.modelLabKey || "index";
    const response = await fetch(sourceByKey[key] || sourceByKey.index, { cache: "no-store" });
    const data = await response.json();
    if (key === "index") renderIndex(data);
    else if (key === "president") renderPresident(data);
    else renderChamber(data);
  }

  init().catch((error) => {
    const root = $("model-lab-root");
    if (root) root.innerHTML = `<section class="prediction-panel"><h2>Model Lab could not load.</h2><p>${escapeHtml(error.message || error)}</p></section>`;
  });
})();
