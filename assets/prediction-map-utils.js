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
    if (race.displayName) return race.displayName;
    if (office === "house") return `${race.state}-${padDistrict(race.district)} House`;
    const officeName = office === "governor" ? "Governor" : "Senate";
    return `${race.state} ${officeName}`;
  }

  function candidateRows(race) {
    return Object.values(race?.candidates || {})
      .filter((candidate) => candidate && candidate.name)
      .slice(0, 4)
      .map((candidate) => `<span><b>${escapeHtml(candidate.name)}</b><small>${escapeHtml(candidate.party || "")}${candidate.incumbent ? " *" : ""}</small></span>`)
      .join("");
  }

  function geometryPathForOffice(office) {
    return office === "house" ? "/data/house-districts-119.geojson" : "/data/result-us-states.geojson";
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
    if (!window.d3) {
      container.innerHTML = `<p class="prediction-map-error">Ratings map library could not load.</p>`;
      return null;
    }

    container.innerHTML = `<div class="prediction-map-loading">Loading ratings map...</div>`;
    const geo = await loadGeometry(office);
    const races = Array.isArray(data?.races) ? data.races : [];
    const raceByKey = new Map();
    const raceById = new Map();
    races.forEach((race) => {
      const key = raceKey(race, office);
      if (key) raceByKey.set(key, race);
      if (race.raceId) raceById.set(race.raceId, race);
    });

    const features = (geo.features || []).filter((feature) => {
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
        <svg class="prediction-shape-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${office} FEA Ratings map"></svg>
      </div>
      ${makeLegend()}
    `;

    const svg = window.d3.select(container).select("svg");
    const g = svg.append("g").attr("class", "prediction-shape-layer");
    const projection = window.d3.geoAlbersUsa().fitExtent([[24, 24], [width - 24, height - 24]], drawGeo);
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
        return `<strong>${escapeHtml(name)}</strong>`;
      }
      const rating = normalizeRating(race?.prediction?.rating);
      const candidates = candidateRows(race);
      return `
        <strong>${escapeHtml(raceTitle(race, office))}</strong>
        <b class="rating-pill rating-${rating.toLowerCase().replace(/\s+/g, "-")}">${escapeHtml(rating)}</b>
        ${candidates ? `<div class="prediction-tooltip-candidates">${candidates}</div>` : ""}
      `;
    }

    g.selectAll("path")
      .data(features)
      .join("path")
      .attr("d", path)
      .attr("class", (feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        return `prediction-shape-feature prediction-feature ${race ? "has-race" : "is-muted"}`;
      })
      .attr("fill", (feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        return race ? colorForRating(race?.prediction?.rating) : colors.neutral;
      })
      .attr("data-race-id", (feature) => raceByKey.get(featureKey(feature, office))?.raceId || "")
      .attr("tabindex", interactive ? 0 : -1)
      .on("mouseenter focus", function (event, feature) {
        const race = raceByKey.get(featureKey(feature, office));
        tooltip.innerHTML = tooltipHtml(race, feature);
        tooltip.hidden = false;
        const rect = container.getBoundingClientRect();
        tooltip.style.left = `${Math.min(rect.width - 260, Math.max(12, event.clientX - rect.left + 14))}px`;
        tooltip.style.top = `${Math.min(rect.height - 120, Math.max(12, event.clientY - rect.top + 14))}px`;
      })
      .on("mousemove", function (event) {
        const rect = container.getBoundingClientRect();
        tooltip.style.left = `${Math.min(rect.width - 260, Math.max(12, event.clientX - rect.left + 14))}px`;
        tooltip.style.top = `${Math.min(rect.height - 120, Math.max(12, event.clientY - rect.top + 14))}px`;
      })
      .on("mouseleave blur", () => {
        tooltip.hidden = true;
      })
      .on("click", (event, feature) => {
        const race = raceByKey.get(featureKey(feature, office));
        if (race && typeof onSelect === "function") onSelect(race);
      })
      .on("keydown", (event, feature) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        const race = raceByKey.get(featureKey(feature, office));
        if (race && typeof onSelect === "function") onSelect(race);
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
      const selectedGeo = { type: "FeatureCollection", features: selectedFeatures };
      const bounds = path.bounds(selectedGeo);
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
