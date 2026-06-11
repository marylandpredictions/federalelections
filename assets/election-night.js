// 2026 Election Night Results Page
// Uses existing map files and starts with no results

// Map rendering functions copied from wiki.js and result-detail.js
const FIPS_TO_STATE = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
  "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS",
  "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO",
  "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC",
  "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"
};

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
};

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

async function renderStatewideMap(mode, raceData) {
  console.log("renderStatewideMap called with mode:", mode, "and raceData count:", raceData?.length);
  
  const container = document.getElementById("election-map");
  if (!container) {
    console.error("Map container not found");
    return;
  }
  if (!window.d3 || !window.topojson) {
    console.error("D3 or topojson not available");
    container.innerHTML = `<p class="map-note">State map rendering needs D3 to load.</p>`;
    return;
  }

  try {
    console.log("Loading US atlas data...");
    const us = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
    console.log("US atlas data loaded");
    
    const features = topojson.feature(us, us.objects.states).features;
    console.log("Features extracted:", features.length);
    
    const width = 960;
    const height = 610;
    const projection = d3.geoAlbersUsa().fitSize([width, height], { type: "FeatureCollection", features });
    const path = d3.geoPath(projection);
    
    container.innerHTML = "";
    const svg = d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `United States map of ${mode} results`);
    
    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([1, 8])
      .on("zoom", (event) => {
        svg.selectAll("path").attr("transform", event.transform);
      });
    
    svg.call(zoom);
    
    // Store zoom behavior for later use
    svg.node().__zoomBehavior = zoom;
    
    // Add zoom controls
    const zoomControls = svg.append("g")
      .attr("class", "zoom-controls")
      .attr("transform", `translate(${width - 100}, 20)`);
    
    zoomControls.append("rect")
      .attr("width", 80)
      .attr("height", 70)
      .attr("fill", "rgba(0,0,0,0.7)")
      .attr("rx", 5);
    
    zoomControls.append("text")
      .attr("x", 40)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("fill", "#fff")
      .attr("font-size", "12px")
      .text("Zoom");
    
    const zoomIn = zoomControls.append("g")
      .attr("class", "zoom-in")
      .attr("transform", "translate(20, 35)")
      .style("cursor", "pointer");
    
    zoomIn.append("rect")
      .attr("width", 20)
      .attr("height", 20)
      .attr("fill", "#fff")
      .attr("rx", 3);
    
    zoomIn.append("text")
      .attr("x", 10)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "#000")
      .attr("font-size", "16px")
      .attr("font-weight", "bold")
      .text("+");
    
    zoomIn.on("click", () => {
      svg.transition().call(zoom.scaleBy, 1.3);
    });
    
    const zoomOut = zoomControls.append("g")
      .attr("class", "zoom-out")
      .attr("transform", "translate(50, 35)")
      .style("cursor", "pointer");
    
    zoomOut.append("rect")
      .attr("width", 20)
      .attr("height", 20)
      .attr("fill", "#fff")
      .attr("rx", 3);
    
    zoomOut.append("text")
      .attr("x", 10)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "#000")
      .attr("font-size", "16px")
      .attr("font-weight", "bold")
      .text("-");
    
    zoomOut.on("click", () => {
      svg.transition().call(zoom.scaleBy, 0.7);
    });
    
    const zoomReset = zoomControls.append("g")
      .attr("class", "zoom-reset")
      .attr("transform", "translate(35, 60)")
      .style("cursor", "pointer");
    
    zoomReset.append("rect")
      .attr("width", 20)
      .attr("height", 20)
      .attr("fill", "#fff")
      .attr("rx", 3);
    
    zoomReset.append("text")
      .attr("x", 10)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "#000")
      .attr("font-size", "10px")
      .attr("font-weight", "bold")
      .text("R");
    
    zoomReset.on("click", () => {
      svg.transition().call(zoom.transform, d3.zoomIdentity);
    });
    
    console.log("SVG created, adding paths...");

    const raceByState = new Map();
    if (raceData && raceData.length) {
      raceData.forEach(race => {
        if (race.state) raceByState.set(race.state, race);
      });
    }

    // For senate and governor, darken out states with no races
    const darkenNoRaces = (mode === "senate" || mode === "governor");

    svg.selectAll("path")
      .data(features)
      .join("path")
      .attr("class", (feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        const race = raceByState.get(state);
        if (darkenNoRaces && !race) return "state-shape state-muted";
        return race ? "state-shape" : "state-shape state-muted";
      })
      .attr("d", path)
      .attr("fill", (feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        const race = raceByState.get(state);
        if (darkenNoRaces && !race) return "#2a2a2a";
        if (!race) return "#566274";
        return resultsColor(race);
      })
      .attr("stroke", "#000")
      .attr("stroke-width", 0.3)
      .attr("tabindex", (feature) => raceByState.has(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]) ? 0 : -1)
      .style("cursor", (feature) => raceByState.has(FIPS_TO_STATE[String(feature.id).padStart(2, "0")]) ? "pointer" : "default")
      .on("click keydown", (event, feature) => {
        console.log("Click event on feature:", feature);
        if (event.type === "keydown" && event.key !== "Enter") return;
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        console.log("State:", state);
        const race = raceByState.get(state);
        console.log("Race:", race);
        if (race) {
          console.log("Calling selectRace with race id:", race.id);
          currentPage.selectRace(race.id);
        }
      })
      .on("mouseover", (event, feature) => {
        const state = FIPS_TO_STATE[String(feature.id).padStart(2, "0")];
        const race = raceByState.get(state);
        let tooltipHtml = `<div style="font-weight: bold; margin-bottom: 4px;">${STATE_NAMES[state]}</div>`;
        
        if (darkenNoRaces && !race) {
          tooltipHtml += `<div style="color: #aaa;">No election</div>`;
        } else if (race) {
          tooltipHtml += `<div style="margin-bottom: 4px;">${race.electionName || state}</div>`;
          
          if (race.candidates && race.candidates.length > 0) {
            tooltipHtml += `<div style="font-size: 11px; margin-top: 6px;">`;
            race.candidates.forEach(c => {
              const partyColor = c.party === "D" ? "#2d7cff" : c.party === "R" ? "#f3536a" : "#5fc529";
              const incumbent = c.isIncumbent ? " (i)" : "";
              const winner = c.isWinner ? " ✓" : "";
              tooltipHtml += `<div style="margin: 2px 0;"><span style="color: ${partyColor}; font-weight: bold;">${c.party}</span> ${c.name}${incumbent}${winner}: ${c.percent?.toFixed(1) || 0}%</div>`;
            });
            tooltipHtml += `</div>`;
            
            if (race.reportingPercent) {
              tooltipHtml += `<div style="font-size: 10px; color: #aaa; margin-top: 4px;">${race.reportingPercent}% reporting</div>`;
            }
          }
        }
        
        // Show custom tooltip
        const tooltip = d3.select("body").append("div")
          .attr("class", "map-tooltip")
          .style("position", "absolute")
          .style("background", "rgba(0, 0, 0, 0.9)")
          .style("color", "#fff")
          .style("padding", "10px 14px")
          .style("border-radius", "6px")
          .style("font-size", "12px")
          .style("pointer-events", "none")
          .style("z-index", "1000")
          .style("max-width", "250px")
          .style("line-height", "1.4")
          .html(tooltipHtml);
        
        // Position tooltip
        tooltip
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY + 10) + "px");
      })
      .on("mousemove", (event) => {
        d3.select(".map-tooltip")
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY + 10) + "px");
      })
      .on("mouseout", () => {
        d3.select(".map-tooltip").remove();
      });
    
    console.log("Statewide map rendered successfully");
  } catch (error) {
    console.error("Failed to render statewide map:", error);
    container.innerHTML = `<p class="map-note">State map could not load. ${error.message || ""}</p>`;
  }
}

