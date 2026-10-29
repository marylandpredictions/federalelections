/* Optional public presentation layer, composed after the existing desk. */
window.FEANightAwareness = function (Page) {
  if (!window.FEANight) return;
  const p = Page.prototype,
    N = FEANight,
    esc = (s) =>
      String(s ?? "").replace(
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
  const old = {
    init: p.init,
    summary: p.renderSummary,
    pins: p.renderPins,
    select: p.selectRace,
    clear: p.clearFocus,
    clock: p.updatePollClock,
    close: p.showPollClose,
    map: p.renderMap,
    county: p.renderCountyDetailMap,
    focus: p.renderFocusedRace,
    projection: p.renderProjectionQueue,
    lab: p.initLabDesk,
    stage: p.runDeskStage,
    mode: p.switchMode,
    lock: p.lockCounty,
  };
  const label = (r) =>
    r
      ? FEAResultsUI.raceLabel({ ...r, stateName: STATE_NAMES[r.state] })
      : "Race";
  const safe = (fn) => {
    try {
      return fn();
    } catch (e) {
      console.warn("Optional desk presentation unavailable:", e.message);
    }
  };
  p.init = async function () {
    this.activity = new N.Activity();
    this.activityWindow = 60000;
    this.firstResultSeen = new Set();
    this.firstAnimationShown = new Set();
    let restored = {};
    try {
      restored = JSON.parse(localStorage.getItem("feaDeskView.v1") || "{}");
    } catch {}
    const requested = N.parseView(location.search),
      initialView = Object.keys(requested).length
        ? requested
        : N.parseView(new URLSearchParams(restored).toString());
    if (initialView.race) this.selectedMode = initialView.race.split("-")[0];
    else if (initialView.office) this.selectedMode = initialView.office;
    await old.init.call(this);
    for (const r of Object.values(this.dataByMode).flat())
      if (N.total(r) > 0) this.firstResultSeen.add(r.id);
    const menu = document.getElementById("board-menu");
    menu.insertAdjacentHTML(
      "beforeend",
      '<button type="button" id="desk-fullscreen">Enter fullscreen</button><button type="button" id="desk-share">Share this view</button><label>Race window<select id="desk-window-preset" aria-label="Race window layout"><option value="custom">Custom size</option><option value="compact">Compact</option><option value="analysis">Analysis</option><option value="map-first">Map first</option><option value="tv">TV</option></select></label><p id="desk-menu-feedback" role="status"></p>',
    );
    const calls = document.createElement("button");
    calls.type = "button";
    calls.textContent = "Published calls";
    menu.append(calls);
    const callsDialog = document.createElement("dialog");
    callsDialog.id = "night-calls";
    callsDialog.setAttribute("aria-label", "Published calls");
    callsDialog.innerHTML =
      '<header><h2>Published calls</h2><button type="button">Close</button></header><div></div>';
    document.body.append(callsDialog);
    calls.onclick = () => {
      callsDialog.querySelector("div").innerHTML =
        Object.values(this.dataByMode)
          .flat()
          .filter((r) => r.calls?.length)
          .sort((a, b) =>
            String(b.calls[0].calledAt || "").localeCompare(
              String(a.calls[0].calledAt || ""),
            ),
          )
          .map(
            (r) =>
              `<button type="button" data-call-race="${esc(r.id)}"><strong>${esc(label(r))}</strong><span>${N.source(r.calls[0])} PROJECTS · ${esc(r.calls[0].candidate)}</span></button>`,
          )
          .join("") || "<p>No published calls.</p>";
      callsDialog.showModal();
    };
    callsDialog.querySelector("header button").onclick = () =>
      callsDialog.close();
    callsDialog.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-call-race]");
      if (b) {
        callsDialog.close();
        await this.openDashboardRace(b.dataset.callRace);
      }
    });
    const controls = document.createElement("section");
    controls.id = "night-controls";
    controls.setAttribute("aria-label", "Election night activity");
    controls.innerHTML =
      '<button id="night-changed" aria-pressed="false">What changed?</button><button id="night-activity" aria-expanded="false" aria-controls="night-drawer">Activity <span>0</span></button><small id="night-state"></small>';
    document.querySelector("main").append(controls);
    const drawer = document.createElement("section");
    drawer.id = "night-drawer";
    drawer.hidden = true;
    drawer.setAttribute("aria-label", "Recent activity");
    drawer.innerHTML =
      '<header><h2>Recent activity</h2><button type="button" aria-label="Close activity">×</button></header><label>Highlight window <select id="night-window"><option value="30000">30 seconds</option><option value="60000" selected>60 seconds</option><option value="300000">5 minutes</option></select></label><h3>Largest net updates · last 5 minutes</h3><div id="night-drops"></div><h3>Latest changes · this session, last 30 minutes</h3><div id="night-items"></div><h3>Still unresolved</h3><div id="night-unresolved"></div>';
    document.querySelector("main").append(drawer);
    const toggleDrawer = () => {
      drawer.hidden = !drawer.hidden;
      document
        .getElementById("night-activity")
        .setAttribute("aria-expanded", String(!drawer.hidden));
      if (!drawer.hidden) {
        this.renderNightAwareness();
        drawer.querySelector("button").focus();
      }
    };
    document.getElementById("night-activity").onclick = toggleDrawer;
    drawer.querySelector("header button").onclick = toggleDrawer;
    drawer.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        drawer.hidden = true;
        document
          .getElementById("night-activity")
          .setAttribute("aria-expanded", "false");
        document.getElementById("night-activity").focus();
      }
    });
    document.getElementById("night-window").onchange = (e) => {
      this.activityWindow = Number(e.target.value);
      this.renderNightAwareness();
    };
    drawer.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-activity-race]");
      if (!b) return;
      drawer.hidden = true;
      document
        .getElementById("night-activity")
        .setAttribute("aria-expanded", "false");
      await this.openDashboardRace(b.dataset.activityRace);
      if (b.dataset.county) this.lockCounty(b.dataset.county);
    });
    document.getElementById("night-changed").onclick = () => {
      this.changedUntil =
        this.changedUntil > Date.now() ? 0 : Date.now() + 12000;
      clearTimeout(this.changedTimer);
      this.renderNightAwareness();
      if (this.changedUntil)
        this.changedTimer = setTimeout(
          () => this.renderNightAwareness(),
          12010,
        );
    };
    const full = document.getElementById("desk-fullscreen");
    full.onclick = async () => {
      if (!(await N.fullscreen(document)))
        document.getElementById("desk-menu-feedback").textContent =
          "Fullscreen is unavailable here. Use your browser’s fullscreen or landscape view.";
    };
    document.addEventListener("fullscreenchange", () => {
      full.textContent = document.fullscreenElement
        ? "Exit fullscreen"
        : "Enter fullscreen";
      this.handleViewportResize?.();
    });
    document.getElementById("desk-share").onclick = async () => {
      const view = {
        office: this.selectedMode,
        ...(this.currentRace
          ? {
              race: this.currentRace.id,
              tab: this.focusedPanelTab || "results",
            }
          : {}),
        ...(this.lockedCounty ? { county: this.lockedCounty } : {}),
        ...(this.comparisonMode ? { lens: this.comparisonMode } : {}),
      };
      const url = N.viewUrl(view, location.href);
      history.replaceState(null, "", url);
      const feedback = document.getElementById("desk-menu-feedback");
      try {
        await navigator.clipboard.writeText(url.href);
        feedback.textContent = "View link copied.";
      } catch {
        feedback.replaceChildren();
        const input = document.createElement("input");
        input.readOnly = true;
        input.value = url.href;
        input.setAttribute("aria-label", "Shareable view link");
        feedback.append(input);
        input.select();
      }
    };
    document.getElementById("desk-window-preset").onchange = (e) => {
      const panel = document.getElementById("focused-race-panel"),
        kind = e.target.value;
      if (kind !== "custom" && !this.windowPreset) {
        const rect = panel.getBoundingClientRect();
        this.previousCustomSize = panel.hidden
          ? null
          : [rect.width, rect.height];
      }
      this.windowPreset = kind === "custom" ? null : kind;
      document.body.classList.toggle("night-tv", kind === "tv");
      if (kind === "custom") {
        if (this.previousCustomSize)
          this.setPanelSize(...this.previousCustomSize);
        else {
          panel.style.width = "";
          panel.style.height = "";
          panel.style.maxHeight = "";
          this.restorePanelSize();
        }
      } else {
        const size = N.panelPreset(kind, innerWidth, innerHeight);
        if (size) this.setPanelSize(...size);
        if (innerWidth <= 600) {
          document
            .querySelector(".election-night-page")
            .classList.toggle(
              "sheet-expanded",
              kind === "analysis" || kind === "tv",
            );
        }
      }
      this.positionDeskControls();
      this.renderFocusedRace(this.currentRace);
      this.keepFocusedPanelInView?.();
    };
    document
      .querySelector(".focus-resize-handle")
      ?.addEventListener("pointerdown", () => {
        this.windowPreset = null;
        document.body.classList.remove("night-tv");
        document.getElementById("desk-window-preset").value = "custom";
      });
    window.addEventListener("popstate", () =>
      this.restoreNightView(N.parseView(location.search)),
    );
    document
      .getElementById("focused-race-panel")
      .addEventListener("click", () =>
        queueMicrotask(() => this.saveNightView()),
      );
    document
      .getElementById("focused-race-panel")
      .addEventListener("keydown", (event) => {
        if (event.target.matches("[data-panel-tab]"))
          queueMicrotask(() => this.saveNightView());
      });
    window.addEventListener(
      "pagehide",
      () => {
        clearTimeout(this.changedTimer);
        clearTimeout(this.burstTimer);
        clearTimeout(this.waveTimer);
        cancelAnimationFrame(this.labelFrame);
      },
      { once: true },
    );
    await this.restoreNightView(initialView);
    this.renderNightAwareness();
  };
  p.saveNightView = function () {
    safe(() =>
      localStorage.setItem(
        "feaDeskView.v1",
        JSON.stringify({
          office: this.selectedMode,
          ...(this.currentRace
            ? {
                race: this.currentRace.id,
                tab: this.focusedPanelTab || "results",
              }
            : {}),
          ...(this.lockedCounty ? { county: this.lockedCounty } : {}),
        }),
      ),
    );
  };
  p.restoreNightView = async function (view) {
    const race = view.race ? this.findDeskRace(view.race) : null,
      office = race?.type || view.office;
    if (office && office !== this.selectedMode) await this.switchMode(office);
    const restoreLens =
      view.lens &&
      [
        "live",
        ...(this.comparisonManifest?.sources || [])
          .filter((s) => s.status === "available")
          .map((s) => s.id),
      ].includes(view.lens);
    if (restoreLens) this.comparisonMode = view.lens;
    if (race) {
      await this.selectRace(race);
      if (this.currentRace?.id !== race.id) return;
      const detail = this.panelData(race);
      if (
        view.county &&
        (detail.counties || []).some((c) => c.fips === view.county)
      )
        this.lockCounty(view.county);
      this.focusedPanelTab =
        view.tab || (this.lockedCounty ? "counties" : "results");
      this.renderFocusedRace(race);
      this.saveNightView();
    } else if (this.currentRace) this.clearFocus();
    else if (restoreLens) await this.renderMap();
  };
  p.observePublicUpdate = function (rows) {
    safe(() => {
      const start = performance.now(),
        before = new Map((this.liveRaceIndex || []).map((r) => [r.id, r])),
        now = Date.now();
      let events = [];
      for (const row of rows)
        events.push(...this.activity.observe(before.get(row.id), row, now));
      this.burstMode = rows.length > 40;
      document.body.classList.toggle("night-burst", this.burstMode);
      clearTimeout(this.burstTimer);
      this.burstTimer = setTimeout(
        () => document.body.classList.remove("night-burst"),
        1500,
      );
      if (!document.hidden && !this.suppressDeskEvents) {
        for (const e of events.filter(
          (e) =>
            e.kind === "first-results" && !this.firstResultSeen.has(e.race),
        )) {
          this.firstResultSeen.add(e.race);
          this.lastFirstRace = e.race;
        }
        this.lastLeadRace = events.find((e) => e.kind === "leader")?.race;
        this.lastChangeAt = now;
      }
      this.activityProcessingMs = performance.now() - start;
    });
  };
  p.observeCountyUpdate = function (before, after) {
    safe(() => {
      if (!before || !after) return;
      const lookup = new Map((before.counties || []).map((c) => [c.fips, c]));
      for (const c of after.counties || []) {
        if (!lookup.has(c.fips) && N.total(c) > 0) {
          this.activity.add(
            { race: after.id, county: c.fips, kind: "county-available" },
            Date.now(),
          );
          continue;
        }
        this.activity.observe(
          lookup.get(c.fips),
          { ...c, id: after.id },
          Date.now(),
          c.fips,
        );
      }
    });
  };
  p.renderNightAwareness = function (now = Date.now()) {
    safe(() => {
      const host = document.getElementById("night-controls");
      if (!host || !this.activity) return;
      this.activity.prune(now);
      const all = this.modeRaces(),
        state = N.presentation(
          all,
          this.pollSchedule,
          this.nightScenarioNow || now,
          {
            waveAt: this.nightWaveAt,
            recent: this.activity
              .changed(now)
              .filter((id) => all.some((r) => r.id === id)).length,
          },
        );
      this.presentationState = state.state;
      document.body.dataset.nightState = state.state;
      const captions = {
        PRE_ELECTION: "Awaiting results",
        POLL_CLOSE_WAVE: "Polls just closed",
        EARLY_RESULTS: "First results",
        ACTIVE_COUNT: "Counting",
        LATE_NIGHT: "Remaining races",
        MOSTLY_COMPLETE: "Final unresolved races",
      };
      document.getElementById("night-state").textContent =
        captions[state.state] + " · " + state.unresolved + " uncalled";
      document.querySelector("#night-activity span").textContent =
        this.activity.items.length;
      const changed = new Set(this.activity.changed(now, this.activityWindow)),
        show = this.changedUntil > now;
      const changedCounties = new Set(
        this.activity.items
          .filter((e) => e.county && now - e.at <= this.activityWindow)
          .map((e) => e.race + ":" + e.county),
      );
      document
        .getElementById("night-changed")
        .setAttribute("aria-pressed", String(show));
      this.viewport
        ?.selectAll(".election-map-shape")
        .classed("night-changed", (f) => {
          if (this.detailMapActive && this.visibleCountyFeatures?.includes(f))
            return (
              show &&
              changedCounties.has(
                this.currentRace?.id +
                  ":" +
                  featureCountyFipsForElectionNight(f),
              )
            );
          const id = f.properties?.id,
            state = FIPS_TO_STATE[featureStateFipsForElectionNight(f)];
          return (
            show &&
            all.some(
              (r) =>
                changed.has(r.id) &&
                (r.type === "house"
                  ? houseGeometryId(r) === id
                  : r.state === state),
            )
          );
        });
      const drawer = document.getElementById("night-drawer");
      if (drawer.hidden) return;
      const drawerKey = [this.selectedMode,this.activity.sequence,this.activity.items.length,this.activityWindow,this.resultsVersion,Math.floor(now/30000)].join(':');
      if (this.lastDrawerKey === drawerKey) return;
      this.lastDrawerKey = drawerKey;
      const drawerScroll = drawer.scrollTop;
      const active = document.activeElement?.dataset?.activityKey;
      const button = (id, text, key = "", county = "") =>
        `<button type="button" data-activity-race="${esc(id)}" data-activity-key="${esc(key)}" ${county ? `data-county="${esc(county)}"` : ""}>${text}</button>`;
      document.getElementById("night-drops").innerHTML =
        this.activity
          .drops(now)
          .map((e) =>
            button(
              e.race,
              `<strong>${esc(label(this.findDeskRace(e.race)))}</strong><span>+${e.votes.toLocaleString()} votes</span>`,
              "drop-" + e.race,
            ),
          )
          .join("") || "<p>No new vote totals in this window.</p>";
      document.getElementById("night-items").innerHTML =
        [...this.activity.items]
          .reverse()
          .map((e) => {
            if (e.kind === "control")
              return `<p><time>${new Date(e.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET</time> · <strong>${e.office === "house" ? "House" : "Senate"} control</strong> · ${esc(e.party ? (e.party === "D" ? "Democratic" : "Republican") + " control reached" : "Control unresolved after a projection update")}</p>`;
            const message =
              e.kind === "county-available"
                ? "County results now available"
                : e.kind === "leader"
                  ? "Lead changed to " + e.candidate
                  : e.kind === "call"
                    ? e.source + " PROJECTS · " + e.candidate
                    : e.kind === "correction"
                      ? e.retracted
                        ? "Projection withdrawn"
                        : e.source + " projection corrected · " + e.candidate
                      : e.kind === "reporting"
                        ? e.reporting.toFixed(1) + "% expected vote in"
                        : (e.votes >= 0 ? "+" : "") +
                          e.votes.toLocaleString() +
                          " votes" +
                          (e.kind === "first-results"
                            ? " · first results"
                            : "");
            const county = e.county
              ? (
                  this.panelData(this.findDeskRace(e.race) || {}).counties || []
                ).find((c) => c.fips === e.county)?.name || "County " + e.county
              : null;
            return button(
              e.race,
              `<time>${new Date(e.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET</time><strong>${esc(county || label(this.findDeskRace(e.race)))}</strong><span>${esc(message)}</span>`,
              String(e.id),
              e.county,
            );
          })
          .join("") ||
        "<p>No result changes observed in this session. Awaiting results.</p>";
      const unresolved = all
        .filter((r) => !r.calls?.length)
        .sort(
          (a, b) =>
            Number(!!(b.watch?.watch || b.watch?.tossup)) -
              Number(!!(a.watch?.watch || a.watch?.tossup)) ||
            this.nightMargin(a) - this.nightMargin(b),
        );
      document.getElementById("night-unresolved").innerHTML =
        unresolved
          .slice(0, 20)
          .map((r) =>
            button(
              r.id,
              `<strong>${esc(label(r))}</strong><span>${r.watch?.watch || r.watch?.tossup ? "To watch · " : ""}${N.total(r) ? "Counting · uncalled" : "Awaiting results"}</span>`,
              "unresolved-" + r.id,
            ),
          )
          .join("") || "<p>All races in this office have published calls.</p>";
      if (active)
        drawer
          .querySelector(`[data-activity-key="${CSS.escape(active)}"]`)
          ?.focus({preventScroll:true});
      drawer.scrollTop = drawerScroll;
    });
  };
  p.nightMargin = (r) => {
    const c = [...(r.candidates || [])].sort((a, b) => b.votes - a.votes);
    return N.total(r) && c[1]
      ? (c[0].votes - c[1].votes) / N.total(r)
      : Infinity;
  };
  p.renderSummary = function () {
    old.summary.call(this);
    safe(() => {
      const c = this.deskChamberControl;
      if (!c || c.office === "governor" || !this.activity) return;
      this.controlPrevious ||= new Map();
      if (
        this.controlPrevious.has(c.office) &&
        this.controlPrevious.get(c.office) !== c.party
      )
        this.activity.add(
          { kind: "control", office: c.office, party: c.party },
          Date.now(),
        );
      this.controlPrevious.set(c.office, c.party);
    });
    this.renderNightAwareness();
  };
  p.renderPins = function () {
    old.pins.call(this);
    safe(() => {
      for (const pin of document.querySelectorAll("[data-pin-open]")) {
        const r = this.findDeskRace(pin.dataset.pinOpen);
        if (!r) continue;
        const small = pin.querySelector("small");
        if (r.calls?.length)
          small.textContent = N.source(r.calls[0]) + " PROJECTS";
        const points = N.sparkline(this.liveRaceDetails.get(r.id)?.voteHistory);
        if (points)
          pin.insertAdjacentHTML(
            "beforeend",
            `<svg class="night-spark" viewBox="0 0 100 24" role="img" aria-label="Observed Democratic minus Republican margin over time"><polyline points="${points}"/></svg>`,
          );
        pin.classList.toggle(
          "has-recent-update",
          this.activity?.changed(Date.now(), 60000).includes(r.id),
        );
      }
    });
  };
  p.selectRace = async function (...args) {
    document.body.classList.add("night-loading");
    try {
      return await old.select.apply(this, args);
    } finally {
      document.body.classList.remove("night-loading");
      if (this.windowPreset) {
        const size = N.panelPreset(this.windowPreset, innerWidth, innerHeight);
        if (size) this.setPanelSize(...size);
      }
      this.saveNightView();
    }
  };
  p.clearFocus = function (...args) {
    const value = old.clear.apply(this, args);
    this.saveNightView();
    return value;
  };
  p.switchMode = async function (...args) {
    const value = await old.mode.apply(this, args);
    this.saveNightView();
    return value;
  };
  p.lockCounty = function (...args) {
    const value = old.lock.apply(this, args);
    this.saveNightView();
    return value;
  };
  p.renderFocusedRace = function (race) {
    const start = performance.now();
    old.focus.call(this, race);
    safe(() => {
      if (!race) return;
      const header = document.getElementById("focused-race-title"),
        recent = Date.now() - (this.lastChangeAt || 0) < 12000;
      header.classList.toggle(
        "night-first",
        recent &&
          race.id === this.lastFirstRace &&
          !this.firstAnimationShown.has(race.id),
      );
      if (recent && race.id === this.lastFirstRace)
        this.firstAnimationShown.add(race.id);
      let note = document.getElementById("night-race-update");
      if (!note) {
        note = document.createElement("p");
        note.id = "night-race-update";
        header.after(note);
      }
      note.textContent =
        recent && race.id === this.lastLeadRace
          ? "Lead changed · uncalled"
          : recent && race.id === this.lastFirstRace
            ? "First results received"
            : "";
      if (race.calls?.length) note.textContent = "";
    });
    this.panelUpdateMs = performance.now() - start;
  };
  p.updatePollClock = function (...args) {
    const v = old.clock.apply(this, args);
    this.renderNightAwareness(args[0] || Date.now());
    return v;
  };
  p.showPollClose = function (event, ...args) {
    this.nightWaveAt =
      typeof event.at === "number"
        ? event.at
        : Date.parse(event.at) || Date.now();
    old.close.call(this, event, ...args);
    this.renderNightAwareness();
    clearTimeout(this.waveTimer);
    this.waveTimer = setTimeout(() => {
      this.nightWaveAt = 0;
      this.renderNightAwareness();
    }, 12010);
  };
  p.renderMap = async function (...args) {
    const v = await old.map.apply(this, args);
    this.queueNightLabels();
    return v;
  };
  p.renderCountyDetailMap = function (...args) {
    const v = old.county.apply(this, args);
    this.queueNightLabels();
    return v;
  };
  p.queueNightLabels = function () {
    if (this.labelFrame) return;
    this.labelFrame = requestAnimationFrame(() => {
      this.labelFrame = null;
      this.updateNightLabels();
    });
  };
  p.updateNightLabels = function () {
    safe(() => {
      if (!this.viewport || !this.svg || !this.path) return;
      const projection = this.path.projection();
      if (this.labelProjection !== projection) {
        this.labelProjection = projection;
        this.labelAnchors = new WeakMap();
      }
      const anchor = f => {
        if (!this.labelAnchors.has(f)) this.labelAnchors.set(f, N.projectedAnchor(f, projection));
        return this.labelAnchors.get(f);
      };
      this.viewport.selectAll(".night-geo-labels").remove();
      const transform = this.currentTransform(),
        k = transform.k,
        rows = [];
      const selected = this.currentRace,
        stateFeatures = new Map();
      this.viewport
        .selectAll(
          ".state-result-shape,.house-district-shape,.county-result-shape,.map-context-shape",
        )
        .each((f, i, nodes) => {
          const county = nodes[i].classList.contains("county-result-shape"),
            house = nodes[i].classList.contains("house-district-shape"),
            state = FIPS_TO_STATE[featureStateFipsForElectionNight(f)],
            id = f.properties?.id;
          if (house && k < 2.5) {
            const code = String(id || "").split("-")[0];
            if (/^[A-Z]{2}$/.test(code)) {
              if (!stateFeatures.has(code)) stateFeatures.set(code, []);
              stateFeatures.get(code).push(f);
            }
          }
          const locked =
            county &&
            featureCountyFipsForElectionNight(f) === this.lockedCounty;
          if (
            (house && k < 2.5) ||
            (!county && !house && k > 9)
          )
            return;
          const text = county
              ? f.properties?.NAME || f.properties?.name
              : house
                ? id
                : state,
            point = anchor(f);
          if (!text || !point?.every(Number.isFinite)) return;
          const sx=point[0]*k+transform.x, sy=point[1]*k+transform.y;
          if(sx < -30 || sx > innerWidth+30 || sy < -30 || sy > innerHeight+30)return;
          const width = nodes[i].getBoundingClientRect().width;
          if (county && !locked && width < 65)
            return;
          rows.push({
            id: "geo-" + i,
            text,
            point,
            priority: locked
              ? 100
              : selected &&
                  (selected.state === state || houseGeometryId(selected) === id)
                ? 90
                : county
                  ? 40
                  : house
                    ? 60
                    : 70,
          });
        });
      for (const [state, features] of stateFeatures) {
        const stateFeature = (this.stateFeatures || []).find(f => FIPS_TO_STATE[featureStateFipsForElectionNight(f)] === state);
        const point = stateFeature ? anchor(stateFeature) : anchor(features[0]);
        if (point?.every(Number.isFinite))
          rows.push({
            id: "state-" + state,
            text: state,
            point,
            priority: selected?.state === state ? 90 : 70,
          });
      }
      const layer = this.viewport
        .append("g")
        .attr("class", "night-geo-labels")
        .attr("pointer-events", "none")
        .attr("aria-hidden", "true");
      layer
        .selectAll("text")
        .data(rows)
        .join("text")
        .attr("x", (d) => d.point[0])
        .attr("y", (d) => d.point[1])
        .attr("font-size", Math.max(9, Math.min(14, innerWidth / 120)) / k)
        .attr("text-anchor", "middle")
        .text((d) => d.text);
      const labels = [];
      this.viewport
        .selectAll(".night-geo-labels text,.map-background-city")
        .each((d, i, nodes) => {
          const node = nodes[i];
          node.style.display = "";
          const r = node.getBoundingClientRect();
          labels.push({
            id: i,
            node,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            priority: d.priority || 30,
          });
        });
      const visible = new Set(
        N.visibleLabels(labels, { width: innerWidth, height: innerHeight }),
      );
      for (const l of labels)
        l.node.style.display = visible.has(l.id) ? "" : "none";
    });
  };
  p.renderProjectionQueue = function () {
    const start = performance.now();
    old.projection.call(this);
    this.projectionUpdateMs = performance.now() - start;
  };
  p.initLabDesk = function () {
    old.lab.call(this);
    if (!this.isLabPage || this.query.get("live") === "true") return;
    const tools = document.querySelector(".desk-lab-tools div");
    for (const [kind, text] of [
      ["early", "Early results"],
      ["active", "Active count"],
      ["late", "Late night"],
      ["mass", "15-call burst"],
      ["burst", "9 PM burst"],
      ["six", "Six-hour stress"],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.onclick = () => {
        document.querySelector(".desk-lab-tools").open = false;
        this.runNightScenario(kind);
      };
      tools?.append(b);
    }
  };
  p.runNightScenario = async function (kind) {
    if (!this.isLabPage || this.query.get("live") === "true") return;
    const races = this.modeRaces(),
      before = new Map(races.map((r) => [r.id, structuredClone(r)])),
      now = Date.now(),
      start = performance.now(),
      nodes = document.querySelectorAll("*").length;
    this.nightScenarioNow = Date.parse(
      kind === "late"
        ? "2026-11-04T07:00:00Z"
        : kind === "early"
          ? "2026-11-04T00:05:00Z"
          : "2026-11-04T02:01:00Z",
    );
    this.nightWaveAt = 0;
    if (kind === "mass" || kind === "burst") {
      for (const r of races) r.calls = [];
      this.callTracker.observe(Object.values(this.dataByMode).flat());
    }
    const count =
      kind === "early"
        ? Math.max(1, Math.floor(races.length * 0.08))
        : kind === "mass"
          ? 15
          : kind === "burst"
            ? Math.min(80, races.length)
            : races.length;
    const changed = [];
    for (const [i, r] of races.entries()) {
      if (i >= count) continue;
      for (const [j, c] of (r.candidates || []).entries()) {
        c.votes =
          50000 +
          Math.round(((i + 1) * 127) / (j + 1)) +
          (i % 2 === j ? 4000 : 0);
        c.percent = null;
        c.isWinner = false;
        c.winner = false;
      }
      r.expectedVotePercent = kind === "early" ? 1 : kind === "late" ? 93 : 55;
      if (
        (kind === "late" && i < races.length * 0.8) ||
        (kind === "mass" && i < 15) ||
        (kind === "burst" && i < 5)
      ) {
        const c = [...r.candidates].sort((a, b) => b.votes - a.votes)[0];
        r.calls = [
          {
            candidate: c.name,
            provider: "NBC",
            source: "nbc-auto",
            status: "projected",
            calledAt: new Date(now + i).toISOString(),
          },
        ];
        c.isWinner = c.winner = true;
        r.status = "called";
      } else {
        r.calls = [];
        r.status = "uncalled";
      }
      const cached = this.liveRaceDetails.get(r.id);
      if (cached) {
        Object.assign(cached, {
          candidates: structuredClone(r.candidates),
          calls: r.calls,
          expectedVotePercent: r.expectedVotePercent,
        });
        cached.voteHistory = this.labHistory(cached);
      }
      const events = this.activity.observe(before.get(r.id), r, now);
      if (events.some((e) => e.kind === "first-results")) {
        this.lastFirstRace = r.id;
        this.lastChangeAt = now;
      }
      changed.push(r.id);
    }
    if (kind === "six") {
      const trackerStart = this.activity.items.length,
        heapBefore = performance.memory?.usedJSHeapSize || null,
        target = this.currentRace || races[0];
      if (!this.liveRaceDetails.has(target.id))
        this.liveRaceDetails.set(target.id, { ...target, voteHistory: [] });
      for (let i = 0; i < 1440; i++) {
        const r = target,
          b = structuredClone(r),
          at = now - 21600000 + i * 15000;
        for (const c of r.candidates) c.votes += 17 + (i % 7);
        this.activity.observe(b, r, at);
        const detail = this.liveRaceDetails.get(r.id);
        detail.candidates = structuredClone(r.candidates);
        detail.voteHistory = [
          ...(detail.voteHistory || []),
          {
            at: new Date(at).toISOString(),
            candidates: structuredClone(r.candidates),
            expectedVotePercent: r.expectedVotePercent,
          },
        ].slice(-2400);
        if (i % 60 === 0) {
          this.renderSummary();
          this.updateMapFills(new Set([r.id]));
          if (this.currentRace) this.renderFocusedRace(this.currentRace);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      this.activity.prune(now);
      this.longRunEvidence = {
        simulatedHours: 6,
        updates: 1440,
        activityBefore: trackerStart,
        activityAfter: this.activity.items.length,
        nodesBefore: nodes,
        nodesAfter: document.querySelectorAll("*").length,
        details: this.liveRaceDetails.size,
        raceHistory: this.liveRaceDetails.get(target.id).voteHistory.length,
        countyHistoryCache: this.countyHistories?.size || 0,
        geometryCache: this.countyGeometries.size,
        projectionQueue: this.alertQueue.length,
        elapsedMs: performance.now() - start,
        heapBefore,
        heapAfter: performance.memory?.usedJSHeapSize || null,
      };
    }
    document.body.classList.toggle("night-burst", changed.length > 40);
    const projections = this.callTracker.observe(
      Object.values(this.dataByMode).flat(),
    );
    for (const detail of projections)
      this.events.dispatchEvent(new CustomEvent("call-change", { detail }));
    if (projections.length > 3)
      document.getElementById("projection-announcer").textContent =
        projections.length +
        " projection updates. Open Published calls in the results menu to review them.";
    this.renderSummary();
    this.updateMapFills(new Set(changed));
    if (this.currentRace) this.renderFocusedRace(this.currentRace);
    this.renderNightAwareness();
    document.getElementById("results-provider-status").hidden = false;
    document.getElementById("results-provider-status").textContent =
      "Test board · Synthetic " + kind + " scenario · Not live election data";
    this.nightEvidence = {
      kind,
      changed: changed.length,
      mapMs: Number(document.body.dataset.mapUpdateMs),
      panelMs: this.panelUpdateMs || 0,
      projectionMs: this.projectionUpdateMs || 0,
      activity: this.activity.items.length,
      queue: this.alertQueue.length,
      toastNodes: document.querySelectorAll(".projection-toast").length,
      elapsedMs: performance.now() - start,
      longRun: this.longRunEvidence,
    };
    let report = document.getElementById("night-test-evidence");
    if (!report) {
      report = document.createElement("pre");
      report.id = "night-test-evidence";
      document.querySelector(".desk-lab-tools")?.append(report);
    }
    report.textContent = JSON.stringify(this.nightEvidence, null, 2);
  };
  p.runDeskStage = async function (kind) {
    if (!this.isLabPage || this.query.get("live") === "true") return;
    const before = new Map(
      Object.values(this.dataByMode)
        .flat()
        .map((r) => [r.id, structuredClone(r)]),
    );
    const countyBefore = this.currentRace
      ? structuredClone(this.panelData(this.currentRace))
      : null;
    await old.stage.call(this, kind);
    if (kind === "pre") {
      this.activity = new N.Activity();
      this.firstResultSeen.clear();
      this.firstAnimationShown.clear();
      this.lastFirstRace = null;
      this.lastLeadRace = null;
    } else if (!["close", "idle", "stale", "restored"].includes(kind)) {
      for (const r of Object.values(this.dataByMode).flat()) {
        const events = this.activity.observe(before.get(r.id), r, Date.now());
        if (events.some((e) => e.kind === "leader")) this.lastLeadRace = r.id;
        if (
          events.some((e) => e.kind === "first-results") &&
          !this.firstResultSeen.has(r.id)
        ) {
          this.firstResultSeen.add(r.id);
          this.lastFirstRace = r.id;
        }
        if (events.length) this.lastChangeAt = Date.now();
      }
      if (this.currentRace)
        this.observeCountyUpdate(
          countyBefore,
          this.panelData(this.currentRace),
        );
    }
    this.renderPins();
    if (this.currentRace) this.renderFocusedRace(this.currentRace);
    this.renderNightAwareness();
  };
};
