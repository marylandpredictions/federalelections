/* Dashboard extensions reuse the existing map, race-detail and resize systems. */
window.FEAEnhanceBoard = function (Page) {
  const p = Page.prototype,
    original = {
      init: p.init,
      loadData: p.loadData,
      selectRace: p.selectRace,
      bindEvents: p.bindEvents,
      renderCounty: p.renderCountyDetailMap,
      seedLabDetail: p.seedLabDetail,
      comparisonColorForRace: p.comparisonColorForRace,
      comparisonColorForCounty: p.comparisonColorForCounty,
      addZoomControls: p.addZoomControls,
    };
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const fmt = (value) =>
    value === null || value === undefined
      ? "—"
      : Number(value).toLocaleString("en-US");
  const percent = (value) =>
    value === null || value === undefined
      ? "—"
      : `${Number(value).toFixed(1)}%`;
  const signed = (value) =>
    value === null || !Number.isFinite(value)
      ? "—"
      : `${value >= 0 ? "D" : "R"} +${Math.abs(value).toFixed(1)}`;
  const title = (race) =>
    FEAResultsUI.raceLabel({ ...race, stateName: STATE_NAMES[race.state] });
  const party = (c) => c?.partyCode || c?.party || "";
  const color = (c) =>
    party(c) === "D" ? "#2785ed" : party(c) === "R" ? "#e74757" : "#9a78d7";
  const time = (value) =>
    value && Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "numeric",
          minute: "2-digit",
        }) + " ET"
      : "";
  const projectionSource = (call) =>
    call?.provider === "NBC" || /^nbc-/.test(call?.source || "")
      ? "NBC"
      : "FEA";
  p.init = async function () {
    this.events = new EventTarget();
    this.callTracker = new FEADesk.CallTracker(sessionStorage);
    this.countyGeometries = new Map();
    this.lockedCounty = null;
    this.alertQueue = [];
    this.chartMode = "total";
    this.events.addEventListener("call-change", (event) => {
      this.queueProjection(event.detail);
      this.pulseRace(event.detail.race);
    });
    await original.init.call(this);
    this.initLabDesk();
    new ResizeObserver(() => {
      this.positionDeskControls();
      if (this.focusedPanelTab === "trends") this.renderTrendChart();
    }).observe(document.getElementById("focused-race-panel"));
    new MutationObserver(() => {
      this.updateMapFills(new Set(this.modeRaces().map((r) => r.id)));
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  };
  p.loadData = async function () {
    // Manifest is small; heavy resources stay lazy.
    const [assets, live, watchlist, comparisons] = await Promise.all([
      this.safeJson("data/results/map-assets.json"),
      this.safeJson("/api/live-results"),
      this.safeJson("data/election-night-watchlist.json"),
      this.safeJson("data/result-comparison-baselines.json"),
    ]);
    this.mapAssets = assets;
    this.resultsVersion = live?.version || null;
    this.liveRaceIndex = (live?.groups || []).flatMap(
      (group) => group.races || [],
    );
    const catalogue = this.liveRaceIndex.length
      ? this.liveRaceIndex
      : (await this.safeJson("data/election-night-races.json"))?.races || [];
    const races = catalogue.map((race) => normalizeElectionRace(race));
    this.watchlist = FEAResultsUI.watchMetadata(watchlist, races);
    for (const race of races) race.watch = this.watchlist.get(race.id);
    for (const mode of ["house", "senate", "governor"])
      this.dataByMode[mode] = races.filter((r) => r.type === mode);
    this.analysisNotes = {};
    this.countyDescriptions = new Map();
    this.comparisonManifest = comparisons || { sources: [] };
    await Promise.all(
      this.comparisonManifest.sources
        .filter((s) => s.status === "available")
        .flatMap((source) =>
          ["state", "district"].map((kind) =>
            this.loadComparisonDataset(kind, source),
          ),
        ),
    );
    this.normalizeComparisonModeForCurrentMap();
    this.applyLabMode();
    this.publicProvider = live?.provider;
    this.renderProviderStatus(live?.provider);
    this.callTracker.observe(this.liveRaceIndex);
  };
  p.bindEvents = function () {
    original.bindEvents.call(this);
    this.bindFocusPanelResize();
    const grip = document.querySelector(".focus-resize-handle");
    grip?.addEventListener("pointerup", () => this.savePanelSize());
    grip?.addEventListener("dblclick", () => this.resetPanelSize());
    grip?.addEventListener("keydown", (event) => {
      if (event.key === "Home") {
        this.resetPanelSize();
        return;
      }
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      event.preventDefault();
      const panel = document.getElementById("focused-race-panel"),
        rect = panel.getBoundingClientRect();
      this.setPanelSize(
        rect.width +
          (event.key === "ArrowRight"
            ? 24
            : event.key === "ArrowLeft"
              ? -24
              : 0),
        rect.height +
          (event.key === "ArrowDown" ? 24 : event.key === "ArrowUp" ? -24 : 0),
      );
      this.savePanelSize();
    });
    document
      .getElementById("focused-race-content")
      ?.addEventListener("click", (event) => {
        const tab = event.target.closest("[data-panel-tab]");
        if (tab) {
          this.focusedPanelTab = tab.dataset.panelTab;
          this.renderFocusedRace(this.currentRace);
          document
            .querySelector(`[data-panel-tab="${this.focusedPanelTab}"]`)
            ?.focus();
        }
        const county = event.target.closest("[data-county-fips]");
        if (county) this.lockCounty(county.dataset.countyFips);
        if (event.target.closest("[data-unlock-county]")) this.lockCounty(null);
      });
    document
      .getElementById("focused-race-content")
      ?.addEventListener("change", (event) => {
        if (event.target.matches("[data-trend-mode]")) {
          this.chartMode = event.target.value;
          this.renderTrendChart();
        }
      });
    document
      .getElementById("focused-race-content")
      ?.addEventListener("keydown", (event) => {
        if (
          !event.target.matches("[data-panel-tab]") ||
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
        )
          return;
        event.preventDefault();
        const tabs = [
            ...event.target.parentElement.querySelectorAll("[data-panel-tab]"),
          ],
          index = tabs.indexOf(event.target);
        tabs[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                tabs.length
        ].click();
      });
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "/" &&
          !event.target.closest("input,textarea,select,[contenteditable]")
        ) {
          event.preventDefault();
          if (
            innerWidth <= 600 &&
            document
              .getElementById("focused-race-panel")
              .classList.contains("is-expanded")
          )
            document.querySelector(".sheet-toggle")?.click();
          document.querySelector(".election-map-search")?.focus();
        }
        if (event.key === "Escape" && this.lockedCounty && document.getElementById("board-menu")?.hidden !== false) {
          event.stopImmediatePropagation();
          this.lockCounty(null);
        }
      },
      true,
    );
    document.querySelector(".sheet-toggle")?.addEventListener("click", () => {
      document
        .querySelector(".election-night-page")
        ?.classList.toggle(
          "sheet-expanded",
          document
            .getElementById("focused-race-panel")
            .classList.contains("is-expanded"),
        );
      this.renderProjectionQueue();
    });
  };
  p.preloadLikelyDetailAssets = function () {}; // Deliberately lazy, including watched races.
  p.comparisonColorForRace = function (race) {
    if (!this.isComparisonActive() && !FEADesk.total(race))
      return getComputedStyle(document.body)
        .getPropertyValue("--map-neutral")
        .trim();
    return original.comparisonColorForRace.call(this, race);
  };
  p.comparisonColorForCounty = function (feature, race, lookup) {
    if (
      !this.isComparisonActive() &&
      !FEADesk.total(countyForFeature(feature, lookup))
    )
      return getComputedStyle(document.body)
        .getPropertyValue("--map-neutral")
        .trim();
    return original.comparisonColorForCounty.call(this, feature, race, lookup);
  };
  p.loadResultStateFeatures = async function () {
    if (!this.resultStateFeatures)
      this.resultStateFeatures =
        (
          await this.safeJson(
            this.mapAssets?.states || "data/result-us-states.geojson",
          )
        )?.features || [];
    return this.resultStateFeatures;
  };
  p.loadHouseFeatures = async function () {
    if (!this.houseFeatures) {
      const geo = await this.safeJson(
        this.mapAssets?.house || "data/house-districts-119.geojson",
      );
      this.houseFeatures =
        geo?.type === "Topology"
          ? topojson.feature(geo, geo.objects.districts).features
          : geo?.features || [];
    }
    return this.houseFeatures;
  };
  p.loadHighwayFeatures = async function () {
    if (!this.highwayFeatures)
      this.highwayFeatures =
        (
          await this.safeJson(
            this.mapAssets?.highways || "data/result-major-highways.geojson",
          )
        )?.features || [];
    return this.highwayFeatures;
  };
  p.loadCountyFeatures = async function (state) {
    const fips = stateFipsForElectionNight(state || this.currentRace?.state);
    if (!fips) return [];
    if (!this.countyGeometries.has(fips)) {
      const file = this.mapAssets?.counties?.[fips];
      this.countyGeometries.set(
        fips,
        file ? (await this.safeJson(file))?.features || [] : [],
      );
    }
    return this.countyGeometries.get(fips);
  };
  p.safeJson = async function (url) {
    try {
      const isApi = url.startsWith("/api/");
      const response = await fetch(url, {
        cache: isApi ? "no-cache" : "default",
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  p.refreshResults = async function () {
    if (this.refreshBusy) return;
    this.refreshBusy = true;
    try {
      const check = await fetch("/api/results-version", {
        cache: "no-cache",
        headers: this.resultsVersion
          ? { "If-None-Match": `"${this.resultsVersion}"` }
          : {},
      });
      if (check.status === 304) {
        await this.retrySelectedDetail();
        return;
      }
      if (!check.ok) throw Error("Feed delayed");
      const metadata = await check.json();
      if (metadata.version === this.resultsVersion) {
        await this.retrySelectedDetail();
        return;
      }
      let changes = this.resultsVersion
        ? await this.safeJson(
            `/api/live-results/changes?since=${encodeURIComponent(this.resultsVersion)}`,
          )
        : null;
      if (!changes || changes.reset) {
        const full = await this.safeJson("/api/live-results");
        if (!full?.groups) throw Error("Snapshot unavailable");
        changes = { ...full, races: full.groups.flatMap((g) => g.races) };
      }
      if (!changes.version) throw Error("Invalid result version");
      const changed = new Set(changes.races.map((r) => r.id));
      const previousSelected = this.currentRace
        ? this.liveRaceDetails.get(this.currentRace.id)
        : null;
      for (const id of changed)
        if (id !== this.currentRace?.id) this.liveRaceDetails.delete(id);
      const index = new Map(this.liveRaceIndex.map((r) => [r.id, r]));
      for (const race of changes.races) index.set(race.id, race);
      for (const id of changes.removedRaceIds || []) index.delete(id);
      this.liveRaceIndex = [...index.values()];
      this.resultsVersion = changes.version;
      const existing = new Map(
        Object.values(this.dataByMode)
          .flat()
          .map((r) => [r.id, r]),
      );
      const structural =
        this.liveRaceIndex.some((r) => !existing.has(r.id)) ||
        [...existing.keys()].some((id) => !index.has(id));
      for (const mode of ["house", "senate", "governor"])
        this.dataByMode[mode] = this.liveRaceIndex
          .filter((r) => r.type === mode)
          .map((raw) => {
            const race = existing.get(raw.id) || normalizeElectionRace(raw);
            if (changed.has(raw.id))
              Object.assign(race, normalizeElectionRace(raw), {
                watch: this.watchlist.get(raw.id),
              });
            return race;
          });
      const events = this.callTracker.observe(this.liveRaceIndex);
      if (changes.provider) {
        this.publicProvider = changes.provider;
        this.renderProviderStatus(changes.provider);
      }
      if (changed.size) {
        this.renderSummary();
        if (!this.detailMapActive) this.updateMapFills(changed);
      }
      if (this.currentRace && !index.has(this.currentRace.id))
        this.clearFocus();
      else if (structural && !this.currentRace) {
        const transform = this.currentTransform();
        await this.renderMap();
        this.applyTransform(transform, 0);
      }
      if (this.currentRace && changed.has(this.currentRace.id)) {
        const race = this.dataByMode[this.selectedMode].find(
          (r) => r.id === this.currentRace.id,
        );
        this.currentRace = race;
        await this.findLiveDetailForRace(race);
        this.renderFocusedRace(race);
        this.updateMapFills(changed, previousSelected);
      }
      for (const detail of events)
        this.events.dispatchEvent(new CustomEvent("call-change", { detail }));
    } catch {
      this.renderProviderStatus({ stale: true });
    } finally {
      this.refreshBusy = false;
    }
  };
  p.updateMapFills = function (changed, previous) {
    if (!this.viewport) return;
    if (this.detailMapActive && this.currentRace) {
      const detail =
          this.liveRaceDetails.get(this.currentRace.id) || this.currentRace,
        lookup = countyLookupForElectionNight(detail),
        prior = countyLookupForElectionNight(previous || {});
      this.viewport
        .selectAll(".county-result-shape")
        .on("mousemove", (event, feature) =>
          this.showTooltip(
            event,
            countyTooltipMarkupClean(
              countyForFeature(feature, lookup),
              feature,
              this.countyDescriptions,
              detail,
              this.comparisonTooltipNote(detail, feature),
            ),
          ),
        )
        .each((f, i, nodes) => {
          const county = countyForFeature(f, lookup),
            before = countyForFeature(f, prior);
          if (previous && JSON.stringify(county) === JSON.stringify(before))
            return;
          d3.select(nodes[i])
            .attr("fill", this.comparisonColorForCounty(f, detail, lookup))
            .classed(
              "election-map-muted",
              !county && !this.isComparisonActive(),
            );
          if (before && FEADesk.total(county) !== FEADesk.total(before)) {
            nodes[i].classList.remove("county-updated");
            void nodes[i].getBoundingClientRect();
            nodes[i].classList.add("county-updated");
          }
        });
      return;
    }
    const races = new Map(
      this.modeRaces().map((r) => [
        this.selectedMode === "house" ? houseGeometryId(r) : r.state,
        r,
      ]),
    );
    this.viewport.selectAll(".election-map-shape").each((f, i, nodes) => {
      const race = races.get(
        this.selectedMode === "house"
          ? f.properties?.id
          : FIPS_TO_STATE[featureStateFipsForElectionNight(f)],
      );
      if (race && changed.has(race.id))
        d3.select(nodes[i]).attr("fill", this.comparisonColorForRace(race));
    });
  };
  p.findLiveDetailForRace = async function (race) {
    const cached = this.liveRaceDetails.get(race.id);
    if (cached && cached.version === race.version) return cached;
    this.liveRaceDetailRequests ||= new Map();
    const key = `${race.id}:${race.version || "initial"}`;
    if (!this.liveRaceDetailRequests.has(key))
      this.liveRaceDetailRequests.set(
        key,
        (async () => {
          const detail = await this.safeJson(
            `/api/live-results/race?id=${encodeURIComponent(race.id)}`,
          );
          if (detail?.id === race.id && Array.isArray(detail.candidates)) {
            this.liveRaceDetails.set(race.id, detail);
            if (this.detailRetryID === race.id) {
              this.detailRetryID = null;
              this.renderProviderStatus(this.publicProvider);
            }
            return detail;
          }
          this.detailRetryID = race.id;
          this.renderProviderStatus({ ...this.publicProvider, stale: true });
          return cached || null;
        })(),
      );
    try {
      return await this.liveRaceDetailRequests.get(key);
    } finally {
      this.liveRaceDetailRequests.delete(key);
    }
  };
  p.retrySelectedDetail = async function () {
    if (!this.currentRace || this.detailRetryID !== this.currentRace.id) return;
    const race = this.currentRace,
      previous = this.liveRaceDetails.get(race.id);
    await this.findLiveDetailForRace(race);
    if (this.currentRace?.id === race.id) {
      this.renderFocusedRace(this.currentRace);
      this.updateMapFills(new Set([race.id]), previous);
    }
  };
  p.selectRace = async function (race, feature, options = {}) {
    if (this.currentRace?.id !== race.id) {
      this.lockedCounty = null;
      this.chartMode = "total";
    }
    this.stateRoads ||= new Map();
    const roadFile = this.mapAssets?.highwaysByState?.[race.state];
    if (roadFile && !this.stateRoads.has(race.state))
      this.stateRoads.set(
        race.state,
        (await this.safeJson(roadFile))?.features || [],
      );
    if (this.stateRoads.has(race.state))
      this.highwayFeatures = this.stateRoads.get(race.state);
    const result = await original.selectRace.call(this, race, feature, options);
    if (this.currentRace?.id === race.id) {
      this.renderFocusedRace(race);
      this.restorePanelSize();
    }
    return result;
  };
  p.openDashboardRace = async function (id) {
    const race = Object.values(this.dataByMode)
      .flat()
      .find((r) => r.id === id);
    if (!race || this.openingRace === id) return;
    this.openingRace = id;
    try {
      if (this.selectedMode !== race.type) await this.switchMode(race.type);
      await this.selectRace(race, null);
    } finally {
      this.openingRace = null;
    }
  };
  p.addZoomControls = function () {
    original.addZoomControls.call(this);
    this.labelMapActions();
    this.positionDeskControls();
    const input = document.querySelector(".election-map-search");
    input?.setAttribute("aria-keyshortcuts", "/");
    input?.setAttribute("title", "Find a race or candidate (/)");
    input?.addEventListener("change", () => {
      const race = Object.values(this.dataByMode)
        .flat()
        .find(
          (r) => title(r).toLowerCase() === input.value.trim().toLowerCase(),
        );
      if (race) this.openDashboardRace(race.id);
    });
  };
  p.labelMapActions = function () {
    if (!this.viewport) return;
    this.svg?.attr("role", "group");
    const lookup = new Map(
      this.modeRaces().map((r) => [
        this.selectedMode === "house" ? houseGeometryId(r) : r.state,
        r,
      ]),
    );
    const raceFor = (feature) =>
      lookup.get(
        this.selectedMode === "house"
          ? feature.properties?.id
          : FIPS_TO_STATE[featureStateFipsForElectionNight(feature)],
      );
    const actionable = (feature) => {
      const race = raceFor(feature);
      return (
        race && (!this.detailMapActive || race.id !== this.currentRace?.id)
      );
    };
    this.viewport
      .selectAll(".state-result-shape,.house-district-shape,.map-context-shape")
      .attr("role", (f) => (actionable(f) ? "button" : "img"))
      .attr("aria-label", (f) => (actionable(f) ? title(raceFor(f)) : null))
      .attr("aria-hidden", (f) => (actionable(f) ? null : "true"))
      .attr("tabindex", (f) => (actionable(f) ? 0 : -1))
      .on("keydown.desk-keyboard", (event, f) => {
        if (event.key === " " && actionable(f)) {
          event.preventDefault();
          this.openDashboardRace(raceFor(f).id);
        }
      });
  };
  p.positionDeskControls = function () {
    const main = document.querySelector(".election-night-page"),
      panel = document.getElementById("focused-race-panel"),
      controls = document.querySelector(".election-map-controls");
    if (!main || !controls) return;
    if (panel && !panel.hidden) {
      const rect = panel.getBoundingClientRect();
      main.classList.toggle(
        "desk-panel-left",
        rect.left + rect.width / 2 < innerWidth / 2,
      );
      main.style.setProperty(
        "--desk-panel-width",
        `${Math.ceil(rect.width)}px`,
      );
    }
    main.style.setProperty(
      "--desk-controls-height",
      `${Math.ceil(controls.getBoundingClientRect().height)}px`,
    );
  };
  p.lockCounty = function (fips) {
    this.lockedCounty = this.lockedCounty === fips ? null : fips;
    this.focusedPanelTab = "counties";
    this.hideTooltip();
    this.viewport
      ?.selectAll(".county-result-shape")
      .classed(
        "is-county-selected",
        (f) => featureCountyFipsForElectionNight(f) === this.lockedCounty,
      );
    this.renderFocusedRace(this.currentRace);
    if (this.lockedCounty) {
      const race = this.currentRace,
        county = this.lockedCounty;
      this.loadCountyHistory(race, county).then(() => {
        if (
          this.currentRace?.id === race.id &&
          this.lockedCounty === county &&
          this.focusedPanelTab === "counties"
        )
          this.renderFocusedRace(this.currentRace);
      });
    }
  };
  p.loadCountyHistory = async function (race, county) {
    this.countyHistories ||= new Map();
    this.countyHistoryRequests ||= new Map();
    const data = this.panelData(race),
      key = `${race.id}:${county}:${data.version || race.version || ""}`;
    if (this.countyHistories.has(key)) return this.countyHistories.get(key);
    if (!this.countyHistoryRequests.has(key))
      this.countyHistoryRequests.set(
        key,
        (async () => {
          const result =
            this.isLabPage && this.query.get("live") !== "true"
              ? {
                  voteHistory:
                    this.countyHistories.get(`${race.id}:${county}`) || [],
                }
              : await this.safeJson(
                  `/api/live-results/race?id=${encodeURIComponent(race.id)}&county=${county}`,
                );
          const prefix = `${race.id}:${county}:`;
          for (const old of this.countyHistories.keys())
            if (old.startsWith(prefix) && old !== key)
              this.countyHistories.delete(old);
          this.countyHistories.set(key, result?.voteHistory || []);
          if (this.panelData(race).version === data.version)
            this.countyHistories.set(
              `${race.id}:${county}`,
              result?.voteHistory || [],
            );
          return result?.voteHistory || [];
        })(),
      );
    try {
      return await this.countyHistoryRequests.get(key);
    } finally {
      this.countyHistoryRequests.delete(key);
    }
  };
  p.renderCountyDetailMap = function (race, features, options = {}) {
    original.renderCounty.call(this, race, features, options);
    this.visibleCountyFeatures = features;
    const countyLookup = countyLookupForElectionNight(race);
    for (const feature of features) {
      const county = countyForFeature(feature, countyLookup);
      if (county && !county.fips)
        county.fips = featureCountyFipsForElectionNight(feature);
    }
    if (this.isLabPage && this.query.get("live") !== "true") {
      const detail = this.liveRaceDetails.get(race.id);
      if (detail && !detail.counties?.length)
        detail.counties = structuredClone(race.counties || []);
      this.countyHistories ||= new Map();
      for (const county of race.counties || [])
        this.countyHistories.set(
          `${race.id}:${county.fips}`,
          this.labHistory(county),
        );
    }
    this.viewport
      .selectAll(".county-result-shape")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr(
        "aria-label",
        (f) => `Select ${f.properties?.NAME || f.properties?.name || "county"}`,
      )
      .classed(
        "is-county-selected",
        (f) => featureCountyFipsForElectionNight(f) === this.lockedCounty,
      )
      .on("click.desk keydown.desk", (event, f) => {
        if (
          event.defaultPrevented ||
          (event.type === "keydown" && !["Enter", " "].includes(event.key))
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        this.lockCounty(featureCountyFipsForElectionNight(f));
      });
  };
  p.labHistory = function (row) {
    return [0.22, 0.38, 0.51, 0.67, 0.83, 1].map((factor, i) => ({
      at: new Date(
        Date.parse("2026-11-04T00:00:00Z") + i * 600000,
      ).toISOString(),
      expectedVotePercent: Math.round(
        (row.expectedVotePercent ?? row.estimatedVoteReporting ?? 60) * factor,
      ),
      candidates: (row.candidates || []).map((c, j) => ({
        ...c,
        votes: Math.round(
          c.votes * factor * (i === 5 ? 1 : j === 0 ? 0.97 : 1),
        ),
      })),
    }));
  };
  p.seedLabDetail = function (detail, race) {
    original.seedLabDetail.call(this, detail, race);
    if (this.query.get("live") === "true") return;
    if (FEADesk.total(detail) > 0)
      detail.voteHistory ||= this.labHistory(detail);
    if (!detail.voteHistory?.length && FEADesk.total(detail) > 0)
      detail.voteHistory = this.labHistory(detail);
    for (const call of detail.calls || [])
      call.calledAt ||= "2026-11-04T00:42:00Z";
  };
  p.panelData = function (race) {
    const detail = this.liveRaceDetails.get(race.id);
    if (!detail) return race;
    return race.version && detail.version !== race.version
      ? {
          ...detail,
          ...race,
          counties: detail.counties,
          voteHistory: detail.voteHistory,
          watch: race.watch,
        }
      : { ...race, ...detail, watch: race.watch };
  };
  p.renderFocusedRace = function (race) {
    if (!race) return;
    const panel = document.getElementById("focused-race-panel"),
      content = document.getElementById("focused-race-content");
    if (!panel || !content) return;
    const oldNumbers = new Map(
      [...content.querySelectorAll("[data-number]")].map((n) => [
        n.dataset.number,
        n.textContent,
      ]),
    );
    const advancedOpen = content.querySelector(".desk-advanced")?.open;
    const oldScroll = content.scrollTop,
      sameView = this.lastRenderedTab === this.focusedPanelTab;
    const metricFocused =
      content.contains(document.activeElement) &&
      document.activeElement?.matches("[data-trend-mode]");
    const active = document.activeElement,
      focusKey = content.contains(active)
        ? active?.getAttribute("data-panel-tab")
        : null;
    const data = this.panelData(race),
      counties = data.counties || [],
      county = this.lockedCounty
        ? counties.find((c) => c.fips === this.lockedCounty)
        : null;
    panel.hidden = false;
    panel.style.setProperty(
      "--focus-color",
      color(
        data.candidates?.find((c) => c.name === data.calls?.[0]?.candidate),
      ),
    );
    document.getElementById("focused-race-title").textContent = title(race);
    const badge = document.getElementById("focused-race-kind"),
      label = FEAResultsUI.watchLabel(race.watch);
    badge.hidden = !label;
    badge.textContent = label;
    document.getElementById("focused-race-rating").textContent = data.calls
      ?.length
      ? "Called"
      : FEADesk.total(data) > 0
        ? "Counting"
        : "Awaiting results";
    const tabs = [
      "results",
      ...(counties.length ? ["counties"] : []),
      "trends",
      "demographics",
    ];
    if (!tabs.includes(this.focusedPanelTab)) this.focusedPanelTab = "results";
    const tabbar = `<div class="desk-tabs" role="tablist" aria-label="Race information">${tabs.map((tab) => `<button role="tab" type="button" data-panel-tab="${tab}" aria-selected="${this.focusedPanelTab === tab}" aria-controls="desk-panel-view">${tab}</button>`).join("")}</div>`;
    let body = "";
    if (this.focusedPanelTab === "results") body = this.resultsMarkup(data);
    if (this.focusedPanelTab === "counties")
      body = county
        ? this.countyMarkup(data, county)
        : `<p class="desk-hint">Select a county on the map or below to keep its results open.</p><div class="county-list">${counties.map((c) => `<button type="button" data-county-fips="${esc(c.fips)}"><span>${esc(c.name)}</span><strong>${fmt(FEADesk.total(c))}</strong></button>`).join("")}</div>`;
    if (this.focusedPanelTab === "trends")
      body = `${county ? `<p>${esc(county.name)} · <button type="button" data-unlock-county>Clear county</button></p>` : ""}<label class="trend-mode-label">Chart <select data-trend-mode aria-label="Trend metric">${[
        ["total", "Total votes"],
        ["share", "Candidate vote share"],
        ["margin", "Margin"],
        ["expected", "Expected vote in"],
      ]
        .map(
          ([v, l]) =>
            `<option value="${v}" ${v === this.chartMode ? "selected" : ""}>${l}</option>`,
        )
        .join(
          "",
        )}</select></label><div id="desk-trend-chart"></div><p id="desk-trend-detail" class="trend-detail" role="status"></p>`;
    if (this.focusedPanelTab === "demographics")
      body =
        '<div id="desk-demographics"><p class="desk-hint">Loading Census estimates…</p></div>';
    content.innerHTML =
      tabbar +
      `<section id="desk-panel-view" role="tabpanel" aria-label="${esc(this.focusedPanelTab)}">${body}</section>`;
    if (sameView) content.scrollTop = oldScroll;
    this.lastRenderedTab = this.focusedPanelTab;
    const callKey = FEADesk.callFingerprint(data);
    if (callKey === this.lastPanelCall)
      for (const check of content.querySelectorAll(".winner-check"))
        check.style.animation = "none";
    this.lastPanelCall = callKey;
    if (advancedOpen && content.querySelector(".desk-advanced"))
      content.querySelector(".desk-advanced").open = true;
    for (const node of content.querySelectorAll("[data-number]")) {
      const old = oldNumbers.get(node.dataset.number);
      if (old !== undefined && old !== node.textContent)
        node.classList.add("number-updated");
    }
    if (focusKey)
      content.querySelector(`[data-panel-tab="${focusKey}"]`)?.focus();
    if (metricFocused) content.querySelector("[data-trend-mode]")?.focus();
    this.setFocusedUiState(true);
    if (!this.panelPositionedFor || this.panelPositionedFor !== race.id) {
      this.positionFocusPanelForRace(race);
      this.panelPositionedFor = race.id;
    }
    this.positionDeskControls();
    if (this.focusedPanelTab === "trends") this.renderTrendChart();
    if (this.focusedPanelTab === "demographics") this.renderDemographics();
  };
  p.candidateTable = function (row, call) {
    const total = FEADesk.total(row);
    return `<table class="selected-race-table"><thead><tr><th>Candidate</th><th>Votes</th><th>Vote %</th></tr></thead><tbody>${[
      ...(row.candidates || []),
    ]
      .sort((a, b) => b.votes - a.votes)
      .map(
        (c) =>
          `<tr class="${call?.candidate === c.name ? "is-projected" : ""}"><td><span class="selected-party-rail" style="background:${color(c)}"></span><strong>${esc(c.name)} ${call?.candidate === c.name ? '<span class="winner-check" aria-label="Projected winner">✓</span>' : ""}</strong><small>${esc(partyLabel(party(c)))}</small></td><td data-number="${esc(c.name)}-votes">${total ? fmt(c.votes) : "—"}</td><td data-number="${esc(c.name)}-share">${total ? percent((c.votes / total) * 100) : "—"}</td></tr>`,
      )
      .join("")}</tbody></table>`;
  };
  p.facts = function (rows) {
    return `<dl class="race-facts">${rows
      .filter(([, v]) => v !== null && v !== undefined)
      .map(
        ([label, value]) =>
          `<div><dt>${esc(label)}</dt><dd data-number="${esc(label)}">${esc(value)}</dd></div>`,
      )
      .join("")}</dl>`;
  };
  p.resultsMarkup = function (data) {
    const call = data.calls?.[0],
      candidate = data.candidates?.find((c) => c.name === call?.candidate),
      history = FEADesk.trendPoints(data.voteHistory),
      previous = history.length > 1 ? history.at(-2) : null;
    const source = this.comparisonManifest.sources.find(
        (s) => s.id === "pres-2024",
      ),
      stateBaseline =
        data.type !== "house"
          ? this.comparisonData
              .get("pres-2024:state")
              ?.states?.find((r) => r.state === data.state)
          : null;
    const m = FEADesk.metrics(data, previous, stateBaseline),
      expected = data.expectedVotePercent ?? data.estimatedVoteReporting;
    return `${call ? `<div class="projection-banner" style="--party-accent:${color(candidate)}"><small>${projectionSource(call)} PROJECTS</small><strong>${esc(call.candidate)}</strong><span>${esc(partyLabel(party(candidate)))} · ${esc(title(data))}</span>${call.calledAt ? `<time>Called ${esc(time(call.calledAt))}</time>` : ""}</div>` : ""}${this.candidateTable(data, call)}${this.facts(
      [
        ["Expected vote in", expected != null ? percent(expected) : null],
        [
          "Precincts reporting",
          data.reportingPercent != null ? percent(data.reportingPercent) : null,
        ],
        [
          "Current margin",
          m.margin !== null ? signed(m.margin) + " pts" : null,
        ],
        [
          "Last update",
          time(data.lastUpdated || data.updatedAt) || "Awaiting results",
        ],
      ],
    )}<details class="desk-advanced"><summary>More metrics</summary>${this.facts(
      [
        ["Votes counted", m.votes ? fmt(m.votes) : null],
        [
          "Raw D−R margin",
          m.rawMargin !== null && m.votes ? fmt(m.rawMargin) : null,
        ],
        [
          "Est. votes remaining",
          m.remaining !== null ? `≈ ${fmt(m.remaining)}` : null,
        ],
        [
          "Latest update",
          m.delta !== null
            ? (m.delta >= 0 ? "+" : "") + fmt(m.delta) + " votes"
            : null,
        ],
        [
          "Margin change",
          previous &&
          m.margin !== null &&
          FEADesk.metrics(previous).margin !== null
            ? `${signed(FEADesk.metrics(previous).margin)} → ${signed(m.margin)}`
            : null,
        ],
        [
          "Shift vs 2024 president",
          m.shift !== null ? signed(m.shift) + " pts" : null,
        ],
        [
          "Votes / 2024 president total",
          m.turnout !== null ? percent(m.turnout) : null,
        ],
      ],
    )}${m.batchShares.length ? `<div class="vote-batch"><small>Votes added in latest update</small>${m.batchShares.map((c) => `<span>${esc(c.name)} <b>${percent(c.share)}</b></span>`).join("")}</div>` : ""}</details>${data.provider === "NBC" ? '<p class="race-attribution">Results via NBC News</p>' : ""}`;
  };
  p.countyMarkup = function (race, county) {
    const baseline =
      race.type !== "house"
        ? this.comparisonData
            .get("pres-2024:county")
            ?.rows?.find((r) => r.fips === county.fips)
        : null;
    const history =
        this.countyHistories?.get(`${race.id}:${county.fips}`) || [],
      previous = history.length > 1 ? history.at(-2) : null,
      m = FEADesk.metrics(county, previous, baseline);
    return `<div class="county-heading"><h3>${esc(county.name)}</h3><button type="button" data-unlock-county>Clear county</button></div>${this.candidateTable(county)}${this.facts(
      [
        ["Votes counted", fmt(m.votes)],
        [
          "Expected vote in",
          county.estimatedVoteReporting != null
            ? percent(county.estimatedVoteReporting)
            : null,
        ],
        [
          "Precincts reporting",
          county.percentReporting != null
            ? percent(county.percentReporting)
            : null,
        ],
        [
          "Current margin",
          m.margin !== null ? signed(m.margin) + " pts" : null,
        ],
        [
          "2024 presidential margin",
          baseline ? signed(FEAResultsUI.margin(baseline)) + " pts" : null,
        ],
        ["Shift vs 2024", m.shift !== null ? signed(m.shift) + " pts" : null],
        [
          "Change since previous update",
          m.delta !== null
            ? `${m.delta >= 0 ? "+" : ""}${fmt(m.delta)} votes`
            : null,
        ],
        [
          "Est. votes remaining",
          m.remaining !== null ? `≈ ${fmt(m.remaining)}` : null,
        ],
        [
          "Contribution to state D−R margin",
          race.type !== "house" && m.rawMargin !== null
            ? fmt(m.rawMargin) + " votes"
            : null,
        ],
        [
          "Votes / 2024 president total",
          m.turnout !== null ? percent(m.turnout) : null,
        ],
      ],
    )}`;
  };
  p.renderTrendChart = async function () {
    const race = this.currentRace;
    if (!race) return;
    const id = race.id,
      county = this.lockedCounty;
    let data = this.panelData(race),
      history = data.voteHistory || [];
    if (county) history = await this.loadCountyHistory(race, county);
    if (
      this.currentRace?.id !== id ||
      this.lockedCounty !== county ||
      this.focusedPanelTab !== "trends"
    )
      return;
    const container = document.getElementById("desk-trend-chart"),
      detail = document.getElementById("desk-trend-detail");
    if (!container) return;
    const points = FEADesk.trendPoints(history);
    container.replaceChildren();
    if (points.length < 2) {
      container.innerHTML =
        '<p class="desk-hint">Waiting for more results.</p>';
      return;
    }
    const mode = this.chartMode,
      width = Math.max(300, container.clientWidth),
      height = 230;
    const series =
      mode === "share"
        ? points.at(-1).candidates.map((c) => ({
            name: c.name,
            color: color(c),
            value: (p) => {
              const t = FEADesk.total(p),
                v = p.candidates.find((k) => k.name === c.name);
              return t > 0 && v ? (v.votes / t) * 100 : null;
            },
          }))
        : [
            {
              name:
                mode === "total"
                  ? "Total votes"
                  : mode === "margin"
                    ? "D−R margin"
                    : "Expected vote in",
              color: "var(--chart-line)",
              value: (p) =>
                mode === "total"
                  ? FEADesk.total(p)
                  : mode === "margin"
                    ? FEADesk.metrics(p).margin
                    : FEADesk.finite(p.expectedVotePercent),
            },
          ];
    const values = points
      .flatMap((point) => series.map((s) => s.value(point)))
      .filter((v) => v !== null && Number.isFinite(v));
    if (!values.length) {
      container.innerHTML =
        '<p class="desk-hint">This history does not include the selected measure.</p>';
      return;
    }
    const x = d3
        .scaleTime()
        .domain(d3.extent(points, (p) => new Date(p.at)))
        .range([46, width - 14]),
      extent = d3.extent(values);
    const y = d3
      .scaleLinear()
      .domain(
        mode === "share" || mode === "expected"
          ? [0, 100]
          : extent[0] === extent[1]
            ? [extent[0] - 1, extent[1] + 1]
            : extent,
      )
      .nice()
      .range([height - 30, 14]);
    const svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("role", "group")
      .attr(
        "aria-label",
        `${series.map((s) => s.name).join(", ")} over ${points.length} observed updates. ${time(points[0].at)} to ${time(points.at(-1).at)}.`,
      );
    svg
      .append("title")
      .text("Reported results over time; descriptive, not a prediction.");
    svg
      .append("g")
      .attr("class", "chart-axis")
      .attr("transform", `translate(0,${height - 30})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(3)
          .tickFormat((d) => time(d.toISOString()).replace(" ET", "")),
      );
    svg
      .append("g")
      .attr("class", "chart-axis")
      .attr("transform", "translate(46,0)")
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat((d) => (mode === "total" ? d3.format("~s")(d) : d + "%")),
      );
    for (const s of series)
      svg
        .append("path")
        .datum(points)
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", 2)
        .attr(
          "d",
          d3
            .line()
            .defined((p) => s.value(p) !== null)
            .x((p) => x(new Date(p.at)))
            .y((p) => y(s.value(p))),
        );
    const describe = (point) => {
      const total = FEADesk.total(point),
        m = FEADesk.metrics(point);
      detail.textContent = `${time(point.at)} · ${fmt(total)} votes · ${point.candidates.map((c) => `${c.name}: ${fmt(c.votes)} (${percent(total ? (c.votes / total) * 100 : null)})`).join(" · ")}${m.margin !== null ? ` · Margin ${signed(m.margin)}` : ""}${point.expectedVotePercent != null ? ` · Expected vote ${percent(point.expectedVotePercent)}` : ""}`;
    };
    svg
      .selectAll(".trend-point")
      .data(points)
      .join("circle")
      .attr("class", "trend-point")
      .attr("cx", (p) => x(new Date(p.at)))
      .attr("cy", (p) => y(series[0].value(p) ?? values[0]))
      .attr("r", 5)
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (p) => `Inspect update at ${time(p.at)}`)
      .on("pointerenter focus click", (_, p) => describe(p))
      .on("keydown", (e, p) => {
        if (e.key === "Enter" || e.key === " ") describe(p);
      });
    svg
      .append("rect")
      .attr("x", 40)
      .attr("y", 0)
      .attr("width", width - 40)
      .attr("height", height - 25)
      .attr("fill", "transparent")
      .attr("aria-hidden", "true")
      .on("pointermove click", (event) => {
        const [px] = d3.pointer(event, svg.node());
        const nearest = points.reduce((a, b) =>
          Math.abs(x(new Date(a.at)) - px) < Math.abs(x(new Date(b.at)) - px)
            ? a
            : b,
        );
        describe(nearest);
      });
    describe(points.at(-1));
  };
  p.renderDemographics = async function () {
    const race = this.currentRace,
      county = this.lockedCounty;
    if (!race) return;
    if (!this.demographics) {
      const manifest = await this.safeJson("data/results/demographics.json");
      this.demographics =
        manifest?.status === "available"
          ? await this.safeJson(manifest.file)
          : { counties: {}, states: {} };
    }
    if (
      this.currentRace?.id !== race.id ||
      county !== this.lockedCounty ||
      this.focusedPanelTab !== "demographics"
    )
      return;
    const node = document.getElementById("desk-demographics");
    if (!node) return;
    const row = county
      ? this.demographics?.counties?.[county]
      : race.type !== "house"
        ? this.demographics?.states?.[stateFipsForElectionNight(race.state)]
        : null;
    if (!row) {
      node.innerHTML = `<p class="desk-hint">${race.type === "house" && !county ? "Select a county for Census estimates. These describe the whole county, not only its district portion." : "Census estimates are not available for this area yet."}</p>`;
      return;
    }
    node.innerHTML = `<h3>${esc(row.name)}</h3><p class="demographic-source">${this.demographics.simulated ? "Simulated demographic fixture · Not Census data" : "2024 ACS 5-year estimates · U.S. Census Bureau"}</p>${this.facts(
      [
        ["Population", fmt(row.population)],
        [
          "Median household income",
          row.income !== null ? "$" + fmt(row.income) : null,
        ],
      ],
    )}<div class="demographic-bars">${[
      ["White, non-Hispanic", row.whiteNH],
      ["Black alone", row.black],
      ["Hispanic / Latino", row.hispanic],
      ["Asian alone", row.asian],
      ["Age 65+", row.age65],
      ["Bachelor’s degree+", row.bachelors],
    ]
      .filter(([, v]) => v !== null)
      .map(
        ([label, value]) =>
          `<div><span>${esc(label)}</span><strong>${percent(value)}</strong><i style="--bar:${Math.min(100, value)}%"></i></div>`,
      )
      .join(
        "",
      )}</div><p class="desk-hint">Race and ethnicity overlap. Education covers adults 25+. Estimates describe residents, not party registration or voters.${race.type === "house" ? " Whole-county estimates; not a district tabulation." : ""}</p>`;
  };
  p.setPanelSize = function (width, height) {
    if (innerWidth <= 600) return;
    const panel = document.getElementById("focused-race-panel"),
      w = Math.max(340, Math.min(width, innerWidth - 36)),
      h = Math.max(300, Math.min(height, innerHeight - 170));
    panel.style.width = w + "px";
    panel.style.height = h + "px";
    panel.style.maxHeight = "calc(100dvh - 170px)";
    if (panel.style.left && panel.style.left !== "auto")
      panel.style.left =
        Math.max(
          8,
          Math.min(parseFloat(panel.style.left), innerWidth - w - 8),
        ) + "px";
    if (panel.style.top && panel.style.top !== "auto")
      panel.style.top =
        Math.max(
          150,
          Math.min(parseFloat(panel.style.top), innerHeight - h - 8),
        ) + "px";
  };
  p.savePanelSize = function () {
    if (innerWidth <= 600) return;
    const r = document
      .getElementById("focused-race-panel")
      .getBoundingClientRect();
    try {
      localStorage.setItem(
        "feaRacePanelSize",
        JSON.stringify([r.width, r.height]),
      );
    } catch {}
    if (this.focusedPanelTab === "trends") this.renderTrendChart();
  };
  p.restorePanelSize = function () {
    try {
      const size = JSON.parse(
        localStorage.getItem("feaRacePanelSize") || "null",
      );
      if (size) this.setPanelSize(...size);
    } catch {}
  };
  p.resetPanelSize = function () {
    try {
      localStorage.removeItem("feaRacePanelSize");
    } catch {}
    const panel = document.getElementById("focused-race-panel");
    panel.style.width = "";
    panel.style.height = "";
    panel.style.maxHeight = "";
    if (this.focusedPanelTab === "trends") this.renderTrendChart();
  };
  p.pulseRace = function (race) {
    if (!this.viewport) return;
    const paths =
      this.detailMapActive && this.currentRace?.id === race.id
        ? this.viewport.selectAll(".county-result-shape")
        : this.viewport
            .selectAll(".election-map-shape")
            .filter((f) =>
              race.type === "house"
                ? f.properties?.id === houseGeometryId(race)
                : FIPS_TO_STATE[featureStateFipsForElectionNight(f)] ===
                  race.state,
            );
    paths.classed("projection-pulse", false);
    requestAnimationFrame(() => paths.classed("projection-pulse", true));
  };
  p.queueProjection = function (event) {
    this.alertQueue.push(event);
    const live = document.getElementById("projection-announcer");
    if (live)
      live.textContent = event.correction
        ? `Projection update: ${title(event.race)}`
        : `${projectionSource(event.call)} projects ${event.call.candidate} in ${title(event.race)}`;
    this.renderProjectionQueue();
  };
  p.renderProjectionQueue = function () {
    const host = document.getElementById("projection-alerts");
    if (!host) return;
    const limit = innerWidth <= 600 ? 1 : 3;
    // Keep existing cards and timers; a burst never restarts their dismissal clocks.
    const visible = new Set(this.alertQueue.slice(0, limit).map((e) => e.key));
    for (const card of [...host.querySelectorAll(".projection-toast")])
      if (!visible.has(card.dataset.eventKey)) {
        clearTimeout(card._timer);
        card.remove();
      }
    for (const event of this.alertQueue.slice(0, limit)) {
      if ([...host.children].some((n) => n.dataset.eventKey === event.key))
        continue;
      const card = document.createElement("article");
      card.className = `projection-toast ${event.correction ? "is-correction" : ""}`;
      card.dataset.eventKey = event.key;
      card.innerHTML = `<button class="toast-dismiss" aria-label="Dismiss projection notification">×</button><small>${event.correction ? "PROJECTION UPDATE" : projectionSource(event.call) + " PROJECTS"}</small><h3>${esc(title(event.race))}</h3><strong>${esc(event.call?.candidate || "Previous projection withdrawn")}</strong><button class="toast-view" type="button">View race</button>`;
      const dismiss = () => {
        clearTimeout(card._timer);
        this.alertQueue = this.alertQueue.filter((e) => e.key !== event.key);
        card.remove();
        this.renderProjectionQueue();
      };
      const start = () => {
        if (card.matches(":hover") || card.contains(document.activeElement))
          return;
        card._started = Date.now();
        card._timer = setTimeout(dismiss, card._remaining || 18000);
      };
      const pause = () => {
        clearTimeout(card._timer);
        card._remaining = Math.max(
          1000,
          (card._remaining || 18000) - (Date.now() - card._started),
        );
      };
      card.addEventListener("pointerenter", pause);
      card.addEventListener("pointerleave", start);
      card.addEventListener("focusin", pause);
      card.addEventListener("focusout", () => queueMicrotask(start));
      card.querySelector(".toast-dismiss").onclick = dismiss;
      card.querySelector(".toast-view").onclick = () => {
        this.openDashboardRace(event.race.id);
        dismiss();
      };
      card.addEventListener("click", (e) => {
        if (!e.target.closest("button")) {
          this.openDashboardRace(event.race.id);
          dismiss();
        }
      });
      host.append(card);
      start();
    }
    host.querySelector(".more-projections")?.remove();
    if (this.alertQueue.length > limit) {
      const more = document.createElement("button");
      more.className = "more-projections";
      more.textContent = `+${this.alertQueue.length - limit} more projections`;
      more.onclick = () => {
        this.alertQueue.splice(0, limit);
        this.renderProjectionQueue();
      };
      host.append(more);
    }
  };
  p.initLabDesk = function () {
    if (!this.isLabPage || this.query.get("live") === "true") return;
    const toolbar = document.createElement("details");
    toolbar.className = "desk-lab-tools";
    toolbar.innerHTML =
      "<summary>Test scenarios</summary><div>" +
      [
        ["single", "Single projection"],
        ["three", "3 projections"],
        ["burst", "10-call burst"],
        ["correction", "Projection correction"],
        ["batch", "New vote batch"],
        ["demographics", "Demographics fixture"],
        ["delayed", "Provider delayed"],
        ["recovery", "Delta recovery"],
        ["full", "Full snapshot recovery"],
      ]
        .map(
          ([v, l]) =>
            `<button type="button" data-lab-scenario="${v}">${l}</button>`,
        )
        .join("") +
      "</div>";
    document.querySelector("main").append(toolbar);
    toolbar.addEventListener("click", async (e) => {
      const kind = e.target.dataset.labScenario;
      if (!kind) return;
      toolbar.open = false;
      if (kind === "delayed") {
        const warning = document.getElementById("results-provider-status");
        warning.textContent = "Test board • Simulated delay";
        return;
      }
      if (kind === "demographics") {
        if (!this.currentRace) await this.openDashboardRace("senate-OH");
        const race = this.currentRace,
          county = this.lockedCounty,
          row = {
            name: county
              ? "Simulated county example"
              : "Simulated state example",
            population: 842000,
            whiteNH: 61,
            black: 14,
            hispanic: 18,
            asian: 5,
            age65: 17,
            bachelors: 37,
            income: 79000,
          };
        this.demographics = {
          simulated: true,
          counties: { [county]: row },
          states: { [stateFipsForElectionNight(race.state)]: row },
        };
        this.focusedPanelTab = "demographics";
        this.renderFocusedRace(race);
        return;
      }
      if (kind === "recovery" || kind === "full") {
        const note = document.getElementById("results-provider-status");
        note.textContent = "Test board • Recovery fixture running";
        const response = await this.safeJson(
          kind === "full"
            ? "/api/live-results"
            : "/api/live-results/changes?since=expired-lab-version",
        );
        note.textContent = `Test board • ${kind === "full" ? (response?.groups ? "Full snapshot received" : "Snapshot unavailable") : response?.reset ? "Expired version requests full snapshot" : "Recovery unavailable"}`;
        return;
      }
      if (kind === "batch" && this.currentRace) {
        const detail = this.panelData(this.currentRace),
          at = new Date().toISOString();
        for (const c of detail.candidates)
          c.votes += Math.round(1000 + Math.random() * 1000);
        detail.voteHistory = [
          ...(detail.voteHistory || []),
          {
            at,
            expectedVotePercent: detail.expectedVotePercent,
            candidates: structuredClone(detail.candidates),
          },
        ];
        this.liveRaceDetails.set(detail.id, detail);
        this.renderFocusedRace(this.currentRace);
        return;
      }
      const races =
        ["single", "correction"].includes(kind) && this.currentRace
          ? [this.currentRace]
          : Object.values(this.dataByMode)
              .flat()
              .filter((r) => r.candidates.length)
              .slice(0, kind === "burst" ? 10 : kind === "three" ? 3 : 1);
      for (const race of races) {
        const call = {
          candidate: race.candidates[0].name,
          provider: "NBC",
          source: "nbc-auto",
          status: "projected",
          calledAt: new Date().toISOString(),
        };
        race.calls = kind === "correction" ? [] : [call];
        const detail = this.liveRaceDetails.get(race.id);
        if (detail) detail.calls = structuredClone(race.calls);
        this.events.dispatchEvent(
          new CustomEvent("call-change", {
            detail: {
              key: `lab-${Date.now()}-${race.id}`,
              race,
              call: race.calls[0],
              correction: kind === "correction",
            },
          }),
        );
      }
      this.renderSummary();
      if (this.currentRace) this.renderFocusedRace(this.currentRace);
    });
  };
};