async function renderHouseDistrictMap(raceData) {
  console.log("renderHouseDistrictMap called with raceData count:", raceData?.length);
  
  const container = document.getElementById("election-map");
  if (!container) {
    console.error("Map container not found");
    return;
  }
  if (!window.d3) {
    console.error("D3 not available");
    container.innerHTML = `<p class="map-note">District map rendering needs D3 to load.</p>`;
    return;
  }

  try {
    console.log("Loading house district geojson...");
    const geo = await d3.json("data/house-districts-119.geojson");
    console.log("House district geojson loaded, features:", geo.features?.length);
    
    const width = 960;
    const height = 610;
    const projection = d3.geoAlbersUsa().fitSize([width, height], geo);

    container.innerHTML = "";
    const svg = d3.select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", "Interactive 119th Congressional District map");
    
    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([1, 8])
      .on("zoom", (event) => {
        svg.selectAll("path").attr("transform", event.transform);
      });
    
    svg.call(zoom);
    
    // Store zoom behavior for later use
    svg.node().__zoomBehavior = zoom;
    
    // Add zoom controls
    const zoomControls = svg.append("g")
      .attr("class", "zoom-controls")
      .attr("transform", `translate(${width - 100}, 20)`);
    
    zoomControls.append("rect")
      .attr("width", 80)
      .attr("height", 70)
      .attr("fill", "rgba(0,0,0,0.7)")
      .attr("rx", 5);
    
    zoomControls.append("text")
      .attr("x", 40)
      .attr("y", 20)
      .attr("text-anchor", "middle")
      .attr("fill", "#fff")
      .attr("font-size", "12px")
      .text("Zoom");
    
    const zoomIn = zoomControls.append("g")
      .attr("class", "zoom-in")
      .attr("transform", "translate(20, 35)")
      .style("cursor", "pointer");
    
    zoomIn.append("rect")
      .attr("width", 20)
      .attr("height", 20)
      .attr("fill", "#fff")
      .attr("rx", 3);
    
    zoomIn.append("text")
      .attr("x", 10)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "#000")
      .attr("font-size", "16px")
      .attr("font-weight", "bold")
      .text("+");
    
    zoomIn.on("click", () => {
      svg.transition().call(zoom.scaleBy, 1.3);
    });
    
    const zoomOut = zoomControls.append("g")
      .attr("class", "zoom-out")
      .attr("transform", "translate(50, 35)")
      .style("cursor", "pointer");
    
    zoomOut.append("rect")
      .attr("width", 20)
      .attr("height", 20)
      .attr("fill", "#fff")
      .attr("rx", 3);
    
    zoomOut.append("text")
      .attr("x", 10)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "#000")
      .attr("font-size", "16px")
      .attr("font-weight", "bold")
      .text("-");
    
    zoomOut.on("click", () => {
      svg.transition().call(zoom.scaleBy, 0.7);
    });
    
    const zoomReset = zoomControls.append("g")
      .attr("class", "zoom-reset")
      .attr("transform", "translate(35, 60)")
      .style("cursor", "pointer");
    
    zoomReset.append("rect")
      .attr("width", 20)
      .attr("height", 20)
      .attr("fill", "#fff")
      .attr("rx", 3);
    
    zoomReset.append("text")
      .attr("x", 10)
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "#000")
      .attr("font-size", "10px")
      .attr("font-weight", "bold")
      .text("R");
    
    zoomReset.on("click", () => {
      svg.transition().call(zoom.transform, d3.zoomIdentity);
    });
    
    console.log("SVG created for district map, adding paths...");

    const raceById = new Map();
    if (raceData && raceData.length) {
      raceData.forEach(race => {
        if (race.id) raceById.set(race.id, race);
      });
    }

    svg.selectAll("path")
      .data(geo.features || [])
      .join("path")
      .attr("class", (feature) => {
        const race = raceById.get(feature.properties?.id);
        return race ? "district-shape" : "district-shape state-muted";
      })
      .attr("data-district", (feature) => feature.properties?.id || "")
      .attr("d", (feature) => projectedFeaturePath(feature, projection))
      .attr("fill-rule", "evenodd")
      .attr("fill", (feature) => {
        const race = raceById.get(feature.properties?.id);
        if (!race) return "#566274";
        return resultsColor(race);
      })
      .attr("stroke", "#000")
      .attr("stroke-width", 0.3)
      .attr("tabindex", (feature) => raceById.has(feature.properties?.id) ? 0 : -1)
      .attr("aria-label", (feature) => {
        const race = raceById.get(feature.properties?.id);
        return race ? `${race.electionName || feature.properties?.id}` : `${feature.properties?.stateName || "District"} not modeled`;
      })
      .style("cursor", (feature) => raceById.has(feature.properties?.id) ? "pointer" : "default")
      .on("click keydown", (event, feature) => {
        console.log("Click event on district feature:", feature);
        if (event.type === "keydown" && event.key !== "Enter") return;
        const race = raceById.get(feature.properties?.id);
        console.log("District race:", race);
        if (race) {
          console.log("Calling selectRace with race id:", race.id);
          currentPage.selectRace(race.id);
        }
      })
      .on("mouseover", (event, feature) => {
        const race = raceById.get(feature.properties?.id);
        let tooltipHtml = `<div style="font-weight: bold; margin-bottom: 4px;">${race?.electionName || feature.properties?.id}</div>`;
        
        if (race && race.candidates && race.candidates.length > 0) {
          tooltipHtml += `<div style="font-size: 11px; margin-top: 6px;">`;
          race.candidates.forEach(c => {
            const partyColor = c.party === "D" ? "#2d7cff" : c.party === "R" ? "#f3536a" : "#5fc529";
            const incumbent = c.isIncumbent ? " (i)" : "";
            const winner = c.isWinner ? " ✓" : "";
            tooltipHtml += `<div style="margin: 2px 0;"><span style="color: ${partyColor}; font-weight: bold;">${c.party}</span> ${c.name}${incumbent}${winner}: ${c.percent?.toFixed(1) || 0}%</div>`;
          });
          tooltipHtml += `</div>`;
          
          if (race.reportingPercent) {
            tooltipHtml += `<div style="font-size: 10px; color: #aaa; margin-top: 4px;">${race.reportingPercent}% reporting</div>`;
          }
        } else {
          tooltipHtml += `<div style="color: #aaa;">${feature.properties?.stateName || "District"} not modeled</div>`;
        }
        
        // Show custom tooltip
        const tooltip = d3.select("body").append("div")
          .attr("class", "map-tooltip")
          .style("position", "absolute")
          .style("background", "rgba(0, 0, 0, 0.9)")
          .style("color", "#fff")
          .style("padding", "10px 14px")
          .style("border-radius", "6px")
          .style("font-size", "12px")
          .style("pointer-events", "none")
          .style("z-index", "1000")
          .style("max-width", "250px")
          .style("line-height", "1.4")
          .html(tooltipHtml);
        
        // Position tooltip
        tooltip
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY + 10) + "px");
      })
      .on("mousemove", (event) => {
        d3.select(".map-tooltip")
          .style("left", (event.pageX + 10) + "px")
          .style("top", (event.pageY + 10) + "px");
      })
      .on("mouseout", () => {
        d3.select(".map-tooltip").remove();
      });
    
    console.log("House district map rendered successfully");
  } catch (error) {
    console.error("Failed to render district map:", error);
    container.innerHTML = `<p class="map-note">District map could not load. ${error.message || ""}</p>`;
  }
}

