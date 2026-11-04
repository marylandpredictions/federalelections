(function (root) {
  const code = candidate => candidate.partyCode || candidate.party;
  const valid = candidate => Number.isSafeInteger(candidate.votes) && candidate.votes >= 0;
  const publicCall = race => {
    const call = race.calls?.[0];
    return call?.candidate && !call.retracted ? call : null;
  };
  function contest(candidates = [], totalOverride) {
    const ranked = candidates.filter(valid).sort((a,b) => b.votes-a.votes);
    const sum = ranked.reduce((n,c) => n+c.votes,0);
    const total = totalOverride ?? sum;
    const d = ranked.filter(c=>code(c)==='D').reduce((n,c)=>n+c.votes,0);
    const r = ranked.filter(c=>code(c)==='R').reduce((n,c)=>n+c.votes,0);
    const usable = total > 0 && sum <= total && ranked.length === candidates.length;
    const [leader, runnerUp] = ranked;
    const gap = usable && runnerUp?.votes > 0 ? leader.votes-runnerUp.votes : NaN;
    return {total,d,r,ranked,leader,runnerUp,gap,gapPoints:100*gap/total,
      margin:usable ? 100*(d-r)/total : NaN,
      paired:usable && d>0 && r>0};
  }
  function shift(current, past) {
    if (!past) return {value:NaN,reason:'No verified benchmark for this geography'};
    if (!Number.isFinite(current.margin)) return {value:NaN,reason:'No usable reported votes'};
    if (['first-choice','final-ranked-choice'].includes(past.round)) {
      return {value:NaN,reason:'The historical ranked-choice round is known, but the current round is not verified'};
    }
    const prior = contest(past.candidates,past.total);
    if (!current.paired || !prior.paired) return {value:NaN,reason:'Both parties need reported votes in both contests'};
    if (!Number.isFinite(past.margin) || Math.abs(prior.margin-past.margin) > .11) return {value:NaN,reason:'Historical vote totals and margin disagree'};
    return {value:current.margin-prior.margin,reason:'',prior};
  }
  // Rank the reported snapshot. These are descriptive thresholds, with no
  // statistical or finality claim. Race ID breaks ties deterministically.
  function findings(rows) {
    const ordered = (value, descending = false) => rows.filter(row=>Number.isFinite(value(row)))
      .sort((a,b)=>(descending ? value(b)-value(a) : value(a)-value(b)) || a.race.id.localeCompare(b.race.id));
    const close = ordered(row=>row.current.gapPoints);
    const swings = ordered(row=>Math.abs(row.swing),true);
    const calls = {D:0,R:0,other:0};
    for (const {race} of rows) {
      const call = publicCall(race);
      if (!call) continue;
      const winner = race.candidates.find(candidate=>candidate.name===call.candidate);
      const party = winner && code(winner);
      calls[party==='D'||party==='R'?party:'other']++;
    }
    return {calls, reported:rows.filter(row=>Number.isFinite(row.current.margin)).length,
      close, closeVotes:ordered(row=>row.current.gap), withinTwo:close.filter(row=>row.current.gapPoints<=2).length,
      swings, towardD:swings.filter(row=>row.swing>0).length, towardR:swings.filter(row=>row.swing<0).length};
  }
  function localFindings(counties = []) {
    const rows = counties.map(county=>({county,...contest(county.candidates)}))
      .filter(row=>Number.isFinite(row.margin));
    const sorted = [...rows].sort((a,b)=>(b.d-b.r)-(a.d-a.r));
    return {rows, votes:rows.reduce((sum,row)=>sum+row.total,0),
      edge:rows.reduce((sum,row)=>sum+row.d-row.r,0),
      dem:sorted.find(row=>row.d>row.r), rep:sorted.reverse().find(row=>row.r>row.d)};
  }
  const api = {contest,shift,findings,localFindings,publicCall};
  if (typeof module !== 'undefined') module.exports = api;
  else root.FEALabAnalysis = api;
})(globalThis);
