const updatedLabel = document.getElementById("results-updated");
const statusLabel = document.getElementById("results-status");
const groupsNode = document.getElementById("results-groups");
const detailNode = document.getElementById("results-detail");
const searchInput = document.getElementById("results-search");
const refreshButton = document.getElementById("results-refresh");

let liveResultsData = null;
let selectedRaceId = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function numberLabel(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US") : "0";
}

function percentLabel(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : "0.0%";
}

function dateLabel(value) {
  if (!value) return "Date TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date TBA";
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric" }).format(date);
}

function timeLabel(value) {
  if (!value) return "Awaiting first data pull";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Awaiting first data pull";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function partyClass(partyCode) {
  if (partyCode === "D") return "party-dem";
  if (partyCode === "R") return "party-rep";
  if (partyCode === "I") return "party-ind";
  return "party-other";
}

function markerClass(marker) {
  return `marker-${marker?.kind || "general"}`;
}

function raceMatches(race, query) {
  if (!query) return true;
  const haystack = [
    race.electionName,
    race.stateName,
    race.state,
    race.type,
    race.leaderName,
    ...(race.candidates || []).map((candidate) => candidate.name)
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function flattenRaces(data = liveResultsData) {
  return (data?.groups || []).flatMap((group) => group.races || []);
}

function leadingCandidate(race) {
  return (race.candidates || [])[0] || null;
}

function raceCard(race) {
  const leader = leadingCandidate(race);
  const isSelected = String(selectedRaceId) === String(race.id);
  return `
    <a class="result-race-row ${isSelected ? "active" : ""}" href="result.html?id=${encodeURIComponent(race.id)}" data-race-id="${escapeHtml(race.id)}">
      <span class="result-election-marker ${markerClass(race.marker)}" title="${escapeHtml(race.marker?.label || "Election")}">
        <i>${escapeHtml(race.marker?.short || "G")}</i>
      </span>
      <span class="result-race-copy">
        <strong>${escapeHtml(race.electionName)}</strong>
        <small>${escapeHtml(leader?.name || "No votes reported yet")}${race.otherCandidateCount ? ` + ${race.otherCandidateCount} candidate${race.otherCandidateCount === 1 ? "" : "s"}` : ""}</small>
      </span>
      <span class="result-date">${escapeHtml(dateLabel(race.electionDate))}</span>
    </a>
  `;
}

function renderGroups() {
  if (!groupsNode || !liveResultsData) return;
  const query = searchInput?.value?.trim() || "";
  const groups = (liveResultsData.groups || []).map((group) => ({
    ...group,
    races: (group.races || []).filter((race) => raceMatches(race, query))
  }));

  groupsNode.innerHTML = groups.map((group) => `
    <section class="result-state-card">
      <div class="result-state-head">
        <div>
          <p class="kicker">${escapeHtml(group.state)}</p>
          <h2>${escapeHtml(group.stateName)}</h2>
        </div>
        <a href="https://civicapi.org/results" target="_blank" rel="noreferrer">${numberLabel(group.featuredCount)} featured / ${numberLabel(group.totalAvailable)} total</a>
      </div>
      <div class="result-race-list">
        ${group.races.length ? group.races.map(raceCard).join("") : `<p class="meta">No matching featured races in this group.</p>`}
      </div>
    </section>
  `).join("");

  groupsNode.querySelectorAll("[data-race-id]").forEach((button) => {
    button.addEventListener("mouseenter", () => {
      selectedRaceId = button.dataset.raceId;
      renderGroups();
      renderDetail();
    });
  });
}

function candidateRows(race) {
  const candidates = race.candidates || [];
  const maxPercent = Math.max(1, ...candidates.map((candidate) => Number(candidate.percent || 0)));
  return candidates.slice(0, 8).map((candidate) => {
    const width = Math.max(3, (Number(candidate.percent || 0) / maxPercent) * 100);
    return `
      <div class="result-candidate-row ${candidate.winner ? "called" : ""}">
        <div>
          <span class="result-party-dot ${partyClass(candidate.partyCode)}">${escapeHtml(candidate.partyCode)}</span>
          <strong>${escapeHtml(candidate.name)}</strong>
          <small>${escapeHtml(candidate.party || "Other")}</small>
        </div>
        <div class="result-candidate-bar" aria-hidden="true"><i style="width:${width}%"></i></div>
        <span>${numberLabel(candidate.votes)}</span>
        <b>${percentLabel(candidate.percent)}</b>
      </div>
    `;
  }).join("");
}

function renderDetail() {
  if (!detailNode || !liveResultsData) return;
  const races = flattenRaces();
  const race = races.find((item) => String(item.id) === String(selectedRaceId)) || races[0];
  selectedRaceId = race?.id || null;

  if (!race) {
    detailNode.innerHTML = `
      <p class="kicker">Race detail</p>
      <h2>No results loaded yet.</h2>
      <p class="lede">The page will populate after the live-results generator reaches the election API.</p>
    `;
    return;
  }

  const leader = leadingCandidate(race);
  detailNode.innerHTML = `
    <p class="kicker">${escapeHtml(race.stateName)} ${escapeHtml(race.type)}</p>
    <div class="result-detail-title">
      <div>
        <h2>${escapeHtml(race.electionName)}</h2>
        <p>${escapeHtml(race.electionType || "Election")} | ${escapeHtml(dateLabel(race.electionDate))}</p>
      </div>
      <span class="rating-pill">${percentLabel(race.percentReporting)} in</span>
    </div>
    <div class="result-leader-line">
      <span class="result-party-dot ${partyClass(leader?.partyCode)}">${escapeHtml(leader?.partyCode || "")}</span>
      <strong>${escapeHtml(leader?.name || "No leader yet")}</strong>
      <span>${leader ? `${percentLabel(leader.percent)} / ${numberLabel(leader.votes)} votes` : "Awaiting returns"}</span>
    </div>
    <p><a class="button-link" href="result.html?id=${encodeURIComponent(race.id)}">Open full results</a></p>
    <div class="result-candidate-table">
      <div class="result-candidate-head"><span>Candidate</span><span></span><span>Votes</span><span>Share</span></div>
      ${candidateRows(race) || `<p class="meta">No candidate vote rows reported yet.</p>`}
    </div>
    <p class="forecast-disclaimer">${escapeHtml(liveResultsData.provider?.attribution || "")}</p>
  `;
}

function renderMeta(data, source) {
  if (updatedLabel) updatedLabel.textContent = timeLabel(data.generatedAt);
  if (statusLabel) {
    const errorCount = data.errors?.length || 0;
    statusLabel.textContent = errorCount ? `${errorCount} source group${errorCount === 1 ? "" : "s"} unavailable` : `Tracking ${flattenRaces(data).length} featured races`;
    statusLabel.dataset.source = source || "cache";
  }
}

async function fetchResults(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function loadResults(forceLive = false) {
  if (statusLabel) statusLabel.textContent = "Loading results...";
  try {
    liveResultsData = forceLive
      ? await fetchResults("/api/live-results")
      : await fetchResults("data/live-results.json");
    if (!flattenRaces(liveResultsData).length && !forceLive) {
      try {
        liveResultsData = await fetchResults("/api/live-results");
        renderMeta(liveResultsData, "live");
      } catch {
        renderMeta(liveResultsData, "cache");
      }
    } else {
      renderMeta(liveResultsData, forceLive ? "live" : "cache");
    }
    renderGroups();
    renderDetail();
  } catch (error) {
    if (statusLabel) statusLabel.textContent = "Live results unavailable";
    if (groupsNode) groupsNode.innerHTML = `<p class="meta">No results data could be loaded.</p>`;
    if (detailNode) detailNode.innerHTML = `<p class="meta">No race selected.</p>`;
    console.error(error);
  }
}

searchInput?.addEventListener("input", renderGroups);
refreshButton?.addEventListener("click", () => loadResults(true));

loadResults();