function resultsColor(race) {
  if (!race || !race.candidates || !race.candidates.length) return "#566274";
  
  const winner = race.candidates.find(c => c.isWinner);
  if (winner) {
    const party = String(winner.party || "").toUpperCase();
    if (party === "D") return "#2d7cff";
    if (party === "R") return "#f3536a";
    if (party === "I") return "#5fc529";
    if (party === "L") return "#ffd700";
    if (party === "G") return "#00a86b";
  }
  
  // If no winner, use leader
  const leader = race.candidates.reduce((a, b) => (b.percent || 0) > (a.percent || 0) ? b : a);
  if (leader && leader.percent) {
    const party = String(leader.party || "").toUpperCase();
    if (party === "D") return "#2d7cff";
    if (party === "R") return "#f3536a";
    if (party === "I") return "#5fc529";
    if (party === "L") return "#ffd700";
    if (party === "G") return "#00a86b";
  }
  
  return "#566274";
}

// County map data loading functions (copied from result-detail.js)
let countyMapDataPromise = null;
let usStateMapDataPromise = null;
let majorHighwayDataPromise = null;
let countryContextDataPromise = null;
let countyDescriptionsPromise = null;
let countyDescriptionData = { byFips: {}, byStateName: {}, byName: {} };

async function loadCountyMapData() {
  if (!countyMapDataPromise) {
    countyMapDataPromise = fetch("data/result-counties.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`County map returned ${response.status}`);
      return response.json();
    });
  }
  return countyMapDataPromise;
}

