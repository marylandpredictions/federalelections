(() => {
  const ratings = ["Safe D", "Likely D", "Lean D", "Tilt D", "Toss-up", "Tilt R", "Lean R", "Likely R", "Safe R", "Tilt I", "Lean I", "Likely I", "Safe I"];
  const winners = ["D", "R", "I", "Toss-up", "Uncalled"];
  const state = {
    secret: localStorage.getItem("feaAdminSecret") || "",
    bootstrap: null,
    file: "",
    data: null,
    selectedRaceId: "",
    selectedCountyKey: "",
    selectedCountyName: "",
    mode: "visual"
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

  function setStatus(message, isError = false) {
    const node = $("admin-status");
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? "#ff9aa0" : "";
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

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function currentFileRecord() {
    return (state.bootstrap?.files || []).find((entry) => entry.file === state.file);
  }

  function sortedRaces() {
    return [...(state.data?.races || [])].sort((a, b) =>
      String(a.state || "").localeCompare(String(b.state || ""))
      || String(a.district || "").localeCompare(String(b.district || ""), undefined, { numeric: true })
      || String(a.displayName || "").localeCompare(String(b.displayName || ""))
    );
  }

  function selectedRace() {
    return (state.data?.races || []).find((race) => race.raceId === state.selectedRaceId) || null;
  }

  function modelReferenceFor(raceId) {
    const selected = (state.data?.races || []).find((item) => item.raceId === raceId);
    if (selected?.modelReference) {
      const ref = selected.modelReference;
      const marginSource = ref.projectedResultMargin || ref.probabilityMargin || {};
      return {
        modelRating: ref.evidence?.ratings?.consensusRating || "",
        modelWinner: ref.expectedWinner || "",
        modelMargin: marginSource.signedValue ?? marginSource.value ?? "",
        modelProbability: ref.probabilities ? `D ${Number(ref.probabilities.D || 0).toFixed(3)} / R ${Number(ref.probabilities.R || 0).toFixed(3)}` : "",
        modelSignal: selected.notes?.modelSignal || ""
      };
    }
    const entries = state.bootstrap?.modelAdapter?.files || {};
    for (const value of Object.values(entries)) {
      const race = (value?.races || []).find((item) => item.raceId === raceId);
      if (race) return race;
    }
    return null;
  }

  function setSelectOptions(select, options) {
    if (!select) return;
    select.innerHTML = options.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("");
  }

  function renderFileSelect() {
    const select = $("admin-file");
    if (!select) return;
    select.innerHTML = (state.bootstrap?.files || []).map((entry) =>
      `<option value="${escapeHtml(entry.file)}">${escapeHtml(entry.published?.title || entry.file)}${entry.draft ? " (draft exists)" : ""}</option>`
    ).join("");
    if (!state.file && state.bootstrap?.files?.length) state.file = state.bootstrap.files[0].file;
    select.value = state.file;
  }

  function renderPublishedMeta(mode = "published") {
    const node = $("admin-current-published");
    if (!node) return;
    const record = currentFileRecord();
    const publishedAt = record?.published?.lastPublishedAt || record?.published?.generatedAt;
    const draftAt = record?.draft?.lastEdited || record?.draft?.generatedAt;
    node.innerHTML = `
      <span class="prediction-kicker">Loaded ${escapeHtml(mode)}</span>
      <p>Public latest publish: <strong>${escapeHtml(formatDate(publishedAt))}</strong>${draftAt ? ` / Draft updated: <strong>${escapeHtml(formatDate(draftAt))}</strong>` : ""}</p>
    `;
  }

  function loadFile(useDraft = false) {
    const record = currentFileRecord();
    if (!record) throw new Error("Choose a prediction file first.");
    const payload = useDraft && record.draft ? record.draft : record.published;
    if (!payload) throw new Error(useDraft ? "No draft exists for this file." : "Published file is missing.");
    state.data = clone(payload);
    state.selectedRaceId = state.data.races?.[0]?.raceId || "";
    state.selectedCountyKey = "";
    state.selectedCountyName = "";
    renderPublishedMeta(useDraft ? "draft" : "published");
    render();
  }

  function valueOrNull(id) {
    const value = $(id)?.value;
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function applyDisplayPercentages(target, dValue, rValue) {
    const hasD = Number.isFinite(dValue);
    const hasR = Number.isFinite(rValue);
    if (!hasD && !hasR) {
      delete target.displayPercentages;
      return;
    }
    target.displayPercentages = {};
    if (hasD) target.displayPercentages.D = dValue;
    if (hasR) target.displayPercentages.R = rValue;
  }

  async function renderAdminRaceMap() {
    const container = $("admin-race-map");
    if (!container || !window.FeaPredictionMaps?.renderRaceShapeMap) return;
    try {
      await window.FeaPredictionMaps.renderRaceShapeMap({
        container,
        data: state.data,
        selectedRaceId: state.selectedRaceId,
        onSelect: (raceId) => {
          state.selectedRaceId = raceId;
          state.selectedCountyKey = "";
          state.selectedCountyName = "";
          render();
        }
      });
    } catch (error) {
      container.innerHTML = `<p class="prediction-note">${escapeHtml(error.message || String(error))}</p>`;
    }
  }

  async function renderAdminCountyMap(race) {
    const container = $("admin-county-map");
    if (!container || !race || !window.FeaPredictionMaps?.renderCountyShapeMap) return;
    try {
      await window.FeaPredictionMaps.renderCountyShapeMap({
        container,
        race,
        countyValues: race.countyPredictions || {},
        selectedCountyKey: state.selectedCountyKey,
        onSelect: (countyKey, countyName) => {
          state.selectedCountyKey = countyKey;
          state.selectedCountyName = countyName;
          renderAdminMapCountyEditor(race);
        }
      });
    } catch (error) {
      container.innerHTML = `<p class="prediction-note">${escapeHtml(error.message || String(error))}</p>`;
    }
    renderAdminMapCountyEditor(race);
  }

  function renderAdminMapRaceEditor(race) {
    const node = $("admin-map-race-editor");
    if (!node) return;
    if (!race) {
      node.innerHTML = `<p class="prediction-note">Select a race on the map.</p>`;
      return;
    }
    const pct = window.FeaPredictionMaps?.displayPercentagesForRace?.(race) || { D: null, R: null };
    const score = Math.round(window.FeaPredictionMaps?.scoreFromRace?.(race) || 0);
    node.innerHTML = `
      <h3>${escapeHtml(race.displayName || race.raceId)}</h3>
      <div class="admin-map-editor-fields">
        <label>Map value <input id="map-race-value" type="number" min="-100" max="100" step="1" value="${escapeHtml(race.prediction?.mapValue ?? score)}"></label>
        <label>Dem % <input id="map-race-d" type="number" min="0" max="100" step="0.1" value="${pct.D === null ? "" : escapeHtml(pct.D.toFixed(1))}"></label>
        <label>GOP % <input id="map-race-r" type="number" min="0" max="100" step="0.1" value="${pct.R === null ? "" : escapeHtml(pct.R.toFixed(1))}"></label>
      </div>
      <div class="admin-prediction-actions">
        <button id="apply-map-race-editor" type="button">Apply state/district values</button>
        <button id="clear-map-race-editor" type="button">Clear manual values</button>
      </div>
    `;
    $("apply-map-race-editor")?.addEventListener("click", () => {
      race.prediction = race.prediction || {};
      const mapValue = valueOrNull("map-race-value");
      if (Number.isFinite(mapValue)) race.prediction.mapValue = Math.max(-100, Math.min(100, mapValue));
      else delete race.prediction.mapValue;
      applyDisplayPercentages(race.prediction, valueOrNull("map-race-d"), valueOrNull("map-race-r"));
      race.lastEdited = new Date().toISOString();
      race.lastEditedBy = "FEA admin";
      render();
    });
    $("clear-map-race-editor")?.addEventListener("click", () => {
      race.prediction = race.prediction || {};
      delete race.prediction.mapValue;
      delete race.prediction.displayPercentages;
      render();
    });
  }

  function renderAdminMapCountyEditor(race) {
    const node = $("admin-map-county-editor");
    if (!node) return;
    if (!race || !state.selectedCountyKey) {
      node.innerHTML = `<p class="prediction-note">Click a county or district-county piece to edit local display values.</p>`;
      return;
    }
    race.countyPredictions = race.countyPredictions || {};
    const override = race.countyPredictions[state.selectedCountyKey] || {};
    node.innerHTML = `
      <h3>${escapeHtml(state.selectedCountyName || state.selectedCountyKey)}</h3>
      <div class="admin-map-editor-fields">
        <label>County map value <input id="map-county-value" type="number" min="-100" max="100" step="1" value="${escapeHtml(override.mapValue ?? "")}"></label>
        <label>Dem % <input id="map-county-d" type="number" min="0" max="100" step="0.1" value="${escapeHtml(override.displayPercentages?.D ?? "")}"></label>
        <label>GOP % <input id="map-county-r" type="number" min="0" max="100" step="0.1" value="${escapeHtml(override.displayPercentages?.R ?? "")}"></label>
      </div>
      <div class="admin-prediction-actions">
        <button id="apply-map-county-editor" type="button">Apply county values</button>
        <button id="clear-map-county-editor" type="button">Delete county override</button>
      </div>
    `;
    $("apply-map-county-editor")?.addEventListener("click", () => {
      const row = race.countyPredictions[state.selectedCountyKey] || {};
      const mapValue = valueOrNull("map-county-value");
      if (Number.isFinite(mapValue)) row.mapValue = Math.max(-100, Math.min(100, mapValue));
      else delete row.mapValue;
      applyDisplayPercentages(row, valueOrNull("map-county-d"), valueOrNull("map-county-r"));
      if (!Object.keys(row).length) delete race.countyPredictions[state.selectedCountyKey];
      else race.countyPredictions[state.selectedCountyKey] = row;
      race.lastEdited = new Date().toISOString();
      race.lastEditedBy = "FEA admin";
      renderAdminCountyMap(race);
    });
    $("clear-map-county-editor")?.addEventListener("click", () => {
      delete race.countyPredictions[state.selectedCountyKey];
      state.selectedCountyKey = "";
      state.selectedCountyName = "";
      renderAdminCountyMap(race);
    });
  }

  function renderVisual() {
    const race = selectedRace();
    $("admin-preview").innerHTML = `
      <div class="admin-map-instructions">
        <strong>Manual color control:</strong> map value is -100 for strongest Democrat/blue, 0 for toss-up, and 100 for strongest Republican/red. Public maps and admin previews read this same value.
      </div>
      <div id="admin-race-map" class="prediction-map admin-wide-map"></div>
      <section class="admin-map-edit-grid">
        <article>
          <span class="prediction-kicker">Selected state/district</span>
          <div id="admin-map-race-editor" class="prediction-map-editor"></div>
        </article>
        <article>
          <span class="prediction-kicker">County-level override</span>
          <div id="admin-county-map" class="prediction-map admin-county-editor-map"></div>
          <div id="admin-map-county-editor" class="prediction-map-editor"></div>
        </article>
      </section>
    `;
    renderAdminRaceMap();
    renderAdminMapRaceEditor(race);
    renderAdminCountyMap(race);
  }

  function renderBulk() {
    const rows = sortedRaces().map((race) => `
      <tr data-race-id="${escapeHtml(race.raceId)}" class="${race.raceId === state.selectedRaceId ? "is-selected" : ""}">
        <td><strong>${escapeHtml(race.displayName || race.raceId)}</strong><br><small>${escapeHtml(race.raceId)}</small></td>
        <td>${escapeHtml(race.prediction?.rating || "--")}</td>
        <td>${escapeHtml(race.prediction?.winner || "--")}</td>
        <td>${escapeHtml(race.prediction?.projectedMargin ?? "--")}</td>
        <td>${escapeHtml(race.prediction?.mapValue ?? Math.round(window.FeaPredictionMaps?.scoreFromRace?.(race) || 0))}</td>
        <td>${escapeHtml(race.prediction?.confidence || "--")}</td>
        <td>${escapeHtml(race.prediction?.status || "--")}</td>
      </tr>
    `).join("");
    $("admin-preview").innerHTML = `
      <div class="prediction-table-wrap">
        <table class="prediction-table">
          <thead><tr><th>Race</th><th>Rating</th><th>Winner</th><th>Margin</th><th>Map value</th><th>Confidence</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="admin-prediction-actions admin-bulk-actions">
        <select id="bulk-rating"><option value="">Bulk rating...</option>${ratings.map((rating) => `<option>${rating}</option>`).join("")}</select>
        <select id="bulk-status"><option value="">Bulk status...</option><option>draft</option><option>reviewed</option><option>published</option><option>needs-review</option><option>updating</option></select>
        <button id="bulk-apply" type="button">Apply to selected race</button>
      </div>`;
    $("admin-preview").querySelectorAll("[data-race-id]").forEach((row) => {
      row.addEventListener("click", () => {
        state.selectedRaceId = row.dataset.raceId;
        state.selectedCountyKey = "";
        state.selectedCountyName = "";
        render();
      });
    });
    $("bulk-apply")?.addEventListener("click", () => {
      const race = selectedRace();
      if (!race) return;
      const rating = $("bulk-rating").value;
      const status = $("bulk-status").value;
      race.prediction = race.prediction || {};
      if (rating) race.prediction.rating = rating;
      if (status) race.prediction.status = status;
      render();
    });
  }

  function renderEditor() {
    const race = selectedRace();
    $("admin-selected-title").textContent = race ? (race.displayName || race.raceId) : "Select a race";
    if (!race) return;
    setSelectOptions($("edit-rating"), ratings);
    setSelectOptions($("edit-winner"), winners);
    const pct = window.FeaPredictionMaps?.displayPercentagesForRace?.(race) || { D: null, R: null };
    $("edit-rating").value = race.prediction?.rating || "Toss-up";
    $("edit-winner").value = race.prediction?.winner || "Uncalled";
    $("edit-margin").value = race.prediction?.projectedMargin ?? "";
    $("edit-map-value").value = race.prediction?.mapValue ?? Math.round(window.FeaPredictionMaps?.scoreFromRace?.(race) || 0);
    $("edit-display-d").value = pct.D === null ? "" : pct.D.toFixed(1);
    $("edit-display-r").value = pct.R === null ? "" : pct.R.toFixed(1);
    $("edit-confidence").value = race.prediction?.confidence || "medium";
    $("edit-status").value = race.prediction?.status || "published";
    $("edit-candidate-d").value = race.candidates?.D?.name || "";
    $("edit-candidate-r").value = race.candidates?.R?.name || "";
    $("edit-note-short").value = race.notes?.short || "";
    $("edit-note-why").value = race.notes?.whyWeRateItThisWay || "";
    const ref = modelReferenceFor(race.raceId);
    $("admin-model-reference").innerHTML = ref ? `
      <p><b>Model rating:</b> ${escapeHtml(ref.modelRating || "--")}</p>
      <p><b>Model winner:</b> ${escapeHtml(ref.modelWinner || "--")}</p>
      <p><b>Model margin:</b> ${escapeHtml(ref.modelMargin ?? "--")}</p>
      <p><b>Model probability:</b> ${escapeHtml(ref.modelProbability ?? "--")}</p>
      <p>${escapeHtml(ref.modelSignal || "")}</p>
    ` : "No model reference found for this race.";
  }

  function applyRaceEdits() {
    const race = selectedRace();
    if (!race) return;
    race.prediction = race.prediction || {};
    race.candidates = race.candidates || {};
    race.candidates.D = race.candidates.D || { party: "D", incumbent: false };
    race.candidates.R = race.candidates.R || { party: "R", incumbent: false };
    race.notes = race.notes || {};
    race.prediction.rating = $("edit-rating").value;
    race.prediction.winner = $("edit-winner").value;
    const margin = $("edit-margin").value;
    race.prediction.projectedMargin = margin === "" ? null : Number(margin);
    const mapValue = valueOrNull("edit-map-value");
    if (Number.isFinite(mapValue)) race.prediction.mapValue = Math.max(-100, Math.min(100, mapValue));
    else delete race.prediction.mapValue;
    applyDisplayPercentages(race.prediction, valueOrNull("edit-display-d"), valueOrNull("edit-display-r"));
    race.prediction.confidence = $("edit-confidence").value;
    race.prediction.status = $("edit-status").value;
    race.candidates.D.name = $("edit-candidate-d").value.trim();
    race.candidates.R.name = $("edit-candidate-r").value.trim();
    race.notes.short = $("edit-note-short").value.trim();
    race.notes.whyWeRateItThisWay = $("edit-note-why").value.trim();
    race.lastEdited = new Date().toISOString();
    race.lastEditedBy = "FEA admin";
    render();
  }

  function copyModelField(field) {
    const ref = modelReferenceFor(state.selectedRaceId);
    if (!ref) return;
    if (field === "rating" && ref.modelRating) $("edit-rating").value = ref.modelRating;
    if (field === "winner" && ref.modelWinner) $("edit-winner").value = ref.modelWinner;
    if (field === "margin" && ref.modelMargin !== null && ref.modelMargin !== undefined) $("edit-margin").value = Math.abs(Number(ref.modelMargin)).toFixed(1);
  }

  async function save(mode) {
    if (!state.data || !state.file) throw new Error("Load a prediction file before saving.");
    applyRaceEdits();
    const result = await api("/api/admin/predictions/save", {
      method: "POST",
      body: JSON.stringify({
        file: state.file,
        mode,
        data: state.data,
        editedBy: "FEA admin",
        changeSummary: $("admin-change-summary").value
      })
    });
    setStatus(`${mode === "publish" ? "Published" : "Draft saved"} ${result.file}. ${result.persistence?.committed ? "GitHub commit created." : result.persistence?.reason || result.persistence?.error || "Local file updated."}`);
    await bootstrap();
    if (mode === "publish") loadFile(false);
  }

  function render() {
    $("admin-visual-mode").classList.toggle("active", state.mode === "visual");
    $("admin-bulk-mode").classList.toggle("active", state.mode === "bulk");
    if (!state.data) {
      $("admin-preview").innerHTML = `<p class="prediction-note">Load a prediction file to start editing.</p>`;
      return;
    }
    if (state.mode === "bulk") renderBulk();
    else renderVisual();
    renderEditor();
  }

  async function bootstrap() {
    state.bootstrap = await api("/api/admin/predictions/bootstrap");
    renderFileSelect();
    renderPublishedMeta();
    if (!state.data) loadFile(false);
  }

  function bind() {
    $("admin-secret").value = state.secret;
    $("admin-login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      state.secret = $("admin-secret").value.trim();
      localStorage.setItem("feaAdminSecret", state.secret);
      try {
        await bootstrap();
        $("admin-login").hidden = true;
        $("admin-editor").hidden = false;
        setStatus("Prediction editor loaded.");
      } catch (error) {
        setStatus(error.message || String(error), true);
      }
    });
    $("admin-file").addEventListener("change", () => {
      state.file = $("admin-file").value;
      loadFile(false);
    });
    $("admin-load-published").addEventListener("click", () => loadFile(false));
    $("admin-load-draft").addEventListener("click", () => {
      try { loadFile(true); } catch (error) { setStatus(error.message, true); }
    });
    $("admin-visual-mode").addEventListener("click", () => { state.mode = "visual"; render(); });
    $("admin-bulk-mode").addEventListener("click", () => { state.mode = "bulk"; render(); });
    $("admin-edit-form").addEventListener("submit", (event) => {
      event.preventDefault();
      applyRaceEdits();
      setStatus("Preview updated. Save draft or publish when ready.");
    });
    $("copy-model-rating").addEventListener("click", () => copyModelField("rating"));
    $("copy-model-margin").addEventListener("click", () => copyModelField("margin"));
    $("copy-model-winner").addEventListener("click", () => copyModelField("winner"));
    $("admin-save-draft").addEventListener("click", () => save("draft").catch((error) => setStatus(error.message, true)));
    $("admin-publish").addEventListener("click", () => save("publish").catch((error) => setStatus(error.message, true)));
  }

  bind();
})();
