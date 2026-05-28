(function () {
  const ratings = {
    "Safe D": "safe-d", "Likely D": "likely-d", "Lean D": "lean-d", "Tilt D": "tilt-d", "Toss-up": "tossup",
    "Tilt R": "tilt-r", "Lean R": "lean-r", "Likely R": "likely-r", "Safe R": "safe-r"
  };

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

  function pct(value) {
    return `${Math.round((Number(value) || 0) * 100)}%`;
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

  function colorForRating(rating) {
    const cssVar = {
      "Safe D": "--safe-d", "Likely D": "--likely-d", "Lean D": "--lean-d", "Tilt D": "--tilt-d", "Toss-up": "--toss",
      "Tilt R": "--tilt-r", "Lean R": "--lean-r", "Likely R": "--likely-r", "Safe R": "--safe-r"
    }[rating] || "--toss";
    return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  }

  function renderSummary(data) {
    const dem = data.demMajorityProbability || 0;
    const rep = data.repMajorityProbability || 0;
    const tie = data.noMajorityProbability || Math.max(0, 1 - dem - rep);
    const favoredIsDem = dem >= rep;
    const favoredSide = favoredIsDem ? "Democrats" : "Republicans";
    const favoredProbability = Math.max(dem, rep);
    setText("governor-run-date", data.runDate || data.modelDate || "--");
    setText("governor-sim-count", Number(data.settings?.simulations || 0).toLocaleString("en-US"));
    setText("governor-watch-count", data.races.filter((race) => race.competitive).length);
    setText("governor-dem-majority", oneDecimal(dem));
    setText("governor-rep-majority", oneDecimal(rep));
    setText("governor-no-majority", oneDecimal(tie));
    setText("governor-median", `${data.medianDemGovernors} D / ${data.medianRepGovernors} R`);
    setText("governor-control-headline", `${favoredSide} favored for governor majority`);
    const odds = document.getElementById("governor-odds-phrase");
    if (odds) odds.innerHTML = `<span>${favoredSide} favored</span><strong>${pct(favoredProbability)}</strong>`;
    const demBar = document.getElementById("governor-dem-bar");
    const repBar = document.getElementById("governor-rep-bar");
    if (demBar) demBar.style.width = `${dem * 100}%`;
    if (repBar) repBar.style.width = `${rep * 100}%`;
  }

  function renderMap(data) {
    const map = document.getElementById("governor-map");
    if (!map) return;
    map.innerHTML = `
      <div class="fallback-list governor-state-grid">
        ${data.races.map((race) => `
          <button type="button" class="${leaderClass(race)}" style="background:${colorForRating(race.rating)}" title="${escapeHtml(race.displayName)}: ${escapeHtml(race.rating)}">
            ${escapeHtml(race.state)}
          </button>
        `).join("")}
      </div>
    `;
    const hover = document.getElementById("governor-map-hover-card");
    const top = [...data.races].sort((a, b) => b.tippingPower - a.tippingPower)[0];
    if (hover && top) renderHover(hover, top);
    map.querySelectorAll("button").forEach((button, index) => {
      button.addEventListener("mouseenter", () => renderHover(hover, data.races[index]));
      button.addEventListener("focus", () => renderHover(hover, data.races[index]));
    });
  }

  function renderHover(hover, race) {
    if (!hover || !race) return;
    const leader = race.demProbability >= .5 ? "Democrat" : "Republican";
    const probability = Math.max(race.demProbability, race.repProbability);
    hover.innerHTML = `
      <span class="race-kicker">${escapeHtml(race.displayName)}</span>
      <div class="map-card-title">
        <div class="state-code">${escapeHtml(race.state)}</div>
        <span class="rating-pill ${ratings[race.rating] || "tossup"}">${escapeHtml(race.rating)}</span>
      </div>
      <h3>${leader} has a ${oneDecimal(probability)} chance.</h3>
      <div class="candidate-table">
        <div class="candidate-table-head"><span>Party</span><span>Chance</span></div>
        <div class="candidate-row dem-row"><span>Democrat <i class="party-badge dem-badge">D</i></span><strong>${oneDecimal(race.demProbability)}</strong></div>
        <div class="candidate-row rep-row"><span>Republican <i class="party-badge rep-badge">R</i></span><strong>${oneDecimal(race.repProbability)}</strong></div>
        <div class="candidate-margin"><span>Projected margin</span><strong>${signedMargin(race.margin)}</strong></div>
      </div>
      <p>${escapeHtml(race.status)}. Incumbent party: ${escapeHtml(race.incumbentParty)}.</p>
      <p class="meta">Tipping power: ${oneDecimal(race.tippingPower)}</p>
    `;
  }

  function renderLegend() {
    const legend = document.getElementById("governor-map-legend");
    if (!legend) return;
    legend.innerHTML = Object.keys(ratings).map((rating) => `<span><i class="${ratings[rating]}"></i>${rating}</span>`).join("");
  }

  function renderHistogram(data) {
    const container = document.getElementById("governor-seat-histogram");
    if (!container) return;
    const counts = data.distribution || {};
    const seats = Object.keys(counts).map(Number).sort((a, b) => a - b);
    const min = Math.min(...seats);
    const max = Math.max(...seats);
    const high = Math.max(...Object.values(counts));
    container.style.gridTemplateColumns = `repeat(${max - min + 1}, minmax(0, 1fr))`;
    container.innerHTML = Array.from({ length: max - min + 1 }, (_, index) => {
      const seat = min + index;
      const count = counts[seat] || 0;
      const height = high ? Math.max(count / high, .02) : .02;
      return `<button class="seat-bin" type="button" title="${seat} Democratic governors"><i style="--bar-scale:${height}"></i><span>${seat}</span></button>`;
    }).join("");
  }

  function renderLeverage(data) {
    const chart = document.getElementById("governor-leverage-chart");
    if (!chart) return;
    const rows = [...data.races].sort((a, b) => b.tippingPower - a.tippingPower).slice(0, 10);
    const max = Math.max(...rows.map((race) => race.tippingPower));
    chart.innerHTML = rows.map((race) => {
      const width = max ? Math.max((race.tippingPower / max) * 100, 8) : 8;
      return `<button class="leverage-row ${leaderClass(race)}" type="button"><strong>${escapeHtml(race.state)}</strong><i style="width:${width}%"></i><span>${oneDecimal(race.tippingPower)}</span></button>`;
    }).join("");
  }

  function renderHistory(data) {
    const chart = document.getElementById("governor-history-chart");
    if (!chart) return;
    const point = data.controlHistory?.at(-1) || { dem: data.demMajorityProbability, rep: data.repMajorityProbability, date: data.modelDate };
    chart.innerHTML = `
      <div class="source-status-grid">
        <article class="source-status-card is-ok"><span>Dem majority</span><h3>${oneDecimal(point.dem)}</h3><p>${escapeHtml(point.date || data.modelDate)}</p></article>
        <article class="source-status-card is-warn"><span>Republican majority</span><h3>${oneDecimal(point.rep)}</h3><p>${escapeHtml(point.date || data.modelDate)}</p></article>
        <article class="source-status-card"><span>No majority</span><h3>${oneDecimal(data.noMajorityProbability)}</h3><p>25-25 outcome</p></article>
      </div>
    `;
  }

  function renderBoard(data) {
    const board = document.getElementById("governor-race-board");
    if (!board) return;
    const rows = [...data.races].sort((a, b) => Math.abs(a.demProbability - .5) - Math.abs(b.demProbability - .5));
    board.innerHTML = rows.map((race) => {
      const leader = race.demProbability >= .5 ? "D" : "R";
      const probability = Math.max(race.demProbability, race.repProbability);
      return `
        <div class="race-board-row ${leaderClass(race)}">
          <strong>${escapeHtml(race.state)}</strong>
          <span>${escapeHtml(race.displayName)}</span>
          <span>${escapeHtml(race.status)}</span>
          <span>${escapeHtml(race.rating)}</span>
          <span>${signedMargin(race.margin)}</span>
          <span>${leader} ${oneDecimal(probability)}</span>
        </div>
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
      renderSummary(data);
      renderMap(data);
      renderLegend();
      renderHistogram(data);
      renderLeverage(data);
      renderHistory(data);
      renderBoard(data);
    } catch (error) {
      renderError(error);
    }
  }

  initGovernorPage();
})();