async function loadUsStateMapData() {
  if (!usStateMapDataPromise) {
    usStateMapDataPromise = fetch("data/result-us-states.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`US state map returned ${response.status}`);
      return response.json();
    });
  }
  return usStateMapDataPromise;
}

async function loadMajorHighwayData() {
  if (!majorHighwayDataPromise) {
    majorHighwayDataPromise = fetch("data/result-major-highways.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`Major highway map returned ${response.status}`);
      return response.json();
    });
  }
  return majorHighwayDataPromise;
}

async function loadCountryContextData() {
  if (!countryContextDataPromise) {
    countryContextDataPromise = fetch("data/result-country-context.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`Country context map returned ${response.status}`);
      return response.json();
    });
  }
  return countryContextDataPromise;
}

async function loadCountyDescriptions() {
  if (!countyDescriptionsPromise) {
    countyDescriptionsPromise = fetch("data/result-county-descriptions.json", { cache: "force-cache" })
      .then((response) => response.ok ? response.json() : { byFips: {}, byName: {} })
      .then((data) => {
        countyDescriptionData = {
          byFips: data.byFips || {},
          byStateName: data.byStateName || {},
          byName: data.byName || {}
        };
        return countyDescriptionData;
      })
      .catch(() => {
        countyDescriptionData = { byFips: {}, byStateName: {}, byName: {} };
        return countyDescriptionData;
      });
  }
  return countyDescriptionsPromise;
}

// County map helper functions (copied from result-detail.js)
function coordinateRings(geometry) {
  if (!geometry) return [];
  const type = geometry.type;
  const coordinates = geometry.coordinates;
  if (type === "Polygon") return coordinates;
  if (type === "MultiPolygon") return coordinates.flat();
  return [];
}

function coordinateLines(geometry) {
  if (!geometry) return [];
  const type = geometry.type;
  const coordinates = geometry.coordinates;
  if (type === "LineString") return [coordinates];
  if (type === "MultiLineString") return coordinates;
  if (type === "Polygon") return coordinates;
  if (type === "MultiPolygon") return coordinates.flat();
  return [];
}

function stateBounds(features) {
  if (!features || !features.length) return null;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  features.forEach(feature => {
    const rings = coordinateRings(feature.geometry);
    rings.forEach(ring => {
      ring.forEach(([lon, lat]) => {
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      });
    });
  });
  if (!isFinite(minLon)) return null;
  return { minLon, maxLon, minLat, maxLat };
}

function expandedBounds(bounds, factor) {
  if (!bounds) return null;
  const lonRange = bounds.maxLon - bounds.minLon;
  const latRange = bounds.maxLat - bounds.minLat;
  const lonPadding = lonRange * factor;
  const latPadding = latRange * factor;
  return {
    minLon: bounds.minLon - lonPadding,
    maxLon: bounds.maxLon + lonPadding,
    minLat: bounds.minLat - latPadding,
    maxLat: bounds.maxLat + latPadding
  };
}

function mergeBounds(boundsList) {
  const valid = boundsList.filter(Boolean);
  if (!valid.length) return null;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  valid.forEach(bounds => {
    minLon = Math.min(minLon, bounds.minLon);
    maxLon = Math.max(maxLon, bounds.maxLon);
    minLat = Math.min(minLat, bounds.minLat);
    maxLat = Math.max(maxLat, bounds.maxLat);
  });
  return { minLon, maxLon, minLat, maxLat };
}

