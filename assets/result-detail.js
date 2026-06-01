const page = document.getElementById("result-page");
const raceId = new URLSearchParams(window.location.search).get("id");

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
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
}

function timeLabel(value) {
  if (!value) return "Awaiting update";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Awaiting update";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function partyCode(party) {
  const value = String(party || "").toLowerCase();
  if (value.includes("dem")) return "D";
  if (value.includes("rep") || value.includes("gop")) return "R";
  if (value.includes("libertarian")) return "L";
  if (value.includes("green")) return "G";
  if (value.includes("independent") || value.includes("no party")) return "I";
  return party ? party.slice(0, 1).toUpperCase() : "";
}

function partyClass(partyCodeValue) {
  if (partyCodeValue === "D") return "party-dem";
  if (partyCodeValue === "R") return "party-rep";
  if (partyCodeValue === "I") return "party-ind";
  return "party-other";
}

function markerClass(marker) {
  return `marker-${marker?.kind || "general"}`;
}

function leadingCandidate(race) {
  return (race.candidates || [])[0] || null;
}

function callBadge(candidate, race) {
  if (!candidate.callLabel) return "";
  return `<span class="result-call-badge">${escapeHtml(candidate.callLabel)}</span>`;
}

function candidateRows(race) {
  const candidates = race.candidates || [];
  const maxPercent = Math.max(1, ...candidates.map((candidate) => Number(candidate.percent || 0)));
  return candidates.map((candidate) => {
    const code = candidate.partyCode || partyCode(candidate.party);
    const width = Math.max(2, (Number(candidate.percent || 0) / maxPercent) * 100);
    return `
      <article class="result-full-candidate ${candidate.callLabel ? "called" : ""}">
        <div class="result-full-candidate-name">
          <span class="result-party-dot ${partyClass(code)}">${escapeHtml(code)}</span>
          <div>
            <strong>${escapeHtml(candidate.name)}</strong>
            <small>${escapeHtml(candidate.party || "Other")}</small>
          </div>
          ${callBadge(candidate, race)}
        </div>
        <div class="result-full-bar" aria-hidden="true"><i style="width:${width}%"></i></div>
        <div class="result-full-numbers">
          <b>${percentLabel(candidate.percent)}</b>
          <span>${numberLabel(candidate.votes)} votes</span>
        </div>
      </article>
    `;
  }).join("");
}

function countyCandidateCells(county) {
  const candidates = (county.candidates || []).slice(0, 4);
  return candidates.map((candidate) => `
    <span>
      <strong>${escapeHtml(candidate.name)}</strong>
      <small>${numberLabel(candidate.votes)} / ${percentLabel(candidate.percent)}</small>
    </span>
  `).join("");
}

function countyRows(race) {
  const counties = race.counties || [];
  if (!counties.length) return `<p class="meta">County-by-county results are not available for this race yet.</p>`;
  return `
    <div class="county-results-table">
      ${counties.map((county) => `
        <article class="county-result-row">
          <div>
            <strong>${escapeHtml(county.name)}</strong>
            <small>${escapeHtml(county.type || "County")} | ${percentLabel(county.percentReporting)} reporting</small>
          </div>
          <div class="county-candidate-cells">
            ${countyCandidateCells(county)}
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderRace(race) {
  const leader = leadingCandidate(race);
  document.title = `${race.electionName} | Federal Elections Analysis`;
  page.innerHTML = `
    <section class="result-full-hero">
      <div class="result-title-lockup">
        <span class="result-election-marker result-election-marker-large ${markerClass(race.marker)}">
          <i>${escapeHtml(race.marker?.short || "G")}</i>
        </span>
        <div>
          <p class="kicker">${escapeHtml(race.marker?.label || "Election results")}</p>
          <h1>${escapeHtml(race.electionName)}</h1>
          <p class="lede">${escapeHtml(race.stateName || race.state || "United States")} | ${escapeHtml(dateLabel(race.electionDate))}</p>
        </div>
      </div>
      <aside class="result-reporting-card">
        <span class="panel-label">Reporting</span>
        <strong>${percentLabel(race.percentReporting)}</strong>
        <small>Last updated ${escapeHtml(timeLabel(race.lastUpdated))}</small>
      </aside>
    </section>

    <section class="result-full-grid">
      <article class="result-topline-card">
        <p class="kicker">Statewide topline</p>
        <h2>${leader ? `${escapeHtml(leader.name)} leads` : "No votes reported"}</h2>
        <div class="result-full-candidates">
          ${candidateRows(race)}
        </div>
        <p class="forecast-disclaimer">Race calls shown here are manual Federal Elections Analysis calls from local config. API-provided winner flags are ignored.</p>
      </article>

      <aside class="result-topline-card">
        <p class="kicker">Race status</p>
        <dl class="result-status-list">
          <div><dt>Election type</dt><dd>${escapeHtml(race.electionScope || race.electionType || "Election")}</dd></div>
          <div><dt>Reporting</dt><dd>${percentLabel(race.percentReporting)}</dd></div>
          <div><dt>Total candidates</dt><dd>${numberLabel((race.candidates || []).length)}</dd></div>
          <div><dt>Regions</dt><dd>${numberLabel((race.counties || []).length)}</dd></div>
        </dl>
      </aside>
    </section>

    <section class="result-county-panel">
      <div class="section-head">
        <div>
          <p class="kicker">County results</p>
          <h2>County-by-county returns.</h2>
        </div>
        <p>${percentLabel(race.percentReporting)} statewide reporting.</p>
      </div>
      ${countyRows(race)}
    </section>
  `;
}

async function fetchRace() {
  if (!raceId) throw new Error("Missing race id.");
  const staticResponse = await fetch(`data/live-results-races/${encodeURIComponent(raceId)}.json`, { cache: "no-store" });
  if (staticResponse.ok) return staticResponse.json();
  const liveResponse = await fetch(`/api/live-results/race?id=${encodeURIComponent(raceId)}`, { cache: "no-store" });
  if (!liveResponse.ok) throw new Error(`Race detail returned ${liveResponse.status}`);
  return liveResponse.json();
}

fetchRace()
  .then(renderRace)
  .catch((error) => {
    page.innerHTML = `
      <section class="text-panel">
        <p class="kicker">Race results</p>
        <h1>Race detail unavailable.</h1>
        <p class="lede">The race detail feed could not be loaded.</p>
        <p><a class="button-link" href="/results">Back to results</a></p>
      </section>
    `;
    console.error(error);
  });
