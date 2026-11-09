(() => {
  if (!window.FEA_ATLAS) return;

  const NOTES = {
    districts: "District map — open a seat for county / township / HD detail. Overlays toggle on/off.",
    county: "County totals — House votes summed across every district piece in each county.",
    pv: "House popular vote by state. Click a state for its county choropleth.",
    bubbles: "Population-weighted bubbles by reported votes. Inside a race, bubbles stay on local units.",
    swing: "Swing vs baseline (arrows: blue = Dem, red = Rep). Use View to pick a baseline."
  };

  const LENS_IDS = new Set(["districts", "county", "pv", "bubbles", "swing"]);

  function migrateLens(saved) {
    if (saved === "counties") return "pv";
    return LENS_IDS.has(saved) ? saved : "districts";
  }

  function setAtlasComparison(page, mode) {
    page.comparisonMode = mode;
    try { localStorage.setItem("electionNightComparison", mode); } catch {}
    if (mode === "live") {
      page.pastMapSource = null;
      document.body.classList.remove("history-map-active", "has-history-comparison");
    }
  }

  const party = (candidate) => candidate?.partyCode || candidate?.party;

  function housePopularByState(races) {
    const map = new Map();
    for (const race of races || []) {
      if (!race.state) continue;
      const row = map.get(race.state) || { D: 0, R: 0, other: 0, name: STATE_NAMES[race.state] || race.state };
      for (const candidate of race.candidates || []) {
        if (!Number.isSafeInteger(candidate.votes) || candidate.votes < 0) continue;
        const code = party(candidate);
        row[code === "D" || code === "R" ? code : "other"] += candidate.votes;
      }
      map.set(race.state, row);
    }
    return map;
  }

  function leanForRow(row) {
    const D = row?.D || 0;
    const R = row?.R || 0;
    const other = row?.other || 0;
    const total = D + R + other;
    if (!total) return { lean: "open", total: 0, D: 0, R: 0, other: 0, demShare: 0, repShare: 0, margin: 0 };
    let lean = "split";
    if (D > R && D >= other) lean = "D";
    else if (R > D && R >= other) lean = "R";
    else if (other > D && other > R) lean = "other";
    return {
      lean,
      total,
      D,
      R,
      other,
      demShare: 100 * D / total,
      repShare: 100 * R / total,
      margin: 100 * (D - R) / total
    };
  }

  function countyVoteRow(county) {
    const row = { D: 0, R: 0, other: 0 };
    for (const candidate of county?.candidates || []) {
      if (!Number.isSafeInteger(candidate.votes) || candidate.votes < 0) continue;
      const code = party(candidate);
      row[code === "D" || code === "R" ? code : "other"] += candidate.votes;
    }
    return row;
  }

  function stateFill(lean, tokens, margin = 0) {
    if (lean === "open") return tokens?.["map-open"] || tokens?.["map-neutral"] || "#1a2438";
    if (lean === "other") return tokens?.["map-other"] || "#8b5cf6";
    if (lean === "split") return tokens?.["map-split"] || "#6a7d9c";
    if (typeof marginColor === "function" && (lean === "D" || lean === "R")) {
      return marginColor(lean === "D" ? Math.abs(margin) : -Math.abs(margin));
    }
    if (lean === "D") return tokens?.["map-dem"] || "#3a7bd5";
    if (lean === "R") return tokens?.["map-rep"] || "#c94352";
    return tokens?.["map-open"] || tokens?.["map-neutral"] || "#1a2438";
  }

  function stateCodeFromFeature(feature) {
    const props = feature?.properties || {};
    const postal = props.STUSPS || props.postal || props.state || props.STATE_ABBR;
    if (postal && /^[A-Z]{2}$/i.test(postal)) return String(postal).toUpperCase();
    const fips = String(props.STATEFP || props.STATE || props.STATE_FIPS || feature?.id || "").padStart(2, "0").slice(-2);
    return (typeof FIPS_TO_STATE !== "undefined" && FIPS_TO_STATE[fips]) || postal || "";
  }

  function ringArea(ring) {
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(area / 2);
  }

  function sanitizeStateFeatures(features) {
    return (features || []).map((feature) => {
      const geometry = feature?.geometry;
      if (!geometry) return feature;
      if (geometry.type === "MultiPolygon") {
        const coordinates = geometry.coordinates.filter((polygon) => {
          const outer = polygon?.[0];
          return outer?.length >= 4 && ringArea(outer) >= 1e-8;
        });
        if (!coordinates.length) return null;
        if (coordinates.length === 1) {
          return { ...feature, geometry: { type: "Polygon", coordinates: coordinates[0] } };
        }
        return { ...feature, geometry: { ...geometry, coordinates } };
      }
      return feature;
    }).filter(Boolean);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  function formatVotes(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function formatPercent(n) {
    return `${Number(n || 0).toFixed(1)}%`;
  }

  /** Match election-night race tooltip chrome (title + party table + foot). */
  function raceStyleTooltip(title, rows, footLeft = "", footRight = "") {
    const body = (rows || []).map((row, index) => `
      <tr class="${index === 0 && row.live ? "leading" : ""}">
        <td><span class="tooltip-party-bar" style="background:${escapeHtml(row.color)}"></span>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.percent)}</td>
        <td>${escapeHtml(row.votes)}</td>
      </tr>
    `).join("");
    return `
      <div class="election-map-tooltip-title">${escapeHtml(title)}</div>
      <table class="election-map-tooltip-table"><tbody>${body}</tbody></table>
      <div class="election-map-tooltip-foot">
        <span>${escapeHtml(footLeft)}</span>
        <span>${escapeHtml(footRight)}</span>
      </div>
    `;
  }

  function leanTooltip(title, stats, footRight = "") {
    if (!stats.total) {
      return raceStyleTooltip(title, [], "No votes tabulated yet", footRight);
    }
    const tokens = window.FEADeskTheme?.resolved?.tokens || {};
    return raceStyleTooltip(
      title,
      [
        { name: "Democratic", color: tokens["map-dem"] || "#3a7bd5", percent: formatPercent(stats.demShare), votes: formatVotes(stats.D), live: stats.lean === "D" },
        { name: "Republican", color: tokens["map-rep"] || "#c94352", percent: formatPercent(stats.repShare), votes: formatVotes(stats.R), live: stats.lean === "R" }
      ],
      `Margin D−R ${stats.margin >= 0 ? "+" : ""}${stats.margin.toFixed(1)}`,
      footRight || `${formatVotes(stats.total)} votes`
    );
  }

  function foldCountyVotes(byFips, counties) {
    for (const county of counties || []) {
      if (!county?.fips) continue;
      const row = byFips.get(county.fips) || {
        fips: county.fips,
        name: county.name || county.fips,
        D: 0,
        R: 0,
        other: 0
      };
      if (county.name) row.name = county.name;
      const votes = countyVoteRow(county);
      row.D += votes.D;
      row.R += votes.R;
      row.other += votes.other;
      byFips.set(county.fips, row);
    }
  }

  function raceHasReportedVotes(race) {
    return (race?.candidates || []).some((candidate) => Number.isSafeInteger(candidate.votes) && candidate.votes > 0);
  }

  async function fetchRaceCounties(page, race) {
    const cached = page.liveRaceDetails?.get(race.id);
    if (cached?.counties?.length) return cached.counties;
    // Direct fetch — do not use findLiveDetailForRace (24-slot cache eviction wipes mid-hydrate).
    const detail = await page.safeJson?.(`/api/live-results/race?id=${encodeURIComponent(race.id)}`);
    return detail?.id === race.id && Array.isArray(detail.counties) ? detail.counties : [];
  }

  function invalidateHouseCountyAggregate(page) {
    page.houseCountyAggregate = null;
    page.houseCountyAggregateState = null;
    page.houseCountyHydrate = null;
    page.houseCountyHydrateGen = (page.houseCountyHydrateGen || 0) + 1;
  }

  async function hydrateHouseCountyTotals(page, stateFilter = null, { onProgress } = {}) {
    const key = stateFilter || "*";
    if (page.houseCountyAggregate && page.houseCountyAggregateState === key) {
      return page.houseCountyAggregate;
    }
    if (page.houseCountyHydrate?.key === key) return page.houseCountyHydrate.promise;

    const gen = (page.houseCountyHydrateGen || 0) + 1;
    page.houseCountyHydrateGen = gen;
    const note = document.getElementById("atlas-lens-note");
    const label = stateFilter ? STATE_NAMES[stateFilter] || stateFilter : "national";
    const stillCurrent = () => page.houseCountyHydrateGen === gen;
    if (note) note.textContent = `Loading county House totals for ${label}…`;

    const promise = (async () => {
      const byFips = new Map();

      const applyBulkRows = (rows) => {
        for (const row of rows || []) {
          if (!row?.fips) continue;
          byFips.set(row.fips, {
            fips: row.fips,
            name: row.name || row.fips,
            D: Number(row.D) || 0,
            R: Number(row.R) || 0,
            other: Number(row.other) || 0
          });
        }
      };

      // Bulk endpoint hydrates missing county pages in chunks; keep asking until filled.
      let bulk = null;
      let passes = 0;
      while (stillCurrent() && passes < 12) {
        passes++;
        const params = new URLSearchParams();
        if (stateFilter) params.set("state", stateFilter);
        params.set("hydrate", String(stateFilter ? 40 : 48));
        bulk = await page.safeJson?.(`/api/live-results/house-counties?${params}`);
        if (!bulk || !Array.isArray(bulk.counties)) break;
        applyBulkRows(bulk.counties);
        onProgress?.(byFips);
        if (!(bulk.racesMissingCounties > 0) || !(bulk.hydratedThisPass > 0)) break;
        if (note) {
          note.textContent = `Loading county House totals for ${label}… ${bulk.racesWithCounties || 0} seats ready, ${bulk.racesMissingCounties} left`;
        }
      }

      if ((!bulk || !Array.isArray(bulk.counties)) && stillCurrent()) {
        // Static / lab fallback: read persisted race files directly.
        bulk = { racesMissingCounties: 0 };
        const races = (page.dataByMode?.house || []).filter((race) => !stateFilter || race.state === stateFilter);
        const concurrency = Math.min(24, Math.max(6, races.length || 1));
        let cursor = 0;
        let finished = 0;
        async function fileWorker() {
          while (cursor < races.length && stillCurrent()) {
            const race = races[cursor++];
            try {
              const detail = await page.safeJson?.(`data/live-results-races/${encodeURIComponent(race.id)}.json`);
              if (detail?.counties?.length) foldCountyVotes(byFips, detail.counties);
              else bulk.racesMissingCounties++;
            } catch {
              bulk.racesMissingCounties++;
            }
            finished++;
            if (finished === races.length || finished % 20 === 0) onProgress?.(byFips);
          }
        }
        await Promise.all(Array.from({ length: Math.min(concurrency, races.length || 1) }, () => fileWorker()));
        onProgress?.(byFips);
      }

      // Fold anything already cached in the client.
      for (const race of page.dataByMode?.house || []) {
        if (stateFilter && race.state !== stateFilter) continue;
        const cached = page.liveRaceDetails?.get(race.id);
        if (cached?.counties?.length) foldCountyVotes(byFips, cached.counties);
      }
      onProgress?.(byFips);

      // Only gap-fill at state scope — national fan-out to /race is what made County feel broken.
      if (stateFilter && stillCurrent()) {
        const missing = (page.dataByMode?.house || []).filter((race) => {
          if (race.state !== stateFilter || !raceHasReportedVotes(race)) return false;
          return !page.liveRaceDetails?.get(race.id)?.counties?.length;
        });
        if (missing.length) {
          const concurrency = Math.min(10, missing.length);
          let cursor = 0;
          let finished = 0;
          async function worker() {
            while (cursor < missing.length && stillCurrent()) {
              const race = missing[cursor++];
              try {
                foldCountyVotes(byFips, await fetchRaceCounties(page, race));
              } catch {}
              finished++;
              if (!stillCurrent()) return;
              if (finished === missing.length || finished % 3 === 0) {
                if (note) note.textContent = `Loading county House totals for ${label}… ${finished}/${missing.length}`;
                onProgress?.(byFips);
              }
            }
          }
          await Promise.all(Array.from({ length: concurrency }, () => worker()));
        }
      }

      if (!stillCurrent()) return byFips;
      page.houseCountyAggregate = byFips;
      page.houseCountyAggregateState = key;
      if (note) {
        const partial = bulk?.racesMissingCounties > 0;
        note.textContent = stateFilter
          ? `${label} county House totals — votes summed across every district piece.${partial ? " Finishing remaining seats…" : ""}`
          : `County totals — House votes summed across district pieces.${partial ? " Finishing remaining seats…" : ""}`;
      }
      onProgress?.(byFips);
      return byFips;
    })();

    page.houseCountyHydrate = { key, promise, gen };
    try {
      return await promise;
    } finally {
      if (page.houseCountyHydrate?.promise === promise) page.houseCountyHydrate = null;
    }
  }

  async function loadAtlasCountyFeatures(page, stateFilter, revision, onBatch) {
    if (stateFilter) {
      let features = await page.loadCountyFeatures?.(stateFilter) || [];
      if (!features.length) {
        const national = await page.safeJson?.("data/result-counties.geojson");
        const fips = typeof stateFipsForElectionNight === "function" ? stateFipsForElectionNight(stateFilter) : "";
        features = (national?.features || []).filter((feature) => {
          const id = String(feature.id || feature.properties?.GEOID || "").padStart(5, "0");
          return !fips || id.slice(0, 2) === fips;
        });
      }
      return features;
    }

    // National: load compact per-state county packs (never the 28MB national GeoJSON).
    if (page.atlasNationalCountyFeatures?.length) return page.atlasNationalCountyFeatures;
    const assets = page.mapAssets?.counties || {};
    const entries = Object.entries(assets);
    const features = [];
    const concurrency = 8;
    let cursor = 0;
    async function worker() {
      while (cursor < entries.length) {
        if (revision !== page.mapRevision) return;
        const [, path] = entries[cursor++];
        const geo = await page.safeJson?.(path);
        const batch = geo?.type === "Topology"
          ? (typeof topojson !== "undefined"
            ? topojson.feature(geo, geo.objects.counties || Object.values(geo.objects || {})[0]).features
            : [])
          : (geo?.features || []);
        if (batch.length) {
          features.push(...batch);
          onBatch?.(features);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length || 1) }, () => worker()));
    if (revision === page.mapRevision) page.atlasNationalCountyFeatures = features;
    return features;
  }

  function updateLensChrome(page) {
    const house = page.selectedMode === "house";
    document.querySelectorAll(".atlas-lens [data-atlas-lens]").forEach((button) => {
      const lens = button.dataset.atlasLens;
      button.hidden = (lens === "pv" || lens === "county") && !house;
      const on = page.atlasLens === lens && !button.hidden;
      button.setAttribute("aria-pressed", String(on));
      button.setAttribute("aria-selected", String(on));
    });
    const note = document.getElementById("atlas-lens-note");
    if (note) {
      note.textContent = house
        ? (NOTES[page.atlasLens] || NOTES.districts)
        : "State map for this chamber. Open a race for local detail. Pop. weighted and Swing stay available.";
    }
    document.body.dataset.atlasActiveLens = page.atlasLens;
  }

  async function restoreRaceDetail(page, race, county) {
    if (!race) return;
    page.detailMapActive = false;
    page._atlasRestoringDetail = true;
    try {
      await page.selectRace(race, null);
      if (county && page.lockCounty) page.lockCounty(county);
    } finally {
      page._atlasRestoringDetail = false;
    }
  }

  async function applyLens(page, lens) {
    const keepRace = page.currentRace;
    const keepCounty = page.lockedCounty;
    const priorLens = page.atlasLens;
    page.atlasLens = lens;
    try { localStorage.setItem("feaAtlasLens", lens); } catch {}
    if (lens === "swing") {
      if (page.comparisonMode === "live") setAtlasComparison(page, "pres-2024");
    } else {
      setAtlasComparison(page, "live");
    }
    updateLensChrome(page);

    // Leaving PV/County without an explicit state target clears drill-down.
    // Staying on PV/County (or opening them from a race) keeps / sets atlasPvState.
    if (lens !== "pv" && lens !== "county") {
      page.atlasPvState = null;
    } else if (keepRace?.state) {
      page.atlasPvState = keepRace.state;
    } else if (priorLens !== lens) {
      page.atlasPvState = null;
    }

    if (keepRace && lens === "bubbles") {
      await renderAtlasCountyBubbles(page, keepRace);
      return;
    }
    if (keepRace && (lens === "county" || lens === "pv")) {
      page.mapRevision = (page.mapRevision || 0) + 1;
      await renderAtlasStateCountyMap(page, keepRace.state, page.mapRevision, lens === "pv");
      page.renderFocusedRace?.(keepRace);
      return;
    }
    if (keepRace && (lens === "districts" || lens === "swing")) {
      await restoreRaceDetail(page, keepRace, keepCounty);
      return;
    }
    await page.renderMap();
  }

  function bindLensControls(page) {
    document.querySelectorAll(".atlas-lens [data-atlas-lens]").forEach((button) => {
      button.addEventListener("click", async () => {
        const lens = button.dataset.atlasLens;
        if (!lens || button.hidden) return;
        // Toggle off → return to default district map.
        const next = lens === page.atlasLens ? "districts" : lens;
        await applyLens(page, next);
      });
    });
    updateLensChrome(page);
  }

  function sizeAtlasPanel(page) {
    const panel = document.getElementById("focused-race-panel");
    if (!panel || innerWidth <= 600 || page._atlasPanelSized) return;
    page._atlasPanelSized = true;
    let saved = null;
    let trimmed = false;
    try {
      saved = JSON.parse(localStorage.getItem("feaRacePanelSize") || "null");
      trimmed = localStorage.getItem("feaAtlasPanelTrimmed") === "1";
    } catch {}
    const tooSmall = !saved || (Array.isArray(saved) && Number(saved[0]) < 360);
    const tooBigFromPriorDefault = !trimmed && Array.isArray(saved) && Number(saved[0]) >= 500;
    if (tooSmall || tooBigFromPriorDefault) {
      page.setPanelSize?.(Math.min(440, innerWidth - 48), Math.min(560, Math.max(420, innerHeight - 180)));
      try { localStorage.setItem("feaAtlasPanelTrimmed", "1"); } catch {}
    }
  }

  async function renderAtlasHousePv(page, container, revision) {
    page.detailMapActive = false;
    const [stateFeatures, highwayFeatures] = await Promise.all([
      page.loadResultStateFeatures(),
      page.loadHighwayFeatures?.() || []
    ]);
    if (revision !== page.mapRevision || page.selectedMode !== "house") return;
    const cleanStates = sanitizeStateFeatures(stateFeatures);
    page.stateFeatures = cleanStates;
    const popular = housePopularByState(page.modeRaces());
    const tokens = window.FEADeskTheme?.resolved?.tokens || {};
    const { width, height } = page.mapDimensions();
    const geo = { type: "FeatureCollection", features: cleanStates };
    const projection = FEANight.fitRenderedGeometry(d3.geoAlbersUsa(), page.mapExtent(width, height), geo);
    const path = typeof projectedFeaturePath === "function"
      ? (feature) => projectedFeaturePath(feature, projection)
      : d3.geoPath(projection);
    page.path = d3.geoPath(projection);
    page.createSvg(container, width, height);
    page.drawMapContext?.(projection, { highways: highwayFeatures, raceStates: new Set(page.modeRaces().map((race) => race.state)) });

    page.viewport.selectAll(".atlas-state-shape")
      .data(cleanStates)
      .join("path")
      .attr("class", "atlas-state-shape election-map-shape")
      .attr("d", (feature) => path(feature))
      .attr("fill", (feature) => {
        const stats = leanForRow(popular.get(stateCodeFromFeature(feature)));
        return stateFill(stats.lean, tokens, stats.margin);
      })
      .attr("tabindex", 0)
      .on("mousemove", (event, feature) => {
        const state = stateCodeFromFeature(feature);
        const stats = leanForRow(popular.get(state));
        page.showTooltip?.(event, leanTooltip(STATE_NAMES[state] || state, stats, "House PV"));
      })
      .on("mouseleave blur", () => page.hideTooltip?.())
      .on("click keydown", async (event, feature) => {
        if (event.type === "keydown" && event.key !== "Enter") return;
        const state = stateCodeFromFeature(feature);
        page.atlasPvState = state;
        page.mapRevision = (page.mapRevision || 0) + 1;
        await renderAtlasStateCountyMap(page, state, page.mapRevision, true);
      });

    page.addZoomControls();
  }

  async function renderAtlasCountyChoropleth(page, container, revision, stateFilter = null) {
    page.detailMapActive = Boolean(stateFilter);
    const tokens = window.FEADeskTheme?.resolved?.tokens || {};
    const { width, height } = page.mapDimensions();
    const stateFeatures = sanitizeStateFeatures(await page.loadResultStateFeatures());
    if (revision !== page.mapRevision) return;

    // Fit to states first so the national view paints immediately while county packs stream in.
    const fitFeatures = stateFilter
      ? stateFeatures.filter((feature) => stateCodeFromFeature(feature) === stateFilter)
      : stateFeatures;
    const projection = FEANight.fitRenderedGeometry(
      d3.geoAlbersUsa(),
      stateFilter ? [[34, 34], [width - 34, height - 34]] : page.mapExtent(width, height),
      { type: "FeatureCollection", features: fitFeatures.length ? fitFeatures : stateFeatures }
    );
    page.path = d3.geoPath(projection);
    page.createSvg(container, width, height);

    if (stateFilter) {
      page.drawMapContext?.(projection, {
        highways: page.highwayFeatures || [],
        state: stateFilter,
        detail: true,
        raceStates: new Set(page.modeRaces().map((race) => race.state))
      });
      page.viewport.append("g")
        .attr("class", "election-map-context-layer")
        .selectAll(".map-context-shape")
        .data(stateFeatures)
        .join("path")
        .attr("class", (feature) => {
          const selected = stateCodeFromFeature(feature) === stateFilter;
          return `map-context-shape ${selected ? "is-selected-context is-focused-geography" : "is-dimmed-context"}`;
        })
        .attr("d", (feature) => projectedFeaturePath(feature, projection))
        .attr("fill", "#1a2840")
        .attr("stroke", "rgba(226, 232, 255, .45)")
        .attr("stroke-width", 0.38)
        .attr("pointer-events", "none");
    } else {
      page.drawMapContext?.(projection, {
        highways: await page.loadHighwayFeatures?.() || [],
        raceStates: new Set(page.modeRaces().map((race) => race.state))
      });
      page.viewport.append("g")
        .attr("class", "election-map-context-layer")
        .selectAll(".map-context-shape")
        .data(stateFeatures)
        .join("path")
        .attr("class", "map-context-shape is-dimmed-context")
        .attr("d", (feature) => projectedFeaturePath(feature, projection))
        .attr("fill", tokens["map-neutral"] || "#1a2840")
        .attr("stroke", "rgba(226,232,255,.28)")
        .attr("stroke-width", 0.45)
        .attr("pointer-events", "none");
    }

    const fipsOf = (feature) => {
      if (typeof featureCountyFipsForElectionNight === "function") return featureCountyFipsForElectionNight(feature);
      return String(feature.id || feature.properties?.GEOID || "").padStart(5, "0");
    };

    let totals = page.houseCountyAggregateState === (stateFilter || "*")
      ? (page.houseCountyAggregate || new Map())
      : new Map();
    let features = [];

    const paintFills = (map) => {
      totals = map || totals;
      page.viewport?.selectAll(".county-result-shape")
        .attr("fill", (feature) => {
          const stats = leanForRow(totals.get(fipsOf(feature)));
          return stateFill(stats.lean, tokens, stats.margin);
        });
    };

    const paintShapes = (nextFeatures) => {
      features = nextFeatures;
      page.visibleCountyFeatures = features;
      page.viewport.selectAll(".county-result-shape")
        .data(features, (feature) => fipsOf(feature))
        .join("path")
        .attr("class", "county-result-shape election-map-shape")
        .attr("d", (feature) => projectedFeaturePath(feature, projection))
        .attr("fill", (feature) => {
          const stats = leanForRow(totals.get(fipsOf(feature)));
          return stateFill(stats.lean, tokens, stats.margin);
        })
        .attr("stroke", "rgba(226,232,255,.55)")
        .attr("stroke-width", 0.35)
        .attr("tabindex", 0)
        .on("mousemove", (event, feature) => {
          const row = totals.get(fipsOf(feature));
          const stats = leanForRow(row);
          const name = row?.name || feature.properties?.NAME || feature.properties?.countyName || fipsOf(feature);
          page.showTooltip?.(event, leanTooltip(name, stats, "County House total"));
        })
        .on("mouseleave blur", () => page.hideTooltip?.());
    };

    page.addZoomControls();
    updateLensChrome(page);

    // Votes and geometry load in parallel; geometry streams state-by-state nationally.
    const hydratePromise = hydrateHouseCountyTotals(page, stateFilter, {
      onProgress: (map) => {
        if (revision !== page.mapRevision) return;
        paintFills(map);
      }
    });

    const geometryPromise = loadAtlasCountyFeatures(page, stateFilter, revision, (batch) => {
      if (revision !== page.mapRevision) return;
      paintShapes(batch.slice());
    });

    const [hydrated, loadedFeatures] = await Promise.all([hydratePromise, geometryPromise]);
    if (revision !== page.mapRevision) return;
    if (loadedFeatures?.length) paintShapes(loadedFeatures);
    paintFills(hydrated);
  }

  async function renderAtlasStateCountyMap(page, state, revision, fromPv = false) {
    const container = document.getElementById("election-map");
    if (!container || !state) return;
    page.atlasPvState = state;
    // Drop only a mismatched cache — do not clobber an in-flight hydrate for this state.
    if (page.houseCountyAggregateState !== state) {
      page.houseCountyAggregate = null;
      page.houseCountyAggregateState = null;
    }
    await renderAtlasCountyChoropleth(page, container, revision, state);
    if (fromPv) {
      const note = document.getElementById("atlas-lens-note");
      if (note) {
        note.textContent = `${STATE_NAMES[state] || state} county House totals — Reset or toggle County/House PV off to leave this view.`;
      }
    }
  }

  async function renderAtlasBubbles(page, container, revision) {
    page.detailMapActive = false;
    const [stateFeatures, highwayFeatures] = await Promise.all([
      page.loadResultStateFeatures(),
      page.loadHighwayFeatures?.() || []
    ]);
    if (revision !== page.mapRevision) return;
    const cleanStates = sanitizeStateFeatures(stateFeatures);
    const popular = page.selectedMode === "house"
      ? housePopularByState(page.modeRaces())
      : (() => {
          const map = new Map();
          for (const race of page.modeRaces()) {
            const row = map.get(race.state) || { D: 0, R: 0, other: 0 };
            for (const candidate of race.candidates || []) {
              if (!Number.isSafeInteger(candidate.votes) || candidate.votes < 0) continue;
              const code = party(candidate);
              row[code === "D" || code === "R" ? code : "other"] += candidate.votes;
            }
            map.set(race.state, row);
          }
          return map;
        })();
    const tokens = window.FEADeskTheme?.resolved?.tokens || {};
    const { width, height } = page.mapDimensions();
    const projection = FEANight.fitRenderedGeometry(
      d3.geoAlbersUsa(),
      page.mapExtent(width, height),
      { type: "FeatureCollection", features: cleanStates }
    );
    page.path = d3.geoPath(projection);
    page.createSvg(container, width, height);
    page.drawMapContext?.(projection, { highways: highwayFeatures, raceStates: new Set(page.modeRaces().map((race) => race.state)) });

    page.viewport.append("g")
      .attr("class", "election-map-context-layer")
      .selectAll(".map-context-shape")
      .data(cleanStates)
      .join("path")
      .attr("class", "map-context-shape is-dimmed-context")
      .attr("d", (feature) => projectedFeaturePath(feature, projection))
      .attr("fill", tokens["map-neutral"] || "#1a2840")
      .attr("stroke", "rgba(226,232,255,.35)")
      .attr("stroke-width", 0.5)
      .attr("pointer-events", "none");

    const maxVotes = Math.max(1, ...[...popular.values()].map((row) => leanForRow(row).total));
    const radius = d3.scaleSqrt().domain([0, maxVotes]).range([4, 42]);
    const bubbles = cleanStates.map((feature) => {
      const state = stateCodeFromFeature(feature);
      const centroid = projection(d3.geoCentroid(feature));
      const stats = leanForRow(popular.get(state));
      return { state, centroid, stats };
    }).filter((row) => row.centroid && Number.isFinite(row.centroid[0]) && row.stats.total > 0);

    page.viewport.selectAll(".atlas-bubble")
      .data(bubbles)
      .join("circle")
      .attr("class", "atlas-bubble")
      .attr("cx", (d) => d.centroid[0])
      .attr("cy", (d) => d.centroid[1])
      .attr("r", (d) => radius(d.stats.total))
      .attr("fill", (d) => stateFill(d.stats.lean, tokens, d.stats.margin))
      .attr("tabindex", 0)
      .on("mousemove", (event, d) => {
        page.showTooltip?.(event, leanTooltip(STATE_NAMES[d.state] || d.state, d.stats, "Pop. weighted"));
      })
      .on("mouseleave blur", () => page.hideTooltip?.())
      .on("click keydown", (event, d) => {
        if (event.type === "keydown" && event.key !== "Enter") return;
        const race = page.modeRaces().find((item) => item.state === d.state);
        if (race) page.selectRace(race, null);
      });

    page.addZoomControls();
  }

  async function renderAtlasCountyBubbles(page, race) {
    // Reuse the normal detail map so context / background match Districts.
    // selectRace remounts the map and bumps mapRevision — do not bail on the old revision.
    await restoreRaceDetail(page, race, page.lockedCounty);
    if (!page.currentRace || page.currentRace.id !== race.id || page.atlasLens !== "bubbles") return;
    if (page.findLiveDetailForRace) await page.findLiveDetailForRace(race);
    if (!page.currentRace || page.currentRace.id !== race.id || page.atlasLens !== "bubbles") return;

    const detail = page.panelData?.(race) || race;
    const lookup = typeof countyLookupForElectionNight === "function"
      ? countyLookupForElectionNight(detail)
      : new Map((detail.counties || []).map((county) => [county.fips, county]));
    const tokens = window.FEADeskTheme?.resolved?.tokens || {};

    page.viewport.selectAll(".county-result-shape")
      .attr("fill-opacity", 0.42)
      .attr("stroke-opacity", 0.7);

    const rows = [];
    page.viewport.selectAll(".county-result-shape").each(function (feature) {
      try {
        const box = this.getBBox();
        if (!(box.width > 0 && box.height > 0)) return;
        const county = typeof countyForFeature === "function"
          ? countyForFeature(feature, lookup)
          : lookup.get(typeof featureCountyFipsForElectionNight === "function"
            ? featureCountyFipsForElectionNight(feature)
            : feature?.id);
        const stats = leanForRow(countyVoteRow(county));
        rows.push({
          feature,
          county,
          stats,
          centroid: [box.x + box.width / 2, box.y + box.height / 2]
        });
      } catch {}
    });

    const maxVotes = Math.max(1, ...rows.map((row) => row.stats.total || 1));
    const radius = d3.scaleSqrt().domain([0, maxVotes]).range([5, 48]);
    page.viewport.selectAll(".atlas-bubble").remove();
    page.viewport.append("g")
      .attr("class", "atlas-bubble-layer")
      .selectAll(".atlas-bubble")
      .data(rows.filter((row) => row.stats.total > 0 || rows.every((item) => item.stats.total <= 0)))
      .join("circle")
      .attr("class", "atlas-bubble")
      .attr("cx", (d) => d.centroid[0])
      .attr("cy", (d) => d.centroid[1])
      .attr("r", (d) => radius(Math.max(d.stats.total, 1)))
      .attr("fill", (d) => stateFill(d.stats.lean === "open" ? "split" : d.stats.lean, tokens, d.stats.margin))
      .attr("tabindex", 0)
      .on("mousemove", (event, d) => {
        const name = d.county?.name || d.feature?.properties?.countyName || d.feature?.properties?.NAME || "Area";
        page.showTooltip?.(event, leanTooltip(name, d.stats, "Local total"));
      })
      .on("mouseleave blur", () => page.hideTooltip?.())
      .on("click keydown", (event, d) => {
        if (event.type === "keydown" && event.key !== "Enter") return;
        if (d.county?.fips && page.lockCounty) page.lockCounty(d.county.fips);
      });

    page.addZoomControls();
    page.renderFocusedRace?.(race);
    sizeAtlasPanel(page);
  }

  function drawSwingArrows(page, raceByDistrict, projection) {
    const arrows = (page.geo?.features || []).map((feature) => {
      const race = raceByDistrict.get(feature.properties?.id);
      if (!race || !page.isComparisonActive?.()) return null;
      const shift = page.comparisonRaceShift?.(race);
      if (!Number.isFinite(shift) || Math.abs(shift) < 0.25) return null;
      const centroid = projection(d3.geoCentroid(feature));
      if (!centroid || !Number.isFinite(centroid[0])) return null;
      const partyCode = shift > 0 ? "D" : "R";
      const length = Math.min(18, 6 + Math.abs(shift) * 0.9);
      const dir = shift > 0 ? -1 : 1;
      return {
        id: feature.properties?.id,
        party: partyCode,
        x1: centroid[0] - dir * length * 0.15,
        y1: centroid[1],
        x2: centroid[0] + dir * length,
        y2: centroid[1]
      };
    }).filter(Boolean);

    const layer = page.viewport.append("g").attr("class", "atlas-swing-layer");
    layer.selectAll(".atlas-swing-arrow")
      .data(arrows)
      .join("path")
      .attr("class", "atlas-swing-arrow")
      .attr("data-party", (d) => d.party)
      .attr("marker-end", (d) => `url(#atlas-arrow-${d.party})`)
      .attr("d", (d) => `M${d.x1},${d.y1} L${d.x2},${d.y2}`);

    const defs = page.svg.append("defs");
    for (const code of ["D", "R"]) {
      defs.append("marker")
        .attr("id", `atlas-arrow-${code}`)
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 8)
        .attr("refY", 5)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,0 L10,5 L0,10 z")
        .attr("fill", code === "D" ? "#3a7bd5" : "#c94352");
    }
  }

  window.FEAAtlasPrepare = function (Page) {
    const proto = Page.prototype;
    const originalRenderHouseMap = proto.renderHouseMap;
    const originalRenderMap = proto.renderMap;
    const originalAddZoomControls = proto.addZoomControls;
    const originalInit = proto.init;
    const originalSwitchMode = proto.switchMode;
    const originalUpdateModeButtons = proto.updateModeButtons;
    const originalSelectRace = proto.selectRace;
    const originalRenderFocusedRace = proto.renderFocusedRace;
    const originalRefreshResults = proto.refreshResults;

    proto.init = async function () {
      this.isAtlasPage = true;
      this.atlasLens = "districts";
      try {
        this.atlasLens = migrateLens(localStorage.getItem("feaAtlasLens"));
      } catch {}
      this.outlineRaceIds = new Set();
      this.selectedMode = "house";
      try { localStorage.setItem("electionNightMode", "house"); } catch {}
      if (this.atlasLens === "swing") {
        if (this.comparisonMode === "live") setAtlasComparison(this, "pres-2024");
      } else {
        setAtlasComparison(this, "live");
      }
      this.appearance = typeof FEAAppearance === "function" ? FEAAppearance() : null;
      await originalInit.call(this);
      updateLensChrome(this);
    };

    proto.switchMode = async function (mode) {
      await originalSwitchMode.call(this, mode);
      if (this.selectedMode !== "house" && (this.atlasLens === "pv" || this.atlasLens === "county")) {
        this.atlasLens = "districts";
        try { localStorage.setItem("feaAtlasLens", this.atlasLens); } catch {}
        this.atlasPvState = null;
      }
      invalidateHouseCountyAggregate(this);
      updateLensChrome(this);
    };

    proto.refreshResults = async function (...args) {
      invalidateHouseCountyAggregate(this);
      const result = await originalRefreshResults.apply(this, args);
      if (this.selectedMode !== "house") return result;
      if (this.atlasLens === "county" || this.atlasLens === "pv") {
        // refreshResults may have remounted a race detail map via selectRace —
        // restore the choropleth so live updates don't stick on stale fills.
        this.mapRevision = (this.mapRevision || 0) + 1;
        const state = this.atlasPvState || this.currentRace?.state || null;
        if (state) await renderAtlasStateCountyMap(this, state, this.mapRevision, this.atlasLens === "pv");
        else await this.renderMap();
      } else if (this.atlasLens === "bubbles" && this.currentRace) {
        await renderAtlasCountyBubbles(this, this.currentRace);
      }
      return result;
    };

    proto.updateModeButtons = function () {
      originalUpdateModeButtons.call(this);
      updateLensChrome(this);
    };

    proto.selectRace = async function (race, feature, options) {
      const result = await originalSelectRace.call(this, race, feature, options);
      sizeAtlasPanel(this);
      if (this._atlasRestoringDetail) return result;
      if (this.selectedMode === "house" && race && (this.atlasLens === "county" || this.atlasLens === "pv")) {
        this.atlasPvState = race.state;
        this.mapRevision = (this.mapRevision || 0) + 1;
        await renderAtlasStateCountyMap(this, race.state, this.mapRevision, this.atlasLens === "pv");
        this.renderFocusedRace?.(race);
      } else if (this.selectedMode === "house" && race && this.atlasLens === "bubbles") {
        await renderAtlasCountyBubbles(this, race);
      }
      return result;
    };

    proto.renderFocusedRace = function (race) {
      originalRenderFocusedRace.call(this, race);
      sizeAtlasPanel(this);
      const advanced = document.querySelector("#focused-race-content .desk-advanced");
      if (advanced) advanced.open = true;
    };

    proto.renderMap = async function () {
      if (this.selectedMode === "house" && this.atlasLens === "county") {
        const container = document.getElementById("election-map");
        const revision = ++this.mapRevision;
        container.innerHTML = `<div class="election-map-loading">Loading county House totals…</div>`;
        return renderAtlasCountyChoropleth(this, container, revision, null);
      }
      if (this.selectedMode === "house" && this.atlasLens === "pv") {
        const container = document.getElementById("election-map");
        const revision = ++this.mapRevision;
        if (this.atlasPvState) {
          return renderAtlasStateCountyMap(this, this.atlasPvState, revision, true);
        }
        container.innerHTML = `<div class="election-map-loading">Loading House popular vote…</div>`;
        return renderAtlasHousePv(this, container, revision);
      }
      return originalRenderMap.call(this);
    };

    proto.renderHouseMap = async function (container, revision = this.mapRevision) {
      if (this.selectedMode !== "house") {
        return originalRenderHouseMap.call(this, container, revision);
      }
      if (this.atlasLens === "pv") {
        if (this.atlasPvState) return renderAtlasStateCountyMap(this, this.atlasPvState, revision, true);
        return renderAtlasHousePv(this, container, revision);
      }
      if (this.atlasLens === "county") {
        return renderAtlasCountyChoropleth(this, container, revision, null);
      }
      if (this.atlasLens === "bubbles") {
        if (this.currentRace) return renderAtlasCountyBubbles(this, this.currentRace);
        return renderAtlasBubbles(this, container, revision);
      }
      if (this.atlasLens === "swing") {
        if (this.comparisonMode === "live") setAtlasComparison(this, "pres-2024");
        if (this.currentRace) {
          await restoreRaceDetail(this, this.currentRace, this.lockedCounty);
          return;
        }
        await originalRenderHouseMap.call(this, container, revision);
        if (revision !== this.mapRevision) return;
        const raceByDistrict = new Map(this.modeRaces().map((race) => [houseGeometryId(race), race]));
        const { width, height } = this.mapDimensions();
        const projection = FEANight.fitRenderedGeometry(
          d3.geoAlbersUsa(),
          this.mapExtent(width, height),
          this.geo
        );
        drawSwingArrows(this, raceByDistrict, projection);
        return;
      }
      // Default: districts
      if (this.currentRace) {
        await restoreRaceDetail(this, this.currentRace, this.lockedCounty);
        return;
      }
      await originalRenderHouseMap.call(this, container, revision);
      this.viewport?.selectAll(".house-district-shape")
        .attr("stroke-width", 0.55)
        .attr("stroke", "rgba(226, 232, 255, .35)");
    };

    proto.addZoomControls = function () {
      originalAddZoomControls.call(this);
      const watch = document.querySelector(".board-watch-select");
      if (watch) watch.hidden = true;
      const label = document.querySelector(".election-comparison-control");
      if (label) label.hidden = this.atlasLens !== "swing" || this.detailMapActive;
    };
  };

  window.FEAAtlasBoot = function (page) {
    window.__feaAtlasPage = page;
    bindLensControls(page);
    updateLensChrome(page);
    page.updateModeButtons?.();
    document.querySelector("[data-desk-appearance]")?.addEventListener("click", () => {
      const menu = document.getElementById("board-menu");
      const button = document.getElementById("board-menu-button");
      if (menu) menu.hidden = true;
      button?.setAttribute("aria-expanded", "false");
      page.appearance?.open?.();
    });
    document.addEventListener("fea-desk-theme", () => {
      if (!page.dataByMode) return;
      page.updateMapFills?.(
        new Set(Object.values(page.dataByMode).flat().map((race) => race.id))
      );
      page.renderSummary?.();
      if (page.currentRace) page.renderFocusedRace?.(page.currentRace);
      page.renderMap?.().catch(() => {});
    });
  };
})();
