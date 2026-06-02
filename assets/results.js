const updatedLabel = document.getElementById("results-updated");
const statusLabel = document.getElementById("results-status");
const groupsNode = document.getElementById("results-groups");
const searchInput = document.getElementById("results-search");
const refreshButton = document.getElementById("results-refresh");

let liveResultsData = null;
const FAVORITE_RACES_KEY = "fea.favoriteResultRaces.v1";

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

const POLL_OPEN_UTC_BY_STATE = {
  CA: "2026-06-02T14:00:00Z",
  IA: "2026-06-02T12:00:00Z",
  MT: "2026-06-02T13:00:00Z",
  NJ: "2026-06-02T10:00:00Z",
  NM: "2026-06-02T13:00:00Z",
  SD: "2026-06-02T12:00:00Z"
};

function validElectionIso(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2020) return "";
  return date.toISOString();
}

function pollCloseLabel(race) {
  const iso = validElectionIso(race.pollsClose || race.pollCloseAt) || POLL_CLOSE_UTC_BY_STATE[race.state];
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

function readFavoriteRaces() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAVORITE_RACES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((race) => race && race.id && !race.archived) : [];
  } catch {
    return [];
  }
}

function writeFavoriteRaces(races) {
  try {
    localStorage.setItem(FAVORITE_RACES_KEY, JSON.stringify(races.filter((race) => race && race.id && !race.archived)));
  } catch {
  }
}

function favoriteRaceSummary(race) {
  return {
    id: String(race.id),
    electionName: race.electionName || "Election results",
    state: race.state || "",
    stateName: race.stateName || "",
    electionDate: race.electionDate || "",
    archived: Boolean(race.archived)
  };
}

function isRaceFavorite(raceId) {
  return readFavoriteRaces().some((race) => String(race.id) === String(raceId));
}

function setRaceFavorite(race, favorite) {
  const id = String(race.id);
  const existing = readFavoriteRaces().filter((item) => String(item.id) !== id);
  writeFavoriteRaces(favorite ? [favoriteRaceSummary(race), ...existing].slice(0, 20) : existing);
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
  const favorite = isRaceFavorite(race.id);
  return `
    <article class="result-race-tile ${favorite ? "is-favorite" : ""}">
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
      <button class="result-favorite-button" type="button" data-favorite-race="${escapeHtml(race.id)}" aria-pressed="${favorite}" aria-label="${favorite ? "Remove saved race" : "Save race"}">${favorite ? "★" : "☆"}</button>
    </article>
  `;
}

function resultGroupCard(group) {
  return `
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
  `;
}

function resultsColumnCount() {
  const width = groupsNode?.clientWidth || window.innerWidth || 0;
  if (width >= 1280) return 5;
  if (width >= 1020) return 4;
  if (width >= 760) return 3;
  if (width >= 520) return 2;
  return 1;
}

function groupWeight(group) {
  return 1.25 + Math.max(1, group.races?.length || 0);
}

function masonryGroupsMarkup(cards) {
  const count = Math.min(resultsColumnCount(), Math.max(1, cards.length));
  const columns = Array.from({ length: count }, () => ({ weight: 0, cards: [] }));
  cards.forEach((card) => {
    const target = columns.reduce((smallest, column) => column.weight < smallest.weight ? column : smallest, columns[0]);
    target.cards.push(card.html);
    target.weight += card.weight;
  });
  return columns.map((column) => `<div class="results-group-column">${column.cards.join("")}</div>`).join("");
}

function resultsListUpdateKey(data, query = "") {
  return JSON.stringify({
    query,
    races: flattenRaces(data).map((race) => [
      race.id,
      race.leaderName,
      race.percentReporting,
      (race.calls || []).length,
      (race.calls || []).map((call) => call.calledAt || ""),
      (race.candidates || []).slice(0, 2).map((candidate) => [candidate.name, candidate.percent, candidate.callLabel || ""])
    ])
  });
}

let resultsListUpdateKeyCache = "";

function renderGroups() {
  if (!groupsNode || !liveResultsData) return;
  const query = searchInput?.value?.trim() || "";
  const updateKey = resultsListUpdateKey(liveResultsData, query);
  if (updateKey === resultsListUpdateKeyCache && groupsNode.dataset.rendered === "true") return;
  resultsListUpdateKeyCache = updateKey;
  const groups = (liveResultsData.groups || []).map((group) => ({
    ...group,
    races: (group.races || []).filter((race) => raceMatches(race, query))
  }));

  groupsNode.dataset.rendered = "true";
  const racesById = new Map(flattenRaces(liveResultsData).map((race) => [String(race.id), race]));
  const favoriteRaces = readFavoriteRaces()
    .map((favorite) => racesById.get(String(favorite.id)) || favorite)
    .filter((race) => race && !race.archived && raceMatches(race, query));
  const cards = [];
  if (favoriteRaces.length) {
    cards.push({
      weight: groupWeight({ races: favoriteRaces }),
      html: `
        <section class="result-state-card result-favorites-card">
          <div class="result-state-head">
            <div>
              <p class="kicker">Saved</p>
              <h2>Favorited races</h2>
            </div>
            <span>${numberLabel(favoriteRaces.length)} saved</span>
          </div>
          <div class="result-race-list">
            ${favoriteRaces.map(raceCard).join("")}
          </div>
        </section>
      `
    });
  }
  groups.forEach((group) => cards.push({ weight: groupWeight(group), html: resultGroupCard(group) }));
  groupsNode.innerHTML = masonryGroupsMarkup(cards);
  bindFavoriteButtons();
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
  const iso = validElectionIso(race?.pollsClose || race?.pollCloseAt) || POLL_CLOSE_UTC_BY_STATE[race.state];
  if (!iso) return false;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && Date.now() >= date.getTime();
}

function pollsAreOpen(race) {
  const iso = validElectionIso(race?.pollsOpen || race?.pollOpenAt) || POLL_OPEN_UTC_BY_STATE[race.state];
  if (!iso) return pollsAreClosed(race);
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) && Date.now() >= date.getTime();
}

function automaticUncontestedCalls(race) {
  if (!pollsAreClosed(race)) return [];
  const realCandidates = (race.candidates || []).filter(isRealCandidate);
  if (realCandidates.length !== 1) return [];
  const calledAt = validElectionIso(race?.pollsClose || race?.pollCloseAt) || POLL_CLOSE_UTC_BY_STATE[race.state] || "";
  return [{
    candidate: realCandidates[0].name,
    status: "winner",
    label: "Winner",
    automatic: true,
    calledAt
  }];
}

function bindFavoriteButtons() {
  groupsNode?.querySelectorAll("[data-favorite-race]").forEach((button) => {
    button.addEventListener("click", () => {
      const race = flattenRaces(liveResultsData).find((item) => String(item.id) === String(button.dataset.favoriteRace));
      if (!race) return;
      setRaceFavorite(race, !isRaceFavorite(race.id));
      resultsListUpdateKeyCache = "";
      renderGroups();
    });
  });
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
window.addEventListener("resize", () => {
  if (!liveResultsData) return;
  resultsListUpdateKeyCache = "";
  renderGroups();
}, { passive: true });

loadResults();
setInterval(() => loadResults(false), 30000);
