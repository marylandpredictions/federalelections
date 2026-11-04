(() => {
  const $ = id => document.getElementById(id);
  const node = (tag,text) => {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
  };
  const link = (href,text) => {
    const element = node('a',text);
    element.href = href;
    return element;
  };
  const raceLink = race => link('/results?'+new URLSearchParams({office:race.type,race:race.id}),race.title || race.electionName || race.id);
  const dateFormat = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'});
  const partyCode = candidate => candidate?.partyCode || candidate?.party;
  function partyTone(element, code) {
    if (code === 'D' || code === 'R') element.classList.add(code === 'D' ? 'home-dem' : 'home-rep');
    return element;
  }
  let loaded = false;
  let refreshing = false;
  async function refresh() {
    if (refreshing || document.hidden || document.activeElement?.closest('#home-results-lines, .home-updates')) return;
    refreshing = true;
    try {
      const response = await fetch('/api/live-results',{signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error('Results unavailable');
      const data = await response.json();
      const races = (data.groups || []).flatMap(group=>group.races || []);
      if (!races.length) throw new Error('No results in snapshot');
      const rows = races.map(race=>({race,current:FEALabAnalysis.contest(race.candidates)}));
      const all = FEALabAnalysis.findings(rows);
      const labels = {house:'House',senate:'Senate',governor:'Governors'};
      const lines = Object.entries(labels).map(([office,label])=>{
        const officeRows = rows.filter(({race})=>race.type===office);
        const {calls} = FEALabAnalysis.findings(officeRows);
        const line = document.createElement('div');
        line.className = 'home-result-line';
        const total = node('strong','');
        for (const [code,style] of [['D','home-dem'],['R','home-rep']]) {
          const count = node('span',`${calls[code]} ${code}`);
          count.className = style;
          total.append(count);
        }
        if (calls.other) total.append(node('span',`${calls.other} other`));
        line.append(link('/results?office='+office,label),total,node('small',`${calls.D+calls.R+calls.other} of ${officeRows.length} called`));
        return line;
      });
      $('home-results-lines').replaceChildren(...lines);
      const updated = new Date(data.provider?.lastUpstreamUpdate || data.updatedAt || data.generatedAt);
      const stamp = Number.isFinite(+updated) ? dateFormat.format(updated)+' ET' : '';
      $('home-results-source').textContent = [`${all.reported} of ${rows.length} races reporting`,data.provider?.name || 'FEA results',stamp,data.provider?.stale ? 'Updates may be delayed' : ''].filter(Boolean).join(' · ');
      const open = all.close.filter(({race})=>!race.calls?.length);
      const selected = (open.length ? open : all.close).slice(0,4);
      const recent = races.flatMap(race=>(race.calls || []).slice(0,1).map(call=>({race,call,time:Date.parse(call.calledAt)})))
        .filter(({time})=>Number.isFinite(time)).sort((a,b)=>b.time-a.time).slice(0,4);
      $('home-recent-calls').replaceChildren(...(recent.length ? recent.map(({race,call,time})=>{
        const item = document.createElement('li');
        const winner = race.candidates.find(candidate=>candidate.name===call.candidate);
        const code = partyCode(winner);
        const name = partyTone(node('strong', [call.candidate,code && '('+code+')'].filter(Boolean).join(' ')),code);
        const timeLabel = node('time',dateFormat.format(time)+' ET');
        timeLabel.dateTime = new Date(time).toISOString();
        const meta = node('small','');
        const source = call.provider || call.source;
        if (source) meta.append(source+' · ');
        meta.append(timeLabel);
        item.append(raceLink(race),name,meta);
        return item;
      }) : [node('li','No timestamped calls in this snapshot.')]));
      $('home-notable-title').textContent = open.length ? 'Closest uncalled races' : 'Closest reported races';
      loaded = true;
      if (!selected.length) {
        $('home-notable-races').replaceChildren(node('li','No races with two candidates reporting votes in this snapshot.'));
        return;
      }
      $('home-notable-races').replaceChildren(...selected.map(({race,current})=>{
        const item = document.createElement('li');
        const gap = current.gapPoints;
        const reading = gap===0 ? 'Tied' : gap<.01 ? 'Less than 0.01 points apart' : `${gap.toFixed(2)} points apart`;
        const candidates = node('div','');
        candidates.className = 'home-race-candidates';
        const bar = node('div','');
        bar.className = 'home-vote-bar';
        bar.setAttribute('aria-hidden','true');
        for (const candidate of current.ranked.slice(0,2)) {
          const share = 100*candidate.votes/current.total;
          const code = partyCode(candidate);
          const label = node('div','');
          label.append(node('span',candidate.name),partyTone(node('strong',share.toFixed(1)+'%'),code));
          const segment = partyTone(node('span',''),code);
          segment.style.width = share+'%';
          candidates.append(label);
          bar.append(segment);
        }
        const expected = race.expectedVotePercent ?? race.estimatedVoteReporting;
        const status = race.calls?.length ? 'Called' : 'Uncalled';
        const progress = Number.isFinite(expected) && expected >= 0 && expected <= 100 ? ` · ${expected}% expected vote in` : '';
        item.append(raceLink(race),candidates,bar,node('small',reading+' · '+status+progress));
        return item;
      }));
    } catch {
      if (loaded) {
        const source = $('home-results-source');
        if (!source.textContent.includes('Refresh unavailable')) source.textContent += ' · Refresh unavailable';
        return;
      }
      $('home-results-lines').replaceChildren(node('p','Reported results are unavailable.'));
      $('home-notable-races').replaceChildren(node('li','Race margins are unavailable.'));
      $('home-recent-calls').replaceChildren(node('li','Public calls are unavailable.'));
    } finally {
      refreshing = false;
    }
  }
  void refresh();
  setInterval(refresh,60000);
  document.addEventListener('visibilitychange',refresh);
})();
