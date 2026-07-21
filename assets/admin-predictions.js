(() => {
  const officeFiles = {
    senate: "2026-senate-predictions.json",
    house: "2026-house-predictions.json",
    governor: "2026-governor-predictions.json"
  };
  const officeLabels = {
    senate: "Senate",
    house: "House",
    governor: "Governors"
  };
  const cycles = {
    D: ["Lean Democratic", "Likely Democratic", "Safe Democratic"],
    R: ["Lean Republican", "Likely Republican", "Safe Republican"]
  };

  const state = {
    secret: localStorage.getItem("feaAdminSecret") || "",
    bootstrap: null,
    office: "senate",
    data: null,
    selectedRaceId: "",
    editMode: "D",
    undoStack: [],
    redoStack: [],
    dirty: false,
    mapController: null
  };

  const mapUtils = window.FeaPredictionMaps || {};
  const allowedRatings = mapUtils.allowedRatings || [
    "Safe Democratic",
    "Likely Democratic",
    "Lean Democratic",
    "Tossup",
    "Lean Republican",
    "Likely Republican",
    "Safe Republican"
  ];

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeRating(value) {
    return mapUtils.normalizeRating ? mapUtils.normalizeRating(value) : String(value || "Tossup");
  }

  function ratingParty(rating) {
    return mapUtils.ratingParty ? mapUtils.ratingParty(rating) : "Tossup";
  }

  function displayDate(value) {
    return mapUtils.displayDate ? mapUtils.displayDate(value) : String(value || "--");
  }

  function ratingClass(rating) {
    return `rating-${normalizeRating(rating).toLowerCase().replace(/\s+/g, "-")}`;
  }

  function setStatus(message, isError = false) {
    const node = $("admin-status") || $("admin-login-status");
    if (!node) return;
    node.textContent = message;
    node.classList.toggle("is-error", isError);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Secret": state.secret,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) throw new Error(data.error || response.statusText);
    return data;
  }

  function fileRecord() {
    return (state.bootstrap?.files || []).find((entry) => entry.file === officeFiles[state.office]);
  }

  function raceTitle(race) {
    if (!race) return "No race selected";
    if (race.displayName) return race.displayName;
    if (state.office === "house") {
      return `${race.state || "--"}-${String(race.district || "").padStart(2, "0")} House`;
    }
    return `${race.state || "--"} ${officeLabels[state.office]}`;
  }

  function sortedRaces() {
    return [...(state.data?.races || [])].sort((a, b) =>
      String(a.state || "").localeCompare(String(b.state || ""))
      || String(a.district || "").localeCompare(String(b.district || ""), undefined, { numeric: true })
      || raceTitle(a).localeCompare(raceTitle(b))
    );
  }

  function selectedRace() {
    return (state.data?.races || []).find((race) => race.raceId === state.selectedRaceId) || null;
  }

  function summarize(data = state.data) {
    const counts = { D: 0, R: 0, Tossup: 0 };
    const ratings = Object.fromEntries(allowedRatings.map((rating) => [rating, 0]));
    for (const race of data?.races || []) {
      const rating = normalizeRating(race?.prediction?.rating);
      ratings[rating] = (ratings[rating] || 0) + 1;
      const party = ratingParty(rating);
      if (party === "D") counts.D += 1;
      else if (party === "R") counts.R += 1;
      else counts.Tossup += 1;
    }
    return { counts, ratings, raceCount: (data?.races || []).length };
  }

  function rebuildSummary() {
    if (!state.data) return;
    const summary = summarize();
    state.data.summary = {
      ...(state.data.summary || {}),
      counts: {
        ...(state.data.summary?.counts || {}),
        D: summary.counts.D,
        R: summary.counts.R,
        Tossup: summary.counts.Tossup
      },
      ratingCounts: summary.ratings,
      competitiveCount: (state.data.races || []).filter((race) => {
        const rating = normalizeRating(race?.prediction?.rating);
        return rating === "Tossup" || rating.startsWith("Lean");
      }).length
    };
  }

  function pushUndo() {
    if (!state.data) return;
    state.undoStack.push(JSON.stringify(state.data));
    if (state.undoStack.length > 80) state.undoStack.shift();
    state.redoStack = [];
    state.dirty = true;
  }

  function restoreFromStack(serialized) {
    state.data = JSON.parse(serialized);
    rebuildSummary();
    render();
  }

  function cycleRaceRating(race) {
    if (!race) return;
    const current = normalizeRating(race?.prediction?.rating);
    let nextRating = "Tossup";
    if (state.editMode === "Tossup") {
      nextRating = "Tossup";
    } else {
      const cycle = cycles[state.editMode];
      const currentParty = ratingParty(current);
      if (currentParty === state.editMode) {
        const idx = cycle.findIndex((rating) => rating === current);
        nextRating = cycle[(idx + 1 + cycle.length) % cycle.length];
      } else {
        nextRating = cycle[0];
      }
    }
    if (nextRating === current) return;
    pushUndo();
    race.prediction = {
      ...(race.prediction || {}),
      rating: nextRating,
      status: race.prediction?.status || "published"
    };
    state.selectedRaceId = race.raceId;
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    rebuildSummary();
    render();
  }

  async function loadOffice(office = state.office, useDraft = false) {
    state.office = office;
    const record = fileRecord();
    if (!record) throw new Error(`No ratings file found for ${officeLabels[office]}.`);
    const payload = useDraft && record.draft ? record.draft : record.published;
    if (!payload) throw new Error(useDraft ? "No draft exists for this office." : "Published ratings file is missing.");
    state.data = clone(payload);
    state.selectedRaceId = "";
    state.undoStack = [];
    state.redoStack = [];
    state.dirty = false;
    rebuildSummary();
    render();
    setStatus(`${officeLabels[office]} ratings loaded${useDraft ? " from draft" : ""}.`);
  }

  async function saveRatings(mode = "publish") {
    if (!state.data) return;
    rebuildSummary();
    const result = await api("/api/admin/predictions/save", {
      method: "POST",
      body: JSON.stringify({
        file: officeFiles[state.office],
        mode,
        editedBy: "FEA admin",
        changeSummary: mode === "publish" ? "Update FEA Ratings" : "Save FEA Ratings draft",
        data: state.data
      })
    });
    const record = fileRecord();
    if (record) {
      if (mode === "publish") record.published = clone(result.data);
      else record.draft = clone(result.data);
    }
    state.data = clone(result.data);
    state.dirty = false;
    setStatus(mode === "publish" ? "Published ratings saved." : "Draft ratings saved.");
    render();
  }

  function renderOfficeTabs() {
    return Object.entries(officeLabels).map(([key, label]) =>
      `<button type="button" class="admin-rating-tab ${state.office === key ? "active" : ""}" data-office="${key}">${escapeHtml(label)}</button>`
    ).join("");
  }

  function renderModeButtons() {
    return [
      ["D", "Democratic"],
      ["Tossup", "Tossup"],
      ["R", "Republican"]
    ].map(([key, label]) =>
      `<button type="button" class="admin-rating-mode ${state.editMode === key ? "active" : ""} mode-${key.toLowerCase()}" data-mode="${key}">${escapeHtml(label)}</button>`
    ).join("");
  }

  function renderSummary() {
    const summary = summarize();
    return `
      <div class="admin-rating-summary">
        <span><b>${summary.counts.D}</b> Democratic</span>
        <span><b>${summary.counts.Tossup}</b> Tossup</span>
        <span><b>${summary.counts.R}</b> Republican</span>
        <span><b>${summary.raceCount}</b> races</span>
        <span>Updated <b>${escapeHtml(displayDate(state.data?.lastPublishedAt || state.data?.generatedAt))}</b></span>
      </div>
    `;
  }

  function renderSelectedPanel() {
    const race = selectedRace();
    if (!race) {
      return `
        <aside class="admin-rating-side">
          <span class="prediction-kicker">Selected race</span>
          <h2>No race selected</h2>
          <p class="prediction-note">Choose D, Tossup, or R, then click a state or district on the map.</p>
        </aside>
      `;
    }
    const rating = normalizeRating(race?.prediction?.rating);
    const candidates = Object.values(race.candidates || {}).filter((candidate) => candidate?.name);
    return `
      <aside class="admin-rating-side">
        <span class="prediction-kicker">Selected race</span>
        <h2>${escapeHtml(raceTitle(race))}</h2>
        <span class="rating-pill ${ratingClass(rating)}">${escapeHtml(rating)}</span>
        <div class="admin-selected-meta">
          <span>${escapeHtml(race.raceId)}</span>
          <span>${escapeHtml(race.office || officeLabels[state.office])}</span>
        </div>
        <div class="admin-selected-candidates">
          ${candidates.length ? candidates.map((candidate) => `
            <div>
              <b>${escapeHtml(candidate.name)}${candidate.incumbent ? "*" : ""}</b>
              <small>${escapeHtml(candidate.party || "")}${candidate.status ? ` - ${escapeHtml(candidate.status)}` : ""}</small>
            </div>
          `).join("") : `<p class="prediction-note">Candidate details have not been added yet.</p>`}
        </div>
        <a class="prediction-button is-small" href="/predictions/2026/${state.office}#${encodeURIComponent(race.raceId)}" target="_blank" rel="noopener">Open public race</a>
      </aside>
    `;
  }

  function attachHandlers() {
    document.querySelectorAll("[data-office]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          if (state.dirty && !confirm("You have unsaved rating changes. Switch offices anyway?")) return;
          await loadOffice(button.dataset.office);
        } catch (error) {
          setStatus(error.message, true);
        }
      });
    });
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        state.editMode = button.dataset.mode;
        render();
      });
    });
    $("admin-load-published")?.addEventListener("click", () => loadOffice(state.office, false).catch((error) => setStatus(error.message, true)));
    $("admin-load-draft")?.addEventListener("click", () => loadOffice(state.office, true).catch((error) => setStatus(error.message, true)));
    $("admin-undo")?.addEventListener("click", () => {
      const previous = state.undoStack.pop();
      if (!previous) return;
      state.redoStack.push(JSON.stringify(state.data));
      state.dirty = true;
      restoreFromStack(previous);
    });
    $("admin-redo")?.addEventListener("click", () => {
      const next = state.redoStack.pop();
      if (!next) return;
      state.undoStack.push(JSON.stringify(state.data));
      state.dirty = true;
      restoreFromStack(next);
    });
    $("admin-save-draft")?.addEventListener("click", () => saveRatings("draft").catch((error) => setStatus(error.message, true)));
    $("admin-publish")?.addEventListener("click", () => saveRatings("publish").catch((error) => setStatus(error.message, true)));
    $("admin-clear-rating")?.addEventListener("click", () => {
      const race = selectedRace();
      if (!race) return;
      pushUndo();
      race.prediction = { ...(race.prediction || {}), rating: "Tossup", status: race.prediction?.status || "published" };
      rebuildSummary();
      render();
    });
  }

  async function renderMap() {
    const container = $("admin-rating-map");
    if (!container || !state.data || !mapUtils.renderRaceShapeMap) return;
    state.mapController?.destroy?.();
    state.mapController = await mapUtils.renderRaceShapeMap({
      container,
      data: state.data,
      office: state.office,
      selectedRaceId: state.selectedRaceId,
      onSelect(race) {
        cycleRaceRating(race);
      }
    });
  }

  function render() {
    const root = $("admin-editor");
    if (!root || !state.data) return;
    root.hidden = false;
    root.innerHTML = `
      <section class="admin-ratings-toolbar">
        <div class="admin-rating-tabs">${renderOfficeTabs()}</div>
        <div class="admin-rating-modes" aria-label="Rating mode">${renderModeButtons()}</div>
        <div class="admin-rating-actions">
          <button id="admin-load-published" type="button">Load published</button>
          <button id="admin-load-draft" type="button">Load draft</button>
          <button id="admin-undo" type="button" ${state.undoStack.length ? "" : "disabled"}>Undo</button>
          <button id="admin-redo" type="button" ${state.redoStack.length ? "" : "disabled"}>Redo</button>
          <button id="admin-save-draft" type="button">Save draft</button>
          <button id="admin-publish" type="button">Publish</button>
        </div>
      </section>
      <div id="admin-status" class="prediction-note admin-save-status" role="status"></div>
      ${renderSummary()}
      <section class="admin-rating-workspace">
        <div id="admin-rating-map" class="prediction-map admin-rating-map"></div>
        ${renderSelectedPanel()}
      </section>
      <section class="admin-rating-legend-panel">
        <span class="prediction-kicker">Rating click behavior</span>
        <p>D cycles Lean Democratic to Likely Democratic to Safe Democratic. R cycles Lean Republican to Likely Republican to Safe Republican. Tossup assigns Tossup.</p>
        <button id="admin-clear-rating" type="button">Set selected race to Tossup</button>
      </section>
    `;
    attachHandlers();
    renderMap();
  }

  async function init() {
    const login = $("admin-login-form");
    if ($("admin-secret")) $("admin-secret").value = state.secret;
    login?.addEventListener("submit", async (event) => {
      event.preventDefault();
      state.secret = $("admin-secret")?.value || "";
      localStorage.setItem("feaAdminSecret", state.secret);
      try {
        state.bootstrap = await api("/api/admin/predictions/bootstrap");
        await loadOffice("senate");
        $("admin-login")?.setAttribute("hidden", "");
      } catch (error) {
        setStatus(error.message, true);
      }
    });
    window.addEventListener("beforeunload", (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  init();
})();
