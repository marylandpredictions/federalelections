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
    raceColor: p.comparisonColorForRace,
    countyColor: p.comparisonColorForCounty,
    tooltip: p.showTooltip,
    extent: p.mapExtent,
    mode: p.switchMode,
    lock: p.lockCounty,
  };
  p.init = async function () {
    // A permanent reserved row prevents a delayed-feed notice from changing
    // map dimensions or covering the masthead, menus, race card or navigation.
    const notice=document.getElementById('results-provider-status');
    if(notice&&!document.getElementById('desk-status-rail')){
      const rail=document.createElement('footer');rail.id='desk-status-rail';
      const label=document.createElement('span');label.id='desk-feed-label';label.textContent='Reported results';
      notice.classList.remove('board-delay');notice.classList.add('feed-notice');rail.append(label,notice);document.body.append(rail);document.body.classList.add('has-status-rail');
    }
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
    this.currentPresentation = T.current.presentation;
    this.lastPollClock = Date.now();
    this.pollEventsSeen = new Set();
    this.pollSeenStorageKey=this.isLabPage&&this.query.get('live')!=='true'?'feaPollCloseSeen.lab.v1':'feaPollCloseSeen.v1';
    try {this.pollEventsSeen=new Set(JSON.parse(sessionStorage.getItem(this.pollSeenStorageKey)||'[]'));}catch{}
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
    const masthead = document.createElement('header'); masthead.id = 'desk-masthead';
    masthead.innerHTML = '<span class="desk-publication"><img src="assets/img/FEA_Icon.webp" alt="Federal Elections Analysis" width="96" height="96"></span><strong id="desk-edition-title">Election Results 2026</strong><span class="desk-edition-note">Reported results · November 3</span>';
    document.querySelector('main').prepend(masthead);
    const index = document.createElement('aside'); index.id = 'desk-race-index'; index.setAttribute('aria-label','Races to watch');
    document.querySelector('main').append(index);
    const historyNote = document.createElement('p'); historyNote.id = 'desk-history-map-note'; historyNote.hidden = true; historyNote.setAttribute('role','status');
    document.querySelector('main').append(historyNote);
    await original.init.call(this);
    this.loadEvidence = {
      timeToUsableMapMs: Math.round(performance.now()),
      navigationEncodedBytes:performance.getEntriesByType('navigation')[0]?.encodedBodySize||0,
      navigationTransferBytes:performance.getEntriesByType('navigation')[0]?.transferSize||0,
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
      this.loadEvidence.navigationEncodedBytes+this.loadEvidence.resources.reduce((sum, r) => sum + r.encoded, 0),
    );
    document.body.dataset.initialOwnTransferBytes=String(this.loadEvidence.navigationTransferBytes+this.loadEvidence.resources.reduce((sum,r)=>sum+r.transfer,0));
    this.pollSchedule = await this.safeJson("data/results/poll-closes.json");
    // Optional context must never block live result refresh or a race opening.
    this.safeJson('data/results/polling-reference.json').then(data=>{this.pollingReference=data;if(this.currentRace)this.renderFocusedRace(this.currentRace);}).catch(()=>{});
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
        clearTimeout(this.pollAlertTimer);
        clearTimeout(this.pollPulseTimer);
      },
      { once: true },
    );
  };
  p.renderProviderStatus = function (provider) {
    original.status.call(this, provider);
    const notice=document.getElementById('results-provider-status'),feedLabel=document.getElementById('desk-feed-label');
    if(notice)notice.title=notice.textContent;
    if(feedLabel)feedLabel.textContent=this.isLabPage&&this.query.get('live')!=='true'?'SIMULATED RESULTS':provider?.fallbackRaceCount?'NBC News · CivicAPI fallback active':'Reported results · NBC News';
    let link=document.getElementById('desk-nbc-results');
    const pages=provider?.publicResultsPages||this.publicProvider?.publicResultsPages;
    const page=pages?.[this.selectedMode]||provider?.publicResultsUrl||this.publicProvider?.publicResultsUrl;
    let safe=null;try{const u=new URL(page);if(u.protocol==='https:'&&['www.nbcnews.com','nbcnews.com'].includes(u.hostname)&&!u.port&&!u.username&&!u.password)safe=u.href;}catch{}
    const menu=document.getElementById('board-menu');
    if(safe&&menu){if(!link){link=document.createElement('a');link.id='desk-nbc-results';link.textContent='NBC 2026 results';link.target='_blank';link.rel='noopener noreferrer';menu.append(link);}link.textContent=pages?.[this.selectedMode]?`NBC ${this.selectedMode==='governor'?'Governor':this.selectedMode==='senate'?'Senate':'House'} results`:'NBC 2026 results';link.href=safe;link.hidden=false;}else if(link)link.hidden=true;
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
    this.reflectHistoricalLens();
    this.updateRaceOutlines();
    return result;
  };
  p.renderCountyDetailMap = function (...args) {
    const result=original.county.apply(this,args);
    this.reflectHistoricalLens();
    if(this.pastMapSource)this.updateMapFills(new Set([args[0].id]));
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
    if(next.at)this.outlineTimer=setTimeout(()=>this.updatePollClock(),Math.min(2147483647,Math.max(1,next.at-now)));
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
      this.nightScenarioNow=Date.now();
      this.showPollClose({ at:Date.now(),states: ["OH", "NC", "WV"] }, true);
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
      this.nightScenarioNow=null;this.nightWaveAt=0;
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
    const content=document.getElementById('focused-race-content');
    const key=`${this.currentRace?.id}:${this.focusedPanelTab}:${this.lockedCounty || ''}`;
    const pending=this.trendScrollRestore;
    const top=pending?.key===key?pending.top:content?.scrollTop;
    const interaction=this.trendScrollInteraction||0;
    const rendering=original.trend.call(this),revision=this.trendRenderRevision;
    await rendering;
    if(revision!==this.trendRenderRevision||key!==`${this.currentRace?.id}:${this.focusedPanelTab}:${this.lockedCounty || ''}`)return;
    if(content&&interaction===(this.trendScrollInteraction||0)&&Number.isFinite(top))content.scrollTop=top;
    if(this.trendScrollRestore===pending)this.trendScrollRestore=null;
    if (focused) {
      const nodes = [...document.querySelectorAll(".trend-point")],
        target = nodes.find((n) => n.getAttribute("aria-label") === focused) || nodes.at(-1);
      if (target) {
        for (const n of nodes) n.setAttribute("tabindex", "-1");
        target.setAttribute("tabindex", "0");
        target.focus({preventScroll:true});
      }
      this.trendFocusLabel = null;
    }
  };
  p.bindEvents = function () {
    original.bind.call(this);
    const trendContent=document.getElementById('focused-race-content');
    if(trendContent&&!this.trendScrollBound){
      this.trendScrollBound=true;
      for(const type of ['wheel','pointerdown','touchstart','keydown'])trendContent.addEventListener(type,()=>{
        this.trendScrollInteraction=(this.trendScrollInteraction||0)+1;
        this.trendScrollRestore=null;
      },{passive:true});
    }
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
      if(this.currentPresentation!==T.current.presentation) {
        this.currentPresentation=T.current.presentation;
        if(this.currentRace)this.reframeComparison();
        else this.renderMap().catch(()=>{});
      }
      document.body.dataset.themeApplyMs = (
        performance.now() - themeStart
      ).toFixed(2);
    });
    document
      .querySelector("#focused-race-panel")
      ?.addEventListener("click", (event) => {
        const historyColumn = event.target.closest('[data-history-column]');
        if (historyColumn && this.currentRace) {
          const id = historyColumn.dataset.historyColumn;
          this.pastColumnIds = this.pastColumnIds?.includes(id) ? this.pastColumnIds.filter(s=>s!==id) : [...(this.pastColumnIds||[]),id].slice(-2);
          this.renderPastMargins(this.currentRace); this.reframeComparison();
          [...document.querySelectorAll('[data-history-column]')].find(b=>b.dataset.historyColumn===id)?.focus({preventScroll:true});
        }
        const historyMap = event.target.closest('[data-history-map]');
        if (historyMap && this.currentRace) {
          const id=historyMap.dataset.historyMap, raceId=this.currentRace.id;
          this.setHistoricalMap(id).then(()=>{
            if(this.currentRace?.id===raceId&&(document.activeElement===document.body||document.activeElement===historyMap))
              [...document.querySelectorAll('[data-history-map]')].find(b=>b.dataset.historyMap===id)?.focus({preventScroll:true});
          });
        }
        if (event.target.closest("[data-pin-race]") && this.currentRace)
          this.togglePin(this.currentRace.id);
        if (event.target.closest('[data-past-margin]') && this.currentRace) {
          const race = this.currentRace;
          this.pastMarginRace = this.pastMarginRace === race.id ? null : race.id;
          if (this.pastMarginRace && innerWidth <= 600 && !document.getElementById('focused-race-panel').classList.contains('is-expanded'))
            document.querySelector('.sheet-toggle')?.click();
          this.renderPastMargins(race);
          document.getElementById('focused-race-content').scrollTop=0;
          if (!this.pastMarginRace) this.setHistoricalMap(null);
          this.reframeComparison();
        }
      });
    document.getElementById('desk-race-index')?.addEventListener('click',event=>{
      const race = event.target.closest('[data-index-race]'); if(race)this.openDashboardRace(race.dataset.indexRace);
    });
    document.getElementById('election-map')?.addEventListener('change',event=>{
      if(event.target.matches('[data-comparison-baseline]'))this.setHistoricalMap(null);
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
    const trayScroll = tray.scrollLeft;
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
      target?.focus({preventScroll:true});
    }
    tray.scrollLeft = trayScroll;
  };
  p.mapExtent = function (width,height) {
    const extent=original.extent.call(this,width,height);
    if(['broadcast','editorial'].includes(T.current.presentation)&&innerWidth>1000&&!this.currentRace) {
      const index=document.getElementById('desk-race-index')?.getBoundingClientRect();
      if(index?.width)extent[0][0]=Math.min(width*.36,index.right+24);
    }
    if(T.current.presentation==='broadcast'&&innerWidth>900){const rail=document.querySelector('.election-map-controls')?.getBoundingClientRect();extent[1][0]=Math.max(extent[0][0]+80,width-Math.max(136,(rail?.width||104)+32));}
    return extent;
  };
  p.reframeComparison = function () {
    // Only deliberate comparison actions reframe; ordinary updates retain zoom.
    this.positionDeskControls();
    if (this.detailMapActive) this.focusRenderedSelection('.county-result-shape', {pad:32});
  };
  p.reflectHistoricalLens = function () {
    const lens=document.querySelector('[data-comparison-baseline]'); if(!lens)return;
    lens.querySelector('[data-historical-lens]')?.remove();
    if(this.pastMapSource) {
      const source=this.comparisonManifest.sources.find(s=>s.id===this.pastMapSource);
      const option=document.createElement('option');option.dataset.historicalLens='';option.value='historical';option.textContent=source.label.replace(/shift$/i,'result');
      lens.append(option);lens.value='historical';lens.disabled=true;
    } else {lens.disabled=false;lens.value=this.comparisonMode||'live';}
  };
  p.canHistoricalMap = function (source) {
    if(this.currentRace?.type==='house'&&this.lockedCounty)return false;
    if(this.currentRace?.type!=='house'&&source.countyCompatible!==true)return false;
    return Boolean(FEAResultsUI.historicalSnapshot(this.currentRace,source,this.comparisonData));
  };
  p.setHistoricalMap = async function (id) {
    const source = this.comparisonManifest?.sources.find(s=>s.id===id);
    if(id==='') {
      this.comparisonMode='live'; this.beforeHistoricalLens=null;
      try{localStorage.setItem('electionNightComparison','live');}catch{}
    } else if(!id && this.pastMapSource) {
      this.comparisonMode=this.beforeHistoricalLens||'live'; this.beforeHistoricalLens=null;
    } else if(source && !this.pastMapSource) this.beforeHistoricalLens=this.comparisonMode;
    this.pastMapSource = source && this.canHistoricalMap(source) ? id : null;
    this.reflectHistoricalLens();
    const note = document.getElementById('desk-history-map-note');
    if(note) { note.hidden = !this.pastMapSource; note.textContent = this.pastMapSource ? `${source.label.replace(/shift$/i,'margin')} · Historical votes, not 2026 results` : ''; }
    document.body.classList.toggle('history-map-active',Boolean(this.pastMapSource));
    const raceId=this.currentRace?.id;
    if(this.pastMapSource && this.detailMapActive && this.currentRace.type!=='house') {
      if(note)note.textContent='Loading historical map…';
      await this.loadComparisonDataset('county',source);
      if(this.currentRace?.id!==raceId||this.pastMapSource!==id)return;
      const matched=this.visibleCountyFeatures?.some(f=>FEAResultsUI.historicalSnapshot(this.currentRace,source,this.comparisonData,featureCountyFipsForElectionNight(f)));
      if(note)note.textContent=matched?`${source.label.replace(/shift$/i,'margin')} · Historical votes, not 2026 results`:'No verified historical results for the displayed local boundaries';
    }
    this.hideTooltip(); this.updateMapFills(new Set(Object.values(this.dataByMode).flat().map(r=>r.id)));
    if(this.currentRace)this.renderPastMargins(this.currentRace);
  };
  p.historicalMapColor = function (race, fips = null) {
    const source = this.comparisonManifest?.sources.find(s=>s.id===this.pastMapSource);
    const snapshot = FEAResultsUI.historicalSnapshot(race,source,this.comparisonData,race?.type==='house'?null:fips), tokens=T.resolved.tokens;
    return snapshot && snapshot.margin!==0 ? T.mix(tokens['map-neutral'],T.resolved.partyColors[snapshot.margin>0?'D':'R'],Math.min(.95,.45+Math.abs(snapshot.margin)/100)) : tokens['map-neutral'];
  };
  p.comparisonColorForRace = function (race) {
    return this.pastMapSource ? this.historicalMapColor(race) : original.raceColor.call(this,race);
  };
  p.comparisonColorForCounty = function (feature,race,lookup) {
    return this.pastMapSource ? this.historicalMapColor(race,featureCountyFipsForElectionNight(feature)) : original.countyColor.call(this,feature,race,lookup);
  };
  p.showTooltip = function (event, html) {
    if(this.pastMapSource) {
      const feature = event.currentTarget?.__data__, county=event.currentTarget?.classList?.contains('county-result-shape');
      const race = county ? this.currentRace : feature ? this.modeRaces().find(r=>this.selectedMode==='house' ? houseGeometryId(r)===feature.properties?.id : r.state===FIPS_TO_STATE[featureStateFipsForElectionNight(feature)]) : null;
      const source = this.comparisonManifest.sources.find(s=>s.id===this.pastMapSource);
      const snapshot = FEAResultsUI.historicalSnapshot(race,source,this.comparisonData,county&&race?.type!=='house'?featureCountyFipsForElectionNight(feature):null);
      html = FEAResultsUI.historicalTooltip(snapshot,{name:snapshot?.name || (race ? label(race) : 'Historical result'),label:source.label.replace(/shift$/i,'result').replace(/margin$/i,'result'),color:c=>T.candidateColor(c,snapshot?.candidates)});
    }
    return original.tooltip.call(this,event,html);
  };
  p.selectRace = function (race,...args) {
    if(this.currentRace?.id!==race.id) {
      if(this.pastMapSource)this.setHistoricalMap(null);
      this.pastMarginRace=null; this.pastColumnIds=null;
    }
    return original.select.call(this,race,...args);
  };
  p.clearFocus = function (...args) {
    if(this.pastMapSource)this.setHistoricalMap(null);
    this.pastMarginRace=null; document.body.classList.remove('has-history-comparison');
    const result=original.clear.apply(this,args);
    this.renderPresentationShell();
    return result;
  };
  p.switchMode = function (mode,...args) {
    if(mode!==this.selectedMode) {
      if(this.pastMapSource)this.setHistoricalMap(null);
      this.pastMarginRace=null; this.pastColumnIds=null;
      document.body.classList.remove('has-history-comparison');
    }
    const result=original.mode.call(this,mode,...args);
    if(this.publicProvider)this.renderProviderStatus(this.publicProvider);
    return result;
  };
  p.lockCounty = function (fips,...args) {
    if(fips&&this.currentRace?.type==='house'&&this.pastMapSource)this.setHistoricalMap(null);
    return original.lock.call(this,fips,...args);
  };
  p.renderPastMargins = function (race) {
    let button = document.querySelector('[data-past-margin]');
    if (!button) {
      button = document.createElement('button'); button.type = 'button';
      button.dataset.pastMargin = ''; button.textContent = 'Compare years ›';
      button.setAttribute('aria-controls', 'desk-past-margins');
      document.querySelector('.focused-card-head').insertBefore(button, document.querySelector('.focused-close'));
    }
    const open = this.pastMarginRace === race.id;
    document.body.classList.toggle('has-history-comparison',open);
    button.setAttribute('aria-expanded', String(open));
    let section = document.getElementById('desk-past-margins');
    if (!section) {
      section = document.createElement('section'); section.id = 'desk-past-margins';
      section.setAttribute('aria-label', 'Past election margins');
      document.getElementById('focused-race-content').prepend(section);
    }
    section.hidden = !open;
    if (!open) return;
    const matrixScroll=section.querySelector('.comparison-matrix')?.scrollLeft||0;
    if (this.lockedCounty) {
      this.pastMarginLoads ||= new Map();
      const missing = (this.comparisonManifest?.sources || []).filter(s => s.status === 'available' && s.countyCompatible && s.appliesTo?.includes(race.type) && (race.type!=='house'||s.countyReferenceCompatible) && !this.comparisonData.has(`${s.id}:county`) && !this.pastMarginLoads.has(s.id));
      for (const source of missing) {
        // Cache and deduplicate the existing county dataset; never fetch per county.
        const loading = this.loadComparisonDataset('county', source);
        this.pastMarginLoads.set(source.id, loading);
        loading.then(() => {
          if (this.currentRace?.id === race.id && this.pastMarginRace === race.id) this.renderPastMargins(this.currentRace);
        }).catch(() => {}).finally(() => this.pastMarginLoads.delete(source.id));
      }
    }
    const county = this.panelData(race).counties?.find(c => c.fips === this.lockedCounty);
    const historicalCounty = this.lockedCounty && [...this.comparisonData.values()].flatMap(data => data?.counties || data?.rows || []).find(row => String(row.fips || row.countyFips || '') === String(this.lockedCounty));
    const wholeCountyReference=race.type==='house'&&this.lockedCounty;
    const scopeLabel = (this.lockedCounty ? county?.name || historicalCounty?.county || historicalCounty?.name || `Selected area · ${this.lockedCounty}` : label(race))+(wholeCountyReference?' · Whole county reference':'');
    const sources = (this.comparisonManifest?.sources || []).filter(s=>s.id!=='live'&&s.appliesTo?.includes(race.type));
    this.pastColumnIds ||= [sources.find(s=>s.status==='available')?.id || sources[0]?.id].filter(Boolean);
    const current = this.lockedCounty ? county || {candidates:[]} : this.panelData(race);
    const total = FEADesk.total(current), order=c=>({D:0,R:1,I:2}[c.partyCode||c.party]??3), candidates=[...(current.candidates||[])].sort((a,b)=>T.current.presentation==='broadcast'?order(a)-order(b)||(b.votes||0)-(a.votes||0):(b.votes||0)-(a.votes||0));
    const votes = party => candidates.filter(c=>(c.partyCode||c.party)===party).reduce((n,c)=>n+(c.votes||0),0);
    const liveMargin=total?(votes('D')-votes('R'))/total*100:null;
    const column=(heading,subtitle,snapshot,isCurrent=false)=>{
      if(!isCurrent)return FEAResultsUI.comparisonColumn(heading,subtitle,snapshot,T);
      const call=isCurrent?current.calls?.[0]:null,lead=snapshot?FEAResultsUI.candidateLead(snapshot.candidates,snapshot.total):null;
      const reporting=current.expectedVotePercent??current.estimatedVoteReporting;
      const meta=isCurrent&&snapshot?.total&&Number.isFinite(reporting)?`${reporting.toFixed(1)}% expected vote in`:!isCurrent&&snapshot?.total?`${snapshot.total.toLocaleString()} votes`:'';
      return `<section class="comparison-column ${isCurrent?'comparison-current':''}" aria-label="${esc(heading+' '+subtitle)}"><header><strong class="comparison-year">${esc(heading)}</strong><span>${esc(subtitle)}</span>${meta?`<small class="comparison-reporting">${esc(meta)}</small>`:''}</header><div class="comparison-candidates">${snapshot?snapshot.candidates.map(c=>{
        const color=T.candidateColor(c,snapshot.candidates),ink=T.foreground(color),party=c.partyCode||c.party||'O';
        return `<div class="comparison-candidate ${!isCurrent&&snapshot.total&&c.votes===Math.max(...snapshot.candidates.map(r=>r.votes))?'is-history-leader':''}" style="--candidate-color:${color};--candidate-ink:${ink}"><small>${esc(party)}${call?.candidate===c.name?' · PROJECTED WINNER':''}</small><strong>${esc(c.name)}</strong><b>${snapshot.total?(c.votes/snapshot.total*100).toFixed(1)+'<em>%</em>':'—'}</b><span>${snapshot.total?Number(c.votes).toLocaleString()+' votes':'Awaiting results'}</span></div>`;
      }).join(''):'<div class="comparison-unavailable"><strong>—</strong><span>No verified result for these boundaries</span></div>'}</div><footer><span>Lead margin</span><strong>${lead?lead.margin===0?'Even':esc(lead.party)+' +'+lead.margin.toFixed(1):'—'}</strong></footer></section>`;
    };
    const historical=sources.filter(s=>this.pastColumnIds.includes(s.id));
    const firstSnapshot=historical[0]&&FEAResultsUI.historicalSnapshot(race,historical[0],this.comparisonData,this.lockedCounty);
    const twoParty=rows=>{const parties=[...rows].sort((a,b)=>b.votes-a.votes).slice(0,2).map(c=>c.partyCode||c.party);return parties.includes('D')&&parties.includes('R');};
    const shift=!wholeCountyReference&&liveMargin!==null&&firstSnapshot&&twoParty(candidates)&&twoParty(firstSnapshot.candidates)?liveMargin-firstSnapshot.margin:null;
    const year=source=>source.id.match(/20\d{2}/)?.[0]||'Last';
    const office=source=>source.id.startsWith('pres-')?'PRES':race.type.toUpperCase();
    section.innerHTML=`<header class="comparison-heading"><div><small>PAST & PRESENT</small><strong>${esc(scopeLabel)}</strong></div><span>Earlier elections · Reported returns</span></header><div class="comparison-workspace"><div class="comparison-matrix" style="--comparison-columns:${1+historical.length}">${column('2026',this.lockedCounty?'This local race':race.type==='house'?'House':race.type==='senate'?'Senate':'Governor',{total,candidates,margin:liveMargin},true)}${historical.map(source=>column(String(FEAResultsUI.historicalSnapshot(race,source,this.comparisonData,this.lockedCounty)?.year||year(source)),FEAResultsUI.historicalSnapshot(race,source,this.comparisonData,this.lockedCounty)?.label||source.label.replace(/shift$/i,'result').replace(/margin$/i,'result'),FEAResultsUI.historicalSnapshot(race,source,this.comparisonData,this.lockedCounty))).join('')}</div><nav class="comparison-rail" aria-label="Historical comparison controls"><small>COMPARE</small>${sources.map(source=>`<button type="button" data-history-column="${esc(source.id)}" aria-pressed="${this.pastColumnIds.includes(source.id)}">${esc(year(source))}<span>${esc(office(source))}</span></button>`).join('')}<small>MAP</small><button type="button" data-history-map="" aria-pressed="${!this.pastMapSource&&this.comparisonMode==='live'}">2026<span>LIVE</span></button>${sources.map(source=>`<button type="button" data-history-map="${esc(source.id)}" aria-pressed="${this.pastMapSource===source.id}" ${this.canHistoricalMap(source)?'':'disabled'}>${esc(year(source))}<span>${esc(office(source))}</span></button>`).join('')}</nav></div><p class="comparison-context">${shift===null?total?'Compare observed results with a verified historical election.':'Awaiting 2026 results. Historical columns show the earlier election, not a forecast.':`${Math.abs(shift).toFixed(1)} points more ${shift>=0?'Democratic':'Republican'} than ${esc(historical[0].label.replace(/shift$/i,'result'))}. Different offices and candidates can produce different results.`} ${wholeCountyReference?'Whole-county historical reference; these are not votes for only the district portion. No shift is calculated between different scopes. ' : ''}Blank (—) means no verified comparison for these boundaries.</p>`;
    section.querySelector('.comparison-matrix').scrollLeft=matrixScroll;
  };
  p.renderFocusedRace = function (race) {
    this.renderPresentationShell();
    const viewKey = `${race?.id}:${this.focusedPanelTab}:${this.lockedCounty || ''}`;
    const viewContent = document.getElementById("focused-race-content");
    const savedScroll = this.completedViewKey === viewKey ? viewContent.scrollTop : 0;
    this.trendScrollRestore=this.focusedPanelTab==='trends'?{key:viewKey,top:savedScroll}:null;
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
    if(this.completedRaceId!==race.id){
      this.completedRaceId=race.id;
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches)content.animate?.([{opacity:.45,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:180,easing:'ease-out'});
    }
    const polling=this.pollingReference?.races?.[race.id];
    if(this.focusedPanelTab==='results'&&polling&&polling.candidates.every(c=>race.candidates?.some(k=>k.name===c.name))){
      const aside=document.createElement('aside');aside.className='desk-polling-reference';
      const link=document.createElement('a');link.href='https://votehub.com/polls/api/';link.target='_blank';link.rel='noopener';link.textContent='Unofficial polling reference · VoteHub data';aside.append(link);
      const values=document.createElement('strong');values.textContent=polling.candidates.map(c=>`${c.name} ${c.percent.toFixed(1)}%`).join(' · ');aside.append(values);
      const note=document.createElement('small');note.textContent=`Unweighted poll average · ${polling.pollCount} pollsters · latest poll ${polling.latestPoll} · as of ${this.pollingReference.asOf}. Not a prediction.`;aside.append(note);
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='How this average is calculated';details.append(summary,document.createTextNode(this.pollingReference.method));aside.append(details);content.append(aside);
    }
    if(race.geometryReviewRequired) {
      const warning=document.createElement('p');warning.className='desk-geometry-warning';
      warning.textContent='Current district boundaries are unavailable. Historical district comparisons are paused.';
      content.prepend(warning);
    }
    if((T.current.presentation==='broadcast'||document.body.classList.contains('night-tv'))&&this.lockedCounty) {
      const area=this.panelData(race).counties?.find(c=>c.fips===this.lockedCounty);
      const feature=this.visibleCountyFeatures?.find(f=>featureCountyFipsForElectionNight(f)===this.lockedCounty);
      document.getElementById('focused-race-title').textContent=area?.name||feature?.properties?.countyName||feature?.properties?.NAME||label(race);
    } else if(T.current.presentation==='broadcast') {
      document.getElementById('focused-race-title').textContent=race.type==='house'?`${race.state} | ${['AL','0'].includes(String(race.district))?'AT LARGE':'DISTRICT '+race.district}`:`${race.state} | STATEWIDE`;
    }
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
    this.renderPastMargins(race);
    if(T.current.presentation==='broadcast')for(const node of content.querySelectorAll('.selected-race-table tr,.comparison-candidate')){
      const color=node.style.getPropertyValue('--candidate-color').trim();
      if(/^#[\da-f]{6}$/i.test(color))node.style.setProperty('--broadcast-value-ink',T.readableColor(color,'#e8ebef'));
    }
    if (this.focusedPanelTab === "counties" && !this.lockedCounty) {
      const data=this.panelData(race),rows = [...(data.counties || [])],sortLabel=data.localReporting?'Sort towns / cities':'Sort counties';
      const select = document.createElement("label");
      select.className = "county-sort";
      select.innerHTML =
        `${sortLabel} <select data-county-sort aria-label="${sortLabel}"><option value="name">Name</option><option value="votes">Votes counted</option><option value="margin">Closest margin</option><option value="reporting">Expected vote in</option></select>`;
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
          button.innerHTML = `<span>${esc(c.name)}<small>${esc(FEADesk.total(c) ? ordered[0]?.name : "Awaiting results")}</small></span><strong>${FEADesk.total(c) ? FEADesk.total(c).toLocaleString() : '—'}<small>${Number.isFinite(deskLeaderMargin(c)) ? "+" + deskLeaderMargin(c).toFixed(1) + " pts" : ""}${c.estimatedVoteReporting != null ? " · " + Number(c.estimatedVoteReporting).toFixed(0) + "% in" : ""}</small></strong>`;
          list.append(button);
        }
      }
    }
    viewContent.scrollTop = savedScroll;
    this.completedViewKey = viewKey;
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
    this.deskChamberControl={office:this.selectedMode,party:this.selectedMode==='governor'?null:control};
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
    this.renderPresentationShell();
  };
  p.renderPresentationShell = function () {
    const search=document.querySelector('.election-map-search');if(search)search.placeholder=T.current.presentation==='broadcast'?'Find race':'Find race or candidate';
    const heading=document.getElementById('desk-edition-title');
    if(heading) heading.textContent=T.current.presentation==='broadcast'?(this.currentRace?STATE_NAMES[this.currentRace.state]:`${this.selectedMode==='house'?'House':this.selectedMode==='senate'?'Senate':'Governor'} Results`):(this.currentRace?label(this.currentRace):`${this.selectedMode==='house'?'House':this.selectedMode==='senate'?'Senate':'Governor'} Election Results`);
    const index=document.getElementById('desk-race-index'); if(!index)return;
    const focusRace=index.contains(document.activeElement)?document.activeElement.closest('[data-index-race]')?.dataset.indexRace:null;
    const races=this.modeRaces(),watched=races.filter(r=>r.watch?.watch||r.watch?.tossup);
    const rows=(watched.length?watched:races).slice(0,8);
    index.innerHTML=`<header><small>2026 ELECTION</small><h2>${watched.length?'Races to watch':'Race directory'}</h2><p>${races.filter(r=>r.calls?.length).length} called · ${races.filter(r=>!r.calls?.length).length} unresolved</p></header>${rows.map(r=>{
      const total=FEADesk.total(r),leader=[...(r.candidates||[])].sort((a,b)=>b.votes-a.votes)[0],call=r.calls?.[0];
      return `<button type="button" data-index-race="${esc(r.id)}" style="--race-accent:${total&&leader?T.candidateColor(leader,r.candidates):T.resolved.tokens['panel-border']}"><strong>${esc(label(r))}</strong><span>${esc(call?'Called · '+call.candidate:total?'Leading · '+leader.name:'Awaiting results')}</span><b aria-hidden="true">›</b></button>`;
    }).join('')}<p class="desk-index-note">Select a race or explore the map. Leading races remain uncalled.</p>`;
    if(focusRace)[...index.querySelectorAll('[data-index-race]')].find(b=>b.dataset.indexRace===focusRace)?.focus({preventScroll:true});
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
      events = window.FEANight ? FEANight.closeGroups(this.modeRaces?.()||[],this.pollSchedule) : this.pollSchedule?.events || [];
    if (!node) return;
    const nextClose = FEADesk.nextPollClosures(this.modeRaces?.() || [],this.pollSchedule,now).at,
      upcoming = nextClose ? {at:nextClose,states:[...new Set((this.modeRaces?.()||[]).filter(r=>FEADesk.racePollCloseAt(r,this.pollSchedule)===nextClose).map(r=>r.state))]} : null,
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
      const at = typeof event.at==='number'?event.at:Date.parse(event.at),key=String(at);
      if (
        at > this.lastPollClock &&
        at <= now &&
        now - at < 120000 &&
        !this.pollEventsSeen.has(key)
      ) {
        this.pollEventsSeen.add(key);
        try{sessionStorage.setItem(this.pollSeenStorageKey||'feaPollCloseSeen.v1',JSON.stringify([...this.pollEventsSeen].slice(-50)));}catch{}
        if(!document.hidden&&!this.suppressDeskEvents)this.showPollClose(event, simulated);
      }
    }
    this.lastPollClock = now;
  };
  p.showPollClose = function (event, simulated = false) {
    const alert = document.getElementById("desk-poll-alert");
    alert.textContent = `${simulated ? "Simulation · " : ""}Scheduled poll close — ${event.states.join(", ")}${this.selectedMode==='house'&&event.raceIds?.length?' · '+event.raceIds.length+' House districts (other districts may close later)':''}. Voters in line may still vote.`;
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
    clearTimeout(this.pollPulseTimer);
    this.pollPulseTimer=setTimeout(()=>this.viewport?.selectAll('.poll-close-pulse').classed('poll-close-pulse',false),12000);
  };
};
