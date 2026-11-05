(function (root) {
  const order = ['D','I','O','uncalled','missing','vacant','R'];
  const party = candidate => candidate?.partyCode || candidate?.party;
  const section = seat => seat.status==='continuing' && seat.caucus==='D' ? 'D' : seat.group;
  function historicalCoverage(seats) {
    const contests = seats.filter(seat=>seat.status!=='continuing');
    const reported = contests.filter(seat=>seat.total>0).length;
    const called = contests.filter(seat=>seat.status==='called').length;
    const unresolved = contests.filter(seat=>seat.status==='uncalled').length;
    const unavailable = contests.length-called-unresolved;
    return {contests:contests.length,reported,called,unresolved,unavailable,
      complete:contests.length>0 && called===contests.length && reported===contests.length};
  }
  function historicalSnapshot(data, catalogue, config) {
    const races = Array.isArray(data?.groups)
      ? data.groups.flatMap(group=>Array.isArray(group?.races) ? group.races : [])
      : [];
    const expected = catalogue.filter(race=>['senate','house'].includes(race.type));
    const congressional = races.filter(race=>['senate','house'].includes(race?.type));
    const byId = new Map(congressional.map(race=>[race.id,race]));
    const recorded = data?.provider?.lastUpstreamUpdate || data?.generatedAt;
    const timestamp = Date.parse(recorded);
    if (!data?.provider?.name || !Number.isFinite(timestamp) || timestamp<Date.parse(config.electionDate) ||
      expected.length!==config.expected.house+config.expected.senate-config.continuing.reduce((sum,term)=>sum+term.seats.length,0) ||
      byId.size!==expected.length || congressional.length!==expected.length ||
      expected.some(entry=>{
        const race = byId.get(entry.id);
        return !race || race.type!==entry.type || race.state!==entry.state || race.electionDate!==config.electionDate ||
          !Array.isArray(race.candidates) || !race.candidates.length ||
          race.candidates.some(candidate=>typeof candidate?.name!=='string' || !candidate.name.trim() ||
            !Number.isSafeInteger(candidate.votes) || candidate.votes<0) ||
          !Number.isSafeInteger(race.candidates.reduce((sum,candidate)=>sum+candidate.votes,0)) ||
          (race.calls!=null && !Array.isArray(race.calls));
      }) || !congressional.some(race=>race.candidates.some(candidate=>Number.isSafeInteger(candidate.votes) && candidate.votes>0))) return null;
    const coverage = Object.fromEntries(['senate','house'].map(office=>[
      office,historicalCoverage(composition(office,catalogue,config,congressional).seats)
    ]));
    return {races:congressional,provider:data.provider,updatedAt:recorded,coverage};
  }
  function composition(office, catalogue, config, results) {
    const live = new Map(results.filter(race=>race.type===office).map(race=>[race.id,race]));
    const seats = catalogue.filter(race=>race.type===office).map(entry=>{
      const race = live.get(entry.id);
      const call = race?.calls?.[0];
      const winner = call?.candidate && !call.retracted && ['winner','projected'].includes(call.status)
        ? race.candidates?.find(candidate=>candidate.name===call.candidate) : null;
      const votes = race?.candidates?.filter(candidate=>Number.isSafeInteger(candidate.votes) && candidate.votes>=0) || [];
      const ranked = [...votes].sort((a,b)=>b.votes-a.votes);
      const total = ranked.reduce((sum,candidate)=>sum+candidate.votes,0);
      const tied = total>0 && ranked[0].votes===ranked[1]?.votes;
      const leader = total>0 && !tied ? ranked[0] : null;
      const runner = ranked.find(candidate=>candidate!==winner);
      const gap = winner && runner && runner.votes>0 && winner.votes>=runner.votes && total>0
        ? winner.votes-runner.votes : null;
      const status = winner ? 'called' : race && (!call || call.retracted || !['winner','projected'].includes(call.status)) ? 'uncalled' : 'missing';
      const code = party(winner);
      return {
        id:entry.id,state:entry.state,title:race?.title || race?.electionName || (office==='house' ? entry.state+'-'+entry.district : entry.state+' Senate'),
        status,group:winner ? (['D','R','I'].includes(code) ? code : 'O') : status,
        special:office==='senate' && config.specialSenateRaces.includes(entry.id),
        race,winner,call,ranked,total,tied,leader,gap,margin:gap===null ? null : 100*gap/total
      };
    });
    if (office==='senate') for (const term of config.continuing) {
      for (const [state,group,name,caucus] of term.seats) {
        seats.push({id:`senate-${state}-class-${term.class}`,state,title:state+' Senate',name,caucus,
          group,status:'continuing',termEnds:term.termEnds,source:term.source});
      }
    }
    const counts = Object.fromEntries(order.map(key=>[key,seats.filter(seat=>seat.group===key).length]));
    const states = new Map();
    for (const seat of seats) states.set(seat.state,(states.get(seat.state)||0)+1);
    const complete = seats.length===config.expected[office] && new Set(seats.map(seat=>seat.id)).size===seats.length &&
      (office!=='senate' || states.size===50 && [...states.values()].every(count=>count===2));
    return {seats,counts,complete};
  }
  function arrange(seats, mode) {
    return [...seats].sort((a,b)=>{
      const group = order.indexOf(section(a))-order.indexOf(section(b));
      if (group) return group;
      const continuing = Number(a.status==='continuing')-Number(b.status==='continuing');
      if (continuing) return a.group==='R' ? continuing : -continuing;
      const byState = a.state.localeCompare(b.state) || a.id.localeCompare(b.id,undefined,{numeric:true});
      if (mode==='state') return byState;
      if (mode==='margin') {
        const aKnown = Number.isFinite(a.margin), bKnown = Number.isFinite(b.margin);
        const direction = section(a)==='R' ? -1 : 1;
        if (aKnown!==bKnown) return direction*(Number(aKnown)-Number(bKnown));
        if (aKnown && a.margin!==b.margin) return direction*(b.margin-a.margin);
        return byState;
      }
      return 0;
    });
  }
  function layout(count) {
    if (!count) return [];
    const rows = count>120 ? 10 : 5;
    const radii = Array.from({length:rows},(_,i)=>112+i*296/(rows-1));
    const sum = radii.reduce((total,r)=>total+r,0);
    const capacities = radii.map(r=>Math.floor(r*count/sum));
    for (let i=rows-1, remaining=count-capacities.reduce((a,b)=>a+b,0);remaining;i--,remaining--) capacities[i]++;
    return radii.flatMap((radius,row)=>Array.from({length:capacities[row]},(_,i)=>{
      const angle = Math.PI-(i+.5)*Math.PI/capacities[row];
      return {x:450+radius*Math.cos(angle),y:340-.70*radius*Math.sin(angle),angle};
    })).sort((a,b)=>b.angle-a.angle || a.y-b.y);
  }
  const api = {composition,arrange,layout,section,historicalSnapshot};
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.FEAIncomingCongress=api;
})(globalThis);
