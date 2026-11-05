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
  async function showBiasPreview() {
    const response = await fetch('/data/features/polling-bias.json?v=20261030-1', {
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return;
    const data = await response.json();
    const ranked = data.states.filter(state => Number.isFinite(state.prior))
      .sort((a, b) => Math.abs(b.prior) - Math.abs(a.prior));
    const entries = [
      ...ranked.filter(state => state.prior < 0).slice(0, 2),
      ...ranked.filter(state => state.prior > 0).slice(0, 2)
    ].sort((a, b) => Math.abs(b.prior) - Math.abs(a.prior));
    if (!entries.length) return;
    const scale = Math.abs(entries[0].prior);
    $('home-bias-rows').replaceChildren(...entries.map(({state, prior}) => {
      const party = prior < 0 ? 'R' : 'D';
      const row = node('li', '');
      const track = node('span', '');
      track.className = 'home-bias-track';
      track.setAttribute('aria-hidden', 'true');
      const bar = partyTone(node('i', ''), party);
      bar.style.width = 50 * Math.abs(prior) / scale + '%';
      track.append(bar);
      row.append(node('span', state), track,
        partyTone(node('strong', `${party} ${Math.abs(prior).toFixed(1)} pts`), party));
      return row;
    }));
    $('home-bias-preview').hidden = false;
  }
  showBiasPreview().catch(() => {});

  const phase = FEAHomeCycle.phase(document.body.dataset.electionPhase);
  const publishSnapshot = detail => document.dispatchEvent(new CustomEvent('fea-home-results',{detail}));
  $('home-results-title').textContent = phase.title;
  if (!phase.updates) {
    $('home-election-label').textContent = 'Explore the record';
    $('home-results-lines').hidden = true;
    $('home-cycle-links').hidden = false;
    $('home-updates-title').closest('section').hidden = true;
    $('incoming-congress').hidden = true;
    return;
  }
  $('home-election-label').textContent = document.body.dataset.electionLabel || 'Featured election';
  $('home-updates-title').textContent = phase.updates;
  $('home-calls-title').textContent = phase.calls;
  if (!phase.poll) $('home-cycle-links').hidden = false;
  let loaded = false;
  let refreshing = false;
  async function refresh() {
    if (refreshing || document.hidden || document.activeElement?.closest('#home-results-lines, .home-updates')) return;
    refreshing = true;
    try {
      const response = await fetch('/api/live-results',{signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error('Results unavailable');
      const data = await response.json();
      const races = (data.groups || []).flatMap(group=>group.races || []).map(race=>
        race.calls?.length && !FEAHomeCycle.called(race) ? {...race,calls:[]} : race);
      if (!races.length) throw new Error('No results in snapshot');
      publishSnapshot({races,provider:data.provider,updatedAt:data.updatedAt || data.generatedAt});
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
        const bar = node('div','');
        bar.className = 'home-vote-bar home-call-bar';
        bar.setAttribute('aria-hidden','true');
        for (const [code,count] of Object.entries(calls)) {
          const segment = partyTone(node('span',''),code);
          segment.style.width = (100*count/(officeRows.length || 1))+'%';
          bar.append(segment);
        }
        line.append(link('/results?office='+office,label),total,bar,node('small',`${calls.D+calls.R+calls.other} of ${officeRows.length} races called`));
        return line;
      });
      $('home-results-lines').replaceChildren(...lines);
      const updated = new Date(data.provider?.lastUpstreamUpdate || data.updatedAt || data.generatedAt);
      const stamp = Number.isFinite(+updated) ? dateFormat.format(updated)+' ET' : '';
      $('home-results-source').textContent = [`${all.reported} of ${rows.length} races reporting`,data.provider?.name || 'FEA results',stamp,data.provider?.stale ? 'Updates may be delayed' : ''].filter(Boolean).join(' · ');
      const {unresolved,selected,recent} = FEAHomeCycle.raceUpdates(all.close,races);
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
      $('home-notable-title').textContent = unresolved ? 'Closest uncalled races' : 'Closest called results';
      $('home-notable-note').textContent = unresolved ? 'By reported vote-share gap. Races below 25% of expected votes are omitted when an estimate is available.' : 'By reported vote-share gap among called races.';
      loaded = true;
      if (!selected.length) {
        $('home-notable-races').replaceChildren(node('li',unresolved ? 'No uncalled races have a usable margin at this stage of reporting.' : 'No called races have a usable top-two gap in this snapshot.'));
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
        const progress = Number.isFinite(expected) && expected >= 0 && expected <= 100 ? ` · ${expected}% expected vote in` : ' · Expected vote unavailable';
        item.append(raceLink(race),candidates,bar,node('small',reading+' · '+status+progress));
        return item;
      }));
    } catch {
      publishSnapshot({unavailable:true});
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
  if (phase.poll) {
    setInterval(refresh,60000);
    document.addEventListener('visibilitychange',refresh);
  }
})();