function mapDimensions(bounds, maxWidth = 960, maxHeight = 610) {
  if (!bounds) return { width: maxWidth, height: maxHeight, lonScale: 1 };
  const lonRange = bounds.maxLon - bounds.minLon;
  const latRange = bounds.maxLat - bounds.minLat;
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const lonScale = Math.max(.35, Math.cos(midLat * Math.PI / 180));
  const adjustedLonRange = lonRange * lonScale;
  const scale = Math.min(maxWidth / adjustedLonRange, maxHeight / latRange);
  const width = Math.min(maxWidth, adjustedLonRange * scale);
  const height = Math.min(maxHeight, latRange * scale);
  return { width, height, lonScale };
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stateFips(state) {
  const fipsByState = {
    AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10", DC: "11",
    FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20",
    KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28", MO: "29",
    MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37",
    ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46",
    TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54", WI: "55", WY: "56"
  };
  return fipsByState[String(state || "").toUpperCase()] || "";
}

function featureStateFips(feature) {
  return String(feature.properties?.STATEFP || feature.properties?.stateFips || "").padStart(2, "0");
}

function featureCountyFips(feature) {
  return String(feature.properties?.COUNTYFP || feature.properties?.countyFips || feature.properties?.GEOID || "").padStart(5, "0").slice(-5);
}

// County map rendering function (simplified from result-detail.js)
async function renderCountyMap(race) {
  const container = document.getElementById("election-map");
  if (!container || !race) return;
  
  try {
    const geojson = await loadCountyMapData();
    const stateGeojson = await loadUsStateMapData().catch(() => ({ features: [] }));
    const highwayGeojson = await loadMajorHighwayData().catch(() => ({ features: [] }));
    const countryGeojson = await loadCountryContextData().catch(() => ({ features: [] }));
    
    const fips = stateFips(race.state);
    if (!fips) {
      container.innerHTML = `<p class="map-note">County map not available for this race.</p>`;
      return;
    }
    
    const allFeatures = geojson.features || [];
    const allStateFeatures = stateGeojson.features || [];
    const highwayFeatures = highwayGeojson.features || [];
    const countryFeatures = countryGeojson.features || [];
    const features = allFeatures.filter((feature) => featureStateFips(feature) === fips);
    
    if (!features.length) {
      container.innerHTML = `<p class="map-note">County data not available for this state.</p>`;
      return;
    }
    
    const activeBounds = stateBounds(features);
    const bounds = expandedBounds(activeBounds, 0.1);
    const { width, height, lonScale } = mapDimensions(bounds);
    
    container.innerHTML = "";
    const svg = d3.select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `${STATE_NAMES[race.state] || race.state} county results map`);
    
    // Render country context
    if (countryFeatures.length) {
      svg.selectAll(".country-context")
        .data(countryFeatures)
        .join("path")
        .attr("class", "map-context")
        .attr("d", (feature) => geometryPath(feature.geometry, bounds, width, height, lonScale))
        .attr("fill", "none")
        .attr("stroke", "#ccc")
        .attr("stroke-width", 0.5);
    }
    
    // Render state context
    if (allStateFeatures.length) {
      svg.selectAll(".state-context")
        .data(allStateFeatures)
        .join("path")
        .attr("class", "map-context")
        .attr("d", (feature) => geometryPath(feature.geometry, bounds, width, height, lonScale))
        .attr("fill", "none")
        .attr("stroke", "#999")
        .attr("stroke-width", 1);
    }
    
    // Render counties
    const countyLookup = new Map();
    if (race.counties && race.counties.length) {
      race.counties.forEach(county => {
        if (county.fips) countyLookup.set(county.fips, county);
      });
    }
    
    svg.selectAll("path.county")
      .data(features)
      .join("path")
      .attr("class", "county")
      .attr("d", (feature) => geometryPath(feature.geometry, bounds, width, height, lonScale))
      .attr("fill", (feature) => {
        const county = countyLookup.get(featureCountyFips(feature));
        if (!county) return "#566274";
        const leader = county.candidates?.reduce((a, b) => (b.percent || 0) > (a.percent || 0) ? b : a);
        if (leader) {
          const party = String(leader.party || "").toUpperCase();
          if (party === "D") return "#2d7cff";
          if (party === "R") return "#f3536a";
          if (party === "I") return "#5fc529";
        }
        return "#566274";
      })
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .attr("tabindex", 0)
      .on("mouseenter focus", (event, feature) => {
        const county = countyLookup.get(featureCountyFips(feature));
        const name = feature.properties?.NAME || "Unknown";
        updateMapHoverCard(county, `${name} County`);
      })
      .append("title")
      .text((feature) => feature.properties?.NAME || "County");
      
  } catch (error) {
    console.error("Failed to render county map:", error);
    container.innerHTML = `<p class="map-note">County map could not load. ${error.message || ""}</p>`;
  }
}

// District county map rendering function (simplified from result-detail.js)
let districtMapDataPromise = null;

async function loadDistrictMapData() {
  if (!districtMapDataPromise) {
    districtMapDataPromise = fetch("data/house-districts-119.geojson", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error(`District map returned ${response.status}`);
      return response.json();
    });
  }
  return districtMapDataPromise;
}

