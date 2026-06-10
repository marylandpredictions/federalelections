(() => {
  const state = {
    secret: sessionStorage.getItem("feaAdminSecret") || "",
    latestRaces: [],
    allRaces: [],
    showAllRaces: false,
    calls: { races: {} },
    notes: { races: {} },
    overlay: { tickerItems: [], producerNote: "" },
    noteIndex: null
  };

  const $ = (id) => document.getElementById(id);
  const loginPanel = $("loginPanel");
  const adminApp = $("adminApp");
  const secretInput = $("adminSecret");
  const raceSelect = $("raceSelect");
  const candidateList = $("candidateList");
  const callRows = $("callRows");
  const callStatus = $("callStatus");
  const noteStatus = $("noteStatus");
  const overlayStatus = $("overlayStatus");
  const noteSelect = $("noteSelect");
  const showAllRaces = $("showAllRaces");
  const raceModeLabel = $("raceModeLabel");
  const callPreview = $("callPreview");

  const PHOTO_FOLDERS = {
    "79777": "california-governor",
    "79779": "california-lieutenant-governor",
    "79778": "california-insurance-commissioner",
    "79881": "california-superintendent",
    "79893": "california-us-house-1",
    "79884": "california-us-house-11",
    "79896": "california-us-house-22",
    "79907": "california-us-house-32",
    "79916": "california-us-house-40",
    "79932": "california-us-house-7"
  };

  function setStatus(element, message, error = false) {
    element.textContent = message;
    element.classList.toggle("error", error);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function currentRace() {
    const races = activeRaces();
    return races.find((race) => race.id === raceSelect.value) || races[0] || null;
  }

  function activeRaces() {
    return state.showAllRaces ? state.allRaces : state.latestRaces;
  }

  function slugify(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function initials(name) {
    const parts = String(name || "").replace(/\([^)]*\)/g, " ").split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase();
  }

  const DEM_PALETTE = [
    "#0391FF", "#5FC529", "#5560F5", "#32EBEB", "#2AE19F",
    "#214BE1", "#9FE121", "#5E21E1", "#72A2FF", "#A985F8",
    "#CA58F9", "#12A500", "#0033A5"
  ];

  const GOP_PALETTE = [
    "#A50000", "#C66518", "#DFC30E", "#C00F79", "#E14F50",
    "#FE9745", "#620000", "#FF8686", "#FF68B1"
  ];

  function stringToHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  function candidateColor(candidate = {}, race = {}) {
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(candidate.color || "")) return candidate.color;
    
    const partyCode = candidate.partyCode || "";
    const candidateName = String(candidate.name || "").toLowerCase();
    const hash = stringToHash(candidateName + String(race.id || ""));
    
    if (partyCode === "R" || partyCode === "Republican") {
      return GOP_PALETTE[hash % GOP_PALETTE.length];
    }
    if (partyCode === "D" || partyCode === "Democrat") {
      return DEM_PALETTE[hash % DEM_PALETTE.length];
    }
    if (partyCode === "I" || partyCode === "Independent") return "#2ec6a3";
    return "#7c6cff";
  }

  function candidatePhoto(candidate = {}, race = {}) {
    if (candidate.headshotUrl) return candidate.headshotUrl;
    const folder = PHOTO_FOLDERS[String(race.id)];
    if (folder) return `assets/img/candidates/${folder}/${slugify(candidate.name)}.webp`;
    return `assets/img/candidates/live-results/${slugify(candidate.name)}.webp`;
  }

  function authHeaders() {
    return {
      "Content-Type": "application/json",
      "X-Admin-Secret": state.secret
    };
  }

  async function adminFetch(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...authHeaders(),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "Admin request failed.");
    return payload;
  }

  function callRowMarkup(call = {}) {
    const candidates = currentRace()?.candidates || [];
    return `
      <div class="admin-call-row">
        <select class="admin-select call-candidate">
          <option value="">Choose candidate</option>
          ${candidates.map((candidate) => `
            <option value="${escapeHtml(candidate.name)}" ${candidate.name === call.candidate ? "selected" : ""}>
              ${escapeHtml(candidate.name)}${candidate.partyCode ? ` (${escapeHtml(candidate.partyCode)})` : ""}
            </option>
          `).join("")}
        </select>
        <select class="admin-select call-status">
          ${[
            ["projected", "Projected winner"],
            ["winner", "Winner"],
            ["advances", "Advances"],
            ["advanced", "Advanced"]
          ].map(([value, label]) => `<option value="${value}" ${value === call.status ? "selected" : ""}>${label}</option>`).join("")}
        </select>
        <button class="admin-button secondary remove-call" type="button" title="Remove row">x</button>
      </div>
    `;
  }

  function renderCalls() {
    const raceId = currentRace()?.id;
    const calls = state.calls.races?.[raceId]?.calls || [];
    callRows.innerHTML = calls.length ? calls.map(callRowMarkup).join("") : callRowMarkup();
    renderCallPreview();
  }

  function currentNotes() {
    const raceId = currentRace()?.id;
    const notes = state.notes.races?.[raceId];
    return Array.isArray(notes) ? notes : [];
  }

  function renderNoteSelect() {
    if (!noteSelect) return;
    const notes = currentNotes();
    noteSelect.innerHTML = `
      <option value="">Add a new note</option>
      ${notes.map((note, index) => `
        <option value="${index}">${escapeHtml(note.date || `Note ${index + 1}`)} - ${escapeHtml(note.author || "FEA")}</option>
      `).join("")}
    `;
    noteSelect.value = state.noteIndex === null ? "" : String(state.noteIndex);
  }

  function clearNoteForm() {
    state.noteIndex = null;
    $("noteAuthor").value = "FEA Analysis Desk";
    $("noteRole").value = "Analysis desk";
    $("noteText").value = "";
    $("noteImage").value = "";
    $("noteEmbed").value = "";
    const now = new Date();
    $("noteDate").value = now.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
    renderNoteSelect();
    $("saveNote").textContent = "Add newest note";
  }

  function loadSelectedNote() {
    const index = Number(noteSelect?.value);
    const note = Number.isInteger(index) ? currentNotes()[index] : null;
    if (!note) {
      clearNoteForm();
      return;
    }
    state.noteIndex = index;
    $("noteAuthor").value = note.author || "FEA Analysis Desk";
    $("noteRole").value = note.role || "Analysis desk";
    $("noteDate").value = note.date || "";
    $("noteText").value = note.text || "";
    $("noteImage").value = typeof note.image === "string" ? note.image : note.image ? JSON.stringify(note.image) : "";
    $("noteEmbed").value = typeof note.embed === "string" ? note.embed : note.embed ? JSON.stringify(note.embed) : "";
    renderNoteSelect();
    $("saveNote").textContent = "Save selected note";
  }

  function renderRace() {
    const race = currentRace();
    if (!race) return;
    candidateList.innerHTML = (race.candidates || []).map((candidate) => `
      <button class="admin-candidate" type="button" data-candidate="${escapeHtml(candidate.name)}">
        <strong>${escapeHtml(candidate.name)}</strong>
        <span>${escapeHtml(candidate.party || candidate.partyCode || "")}</span>
      </button>
    `).join("");
    renderCalls();
    clearNoteForm();
    renderNoteSelect();
  }

  function renderApp() {
    const races = activeRaces();
    const previousValue = raceSelect.value;
    raceModeLabel.textContent = state.showAllRaces ? "All persisted races" : "Latest result races only";
    raceSelect.innerHTML = races.map((race) => `
      <option value="${escapeHtml(race.id)}">${escapeHtml(race.state ? `${race.state} - ${race.label}` : race.label)}</option>
    `).join("");
    if (races.some((race) => race.id === previousValue)) raceSelect.value = previousValue;
    renderRace();
  }

  function renderOverlayForm() {
    const overlay = state.overlay || {};
    $("tickerText").value = (overlay.tickerItems || []).map((item) => item.text || "").filter(Boolean).join("\n");
    $("producerNote").value = overlay.producerNote || "";
  }

  function callVerb(label, race, count) {
    const text = String(label || "").toLowerCase();
    const raceText = String(race?.label || "").toLowerCase();
    if (text.includes("advance") || raceText.includes("primary") || count > 1) return count > 1 ? "advance" : "advances";
    if (text.includes("project")) return "is projected to win";
    return "wins";
  }

  function callLabel(call) {
    const status = String(call?.status || "").toLowerCase();
    if (call?.label) return call.label;
    if (status === "winner") return "Winner";
    if (status === "advanced") return "Advanced to general election";
    if (status === "advances") return "Advances";
    return "Projected winner";
  }

  function renderCallPreview() {
    const race = currentRace();
    const calls = state.calls.races?.[race?.id]?.calls || [];
    if (!race || !calls.length) {
      callPreview.className = "admin-preview-empty";
      callPreview.innerHTML = "This race has no manual call yet. Save a call to preview the OBS graphic.";
      return;
    }
    const calledCandidates = calls.map((call) => ({
      call,
      candidate: (race.candidates || []).find((candidate) => candidate.name.toLowerCase() === call.candidate.toLowerCase()) || { name: call.candidate, partyCode: "" }
    }));
    const color = candidateColor(calledCandidates[0]?.candidate);
    const names = calledCandidates.map((item) => item.candidate.name);
    const label = callLabel(calls[0]);
    const verb = callVerb(label, race, names.length);
    const text = names.length === 1
      ? `${names[0]} ${verb} in the ${race.label}.`
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} ${verb} in the ${race.label}.`;
    const avatars = calledCandidates.map((item) => {
      const photo = candidatePhoto(item.candidate, race);
      return `
        <span class="admin-preview-avatar" style="--candidate-color:${escapeHtml(candidateColor(item.candidate))}">
          <img src="${escapeHtml(photo)}" alt="" onerror="this.remove()">
          <span>${escapeHtml(initials(item.candidate.name))}</span>
        </span>
      `;
    }).join("");
    callPreview.className = "admin-preview-card";
    callPreview.style.setProperty("--candidate-color", color);
    callPreview.innerHTML = `
      <div class="admin-preview-card-inner">
        <div>
          <p class="admin-preview-label">${escapeHtml(label)}</p>
          <h3>${escapeHtml(text)}</h3>
          <small>Race called by Federal Elections Analysis.</small>
        </div>
        <div class="admin-preview-avatars">${avatars}</div>
      </div>
    `;
  }

  async function unlock() {
    state.secret = secretInput.value.trim();
    if (!state.secret) return;
    const payload = await adminFetch("/api/admin/bootstrap");
    sessionStorage.setItem("feaAdminSecret", state.secret);
    state.latestRaces = payload.latestRaces || payload.races || [];
    state.allRaces = payload.allRaces || state.latestRaces;
    state.calls = payload.calls || { races: {} };
    state.notes = payload.notes || { races: {} };
    state.overlay = payload.overlay || { tickerItems: [], producerNote: "" };
    loginPanel.hidden = true;
    adminApp.hidden = false;
    renderOverlayForm();
    renderApp();
  }

  function collectCalls() {
    return [...callRows.querySelectorAll(".admin-call-row")]
      .map((row) => ({
        candidate: row.querySelector(".call-candidate")?.value || "",
        status: row.querySelector(".call-status")?.value || "projected"
      }))
      .filter((call) => call.candidate);
  }

  async function saveCalls() {
    const race = currentRace();
    if (!race) return;
    setStatus(callStatus, "Saving...");
    try {
      const payload = await adminFetch("/api/admin/calls", {
        method: "POST",
        body: JSON.stringify({ raceId: race.id, calls: collectCalls() })
      });
      state.calls.races[race.id] = { calls: payload.calls || [] };
      renderCalls();
      const files = (payload.persistedFiles || []).join(", ");
      setStatus(callStatus, files
        ? `Calls saved to repo data files: ${files}.`
        : "Calls saved. The site will pick this up on its next refresh.");
    } catch (error) {
      setStatus(callStatus, error.message, true);
    }
  }

  async function saveOverlay() {
    setStatus(overlayStatus, "Saving...");
    try {
      const payload = await adminFetch("/api/admin/overlay", {
        method: "POST",
        body: JSON.stringify({
          tickerText: $("tickerText").value,
          producerNote: $("producerNote").value
        })
      });
      state.overlay = payload.overlay || state.overlay;
      const files = (payload.persistedFiles || []).join(", ");
      setStatus(overlayStatus, files
        ? `Overlay ticker saved to repo data files: ${files}.`
        : "Overlay ticker saved. The OBS overlay will pick this up on its next refresh.");
    } catch (error) {
      setStatus(overlayStatus, error.message, true);
    }
  }

  async function saveNote() {
    const race = currentRace();
    if (!race) return;
    setStatus(noteStatus, "Saving...");
    try {
      const wasEditing = state.noteIndex !== null;
      const payload = await adminFetch("/api/admin/notes", {
        method: "POST",
        body: JSON.stringify({
          raceId: race.id,
          author: $("noteAuthor").value,
          role: $("noteRole").value,
          date: $("noteDate").value,
          text: $("noteText").value,
          image: $("noteImage").value,
          embed: $("noteEmbed").value,
          noteIndex: state.noteIndex
        })
      });
      state.notes.races[race.id] = payload.notes || [];
      state.noteIndex = null;
      $("noteText").value = "";
      $("noteImage").value = "";
      $("noteEmbed").value = "";
      renderNoteSelect();
      $("saveNote").textContent = "Add newest note";
      const files = (payload.persistedFiles || []).join(", ");
      const message = wasEditing ? "Analyst note updated" : "Analyst note added as newest note";
      setStatus(noteStatus, files ? `${message} in repo data files: ${files}.` : `${message}.`);
    } catch (error) {
      setStatus(noteStatus, error.message, true);
    }
  }

  $("unlockAdmin").addEventListener("click", () => unlock().catch((error) => {
    const status = document.createElement("p");
    status.className = "admin-status error";
    status.textContent = error.message;
    loginPanel.append(status);
  }));
  secretInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") unlock().catch((error) => alert(error.message));
  });
  raceSelect.addEventListener("change", renderRace);
  showAllRaces?.addEventListener("change", () => {
    state.showAllRaces = Boolean(showAllRaces.checked);
    renderApp();
  });
  $("addCallRow").addEventListener("click", () => {
    callRows.insertAdjacentHTML("beforeend", callRowMarkup());
  });
  $("saveCalls").addEventListener("click", saveCalls);
  $("saveOverlay").addEventListener("click", saveOverlay);
  $("saveNote").addEventListener("click", saveNote);
  $("loadNote")?.addEventListener("click", loadSelectedNote);
  $("newNote")?.addEventListener("click", clearNoteForm);
  noteSelect?.addEventListener("change", () => {
    if (noteSelect.value === "") clearNoteForm();
    else loadSelectedNote();
  });
  callRows.addEventListener("click", (event) => {
    if (event.target.closest(".remove-call")) {
      event.target.closest(".admin-call-row")?.remove();
      if (!callRows.querySelector(".admin-call-row")) callRows.innerHTML = callRowMarkup();
    }
  });
  candidateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-candidate]");
    if (!button) return;
    const emptySelect = [...callRows.querySelectorAll(".call-candidate")].find((select) => !select.value);
    const target = emptySelect || (() => {
      callRows.insertAdjacentHTML("beforeend", callRowMarkup());
      return [...callRows.querySelectorAll(".call-candidate")].at(-1);
    })();
    target.value = button.dataset.candidate;
  });

  if (state.secret) {
    secretInput.value = state.secret;
  }
})();
