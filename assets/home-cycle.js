(function (root) {
  const phases = {
    'election-night': {title:'National results', updates:'Election updates', calls:'Recent calls', poll:true, chamber:'Election-night results'},
    'post-election': {title:'Election recap', updates:'The closest contests', calls:'Latest published calls', poll:false, chamber:'Post-election returns'},
    'between-elections': {title:'Research and archives', updates:'', calls:'', poll:false, chamber:'Historical snapshot', archive:true}
  };

  function phase(value) {
    return phases[Object.hasOwn(phases,value) ? value : 'between-elections'];
  }

  const called = race => Boolean(race.calls?.[0]?.candidate && !race.calls[0].retracted);
  function shouldPoll(value, snapshot) {
    return phase(value).poll || (value==='post-election' && snapshot?.provider?.stale===false &&
      snapshot.races.some(race=>!called(race)));
  }
  function raceUpdates(ranked, races) {
    const unresolved = races.some(race=>!called(race));
    // A known low expected-vote estimate makes a partial margin too early to feature.
    // Unknown reporting stays eligible and is labeled as such by the renderer.
    const eligible = ranked.filter(({race})=>{
      const expected = race.expectedVotePercent ?? race.estimatedVoteReporting;
      return !called(race) && (!Number.isFinite(expected) || expected >= 25);
    });
    const recent = new Map();
    for (const race of races) {
      if (!called(race)) continue;
      const call = race.calls[0];
      const time = Date.parse(call.calledAt);
      if (Number.isFinite(time) && (!recent.has(race.id) || recent.get(race.id).time < time)) {
        recent.set(race.id,{race,call,time});
      }
    }
    return {
      unresolved,
      selected:(unresolved ? eligible : ranked.filter(({race})=>called(race))).slice(0,4),
      recent:[...recent.values()].sort((a,b)=>b.time-a.time).slice(0,4)
    };
  }

  const api = {phase,shouldPoll,raceUpdates,called};
  if (typeof module !== 'undefined') module.exports = api;
  else root.FEAHomeCycle = api;
})(globalThis);
