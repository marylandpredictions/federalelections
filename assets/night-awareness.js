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
    }
    prune(now) {
      this.items = this.items
        .filter((i) => now - i.at <= this.retention)
        .slice(-this.capacity);
    }
    add(item, now) {
      this.items.push({ ...item, at: now, id: ++this.sequence });
      this.prune(now);
    }
    observe(before, after, now = Date.now(), county = null) {
      if (!before) return [];
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
      return [
        ...new Set(
          this.items
            .filter((i) => i.race && now - i.at <= windowMs)
            .map((i) => i.race),
        ),
      ];
    }
    drops(now = Date.now(), windowMs = 300000) {
      this.prune(now);
      const rows = new Map();
      for (const i of this.items) {
        if (
          now - i.at > windowMs ||
          i.county ||
          !["votes", "first-results", "vote-correction"].includes(i.kind)
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
    if (/^\d{5}$/.test(q.get("county") || "")) out.county = q.get("county");
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
