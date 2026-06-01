const page = document.getElementById("result-page");
const raceId = new URLSearchParams(window.location.search).get("id");
let countyMapDataPromise = null;

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

function displayParty(party) {
  const value = String(party || "").trim();
  return /no party preference/i.test(value) ? "Independent" : value;
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

function candidateFill(candidate) {
  const color = String(candidate?.color || "").trim();
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return color;
  const code = candidate?.partyCode || partyCode(candidate?.party);
  if (code === "D") return "#1030b2";
  if (code === "R") return "#e03a3e";
  if (code === "I") return "#2f9f83";
  return "#7a6fe8";
}

function callBadge(candidate, race) {
  if (!candidate.callLabel) return "";
  const compactLabel = String(candidate.callLabel)
    .replace(/^Projected winner$/i, "Projected")
    .replace(/^Advanced to general election$/i, "Advanced");
  return `<span class="result-call-badge">${escapeHtml(compactLabel)}</span>`;
}

function candidateRow(candidate, race, maxPercent) {
  const code = candidate.partyCode || partyCode(candidate.party);
  const width = Math.max(2, (Number(candidate.percent || 0) / maxPercent) * 100);
  return `
    <article class="result-full-candidate ${candidate.callLabel ? "called" : ""}">
      <div class="result-full-candidate-name">
        <span class="result-party-dot ${partyClass(code)}">${escapeHtml(code || "O")}</span>
        <div>
          <strong>${escapeHtml(candidate.name)}</strong>
          <small>${escapeHtml(displayParty(candidate.party) || "Other")}</small>
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
}

function candidateRows(race) {
  const candidates = race.candidates || [];
  const maxPercent = Math.max(1, ...candidates.map((candidate) => Number(candidate.percent || 0)));
  const featuredNames = (race.featuredCandidateNames || []).map((name) => String(name).toLowerCase());
  const featuredCandidates = featuredNames.length
    ? featuredNames
      .map((name) => candidates.find((candidate) => String(candidate.name || "").toLowerCase() === name))
      .filter(Boolean)
    : [];
  const topList = featuredCandidates.length
    ? [...featuredCandidates, ...candidates.filter((candidate) => !featuredNames.includes(String(candidate.name || "").toLowerCase()))].slice(0, 5)
    : candidates.slice(0, 5);
  const topNames = new Set(topList.map((candidate) => String(candidate.name || "").toLowerCase()));
  const otherCandidates = candidates.filter((candidate) => !topNames.has(String(candidate.name || "").toLowerCase()));
  const topCandidates = topList.map((candidate) => candidateRow(candidate, race, maxPercent)).join("");
  if (!otherCandidates.length) return topCandidates;
  return `
    ${topCandidates}
    <details class="result-other-candidates">
      <summary>Show ${numberLabel(otherCandidates.length)} other candidates</summary>
      <div class="result-full-candidates result-full-candidates-secondary">
        ${otherCandidates.map((candidate) => candidateRow(candidate, race, maxPercent)).join("")}
      </div>
    </details>
  `;
}

function regionLeader(county) {
  const candidates = county.candidates || [];
  const totalVotes = candidates.reduce((sum, candidate) => sum + Number(candidate.votes || 0), 0);
  if (!totalVotes) return null;
  return candidates.reduce((leader, candidate) => {
    if (!leader) return candidate;
    return Number(candidate.votes || 0) > Number(leader.votes || 0) ? candidate : leader;
  }, null);
}

function regionAbbreviation(name) {
  const cleaned = String(name || "").replace(/[^a-z0-9\s]/gi, " ").trim();
  if (!cleaned) return "--";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  return cleaned.slice(0, 3).toUpperCase();
}

function regionMap(race) {
  const counties = race.counties || [];
  if (!counties.length) {
    return `<div class="result-map-empty">County-level map data is not available for this race yet.</div>`;
  }
  const regions = counties.map((county) => {
    const leader = regionLeader(county);
    const label = leader
      ? `${county.name}: ${leader.name} ${percentLabel(leader.percent)}, ${percentLabel(county.percentReporting)} reporting`
      : `${county.name}: waiting for reported votes`;
    const style = leader ? ` style="--tile-color:${candidateFill(leader)}"` : "";
    return `
      <span class="result-region-tile ${leader ? "" : "is-waiting"}"${style} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
        ${escapeHtml(regionAbbreviation(county.name))}
      </span>
    `;
  }).join("");
  return `
    <div class="result-region-map" aria-label="${escapeHtml(race.stateName || race.state || "Race")} county result map">
      ${regions}
    </div>
    <p class="result-map-caption">County tiles color by the current local leader once votes are reported.</p>
  `;
}

function stateFips(state) {
  const codes = {
    CA: "06",
    IA: "19",
    MT: "30",
    NJ: "34",
    NM: "35",
    SD: "46"
  };
  return codes[String(state || "").toUpperCase()] || "";
}

async function loadCountyMapData() {
  if (!countyMapDataPromise) {
    countyMapDataPromise = fetch("data/result-counties.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`County map returned ${response.status}`);
      return response.json();
    });
  }
  return countyMapDataPromise;
}

function countyLookup(race) {
  const lookup = new Map();
  for (const county of race.counties || []) {
    if (county.fips) lookup.set(String(county.fips).padStart(5, "0"), county);
    lookup.set(String(county.name || "").toLowerCase(), county);
  }
  return lookup;
}

function coordinateRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

function stateBounds(features) {
  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  for (const feature of features) {
    for (const ring of coordinateRings(feature.geometry)) {
      for (const [lon, lat] of ring) {
        bounds.minLon = Math.min(bounds.minLon, lon);
        bounds.maxLon = Math.max(bounds.maxLon, lon);
        bounds.minLat = Math.min(bounds.minLat, lat);
        bounds.maxLat = Math.max(bounds.maxLat, lat);
      }
    }
  }
  return bounds;
}

function geometryPath(geometry, bounds, width, height) {
  const lonRange = Math.max(.1, bounds.maxLon - bounds.minLon);
  const latRange = Math.max(.1, bounds.maxLat - bounds.minLat);
  const pad = 10;
  const project = ([lon, lat]) => [
    pad + ((lon - bounds.minLon) / lonRange) * (width - pad * 2),
    pad + ((bounds.maxLat - lat) / latRange) * (height - pad * 2)
  ];
  return coordinateRings(geometry).map((ring) => {
    const points = ring.map(project);
    if (!points.length) return "";
    return `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")}Z`;
  }).join("");
}

