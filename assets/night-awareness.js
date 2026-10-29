/* Descriptive presentation only: never writes votes, leaders or calls. */
(function (root) {
  const total = (r) =>
    (r?.candidates || []).reduce((n, c) => n + (Number(c.votes) || 0), 0);
  const leader = (r) => {
    const c = [...(r?.candidates || [])].sort((a, b) => b.votes - a.votes);
    return total(r) && c[0]?.votes !== c[1]?.votes ? c[0]?.name : null;
  };
  const callKey = (r) =>
    JSON.stringify(
      (r?.calls || []).map((c) => [
        c.candidate,
        c.provider || c.source,
        c.status,
        c.calledAt,
      ]),
    );
  const reporting = (r) =>
    r?.expectedVotePercent ?? r?.estimatedVoteReporting ?? null;
  const source = (call) =>
    call?.provider === "NBC" || /^nbc-/i.test(call?.source || "")
      ? "NBC"
      : "FEA";
  function closeGroups(races, schedule, desk = root.FEADesk) {
    const groups = new Map();
    for (const r of races || []) {
      const at = desk.racePollCloseAt(r, schedule);
      if (!Number.isFinite(at)) continue;
      if (!groups.has(at)) groups.set(at, { at, raceIds: [], states: [] });
      const g = groups.get(at);
      g.raceIds.push(r.id);
      if (!g.states.includes(r.state)) g.states.push(r.state);
    }
    return [...groups.values()].sort((a, b) => a.at - b.at);
  }
  function presentation(
    races,
    schedule,
    now,
    { waveAt = 0, recent = 0, desk = root.FEADesk } = {},
  ) {
    const n = races.length,
      withVotes = races.filter((r) => total(r) > 0).length,
      called = races.filter((r) => r.calls?.length).length;
    const groups = closeGroups(races, schedule, desk),
      closed = groups.length > 0 && groups.every((g) => g.at <= now);
    const known = races
      .map(reporting)
      .filter((v) => typeof v === "number" && Number.isFinite(v));
    const average = known.length
      ? known.reduce((n, v) => n + v, 0) / known.length
      : 0;
    const closedFraction = groups.length
      ? groups.filter((g) => g.at <= now).length / groups.length
      : 0;
    let state = "PRE_ELECTION";
    if (waveAt && now >= waveAt && now - waveAt < 12000)
      state = "POLL_CLOSE_WAVE";
    else if (withVotes || called) {
      if (closed && called / Math.max(1, n) >= 0.95) state = "MOSTLY_COMPLETE";
      else if (
        closedFraction >= 0.7 &&
        (called / Math.max(1, n) >= 0.7 ||
          (known.length / Math.max(1, n) >= 0.7 && average >= 85))
      )
        state = "LATE_NIGHT";
      else if (
        withVotes / Math.max(1, n) < 0.2 &&
        called / Math.max(1, n) < 0.2 &&
        recent < Math.max(3, n * 0.1)
      )
        state = "EARLY_RESULTS";
      else state = "ACTIVE_COUNT";
    }
    return {
      state,
      unresolved: n - called,
      withVotes,
      called,
      average,
      recent,
    };
  }
  class Activity {
    constructor({ capacity = 200, retention = 30 * 60 * 1000 } = {}) {
      this.capacity = capacity;
      this.retention = retention;
      this.items = [];
      this.sequence = 0;
      this.recentChanges=new Map();
      this.recentCounties=new Map();
      this.voteBatches=[];
      this.corrections=[];
    }
    prune(now) {
      this.items = this.items
        .filter((i) => now - i.at <= this.retention)
        .slice(-this.capacity);
      // The visible feed is not the source of truth for a nationwide burst.
      if(this.metricsPrunedAt!==now){
        this.metricsPrunedAt=now;
        for(const [race,at] of this.recentChanges)if(now-at>this.retention)this.recentChanges.delete(race);
        for(const [key,at] of this.recentCounties)if(now-at>this.retention)this.recentCounties.delete(key);
        this.voteBatches=this.voteBatches.filter(i=>now-i.at<=300000).slice(-12000);
        this.corrections=this.corrections.filter(i=>now-i.at<=this.retention).slice(-10);
      }
    }
    markChanged(race,now){
      if(!race)return;
      const at=Math.max(this.recentChanges.get(race)||0,now);
      this.recentChanges.delete(race);this.recentChanges.set(race,at);
      while(this.recentChanges.size>1000)this.recentChanges.delete(this.recentChanges.keys().next().value);
    }
    add(item, now) {
      const entry={ ...item, at: now, id: ++this.sequence };
      this.items.push(entry);
      this.markChanged(item.race,now);
      if(item.race&&item.county){
        const key=item.race+':'+item.county,at=Math.max(this.recentCounties.get(key)||0,now);
        this.recentCounties.delete(key);this.recentCounties.set(key,at);
        while(this.recentCounties.size>6000)this.recentCounties.delete(this.recentCounties.keys().next().value);
      }
      if(!item.county&&['votes','first-results','vote-correction'].includes(item.kind)){
        this.voteBatches.push({race:item.race,at:now,votes:item.votes});
        if(this.voteBatches.length>12000)this.voteBatches.shift();
      }
      if(item.kind==='correction'){this.corrections.push(entry);if(this.corrections.length>10)this.corrections.shift();}
      this.prune(now);
    }
    observe(before, after, now = Date.now(), county = null) {
      if (!before) return [];
      if(!county&&before.version&&after.version&&before.version!==after.version)this.markChanged(after.id,now);
      const start = this.sequence,
        base = { race: after.id, county },
        old = total(before),
        votes = total(after) - old;
      if (votes)
        this.add(
          {
            ...base,
            kind:
              old === 0 && votes > 0
                ? "first-results"
                : votes > 0
                  ? "votes"
                  : "vote-correction",
            votes,
          },
          now,
        );
      if (
        reporting(after) !== null &&
        (reporting(before) === null || reporting(after) > reporting(before))
      )
        this.add(
          { ...base, kind: "reporting", reporting: reporting(after) },
          now,
        );
      if (leader(before) && leader(after) && leader(before) !== leader(after))
        this.add({ ...base, kind: "leader", candidate: leader(after) }, now);
      if (!county && callKey(before) !== callKey(after))
        this.add(
          {
            ...base,
            kind: before.calls?.length ? "correction" : "call",
            candidate: after.calls?.[0]?.candidate || null,
            source: source(after.calls?.[0]),
            retracted: !after.calls?.length,
          },
          now,
        );
      this.prune(now);
      return this.items.filter((i) => i.id > start);
    }
    changed(now = Date.now(), windowMs = 60000) {
      this.prune(now);
      return [...this.recentChanges].filter(([,at])=>now-at<=windowMs).map(([race])=>race);
    }
    changedCounties(now=Date.now(),windowMs=60000){
      this.prune(now);
      return [...this.recentCounties].filter(([,at])=>now-at<=windowMs).map(([key])=>key);
    }
    drops(now = Date.now(), windowMs = 300000) {
      this.prune(now);
      const rows = new Map();
      for (const i of this.voteBatches) {
        if (
          now - i.at > windowMs
        )
          continue;
        rows.set(i.race, (rows.get(i.race) || 0) + i.votes);
      }
      return [...rows]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([race, votes]) => ({ race, votes }));
    }
  }
  function sparkline(history) {
    const points = (history || [])
      .filter((p) => Number.isFinite(Date.parse(p.at)) && total(p) > 0)
      .slice(-24);
    if (
      points.length < 3 ||
      new Set(points.map((p) => Date.parse(p.at))).size < 3
    )
      return null;
    const margins = points.map((p) => {
      const d = (p.candidates || [])
          .filter((c) => (c.partyCode || c.party) === "D")
          .reduce((n, c) => n + c.votes, 0),
        r = (p.candidates || [])
          .filter((c) => (c.partyCode || c.party) === "R")
          .reduce((n, c) => n + c.votes, 0);
      return ((d - r) / total(p)) * 100;
    });
    if (
      !points.every(
        (p) =>
          p.candidates.some((c) => (c.partyCode || c.party) === "D") &&
          p.candidates.some((c) => (c.partyCode || c.party) === "R"),
      )
    )
      return null;
    if (new Set(margins).size < 2) return null;
    const min = Math.min(...margins),
      range = Math.max(...margins) - min || 1,
      first = Date.parse(points[0].at),
      span = Date.parse(points.at(-1).at) - first || 1;
    return points
      .map(
        (p, i) =>
          `${(((Date.parse(p.at) - first) / span) * 100).toFixed(1)},${(22 - ((margins[i] - min) / range) * 20).toFixed(1)}`,
      )
      .join(" ");
  }
  function historyTargets(points, limit = 120) {
    if (points.length <= limit) return points;
    return Array.from(
      { length: limit },
      (_, i) => points[Math.round((i * (points.length - 1)) / (limit - 1))],
    );
  }
  function marginDomain(values) {
    const bound=Math.max(1,...values.filter(v=>typeof v==='number' && Number.isFinite(v)).map(Math.abs));
    return [-bound,bound];
  }
  // Use the largest projected exterior, independent of spherical ring winding.
  // geoPath.centroid can choose the complement for GeoJSON-oriented polygons.
  function projectedAnchor(feature, projection) {
    const geometry = feature?.geometry;
    const polygons = geometry?.type === "Polygon" ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon" ? geometry.coordinates : [];
    let best = null;
    for (const polygon of polygons) {
      const points = (polygon[0] || []).map(projection).filter(p => p?.every(Number.isFinite));
      let area = 0, x = 0, y = 0;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const cross = points[j][0] * points[i][1] - points[i][0] * points[j][1];
        area += cross; x += (points[j][0] + points[i][0]) * cross; y += (points[j][1] + points[i][1]) * cross;
      }
      if (Math.abs(area) > (best?.area || 1e-8))
        best = {area: Math.abs(area), point: [x / (3 * area), y / (3 * area)]};
    }
    return best?.point || null;
  }
  function fitRenderedGeometry(projection, extent, collection) {
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const feature of collection.features || [collection]) {
      const g=feature.geometry,polygons=g?.type==='Polygon'?[g.coordinates]:g?.type==='MultiPolygon'?g.coordinates:[];
      for(const polygon of polygons) for(const ring of polygon) for(const coordinate of ring) {
        const p=projection(coordinate);if(!p?.every(Number.isFinite))continue;
        x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);
      }
    }
    if(!(x1>x0&&y1>y0))return projection;
    const [[left,top],[right,bottom]]=extent, t=projection.translate();
    const scale=Math.min((right-left)/(x1-x0),(bottom-top)/(y1-y0));
    return projection.scale(projection.scale()*scale).translate([(left+right)/2-((x0+x1)/2-t[0])*scale,(top+bottom)/2-((y0+y1)/2-t[1])*scale]);
  }
  function parseView(search) {
    const q = new URLSearchParams(search),
      out = {};
    if (["house", "senate", "governor"].includes(q.get("office")))
      out.office = q.get("office");
    if (
      /^(?:house|senate|governor)-[A-Z]{2}(?:-(?:\d{1,2}|AL))?$/.test(
        q.get("race") || "",
      )
    )
      out.race = q.get("race");
    if (
      ["results", "counties", "trends", "demographics"].includes(q.get("tab"))
    )
      out.tab = q.get("tab");
    if (/^(?:\d{5}|\d{10})$/.test(q.get("county") || "")) out.county = q.get("county");
    if (/^[a-z][\w-]{0,60}$/.test(q.get("lens") || ""))
      out.lens = q.get("lens");
    return out;
  }
  function viewUrl(view, base) {
    const url = new URL(base);
    url.search = "";
    url.hash = "";
    if (/fea-results-lab-26|election-night\.html/.test(url.pathname))
      url.pathname = "/results";
    for (const [k, v] of Object.entries(
      parseView(new URLSearchParams(view).toString()),
    ))
      url.searchParams.set(k, v);
    return url;
  }
  const presets = {
    compact: [370, 420],
    analysis: [620, 720],
    "map-first": [340, 400],
    tv: [650, 760],
  };
  function panelPreset(name, width, height) {
    const p = presets[name];
    return p
      ? [
          Math.max(0, Math.min(p[0], width - 36)),
          Math.max(0, Math.min(p[1], height - 170)),
        ]
      : null;
  }
  async function fullscreen(doc) {
    try {
      if (doc.fullscreenElement) {
        await doc.exitFullscreen();
        return true;
      }
      if (doc.fullscreenEnabled && doc.documentElement.requestFullscreen) {
        await doc.documentElement.requestFullscreen();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  // Greedy collision culling in screen coordinates. Higher priority wins.
  function visibleLabels(labels, { width, height, gap = 6 } = {}) {
    const accepted = [];
    for (const l of [...labels].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0),
    )) {
      if (
        l.x < 0 ||
        l.y < 0 ||
        l.x + l.width > width ||
        l.y + l.height > height
      )
        continue;
      if (
        accepted.some(
          (a) =>
            l.x < a.x + a.width + gap &&
            l.x + l.width + gap > a.x &&
            l.y < a.y + a.height + gap &&
            l.y + l.height + gap > a.y,
        )
      )
        continue;
      accepted.push(l);
    }
    return accepted.map((l) => l.id);
  }
  const api = {
    Activity,
    presentation,
    closeGroups,
    sparkline,
    historyTargets,
    marginDomain,
    projectedAnchor,
    fitRenderedGeometry,
    parseView,
    viewUrl,
    panelPreset,
    fullscreen,
    visibleLabels,
    total,
    leader,
    source,
  };
  root.FEANight = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
