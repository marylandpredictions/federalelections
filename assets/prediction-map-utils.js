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
    "Tilt Independent": "#c0a5e6",
    "Lean Independent": "#a17bd6",
    "Likely Independent": "#865cc6",
    "Safe Independent": "#6f3db4",
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
    "Tilt Independent",
    "Lean Independent",
    "Likely Independent",
    "Safe Independent",
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
    ["tilt i", "Tilt Independent"], ["tilt ind", "Tilt Independent"], ["tilt independent", "Tilt Independent"],
    ["lean i", "Lean Independent"], ["lean ind", "Lean Independent"], ["lean independent", "Lean Independent"],
    ["likely i", "Likely Independent"], ["likely ind", "Likely Independent"], ["likely independent", "Likely Independent"],
    ["safe i", "Safe Independent"], ["safe ind", "Safe Independent"], ["safe independent", "Safe Independent"], ["solid i", "Safe Independent"],
    ["tilt r", "Tilt Republican"], ["tilt rep", "Tilt Republican"], ["tilt republican", "Tilt Republican"],
    ["lean r", "Lean Republican"], ["lean rep", "Lean Republican"], ["lean republican", "Lean Republican"],
    ["likely r", "Likely Republican"], ["likely rep", "Likely Republican"], ["likely republican", "Likely Republican"],
    ["safe r", "Safe Republican"], ["safe rep", "Safe Republican"], ["safe republican", "Safe Republican"], ["solid r", "Safe Republican"]
  ]);

  const geometryCache = new Map();
  const houseMapSource = {
    url: "/data/maps/house-2026.svg?v=20261103-cd120-2",
    viewBox: "0 0 800 501",
    scale: 1,
    translateY: 0
  };

  function normalizeRating(value) {
    const raw = String(value || "").trim();
    if (allowedRatings.includes(raw)) return raw;
    return aliases.get(raw.toLowerCase()) || "Tossup";
  }

  function ratingParty(rating) {
    const normalized = normalizeRating(rating);
    if (normalized.includes("Democratic")) return "D";
    if (normalized.includes("Republican")) return "R";
    if (normalized.includes("Independent")) return "I";
    return "Tossup";
  }

  function ratingScore(rating) {
    switch (normalizeRating(rating)) {
      case "Safe Democratic": return -100;
      case "Likely Democratic": return -75;
      case "Lean Democratic": return -50;
      case "Tilt Democratic": return -25;
      case "Tossup": return 0;
      case "Tilt Independent":
      case "Lean Independent":
      case "Likely Independent":
      case "Safe Independent": return 0;
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
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? `${value}T12:00:00`
      : value;
    const date = new Date(normalized);
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
    if (office === "president" && (state === "ME" || state === "NE")) {
      const district = padDistrict(race.district);
      if (!district || district === "AL") return `${state}-AL`;
      return `${state}-${district}`;
    }
    return state;
  }

  function featureKey(feature, office) {
    const props = feature?.properties || {};
    if (office === "house" || props.presidentEvUnit) {
      if (props.presidentEvUnit) return String(props.presidentEvUnit).toUpperCase();
      if (props.id) return String(props.id).replace(/-(\d)$/, "-0$1").toUpperCase();
      const state = stateAbbrFromFeature(feature);
      const cd = padDistrict(props.district ?? props.CD119FP ?? props.CD118FP ?? props.CD116FP);
      return state && cd && !["ZZ", "98", "99"].includes(cd) ? `${state}-${cd}` : "";
    }
    if (office === "president") {
      const state = stateAbbrFromFeature(feature);
      if (state === "ME" || state === "NE") return `${state}-AL`;
      return state;
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
    if (race.name && office === "president") return race.name;
    if (office === "mayor" || race.type === "mayor") {
      return `${race.city || race.name || "City"} Mayor`;
    }
    if (office === "president" && (race.state === "ME" || race.state === "NE") && race.district != null) {
      const district = padDistrict(race.district);
      const state = String(race.state || "").toUpperCase();
      if (!district || district === "AL") return `${stateAbbrToName[state] || state} at-large electors`;
      return `${stateAbbrToName[state] || state} CD-${Number(district) || district}`;
    }
    const officeName = office === "governor" ? "Governor" : office === "president" ? "President" : "Senate";
    const state = String(race.state || "").toUpperCase();
    return `${stateAbbrToName[state] || state} ${officeName}`;
  }

  function candidateRows(race) {
    const candidates = Object.values(race?.candidates || {})
      .filter((candidate) => candidate && candidate.name)
      .sort((a, b) => {
        const aOrder = Number(a.order);
        const bOrder = Number(b.order);
        const aValue = Number.isFinite(aOrder) ? aOrder : Number.POSITIVE_INFINITY;
        const bValue = Number.isFinite(bOrder) ? bOrder : Number.POSITIVE_INFINITY;
        return aValue - bValue
          || Number(Boolean(b.incumbent)) - Number(Boolean(a.incumbent))
          || String(a.name || "").localeCompare(String(b.name || ""));
      });
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
            <b>${escapeHtml(candidate.name)}${candidate.incumbent ? "*" : ""}${candidate.presumptiveNominee ? ' <em class="candidate-presumptive">P</em>' : ""}</b>
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

  function unitFeatureId(feature) {
    return String(feature?.properties?.unitId || feature?.properties?.GEOID || feature?.id || "");
  }

  function unitFeatureName(feature) {
    return feature?.properties?.countyName
      || feature?.properties?.NAME
      || feature?.properties?.name
      || unitFeatureId(feature)
      || "Unit";
  }

  function createSubdivisionOverlay({ g, path, projection, width, height, container, svg, zoom, strokeWidth = 0.7 }) {
    let unitLayer = null;
    let lastSpec = null;
    const tooltip = container.querySelector(".prediction-map-tooltip");
    const reduceMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

    function hideTooltip() {
      if (tooltip) tooltip.hidden = true;
    }

    function showUnitTooltip(event, feature, ratingLabel) {
      if (!tooltip) return;
      const name = unitFeatureName(feature);
      const rating = ratingLabel || "Tossup";
      tooltip.innerHTML = `<strong class="prediction-tooltip-title">${name}</strong><div class="prediction-tooltip-rating"><span>${rating}</span><span class="rating-pill">${rating}</span></div><small>Click to select / paint</small>`;
      tooltip.hidden = false;
      const stage = container.querySelector(".prediction-map-stage") || container;
      const rect = stage.getBoundingClientRect();
      const x = Math.min(rect.width - 24, Math.max(12, event.clientX - rect.left + 14));
      const y = Math.min(rect.height - 24, Math.max(12, event.clientY - rect.top + 14));
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    }

    function clearSubdivisionOverlay() {
      unitLayer?.remove();
      unitLayer = null;
      lastSpec = null;
      hideTooltip();
    }

    function paintPath(selection, spec) {
      const fillOf = (feature) => {
        const fill = spec.getFill?.(feature);
        return fill || colors.Tossup || "#cbcacd";
      };
      selection
        .attr("d", (feature) => renderedFeaturePath(feature, path, projection, width, height))
        .attr("fill", fillOf)
        .style("fill", fillOf)
        .attr("data-unit", unitFeatureId)
        .attr("aria-label", (feature) => {
          const rating = spec.getRating?.(feature) || "Tossup";
          return `${unitFeatureName(feature)}: ${rating}`;
        })
        .classed("is-selected", (feature) => Boolean(spec.selectedUnit && unitFeatureId(feature) === String(spec.selectedUnit)));
    }

    function bindUnitEvents(selection, spec) {
      selection
        .on("click.unit", (event, feature) => {
          event.stopPropagation();
          spec.onUnit?.(feature);
        })
        .on("keydown.unit", (event, feature) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          spec.onUnit?.(feature);
        })
        .on("pointerenter.unit", (event, feature) => {
          const rating = spec.getRating?.(feature) || "Tossup";
          showUnitTooltip(event, feature, rating);
        })
        .on("pointermove.unit", (event, feature) => {
          const rating = spec.getRating?.(feature) || "Tossup";
          showUnitTooltip(event, feature, rating);
        })
        .on("pointerleave.unit", hideTooltip)
        .on("blur.unit", hideTooltip);
    }

    function setSubdivisionOverlay(spec = {}) {
      const list = Array.isArray(spec.features) ? spec.features : [];
      if (!list.length) {
        clearSubdivisionOverlay();
        return;
      }
      lastSpec = spec;
      if (!unitLayer) {
        unitLayer = g.append("g")
          .attr("class", "prediction-unit-overlay")
          .style("opacity", 0);
        requestAnimationFrame(() => {
          unitLayer?.style("opacity", 1);
        });
      }
      const joined = unitLayer.selectAll("path.prediction-unit-shape")
        .data(list, unitFeatureId);
      joined.exit().remove();
      const entered = joined.enter()
        .append("path")
        .attr("class", "prediction-unit-shape")
        .attr("fill", colors.Tossup || "#cbcacd")
        .style("fill", colors.Tossup || "#cbcacd")
        .attr("stroke", "currentColor")
        .attr("stroke-width", strokeWidth)
        .attr("vector-effect", "non-scaling-stroke")
        .attr("tabindex", 0)
        .attr("role", "button");
      const merged = entered.merge(joined);
      paintPath(merged, spec);
      bindUnitEvents(merged, spec);
    }

    function syncSubdivisionFills() {
      if (!unitLayer || !lastSpec) return;
      paintPath(unitLayer.selectAll("path.prediction-unit-shape"), lastSpec);
    }

    function fitFeatures(list, opts = {}) {
      const boxes = (list || [])
        .map((feature) => projectedFeatureBounds(feature, projection, width, height))
        .filter(Boolean);
      if (!boxes.length) return false;
      const bounds = [
        [Math.min(...boxes.map((box) => box[0][0])), Math.min(...boxes.map((box) => box[0][1]))],
        [Math.max(...boxes.map((box) => box[1][0])), Math.max(...boxes.map((box) => box[1][1]))]
      ];
      const panel = document.getElementById("focused-race-panel");
      const leftPad = panel && !panel.hidden ? Math.min(width * 0.42, 360) : 24;
      const dx = Math.max(1, bounds[1][0] - bounds[0][0]);
      const dy = Math.max(1, bounds[1][1] - bounds[0][1]);
      const maxScale = Number.isFinite(opts.maxScale) ? opts.maxScale : 12;
      const minScale = Number.isFinite(opts.minScale) ? opts.minScale : 1.15;
      const scale = Math.min(
        maxScale,
        Math.max(minScale, 0.82 / Math.max(dx / Math.max(80, width - leftPad - 40), dy / (height - 48)))
      );
      const x = (bounds[0][0] + bounds[1][0]) / 2;
      const y = (bounds[0][1] + bounds[1][1]) / 2;
      const next = window.d3.zoomIdentity
        .translate(leftPad + (width - leftPad) / 2 - scale * x, height / 2 - scale * y)
        .scale(scale);
      const duration = reduceMotion || opts.instant ? 0 : 320;
      const transition = svg.transition().duration(duration).call(zoom.transform, next);
      if (duration) transition.on("end.unit-fill", syncSubdivisionFills);
      else syncSubdivisionFills();
      return true;
    }

    return {
      setSubdivisionOverlay,
      clearSubdivisionOverlay,
      syncSubdivisionFills,
      fitFeatures
    };
  }

  function renderedFeaturePath(feature, path, projection, width, height) {
    // Build rating maps from screened projected segments instead of D3's
    // generated closed path. A few Alaska/at-large geometries wrap near the
    // antimeridian; when D3 closes those rings normally they can become a
    // full-panel rectangle and hide the rest of the map.
    if (!projectedFeatureBounds(feature, projection, width, height)) return "";
    return safeFeaturePath(feature, projection, width, height) || "";
  }

  /** Draw hover/selection rings above neighbors so shared borders stay complete. */
  function createHoverOutlineController(parent) {
    const hoverOutline = parent.append("path")
      .attr("class", "prediction-hover-outline")
      .attr("fill", "none")
      .attr("pointer-events", "none")
      .attr("aria-hidden", "true")
      .attr("visibility", "hidden");

    function sync(node) {
      const outlineNode = hoverOutline.node();
      if (!node || node.tagName?.toLowerCase() !== "path" || !node.getAttribute("d")) {
        hoverOutline
          .attr("d", null)
          .attr("clip-path", null)
          .attr("visibility", "hidden");
        return;
      }
      hoverOutline
        .attr("d", node.getAttribute("d"))
        .attr("clip-path", node.getAttribute("clip-path") || null)
        .attr("visibility", "visible");
      if (outlineNode?.parentNode) outlineNode.parentNode.appendChild(outlineNode);
    }

    function syncSelected(selector = "path.prediction-shape-feature.is-selected") {
      const selected = parent.selectAll(selector).filter(function () {
        return this.tagName?.toLowerCase() === "path" && this.getAttribute("d");
      }).node();
      sync(selected);
    }

    return { hoverOutline, sync, syncSelected };
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
        ${allowedRatings.map((rating) => `<span><i style="background:${colors[rating]}"></i>${escapeHtml(rating.replace(" Democratic", " D").replace(" Republican", " R").replace(" Independent", " I"))}</span>`).join("")}
      </div>
    `;
  }

  function normalizeYapmsHouseKey(value) {
    const match = String(value || "").trim().toUpperCase().match(/^([A-Z]{2})-(AL|\d{1,2})$/);
    if (!match) return "";
    return `${match[1]}-${padDistrict(match[2])}`;
  }

  async function loadYapmsHousePaths() {
    const cacheKey = houseMapSource.url;
    if (geometryCache.has(cacheKey)) return geometryCache.get(cacheKey);
    const promise = fetch(cacheKey, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`House map geometry failed to load: ${response.status}`);
        return response.text();
      })
      .then((source) => {
        const documentNode = new DOMParser().parseFromString(source, "image/svg+xml");
        if (documentNode.querySelector("parsererror")) throw new Error("House map geometry is not valid SVG.");
        const paths = [...documentNode.querySelectorAll('g[map-type="regions"] > path[region]')]
          .map((pathNode) => {
            const shortName = pathNode.getAttribute("short-name") || "";
            const region = pathNode.getAttribute("region") || "";
            const sourceKey = normalizeYapmsHouseKey(shortName) ? shortName : region;
            return {
              key: normalizeYapmsHouseKey(sourceKey),
              sourceKey,
              name: pathNode.getAttribute("long-name") || pathNode.getAttribute("name") || sourceKey,
              d: pathNode.getAttribute("d") || "",
              disabled: pathNode.getAttribute("disabled") === "true"
            };
          })
          .filter((entry) => entry.key && entry.d && !entry.disabled);
        const uniqueKeys = new Set(paths.map((entry) => entry.key));
        if (paths.length !== 435 || uniqueKeys.size !== 435) {
          throw new Error(`House map geometry is incomplete (${uniqueKeys.size} of 435 voting districts).`);
        }
        return paths;
      });
    geometryCache.set(cacheKey, promise);
    return promise;
  }

  async function renderYapmsHouseMap(options) {
    const {
      ratingLabel = "FEA rating",
      container,
      data,
      selectedRaceId = "",
      onSelect,
      onPaintStart,
      onPaintRace,
      onPaintEnd,
      isPaintEnabled,
      interactive = true,
      outlineOnly = false
    } = options || {};
    if (!container) return null;
    container.classList.add("prediction-shape-map", "prediction-yapms-house-map");
    if (!window.d3) {
      container.innerHTML = `<p class="prediction-map-error">Ratings map library could not load.</p>`;
      return null;
    }

    container.innerHTML = `<div class="prediction-map-loading">Loading current House districts...</div>`;
    const paths = await loadYapmsHousePaths();
    const races = Array.isArray(data?.races) ? data.races : [];
    const raceByKey = new Map();
    const raceById = new Map();
    races.forEach((race) => {
      const key = raceKey(race, "house");
      if (key) raceByKey.set(key, race);
      if (race.raceId) raceById.set(race.raceId, race);
    });

    container.innerHTML = `
      <div class="prediction-map-stage">
        <div class="prediction-map-controls" aria-label="Map controls">
          <button type="button" data-map-action="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" data-map-action="zoom-out" aria-label="Zoom out">-</button>
          <button type="button" data-map-action="reset">Reset</button>
        </div>
        <div class="prediction-map-tooltip" hidden></div>
        <svg class="prediction-shape-svg prediction-yapms-house-svg" viewBox="${houseMapSource.viewBox}" role="img" aria-label="House FEA Ratings map" data-map-build="census-2026-verified"></svg>
      </div>
      ${makeLegend()}
    `;

    const svg = window.d3.select(container).select("svg");
    const zoomLayer = svg.append("g").attr("class", "prediction-shape-layer prediction-yapms-zoom-layer");
    let houseTranslateX = 0;
    const districtLayer = zoomLayer.append("g")
      .attr("class", "prediction-yapms-district-layer")
      .attr(
        "transform",
        `matrix(${houseMapSource.scale} 0 0 ${houseMapSource.scale} ${houseTranslateX} ${houseMapSource.translateY})`
      );
    const tooltip = container.querySelector(".prediction-map-tooltip");
    let currentTransform = window.d3.zoomIdentity;
    let painting = false;
    let suppressClick = false;

    const zoom = window.d3.zoom()
      .scaleExtent([1, 14])
      .on("zoom", (event) => {
        currentTransform = event.transform;
        zoomLayer.attr("transform", currentTransform);
      });
    svg.call(zoom);

    const hoverRing = createHoverOutlineController(districtLayer);

    function setSelected(id) {
      districtLayer.selectAll("path.prediction-shape-feature").classed("is-selected", (entry) => {
        const race = raceByKey.get(entry.key);
        return Boolean(id && race?.raceId === id);
      });
      hoverRing.syncSelected();
    }

    function tooltipHtml(race, entry) {
      if (!race) {
        return `<strong class="prediction-tooltip-title">${escapeHtml(entry?.name || entry?.sourceKey || entry?.key)}</strong>`;
      }
      const rating = normalizeRating(race?.prediction?.rating);
      const candidates = candidateRows(race);
      return `
        <strong class="prediction-tooltip-title">${escapeHtml(raceTitle(race, "house"))}</strong>
        <div class="prediction-tooltip-rating">
          <span>${escapeHtml(ratingLabel)}</span>
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

    function houseFill(race) {
      if (!race) return colors.neutral;
      return colorForRating(normalizeRating(race?.prediction?.rating));
    }

    districtLayer.selectAll("path.prediction-shape-feature")
      .data(paths)
      .join("path")
      .attr("d", (entry) => entry.d)
      .attr("class", (entry) => {
        const race = raceByKey.get(entry.key);
        return `prediction-shape-feature prediction-feature ${race ? "has-race" : "is-muted"}${outlineOnly ? " is-outline" : ""}`;
      })
      .attr("fill", (entry) => houseFill(raceByKey.get(entry.key)))
      .attr("stroke", outlineOnly ? "currentColor" : null)
      .attr("stroke-width", outlineOnly ? 0.9 : null)
      .attr("data-rating", (entry) => {
        const race = raceByKey.get(entry.key);
        return race ? normalizeRating(race?.prediction?.rating) : "";
      })
      .attr("data-race-id", (entry) => raceByKey.get(entry.key)?.raceId || "")
      .attr("data-district", (entry) => entry.key)
      .attr("aria-label", (entry) => {
        const race = raceByKey.get(entry.key);
        return race ? `${raceTitle(race, "house")}: ${normalizeRating(race?.prediction?.rating)}` : entry.name;
      })
      .attr("tabindex", interactive ? 0 : -1)
      .on("pointerdown", function (event, entry) {
        const race = raceByKey.get(entry.key);
        if (event.button !== 0 || !race || !isPaintEnabled?.()) return;
        event.preventDefault();
        event.stopPropagation();
        painting = true;
        suppressClick = true;
        tooltip.hidden = true;
        onPaintStart?.(race);
        onPaintRace?.(race);
        window.d3.select(this)
          .attr("fill", colorForRating(race?.prediction?.rating))
          .attr("data-rating", normalizeRating(race?.prediction?.rating));
      })
      .on("mouseenter focus", function (event, entry) {
        const race = raceByKey.get(entry.key);
        if (painting && race && (event.buttons & 1)) {
          onPaintRace?.(race);
          window.d3.select(this)
            .attr("fill", colorForRating(race?.prediction?.rating))
            .attr("data-rating", normalizeRating(race?.prediction?.rating));
          return;
        }
        hoverRing.sync(this);
        tooltip.innerHTML = tooltipHtml(race, entry);
        tooltip.hidden = false;
        positionTooltip(event);
      })
      .on("mousemove", (event) => {
        if (!painting) positionTooltip(event);
      })
      .on("mouseleave blur", () => {
        tooltip.hidden = true;
        hoverRing.syncSelected();
      })
      .on("click", (event, entry) => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
        const race = raceByKey.get(entry.key);
        if (!race || typeof onSelect !== "function") return;
        event.stopPropagation();
        setSelected(race.raceId);
        onSelect(race);
      })
      .on("keydown", (event, entry) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const race = raceByKey.get(entry.key);
        if (!race || typeof onSelect !== "function") return;
        setSelected(race.raceId);
        onSelect(race);
      });

    // Keep the ring above district fills after the data join.
    hoverRing.hoverOutline.raise();

    const houseBounds = districtLayer.node()?.getBBox();
    if (houseBounds && Number.isFinite(houseBounds.x) && houseBounds.width > 0) {
      houseTranslateX = (800 - houseMapSource.scale * houseBounds.width) / 2
        - houseMapSource.scale * houseBounds.x;
      districtLayer.attr(
        "transform",
        `matrix(${houseMapSource.scale} 0 0 ${houseMapSource.scale} ${houseTranslateX} ${houseMapSource.translateY})`
      );
    }

    function finishPaint() {
      if (!painting) return;
      painting = false;
      onPaintEnd?.();
      window.setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
    window.addEventListener("pointerup", finishPaint);
    window.addEventListener("blur", finishPaint);

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
      const key = raceKey(race, "house");
      const pathNode = districtLayer.selectAll("path.prediction-shape-feature").filter((entry) => entry.key === key).node();
      if (!pathNode) return;
      const bounds = pathNode.getBBox();
      const x = houseTranslateX + houseMapSource.scale * (bounds.x + bounds.width / 2);
      const y = houseMapSource.translateY + houseMapSource.scale * (bounds.y + bounds.height / 2);
      const width = 800;
      const height = 501;
      const dx = Math.max(1, houseMapSource.scale * bounds.width);
      const dy = Math.max(1, houseMapSource.scale * bounds.height);
      const scale = Math.min(12, Math.max(1.45, 0.72 / Math.max(dx / width, dy / height)));
      const translate = [width / 2 - scale * x, height / 2 - scale * y];
      svg.transition().duration(320).call(
        zoom.transform,
        window.d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale)
      );
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
        window.removeEventListener("pointerup", finishPaint);
        window.removeEventListener("blur", finishPaint);
      },
      getTransform() {
        return currentTransform;
      }
    };
  }

  async function renderRaceShapeMap(options) {
    const {
      ratingLabel = "FEA rating",
      container,
      data,
      office,
      selectedRaceId = "",
      onSelect,
      onPaintStart,
      onPaintRace,
      onPaintEnd,
      isPaintEnabled,
      interactive = true,
      outlineOnly = false,
      blankBasemap = false
    } = options || {};
    if (!container) return null;
    if (office === "mayor") return renderMayorCityMap(options);
    if (office === "house") return renderYapmsHouseMap({...options, outlineOnly});
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

    let features = (geo.features || []).map((feature) => {
      return office === "house" ? normalizedHouseFeature(feature, statesByAbbr) : feature;
    }).filter((feature) => {
      if (office !== "house") return Boolean(featureKey(feature, office));
      const key = featureKey(feature, office);
      return key && raceByKey.has(key);
    });

    // President ME/NE: YAPms-style — CD fills on the map (clipped to the state
    // outline so house coastline cannot bleed into Iowa), AL via state underlay
    // + floating panels. District ids are zero-padded (ME-01) to match raceKey.
    const presidentClipStates = new Map();
    if (office === "president") {
      try {
        const houseGeo = sanitizeFeatureCollectionForMap(await loadGeometry("house"));
        const splitIds = new Set(["ME-01", "ME-02", "NE-01", "NE-02", "NE-03"]);
        for (const feature of features) {
          const st = stateAbbrFromFeature(feature);
          if ((st === "ME" || st === "NE") && !feature.properties?.presidentEvUnit) {
            presidentClipStates.set(st, feature);
          }
        }
        const cds = (houseGeo.features || [])
          .map((feature) => {
            const id = normalizeYapmsHouseKey(feature.properties?.id || feature.properties?.ID);
            if (!splitIds.has(id)) return null;
            const [state, dist] = id.split("-");
            return {
              ...feature,
              properties: {
                ...feature.properties,
                id,
                state,
                district: dist,
                presidentEvUnit: id,
                presidentCd: true
              }
            };
          })
          .filter(Boolean)
          .filter((feature) => raceByKey.has(featureKey(feature, "president")));
        features = features.map((feature) => {
          const st = stateAbbrFromFeature(feature);
          if ((st === "ME" || st === "NE") && !feature.properties?.presidentEvUnit) {
            return {
              ...feature,
              properties: {
                ...feature.properties,
                presidentEvUnit: `${st}-AL`,
                presidentAlBasemap: true
              }
            };
          }
          return feature;
        });
        const alStates = features.filter((f) => f.properties?.presidentAlBasemap);
        const otherStates = features.filter((f) => !f.properties?.presidentAlBasemap && !f.properties?.presidentCd);
        features = [...otherStates, ...alStates, ...cds];
      } catch (err) {
        console.warn("ME/NE district overlay unavailable", err);
      }
    }
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
    let painting = false;
    let suppressClick = false;

    if (office === "president" && presidentClipStates.size) {
      const defs = svg.append("defs");
      for (const [st, feature] of presidentClipStates) {
        defs.append("clipPath")
          .attr("id", `president-clip-${st}`)
          .attr("clipPathUnits", "userSpaceOnUse")
          .append("path")
          .attr("d", renderedFeaturePath(feature, path, projection, width, height));
      }
    }

    const zoom = window.d3.zoom()
      .scaleExtent([1, 12])
      .on("zoom", (event) => {
        currentTransform = event.transform;
        g.attr("transform", currentTransform);
      });

    svg.call(zoom);

    const hoverRing = createHoverOutlineController(g);

    function setSelected(id) {
      g.selectAll("path.prediction-shape-feature").classed("is-selected", (feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        return Boolean(id && race?.raceId === id);
      });
      g.selectAll("rect.prediction-split-unit").classed("is-selected", (unit) => {
        const raceId = unit?.race?.raceId || unit?.race?.id;
        return Boolean(id && raceId === id);
      });
      hoverRing.syncSelected();
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
          <span>${escapeHtml(ratingLabel)}</span>
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

    function shapeFill(race) {
      if (!race) return blankBasemap || outlineOnly ? "transparent" : colors.neutral;
      return colorForRating(normalizeRating(race?.prediction?.rating));
    }

    if (blankBasemap || outlineOnly) {
      g.append("g").attr("class", "prediction-basemap")
        .selectAll("path")
        .data(statesGeo.features || [])
        .join("path")
        .attr("d", (feature) => renderedFeaturePath(feature, path, projection, width, height))
        .attr("class", "prediction-basemap-state")
        .attr("fill", "transparent")
        .attr("stroke", "currentColor")
        .attr("stroke-width", 0.6)
        .attr("pointer-events", "none");
    }

    g.selectAll("path.prediction-shape-feature")
      .data(features)
      .join("path")
      .attr("d", (feature) => renderedFeaturePath(feature, path, projection, width, height))
      .attr("class", (feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        const cd = feature.properties?.presidentCd ? " is-president-cd" : "";
        const al = feature.properties?.presidentAlBasemap ? " is-president-al" : "";
        return `prediction-shape-feature prediction-feature ${race ? "has-race" : "is-muted"}${outlineOnly ? " is-outline" : ""}${cd}${al}`;
      })
      .attr("fill", (feature) => shapeFill(raceByKey.get(featureKey(feature, office))))
      .attr("stroke", (feature) => {
        if (outlineOnly) return "currentColor";
        if (feature.properties?.presidentCd) return "var(--state-border, #1a1a1a)";
        return null;
      })
      .attr("stroke-width", (feature) => {
        if (outlineOnly) return 1.1;
        if (feature.properties?.presidentCd) return 0.9;
        return null;
      })
      .attr("clip-path", (feature) => {
        if (feature.properties?.presidentCd && feature.properties?.state) {
          return `url(#president-clip-${feature.properties.state})`;
        }
        return null;
      })
      .style("pointer-events", (feature) => {
        // AL is painted from the floating panels; map hits go to CDs.
        if (feature.properties?.presidentAlBasemap) return "none";
        return null;
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
      .attr("tabindex", (feature) => (interactive && !feature.properties?.presidentAlBasemap ? 0 : -1))
      .on("pointerdown", function (event, feature) {
        const race = raceByKey.get(featureKey(feature, office));
        if (event.button !== 0 || !race || !isPaintEnabled?.()) return;
        event.preventDefault();
        event.stopPropagation();
        painting = true;
        suppressClick = true;
        tooltip.hidden = true;
        onPaintStart?.(race);
        onPaintRace?.(race);
        window.d3.select(this)
          .attr("fill", colorForRating(race?.prediction?.rating))
          .attr("data-rating", normalizeRating(race?.prediction?.rating));
      })
      .on("mouseenter focus", function (event, feature) {
        const race = raceByKey.get(featureKey(feature, office));
        if (painting && race && (event.buttons & 1)) {
          onPaintRace?.(race);
          window.d3.select(this)
            .attr("fill", colorForRating(race?.prediction?.rating))
            .attr("data-rating", normalizeRating(race?.prediction?.rating));
          return;
        }
        hoverRing.sync(this);
        tooltip.innerHTML = tooltipHtml(race, feature);
        tooltip.hidden = false;
        positionTooltip(event);
      })
      .on("mousemove", (event) => {
        if (!painting) positionTooltip(event);
      })
      .on("mouseleave blur", () => {
        tooltip.hidden = true;
        hoverRing.syncSelected();
      })
      .on("click", (event, feature) => {
        if (suppressClick) {
          suppressClick = false;
          return;
        }
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

    function finishPaint() {
      if (!painting) return;
      painting = false;
      onPaintEnd?.();
      window.setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
    window.addEventListener("pointerup", finishPaint);
    window.addEventListener("blur", finishPaint);

    function bindPaintable(selection, raceFor) {
      selection
        .attr("tabindex", interactive ? 0 : -1)
        .on("pointerdown", function (event, datum) {
          const race = raceFor(datum);
          if (event.button !== 0 || !race || !isPaintEnabled?.()) return;
          event.preventDefault();
          event.stopPropagation();
          painting = true;
          suppressClick = true;
          tooltip.hidden = true;
          onPaintStart?.(race);
          onPaintRace?.(race);
          window.d3.select(this)
            .attr("fill", colorForRating(race?.prediction?.rating))
            .attr("data-rating", normalizeRating(race?.prediction?.rating));
        })
        .on("mouseenter focus", function (event, datum) {
          const race = raceFor(datum);
          if (painting && race && (event.buttons & 1)) {
            onPaintRace?.(race);
            window.d3.select(this)
              .attr("fill", colorForRating(race?.prediction?.rating))
              .attr("data-rating", normalizeRating(race?.prediction?.rating));
            return;
          }
          // Split panels are free-floating rects — CSS stroke is enough.
          hoverRing.sync(null);
          tooltip.innerHTML = tooltipHtml(race, null);
          tooltip.hidden = false;
          positionTooltip(event);
        })
        .on("mousemove", (event) => {
          if (!painting) positionTooltip(event);
        })
        .on("mouseleave blur", () => {
          tooltip.hidden = true;
          hoverRing.syncSelected();
        })
        .on("click", (event, datum) => {
          if (suppressClick) {
            suppressClick = false;
            return;
          }
          const race = raceFor(datum);
          if (!race || typeof onSelect !== "function") return;
          event.stopPropagation();
          setSelected(race.raceId);
          onSelect(race);
        })
        .on("keydown", (event, datum) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          const race = raceFor(datum);
          if (!race || typeof onSelect !== "function") return;
          setSelected(race.raceId);
          onSelect(race);
        });
    }

    // YAPms-style split boxes live in the zoom layer so they pan/zoom with the map.
    if (office === "president" && interactive) {
      const splitGroups = [
        { state: "NE", keys: ["NE-AL", "NE-01", "NE-02", "NE-03"] },
        { state: "ME", keys: ["ME-AL", "ME-01", "ME-02"] }
      ].map((group) => ({
        ...group,
        units: group.keys.map((key) => {
          const race = raceByKey.get(key);
          if (!race) return null;
          const dist = key.split("-")[1];
          return {
            key,
            race,
            label: dist === "AL" ? `${group.state}-AL` : key,
            ev: dist === "AL" ? 2 : 1,
            isAl: dist === "AL"
          };
        }).filter(Boolean)
      })).filter((group) => group.units.length);

      if (splitGroups.length) {
        const meFeature = presidentClipStates.get("ME") || features.find((f) => stateAbbrFromFeature(f) === "ME");
        let meBounds = null;
        try { meBounds = meFeature ? path.bounds(meFeature) : null; } catch { meBounds = null; }
        // Sit in the ocean gap west of Maine — same relative pocket as YAPms, no land overlap.
        const unitH = 16;
        const unitGap = 1;
        const pad = 3;
        const cardW = 100;
        const cardGap = 8;
        const cardsW = cardW * splitGroups.length + cardGap * (splitGroups.length - 1);
        const maxCardH = Math.max(...splitGroups.map((group) => {
          const cds = group.units.filter((u) => !u.isAl).length;
          const al = group.units.some((u) => u.isAl) ? 1 : 0;
          const nestH = cds ? cds * unitH + (cds - 1) * unitGap + pad * 2 : 0;
          return pad * 2 + (al ? unitH : 0) + (al && cds ? unitGap : 0) + nestH;
        }));
        let originX = 24;
        let originY = 24;
        if (meBounds && Number.isFinite(meBounds[0][0])) {
          originX = meBounds[0][0] - cardsW - 18;
          originY = meBounds[0][1] - 4;
          // If the pocket is tight, nudge further into empty water above ME.
          if (originX < 8) originX = Math.max(8, meBounds[0][0] - cardsW - 8);
          if (originY < 8) originY = 8;
          if (originY + maxCardH > meBounds[1][1] - 8) originY = Math.max(8, meBounds[0][1] - maxCardH - 10);
        }

        const stroke = "var(--state-border)";
        const neutral = "var(--map-neutral)";
        const labelFill = "#ffffff";
        const labelStroke = "#20283899";
        const panels = g.append("g").attr("class", "prediction-split-panels");
        splitGroups.forEach((group, index) => {
          const al = group.units.find((u) => u.isAl);
          const cds = group.units.filter((u) => !u.isAl);
          const nestH = cds.length ? cds.length * unitH + (cds.length - 1) * unitGap + pad * 2 : 0;
          const cardH = pad * 2 + (al ? unitH : 0) + (al && cds.length ? unitGap : 0) + nestH;
          const card = panels.append("g")
            .attr("class", "prediction-split-card")
            .attr("transform", `translate(${originX + index * (cardW + cardGap)},${originY})`);

          // One flat plate — same fill/stroke language as state shapes (no double chrome).
          card.append("rect")
            .attr("class", "prediction-split-frame")
            .attr("width", cardW)
            .attr("height", cardH)
            .attr("fill", neutral)
            .attr("stroke", stroke)
            .attr("stroke-width", 1)
            .attr("vector-effect", "non-scaling-stroke")
            .attr("pointer-events", "none");

          let y = pad;
          const drawUnit = (unit, x, w, h) => {
            const rating = normalizeRating(unit.race?.prediction?.rating);
            const fill = rating === "Tossup" ? neutral : shapeFill(unit.race);
            const row = card.append("g").attr("transform", `translate(${x},${y})`);
            const rect = row.append("rect")
              .datum(unit)
              .attr("class", `prediction-split-unit prediction-shape-feature has-race${unit.isAl ? " is-president-al-panel" : " is-president-cd-panel"}`)
              .attr("width", w)
              .attr("height", h)
              .attr("fill", fill)
              .attr("stroke", stroke)
              .attr("stroke-width", 1)
              .attr("vector-effect", "non-scaling-stroke")
              .attr("data-race-id", unit.race.raceId || unit.race.id)
              .attr("data-rating", rating)
              .attr("aria-label", `${raceTitle(unit.race, office)}: ${rating}`);
            const label = (text, xPos, anchor) => row.append("text")
              .attr("class", "prediction-split-label")
              .attr("x", xPos)
              .attr("y", h / 2)
              .attr("dy", "0.35em")
              .attr("text-anchor", anchor)
              .attr("fill", labelFill)
              .attr("stroke", labelStroke)
              .attr("stroke-width", 0.8)
              .attr("paint-order", "stroke")
              .attr("font-family", "Arial, Helvetica, sans-serif")
              .attr("font-size", 11)
              .attr("font-weight", 700)
              .attr("pointer-events", "none")
              .text(text);
            label(unit.label, 6, "start");
            label(String(unit.ev), w - 6, "end");
            bindPaintable(rect, (d) => d.race);
            y += h + unitGap;
          };

          if (al) drawUnit(al, pad, cardW - pad * 2, unitH);
          if (cds.length) {
            const nestY = y;
            const nest = card.append("g").attr("transform", `translate(${pad},${nestY})`);
            nest.append("rect")
              .attr("class", "prediction-split-nest")
              .attr("width", cardW - pad * 2)
              .attr("height", nestH)
              .attr("fill", neutral)
              .attr("stroke", stroke)
              .attr("stroke-width", 1)
              .attr("vector-effect", "non-scaling-stroke")
              .attr("pointer-events", "none");
            y = nestY + pad;
            cds.forEach((unit) => drawUnit(unit, pad * 2, cardW - pad * 4, unitH));
          }
        });
      }
    }

    if(options.stateLabels){
      const omitted=new Set(['CT','DE','DC','MD','MA','NJ','RI','VT','NH','HI']);
      const labelPoint=feature=>{
        const polygons=feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[feature.geometry.coordinates];
        const area=rings=>Math.abs(rings[0].reduce((sum,p,i,ring)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0));
        const rings=[...polygons].sort((a,b)=>area(b)-area(a))[0];
        let polygon={type:'Polygon',coordinates:rings};if(window.d3.geoArea(polygon)>Math.PI*2)polygon={...polygon,coordinates:rings.map(r=>[...r].reverse())};
        return projection(window.d3.geoCentroid(polygon));
      };
      // One label per state — skip ME/NE CD shards so NE/ME are not stamped 2–3 times.
      const labels=features.map(feature=>{
        if(feature.properties?.presidentCd)return null;
        const race=raceByKey.get(featureKey(feature,office));
        const point=race&&!omitted.has(race.state)?labelPoint(feature):null;
        return point?{race,point}:null;
      }).filter(row=>row&&row.point.every(Number.isFinite));
      g.append('g').attr('aria-hidden','true').attr('pointer-events','none').selectAll('text').data(labels).join('text').attr('class','prediction-state-label').attr('data-label-race-id',row=>row.race.id||row.race.raceId).attr('x',row=>row.point[0]).attr('y',row=>row.point[1]).attr('text-anchor','middle').attr('dy','.35em').attr('font-family','Arial,sans-serif').attr('font-size',12).attr('font-weight',600).text(row=>row.race.state);
    }

    // Above fills, split panels, and labels so shared borders stay complete.
    hoverRing.hoverOutline.raise();
    setSelected(selectedRaceId);

    function reset() {
      svg.transition().duration(260).call(zoom.transform, window.d3.zoomIdentity);
    }

    function zoomBy(factor) {
      svg.transition().duration(180).call(zoom.scaleBy, factor);
    }

    function focusRace(raceId, opts = {}) {
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
      const panel = document.getElementById("focused-race-panel");
      const leftPad = panel && !panel.hidden ? Math.min(width * 0.42, 360) : 24;
      const dx = Math.max(1, bounds[1][0] - bounds[0][0]);
      const dy = Math.max(1, bounds[1][1] - bounds[0][1]);
      const maxScale = Number.isFinite(opts.maxScale) ? opts.maxScale : 12;
      const scale = Math.min(maxScale, Math.max(1.2, 0.78 / Math.max(dx / Math.max(80, width - leftPad - 40), dy / (height - 48))));
      const x = (bounds[0][0] + bounds[1][0]) / 2;
      const y = (bounds[0][1] + bounds[1][1]) / 2;
      const translate = [leftPad + (width - leftPad) / 2 - scale * x, height / 2 - scale * y];
      svg.transition().duration(320).call(zoom.transform, window.d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale));
      setSelected(raceId);
    }

    const overlay = createSubdivisionOverlay({
      g, path, projection, width, height, container, svg, zoom, strokeWidth: 0.7
    });
    function setFocusDim(on) {
      g.selectAll("path.prediction-shape-feature").classed("is-dimmed-focus", function () {
        if (!on) return false;
        return !this.classList.contains("is-selected");
      });
    }

    container.querySelector('[data-map-action="zoom-in"]')?.addEventListener("click", () => zoomBy(1.35));
    container.querySelector('[data-map-action="zoom-out"]')?.addEventListener("click", () => zoomBy(0.74));
    container.querySelector('[data-map-action="reset"]')?.addEventListener("click", reset);

    return {
      focusRace,
      fitFeatures: overlay.fitFeatures,
      reset,
      setSelected,
      setSubdivisionOverlay: overlay.setSubdivisionOverlay,
      clearSubdivisionOverlay: overlay.clearSubdivisionOverlay,
      syncSubdivisionFills: overlay.syncSubdivisionFills,
      setFocusDim,
      destroy() {
        overlay.clearSubdivisionOverlay();
        svg.on(".zoom", null);
        window.removeEventListener("pointerup", finishPaint);
        window.removeEventListener("blur", finishPaint);
      },
      getTransform() {
        return currentTransform;
      }
    };
  }

  async function renderMayorCityMap(options) {
    const {
      ratingLabel = "Your rating",
      container,
      data,
      onSelect,
      interactive = true,
      outlineOnly = false
    } = options || {};
    if (!container || !window.d3) return null;
    container.classList.add("prediction-shape-map", "prediction-mayor-map");
    if (outlineOnly) container.classList.add("prediction-mayor-locator");
    container.innerHTML = `<div class="prediction-map-loading">Loading mayoral map…</div>`;
    const statesGeo = sanitizeFeatureCollectionForMap(await loadStatesGeometry());
    const races = Array.isArray(data?.races) ? data.races : [];
    function geometryLooksGeographic(geometry) {
      try {
        let point = geometry?.coordinates;
        while (Array.isArray(point?.[0])) point = point[0];
        const [x, y] = point || [];
        return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90;
      } catch {
        return false;
      }
    }
    const outlines = await Promise.all(races.map(async (race) => {
      if (!race.outlineUrl) return null;
      try {
        const res = await fetch(race.outlineUrl);
        if (!res.ok) return null;
        const fc = await res.json();
        const feature = (fc.features || []).find((f) => f?.geometry) || (fc.type === "Feature" ? fc : null);
        if (!feature?.geometry || !geometryLooksGeographic(feature.geometry)) return null;
        return {...race, geometry: feature.geometry};
      } catch {
        return null;
      }
    }));
    const cityFeatures = outlines.filter(Boolean);
    const width = Math.max(720, container.clientWidth || 960);
    const height = Math.max(520, Math.min(900, Math.round(width * 0.56)));
    container.innerHTML = `
      <div class="prediction-map-stage">
        <div class="prediction-map-controls" aria-label="Map controls">
          <button type="button" data-map-action="zoom-in" aria-label="Zoom in">+</button>
          <button type="button" data-map-action="zoom-out" aria-label="Zoom out">-</button>
          <button type="button" data-map-action="reset">Reset</button>
        </div>
        <div class="prediction-map-tooltip" hidden></div>
        <svg class="prediction-shape-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mayoral races map"></svg>
      </div>
      <div class="prediction-map-legend maker-outline-legend" aria-label="Map legend">
        <span><i class="maker-legend-halo"></i> City pin</span>
        <span><i style="background:${colors.Tossup}"></i> Tossup / unset</span>
        <span><i style="background:${colors["Safe Democratic"]}"></i> Democratic winner</span>
        <span><i style="background:${colors["Safe Republican"]}"></i> Republican winner</span>
        <span><i style="background:${colors["Safe Independent"]}"></i> Independent winner</span>
      </div>
    `;
    const svg = window.d3.select(container).select("svg");
    const g = svg.append("g").attr("class", "prediction-shape-layer");
    const projection = window.d3.geoAlbersUsa().fitExtent([[24, 24], [width - 24, height - 24]], statesGeo);
    const path = window.d3.geoPath(projection);
    const tooltip = container.querySelector(".prediction-map-tooltip");
    let currentTransform = window.d3.zoomIdentity;
    // Locator map only — keep zoom modest; city detail uses the dedicated map.
    const zoom = window.d3.zoom().scaleExtent([1, 3.2]).on("zoom", (event) => {
      currentTransform = event.transform;
      g.attr("transform", currentTransform);
    });
    svg.call(zoom);
    g.append("g").attr("class", "prediction-basemap")
      .selectAll("path")
      .data(statesGeo.features || [])
      .join("path")
      .attr("d", path)
      .attr("class", "prediction-basemap-state")
      .attr("fill", "transparent")
      .attr("stroke", "currentColor")
      .attr("stroke-width", 0.55)
      .attr("pointer-events", "none");

    function cityFill(race) {
      return colorForRating(normalizeRating(race?.prediction?.rating));
    }
    function cityDecided(race) {
      return normalizeRating(race?.prediction?.rating) !== "Tossup";
    }

    const labelPoints = cityFeatures.map((race) => {
      try {
        const centroid = window.d3.geoCentroid({type: "Feature", geometry: race.geometry, properties: {}});
        const point = projection(centroid);
        return point ? {...race, x: point[0], y: point[1]} : null;
      } catch {
        return null;
      }
    }).filter(Boolean);

    const haloLayer = g.append("g").attr("class", "prediction-mayor-halos").attr("aria-hidden", "true");
    haloLayer.selectAll("circle.mayor-halo")
      .data(labelPoints)
      .join("circle")
      .attr("class", "mayor-halo")
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", 24)
      .attr("fill", (d) => cityFill(d))
      .attr("fill-opacity", (d) => cityDecided(d) ? 0.4 : 0.22)
      .attr("stroke", (d) => cityFill(d))
      .attr("stroke-opacity", 0.95)
      .attr("stroke-width", 2.4)
      .attr("data-race-id", (d) => d.raceId || d.id)
      .attr("pointer-events", "none");

    const cityLayer = g.append("g").attr("class", "prediction-mayor-cities");
    cityLayer.selectAll("path")
      .data(cityFeatures)
      .join("path")
      .attr("d", (d) => renderedFeaturePath({type: "Feature", geometry: d.geometry, properties: {}}, path, projection, width, height))
      .attr("class", (d) => `prediction-shape-feature has-race is-outline mayor-city${cityDecided(d) ? " is-decided" : ""}`)
      .attr("fill", (d) => cityFill(d))
      .attr("fill-opacity", (d) => cityDecided(d) ? 0.5 : 0.18)
      .attr("stroke", (d) => cityDecided(d) ? cityFill(d) : "currentColor")
      .attr("stroke-width", 1.8)
      .attr("stroke-opacity", 1)
      .attr("vector-effect", "non-scaling-stroke")
      .attr("data-race-id", (d) => d.raceId || d.id)
      .attr("data-rating", (d) => normalizeRating(d?.prediction?.rating))
      .attr("tabindex", interactive ? 0 : -1)
      .attr("role", "button")
      .attr("aria-label", (d) => `${raceTitle(d, "mayor")}: ${normalizeRating(d?.prediction?.rating)}`)
      .each(function (d) {
        repairBrokenRenderedPath(this, {type: "Feature", geometry: d.geometry, properties: {}}, projection, width, height);
      })
      .on("mouseenter focus", (event, d) => showMayorTip(event, d))
      .on("mouseleave blur", () => { tooltip.hidden = true; })
      .on("click", (event, d) => { event.stopPropagation(); onSelect?.(d); })
      .on("keydown", (event, d) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect?.(d);
      });

    function showMayorTip(event, d) {
      tooltip.innerHTML = `<strong class="prediction-tooltip-title">${escapeHtml(raceTitle(d, "mayor"))}</strong>
        <div class="prediction-tooltip-rating"><span>${escapeHtml(ratingLabel)}</span>
        <b class="rating-pill">${escapeHtml(normalizeRating(d?.prediction?.rating))}</b></div>
        <div class="prediction-tooltip-label">Click to paint · Right-click for detail</div>`;
      tooltip.hidden = false;
      const rect = container.getBoundingClientRect();
      tooltip.style.left = `${Math.min(rect.width - 220, Math.max(10, event.clientX - rect.left + 14))}px`;
      tooltip.style.top = `${Math.min(rect.height - 120, Math.max(10, event.clientY - rect.top + 14))}px`;
    }

    // Solid pins so cities stay visible even when outlines are tiny.
    const pinLayer = g.append("g").attr("class", "prediction-mayor-pins").attr("aria-hidden", "true");
    pinLayer.selectAll("circle.mayor-pin")
      .data(labelPoints)
      .join("circle")
      .attr("class", "mayor-pin")
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", 5.5)
      .attr("fill", (d) => cityFill(d))
      .attr("stroke", "var(--map-bg, #0b1524)")
      .attr("stroke-width", 2)
      .attr("data-race-id", (d) => d.raceId || d.id)
      .attr("pointer-events", "none");

    // Larger hit targets at national scale (outlines can be tiny).
    g.append("g").attr("class", "prediction-mayor-targets")
      .selectAll("circle")
      .data(labelPoints)
      .join("circle")
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", 34)
      .attr("fill", "transparent")
      .attr("class", "mayor-marker")
      .attr("data-race-id", (d) => d.raceId || d.id)
      .attr("tabindex", interactive ? 0 : -1)
      .attr("role", "button")
      .attr("aria-label", (d) => `${raceTitle(d, "mayor")}: ${normalizeRating(d?.prediction?.rating)}`)
      .on("mouseenter focus", (event, d) => showMayorTip(event, d))
      .on("mouseleave blur", () => { tooltip.hidden = true; })
      .on("click", (event, d) => { event.stopPropagation(); onSelect?.(d); })
      .on("keydown", (event, d) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onSelect?.(d);
      });

    g.append("g").attr("class", "prediction-mayor-labels")
      .selectAll("text")
      .data(labelPoints)
      .join("text")
      .attr("x", (d) => d.x)
      .attr("y", (d) => d.y - 22)
      .attr("class", "prediction-mayor-label")
      .attr("data-label-race-id", (d) => d.raceId || d.id)
      .attr("data-race-id", (d) => d.raceId || d.id)
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("fill", "currentColor")
      .attr("font-size", 13)
      .attr("font-family", "Arial, sans-serif")
      .attr("font-weight", 800)
      .attr("paint-order", "stroke")
      .attr("stroke", "var(--map-bg, #fff)")
      .attr("stroke-width", 4)
      .attr("cursor", "pointer")
      .text((d) => d.city || d.name || d.state)
      .on("mouseenter", (event, d) => showMayorTip(event, d))
      .on("mouseleave", () => { tooltip.hidden = true; })
      .on("click", (event, d) => { event.stopPropagation(); onSelect?.(d); });

    function setSelected(id) {
      cityLayer.selectAll("path").classed("is-selected", (d) => Boolean(id && (d.raceId || d.id) === id));
      haloLayer.selectAll("circle").classed("is-selected", (d) => Boolean(id && (d.raceId || d.id) === id));
      pinLayer.selectAll("circle").classed("is-selected", (d) => Boolean(id && (d.raceId || d.id) === id));
    }
    function setFocusDim() {
      // National mayor map is a locator only; never dim/zoom for city detail.
    }
    function focusRace(raceId) {
      // Do not deep-zoom national outlines — city detail uses the dedicated map.
      setSelected(raceId);
    }
    function reset() {
      svg.transition().duration(250).call(zoom.transform, window.d3.zoomIdentity);
    }
    function zoomBy(factor) {
      svg.transition().duration(180).call(zoom.scaleBy, factor);
    }
    container.querySelector('[data-map-action="zoom-in"]')?.addEventListener("click", () => zoomBy(1.25));
    container.querySelector('[data-map-action="zoom-out"]')?.addEventListener("click", () => zoomBy(0.8));
    container.querySelector('[data-map-action="reset"]')?.addEventListener("click", reset);
    return {
      focusRace,
      fitFeatures() { return false; },
      reset,
      setSelected,
      setSubdivisionOverlay() {},
      clearSubdivisionOverlay() {},
      syncSubdivisionFills() {},
      setFocusDim,
      destroy() { svg.on(".zoom", null); },
      getTransform() { return currentTransform; }
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
    renderMayorCityMap,
    createHoverOutlineController,
    raceKey,
    raceTitle
  };
})();
