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

const POLL_CLOSE_UTC_BY_STATE = {
  CA: "2026-06-03T03:00:00Z",
  IA: "2026-06-03T01:00:00Z",
  MT: "2026-06-03T02:00:00Z",
  NJ: "2026-06-03T00:00:00Z",
  NM: "2026-06-03T01:00:00Z",
  SD: "2026-06-03T01:00:00Z"
};

function pollCloseLabel(race) {
  const iso = race.pollsClose || race.pollCloseAt || POLL_CLOSE_UTC_BY_STATE[race.state];
  if (!iso) return "";
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return "";
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return "Polls closed";
  const totalMinutes = Math.ceil(diff / 60000);
  if (totalMinutes > 180) {
    const time = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York"
    }).format(target);
    return `Polls close at ${time} EST`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `Polls close in ${hours}h ${String(minutes).padStart(2, "0")}m`;
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
  const featuredNames = (race.featuredCandidateNames || []).map((name) => String(name).toLowerCase());
  if (!featuredNames.length) return candidates[0] || null;
  return candidates.sort((a, b) => {
    const aRank = featuredNames.indexOf(String(a.name || "").toLowerCase());
    const bRank = featuredNames.indexOf(String(b.name || "").toLowerCase());
    const aValue = aRank === -1 ? Number.POSITIVE_INFINITY : aRank;
    const bValue = bRank === -1 ? Number.POSITIVE_INFINITY : bRank;
    return aValue - bValue;
  })[0] || null;
}

function raceCard(race) {
  const leader = leadingCandidate(race);
  const hasCall = Boolean((race.calls || []).length || (race.candidates || []).some((candidate) => candidate.callLabel));
  const closeLabel = pollCloseLabel(race);
  return `
    <a class="result-race-row ${hasCall ? "has-call" : ""}" href="result.html?id=${encodeURIComponent(race.id)}">
      <span class="result-election-marker ${markerClass(race.marker)}" title="${escapeHtml(race.marker?.label || "Election")}">
        <i>${escapeHtml(race.marker?.short || "G")}</i>
      </span>
      <span class="result-race-copy">
        <strong>${escapeHtml(race.electionName)}</strong>
        <small>${escapeHtml(leader?.name || "No votes reported yet")}${race.otherCandidateCount ? ` + ${race.otherCandidateCount} candidate${race.otherCandidateCount === 1 ? "" : "s"}` : ""}</small>
      </span>
      <span class="result-race-meta">
        ${hasCall ? `<span class="result-race-call">Called</span>` : ""}
        <span class="result-date">${escapeHtml(closeLabel || dateLabel(race.electionDate))}</span>
      </span>
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

function displayCallLabel(call, race) {
  if (call.label) return call.label;
  const status = String(call.status || "").toLowerCase();
  const multiWinner = Number(race.winners || race.advancingCount || 1) > 1 || /open primary|top-two/i.test(race.type || race.electionName || "");
  if (status.includes("advance")) return status.includes("projected") ? "Projected advance" : "Advances";
  if (status.includes("project")) return multiWinner ? "Projected advance" : "Projected winner";
  if (status.includes("win") || status.includes("call")) return multiWinner ? "Advanced to general election" : "Winner";
  return multiWinner ? "Advances" : "Projected winner";
}

function isRealCandidate(candidate) {
  const name = String(candidate?.name || "").trim();
  return Boolean(name) && !/^write-?in$/i.test(name);
}

function pollsAreClosed(race) {
  const iso = race?.pollsClose || race?.pollCloseAt || POLL_CLOSE_UTC_BY_STATE[race.state];
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

async function loadManualCalls() {
  const response = await fetch(`data/result-calls.json?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) return { races: {} };
  return response.json();
}

async function applyManualCalls(data) {
  const callsData = await loadManualCalls().catch(() => ({ races: {} }));
  const callRaces = callsData.races || {};
  return {
    ...data,
    groups: (data.groups || []).map((group) => ({
      ...group,
      races: (group.races || []).map((race) => {
        const manualCalls = callRaces[String(race.id)]?.calls || [];
        const calls = manualCalls.length ? manualCalls : automaticUncontestedCalls(race);
        if (!calls.length) {
          return {
            ...race,
            calls: [],
            candidates: (race.candidates || []).map((candidate) => ({ ...candidate, callLabel: "" }))
          };
        }
        return {
          ...race,
          calls,
          candidates: (race.candidates || []).map((candidate) => {
            const call = calls.find((item) => String(item.candidate || "").toLowerCase() === String(candidate.name || "").toLowerCase());
            return call ? { ...candidate, callLabel: displayCallLabel(call, race) } : { ...candidate, callLabel: "" };
          })
        };
      })
    }))
  };
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
    liveResultsData = await applyManualCalls(liveResultsData);
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