async function renderDistrictCountyMap(race) {
  const container = document.getElementById("election-map");
  if (!container || !race) return;
  
  try {
    const districtGeo = await loadDistrictMapData();
    const districtNumber = race.district || 1;
    const state = race.state;
    
    // Find the district feature
    const districtFeature = (districtGeo.features || []).find((item) => (
      String(item.properties?.state || "").toUpperCase() === String(state || "").toUpperCase()
      && Number(item.properties?.district) === districtNumber
    ));
    
    if (!districtFeature) {
      container.innerHTML = `<p class="map-note">District geometry not available.</p>`;
      return;
    }
    
    const geojson = await loadCountyMapData();
    const stateGeojson = await loadUsStateMapData().catch(() => ({ features: [] }));
    const highwayGeojson = await loadMajorHighwayData().catch(() => ({ features: [] }));
    const countryGeojson = await loadCountryContextData().catch(() => ({ features: [] }));
    
    const fips = stateFips(state);
    if (!fips) {
      container.innerHTML = `<p class="map-note">District county map not available.</p>`;
      return;
    }
    
    const allCountyFeatures = geojson.features || [];
    const allStateFeatures = stateGeojson.features || [];
    const highwayFeatures = highwayGeojson.features || [];
    const countryFeatures = countryGeojson.features || [];
    const stateCountyFeatures = allCountyFeatures.filter((item) => featureStateFips(item) === fips);
    
    if (!stateCountyFeatures.length) {
      container.innerHTML = `<p class="map-note">County data not available for this state.</p>`;
      return;
    }
    
    const activeBounds = stateBounds([districtFeature]);
    const bounds = expandedBounds(activeBounds, 0.2);
    const { width, height, lonScale } = mapDimensions(bounds, 760, 540);
    
    container.innerHTML = "";
    const svg = d3.select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "img")
      .attr("aria-label", `${STATE_NAMES[state] || state} ${districtNumber} District county breakdown map`);
    
    // Render country context
    if (countryFeatures.length) {
      svg.selectAll(".country-context")
        .data(countryFeatures)
        .join("path")
        .attr("class", "map-context")
        .attr("d", (feature) => geometryPath(feature.geometry, bounds, width, height, lonScale))
        .attr("fill", "none")
        .attr("stroke", "#ccc")
        .attr("stroke-width", 0.5);
    }
    
    // Render state context
    if (allStateFeatures.length) {
      svg.selectAll(".state-context")
        .data(allStateFeatures)
        .join("path")
        .attr("class", "map-context")
        .attr("d", (feature) => geometryPath(feature.geometry, bounds, width, height, lonScale))
        .attr("fill", "none")
        .attr("stroke", "#999")
        .attr("stroke-width", 1);
    }
    
    // Render district outline
    svg.append("path")
      .attr("class", "district-outline")
      .attr("d", geometryPath(districtFeature.geometry, bounds, width, height, lonScale))
      .attr("fill", "none")
      .attr("stroke", "#2d7cff")
      .attr("stroke-width", 2);
    
    // Render counties
    const countyLookup = new Map();
    if (race.counties && race.counties.length) {
      race.counties.forEach(county => {
        if (county.fips) countyLookup.set(county.fips, county);
      });
    }
    
    svg.selectAll("path.county")
      .data(stateCountyFeatures)
      .join("path")
      .attr("class", "county")
      .attr("d", (feature) => geometryPath(feature.geometry, bounds, width, height, lonScale))
      .attr("fill", (feature) => {
        const county = countyLookup.get(featureCountyFips(feature));
        if (!county) return "#566274";
        const leader = county.candidates?.reduce((a, b) => (b.percent || 0) > (a.percent || 0) ? b : a);
        if (leader) {
          const party = String(leader.party || "").toUpperCase();
          if (party === "D") return "#2d7cff";
          if (party === "R") return "#f3536a";
          if (party === "I") return "#5fc529";
        }
        return "#566274";
      })
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.5)
      .attr("tabindex", 0)
      .on("mouseenter focus", (event, feature) => {
        const county = countyLookup.get(featureCountyFips(feature));
        const name = feature.properties?.NAME || "Unknown";
        updateMapHoverCard(county, `${name} County`);
      })
      .append("title")
      .text((feature) => feature.properties?.NAME || "County");
      
  } catch (error) {
    console.error("Failed to render district county map:", error);
    container.innerHTML = `<p class="map-note">District county map could not load. ${error.message || ""}</p>`;
  }
}

function updateMapHoverCard(race, title) {
  // Hover card removed, this function is no longer needed
  return;
}

// Global functions for event handlers
let currentPage = null;

function selectRace(raceId) {
  if (currentPage) currentPage.selectRace(raceId);
}

class ElectionNightPage {
  constructor() {
    this.selectedMode = localStorage.getItem("electionNightMode") || "house";
    this.selectedRaceId = null;
    this.focusedRace = null;
    this.raceData = [];
    this.lastUpdated = null;
    
    currentPage = this;
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadInitialData();
  }

  bindEvents() {
    // Mode toggle buttons
    document.querySelectorAll(".button-link[data-mode]").forEach(button => {
      button.addEventListener("click", (e) => {
        const mode = e.currentTarget.dataset.mode;
        this.switchMode(mode);
      });
    });
  }

  async loadInitialData() {
    await this.loadRaceData();
    await this.renderSummary();
    await this.renderMap();
  }

  async loadRaceData() {
    try {
      // Try to load race data from election night races file
      const response = await fetch("data/election-night-races.json");
      if (!response.ok) {
        this.raceData = [];
        return;
      }
      
      const data = await response.json();
      this.raceData = data.races || [];
    } catch (error) {
      console.error("Failed to load race data:", error);
      this.raceData = [];
    }
  }

  async renderMap() {
    console.log("Rendering map for mode:", this.selectedMode);
    
    const container = document.getElementById("election-map");
    if (!container) {
      console.error("Map container not found in renderMap");
      return;
    }
    
    // Show loading message
    container.innerHTML = `<p style="text-align: center; color: #c6d2ff; padding: 200px 0;">Loading map...</p>`;
    
    // Filter race data by selected mode
    const modeRaces = this.raceData.filter(race => {
      if (this.selectedMode === "house") return race.type === "house";
      if (this.selectedMode === "senate") return race.type === "senate";
      if (this.selectedMode === "governor") return race.type === "governor";
      return false;
    });

    console.log("Mode races count:", modeRaces.length);

    if (this.selectedMode === "house") {
      await renderHouseDistrictMap(modeRaces);
    } else {
      await renderStatewideMap(this.selectedMode, modeRaces);
    }
  }

  async switchMode(mode) {
    if (this.selectedMode === mode) return;

    this.selectedMode = mode;
    localStorage.setItem("electionNightMode", mode);
    this.selectedRaceId = null;
    this.focusedRace = null;
    this.raceData = [];

    // Update mode buttons
    document.querySelectorAll(".button-link[data-mode]").forEach(button => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });

    // Update summary label
    const summaryLabel = document.getElementById("summary-label");
    if (summaryLabel) {
      summaryLabel.textContent = `${mode.charAt(0).toUpperCase() + mode.slice(1)} Results`;
    }

    // Clear focus panel
    this.clearFocus();