async function countyShapeMap(race) {
  const fips = stateFips(race.state);
  if (!fips) return regionMap(race);
  try {
    const geojson = await loadCountyMapData();
    const features = (geojson.features || []).filter((feature) => feature.properties?.STATE === fips);
    if (!features.length) return regionMap(race);
    const lookup = countyLookup(race);
    const bounds = stateBounds(features);
    const width = 620;
    const height = 430;
    const paths = features.map((feature) => {
      const county = lookup.get(feature.id) || lookup.get(String(feature.properties?.NAME || "").toLowerCase());
      const leader = county ? regionLeader(county) : null;
      const fill = leader ? candidateFill(leader) : "#3b4354";
      const title = county && leader
        ? `${county.name} County: ${leader.name} ${percentLabel(leader.percent)}, ${percentLabel(county.percentReporting)} reporting`
        : `${feature.properties?.NAME || "County"} County: waiting for reported votes`;
      return `
        <path d="${geometryPath(feature.geometry, bounds, width, height)}" fill="${escapeHtml(fill)}" class="${leader ? "" : "is-waiting"}">
          <title>${escapeHtml(title)}</title>
        </path>
      `;
    }).join("");
    return `
      <svg class="result-county-map" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(race.stateName || race.state || "State")} county results map">
        ${paths}
      </svg>
      <p class="result-map-caption">County shapes color by the current local leader once votes are reported.</p>
    `;
  } catch (error) {
    console.warn(error);
    return regionMap(race);
  }
}

function countyCandidateCells(county) {
  const candidates = (county.candidates || []).slice(0, 3);
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

async function renderRace(race) {
  const leader = leadingCandidate(race);
  const mapMarkup = await countyShapeMap(race);
  document.title = `${race.electionName} | Federal Elections Analysis`;
  page.innerHTML = `
    <section class="result-night-shell">
      <div class="result-night-left">
        <div class="result-title-lockup">
          <span class="result-election-marker result-election-marker-large ${markerClass(race.marker)}">
            <i>${escapeHtml(race.marker?.short || "G")}</i>
          </span>
          <div>
            <p class="kicker">${escapeHtml(race.marker?.label || "Election results")}</p>
            <h1>${escapeHtml(race.electionName)}</h1>
            <p>${escapeHtml(race.stateName || race.state || "United States")} | ${escapeHtml(dateLabel(race.electionDate))}</p>
          </div>
        </div>

        <div class="result-full-candidates">
          ${candidateRows(race)}
        </div>

        <div class="result-night-meta">
          <span>${percentLabel(race.percentReporting)} reporting</span>
          <span>Last updated ${escapeHtml(timeLabel(race.lastUpdated))}</span>
          <span>${numberLabel((race.counties || []).length)} counties</span>
        </div>
      </div>

      <aside class="result-map-panel">
        <div class="result-map-tabs">
          <a href="/results.html">Results</a>
        </div>
        <div class="result-map-canvas">
          ${mapMarkup}
        </div>
      </aside>
    </section>

    <p class="forecast-disclaimer result-call-note">Race calls shown here are manual Federal Elections Analysis calls from local config. API-provided winner flags are ignored.</p>

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
