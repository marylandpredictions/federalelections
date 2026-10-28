(function (root) {
  const finite = (v) =>
    v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
      ? Number(v)
      : null;
  const total = (row) =>
    (row?.candidates || []).reduce((sum, c) => sum + (finite(c.votes) || 0), 0);
  function metrics(row, previous, baseline) {
    const candidates = row?.candidates || [];
    const valid = (r) =>
      (r?.candidates || []).every(
        (c) => finite(c.votes) !== null && c.votes >= 0,
      );
    const votes = valid(row) ? total(row) : null,
      prior = previous && valid(previous) ? total(previous) : null;
    const partyTotal = p => { const list=candidates.filter(c=>(c.partyCode||c.party)===p); return list.length ? {votes:list.reduce((sum,c)=>sum+(finite(c.votes)||0),0)} : null; };
    const d = partyTotal("D"), r = partyTotal("R");
    const margin =
      votes > 0 && d && r ? ((d.votes - r.votes) / votes) * 100 : null;
    const expected = finite(
      row?.expectedVotePercent ?? row?.estimatedVoteReporting,
    );
    const delta = prior === null || votes === null ? null : votes - prior;
    const additions = previous
      ? candidates.map((c) => ({
          name: c.name,
          party: c.partyCode || c.party,
          votes:
            c.votes -
            ((previous.candidates || []).find((p) => p.name === c.name)
              ?.votes || 0),
        }))
      : [];
    const completeMatch =
      previous &&
      candidates.length === previous.candidates?.length &&
      candidates.every((c) =>
        previous.candidates.some((p) => p.name === c.name),
      );
    const batchShares =
      completeMatch && delta > 0 && additions.every((c) => c.votes >= 0)
        ? additions.map((c) => ({ ...c, share: (c.votes / delta) * 100 }))
        : [];
    return {
      votes,
      margin,
      rawMargin: votes !== null && d && r ? d.votes - r.votes : null,
      delta,
      batchShares,
      remaining:
        votes > 0 && expected > 0 && expected <= 100
          ? Math.max(0, Math.round(votes * (100 / expected - 1)))
          : null,
      turnout:
        baseline?.totalVotes > 0 && votes > 0
          ? (votes / baseline.totalVotes) * 100
          : null,
      shift:
        margin !== null && baseline?.totalVotes > 0
          ? margin -
            ((baseline.demVotes - baseline.repVotes) / baseline.totalVotes) *
              100
          : null,
    };
  }
  const callFingerprint = (race) =>
    JSON.stringify(
      (race.calls || [])
        .map((c) => [
          c.candidate,
          c.status,
          c.provider || c.source,
          c.calledAt || "",
        ])
        .sort(),
    );
  class CallTracker {
    constructor(storage, key = "fea-public-call-events-v1") {
      this.storage = storage;
      this.key = key;
      this.previous = null;
      this.seen = new Set();
      try {
        const saved = JSON.parse(storage?.getItem(key) || "null");
        if (saved) {
          this.previous = new Map(saved.previous);
          this.seen = new Set(saved.seen);
        }
      } catch {}
    }
    observe(races) {
      const events = [];
      for (const race of races) {
        const fingerprint = callFingerprint(race),
          before = this.previous?.get(race.id);
        if (
          this.previous &&
          before !== fingerprint &&
          (race.calls?.length || (before && before !== "[]"))
        ) {
          const key = race.id + ":" + fingerprint + ":" + before;
          if (!this.seen.has(key)) {
            events.push({
              key,
              race,
              correction: !!before && before !== "[]",
              call: race.calls?.[0] || null,
            });
            this.seen.add(key);
            while(this.seen.size>2000)this.seen.delete(this.seen.values().next().value);
          }
        }
      }
      this.previous = new Map(races.map((r) => [r.id, callFingerprint(r)]));
      try {
        this.storage?.setItem(
          this.key,
          JSON.stringify({
            previous: [...this.previous],
            seen: [...this.seen].slice(-2000),
          }),
        );
      } catch {}
      return events;
    }
  }
  function trendPoints(history) {
    return (history || [])
      .filter((p) => Number.isFinite(Date.parse(p.at)) && p.candidates?.length)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .filter(
        (p, i, all) =>
          i === 0 ||
          JSON.stringify([
            p.candidates.map((c) => [c.name, c.votes]),
            p.expectedVotePercent,
            p.precinctReporting,
          ]) !==
            JSON.stringify([
              all[i - 1].candidates.map((c) => [c.name, c.votes]),
              all[i - 1].expectedVotePercent,
              all[i - 1].precinctReporting,
            ]),
      );
  }
  function summaryCandidates(race, candidates = race?.candidates || []) {
    const code = c => String(c.partyCode || c.party || '').toUpperCase();
    const key = c => String(c.id || c.name).normalize('NFKC').toLowerCase();
    const identity = c => (race?.candidates || []).find(k => (k.id && c.id && k.id === c.id) || k.name === c.name || k.aliases?.includes(c.name));
    const ranked = [...candidates].sort((a,b) => (Number(b.votes)||0)-(Number(a.votes)||0));
    const liveLeaders = new Set(ranked.filter(c => Number(c.votes)>0).slice(0,2).map(key));
    const rows = candidates.filter(c => { const meta = identity(c); return (!(c.writeIn || meta?.writeIn) && ['D','R'].includes(code(c))) || c.summaryVisible || meta?.summaryVisible || liveLeaders.has(key(c)); });
    // A minor-party-only contest still needs a meaningful summary.
    return rows.length ? rows : ranked.filter(c=>!c.writeIn).slice(0,2);
  }
  function racePollCloseAt(race, schedule) {
    const state = String(race?.state || '').toUpperCase();
    const statewide = schedule?.events?.find(e => e.states?.includes(state))?.at;
    const split = race?.type === 'house' && schedule?.districtExceptions?.[state];
    const district = String(race?.district ?? '').replace(/^0+(?=\d)/, '');
    return Date.parse((split && (split[district] || split.default)) || statewide);
  }
  function nextPollClosures(races, schedule, now = Date.now()) {
    const upcoming = (races || []).map(r => ({id:r.id, at:racePollCloseAt(r,schedule)})).filter(r => Number.isFinite(r.at) && r.at > now);
    const at = upcoming.length ? Math.min(...upcoming.map(r => r.at)) : null;
    return {at, raceIds:upcoming.filter(r => r.at === at).map(r => r.id)};
  }
  function raceOutlineIds(races, schedule, mode = 'next', now = Date.now()) {
    return mode === 'watch' ? (races || []).filter(r => r.watch?.watch || r.watch?.tossup).map(r => r.id) : nextPollClosures(races,schedule,now).raceIds;
  }
  const api = {
    racePollCloseAt,
    nextPollClosures,
    raceOutlineIds,
    summaryCandidates,
    finite,
    total,
    metrics,
    callFingerprint,
    CallTracker,
    trendPoints,
  };
  root.FEADesk = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
