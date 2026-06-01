const updatedLabel = document.getElementById("results-updated");
const statusLabel = document.getElementById("results-status");
const groupsNode = document.getElementById("results-groups");
const searchInput = document.getElementById("results-search");
const refreshButton = document.getElementById("results-refresh");

let liveResultsData = null;

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
  const candidates = [...(race.candidates || [])];
  if (candidates.some((candidate) => Number(candidate.votes || 0) || Number(candidate.percent || 0))) {
    return candidates.sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0) || Number(b.votes || 0) - Number(a.votes || 0))[0] || null;
  }
  return candidates[0] || null;
}

function raceCard(race) {
  const leader = leadingCandidate(race);
  const hasCall = Boolean((race.calls || []).length || (race.candidates || []).some((candidate) => candidate.callLabel));
  return `
    <a class="result-race-row ${hasCall ? "has-call" : ""}" href="result.html?id=${encodeURIComponent(race.id)}">
      <span class="result-election-marker ${markerClass(race.marker)}" title="${escapeHtml(race.marker?.label || "Election")}">
        <i>${escapeHtml(race.marker?.short || "G")}</i>
      </span>
      <span class="result-race-copy">
        <strong>${escapeHtml(race.electionName)}</strong>
        <small>${escapeHtml(leader?.name || "No votes reported yet")}${race.otherCandidateCount ? ` + ${race.otherCandidateCount} candidate${race.otherCandidateCount === 1 ? "" : "s"}` : ""}</small>
      </span>
      ${hasCall ? `<span class="result-race-call">Called</span>` : ""}
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
        <span>${numberLabel(group.featuredCount)} tracked</span>
      </div>
      <div class="result-race-list">
        ${group.races.length ? group.races.map(raceCard).join("") : `<p class="meta">No matching featured races in this group.</p>`}
      </div>
    </section>
  `).join("");
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
  const previousData = liveResultsData;
  if (statusLabel) statusLabel.textContent = forceLive ? "Refreshing..." : "Loading results...";
  if (refreshButton) refreshButton.disabled = true;
  try {
    let source = "cache";
    try {
      liveResultsData = await fetchResults("/api/live-results");
      source = "live";
    } catch {
      liveResultsData = await fetchResults("data/live-results.json");
    }
    if (!flattenRaces(liveResultsData).length && source !== "live") {
      try {
        liveResultsData = await fetchResults("/api/live-results");
        source = "live";
      } catch {
      }
    }
    renderMeta(liveResultsData, source);
    renderGroups();
  } catch (error) {
    if (previousData) {
      liveResultsData = previousData;
      renderMeta(liveResultsData, "cache");
      renderGroups();
      if (statusLabel) statusLabel.textContent = "Refresh failed; showing cached races";
    } else {
      if (statusLabel) statusLabel.textContent = "Live results unavailable";
      if (groupsNode) groupsNode.innerHTML = `<p class="meta">No results data could be loaded.</p>`;
    }
    console.error(error);
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}

searchInput?.addEventListener("input", renderGroups);
refreshButton?.addEventListener("click", () => loadResults(true));

loadResults();
setInterval(() => loadResults(false), 30000);