    // Load new data
    await this.loadRaceData();
    await this.renderSummary();
    await this.renderRaceList();
    await this.renderMap();
  }

  async renderSummary() {
    // Filter race data by selected mode
    const modeRaces = this.raceData.filter(race => {
      if (this.selectedMode === "house") return race.type === "house";
      if (this.selectedMode === "senate") return race.type === "senate";
      if (this.selectedMode === "governor") return race.type === "governor";
      return false;
    });

    if (modeRaces.length === 0) {
      document.getElementById("total-races").textContent = "--";
      document.getElementById("called-races").textContent = "-- called";
      document.getElementById("reporting-status").textContent = "No votes reported";
      document.getElementById("dem-seats").textContent = "--";
      document.getElementById("rep-seats").textContent = "--";
      document.getElementById("reporting-percent").textContent = "--%";
      document.getElementById("last-updated").textContent = "--";
      return;
    }

    const totalRaces = modeRaces.length;
    const calledRaces = modeRaces.filter(r => r.status === "called").length;
    const demSeats = modeRaces.filter(r => {
      const winner = r.candidates?.find(c => c.isWinner);
      return winner && winner.party === "D";
    }).length;
    const repSeats = modeRaces.filter(r => {
      const winner = r.candidates?.find(c => c.isWinner);
      return winner && winner.party === "R";
    }).length;

    // Calculate average reporting percent
    const reportingRaces = modeRaces.filter(r => r.reportingPercent !== undefined && r.reportingPercent > 0);
    const avgReporting = reportingRaces.length > 0 
      ? reportingRaces.reduce((sum, r) => sum + (r.reportingPercent || 0), 0) / reportingRaces.length 
      : 0;

    document.getElementById("total-races").textContent = totalRaces;
    document.getElementById("called-races").textContent = `${calledRaces} called`;
    document.getElementById("reporting-status").textContent = calledRaces > 0 ? `${calledRaces} races called` : "No races called yet";
    document.getElementById("dem-seats").textContent = demSeats;
    document.getElementById("rep-seats").textContent = repSeats;
    document.getElementById("reporting-percent").textContent = avgReporting > 0 ? `${avgReporting.toFixed(1)}%` : "--%";
    document.getElementById("last-updated").textContent = new Date().toLocaleTimeString();
  }

  async renderRaceList() {
    const raceListContainer = document.getElementById("race-list");
    if (!raceListContainer) return;

    // Filter race data by selected mode
    const modeRaces = this.raceData.filter(race => {
      if (this.selectedMode === "house") return race.type === "house";
      if (this.selectedMode === "senate") return race.type === "senate";
      if (this.selectedMode === "governor") return race.type === "governor";
      return false;
    });

    if (modeRaces.length === 0) {
      raceListContainer.innerHTML = `
        <p style="text-align: center; color: #c6d2ff; padding: 100px 0;">
          No results available yet. Results will appear after polls close.
        </p>
      `;
      return;
    }

    const raceItems = modeRaces.map(race => {
      const winner = race.candidates?.find(c => c.isWinner);
      const leader = race.candidates?.reduce((a, b) => (b.percent || 0) > (a.percent || 0) ? b : a);
      const topCandidate = winner || leader;

      return `
        <div class="race-item" data-race-id="${race.id}" style="
          padding: 12px;
          margin-bottom: 8px;
          border: 1px solid #d6d9e2;
          border-radius: 8px;
          background: rgba(7, 20, 59, 0.6);
          cursor: pointer;
          transition: all 0.2s ease;
        ">
          <div style="font-weight: 700; margin-bottom: 4px;">${race.electionName || race.name}</div>
          <div style="font-size: 0.85rem; color: #c6d2ff;">
            ${topCandidate ? `${topCandidate.name}: ${topCandidate.percent?.toFixed(1) || 0}%` : "No votes"}
            ${race.reportingPercent ? ` • ${race.reportingPercent}% reporting` : ""}
          </div>
        </div>
      `;
    }).join("");

    raceListContainer.innerHTML = raceItems;

    // Add click handlers
    raceListContainer.querySelectorAll(".race-item").forEach(item => {
      item.addEventListener("click", () => {
        const raceId = item.dataset.raceId;
        this.selectRace(raceId);
      });
    });
  }

  async selectRace(raceId) {
    console.log("selectRace called with raceId:", raceId);
    this.selectedRaceId = raceId;

    // Find race in loaded data
    const race = this.raceData.find(r => r.id === raceId);
    if (!race) {
      console.error("Race not found:", raceId);
      return;
    }

    console.log("Race found:", race);
    // Zoom into the selected race on the map
    this.zoomToRace(race);
  }

  zoomToRace(race) {
    console.log("zoomToRace called with race:", race);
    const svg = d3.select("#election-map svg");
    if (!svg) {
      console.error("SVG not found");
      return;
    }

    const zoom = svg.node().__zoomBehavior;
    if (!zoom) {
      console.error("Zoom behavior not found");
      return;
    }

    // Get actual SVG dimensions
    const svgNode = svg.node();
    const svgWidth = svgNode.viewBox.baseVal.width;
    const svgHeight = svgNode.viewBox.baseVal.height;

    console.log("SVG dimensions:", svgWidth, svgHeight);

    if (this.selectedMode === "house") {
      // For house districts, find the district feature and zoom to it
      console.log("Zooming to house district:", race.id);
      d3.json("data/house-districts-119.geojson").then(geojson => {
        const width = 960;
        const height = 610;
        const projection = d3.geoAlbersUsa().fitSize([width, height], geojson);
        const path = d3.geoPath(projection);
        
        const feature = geojson.features.find(f => f.properties?.id === race.id);
        console.log("Found feature:", feature);
        if (feature) {
          const bounds = path.bounds(feature);
          const [[x0, y0], [x1, y1]] = bounds;
          const featureWidth = x1 - x0;
          const featureHeight = y1 - y0;
          
          const k = 0.9 / Math.max(featureWidth / svgWidth, featureHeight / svgHeight);
          const translate = [svgWidth / 2 - k * (x0 + x1) / 2, svgHeight / 2 - k * (y0 + y1) / 2];
          
          console.log("Zoom parameters:", { k, translate, bounds });
          
          svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(k));
        }
      });
    } else {
      // For senate and governor, find the state feature and zoom to it
      console.log("Zooming to state:", race.state);
      d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(us => {
        const width = 960;
        const height = 610;
        const features = topojson.feature(us, us.objects.states).features;
        const projection = d3.geoAlbersUsa().fitSize([width, height], { type: "FeatureCollection", features });
        const path = d3.geoPath(projection);
        
        const feature = features.find(f => {
          const state = FIPS_TO_STATE[String(f.id).padStart(2, "0")];
          return state === race.state;
        });
        
        console.log("Found state feature:", feature);
        
        if (feature) {
          const bounds = path.bounds(feature);
          const [[x0, y0], [x1, y1]] = bounds;
          const featureWidth = x1 - x0;
          const featureHeight = y1 - y0;
          
          const k = 0.9 / Math.max(featureWidth / svgWidth, featureHeight / svgHeight);
          const translate = [svgWidth / 2 - k * (x0 + x1) / 2, svgHeight / 2 - k * (y0 + y1) / 2];
          
          console.log("Zoom parameters:", { k, translate, bounds });
          
          svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(k));
        }
      });
    }
  }

  renderNoRaceData() {
    const focusedPanel = document.getElementById("focused-race-panel");
    const focusedContent = document.getElementById("focused-race-content");
    
    if (!focusedPanel || !focusedContent) return;

    focusedPanel.style.display = "block";
    focusedContent.innerHTML = `
      <p style="color: #c6d2ff;">No results available for this race yet.</p>
    `;
  }

  renderFocusedRace() {
    const focusedPanel = document.getElementById("focused-race-panel");
    const focusedContent = document.getElementById("focused-race-content");
    
    if (!focusedPanel || !focusedContent || !this.focusedRace) return;

    focusedPanel.style.display = "block";

    const race = this.focusedRace;
    const candidates = race.candidates || [];

    const candidateRows = candidates.map(cand => {
      const party = cand.party || "";
      const partyClass = party === "D" ? "party-dem" : party === "R" ? "party-rep" : party === "I" ? "party-ind" : "party-other";
      const winnerClass = cand.isWinner ? "is-winner" : "";
      
      return `
        <article class="result-full-candidate ${partyClass} ${winnerClass}" data-candidate-name="${cand.name}" data-candidate-percent="${cand.percent || 0}" style="--candidate-color: ${this.partyColor(party)};">
          <div class="result-full-header">
            <div class="result-full-info">
              <strong class="result-full-name">${cand.name}</strong>
              ${cand.isIncumbent ? '<span class="result-full-incumbent">Incumbent</span>' : ''}
              <span class="result-full-party">${party}</span>
            </div>
            <div class="result-full-numbers">
              <span class="result-full-percent">${cand.percent !== undefined ? cand.percent.toFixed(1) + "%" : "N/A"}</span>
              <span class="result-full-votes">${cand.votes !== undefined ? cand.votes.toLocaleString() + " votes" : "No votes"}</span>
            </div>
          </div>
          ${cand.isWinner ? '<div class="result-full-winner-badge">Winner</div>' : ''}
        </article>
      `;
    }).join("");

    focusedContent.innerHTML = `
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 8px; font-size: 1.5rem;">${race.electionName || race.name}</h3>
        <div style="color: #c6d2ff; font-size: 0.9rem;">
          ${race.reportingPercent !== undefined ? race.reportingPercent + "% reporting" : "No votes reported"}
        </div>
      </div>
      <div class="result-full-candidates">
        ${candidateRows}
      </div>
    `;

    // Render county map for the focused race
    if (race.type === "house" && race.district) {
      renderDistrictCountyMap(race);
    } else if (race.state) {
      renderCountyMap(race);
    }
  }

  partyColor(party) {
    const p = String(party || "").toUpperCase();
    if (p === "D") return "#2d7cff";
    if (p === "R") return "#f3536a";
    if (p === "I") return "#5fc529";
    if (p === "L") return "#ffd700";
    if (p === "G") return "#00a86b";
    return "#566274";
  }

  clearFocus() {
    this.selectedRaceId = null;
    this.focusedRace = null;

    const focusedPanel = document.getElementById("focused-race-panel");
    if (focusedPanel) {
      focusedPanel.style.display = "none";
    }

    // Re-render the main map when focus is cleared
    this.renderMap();
  }
}

// Initialize the page when D3, topojson, and DOM are ready
function initWhenReady() {
  console.log("Checking if D3, topojson, and DOM are ready...");
  console.log("D3 available:", !!window.d3);
  console.log("Topojson available:", !!window.topojson);
  console.log("DOM ready:", document.readyState === "complete" || document.readyState === "interactive");
  console.log("Map container exists:", !!document.getElementById("election-map"));
  
  if (window.d3 && window.topojson && (document.readyState === "complete" || document.readyState === "interactive")) {
    console.log("D3, topojson, and DOM ready, initializing page");
    new ElectionNightPage();
  } else {
    console.log("Waiting for D3, topojson, and DOM to be ready...");
    setTimeout(initWhenReady, 100);
  }
}

// Start initialization
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWhenReady);
} else {
  initWhenReady();
}
