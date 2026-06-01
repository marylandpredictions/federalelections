const page = document.getElementById("result-page");
const raceId = new URLSearchParams(window.location.search).get("id");
let countyMapDataPromise = null;
let districtMapDataPromise = null;

const REDISTRICTED_RESULT_STATES = new Set(["AL", "LA", "NC", "OH", "TX", "UT"]);
const MANUAL_INCUMBENTS_BY_RACE = {
  "79881": ["Tony K. Thurmond"],
  "79883": ["Mark DeSaulnier"],
  "79886": ["Adam Gray"],
  "79896": ["David G. Valadao"],
  "79907": ["Brad Sherman"],
  "79909": ["Jimmy Gomez"],
  "79916": ["Ken Calvert", "Young Kim"],
  "79932": ["Doris Matsui"],
  "79938": ["Karen Ruth Bass"],
  "80203": ["Mariannette Miller-Meeks"],
  "80461": ["Larry Rhoden"],
  "80512": ["Mike Rounds"],
  "81014": ["Ben R Lujan"],
  "81044": ["Frank Pallone Jr.."],
  "81048": ["Rob Menendez"],
  "81057": ["Cory Booker"]
};

const CANDIDATE_PHOTO_SETS = {
  "79779": {
    base: "assets/img/candidates/california-lieutenant-governor",
    photos: {
      "josh-fryday": "josh-fryday.png",
      "fiona-ma": "fiona-ma.png",
      "michael-tubbs": "michael-tubbs.png",
      "oliver-ma": "oliver-ma.png",
      "david-fennell": "david-fennell.png",
      "gloria-romero": "gloria-romero.png"
    },
    colors: {
      "josh-fryday": "#0091ff",
      "fiona-ma": "#52ca2b",
      "michael-tubbs": "#6263f5",
      "oliver-ma": "#28d7db",
      "david-fennell": "#d97a18",
      "gloria-romero": "#e4d000"
    }
  },
  "79884": {
    base: "assets/img/candidates/california-us-house-11",
    photos: {
      "saikat-chakrabarti": "saikat-chakrabarti.png",
      "connie-chan": "connie-chan.png",
      "scott-wiener": "scott-wiener.png"
    },
    colors: {
      "saikat-chakrabarti": "#6b42d8",
      "connie-chan": "#0091ff",
      "scott-wiener": "#25d6d6"
    }
  },
  "79896": {
    base: "assets/img/candidates/california-us-house-22",
    photos: {
      "jasmeet-bains": "jasmeet-bains.png",
      "randy-villegas": "randy-villegas.png",
      "david-g-valadao": "david-g-valadao.png"
    },
    colors: {
      "jasmeet-bains": "#4361ff",
      "randy-villegas": "#26d6d6",
      "david-g-valadao": "#d86f19"
    }
  },
  "79907": {
    base: "assets/img/candidates/california-us-house-32",
    photos: {
      "jake-levine": "jake-levine.png",
      "marena-lin": "marena-lin.png",
      "brad-sherman": "brad-sherman.png",
      "larry-thompson": "larry-thompson.png"
    },
    colors: {
      "jake-levine": "#0091ff",
      "marena-lin": "#25d6d6",
      "brad-sherman": "#5360f6",
      "larry-thompson": "#8dde18"
    }
  },
  "79932": {
    base: "assets/img/candidates/california-us-house-7",
    photos: {
      "doris-matsui": "doris-matsui.png",
      "mai-vang": "mai-vang.png"
    },
    colors: {
      "doris-matsui": "#0091ff",
      "mai-vang": "#25d6d6"
    }
  },
  "79916": {
    base: "assets/img/candidates/california-us-house-40",
    photos: {
      "joe-kerr": "joe-kerr.png",
      "esther-kim-varet": "esther-kim-varet.png",
      "ken-calvert": "ken-calvert.png",
      "young-kim": "young-kim.png"
    },
    colors: {
      "joe-kerr": "#0091ff",
      "esther-kim-varet": "#5560f6",
      "ken-calvert": "#c56517",
      "young-kim": "#dec30f"
    }
  },
  "79777": {
    base: "assets/img/candidates/california-governor",
    photos: {
      "antonio-villaraigosa": "villaraigosa.png",
      "tony-k-thurmond": "thurmond.png",
      "eric-swalwell": "swalwell.png",
      "tom-steyer": "steyer.png",
      "katie-porter": "porter.png",
      "matt-mahan": "mahan.png",
      "xavier-becerra": "becerra.png",
      "steve-hilton": "hilton.png",
      "chad-bianco": "bianco.png"
    },
    colors: {
      "antonio-villaraigosa": "#24dcae",
      "tony-k-thurmond": "#1493f6",
      "eric-swalwell": "#99e600",
      "tom-steyer": "#4fc92a",
      "katie-porter": "#5765ff",
      "matt-mahan": "#2fdde0",
      "xavier-becerra": "#1493f6",
      "steve-hilton": "#bf0000",
      "chad-bianco": "#d97112"
    }
  },
  "79881": {
    base: "assets/img/candidates/california-superintendent",
    photos: {
      "richard-barrera": "richard-barrera.png",
      "nichelle-m-henderson": "nichelle-henderson.png",
      "al-muratsuchi": "al-muratsuchi.png",
      "josh-newman": "josh-newman.png",
      "anthony-rendon": "anthony-rendon.png",
      "sonja-shaw": "sonja-shaw.png"
    },
    colors: {
      "richard-barrera": "#0091ff",
      "nichelle-m-henderson": "#5560f6",
      "al-muratsuchi": "#25d6d6",
      "josh-newman": "#0091ff",
      "anthony-rendon": "#8dde18",
      "sonja-shaw": "#e6c900"
    }
  }
};

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

function candidateInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function candidatePhotoUrl(race, candidate) {
  const photoSet = CANDIDATE_PHOTO_SETS[String(race?.id)];
  if (!photoSet) return "";
  const slug = String(candidate?.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return photoSet.photos[slug] ? `${photoSet.base}/${photoSet.photos[slug]}` : "";
}

function candidatePhotoColor(race, candidate) {
  const slug = String(candidate?.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return CANDIDATE_PHOTO_SETS[String(race?.id)]?.colors?.[slug] || "";
}

function isIncumbentCandidate(race, candidate) {
  const manualNames = MANUAL_INCUMBENTS_BY_RACE[String(race?.id)] || [];
  const candidateName = String(candidate?.name || "").toLowerCase();
  return Boolean(candidate?.incumbent || candidate?.isIncumbent || candidate?.is_incumbent)
    || manualNames.some((name) => name.toLowerCase() === candidateName);
}

function incumbentMark(race, candidate) {
  return isIncumbentCandidate(race, candidate)
    ? `<span class="result-incumbent-mark" title="Incumbent" aria-label="Incumbent">*</span>`
    : "";
}

function markerClass(marker) {
  return `marker-${marker?.kind || "general"}`;
}

function leadingCandidate(race) {
  return (race.candidates || [])[0] || null;
}

function candidateFill(race, candidate) {
  const photoColor = candidatePhotoColor(race, candidate);
  if (photoColor) return photoColor;
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
  const fill = candidateFill(race, candidate);
  const photo = candidatePhotoUrl(race, candidate);
  return `
    <article class="result-full-candidate ${candidate.callLabel ? "called" : ""}" style="--candidate-color:${escapeHtml(fill)}">
      <div class="result-full-candidate-name">
        <span class="result-candidate-avatar ${partyClass(code)}">${photo ? `<img src="${escapeHtml(photo)}" alt="">` : escapeHtml(candidateInitials(candidate.name))}</span>
        <div>
          <strong>${escapeHtml(candidate.name)}${incumbentMark(race, candidate)}</strong>
        </div>
        ${callBadge(candidate, race)}
      </div>
      <span class="result-party-label">${escapeHtml(displayParty(candidate.party) || "Other")}</span>
      <span class="result-vote-label">${numberLabel(candidate.votes)}</span>
      <div class="result-full-numbers">
        <b>${percentLabel(candidate.percent)}</b>
      </div>
      <div class="result-full-bar" aria-hidden="true"><i style="width:${width}%"></i></div>
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
  const head = `
    <div class="result-candidate-table-head">
      <span>Candidate</span>
      <span>Party</span>
      <span>Votes</span>
      <span>Pct</span>
    </div>
  `;
  if (!otherCandidates.length) return `${head}${topCandidates}`;
  return `
    ${head}
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

function countyTopCandidates(county, limit = 3) {
  return [...(county.candidates || [])]
    .sort((a, b) => Number(b.percent || 0) - Number(a.percent || 0) || Number(b.votes || 0) - Number(a.votes || 0))
    .slice(0, limit);
}

function countyTooltipMarkup(county, titlePrefix = "") {
  const rows = countyTopCandidates(county, 3);
  const title = titlePrefix || `${county.name} County`;
  return `
    <strong>${escapeHtml(title)}</strong>
    <table>
      <thead><tr><th></th><th>Votes</th><th>Pct</th></tr></thead>
      <tbody>
        ${rows.map((candidate) => `
          <tr>
            <td>${escapeHtml(candidate.name)} (${escapeHtml(candidate.partyCode || partyCode(candidate.party) || "O")})</td>
            <td>${numberLabel(candidate.votes)}</td>
            <td>${percentLabel(candidate.percent)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    <small>${percentLabel(county.percentReporting)} reporting</small>
  `;
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

async function loadDistrictMapData() {
  if (!districtMapDataPromise) {
    districtMapDataPromise = fetch("data/house-districts-119.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`District map returned ${response.status}`);
      return response.json();
    });
  }
  return districtMapDataPromise;
}

function countyLookup(race) {
  const lookup = new Map();
  for (const county of race.counties || []) {
    if (county.fips) lookup.set(String(county.fips).padStart(5, "0"), county);
    lookup.set(String(county.name || "").toLowerCase(), county);
  }
  return lookup;
}

function raceDistrictNumber(race) {
  if (race.district) {
    const parsed = Number(String(race.district).replace(/\D/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const match = String(race.electionName || "").match(/\bDistrict\s+(\d+)\b/i) || String(race.electionName || "").match(/\bHouse\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function isHouseRace(race) {
  return /house/i.test(`${race.type || ""} ${race.electionName || ""}`) && raceDistrictNumber(race);
}

function shouldFilterToJurisdiction(race, features, lookup) {
  if (race.district || race.municipality) return true;
  const matchedCounties = features.filter((feature) => lookup.has(feature.id) || lookup.has(String(feature.properties?.NAME || "").toLowerCase())).length;
  return matchedCounties > 0 && matchedCounties < features.length;
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

function expandedBounds(bounds, factor = .35) {
  const lonPad = (bounds.maxLon - bounds.minLon) * factor;
  const latPad = (bounds.maxLat - bounds.minLat) * factor;
  return {
    minLon: bounds.minLon - lonPad,
    minLat: bounds.minLat - latPad,
    maxLon: bounds.maxLon + lonPad,
    maxLat: bounds.maxLat + latPad
  };
}

function boundsOverlap(a, b) {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

function contextFeatures(features, activeFeatures, activeBounds, factor = .35) {
  const expanded = expandedBounds(activeBounds, factor);
  const activeSet = new Set(activeFeatures);
  return features.filter((feature) => !activeSet.has(feature) && boundsOverlap(stateBounds([feature]), expanded));
}

function mapDimensions(bounds, maxWidth = 700, maxHeight = 520) {
  const lonRange = Math.max(.1, bounds.maxLon - bounds.minLon);
  const latRange = Math.max(.1, bounds.maxLat - bounds.minLat);
  const midLat = ((bounds.minLat + bounds.maxLat) / 2) * Math.PI / 180;
  const correctedLonRange = Math.max(.1, lonRange * Math.max(.35, Math.cos(midLat)));
  const aspect = correctedLonRange / latRange;
  let width = maxWidth;
  let height = Math.round(width / aspect);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * aspect);
  }
  return {
    width: Math.max(260, width),
    height: Math.max(240, height),
    lonScale: Math.max(.35, Math.cos(midLat))
  };
}

function geometryPath(geometry, bounds, width, height, lonScale = 1) {
  const lonRange = Math.max(.1, (bounds.maxLon - bounds.minLon) * lonScale);
  const latRange = Math.max(.1, bounds.maxLat - bounds.minLat);
  const pad = 16;
  const usableWidth = width - pad * 2;
  const usableHeight = height - pad * 2;
  const scale = Math.min(usableWidth / lonRange, usableHeight / latRange);
  const offsetX = (width - lonRange * scale) / 2;
  const offsetY = (height - latRange * scale) / 2;
  const project = ([lon, lat]) => [
    offsetX + ((lon - bounds.minLon) * lonScale) * scale,
    offsetY + (bounds.maxLat - lat) * scale
  ];
  return coordinateRings(geometry).map((ring) => {
    const points = ring.map(project);
    if (!points.length) return "";
    return `M${points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join("L")}Z`;
  }).join("");
}

async function districtShapeMap(race) {
  if (REDISTRICTED_RESULT_STATES.has(String(race.state || "").toUpperCase())) {
    return `
      <div class="result-map-empty">District map unavailable while updated post-redistricting boundaries are being added.</div>
      <p class="result-map-caption">This district has changed or may change through the 2025-26 redistricting cycle, so the older GeoJSON shape is not shown.</p>
    `;
  }
  const districtNumber = raceDistrictNumber(race);
  if (!districtNumber) return "";
  try {
    const geojson = await loadDistrictMapData();
    const feature = (geojson.features || []).find((item) => (
      String(item.properties?.state || "").toUpperCase() === String(race.state || "").toUpperCase()
      && Number(item.properties?.district) === districtNumber
    ));
    if (!feature) return "";
    const leader = leadingCandidate(race);
    const fill = leader && Number(leader.votes || 0) ? candidateFill(leader) : "#566274";
    const bounds = stateBounds([feature]);
    const { width, height, lonScale } = mapDimensions(bounds, 700, 500);
    return `
      <svg class="result-county-map result-district-map" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(race.electionName || "House district")} map">
        <path d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}" fill="${escapeHtml(fill)}"></path>
      </svg>
      <p class="result-map-caption" data-default-map-caption="District shape from the 119th Congressional District file. County results below still list county-level returns when available.">District shape from the 119th Congressional District file. County results below still list county-level returns when available.</p>
    `;
  } catch (error) {
    console.warn(error);
    return "";
  }
}

async function countyShapeMap(race) {
  if (isHouseRace(race)) {
    const districtMarkup = await districtShapeMap(race);
    if (districtMarkup) return districtMarkup;
  }
  const fips = stateFips(race.state);
  if (!fips) return regionMap(race);
  try {
    const geojson = await loadCountyMapData();
    const allFeatures = geojson.features || [];
    const features = allFeatures.filter((feature) => feature.properties?.STATE === fips);
    if (!features.length) return regionMap(race);
    const lookup = countyLookup(race);
    const visibleFeatures = shouldFilterToJurisdiction(race, features, lookup)
      ? features.filter((feature) => lookup.has(feature.id) || lookup.has(String(feature.properties?.NAME || "").toLowerCase()))
      : features;
    if (!visibleFeatures.length) return regionMap(race);
    const bounds = stateBounds(visibleFeatures);
    const { width, height, lonScale } = mapDimensions(bounds);
    const paths = visibleFeatures.map((feature) => {
      const county = lookup.get(feature.id) || lookup.get(String(feature.properties?.NAME || "").toLowerCase());
      const leader = county ? regionLeader(county) : null;
      const fill = leader ? candidateFill(leader) : "#566274";
      const title = county && leader
        ? `${county.name} County: ${leader.name} ${percentLabel(leader.percent)}, ${percentLabel(county.percentReporting)} reporting`
        : `${feature.properties?.NAME || "County"} County: waiting for reported votes`;
      const tooltip = county ? countyTooltipMarkup(county, `${feature.properties?.NAME || county.name} County`) : "";
      return `
        <path d="${geometryPath(feature.geometry, bounds, width, height, lonScale)}" fill="${escapeHtml(fill)}" class="${leader ? "" : "is-waiting"}" data-county-title="${escapeHtml(title)}" data-county-tooltip="${escapeHtml(tooltip)}">
        </path>
      `;
    }).join("");
    return `
      <svg class="result-county-map" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(race.stateName || race.state || "State")} county results map">
        ${paths}
      </svg>
      <p class="result-map-caption" data-default-map-caption="County shapes color by the current local leader once votes are reported.">County shapes color by the current local leader once votes are reported.</p>
    `;
  } catch (error) {
    console.warn(error);
    return regionMap(race);
  }
}

function bindCountyHover() {
  const canvas = page.querySelector(".result-map-canvas");
  const caption = canvas?.querySelector(".result-map-caption");
  if (!canvas || !caption) return;
  const tooltip = canvas.querySelector(".result-county-tooltip");
  const defaultText = caption.dataset.defaultMapCaption || caption.textContent;
  canvas.querySelectorAll(".result-county-map path:not(.map-context)").forEach((path) => {
    const show = (event) => {
      caption.textContent = path.dataset.countyTitle || defaultText;
      caption.classList.add("is-live");
      if (tooltip && path.dataset.countyTooltip) {
        tooltip.innerHTML = path.dataset.countyTooltip;
        tooltip.classList.add("visible");
        moveTooltip(event, canvas, tooltip);
      }
    };
    const hide = () => {
      caption.textContent = defaultText;
      caption.classList.remove("is-live");
      tooltip?.classList.remove("visible");
    };
    path.addEventListener("mouseenter", show);
    path.addEventListener("mousemove", (event) => moveTooltip(event, canvas, tooltip));
    path.addEventListener("mouseleave", hide);
    path.addEventListener("focus", show);
    path.addEventListener("blur", hide);
  });
}

function moveTooltip(event, canvas, tooltip) {
  if (!event || !canvas || !tooltip) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(rect.width - tooltip.offsetWidth - 8, Math.max(8, event.clientX - rect.left + 14));
  const y = Math.min(rect.height - tooltip.offsetHeight - 8, Math.max(8, event.clientY - rect.top + 14));
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function countyCandidateCells(county) {
  const candidates = countyTopCandidates(county, 3);
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

function bindMapZoom() {
  const frame = page.querySelector(".result-map-frame");
  if (!frame) return;
  const controls = page.querySelectorAll("[data-map-zoom]");
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let pointerStart = null;
  const apply = () => {
    frame.style.setProperty("--result-map-zoom", zoom.toFixed(2));
    frame.style.setProperty("--result-map-pan-x", `${panX.toFixed(1)}px`);
    frame.style.setProperty("--result-map-pan-y", `${panY.toFixed(1)}px`);
    controls.forEach((control) => {
      const mode = control.dataset.mapZoom;
      control.disabled = (mode === "in" && zoom >= 2.5) || (mode === "out" && zoom <= 1);
    });
  };
  controls.forEach((control) => {
    control.addEventListener("click", () => {
      const mode = control.dataset.mapZoom;
      if (mode === "in") zoom = Math.min(2.5, zoom + .25);
      if (mode === "out") zoom = Math.max(1, zoom - .25);
      if (mode === "reset") {
        zoom = 1;
        panX = 0;
        panY = 0;
      }
      apply();
    });
  });
  frame.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom = event.deltaY < 0 ? Math.min(2.75, zoom + .18) : Math.max(.8, zoom - .18);
    apply();
  }, { passive: false });
  frame.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY, panX, panY };
    frame.setPointerCapture?.(event.pointerId);
    frame.classList.add("is-panning");
  });
  frame.addEventListener("pointermove", (event) => {
    if (!pointerStart) return;
    event.preventDefault();
    panX = pointerStart.panX + event.clientX - pointerStart.x;
    panY = pointerStart.panY + event.clientY - pointerStart.y;
    apply();
  });
  const endPan = (event) => {
    pointerStart = null;
    frame.releasePointerCapture?.(event.pointerId);
    frame.classList.remove("is-panning");
  };
  frame.addEventListener("pointerup", endPan);
  frame.addEventListener("pointercancel", endPan);
  apply();
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
          <button type="button" data-map-zoom="out">-</button>
          <button type="button" data-map-zoom="in">+</button>
          <button type="button" data-map-zoom="reset">Reset</button>
        </div>
        <div class="result-map-canvas">
          <div class="result-map-frame">
            ${mapMarkup}
          </div>
          <div class="result-county-tooltip" aria-hidden="true"></div>
        </div>
      </aside>
    </section>

    <p class="forecast-disclaimer result-call-note">Race calls appear only when Federal Elections Analysis has made a call or projection. Races without that label remain uncalled.</p>

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
  bindCountyHover();
  bindMapZoom();
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
