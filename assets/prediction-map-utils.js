(function () {
  const stateNameToAbbr = {
    Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
    Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
    Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
    Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA",
    Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT",
    Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
    "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
    Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
    Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY"
  };

  const stateFipsToAbbr = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT",
    10: "DE", 11: "DC", 12: "FL", 13: "GA", 15: "HI", 16: "ID", 17: "IL", 18: "IN",
    19: "IA", 20: "KS", 21: "KY", 22: "LA", 23: "ME", 24: "MD", 25: "MA", 26: "MI",
    27: "MN", 28: "MS", 29: "MO", 30: "MT", 31: "NE", 32: "NV", 33: "NH", 34: "NJ",
    35: "NM", 36: "NY", 37: "NC", 38: "ND", 39: "OH", 40: "OK", 41: "OR", 42: "PA",
    44: "RI", 45: "SC", 46: "SD", 47: "TN", 48: "TX", 49: "UT", 50: "VT", 51: "VA",
    53: "WA", 54: "WV", 55: "WI", 56: "WY"
  };
  const stateAbbrToName = Object.fromEntries(Object.entries(stateNameToAbbr).map(([name, abbr]) => [abbr, name]));

  const colors = {
    "Safe Democratic": "#2c54bc",
    "Likely Democratic": "#4f73d1",
    "Lean Democratic": "#7694e2",
    "Tilt Democratic": "#a0b6ef",
    Tossup: "#cbcacd",
    "Tilt Republican": "#eba3a2",
    "Lean Republican": "#dd7a78",
    "Likely Republican": "#cb5452",
    "Safe Republican": "#b5312f",
    neutral: "#677589",
    background: "#0b1d46"
  };

  const allowedRatings = [
    "Safe Democratic",
    "Likely Democratic",
    "Lean Democratic",
    "Tilt Democratic",
    "Tossup",
    "Tilt Republican",
    "Lean Republican",
    "Likely Republican",
    "Safe Republican"
  ];

  const aliases = new Map([
    ["safe d", "Safe Democratic"], ["safe dem", "Safe Democratic"], ["safe democratic", "Safe Democratic"], ["solid d", "Safe Democratic"],
    ["likely d", "Likely Democratic"], ["likely dem", "Likely Democratic"], ["likely democratic", "Likely Democratic"],
    ["lean d", "Lean Democratic"], ["lean dem", "Lean Democratic"], ["lean democratic", "Lean Democratic"],
    ["tilt d", "Tilt Democratic"], ["tilt dem", "Tilt Democratic"], ["tilt democratic", "Tilt Democratic"],
    ["toss-up", "Tossup"], ["toss up", "Tossup"], ["tossup", "Tossup"], ["tie", "Tossup"],
    ["tilt r", "Tilt Republican"], ["tilt rep", "Tilt Republican"], ["tilt republican", "Tilt Republican"],
    ["lean r", "Lean Republican"], ["lean rep", "Lean Republican"], ["lean republican", "Lean Republican"],
    ["likely r", "Likely Republican"], ["likely rep", "Likely Republican"], ["likely republican", "Likely Republican"],
    ["safe r", "Safe Republican"], ["safe rep", "Safe Republican"], ["safe republican", "Safe Republican"], ["solid r", "Safe Republican"]
  ]);

  const geometryCache = new Map();

  function normalizeRating(value) {
    const raw = String(value || "").trim();
    if (allowedRatings.includes(raw)) return raw;
    return aliases.get(raw.toLowerCase()) || "Tossup";
  }

  function ratingParty(rating) {
    const normalized = normalizeRating(rating);
    if (normalized.includes("Democratic")) return "D";
    if (normalized.includes("Republican")) return "R";
    return "Tossup";
  }

  function ratingScore(rating) {
    switch (normalizeRating(rating)) {
      case "Safe Democratic": return -100;
      case "Likely Democratic": return -75;
      case "Lean Democratic": return -50;
      case "Tilt Democratic": return -25;
      case "Tossup": return 0;
      case "Tilt Republican": return 25;
      case "Lean Republican": return 50;
      case "Likely Republican": return 75;
      case "Safe Republican": return 100;
      default: return 0;
    }
  }

  function colorForRating(rating) {
    return colors[normalizeRating(rating)] || colors.neutral;
  }

  function displayDate(value) {
    if (!value) return "No date";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[char]);
  }

  function stateAbbrFromFeature(feature) {
    const props = feature?.properties || {};
    return props.state || props.STUSPS || props.postal || props.STATE || stateNameToAbbr[props.name || props.NAME] || stateFipsToAbbr[String(props.STATEFP || "").padStart(2, "0")] || "";
  }

  function padDistrict(value) {
    const raw = String(value ?? "").trim();
    if (!raw || raw === "null" || raw === "undefined") return "";
    if (/^(AL|At Large|At-Large)$/i.test(raw)) return "AL";
    const number = Number(raw);
    if (Number.isFinite(number) && number === 0) return "AL";
    if (Number.isFinite(number)) return String(number).padStart(2, "0");
    return raw.toUpperCase();
  }

  function raceKey(race, office) {
    if (!race) return "";
    const state = String(race.state || "").toUpperCase();
    if (office === "house") {
      let district = padDistrict(race.district);
      if (!district) {
        const match = String(race.raceId || race.displayName || "").match(/\b([A-Z]{2})[-\s_]*(?:US\s*House\s*)?(\d{1,2}|AL|At[-\s]?Large)\b/i);
        if (match) district = padDistrict(match[2]);
      }
      return state && district ? `${state}-${district}` : "";
    }
    return state;
  }

  function featureKey(feature, office) {
    const props = feature?.properties || {};
    if (office === "house") {
      if (props.id) return String(props.id).replace(/-(\d)$/, "-0$1").toUpperCase();
      const state = stateAbbrFromFeature(feature);
      const cd = padDistrict(props.district ?? props.CD119FP ?? props.CD118FP ?? props.CD116FP);
      return state && cd && !["ZZ", "98", "99"].includes(cd) ? `${state}-${cd}` : "";
    }
    return stateAbbrFromFeature(feature);
  }

  function raceTitle(race, office) {
    if (!race) return "";
    if (office === "house") {
      const state = String(race.state || "").toUpperCase();
      const district = padDistrict(race.district);
      const districtLabel = district === "AL" ? "At-Large" : String(Number(district) || district);
      return `${stateAbbrToName[state] || state} US House ${districtLabel}`.trim();
    }
    if (race.displayName) return race.displayName;
    const officeName = office === "governor" ? "Governor" : "Senate";
    const state = String(race.state || "").toUpperCase();
    return `${stateAbbrToName[state] || state} ${officeName}`;
  }

  function candidateRows(race) {
    const candidates = Object.values(race?.candidates || {})
      .filter((candidate) => candidate && candidate.name);
    const partyCodeFor = (candidate) => {
      const party = String(candidate.party || candidate.partyCode || "I").trim().toUpperCase();
      if (party.startsWith("D")) return "D";
      if (party.startsWith("R")) return "R";
      if (party.startsWith("L")) return "L";
      if (party.startsWith("G")) return "G";
      if (party.startsWith("NP") || party.startsWith("N")) return "NP";
      return "I";
    };
    const looksLikeModelNote = (candidate) => (
      /longshot|spoiler risk|caucus assumption|nominee has said|path,|path$|uncertain/i
        .test(String(candidate.name || ""))
    );
    const isMajorOther = (candidate) => {
      const party = partyCodeFor(candidate);
      if (party === "D" || party === "R") return false;
      return Boolean(
        candidate.major
        || candidate.majorCandidate
        || candidate.majorIndependent
        || /\bmajor\b/i.test(String(candidate.status || ""))
        || !looksLikeModelNote(candidate)
      );
    };
    const democrat = candidates.find((candidate) => partyCodeFor(candidate) === "D");
    const republican = candidates.find((candidate) => partyCodeFor(candidate) === "R");
    const majorOther = candidates.find(isMajorOther);
    const prioritized = [democrat, republican, majorOther].filter(Boolean);
    for (const candidate of candidates) {
      if (
        prioritized.length >= 2
        || prioritized.includes(candidate)
        || isMajorOther(candidate)
        || looksLikeModelNote(candidate)
      ) continue;
      prioritized.push(candidate);
    }

    return prioritized
      .slice(0, majorOther ? 3 : 2)
      .map((candidate) => {
        const partyCode = partyCodeFor(candidate);
        return `
          <span class="prediction-tooltip-candidate">
            <b>${escapeHtml(candidate.name)}${candidate.incumbent ? "*" : ""}</b>
            <i class="party-badge is-${partyCode.toLowerCase()}">${partyCode}</i>
          </span>
        `;
      })
      .join("");
  }

  function geometryPathForOffice(office) {
    return office === "house" ? "/data/house-districts-119.geojson" : "/data/result-us-states.geojson";
  }

  function ringBounds(ring) {
    const points = (ring || []).filter((point) => (
      Array.isArray(point)
      && Number.isFinite(point[0])
      && Number.isFinite(point[1])
    ));
    if (!points.length) return null;
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      spanX: Math.max(...xs) - Math.min(...xs),
      spanY: Math.max(...ys) - Math.min(...ys),
      hasOutOfRangeLongitude: xs.some((x) => x < -180 || x > 180),
      hasPositiveLongitude: xs.some((x) => x > 0),
      crossesAntimeridian: xs.some((x) => x > 0) && xs.some((x) => x < -120)
    };
  }

  function ringLooksWrapped(ring) {
    const bounds = ringBounds(ring);
    if (!bounds || (ring || []).length < 4) return true;
    return bounds.hasOutOfRangeLongitude || bounds.hasPositiveLongitude || bounds.crossesAntimeridian || bounds.spanX > 120;
  }

  function sanitizePolygon(polygon) {
    const rings = polygon || [];
    if (!rings.length || ringLooksWrapped(rings[0])) return null;
    const cleanRings = rings.filter((ring) => !ringLooksWrapped(ring));
    return cleanRings.length ? cleanRings : null;
  }

  function sanitizeGeometryForMap(geometry) {
    if (!geometry || geometry.type === "Sphere" || geometry.type === "GeometryCollection") return null;
    if (geometry.type === "Polygon") {
      const polygon = sanitizePolygon(geometry.coordinates);
      return polygon ? { type: "Polygon", coordinates: polygon } : null;
    }
    if (geometry.type === "MultiPolygon") {
      const polygons = (geometry.coordinates || []).map(sanitizePolygon).filter(Boolean);
      return polygons.length ? { type: "MultiPolygon", coordinates: polygons } : null;
    }
    return geometry;
  }

  function sanitizeFeatureForMap(feature) {
    const geometry = sanitizeGeometryForMap(feature?.geometry);
    if (!geometry) return null;
    return {
      type: "Feature",
      properties: { ...(feature?.properties || {}) },
      geometry
    };
  }

  function sanitizeFeatureCollectionForMap(geo) {
    return {
      type: "FeatureCollection",
      features: (geo?.features || []).map(sanitizeFeatureForMap).filter(Boolean)
    };
  }

  function stateFeatureByAbbr(statesGeo) {
    const byAbbr = new Map();
    (statesGeo?.features || []).forEach((feature) => {
      const abbr = stateAbbrFromFeature(feature);
      if (abbr) byAbbr.set(abbr, feature);
    });
    return byAbbr;
  }

  function normalizedHouseFeature(feature, statesByAbbr) {
    const key = featureKey(feature, "house");
    const state = key.split("-")[0];
    const district = key.split("-")[1];
    const stateFeature = district === "AL" ? statesByAbbr.get(state) : null;
    if (!stateFeature) return feature;
    return {
      type: "Feature",
      properties: { ...(stateFeature.properties || {}), ...(feature.properties || {}) },
      geometry: stateFeature.geometry
    };
  }

  function projectedRingSegments(ring, projection, width, height) {
    const maxJump = Math.max(width, height) * 0.38;
    const segments = [];
    let current = [];

    (ring || []).forEach((point) => {
      const projected = projection(point);
      if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
        if (current.length >= 3) segments.push(current);
        current = [];
        return;
      }
      const previous = current[current.length - 1];
      if (previous) {
        const jump = Math.hypot(projected[0] - previous[0], projected[1] - previous[1]);
        if (jump > maxJump) {
          if (current.length >= 3) segments.push(current);
          current = [];
        }
      }
      current.push(projected);
    });

    if (current.length >= 3) segments.push(current);

    return segments.filter((points) => {
      const first = points[0];
      const last = points[points.length - 1];
      const closingJump = Math.hypot(last[0] - first[0], last[1] - first[1]);
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      const boxWidth = Math.max(...xs) - Math.min(...xs);
      const boxHeight = Math.max(...ys) - Math.min(...ys);
      // Census Alaska/Aleutian rings can wrap across the antimeridian and become
      // page-sized rectangles after projection. Treat any segment that consumes
      // a map-panel-sized slab as invalid, because no real state or district
      // feature should project to a near-rectangular block at national scale.
      return closingJump <= maxJump && !projectedFallbackSegmentLooksLikeSlab(boxWidth, boxHeight, width, height);
    });
  }

  function projectedFallbackSegmentLooksLikeSlab(boxWidth, boxHeight, width, height) {
    const canvasArea = width * height;
    const boxArea = boxWidth * boxHeight;
    return (
      boxArea > canvasArea * 0.72 ||
      (boxWidth > width * 0.88 && boxHeight > height * 0.5) ||
      (boxWidth > width * 0.7 && boxHeight > height * 0.74)
    );
  }

  function projectedBoxLooksLikeSlab(boxWidth, boxHeight, width, height) {
    const canvasArea = width * height;
    const boxArea = boxWidth * boxHeight;
    return (
      boxArea > canvasArea * 0.42 ||
      (boxWidth > width * 0.86 && boxHeight > height * 0.48) ||
      (boxWidth > width * 0.68 && boxHeight > height * 0.72)
    );
  }

  function projectedRingPath(ring, projection, width, height) {
    return projectedRingSegments(ring, projection, width, height)
      .map((points) => `${points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join("")}Z`)
      .join("");
  }

  function projectedFeaturePath(feature, projection, width, height) {
    const geometry = feature?.geometry;
    if (!geometry || geometry.type === "Sphere" || geometry.type === "GeometryCollection") return "";
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
    return polygons
      .flatMap((polygon) => (polygon || []).map((ring) => projectedRingPath(ring, projection, width, height)))
      .filter(Boolean)
      .join("");
  }

  function featureNeedsSegmentedPath(feature) {
    const geometry = feature?.geometry;
    if (!geometry || geometry.type === "Sphere" || geometry.type === "GeometryCollection") return false;
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
    return polygons.some((polygon) => {
      const bounds = ringBounds(polygon?.[0] || []);
      return bounds && (
        bounds.hasOutOfRangeLongitude ||
        bounds.hasPositiveLongitude ||
        bounds.crossesAntimeridian ||
        bounds.spanX > 25
      );
    });
  }

  function renderedFeaturePath(feature, path, projection, width, height) {
    // Build rating maps from screened projected segments instead of D3's
    // generated closed path. A few Alaska/at-large geometries wrap near the
    // antimeridian; when D3 closes those rings normally they can become a
    // full-panel rectangle and hide the rest of the map.
    if (!projectedFeatureBounds(feature, projection, width, height)) return "";
    return safeFeaturePath(feature, projection, width, height) || "";
  }

  function projectedFeatureBounds(feature, projection, width, height) {
    const geometry = feature?.geometry;
    if (!geometry || geometry.type === "Sphere" || geometry.type === "GeometryCollection") return null;
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
    const points = [];
    polygons.forEach((polygon) => {
      (polygon || []).forEach((ring) => {
        projectedRingSegments(ring, projection, width, height).forEach((segment) => {
          segment.forEach((point) => points.push(point));
        });
      });
    });
    if (!points.length) return null;
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const bounds = [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
    if (projectedBoxLooksLikeSlab(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], width, height)) return null;
    return bounds;
  }

  function projectedCollectionBounds(features, projection, width, height) {
    const boxes = (features || [])
      .map((feature) => projectedFeatureBounds(feature, projection, width, height))
      .filter(Boolean);
    if (!boxes.length) return null;
    return [
      [Math.min(...boxes.map((box) => box[0][0])), Math.min(...boxes.map((box) => box[0][1]))],
      [Math.max(...boxes.map((box) => box[1][0])), Math.max(...boxes.map((box) => box[1][1]))]
    ];
  }

  function renderedBoxLooksBroken(box, width, height) {
    if (!box || !Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width <= 0 || box.height <= 0) {
      return true;
    }
    return projectedBoxLooksLikeSlab(box.width, box.height, width, height);
  }

  function safeFeaturePath(feature, projection, width, height) {
    return projectedFeaturePath(feature, projection, width, height) || "";
  }

  function repairBrokenRenderedPath(element, feature, projection, width, height) {
    try {
      if (!renderedBoxLooksBroken(element.getBBox(), width, height)) return;
      element.setAttribute("d", projectedFeaturePath(feature, projection, width, height));
      if (renderedBoxLooksBroken(element.getBBox(), width, height)) element.setAttribute("d", "");
    } catch {
      element.setAttribute("d", "");
    }
  }

  async function loadGeometry(office) {
    const url = geometryPathForOffice(office);
    if (geometryCache.has(url)) return geometryCache.get(url);
    const promise = fetch(url, { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`Map geometry failed to load: ${response.status}`);
      return response.json();
    });
    geometryCache.set(url, promise);
    return promise;
  }

  async function loadStatesGeometry() {
    const url = "/data/result-us-states.geojson";
    if (geometryCache.has(url)) return geometryCache.get(url);
    const promise = fetch(url, { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`State map geometry failed to load: ${response.status}`);
      return response.json();
    });
    geometryCache.set(url, promise);
    return promise;
  }

  function makeLegend() {
    return `
      <div class="prediction-rating-legend" aria-label="Rating color legend">
        ${allowedRatings.map((rating) => `<span><i style="background:${colors[rating]}"></i>${escapeHtml(rating.replace(" Democratic", " D").replace(" Republican", " R"))}</span>`).join("")}
      </div>
    `;
  }

  async function renderRaceShapeMap(options) {
    const {
      container,
      data,
      office,
      selectedRaceId = "",
      onSelect,
      interactive = true
    } = options || {};
    if (!container) return null;
    container.classList.add("prediction-shape-map");
    if (!window.d3) {
      container.innerHTML = `<p class="prediction-map-error">Ratings map library could not load.</p>`;
      return null;
    }

    container.innerHTML = `<div class="prediction-map-loading">Loading ratings map...</div>`;
    const rawGeo = await loadGeometry(office);
    const statesGeo = sanitizeFeatureCollectionForMap(await loadStatesGeometry());
    const geo = sanitizeFeatureCollectionForMap(rawGeo);
    const fitGeo = office === "house" ? statesGeo : geo;
    const statesByAbbr = office === "house" ? stateFeatureByAbbr(statesGeo) : new Map();
    const races = Array.isArray(data?.races) ? data.races : [];
    const raceByKey = new Map();
    const raceById = new Map();
    races.forEach((race) => {
      const key = raceKey(race, office);
      if (key) raceByKey.set(key, race);
      if (race.raceId) raceById.set(race.raceId, race);
    });

    const features = (geo.features || []).map((feature) => {
      return office === "house" ? normalizedHouseFeature(feature, statesByAbbr) : feature;
    }).filter((feature) => {
      if (office !== "house") return Boolean(featureKey(feature, office));
      const key = featureKey(feature, office);
      return key && raceByKey.has(key);
    });
    const drawGeo = { type: "FeatureCollection", features };
    const width = Math.max(720, container.clientWidth || 960);
    const height = Math.max(520, Math.min(900, Math.round(width * (office === "house" ? 0.62 : 0.56))));

    container.innerHTML = `
      <div class="prediction-map-stage">
        <div class="prediction-map-controls" aria-label="Map controls">
          <button type="button" data-map-action="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" data-map-action="zoom-out" aria-label="Zoom out">-</button>
          <button type="button" data-map-action="reset">Reset</button>
        </div>
        <div class="prediction-map-tooltip" hidden></div>
        <svg class="prediction-shape-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${office} FEA Ratings map" data-map-build="ratings-adminmap15"></svg>
      </div>
      ${makeLegend()}
    `;

    const svg = window.d3.select(container).select("svg");
    const g = svg.append("g").attr("class", "prediction-shape-layer");
    const projection = window.d3.geoAlbersUsa().fitExtent([[24, 24], [width - 24, height - 24]], fitGeo);
    const path = window.d3.geoPath(projection);
    const tooltip = container.querySelector(".prediction-map-tooltip");
    let currentTransform = window.d3.zoomIdentity;

    const zoom = window.d3.zoom()
      .scaleExtent([1, 12])
      .on("zoom", (event) => {
        currentTransform = event.transform;
        g.attr("transform", currentTransform);
      });

    svg.call(zoom);

    function setSelected(id) {
      g.selectAll("path").classed("is-selected", (feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        return Boolean(id && race?.raceId === id);
      });
    }

    function tooltipHtml(race, feature) {
      if (!race) {
        const name = feature?.properties?.name || feature?.properties?.NAME || featureKey(feature, office);
        return `<strong class="prediction-tooltip-title">${escapeHtml(name)}</strong>`;
      }
      const rating = normalizeRating(race?.prediction?.rating);
      const candidates = candidateRows(race);
      return `
        <strong class="prediction-tooltip-title">${escapeHtml(raceTitle(race, office))}</strong>
        <div class="prediction-tooltip-rating">
          <span>FEA rating</span>
          <b class="rating-pill rating-${rating.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(rating)}</b>
        </div>
        ${candidates ? `
          <div class="prediction-tooltip-label">Candidates</div>
          <div class="prediction-tooltip-candidates">${candidates}</div>
        ` : ""}
      `;
    }

    function positionTooltip(event) {
      const rect = container.getBoundingClientRect();
      const tooltipWidth = tooltip.offsetWidth || 300;
      const tooltipHeight = tooltip.offsetHeight || 180;
      tooltip.style.left = `${Math.min(rect.width - tooltipWidth - 10, Math.max(10, event.clientX - rect.left + 14))}px`;
      tooltip.style.top = `${Math.min(rect.height - tooltipHeight - 10, Math.max(10, event.clientY - rect.top + 14))}px`;
    }

    g.selectAll("path")
      .data(features)
      .join("path")
      .attr("d", (feature) => renderedFeaturePath(feature, path, projection, width, height))
      .attr("class", (feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        return `prediction-shape-feature prediction-feature ${race ? "has-race" : "is-muted"}`;
      })
      .attr("fill", (feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        return race ? colorForRating(race?.prediction?.rating) : colors.neutral;
      })
      .attr("data-rating", (feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        return race ? normalizeRating(race?.prediction?.rating) : "";
      })
      .attr("data-race-id", (feature) => raceByKey.get(featureKey(feature, office))?.raceId || "")
      .attr("aria-label", (feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        return race ? `${raceTitle(race, office)}: ${normalizeRating(race?.prediction?.rating)}` : featureKey(feature, office);
      })
      .each(function (feature) {
        repairBrokenRenderedPath(this, feature, projection, width, height);
      })
      .attr("tabindex", interactive ? 0 : -1)
      .on("mouseenter focus", function (event, feature) {
        const race = raceByKey.get(featureKey(feature, office));
        tooltip.innerHTML = tooltipHtml(race, feature);
        tooltip.hidden = false;
        positionTooltip(event);
      })
      .on("mousemove", positionTooltip)
      .on("mouseleave blur", () => {
        tooltip.hidden = true;
      })
      .on("click", (event, feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        if (!race || typeof onSelect !== "function") return;
        event.stopPropagation();
        setSelected(race.raceId);
        onSelect(race);
      })
      .on("keydown", (event, feature) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const race = raceByKey.get(featureKey(feature, office));
        if (!race || typeof onSelect !== "function") return;
        setSelected(race.raceId);
        onSelect(race);
      });

    setSelected(selectedRaceId);

    function reset() {
      svg.transition().duration(260).call(zoom.transform, window.d3.zoomIdentity);
    }

    function zoomBy(factor) {
      svg.transition().duration(180).call(zoom.scaleBy, factor);
    }

    function focusRace(raceId) {
      const race = raceById.get(raceId);
      if (!race) return;
      const keys = new Set([raceKey(race, office)]);
      const selectedFeatures = features.filter((feature) => keys.has(featureKey(feature, office)));
      if (!selectedFeatures.length) return;
      let bounds = null;
      try {
        bounds = path.bounds({ type: "FeatureCollection", features: selectedFeatures });
      } catch {
        bounds = null;
      }
      if (!bounds || !Number.isFinite(bounds[0]?.[0]) || !Number.isFinite(bounds[1]?.[0])) {
        bounds = projectedCollectionBounds(selectedFeatures, projection, width, height);
      }
      if (!bounds) return;
      const dx = Math.max(1, bounds[1][0] - bounds[0][0]);
      const dy = Math.max(1, bounds[1][1] - bounds[0][1]);
      const scale = Math.min(10, Math.max(1.45, 0.82 / Math.max(dx / width, dy / height)));
      const x = (bounds[0][0] + bounds[1][0]) / 2;
      const y = (bounds[0][1] + bounds[1][1]) / 2;
      const translate = [width / 2 - scale * x, height / 2 - scale * y];
      svg.transition().duration(320).call(zoom.transform, window.d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
      setSelected(raceId);
    }

    container.querySelector('[data-map-action="zoom-in"]')?.addEventListener("click", () => zoomBy(1.35));
    container.querySelector('[data-map-action="zoom-out"]')?.addEventListener("click", () => zoomBy(0.74));
    container.querySelector('[data-map-action="reset"]')?.addEventListener("click", reset);

    return {
      focusRace,
      reset,
      setSelected,
      destroy() {
        svg.on(".zoom", null);
      },
      getTransform() {
        return currentTransform;
      }
    };
  }

  window.FeaPredictionMaps = {
    allowedRatings,
    colors,
    normalizeRating,
    ratingParty,
    ratingScore,
    colorForRating,
    displayDate,
    renderRaceShapeMap,
    raceKey
  };
})();
