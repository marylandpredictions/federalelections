(() => {
  const STATE_NAMES = {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
    CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
    HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
    KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
    MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
    NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
    NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
    OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
    VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
  };

  const STATE_FIPS = {
    AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11",
    FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20", KY: "21",
    LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30",
    NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38", OH: "39",
    OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46", TN: "47", TX: "48", UT: "49",
    VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56"
  };

  const STATE_BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([state, name]) => [name.toUpperCase(), state]));
  const STATE_BY_FIPS = Object.fromEntries(Object.entries(STATE_FIPS).map(([state, fips]) => [fips, state]));
  const jsonCache = new Map();

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  function mixColor(from, to, amount) {
    const parse = (hex) => hex.replace("#", "").match(/.{1,2}/g).map((part) => parseInt(part, 16));
    const [fr, fg, fb] = parse(from);
    const [tr, tg, tb] = parse(to);
    const t = clamp(amount, 0, 1);
    const channel = (a, b) => Math.round(a + ((b - a) * t)).toString(16).padStart(2, "0");
    return `#${channel(fr, tr)}${channel(fg, tg)}${channel(fb, tb)}`;
  }

  function ratingStrength(rating) {
    const text = String(rating || "").toLowerCase();
    if (text.includes("safe")) return 92;
    if (text.includes("likely")) return 68;
    if (text.includes("lean")) return 42;
    if (text.includes("tilt")) return 18;
    if (text.includes("toss")) return 0;
    return 0;
  }

  function ratingParty(rating) {
    const text = String(rating || "");
    if (/\bD\b/i.test(text)) return "D";
    if (/\bR\b/i.test(text)) return "R";
    if (/\bI\b/i.test(text)) return "I";
    return "";
  }

  function partyFromRace(race) {
    const winner = String(race?.prediction?.winner || "").toUpperCase();
    if (winner === "D" || winner === "R" || winner === "I") return winner;
    return ratingParty(race?.prediction?.rating);
  }

  function scoreFromRace(race) {
    const explicit = Number(race?.prediction?.mapValue);
    if (Number.isFinite(explicit)) return clamp(explicit, -100, 100);
    const party = partyFromRace(race);
    const margin = Math.abs(Number(race?.prediction?.projectedMargin));
    const strength = Math.max(
      ratingStrength(race?.prediction?.rating),
      Number.isFinite(margin) ? Math.min(100, margin * 4.6) : 0
    );
    if (party === "D") return -strength;
    if (party === "R") return strength;
    return 0;
  }

  function colorForScore(score) {
    const value = clamp(score, -100, 100);
    if (value < 0) return mixColor("#f3ead4", "#1030b2", Math.abs(value) / 100);
    if (value > 0) return mixColor("#f3ead4", "#bd2027", value / 100);
    return "#f3ead4";
  }

  function normalizeDistrict(district) {
    const raw = String(district ?? "").trim().toUpperCase();
    if (!raw || raw === "0" || raw === "00" || raw === "AL" || raw === "AT-LARGE") return "AL";
    const number = Number(raw.replace(/^0+/, ""));
    return Number.isFinite(number) ? String(number).padStart(2, "0") : raw.padStart(2, "0");
  }

  function raceKey(race, office = "") {
    if (!race) return "";
    if ((office || race.office) === "house") return `${race.state}-${normalizeDistrict(race.district)}`;
    return race.state || "";
  }

  function stateFromFeature(feature) {
    const props = feature?.properties || {};
    return props.state || props.STUSPS || STATE_BY_FIPS[props.STATEFP || props.STATE] || STATE_BY_NAME[String(props.name || props.NAME || "").toUpperCase()] || "";
  }

  function featureKey(feature, office = "") {
    const props = feature?.properties || {};
    if (office === "house") {
      if (props.id) return String(props.id).toUpperCase();
      const state = stateFromFeature(feature);
      return state ? `${state}-${normalizeDistrict(props.district || props.CD119FP || props.CD)}` : "";
    }
    return stateFromFeature(feature);
  }

  function featureName(feature, office = "") {
    const props = feature?.properties || {};
    if (office === "house") return props.id || `${stateFromFeature(feature)}-${normalizeDistrict(props.district || props.CD119FP || props.CD)}`;
    return props.name || props.NAME || STATE_NAMES[stateFromFeature(feature)] || stateFromFeature(feature);
  }

  function countyKey(feature) {
    const props = feature?.properties || {};
    const fips = props.countyFips || props.GEOID || `${props.STATEFP || props.STATE || ""}${props.COUNTYFP || props.COUNTY || ""}`;
    return String(fips || "").padStart(5, "0");
  }

  function countyName(feature) {
    const props = feature?.properties || {};
    return props.countyName || props.NAME || props.name || countyKey(feature);
  }

  async function loadJson(path) {
    if (!jsonCache.has(path)) {
      jsonCache.set(path, fetch(path, { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`${path} returned ${response.status}`);
        return response.json();
      }));
    }
    return jsonCache.get(path);
  }

  async function loadRaceFeatures(office) {
    const path = office === "house" ? "/data/house-districts-119.geojson" : "/data/result-us-states.geojson";
    const geo = await loadJson(path);
    return geo.features || [];
  }

  async function loadCountyFeatures(race) {
    if (!race) return [];
    if (race.office === "house") {
      const path = `/data/maps/congress/119/${race.state}-${normalizeDistrict(race.district)}.json`;
      try {
        const geo = await loadJson(path);
        if (Array.isArray(geo.features) && geo.features.length) return geo.features;
      } catch {
        return [];
      }
      return [];
    }
    const stateFips = STATE_FIPS[race.state];
    if (!stateFips) return [];
    const geo = await loadJson("/data/result-counties.geojson");
    return (geo.features || []).filter((feature) => String(feature.properties?.STATEFP || feature.properties?.STATE) === stateFips);
  }

  function eachCoordinate(geometry, callback) {
    if (!geometry) return;
    const walk = (value) => {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === "number" && typeof value[1] === "number") {
        callback(value[0], value[1]);
        return;
      }
      value.forEach(walk);
    };
    walk(geometry.coordinates);
  }

  function featureBounds(features) {
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const feature of features || []) {
      eachCoordinate(feature.geometry, (lon, lat) => {
        bounds.minX = Math.min(bounds.minX, lon);
        bounds.maxX = Math.max(bounds.maxX, lon);
        bounds.minY = Math.min(bounds.minY, lat);
        bounds.maxY = Math.max(bounds.maxY, lat);
      });
    }
    if (!Number.isFinite(bounds.minX)) return { minX: -125, minY: 24, maxX: -66, maxY: 50 };
    return bounds;
  }

  function projectedRingPath(ring, projection) {
    const points = ring
      .map((point) => projection(point))
      .filter(Boolean);
    if (points.length < 3) return "";
    return `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join("")}Z`;
  }

  function projectedFeaturePath(feature, projection) {
    const geometry = feature?.geometry;
    if (!geometry) return "";
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates || [];
    return polygons
      .flatMap((polygon) => polygon.map((ring) => projectedRingPath(ring, projection)))
      .filter(Boolean)
      .join("");
  }

  function projector(features, width = 980, height = 580, pad = 26, mode = "local") {
    if (window.d3?.geoPath) {
      const collection = { type: "FeatureCollection", features: features || [] };
      const projection = (mode === "national" && window.d3.geoAlbersUsa)
        ? window.d3.geoAlbersUsa()
        : window.d3.geoMercator();
      projection.fitExtent([[pad, pad], [width - pad, height - pad]], collection);
      const path = window.d3.geoPath(projection);
      return {
        width,
        height,
        pathForFeature(feature) {
          return projectedFeaturePath(feature, projection) || path(feature) || "";
        },
        boundsForFeature(feature) {
          return path.bounds(feature);
        },
        project(point) {
          return projection(point);
        }
      };
    }
    const bounds = featureBounds(features);
    const spanX = Math.max(0.0001, bounds.maxX - bounds.minX);
    const spanY = Math.max(0.0001, bounds.maxY - bounds.minY);
    const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
    const offsetX = (width - spanX * scale) / 2;
    const offsetY = (height - spanY * scale) / 2;
    return {
      width,
      height,
      boundsForFeature(feature) {
        return [[0, 0], [width, height]];
      },
      project(lon, lat) {
        return [
          offsetX + ((lon - bounds.minX) * scale),
          offsetY + ((bounds.maxY - lat) * scale)
        ];
      }
    };
  }

  function pathForFeature(feature, projectionTools) {
    if (projectionTools?.pathForFeature) return projectionTools.pathForFeature(feature);
    return pathForGeometry(feature?.geometry, projectionTools.project);
  }

  function pathForGeometry(geometry, project) {
    if (!geometry) return "";
    const ringPath = (ring) => ring.map(([lon, lat], index) => {
      const [x, y] = project(lon, lat);
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ") + " Z";
    if (geometry.type === "Polygon") return geometry.coordinates.map(ringPath).join(" ");
    if (geometry.type === "MultiPolygon") return geometry.coordinates.flatMap((polygon) => polygon.map(ringPath)).join(" ");
    return "";
  }

  function displayPercentagesForRace(race) {
    const saved = race?.prediction?.displayPercentages || {};
    const savedD = Number(saved.D);
    const savedR = Number(saved.R);
    if (Number.isFinite(savedD) || Number.isFinite(savedR)) {
      return {
        D: Number.isFinite(savedD) ? savedD : null,
        R: Number.isFinite(savedR) ? savedR : null
      };
    }
    const winner = partyFromRace(race);
    const margin = Math.abs(Number(race?.prediction?.projectedMargin));
    if (!Number.isFinite(margin)) return { D: null, R: null };
    const lead = Math.min(50, margin / 2);
    if (winner === "D") return { D: 50 + lead, R: 50 - lead };
    if (winner === "R") return { D: 50 - lead, R: 50 + lead };
    return { D: 50, R: 50 };
  }

  function raceTooltip(race, label) {
    if (!race) return `<strong>${escapeHtml(label)}</strong>`;
    const pct = displayPercentagesForRace(race);
    const dName = race.candidates?.D?.name || "Democrat";
    const rName = race.candidates?.R?.name || "Republican";
    return `
      <strong>${escapeHtml(race.displayName || label)}</strong>
      <div class="prediction-map-tooltip-row"><span class="is-d">${escapeHtml(dName)}</span><b>${pct.D === null ? "--" : `${pct.D.toFixed(1)}%`}</b></div>
      <div class="prediction-map-tooltip-row"><span class="is-r">${escapeHtml(rName)}</span><b>${pct.R === null ? "--" : `${pct.R.toFixed(1)}%`}</b></div>
      <small>${escapeHtml(race.prediction?.rating || "Unrated")} / ${escapeHtml(race.prediction?.winner || "--")}</small>
    `;
  }

  function countyTooltip(feature, race, countyValues = {}) {
    const key = countyKey(feature);
    const override = countyValues[key] || {};
    const score = Number.isFinite(Number(override.mapValue)) ? Number(override.mapValue) : null;
    const d = override.displayPercentages?.D;
    const r = override.displayPercentages?.R;
    return `
      <strong>${escapeHtml(countyName(feature))}</strong>
      <div class="prediction-map-tooltip-row"><span class="is-d">${escapeHtml(race?.candidates?.D?.name || "Democrat")}</span><b>${Number.isFinite(Number(d)) ? `${Number(d).toFixed(1)}%` : "--"}</b></div>
      <div class="prediction-map-tooltip-row"><span class="is-r">${escapeHtml(race?.candidates?.R?.name || "Republican")}</span><b>${Number.isFinite(Number(r)) ? `${Number(r).toFixed(1)}%` : "--"}</b></div>
      <small>${score === null ? "No county map value set" : `${score < 0 ? "D" : score > 0 ? "R" : "Even"} ${Math.abs(score).toFixed(0)}`}</small>
    `;
  }

  function tooltipNode(container) {
    let node = container.querySelector(".prediction-map-tooltip");
    if (!node) {
      node = document.createElement("div");
      node.className = "prediction-map-tooltip";
      node.hidden = true;
      container.appendChild(node);
    }
    return node;
  }

  function showTooltip(container, event, html) {
    const node = tooltipNode(container);
    const rect = container.getBoundingClientRect();
    node.innerHTML = html;
    node.hidden = false;
    const x = event.clientX - rect.left + 14;
    const y = event.clientY - rect.top + 14;
    node.style.left = `${Math.min(rect.width - 260, Math.max(8, x))}px`;
    node.style.top = `${Math.min(rect.height - 150, Math.max(8, y))}px`;
  }

  function hideTooltip(container) {
    const node = container.querySelector(".prediction-map-tooltip");
    if (node) node.hidden = true;
  }

  async function renderRaceShapeMap({ container, data, selectedRaceId = "", onSelect = null }) {
    if (!container || !data) return;
    const office = data.office || "";
    const features = await loadRaceFeatures(office);
    const raceByKey = new Map((data.races || []).map((race) => [raceKey(race, office), race]));
    const width = 1160;
    const height = 720;
    const projectionTools = projector(features, width, height, office === "house" ? 16 : 24, "national");
    const featureByRaceId = new Map();
    const pathRows = features.map((feature) => {
      const key = featureKey(feature, office);
      const race = raceByKey.get(key);
      if (race?.raceId) featureByRaceId.set(race.raceId, feature);
      const fill = race ? colorForScore(scoreFromRace(race)) : "#334054";
      const classes = [
        "prediction-shape-feature",
        "election-map-shape",
        race ? "has-race" : "is-muted",
        race?.raceId === selectedRaceId ? "is-selected" : ""
      ].filter(Boolean).join(" ");
      return `<path class="${classes}" d="${pathForFeature(feature, projectionTools)}" fill="${fill}" data-race-id="${escapeHtml(race?.raceId || "")}" data-feature-key="${escapeHtml(key)}" data-feature-label="${escapeHtml(featureName(feature, office))}" tabindex="${race ? "0" : "-1"}"></path>`;
    }).join("");

    container.classList.remove("prediction-county-map");
    container.classList.add("prediction-shape-map", "prediction-election-map");
    container.innerHTML = `
      <div class="prediction-map-controls election-map-controls" aria-label="Map controls">
        <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
        <button type="button" data-zoom="out" aria-label="Zoom out">-</button>
        <button type="button" data-zoom="reset">Reset</button>
      </div>
      <div class="prediction-shape-scale">
        <span>Strong D</span><i class="is-d"></i><b>Toss-up</b><i class="is-r"></i><span>Strong R</span>
      </div>
      <svg class="prediction-shape-svg prediction-election-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(data.title || "Prediction map")}">
        <g class="prediction-map-viewport election-map-viewport">${pathRows}</g>
      </svg>
    `;

    const svgNode = container.querySelector("svg");
    const viewportNode = container.querySelector(".prediction-map-viewport");
    const svg = window.d3?.select ? window.d3.select(svgNode) : null;
    const viewport = window.d3?.select ? window.d3.select(viewportNode) : null;
    let zoom = null;

    function setSelected(raceId) {
      container.querySelectorAll(".prediction-shape-feature").forEach((path) => {
        path.classList.toggle("is-selected", path.dataset.raceId === raceId);
      });
    }

    function zoomToFeature(feature, duration = 460) {
      if (!svg || !zoom || !feature || !projectionTools.boundsForFeature) return;
      const [[x0, y0], [x1, y1]] = projectionTools.boundsForFeature(feature);
      const dx = Math.max(1, x1 - x0);
      const dy = Math.max(1, y1 - y0);
      const scale = Math.min(18, Math.max(1.35, 0.76 / Math.max(dx / width, dy / height)));
      const tx = width / 2 - scale * (x0 + x1) / 2;
      const ty = height / 2 - scale * (y0 + y1) / 2;
      const transform = window.d3.zoomIdentity.translate(tx, ty).scale(scale);
      if (duration > 0) svg.transition().duration(duration).call(zoom.transform, transform);
      else svg.call(zoom.transform, transform);
    }

    if (svg && viewport) {
      zoom = window.d3.zoom()
        .scaleExtent([0.85, 80])
        .on("zoom", (event) => viewport.attr("transform", event.transform));
      svg.call(zoom);
      container.querySelector('[data-zoom="in"]')?.addEventListener("click", () => svg.transition().duration(180).call(zoom.scaleBy, 1.35));
      container.querySelector('[data-zoom="out"]')?.addEventListener("click", () => svg.transition().duration(180).call(zoom.scaleBy, 0.74));
      container.querySelector('[data-zoom="reset"]')?.addEventListener("click", () => svg.transition().duration(220).call(zoom.transform, window.d3.zoomIdentity));
    }

    container.querySelectorAll(".prediction-shape-feature").forEach((path) => {
      const activate = () => {
        if (!path.dataset.raceId) return;
        setSelected(path.dataset.raceId);
        const feature = featureByRaceId.get(path.dataset.raceId);
        zoomToFeature(feature);
        if (onSelect) onSelect(path.dataset.raceId, feature);
      };
      path.addEventListener("click", activate);
      path.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
      path.addEventListener("mousemove", (event) => {
        const race = (data.races || []).find((item) => item.raceId === path.dataset.raceId);
        showTooltip(container, event, raceTooltip(race, path.dataset.featureLabel));
      });
      path.addEventListener("mouseleave", () => hideTooltip(container));
    });

    if (selectedRaceId && featureByRaceId.has(selectedRaceId)) {
      setSelected(selectedRaceId);
      window.requestAnimationFrame(() => zoomToFeature(featureByRaceId.get(selectedRaceId), 0));
    }
  }

  async function renderCountyShapeMap({ container, race, countyValues = {}, selectedCountyKey = "", onSelect = null }) {
    if (!container || !race) return;
    const features = await loadCountyFeatures(race);
    if (!features.length) {
      container.innerHTML = `<p class="prediction-note">County-level geometry is not available for this race yet.</p>`;
      return;
    }
    const isFullCanvas = container.classList.contains("election-map-canvas") || container.classList.contains("admin-wide-map");
    const projectionTools = projector(features, isFullCanvas ? 1160 : 900, isFullCanvas ? 720 : 520, isFullCanvas ? 34 : 24, "local");
    const { width, height } = projectionTools;
    const paths = features.map((feature) => {
      const key = countyKey(feature);
      const override = countyValues[key] || {};
      const score = Number.isFinite(Number(override.mapValue)) ? Number(override.mapValue) : 0;
      const fill = Number.isFinite(Number(override.mapValue)) ? colorForScore(score) : "#2a344a";
      const classes = ["prediction-shape-feature", "has-race", key === selectedCountyKey ? "is-selected" : ""].filter(Boolean).join(" ");
      return `<path class="${classes}" d="${pathForFeature(feature, projectionTools)}" fill="${fill}" data-county-key="${escapeHtml(key)}" data-county-name="${escapeHtml(countyName(feature))}"></path>`;
    }).join("");
    container.classList.remove("prediction-election-map");
    container.classList.add("prediction-shape-map", "prediction-county-map");
    container.innerHTML = `
      <div class="prediction-map-controls election-map-controls" aria-label="Map controls">
        <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
        <button type="button" data-zoom="out" aria-label="Zoom out">-</button>
        <button type="button" data-zoom="reset">Reset</button>
      </div>
      <div class="prediction-shape-scale">
        <span>Strong D</span><i class="is-d"></i><b>Toss-up</b><i class="is-r"></i><span>Strong R</span>
      </div>
      <svg class="prediction-shape-svg prediction-election-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(race.displayName || race.raceId)} county prediction map">
        <g class="prediction-map-viewport election-map-viewport">${paths}</g>
      </svg>
    `;
    const svgNode = container.querySelector("svg");
    const viewportNode = container.querySelector(".prediction-map-viewport");
    const svg = window.d3?.select ? window.d3.select(svgNode) : null;
    const viewport = window.d3?.select ? window.d3.select(viewportNode) : null;
    let zoom = null;
    if (svg && viewport) {
      zoom = window.d3.zoom()
        .scaleExtent([0.9, 90])
        .on("zoom", (event) => viewport.attr("transform", event.transform));
      svg.call(zoom);
      container.querySelector('[data-zoom="in"]')?.addEventListener("click", () => svg.transition().duration(180).call(zoom.scaleBy, 1.35));
      container.querySelector('[data-zoom="out"]')?.addEventListener("click", () => svg.transition().duration(180).call(zoom.scaleBy, 0.74));
      container.querySelector('[data-zoom="reset"]')?.addEventListener("click", () => svg.transition().duration(220).call(zoom.transform, window.d3.zoomIdentity));
    }
    container.querySelectorAll(".prediction-shape-feature").forEach((path) => {
      path.addEventListener("click", () => {
        if (path.dataset.countyKey && onSelect) onSelect(path.dataset.countyKey, path.dataset.countyName);
      });
      path.addEventListener("mousemove", (event) => {
        const feature = features.find((item) => countyKey(item) === path.dataset.countyKey);
        showTooltip(container, event, countyTooltip(feature, race, countyValues));
      });
      path.addEventListener("mouseleave", () => hideTooltip(container));
    });
  }

  window.FeaPredictionMaps = {
    STATE_NAMES,
    STATE_FIPS,
    escapeHtml,
    clamp,
    colorForScore,
    scoreFromRace,
    displayPercentagesForRace,
    normalizeDistrict,
    raceKey,
    countyKey,
    renderRaceShapeMap,
    renderCountyShapeMap
  };
})();
