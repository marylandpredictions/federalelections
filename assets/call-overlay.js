(function () {
  const root = document.getElementById("call-overlay");
  const params = new URLSearchParams(window.location.search);
  const raceFilter = params.get("race");
  let lastSignature = "";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function slugify(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  }

  function candidateColor(candidate) {
    const color = String(candidate?.color || "").trim();
    if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return color;
    if (candidate?.partyCode === "R") return "#e03a3e";
    if (candidate?.partyCode === "D") return "#1030b2";
    return "#2f74ff";
  }

  function isRealCandidate(candidate) {
    const name = String(candidate?.name || "").trim();
    return Boolean(name) && !/^write-?in$/i.test(name);
  }

  function pollsAreClosed(race) {
    const iso = race?.pollsClose || race?.pollCloseAt;
    if (!iso) return false;
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) && Date.now() >= date.getTime();
  }

  function automaticUncontestedCalls(race) {
    if (!pollsAreClosed(race)) return [];
    const realCandidates = (race.candidates || []).filter(isRealCandidate);
    if (realCandidates.length !== 1) return [];
    return [{
      candidate: realCandidates[0].name,
      status: "winner",
      label: "Winner",
      automatic: true
    }];
  }

  function labelFor(call, race) {
    if (call.label) return call.label;
    const status = String(call.status || "").toLowerCase();
    const raceText = `${race?.electionScope || race?.electionName || ""}`.toLowerCase();
    if (status === "projected") return "Projected winner";
    if (status === "advanced") return "Advanced to general election";
    if (status === "advances" || raceText.includes("primary")) return "Advances";
    return "Winner";
  }

  function verbFor(label, race, count) {
    const text = String(label || "").toLowerCase();
    const raceText = `${race?.electionScope || race?.electionName || ""}`.toLowerCase();
    if (text.includes("advance") || raceText.includes("open primary") || count > 1) return count > 1 ? "advance" : "advances";
    if (text.includes("project")) return "is projected to win";
    return "wins";
  }

  function callText(race, calledCandidates) {
    const names = calledCandidates.map((item) => item.candidate?.name || item.call.candidate).filter(Boolean);
    const label = labelFor(calledCandidates[0]?.call || {}, race);
    const verb = verbFor(label, race, names.length);
    const raceName = race?.electionName || "this race";
    if (names.length === 1) return `${names[0]} ${verb} ${raceName}.`;
    if (names.length === 2) return `${names[0]} and ${names[1]} ${verb} in ${raceName}.`;
    return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)} ${verb} in ${raceName}.`;
  }

  async function fetchJson(url) {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
  }

  function flattenRaces(data) {
    return (data.groups || []).flatMap((group) => group.races || []);
  }

  function latestCall(callsData, races) {
    const manualEntries = Object.entries(callsData.races || [])
      .filter(([raceId]) => !raceFilter || String(raceId) === String(raceFilter))
      .flatMap(([raceId, value]) => (value.calls || []).map((call, index) => ({ raceId, call, index })));
    const manuallyCalledRaceIds = new Set(manualEntries.map((entry) => String(entry.raceId)));
    const autoEntries = races
      .filter((race) => !raceFilter || String(race.id) === String(raceFilter))
      .filter((race) => !manuallyCalledRaceIds.has(String(race.id)))
      .flatMap((race) => automaticUncontestedCalls(race).map((call, index) => ({ raceId: String(race.id), call, index })));
    const entries = [...manualEntries, ...autoEntries];
    if (!entries.length) return null;
    entries.sort((a, b) => {
      const aTime = Date.parse(a.call.calledAt || "") || 0;
      const bTime = Date.parse(b.call.calledAt || "") || 0;
      return bTime - aTime || b.index - a.index;
    });
    const newestRaceId = entries[0].raceId;
    const race = races.find((item) => String(item.id) === String(newestRaceId));
    const raceCalls = entries.filter((entry) => entry.raceId === newestRaceId);
    const calledCandidates = raceCalls.map((entry) => ({
      call: entry.call,
      candidate: (race?.candidates || []).find((candidate) => String(candidate.name || "").toLowerCase() === String(entry.call.candidate || "").toLowerCase())
    }));
    return { race, calledCandidates };
  }

  function render(data) {
    if (!data) {
      root.innerHTML = `<div class="call-overlay-empty"></div>`;
      return;
    }
    const { race, calledCandidates } = data;
    const primary = calledCandidates[0]?.candidate || { name: calledCandidates[0]?.call?.candidate || "Candidate" };
    const label = labelFor(calledCandidates[0]?.call || {}, race);
    const color = candidateColor(primary);
    const photo = `assets/img/candidates/live-results/${slugify(primary.name)}.png`;
    const signature = `${race?.id || ""}:${calledCandidates.map((item) => `${item.call.candidate}:${item.call.status}:${item.call.calledAt || ""}`).join("|")}`;
    if (signature === lastSignature) return;
    lastSignature = signature;
    root.innerHTML = `
      <section class="call-overlay-card" style="--candidate-color:${escapeHtml(color)}">
        <div class="call-overlay-copy">
          <span class="call-overlay-label">${escapeHtml(label)} <i aria-hidden="true">&#10003;</i></span>
          <h1 class="call-overlay-title">${escapeHtml(callText(race, calledCandidates))}</h1>
          <p class="call-overlay-subtitle">Race called by Federal Elections Analysis.</p>
        </div>
        <span class="call-overlay-avatar">
          <img src="${escapeHtml(photo)}" alt="" onerror="this.remove(); this.parentNode.textContent='${escapeHtml(initials(primary.name))}'">
        </span>
      </section>
    `;
  }

  async function update() {
    try {
      const [callsData, resultsData] = await Promise.all([
        fetchJson("data/result-calls.json"),
        fetchJson("data/live-results.json")
      ]);
      render(latestCall(callsData, flattenRaces(resultsData)));
    } catch (error) {
      console.error(error);
    }
  }

  update();
  setInterval(update, 5000);
})();
