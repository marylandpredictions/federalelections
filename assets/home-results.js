(() => {
  const offices = {house:'House',senate:'Senate',governor:'Governors'};
  const party = candidate => candidate?.partyCode || candidate?.party;
  const expected = race => {
    const value = race.expectedVotePercent ?? race.estimatedVoteReporting;
    return Number.isFinite(value) && value>=0 && value<=100 ? value : null;
  };
  function nationalHousePopular(housePopular) {
    const national = {D:0,R:0,other:0};
    for (const row of housePopular.values()) {
      national.D += row.D;
      national.R += row.R;
      national.other += row.other;
    }
    const total = national.D + national.R + national.other;
    return {
      ...national,
      total,
      demShare: total ? 100 * national.D / total : 0,
      repShare: total ? 100 * national.R / total : 0,
      otherShare: total ? 100 * national.other / total : 0,
      margin: total ? 100 * (national.D - national.R) / total : 0,
    };
  }

  function summarize(races) {
    const totals = Object.fromEntries(Object.keys(offices).map(office=>[office,{D:0,R:0,other:0,called:0,open:0}]));
    const close = [], recent = [];
    const housePopular = new Map();
    for (const race of races) {
      if (race.type === 'house' && race.state) {
        const row = housePopular.get(race.state) || {D:0,R:0,other:0};
        for (const candidate of race.candidates || []) {
          if (!Number.isSafeInteger(candidate.votes) || candidate.votes < 0) continue;
          const code = party(candidate);
          row[code==='D'||code==='R'?code:'other'] += candidate.votes;
        }
        housePopular.set(race.state, row);
      }
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
    return {
      totals,
      housePopular,
      nationalHouse: nationalHousePopular(housePopular),
      close: close.sort((a,b)=>a.gap-b.gap).slice(0,4),
      recent: recent.sort((a,b)=>b.time-a.time).slice(0,5),
    };
  }
  function houseGeometryId(race) {
    const state = race?.state;
    const district = race?.district;
    if (!state) return null;
    if (district === 'AL' || district === 0 || district === '0' || district == null) return `${state}-AL`;
    return `${state}-${String(district).padStart(2,'0')}`;
  }
  function statePopularLean(housePopular) {
    const colors = new Map();
    for (const [state, row] of housePopular) {
      const total = row.D + row.R + row.other;
      let lean = 'open';
      if (total > 0) {
        if (row.D > row.R && row.D >= row.other) lean = 'D';
        else if (row.R > row.D && row.R >= row.other) lean = 'R';
        else if (row.other > row.D && row.other > row.R) lean = 'other';
        else lean = 'split';
      }
      colors.set(state, {
        ...row,
        total,
        lean,
        demShare: total ? 100 * row.D / total : 0,
        repShare: total ? 100 * row.R / total : 0,
        otherShare: total ? 100 * row.other / total : 0,
      });
    }
    return colors;
  }

  if (typeof module==='object' && module.exports) {
    module.exports = {summarize,houseGeometryId,statePopularLean,nationalHousePopular};
    return;
  }

  const $ = id => document.getElementById(id);
  const element = (tag,text) => Object.assign(document.createElement(tag),{textContent:text});
  const link = (href,text) => Object.assign(element('a',text),{href});
  const raceLink = race => link('/results?'+new URLSearchParams({office:race.type,race:race.id}),race.electionName || race.title || race.id);
  function tone(node,code) {
    node.dataset.party = code==='D'||code==='R' ? code : code==='I' ? 'I' : 'other';
    return node;
  }
  function bar(segments,total) {
    const track = element('div','');
    track.className = 'home-party-bar';
    track.setAttribute('aria-hidden','true');
    for (const [code,value] of segments) {
      const segment = tone(element('span',''),code);
      segment.style.width = (total ? 100*value/total : 0)+'%';
      track.append(segment);
    }
    return track;
  }
  function relativeTime(time) {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    return date.format(time)+' ET';
  }
  const date = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'});
  const publish = detail => document.dispatchEvent(new CustomEvent('fea-home-results',{detail}));
  function mapFill() {
    const styles = getComputedStyle(document.body);
    const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    return {
      D: read('--home-map-d', '#3a7bd5'),
      R: read('--home-map-r', '#c94352'),
      other: read('--home-map-other', '#8b5cf6'),
      open: read('--home-map-open', '#1a2438'),
      split: read('--home-map-split', '#6a7d9c'),
      water: read('--home-map-water', '#07101f'),
      stroke: read('--home-map-stroke', 'rgba(5, 12, 28, 0.9)'),
    };
  }
  const fipsToState = {
    '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV','55':'WI','56':'WY',
  };
  let busy = false, lastSource = '', mapPromise = null, lastHousePopular = null;
  const votes = new Intl.NumberFormat('en-US');

  function setMetric(id, text, barId, width) {
    if (id && text != null) {
      const node = $(id);
      if (node) node.textContent = text;
    }
    const bar = barId && $(barId);
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, width || 0))}%`;
  }

  function renderNationalPopular(national) {
    if (!national?.total) {
      setMetric('home-pv-dem', '—', 'home-pv-dem-bar', 0);
      setMetric('home-pv-rep', '—', 'home-pv-rep-bar', 0);
      setMetric('home-pv-other', '—', 'home-pv-other-bar', 0);
      const margin = $('home-pv-margin');
      if (margin) margin.textContent = 'National total —';
      return;
    }
    setMetric('home-pv-dem', `${national.demShare.toFixed(1)}%`, 'home-pv-dem-bar', national.demShare);
    setMetric('home-pv-rep', `${national.repShare.toFixed(1)}%`, 'home-pv-rep-bar', national.repShare);
    setMetric('home-pv-other', `${national.otherShare.toFixed(1)}%`, 'home-pv-other-bar', national.otherShare);
    const margin = $('home-pv-margin');
    if (margin) {
      const lead = national.margin === 0 ? 'Tied'
        : `${national.margin > 0 ? 'D' : 'R'} +${Math.abs(national.margin).toFixed(1)}`;
      margin.textContent = `${lead} · ${votes.format(national.total)} votes`;
      margin.dataset.tone = national.margin > 0 ? 'D' : national.margin < 0 ? 'R' : 'split';
    }
  }

  function stateCode(feature) {
    const id = String(feature.id || feature.properties?.STATE || feature.properties?.STATEFP || '');
    if (id.length === 2 && /^\d+$/.test(id)) return fipsToState[id] || '';
    return feature.properties?.STUSPS || feature.properties?.postal || '';
  }

  // Drop degenerate rings (zero-area slivers). Virginia's GeoJSON includes one
  // that geoPath turns into a continent-sized SVG fill covering the whole map.
  function usableRing(ring) {
    if (!Array.isArray(ring) || ring.length < 4) return false;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const point of ring) {
      if (!Array.isArray(point) || point.length < 2) return false;
      minX = Math.min(minX, point[0]);
      maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
    }
    return (maxX - minX) > 1e-4 && (maxY - minY) > 1e-4;
  }

  function sanitizeFeature(feature) {
    const geometry = feature?.geometry;
    if (!geometry) return null;
    if (geometry.type === 'Polygon') {
      const rings = geometry.coordinates.filter(usableRing);
      if (!rings.length) return null;
      return {...feature, geometry: {type: 'Polygon', coordinates: rings}};
    }
    if (geometry.type === 'MultiPolygon') {
      const polys = geometry.coordinates
        .map(poly => poly.filter(usableRing))
        .filter(poly => poly.length);
      if (!polys.length) return null;
      return {...feature, geometry: polys.length === 1
        ? {type: 'Polygon', coordinates: polys[0]}
        : {type: 'MultiPolygon', coordinates: polys}};
    }
    return feature;
  }

  function mapTipHtml(state, row) {
    if (!row?.total) {
      return `<strong>${state}</strong><span>No House votes reported</span>`;
    }
    const lead = row.lean === 'D' ? 'Dem lead'
      : row.lean === 'R' ? 'Rep lead'
      : row.lean === 'other' ? 'Other lead'
      : 'Tied';
    const other = row.other
      ? `<em data-party="other">O ${row.otherShare.toFixed(1)}%</em>`
      : '';
    return `<strong>${state}</strong><span>${lead}</span>` +
      `<em data-party="D">D ${row.demShare.toFixed(1)}%</em>` +
      `<em data-party="R">R ${row.repShare.toFixed(1)}%</em>${other}`;
  }

  function bindMapTip(host, svg) {
    const tip = $('home-map-tip');
    const shell = host.parentElement || host;
    if (!tip || tip.dataset.bound === '1') return;
    tip.dataset.bound = '1';
    const hide = () => { tip.hidden = true; tip.removeAttribute('data-party'); };
    const move = event => {
      const bounds = shell.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const pad = 10;
      const width = tip.offsetWidth || 140;
      const height = tip.offsetHeight || 72;
      tip.style.left = `${Math.min(bounds.width - width - pad, Math.max(pad, x + 12))}px`;
      tip.style.top = `${Math.min(bounds.height - height - pad, Math.max(pad, y - height - 8))}px`;
    };
    svg.selectAll('path.state')
      .style('cursor', 'pointer')
      .on('pointerenter', function(event) {
        tip.innerHTML = this.dataset.tip || '';
        tip.hidden = false;
        tip.dataset.party = this.dataset.lean || 'open';
        move(event);
      })
      .on('pointermove', move)
      .on('pointerleave', hide);
    shell.addEventListener('pointerleave', hide);
  }

  async function ensureMap() {
    if (mapPromise) return mapPromise;
    const host = $('home-hero-map');
    if (!host || !window.d3) return null;
    mapPromise = (async () => {
      const raw = await fetch('data/result-us-states.geojson',{cache:'force-cache'}).then(r=>r.json());
      const features = (raw.features || [])
        .map(sanitizeFeature)
        .filter(feature => {
          const code = stateCode(feature);
          return feature && code && code !== 'DC';
        });
      const width = 960, height = 560;
      const projection = d3.geoAlbersUsa().fitExtent([[8,12],[width-8,height-8]], {type:'FeatureCollection',features});
      const path = d3.geoPath(projection);
      host.replaceChildren();
      const svg = d3.select(host).append('svg')
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('preserveAspectRatio', 'xMidYMid meet')
        .attr('role','presentation');
      const colors = mapFill();
      svg.append('rect')
        .attr('class', 'home-map-water')
        .attr('width', width)
        .attr('height', height)
        .attr('fill', colors.water);
      svg.selectAll('path.state')
        .data(features.filter(feature => path(feature)))
        .join('path')
        .attr('class', 'state')
        .attr('d', path)
        .attr('fill', colors.open)
        .attr('stroke', colors.stroke)
        .attr('stroke-width', 1.35)
        .attr('stroke-linejoin', 'round')
        .attr('data-state', stateCode);
      bindMapTip(host, svg);
      return svg;
    })().catch(error => {
      console.warn('Home map unavailable', error);
      mapPromise = null;
      return null;
    });
    return mapPromise;
  }

  async function paintMap(housePopular) {
    lastHousePopular = housePopular;
    const svg = await ensureMap();
    if (!svg) return;
    const leans = statePopularLean(housePopular);
    const colors = mapFill();
    svg.select('rect.home-map-water').attr('fill', colors.water);
    svg.selectAll('path.state')
      .attr('stroke', colors.stroke)
      .attr('fill', function() {
        const row = leans.get(this.getAttribute('data-state'));
        const code = row?.lean;
        if (code === 'split') return colors.split;
        return colors[code] || colors.open;
      })
      .attr('data-lean', function() {
        return leans.get(this.getAttribute('data-state'))?.lean || 'open';
      })
      .attr('data-tip', function() {
        const state = this.getAttribute('data-state');
        return mapTipHtml(state, leans.get(state));
      });
  }

  async function refresh() {
    if (busy || document.hidden || document.activeElement?.closest('.home-national-results,#home-election-updates,.home-calls')) return;
    busy = true;
    try {
      const response = await fetch('/api/live-results',{signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw Error('Results unavailable');
      const data = await response.json();
      const races = data.groups.flatMap(group=>group.races).filter(race=>race.electionDate==='2026-11-03');
      if (!races.length) throw Error('No 2026 races in the response');
      const updatedAt = data.updatedAt || data.generatedAt;
      const {totals,housePopular,nationalHouse,close,recent} = summarize(races);
      publish({races,provider:data.provider,updatedAt});
      renderNationalPopular(nationalHouse);
      void paintMap(housePopular);
      const chamberOrder = ['house','senate'];
      $('home-results-lines').replaceChildren(...chamberOrder.map(office=>{
        const total = totals[office];
        const row = element('div','');
        const counts = element('strong','');
        counts.append(tone(element('span',total.D+' D'),'D'),' · ',tone(element('span',total.R+' R'),'R'));
        if (total.other) counts.append(' · ',tone(element('span',total.other+' I'),'I'));
        row.append(link('/results?office='+office,offices[office]),counts,
          bar([['D',total.D],['other',total.other],['R',total.R]],total.called+total.open),
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
        const shares = element('span','');
        for (const [index,candidate] of candidates.entries()) {
          if (index) shares.append(' · ');
          shares.append(tone(element('span',`${candidate.name} ${(100*candidate.votes/total).toFixed(1)}%`),party(candidate)));
        }
        const margin = gap===0 ? 'Tied' : gap<.01 ? 'Less than 0.01 points apart' : gap.toFixed(2)+' points apart';
        const reporting = expected(race);
        item.append(raceLink(race),shares,element('small',margin+
          (reporting===null ? ' · Expected vote unavailable' : ` · ${reporting}% expected vote in`)));
        return item;
      }) : [element('li','No uncalled races with a usable margin in this update.')]));
      $('home-recent-calls').replaceChildren(...(recent.length ? recent.map(({race,call,winner,time})=>{
        const item = element('li','');
        const badge = tone(element('span',party(winner) || '—'),party(winner));
        badge.className = 'home-call-party';
        const meta = element('small',relativeTime(time));
        item.append(badge, raceLink(race), tone(element('span',winner.name),party(winner)), meta);
        return item;
      }) : [element('li','No timestamped published calls in this update.')]));
    } catch {
      publish({unavailable:true});
      $('home-results-source').textContent = lastSource ? lastSource+' · Refresh unavailable' : '2026 results are unavailable.';
      if (!lastSource) for (const id of ['home-results-lines','home-notable-races','home-recent-calls'])
        $(id)?.replaceChildren(element(id==='home-results-lines'?'p':'li','Results are unavailable.'));
    } finally {
      busy = false;
    }
  }
  async function biasPreview() {
    const response = await fetch('/data/features/polling-bias.json',{signal:AbortSignal.timeout(8000)});
    if (!response.ok) return;
    const {states} = await response.json();
    const ranked = states.filter(row=>Number.isFinite(row.prior)).sort((a,b)=>Math.abs(b.prior)-Math.abs(a.prior));
    const demStates = ranked.filter(row=>row.prior>0);
    const repStates = ranked.filter(row=>row.prior<0);
    const entries = [...demStates.slice(0,3),...repStates.slice(0,3)];
    if (!entries.length) return;
    const scale = Math.max(...entries.map(row=>Math.abs(row.prior)));
    $('home-bias-rows').replaceChildren(...entries.map(row=>{
      const item = element('li','');
      const code = row.prior>0?'D':'R';
      const track = bar([[code,Math.abs(row.prior)]],scale*2);
      track.classList.add('home-bias-bar');
      track.dataset.direction = code;
      item.append(element('span',row.state),track,tone(element('strong',`${code} +${Math.abs(row.prior).toFixed(1)} pts`),code));
      return item;
    }));
    const summary = $('home-bias-summary');
    if (summary) {
      const avg = ranked.reduce((sum,row)=>sum+Math.abs(row.prior),0) / ranked.length;
      const cell = (value, label) => {
        const wrap = element('div','');
        wrap.append(element('strong', value), element('span', label));
        return wrap;
      };
      summary.replaceChildren(
        cell(String(demStates.length), 'states where polls overstated Dems'),
        cell(String(repStates.length), 'states where polls overstated GOP'),
        cell(avg.toFixed(1), 'pts average absolute miss'),
      );
    }
    $('home-bias-preview').hidden = false;
  }
  if (document.body.dataset.electionPhase==='between-elections') {
    const updates = $('home-election-updates');
    if (updates) updates.hidden = true;
    $('home-results-lines')?.replaceChildren(element('p','Explore the recorded 2026 results below.'));
  } else {
    void ensureMap();
    void refresh();
    setInterval(refresh,60000);
    document.addEventListener('visibilitychange',() => {
      if (!document.hidden) {
        if (lastHousePopular) void paintMap(lastHousePopular);
        void refresh();
      }
    });
  }
  biasPreview().catch(()=>{});

  function etDay() {
    return new Date().toLocaleDateString('en-CA', {timeZone: 'America/New_York'});
  }

  async function approvalCard() {
    const approve = $('home-approval-approve');
    const disapprove = $('home-approval-disapprove');
    const net = $('home-approval-net');
    if (!approve || !disapprove) return;
    try {
      const response = await fetch(`/data/polling/trump-approval.json?d=${etDay()}`, {
        cache: 'no-cache',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Error('Approval unavailable');
      const {current} = await response.json();
      const total = current.approve + current.disapprove;
      approve.textContent = `${Math.round(current.approve)}%`;
      disapprove.textContent = `${Math.round(current.disapprove)}%`;
      setMetric(null, null, 'home-approval-approve-bar', total ? 100 * current.approve / total : 0);
      setMetric(null, null, 'home-approval-disapprove-bar', total ? 100 * current.disapprove / total : 0);
      if (net) {
        const sign = current.net > 0 ? '+' : '';
        net.textContent = `Net ${sign}${current.net.toFixed(1)}`;
        net.dataset.tone = current.net >= 0 ? 'approve' : 'disapprove';
      }
    } catch {
      approve.textContent = '—';
      disapprove.textContent = '—';
      if (net) {
        net.textContent = 'Net —';
        delete net.dataset.tone;
      }
    }
  }

  let approvalDay = etDay();
  void approvalCard();
  setInterval(() => {
    const day = etDay();
    if (day !== approvalDay) {
      approvalDay = day;
      void approvalCard();
    }
  }, 60 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const day = etDay();
    if (day !== approvalDay) {
      approvalDay = day;
      void approvalCard();
    }
  });

  new MutationObserver(() => {
    if (lastHousePopular) void paintMap(lastHousePopular);
  }).observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
})();
