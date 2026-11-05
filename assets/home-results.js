(() => {
  const offices = {house:'House',senate:'Senate races',governor:'Governors'};
  const party = candidate => candidate?.partyCode || candidate?.party;
  const expected = race => {
    const value = race.expectedVotePercent ?? race.estimatedVoteReporting;
    return Number.isFinite(value) && value>=0 && value<=100 ? value : null;
  };
  function summarize(races) {
    const totals = Object.fromEntries(Object.keys(offices).map(office=>[office,{D:0,R:0,other:0,called:0,open:0}]));
    const close = [], recent = [];
    for (const race of races) {
      const counts = totals[race.type];
      if (!counts) continue;
      const entry = race.calls?.[0];
      const call = entry && !entry.retracted && ['projected','winner'].includes(entry.status) && entry.candidate ? entry : null;
      const winner = call && race.candidates?.find(candidate=>candidate.name===call.candidate);
      if (winner) {
        counts.called++;
        const code = party(winner);
        counts[code==='D'||code==='R'?code:'other']++;
        const time = Date.parse(call.calledAt);
        if (Number.isFinite(time)) recent.push({race,call,winner,time});
        continue;
      }
      counts.open++;
      if (call || (expected(race)!==null && expected(race)<25)) continue;
      const ranked = (race.candidates || []).filter(candidate=>Number.isSafeInteger(candidate.votes) && candidate.votes>=0)
        .sort((a,b)=>b.votes-a.votes);
      const total = ranked.reduce((sum,candidate)=>sum+candidate.votes,0);
      if (!ranked[1]?.votes || !Number.isSafeInteger(total)) continue;
      close.push({race,candidates:ranked.slice(0,2),total,gap:100*(ranked[0].votes-ranked[1].votes)/total});
    }
    return {totals,close:close.sort((a,b)=>a.gap-b.gap).slice(0,4),
      recent:recent.sort((a,b)=>b.time-a.time).slice(0,4)};
  }
  if (typeof module==='object' && module.exports) {
    module.exports = {summarize};
    return;
  }

  const $ = id => document.getElementById(id);
  const element = (tag,text) => Object.assign(document.createElement(tag),{textContent:text});
  const link = (href,text) => Object.assign(element('a',text),{href});
  const raceLink = race => link('/results?'+new URLSearchParams({office:race.type,race:race.id}),race.electionName || race.title || race.id);
  const date = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'});
  const publish = detail => document.dispatchEvent(new CustomEvent('fea-home-results',{detail}));
  let busy = false, lastSource = '';
  async function refresh() {
    if (busy || document.hidden || document.activeElement?.closest('.home-national-results,#home-election-updates')) return;
    busy = true;
    try {
      const response = await fetch('/api/live-results',{signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw Error('Results unavailable');
      const data = await response.json();
      const races = data.groups.flatMap(group=>group.races).filter(race=>race.electionDate==='2026-11-03');
      if (!races.length) throw Error('No 2026 races in the response');
      const updatedAt = data.updatedAt || data.generatedAt;
      const {totals,close,recent} = summarize(races);
      publish({races,provider:data.provider,updatedAt});
      $('home-results-lines').replaceChildren(...Object.entries(totals).map(([office,total])=>{
        const row = element('div','');
        const counts = `${total.D} D · ${total.R} R${total.other ? ' · '+total.other+' other' : ''}`;
        row.append(link('/results?office='+office,offices[office]),element('strong',counts),
          element('small',`${total.called} called · ${total.open} outstanding`));
        return row;
      }));
      const stamp = Date.parse(data.provider?.lastUpstreamUpdate || updatedAt);
      lastSource = [data.provider?.name || 'FEA results',
        Number.isFinite(stamp) ? date.format(stamp)+' ET' : '',
        data.provider?.stale ? 'Updates may be delayed' : ''].filter(Boolean).join(' · ');
      $('home-results-source').textContent = lastSource;
      $('home-notable-races').replaceChildren(...(close.length ? close.map(({race,candidates,total,gap})=>{
        const item = element('li','');
        const shares = candidates.map(c=>`${c.name} ${(100*c.votes/total).toFixed(1)}%`).join(' · ');
        const margin = gap===0 ? 'Tied' : gap<.01 ? 'Less than 0.01 points apart' : gap.toFixed(2)+' points apart';
        const reporting = expected(race);
        item.append(raceLink(race),element('span',shares),element('small',margin+
          (reporting===null ? ' · Expected vote unavailable' : ` · ${reporting}% expected vote in`)));
        return item;
      }) : [element('li','No uncalled races with a usable margin in this update.')]));
      $('home-recent-calls').replaceChildren(...(recent.length ? recent.map(({race,call,winner,time})=>{
        const item = element('li','');
        const timeLabel = element('time',date.format(time)+' ET');
        timeLabel.dateTime = new Date(time).toISOString();
        const source = call.provider || (/^nbc-/.test(call.source || '') ? 'NBC' : 'FEA');
        const meta = element('small',source+' · ');
        meta.append(timeLabel);
        item.append(raceLink(race),element('span',winner.name+(party(winner) ? ' ('+party(winner)+')' : '')),meta);
        return item;
      }) : [element('li','No timestamped published calls in this update.')]));
    } catch {
      publish({unavailable:true});
      $('home-results-source').textContent = lastSource ? lastSource+' · Refresh unavailable' : '2026 results are unavailable.';
      if (!lastSource) for (const id of ['home-results-lines','home-notable-races','home-recent-calls'])
        $(id).replaceChildren(element(id==='home-results-lines'?'p':'li','Results are unavailable.'));
    } finally {
      busy = false;
    }
  }
  async function biasPreview() {
    const response = await fetch('/data/features/polling-bias.json',{signal:AbortSignal.timeout(8000)});
    if (!response.ok) return;
    const {states} = await response.json();
    const ranked = states.filter(row=>Number.isFinite(row.prior)).sort((a,b)=>Math.abs(b.prior)-Math.abs(a.prior));
    const entries = [...ranked.filter(row=>row.prior>0).slice(0,2),...ranked.filter(row=>row.prior<0).slice(0,2)];
    if (!entries.length) return;
    $('home-bias-rows').replaceChildren(...entries.map(row=>element('li',
      `${row.state} · ${row.prior>0?'D':'R'} ${Math.abs(row.prior).toFixed(1)} pts`)));
    $('home-bias-preview').hidden = false;
  }
  if (document.body.dataset.electionPhase==='between-elections') {
    $('home-election-updates').hidden = true;
    $('home-results-lines').replaceChildren(element('p','Explore the recorded 2026 results below.'));
  } else {
    void refresh();
    setInterval(refresh,60000);
    document.addEventListener('visibilitychange',refresh);
  }
  biasPreview().catch(()=>{});
})();
