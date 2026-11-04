(async () => {
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
    const stamp = Number.isFinite(+updated) ? new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(updated)+' ET' : '';
    $('home-results-source').textContent = [`${all.reported} of ${rows.length} races reporting`,data.provider?.name || 'FEA results',stamp,data.provider?.stale ? 'Updates may be delayed' : ''].filter(Boolean).join(' · ');
    const open = all.close.filter(({race})=>!race.calls?.length);
    const selected = (open.length ? open : all.close).slice(0,4);
    $('home-notable-title').textContent = open.length ? 'Closest uncalled races' : 'Closest reported races';
    if (!selected.length) {
      $('home-notable-races').replaceChildren(node('li','No races with two candidates reporting votes in this snapshot.'));
      return;
    }
    $('home-notable-races').replaceChildren(...selected.map(({race,current})=>{
      const item = document.createElement('li');
      const name = race.title || race.electionName || race.id;
      const gap = current.gapPoints;
      const reading = gap===0 ? 'Tied' : gap<.01 ? 'Less than 0.01 points apart' : `${gap.toFixed(2)} points apart`;
      const pair = current.ranked.slice(0,2).map(c=>`${c.name} ${(100*c.votes/current.total).toFixed(1)}%`).join(' · ');
      item.append(link('/results?'+new URLSearchParams({office:race.type,race:race.id}),name),node('span',pair),node('small',reading+(race.calls?.length?' · Called':' · Uncalled')));
      return item;
    }));
  } catch {
    $('home-results-lines').replaceChildren(node('p','Reported results are unavailable.'));
    $('home-notable-races').replaceChildren(node('li','Race margins are unavailable.'));
  }
})();
