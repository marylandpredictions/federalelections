(() => {
  const state = {
    secret: sessionStorage.getItem("feaAdminSecret") || "",
    races: [],
    calls: { races: {} },
    notes: { races: {} }
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
    return state.races.find((race) => race.id === raceSelect.value) || state.races[0] || null;
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
    const now = new Date();
    $("noteDate").value = now.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }

  function renderApp() {
    raceSelect.innerHTML = state.races.map((race) => `
      <option value="${escapeHtml(race.id)}">${escapeHtml(race.state ? `${race.state} - ${race.label}` : race.label)}</option>
    `).join("");
    renderRace();
  }

  async function unlock() {
    state.secret = secretInput.value.trim();
    if (!state.secret) return;
    const payload = await adminFetch("/api/admin/bootstrap");
    sessionStorage.setItem("feaAdminSecret", state.secret);
    state.races = payload.races || [];
    state.calls = payload.calls || { races: {} };
    state.notes = payload.notes || { races: {} };
    loginPanel.hidden = true;
    adminApp.hidden = false;
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
      setStatus(callStatus, "Calls saved. The site will pick this up on its next refresh.");
    } catch (error) {
      setStatus(callStatus, error.message, true);
    }
  }

  async function saveNote() {
    const race = currentRace();
    if (!race) return;
    setStatus(noteStatus, "Saving...");
    try {
      const payload = await adminFetch("/api/admin/notes", {
        method: "POST",
        body: JSON.stringify({
          raceId: race.id,
          author: $("noteAuthor").value,
          role: $("noteRole").value,
          date: $("noteDate").value,
          text: $("noteText").value,
          image: $("noteImage").value,
          embed: $("noteEmbed").value
        })
      });
      state.notes.races[race.id] = payload.notes || [];
      $("noteText").value = "";
      $("noteImage").value = "";
      $("noteEmbed").value = "";
      setStatus(noteStatus, "Analyst note added as newest note.");
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
  $("addCallRow").addEventListener("click", () => {
    callRows.insertAdjacentHTML("beforeend", callRowMarkup());
  });
  $("saveCalls").addEventListener("click", saveCalls);
  $("saveNote").addEventListener("click", saveNote);
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
