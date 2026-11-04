(function (root) {
  const code = candidate => candidate.partyCode || candidate.party;
  const valid = candidate => Number.isSafeInteger(candidate.votes) && candidate.votes >= 0;
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
    const prior = contest(past.candidates,past.total);
    if (!current.paired || !prior.paired) return {value:NaN,reason:'Both parties need reported votes in both contests'};
    if (!Number.isFinite(past.margin) || Math.abs(prior.margin-past.margin) > .11) return {value:NaN,reason:'Historical vote totals and margin disagree'};
    return {value:current.margin-prior.margin,reason:'',prior};
  }
  const api = {contest,shift};
  if (typeof module !== 'undefined') module.exports = api;
  else root.FEALabAnalysis = api;
})(globalThis);
