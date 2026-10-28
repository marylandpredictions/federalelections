/* Additional desk behavior composes with the existing map and public call system. */
window.FEACompleteBoard = function (Page) {
  const p = Page.prototype,
    T = FEADeskTheme,
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
  const label = (r) =>
    FEAResultsUI.raceLabel({ ...r, stateName: STATE_NAMES[r.state] });
  const original = {
    init: p.init,
    bind: p.bindEvents,
    focused: p.renderFocusedRace,
    summary: p.renderSummary,
    select: p.selectRace,
    refresh: p.refreshResults,
    queue: p.queueProjection,
    results: p.resultsMarkup,
    map: p.renderMap,
    clear: p.clearFocus,
    pulse: p.pulseRace,
    lab: p.initLabDesk,
    status: p.renderProviderStatus,
    projection: p.renderProjectionQueue,
    trend: p.renderTrendChart,
    fills: p.updateMapFills,
    county: p.renderCountyDetailMap,
  };
  p.init = async function () {
    this.outlineMode = 'next';
    try { if (localStorage.getItem('feaDeskOutlines.v1') === 'watch') this.outlineMode = 'watch'; } catch {}
    const outlineSelect=document.getElementById('desk-outline-mode');
    if(outlineSelect) outlineSelect.value=this.outlineMode;
    this.pinnedIds = [];
    try {
      const x = JSON.parse(localStorage.getItem("feaDeskPins.v1"));
      if (Array.isArray(x))
        this.pinnedIds = [
          ...new Set(x.filter((i) => typeof i === "string")),
        ].slice(0, 12);
    } catch {}
    this.appearance = FEAAppearance();
    this.lastPollClock = Date.now();
    this.pollEventsSeen = new Set();
    const tray = document.createElement("section");
    tray.id = "desk-pins";
    tray.setAttribute("aria-label", "Pinned races");
    tray.hidden = true;
    document.querySelector("main").append(tray);
    const clock = document.createElement("div");
    clock.id = "desk-poll-clock";
    clock.setAttribute("aria-live", "off");
    document.querySelector("main").append(clock);
    const alert = document.createElement("div");
    alert.id = "desk-poll-alert";
    alert.setAttribute("role", "status");
    alert.hidden = true;
    document.querySelector("main").append(alert);
    const legend = document.createElement("div");
    legend.id = "desk-map-legend";
    legend.setAttribute("aria-label", "Map legend");
    legend.innerHTML =
      '<span class="legend-neutral">No votes</span><span class="legend-leading">Leading</span><span class="legend-called">Called ✓</span><span id="desk-outline-legend" class="legend-outline">Next poll closes</span>';
    document.querySelector("main").append(legend);
    await original.init.call(this);
    this.loadEvidence = {
      timeToUsableMapMs: Math.round(performance.now()),
      resources: performance
        .getEntriesByType("resource")
        .filter((r) => r.name.startsWith(location.origin))
        .map((r) => ({
          file: new URL(r.name).pathname,
          transfer: r.transferSize,
          encoded: r.encodedBodySize,
          decoded: r.decodedBodySize,
          durationMs: Math.round(r.duration),
        })),
    };
    document.body.dataset.mapUsableMs = String(
      this.loadEvidence.timeToUsableMapMs,
    );
    document.body.dataset.initialOwnEncodedBytes = String(
      this.loadEvidence.resources.reduce((sum, r) => sum + r.encoded, 0),
    );
    this.pollSchedule = await this.safeJson("data/results/poll-closes.json");
    this.updatePollClock();
    this.clockTimer = setInterval(() => {
      if (!document.hidden) this.updatePollClock();
    }, 30000);
    this.renderPins();
    this.renderProviderStatus(this.publicProvider);
    document.body.classList.toggle("desk-obs", this.query.get("obs") === "1");
    window.addEventListener(
      "pagehide",
      () => {
        clearTimeout(this.livePollTimer);
        clearInterval(this.clockTimer);
        clearTimeout(this.outlineTimer);
      },
      { once: true },
    );
  };
  p.renderProviderStatus = function (provider) {
    original.status.call(this, provider);
    if (
      !this.isLabPage &&
      Date.now() < Date.parse("2026-11-03T05:00:00Z") &&
      !Object.values(this.dataByMode)
        .flat()
        .some((r) => FEADesk.total(r))
    )
      document.getElementById("results-provider-status").hidden = true;
  };
  p.updateMapFills = function (...args) {
    const start = performance.now();
    const result = original.fills.apply(this, args);
    this.updateRaceOutlines();
    document.body.dataset.mapUpdateMs = (performance.now() - start).toFixed(2);
    return result;
  };
  p.renderMap = async function (...args) {
    const result=await original.map.apply(this,args);
    this.updateRaceOutlines();
    return result;
  };
  p.renderCountyDetailMap = function (...args) {
    const result=original.county.apply(this,args);
    this.updateRaceOutlines();
    return result;
  };
  p.updateRaceOutlines = function (now=Date.now()) {
    const races=this.modeRaces?.() || [],next=FEADesk.nextPollClosures(races,this.pollSchedule,now);
    this.outlineRaceIds=new Set(FEADesk.raceOutlineIds(races,this.pollSchedule,this.outlineMode,now));
    this.viewport?.selectAll('.state-result-shape,.house-district-shape,.map-context-shape').classed('is-competitive-race',feature=>{
      const id=feature.properties?.id;
      if(this.selectedMode==='house' && /^[A-Z]{2}-(?:\d+|AL)$/.test(id || ''))return this.outlineRaceIds.has(raceIdFromHouseGeometryId(id));
      const state=FIPS_TO_STATE[featureStateFipsForElectionNight(feature)];
      return races.some(r=>r.state===state && this.outlineRaceIds.has(r.id));
    });
    const legend=document.getElementById('desk-outline-legend');
    if(legend)legend.textContent=this.outlineMode==='watch'?'Races to watch':next.at?'Next poll closes · '+new Date(next.at).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'})+' ET':this.pollSchedule?'No upcoming poll closes':'Poll-close schedule unavailable';
    clearTimeout(this.outlineTimer);
    if(next.at && this.outlineMode!=='watch')this.outlineTimer=setTimeout(()=>this.updatePollClock(),Math.min(2147483647,Math.max(1,next.at-now)));
  };
  p.pulseRace = function (race) {
    if (!document.hidden && !this.suppressDeskEvents)
      original.pulse.call(this, race);
  };
  p.renderProjectionQueue = function () {
    original.projection.call(this);
    for (const card of document.querySelectorAll(".projection-toast")) {
      const event = this.alertQueue.find(
        (e) => e.key === card.dataset.eventKey,
      );
      if (!event) continue;
      const candidate = event.race.candidates?.find(
        (c) => c.name === event.call?.candidate,
      );
      card.style.setProperty(
        "--party-accent",
        candidate
          ? T.candidateColor(candidate, event.race.candidates)
          : T.resolved.tokens.warning,
      );
    }
  };
  p.initLabDesk = function () {
    original.lab.call(this);
    if (!this.isLabPage || this.query.get("live") === "true") return;
    const tools = document.querySelector(".desk-lab-tools div");
    for (const [id, name] of [
      ["pre", "Pre-election"],
      ["close", "Polls close"],
      ["first", "1% reporting"],
      ["leader", "Leader change"],
      ["county", "County update"],
      ["control", "House control"],
      ["restored", "Restored feed"],
      ["stale", "Stale snapshot"],
      ["soak", "Simulate four hours"],
      ["idle", "Measure idle activity"],
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = name;
      button.onclick = () => {
        document.querySelector(".desk-lab-tools").open = false;
        this.runDeskStage(id);
      };
      tools.append(button);
    }
  };
  p.runDeskStage = async function (kind) {
    if (!this.isLabPage || this.query.get("live") === "true") return;
    if (kind === "idle") {
      this.idleObserver?.disconnect();
      const tasks = [];
      let observer;
      try {
        observer = new PerformanceObserver((list) =>
          tasks.push(...list.getEntries().map((e) => e.duration)),
        );
        observer.observe({ type: "longtask", buffered: false });
        this.idleObserver = observer;
      } catch {}
      const start = performance.now(),
        nodes = document.querySelectorAll("*").length;
      const status = document.getElementById("results-provider-status");
      status.textContent = "Test board · Measuring 30 seconds of idle activity";
      clearTimeout(this.idleProbeTimer);
      this.idleProbeTimer = setTimeout(() => {
        observer?.disconnect();
        this.idleEvidence = {
          durationMs: Math.round(performance.now() - start),
          longTasks: tasks.length,
          longTaskMs: Math.round(tasks.reduce((a, b) => a + b, 0)),
          nodesBefore: nodes,
          nodesAfter: document.querySelectorAll("*").length,
          motion: T.current.motion,
          note: "Main-thread tasks longer than 50ms only; not a GPU or total CPU measurement.",
        };
        this.showLabEvidence();
        status.textContent = "Test board · Idle measurement complete";
      }, 30000);
      return;
    }
    if (kind === "close") {
      this.showPollClose({ states: ["OH", "NC", "WV"] }, true);
      return;
    }
    const status = document.getElementById("results-provider-status");
    status.hidden = false;
    status.textContent =
      "Test board · Simulated " +
      ({
        pre: "pre-election",
        first: "first results",
        leader: "leader change",
        county: "county update",
        control: "House control",
        restored: "restored results",
        stale: "stale snapshot",
        soak: "four-hour session running",
      }[kind] || kind);
    if (["stale", "restored"].includes(kind)) return;
    if (!this.currentRace && kind !== "control" && kind !== "pre")
      await this.openDashboardRace("senate-OH");
    const all = Object.values(this.dataByMode).flat(),
      race = this.currentRace;
    if (kind === "pre") {
      for (const r of all) {
        r.calls = [];
        r.candidates.forEach((c) => {
          c.votes = 0;
          c.percent = 0;
          c.isWinner = false;
        });
        r.expectedVotePercent = null;
        for (const county of r.counties || [])
          for (const c of county.candidates || []) {
            c.votes = 0;
            c.percent = 0;
          }
      }
      this.liveRaceDetails.clear();
      this.countyHistories?.clear();
      this.query.set("phase", "pre_election");
    } else if (kind === "control") {
      if (this.selectedMode !== "house") await this.switchMode("house");
      let count = 0;
      for (const r of this.dataByMode.house) {
        const d = r.candidates.find((c) => c.party === "D");
        if (d && count < 218) {
          r.calls = [
            {
              candidate: d.name,
              provider: "NBC",
              source: "nbc-auto",
              status: "projected",
            },
          ];
          count++;
        } else r.calls = [];
      }
      status.textContent =
        "Test board · Simulated " + count + " Democratic House calls";
    } else {
      const data = this.panelData(race);
      this.query.set("phase", "reporting");
      this.seedSimulatedRace(data, kind === "first" ? 1 : 45);
      if (kind === "leader" && data.candidates.length > 1) {
        const c = data.candidates.at(-1),
          max = Math.max(...data.candidates.map((c) => c.votes));
        c.votes = max + 9000;
      }
      data.calls = [];
      if (data.counties?.length && kind === "county")
        for (const c of data.counties.slice(0, 3))
          for (const k of c.candidates) k.votes += 450;
      const sample = (at) => ({
        at,
        expectedVotePercent: data.expectedVotePercent,
        candidates: structuredClone(data.candidates),
      });
      data.voteHistory = [
        ...(data.voteHistory || []),
        sample(new Date().toISOString()),
      ].slice(-2400);
      this.liveRaceDetails.set(data.id, data);
      Object.assign(race, {
        candidates: data.candidates,
        calls: [],
        expectedVotePercent: data.expectedVotePercent,
      });
      if (kind === "soak") {
        const start = Date.now(),
          at = Date.parse(data.voteHistory.at(-1)?.at) || Date.now(),
          beforeNodes = document.querySelectorAll("*").length;
        for (let i = 1; i <= 960; i++) {
          for (const c of data.candidates) c.votes += 20 + (i % 7);
          data.voteHistory.push(sample(new Date(at + i * 15000).toISOString()));
          if (data.voteHistory.length > 2400) data.voteHistory.shift();
          if (i % 20 === 0) {
            if (this.currentRace?.id !== data.id) break;
            this.renderFocusedRace(race);
            this.updateMapFills(new Set([data.id]));
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        const result = {
          simulatedHours: 4,
          samples: 960,
          historyPoints: data.voteHistory.length,
          retainedRaceDetails: this.liveRaceDetails.size,
          projectionQueue: this.alertQueue.length,
          beforeNodes,
          afterNodes: document.querySelectorAll("*").length,
          elapsedMs: Date.now() - start,
        };
        this.soakEvidence = result;
        this.showLabEvidence();
        status.textContent =
          "Test board · Four-hour simulation complete · " +
          result.historyPoints +
          " history points · " +
          result.afterNodes +
          " DOM nodes";
      }
    }
    this.renderSummary();
    this.updateMapFills(new Set(all.map((r) => r.id)));
    if (this.currentRace) this.renderFocusedRace(this.currentRace);
  };
  p.showLabEvidence = function () {
    let node = document.getElementById("desk-lab-evidence");
    if (!node) {
      node = document.createElement("details");
      node.id = "desk-lab-evidence";
      node.innerHTML = "<summary>Test measurements</summary><pre></pre>";
      document.querySelector("main").append(node);
    }
    node.querySelector("pre").textContent = JSON.stringify(
      {
        load: this.loadEvidence,
        themeApplyMs: Number(document.body.dataset.themeApplyMs) || null,
        soak: this.soakEvidence,
        idle: this.idleEvidence,
      },
      null,
      2,
    );
  };
  p.renderTrendChart = async function () {
    const focused = this.trendFocusLabel;
    await original.trend.call(this);
    if (focused) {
      const nodes = [...document.querySelectorAll(".trend-point")],
        target = nodes.find((n) => n.getAttribute("aria-label") === focused);
      if (target) {
        for (const n of nodes) n.setAttribute("tabindex", "-1");
        target.setAttribute("tabindex", "0");
        target.focus();
      }
      this.trendFocusLabel = null;
    }
  };
  p.bindEvents = function () {
    original.bind.call(this);
    document.getElementById('desk-outline-mode')?.addEventListener('change',event=>{
      this.outlineMode=event.target.value==='watch'?'watch':'next';
      try { localStorage.setItem('feaDeskOutlines.v1',this.outlineMode); } catch {}
      this.updateRaceOutlines();
    });
    document
      .querySelector("[data-desk-appearance]")
      ?.addEventListener("click", () => {
        document.getElementById("board-menu").hidden = true;
        document
          .getElementById("board-menu-button")
          .setAttribute("aria-expanded", "false");
        this.appearance.open();
      });
    document.addEventListener("fea-desk-theme", () => {
      const themeStart = performance.now();
      if (!this.dataByMode) return;
      this.updateMapFills(
        new Set(
          Object.values(this.dataByMode)
            .flat()
            .map((r) => r.id),
        ),
      );
      this.renderSummary();
      this.renderProjectionQueue();
      if (this.currentRace) this.renderFocusedRace(this.currentRace);
      this.renderPins();
      document.body.dataset.themeApplyMs = (
        performance.now() - themeStart
      ).toFixed(2);
    });
    document
      .querySelector("#focused-race-panel")
      ?.addEventListener("click", (event) => {
        if (event.target.closest("[data-pin-race]") && this.currentRace)
          this.togglePin(this.currentRace.id);
      });
    document
      .getElementById("desk-pins")
      .addEventListener("click", async (event) => {
        const remove = event.target.closest("[data-unpin]");
        if (remove) {
          this.togglePin(remove.dataset.unpin);
          return;
        }
        const pin = event.target.closest("[data-pin-open]");
        if (pin) {
          const race = this.findDeskRace(pin.dataset.pinOpen);
          if (race) {
            if (this.selectedMode !== race.type)
              await this.switchMode(race.type);
            await this.selectRace(race);
          }
        }
      });
    document
      .getElementById("focused-race-content")
      .addEventListener("change", (event) => {
        if (event.target.matches("[data-county-sort]")) {
          this.countySort = event.target.value;
          this.renderFocusedRace(this.currentRace);
          document.querySelector("[data-county-sort]")?.focus();
        }
      });
    const active = () => {
      document.body.classList.add("desk-interacting");
      clearTimeout(this.interactionTimer);
      this.interactionTimer = setTimeout(
        () => document.body.classList.remove("desk-interacting"),
        600,
      );
    };
    document
      .getElementById("election-map")
      .addEventListener("pointerdown", active, { passive: true });
    document
      .getElementById("election-map")
      .addEventListener("wheel", active, { passive: true });
    document
      .querySelector(".focus-resize-handle")
      .addEventListener("pointerdown", active, { passive: true });
    document.addEventListener("visibilitychange", () => {
      document.body.classList.toggle("desk-hidden", document.hidden);
      clearTimeout(this.livePollTimer);
      this.alertQueue.splice(0);
      this.renderProjectionQueue();
      this.suppressDeskEvents = true;
      if (!document.hidden) {
        this.updatePollClock();
        this.pollDeskNow();
      } else this.scheduleDeskPoll();
    });
    this.events.addEventListener("call-change", () => this.renderPins());
  };
  p.findDeskRace = function (id) {
    return Object.values(this.dataByMode)
      .flat()
      .find((r) => r.id === id);
  };
  p.togglePin = function (id) {
    this.pinnedIds = this.pinnedIds.includes(id)
      ? this.pinnedIds.filter((i) => i !== id)
      : [...this.pinnedIds, id].slice(-12);
    try {
      localStorage.setItem("feaDeskPins.v1", JSON.stringify(this.pinnedIds));
    } catch {}
    this.renderPins();
    if (this.currentRace) this.renderFocusedRace(this.currentRace);
  };
  p.renderPins = function () {
    const tray = document.getElementById("desk-pins");
    if (!tray) return;
    const active = tray.contains(document.activeElement)
        ? document.activeElement
        : null,
      focusId = active?.dataset.pinOpen,
      removeId = active?.dataset.unpin;
    const races = this.pinnedIds
      .map((id) => this.findDeskRace(id))
      .filter(Boolean);
    tray.hidden = !races.length;
    tray.innerHTML = races
      .map((r) => {
        const list = [...(r.candidates || [])].sort(
            (a, b) => b.votes - a.votes,
          ),
          a = list[0],
          b = list[1],
          total = FEADesk.total(r),
          margin =
            total && b
              ? (((a.votes - b.votes) / total) * 100).toFixed(1)
              : null;
        return `<div class="desk-pin"><button type="button" data-pin-open="${esc(r.id)}"><strong>${esc(label(r))}</strong><span>${esc(r.calls?.[0]?.candidate || (total ? a?.name : "Awaiting results"))}</span><small>${r.calls?.length ? "Called ✓" : total ? "Leading" + (margin ? " · +" + margin + " pts" : "") : "Pre-election"}${r.expectedVotePercent != null ? " · " + Number(r.expectedVotePercent).toFixed(0) + "% expected vote" : ""}</small></button><button type="button" data-unpin="${esc(r.id)}" aria-label="Unpin ${esc(label(r))}">×</button></div>`;
      })
      .join("");
    if (active) {
      const selector = focusId ? "[data-pin-open]" : "[data-unpin]",
        target = [...tray.querySelectorAll(selector)].find(
          (n) =>
            (focusId ? n.dataset.pinOpen : n.dataset.unpin) ===
            (focusId || removeId),
        );
      target?.focus();
    }
  };
  p.renderFocusedRace = function (race) {
    if (document.activeElement?.classList.contains("trend-point"))
      this.trendFocusLabel = document.activeElement.getAttribute("aria-label");
    const content = document.getElementById("focused-race-content"),
      old = new Map(
        [...content.querySelectorAll("[data-bar-id]")].map((n) => [
          n.dataset.barId,
          n.style.width,
        ]),
      );
    original.focused.call(this, race);
    if (!race) return;
    let pin = document.querySelector("[data-pin-race]");
    if (!pin) {
      pin = document.createElement("button");
      pin.type = "button";
      pin.dataset.pinRace = "";
      document
        .querySelector(".focused-card-head")
        .insertBefore(pin, document.querySelector(".focused-close"));
    }
    pin.textContent = this.pinnedIds.includes(race.id) ? "Pinned" : "Pin";
    pin.setAttribute(
      "aria-label",
      (this.pinnedIds.includes(race.id) ? "Unpin " : "Pin ") + label(race),
    );
    pin.setAttribute("aria-pressed", String(this.pinnedIds.includes(race.id)));
    if (this.focusedPanelTab === "counties" && !this.lockedCounty) {
      const rows = this.panelData(race).counties || [];
      const select = document.createElement("label");
      select.className = "county-sort";
      select.innerHTML =
        'Sort counties <select data-county-sort aria-label="Sort counties"><option value="name">Name</option><option value="votes">Votes counted</option><option value="margin">Closest margin</option><option value="reporting">Expected vote in</option></select>';
      content.querySelector(".county-list")?.before(select);
      select.querySelector("select").value = this.countySort || "name";
      const sort = this.countySort || "name";
      rows.sort((a, b) =>
        sort === "votes"
          ? FEADesk.total(b) - FEADesk.total(a)
          : sort === "margin"
            ? deskLeaderMargin(a) - deskLeaderMargin(b)
            : sort === "reporting"
              ? (b.estimatedVoteReporting ?? -1) -
                (a.estimatedVoteReporting ?? -1)
              : a.name.localeCompare(b.name),
      );
      const list = content.querySelector(".county-list");
      if (list) {
        list.replaceChildren();
        for (const c of rows) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.countyFips = c.fips;
          const ordered = [...(c.candidates || [])].sort(
            (a, b) => b.votes - a.votes,
          );
          button.innerHTML = `<span>${esc(c.name)}<small>${esc(FEADesk.total(c) ? ordered[0]?.name : "Awaiting results")}</small></span><strong>${FEADesk.total(c).toLocaleString()}<small>${Number.isFinite(deskLeaderMargin(c)) ? "+" + deskLeaderMargin(c).toFixed(1) + " pts" : ""}${c.estimatedVoteReporting != null ? " · " + Number(c.estimatedVoteReporting).toFixed(0) + "% in" : ""}</small></strong>`;
          list.append(button);
        }
      }
    }
    if (
      T.current.motion !== "reduced" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      for (const bar of content.querySelectorAll("[data-bar-id]")) {
        const target = bar.style.width,
          previous = old.get(bar.dataset.barId);
        if (previous && previous !== target) {
          bar.style.width = previous;
          requestAnimationFrame(() => (bar.style.width = target));
        }
      }
  };
  const deskLeaderMargin = (row) => {
    const c = [...(row.candidates || [])].sort((a, b) => b.votes - a.votes),
      n = FEADesk.total(row);
    return n && c[1] ? ((c[0].votes - c[1].votes) / n) * 100 : Infinity;
  };
  p.resultsMarkup = function (data) {
    const total = FEADesk.total(data);
    let close = this.pollSchedule?.events?.find((e) =>
      e.states.includes(data.state),
    );
    const districtSchedule =
      data.type === "house" &&
      this.pollSchedule?.districtExceptions?.[data.state];
    if (districtSchedule)
      close = {
        at: districtSchedule[data.district] || districtSchedule.default,
      };
    const context = !total
      ? `<p class="desk-preelection"><strong>${Date.now() < Date.parse("2026-11-03T05:00:00Z") ? "Election Day · November 3" : "Awaiting first results"}</strong><span>${close ? "Scheduled poll close " + new Date(close.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) + " ET" : "Poll-close time not yet verified for this state."}</span></p>`
      : "";
    const roster = !data.candidates?.length
      ? '<p class="desk-hint">Ballot roster is awaiting verification.</p>'
      : data.rosterIncomplete
        ? '<p class="desk-hint">Ballot roster completeness is being verified.</p>'
        : "";
    return (
      context +
      roster +
      original.results.call(this, data) +
      (data.type === "house" && this.isComparisonActive()
        ? '<p class="desk-hint">District baseline unavailable unless an exact matching district source is verified.</p>'
        : "")
    );
  };
  p.renderSummary = function () {
    original.summary.call(this);
    this.renderPins();
    const races = this.modeRaces(),
      called = races.filter((r) => r.calls?.length),
      leading = races.filter((r) => !r.calls?.length && FEADesk.total(r) > 0),
      seats = { D: 0, R: 0, I: 0, O: 0 };
    for (const r of called) {
      const c = r.candidates.find((c) => c.name === r.calls[0].candidate);
      const party = c?.partyCode || c?.party;
      seats[["D", "R", "I"].includes(party) ? party : "O"]++;
    }
    const board = document.querySelector(".election-chamber-board");
    let key = JSON.stringify([this.selectedMode, seats]);
    if (this.lastChamberKey && this.lastChamberKey !== key) {
      board.classList.remove("seat-call-update");
      requestAnimationFrame(() => board.classList.add("seat-call-update"));
    }
    this.lastChamberKey = key;
    let caption = board.querySelector(".desk-chamber-caption");
    if (!caption) {
      caption = document.createElement("p");
      caption.className = "desk-chamber-caption";
      board.append(caption);
    }
    caption.textContent = `${called.length} called · ${leading.length} leading, uncalled · ${races.length - called.length - leading.length} awaiting votes${seats.I || seats.O ? " · " + (seats.I + seats.O) + " I/Other called" : ""}`;
    const held =
        this.selectedMode === "senate"
          ? SENATE_NOT_UP_BY_PARTY
          : { D: 0, R: 0 },
      threshold = this.selectedMode === "house" ? 218 : 51;
    let control =
      seats.D + held.D >= threshold
        ? "D"
        : seats.R + held.R >= (this.selectedMode === "senate" ? 50 : 218)
          ? "R"
          : null;
    if (this.selectedMode !== "governor" && control)
      caption.textContent +=
        " · " + (control === "D" ? "Democratic" : "Republican") + " control";
    const bar = document.querySelector(".election-chamber-bar");
    if (this.selectedMode === "senate")
      document.getElementById("chamber-majority-label").innerHTML =
        "<b>Control · D 51 / R 50 + VP</b>";
    if (this.selectedMode !== "governor") {
      const total = this.selectedMode === "house" ? 435 : 100,
        other = seats.I + seats.O,
        unresolved = Math.max(0, races.length - called.length),
        uncalled = document.getElementById("chamber-bar-uncalled");
      uncalled.style.width = (unresolved / total) * 100 + "%";
      let extra = bar.querySelector(".chamber-other");
      if (!extra) {
        extra = document.createElement("span");
        extra.className = "election-chamber-segment chamber-other";
        uncalled.before(extra);
      }
      extra.style.width = (other / total) * 100 + "%";
      extra.title = other + " Independent/Other called";
      const counts = { D: 0, R: 0, O: 0 };
      for (const race of leading) {
        const c = [...race.candidates].sort((a, b) => b.votes - a.votes)[0],
          party = c?.partyCode || c?.party;
        counts[["D", "R"].includes(party) ? party : "O"]++;
      }
      uncalled.innerHTML = ["D", "R", "O"]
        .map(
          (party) =>
            '<span class="chamber-leading chamber-leading-' +
            party +
            '" style="width:' +
            (unresolved ? (counts[party] / unresolved) * 100 : 0) +
            '%" title="' +
            counts[party] +
            " " +
            party +
            ' leading, uncalled"></span>',
        )
        .join("");
    } else bar.querySelector(".chamber-other")?.remove();
    bar.setAttribute("aria-label", caption.textContent);
    bar.title =
      "Called seats and seats not up are resolved. Leading races remain uncalled.";
  };
  p.queueProjection = function (event) {
    if (document.hidden || this.suppressDeskEvents) return;
    if (this.alertQueue.length >= 600) this.alertQueue.shift();
    original.queue.call(this, event);
  };
  p.scheduleDeskPoll = function () {
    clearTimeout(this.livePollTimer);
    if (this.isLabPage && this.query.get("live") !== "true") return;
    const pre =
      Date.now() < Date.parse("2026-11-03T05:00:00Z") &&
      !Object.values(this.dataByMode)
        .flat()
        .some((r) => FEADesk.total(r));
    this.livePollTimer = setTimeout(
      () => this.pollDeskNow(),
      document.hidden ? 120000 : pre ? 60000 : 15000,
    );
  };
  p.pollDeskNow = async function () {
    try {
      await this.refreshResults();
    } finally {
      this.suppressDeskEvents = false;
      this.scheduleDeskPoll();
    }
  };
  p.refreshResults = function () {
    if (this.deskRefreshPromise) return this.deskRefreshPromise;
    this.deskRefreshPromise = Promise.resolve(
      original.refresh.call(this),
    ).finally(() => (this.deskRefreshPromise = null));
    return this.deskRefreshPromise;
  };
  p.updatePollClock = function (now = Date.now(), simulated = false) {
    this.updateRaceOutlines(now);
    const node = document.getElementById("desk-poll-clock"),
      events = this.pollSchedule?.events || [];
    if (!node) return;
    const nextClose = FEADesk.nextPollClosures(this.modeRaces?.() || [],this.pollSchedule,now).at,
      upcoming = nextClose ? {at:nextClose} : null,
      days = Math.ceil((Date.parse("2026-11-03T05:00:00Z") - now) / 86400000);
    node.textContent =
      days > 0
        ? `November 3 · ${days} ${days === 1 ? "day" : "days"} to Election Day`
        : upcoming
          ? `Next scheduled close · ${new Date(upcoming.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })} ET · ${upcoming.states.join(", ")}`
          : this.pollSchedule?.events?.length ? "Scheduled polls closed · results continue" : "Poll-close schedule unavailable";
    node.title =
      "Scheduled closing times can be extended. Voters in line may still vote. Verified schedule coverage: " +
      (this.pollSchedule?.coverage || "pending");
    for (const event of events) {
      const at = Date.parse(event.at);
      if (
        at > this.lastPollClock &&
        at <= now &&
        now - at < 120000 &&
        !this.pollEventsSeen.has(event.at)
      ) {
        this.pollEventsSeen.add(event.at);
        this.showPollClose(event, simulated);
      }
    }
    this.lastPollClock = now;
  };
  p.showPollClose = function (event, simulated = false) {
    const alert = document.getElementById("desk-poll-alert");
    alert.textContent = `${simulated ? "Simulation · " : ""}Scheduled polls closed — ${event.states.join(", ")}. Voters in line may still vote.`;
    alert.hidden = false;
    clearTimeout(this.pollAlertTimer);
    this.pollAlertTimer = setTimeout(() => (alert.hidden = true), 12000);
    this.viewport
      ?.selectAll(".state-result-shape")
      .filter((f) =>
        event.states.includes(
          FIPS_TO_STATE[featureStateFipsForElectionNight(f)],
        ),
      )
      .classed("poll-close-pulse", true);
  };
};
