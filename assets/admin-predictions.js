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
    D: ["Tilt Democratic", "Lean Democratic", "Likely Democratic", "Safe Democratic"],
    R: ["Tilt Republican", "Lean Republican", "Likely Republican", "Safe Republican"]
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
    mapController: null,
    mapRenderId: 0
  };

  const mapUtils = window.FeaPredictionMaps || {};
  const allowedRatings = mapUtils.allowedRatings || [
    "Safe Democratic",
    "Likely Democratic",
    "Lean Democratic",
    "Tilt Democratic",
    "Tossup",
    "Tilt Republican",
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

  function isCompetitiveRating(rating) {
    const normalized = normalizeRating(rating);
    return normalized === "Tossup" || normalized.startsWith("Tilt") || normalized.startsWith("Lean");
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

  function candidateEntries(race) {
    return Object.entries(race?.candidates || {}).filter(([, candidate]) => candidate && typeof candidate === "object");
  }

  function candidateKey(race, preferredParty = "I") {
    const candidates = race.candidates || {};
    const base = String(preferredParty || "I").trim().toUpperCase().slice(0, 1) || "I";
    if (!candidates[base]) return base;
    let index = 2;
    while (candidates[`${base}${index}`]) index += 1;
    return `${base}${index}`;
  }

  function updateCandidate(raceId, key, field, value) {
    const race = (state.data?.races || []).find((entry) => entry.raceId === raceId);
    if (!race?.candidates?.[key]) return;
    if (!state.dirty) pushUndo();
    race.candidates[key][field] = field === "incumbent" ? Boolean(value) : String(value ?? "");
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    state.dirty = true;
  }

  function addCandidate(raceId) {
    const race = (state.data?.races || []).find((entry) => entry.raceId === raceId);
    if (!race) return;
    pushUndo();
    race.candidates = race.candidates || {};
    const key = candidateKey(race, "I");
    race.candidates[key] = {
      name: "",
      party: "I",
      incumbent: false
    };
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    render();
    requestAnimationFrame(() => {
      document.querySelector(`[data-candidate-key="${key}"] input[data-candidate-field="name"]`)?.focus();
    });
  }

  function removeCandidate(raceId, key) {
    const race = (state.data?.races || []).find((entry) => entry.raceId === raceId);
    if (!race?.candidates?.[key]) return;
    pushUndo();
    delete race.candidates[key];
    state.data.lastEdited = new Date().toISOString();
    state.data.lastEditedBy = "FEA admin";
    render();
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
        return isCompetitiveRating(race?.prediction?.rating);
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
    if (nextRating === current) {
      state.selectedRaceId = race.raceId;
      render();
      return;
    }
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
    setStatus(`${raceTitle(race)} changed to ${nextRating}.`);
  }

  function selectRace(race) {
    if (!race) return;
    state.selectedRaceId = race.raceId;
    render();
    setStatus(`${raceTitle(race)} selected. Use Democratic, Tossup, or Republican to change its rating.`);
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
    const selected = selectedRace();
    const current = normalizeRating(selected?.prediction?.rating);
    return [
      ["D", "Democratic"],
      ["Tossup", "Tossup"],
      ["R", "Republican"]
    ].map(([key, label]) =>
      `<button type="button" class="admin-rating-mode ${state.editMode === key ? "active" : ""} mode-${key.toLowerCase()}" data-mode="${key}" aria-pressed="${state.editMode === key ? "true" : "false"}"><span>${state.editMode === key ? "Selected " : ""}${escapeHtml(label)}</span>${selected ? `<small>${key === "Tossup" ? (current === "Tossup" ? "Already tossup" : "Click race to set") : `Click race to cycle ${key}`}</small>` : "<small>Click race to apply</small>"}</button>`
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
          <p class="prediction-note">Click a state or district on the map first. Then use Democratic, Tossup, or Republican to change its FEA Rating.</p>
        </aside>
      `;
    }
    const rating = normalizeRating(race?.prediction?.rating);
    const candidates = candidateEntries(race);
    return `
      <aside class="admin-rating-side">
        <span class="prediction-kicker">Selected race</span>
        <h2>${escapeHtml(raceTitle(race))}</h2>
        <span class="rating-pill ${ratingClass(rating)}">${escapeHtml(rating)}</span>
        <p class="prediction-note">Current mode: <b>${escapeHtml(state.editMode)}</b>. Press the active party button again to move through Tilt, Lean, Likely, and Safe.</p>
        <div class="admin-selected-meta">
          <span>${escapeHtml(race.raceId)}</span>
          <span>${escapeHtml(race.office || officeLabels[state.office])}</span>
        </div>
        <div class="admin-candidate-editor">
          <div class="admin-candidate-editor-head">
            <strong>Candidates</strong>
            <span>These names appear in the public map hover card. Publish to update the live ratings pages.</span>
          </div>
          <div class="admin-candidate-list">
            ${candidates.map(([key, candidate]) => `
              <div class="admin-candidate-row" data-candidate-key="${escapeHtml(key)}">
                <label class="admin-candidate-key">Key
                  <input value="${escapeHtml(key)}" disabled aria-label="Candidate key">
                </label>
                <label class="admin-candidate-name">Name
                  <input value="${escapeHtml(candidate.name || "")}" data-candidate-field="name" aria-label="Candidate name">
                </label>
                <label class="admin-candidate-party">Party
                  <select data-candidate-field="party" aria-label="Candidate party">
                    ${["D", "R", "I", "L", "G", "NP"].map((party) => `<option value="${party}" ${String(candidate.party || "I").toUpperCase() === party ? "selected" : ""}>${party}</option>`).join("")}
                  </select>
                </label>
                <label class="admin-candidate-status">Status
                  <input value="${escapeHtml(candidate.status || "")}" data-candidate-field="status" placeholder="Optional" aria-label="Candidate status">
                </label>
                <label class="admin-candidate-check">
                  <input type="checkbox" data-candidate-field="incumbent" ${candidate.incumbent ? "checked" : ""}>
                  Incumbent
                </label>
                <button type="button" data-remove-candidate="${escapeHtml(key)}" aria-label="Remove ${escapeHtml(candidate.name || "candidate")}">Remove</button>
              </div>
            `).join("") || `<p class="prediction-note">No candidates are configured for this race.</p>`}
          </div>
          <button type="button" id="admin-add-candidate">Add candidate</button>
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
        setStatus(`${button.dataset.mode} mode selected. Click a race on the map to apply it.`);
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
    const activeRace = selectedRace();
    if (activeRace) {
      document.querySelectorAll("[data-candidate-field]").forEach((input) => {
        const row = input.closest("[data-candidate-key]");
        const key = row?.dataset.candidateKey;
        const field = input.dataset.candidateField;
        const eventName = input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input";
        input.addEventListener(eventName, () => {
          updateCandidate(activeRace.raceId, key, field, input.type === "checkbox" ? input.checked : input.value);
          setStatus(`${raceTitle(activeRace)} candidate details updated. Save draft or publish when ready.`);
        });
      });
      document.querySelectorAll("[data-remove-candidate]").forEach((button) => {
        button.addEventListener("click", () => removeCandidate(activeRace.raceId, button.dataset.removeCandidate));
      });
      $("admin-add-candidate")?.addEventListener("click", () => addCandidate(activeRace.raceId));
    }
  }

  async function renderMap() {
    const container = $("admin-rating-map");
    if (!container || !state.data || !mapUtils.renderRaceShapeMap) return;
    const renderId = ++state.mapRenderId;
    state.mapController?.destroy?.();
    const controller = await mapUtils.renderRaceShapeMap({
      container,
      data: state.data,
      office: state.office,
      selectedRaceId: "",
      onSelect(race) {
        cycleRaceRating(race);
      }
    });
    if (renderId !== state.mapRenderId) {
      controller?.destroy?.();
      return;
    }
    state.mapController = controller;
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
        <p>D cycles Tilt Democratic to Lean Democratic to Likely Democratic to Safe Democratic. R cycles Tilt Republican to Lean Republican to Likely Republican to Safe Republican. Tossup assigns Tossup.</p>
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
