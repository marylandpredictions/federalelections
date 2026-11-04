(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const number = value => Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
  const points = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)} pts` : '—';
  const offices = {house: 'House', senate: 'Senate', governor: 'Governors'};
  const query = new URLSearchParams(location.search);
  const cache = new Map();
  const get = path => {
    const url = new URL(path, location.origin);
    if (!cache.has(url.href)) cache.set(url.href, fetch(url, {signal: AbortSignal.timeout(12000)}).then(response => {
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      return response.json();
    }).catch(error => {
      cache.delete(url.href);
      throw error;
    }));
    return cache.get(url.href);
  };
  const rows = snapshot => (snapshot.groups || []).flatMap(group => group.races || []);
  const title = race => race.title || race.electionName || race.id;
  const party = candidate => candidate.partyCode || candidate.party;
  const raceUrl = id => '/election-race?race=' + encodeURIComponent(id);
  const boardUrl = race => '/results?' + new URLSearchParams({office:race.type,race:race.id});
  function votes(candidates = []) {
    const result = {d: 0, r: 0, total: 0};
    for (const candidate of candidates) {
      if (!Number.isSafeInteger(candidate.votes) || candidate.votes < 0) continue;
      result.total += candidate.votes;
      if (party(candidate) === 'D') result.d += candidate.votes;
      if (party(candidate) === 'R') result.r += candidate.votes;
    }
    result.margin = result.total > 0 ? 100 * (result.d - result.r) / result.total : NaN;
    return result;
  }
  const status = race => race.calls?.[0]?.candidate && !race.calls[0].retracted ? 'Called' : votes(race.candidates).total ? 'Reporting' : 'Awaiting returns';
  const marginLabel = value => Number.isFinite(value) ? value === 0 ? 'Even' : `${value > 0 ? 'D' : 'R'} +${Math.abs(value).toFixed(1)}` : 'Unavailable';
  const stamp = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(value)) + ' ET' : 'Time unavailable';
  function sourceNote(data) {
    return `Preliminary reported returns · ${escape(data.provider?.name || 'FEA results')} · ${escape(stamp(data.provider?.lastUpstreamUpdate || data.updatedAt))}${data.provider?.stale ? ' · Updates may be delayed' : ''}`;
  }
  function options(items, selected) {
    return items.map(([key,label]) => `<option value="${escape(key)}"${key === selected ? ' selected' : ''}>${escape(label)}</option>`).join('');
  }
  function table(headers, body, caption) {
    return `<div class="fea-table" role="region" tabindex="0" aria-label="${escape(caption)}"><table aria-label="${escape(caption)}"><thead><tr>${headers.map(header => `<th scope="col">${escape(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function raceList(list, metrics = new Map(), metric = 'margin') {
    return table(['Race','Status','Votes',metric === 'swing' ? 'Swing' : 'D–R margin'], list.map(race => {
      const result = votes(race.candidates);
      return `<tr><td><a href="${raceUrl(race.id)}">${escape(title(race))}</a></td><td>${status(race)}</td><td>${number(result.total)}</td><td>${marginLabel(metric === 'swing' ? metrics.get(race.id) : result.margin)}</td></tr>`;
    }).join(''), 'Election results');
  }
  function compareName(source) {
    if (source.id.startsWith('pres-')) return `${source.id.slice(5)} presidential`;
    return { 'house-2024':'2024 House', 'senate-last':'Previous same-seat Senate', 'governor-last':'Previous governor' }[source.id] || source.label;
  }
  async function comparison() {
    const manifest = await get('/data/result-comparison-baselines.json');
    return manifest.sources.filter(source => source.status === 'available');
  }
  async function historical(races, source) {
    const result = new Map();
    if (!source || !races.length) return result;
    const kind = races[0].type === 'house' ? 'district' : 'state';
    const file = source[kind + 'File'];
    if (!file) return result;
    const [data, geography] = await Promise.all([
      get('/' + file),
      kind === 'district' ? get('/data/results/district-geography.json') : null
    ]);
    const datasets = new Map([[source.id + ':' + kind, data]]);
    for (const race of races) {
      const geometry = geography?.districts?.[FEAResultsUI.districtId(race)];
      const comparable = kind === 'district' ? {...race,geometryId:geometry?.currentComparable ? geometry.geometryId : null} : race;
      const snapshot = FEAResultsUI.historicalSnapshot(comparable,source,datasets);
      if (snapshot) result.set(race.id,snapshot);
    }
    return result;
  }
  const fips = '01:AL 02:AK 04:AZ 05:AR 06:CA 08:CO 09:CT 10:DE 11:DC 12:FL 13:GA 15:HI 16:ID 17:IL 18:IN 19:IA 20:KS 21:KY 22:LA 23:ME 24:MD 25:MA 26:MI 27:MN 28:MS 29:MO 30:MT 31:NE 32:NV 33:NH 34:NJ 35:NM 36:NY 37:NC 38:ND 39:OH 40:OK 41:OR 42:PA 44:RI 45:SC 46:SD 47:TN 48:TX 49:UT 50:VT 51:VA 53:WA 54:WV 55:WI 56:WY';
  const states = Object.fromEntries(fips.split(' ').map(pair => pair.split(':')));
  async function map(container, list, metrics, office, selectRace, label, colors = ['#b84555','#2368ba'], metric = 'margin') {
    if (!container || !globalThis.d3) throw new Error('Map library unavailable');
    const manifest = await get('/data/results/map-assets.json');
    const geo = await get('/' + manifest[office === 'house' ? 'house' : 'states']);
    const collection = geo.type === 'Topology' ? topojson.feature(geo,geo.objects.districts) : geo;
    const byGeo = new Map(list.map(race => [office === 'house' ? FEAResultsUI.districtId(race) : race.state,race]));
    const key = feature => office === 'house' ? feature.properties.id : states[String(feature.id).padStart(2,'0')];
    drawMap(container,collection,feature=>byGeo.get(key(feature)),metrics,selectRace,label,colors,metric,office==='house');
  }
  function drawMap(container,collection,lookup,metrics,selectRace,label,colors=['#b84555','#2368ba'],metric='margin',dense=false) {
    const rewind = rings => d3.geoArea({type:'Polygon',coordinates:rings}) > Math.PI * 2 ? rings.map(ring => [...ring].reverse()) : rings;
    const features = collection.features.map(feature => {
      const {type,coordinates} = feature.geometry;
      return {...feature,geometry:{type,coordinates:type === 'Polygon' ? rewind(coordinates) : coordinates.map(rewind)}};
    });
    const projection = FEANight.fitRenderedGeometry(d3.geoAlbersUsa(),[[14,10],[706,430]],{type:'FeatureCollection',features});
    const path = d3.geoPath(projection);
    const isShare = metric.endsWith('-share');
    const svg = d3.create('svg').attr('viewBox','0 0 720 440').attr('role','group').attr('aria-label',label);
    for (const feature of features) {
      const race = lookup(feature);
      const value = metrics.get(race?.id);
      const fill = Number.isFinite(value) && (isShare || value !== 0) ? d3.interpolateRgb('#e7eaf0',value > 0 ? colors[1] : colors[0])(isShare ? value / 100 : .38 + .62 * Math.min(1,Math.abs(value)/35)) : '#a7b2c3';
      const node = race ? svg.append('a').attr('href',race.href || raceUrl(race.id)).attr('tabindex',dense ? -1 : 0) : svg;
      const reading = !Number.isFinite(value) ? 'Unavailable' : isShare ? value.toFixed(1)+'%'
        : metric === 'swing' ? value === 0 ? 'No change' : `${Math.abs(value).toFixed(1)} pts toward ${value>0?'D':'R'}` : marginLabel(value);
      const tip = `${race ? title(race) : feature.properties.name || feature.properties.NAME || 'No contest'} · ${reading}`;
      if (race) {
        node.attr('aria-label',tip);
        if (selectRace) node.on('click',event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          selectRace(race);
        });
      }
      node.append('path').datum(feature).attr('d',path).attr('fill',fill).append('title').text(tip);
    }
    const legend = document.createElement('div');
    legend.className = 'fea-legend';
    legend.innerHTML = '<span><b style="background:#2368ba"></b>Democratic</span><span><b style="background:#b84555"></b>Republican</span><span><b style="background:#a7b2c3"></b>Even or unavailable</span>';
    if (metric === 'swing') legend.innerHTML = '<span><b style="background:#2368ba"></b>Toward D</span><span><b style="background:#b84555"></b>Toward R</span><span><b style="background:#a7b2c3"></b>No change or unavailable</span>';
    if (isShare) legend.textContent = (metric === 'dem-share' ? 'Democratic' : 'Republican') + ' share of all votes. Darker color indicates a higher share. Gray indicates unavailable data.';
    container.replaceChildren(svg.node(),legend);
  }
  function enableHomeMapZoom() {
    const svg = d3.select('#home-map svg');
    const viewport = svg.append('g');
    // The homepage map is a pan-and-zoom preview. Keep the tooltips on
    // each path, but leave race selection to the results board.
    for (const link of svg.node().querySelectorAll(':scope > a')) {
      link.replaceWith(...link.childNodes);
    }
    for (const shape of svg.node().querySelectorAll(':scope > path')) {
      viewport.node().appendChild(shape);
    }
    const zoom = d3.zoom()
      .scaleExtent([1,8])
      .translateExtent([[0,0],[720,440]])
      .clickDistance(5)
      .filter(event => !event.button)
      .on('zoom', event => viewport.attr('transform',event.transform));
    svg.call(zoom);
    $('home-zoom-in').onclick = () => svg.call(zoom.scaleBy,1.5);
    $('home-zoom-out').onclick = () => svg.call(zoom.scaleBy,1/1.5);
    $('home-zoom-reset').onclick = () => svg.call(zoom.transform,d3.zoomIdentity);
    $('home-zoom').hidden = false;
  }
  async function homepage() {
    const gapLabel = value => value === 0 ? 'Tied' : value < .01 ? '<0.01 pts' : value.toFixed(2)+' pts';
    function previewBars(target, entries, read) {
      const scale = Math.max(1,...entries.map(entry=>Math.abs(entry.value)));
      $(target).innerHTML = entries.map(entry=>`<div class="home-preview-row"><span>${escape(entry.name)}</span><strong>${escape(read(entry.value))}</strong><span class="home-preview-track" aria-hidden="true"><i class="${entry.party || ''}" style="width:${100*Math.abs(entry.value)/scale}%"></i></span></div>`).join('');
    }
    get('/data/features/polling-bias.json?v=20261030-1').then(data=>{
      const entries = data.states.filter(state=>Number.isFinite(state.prior))
        .sort((a,b)=>Math.abs(b.prior)-Math.abs(a.prior)).slice(0,3)
        .map(state=>({name:state.state,value:state.prior,party:state.prior>0?'home-bar-d':'home-bar-r'}));
      previewBars('home-bias-preview',entries,marginLabel);
    }).catch(()=>{ $('home-bias-preview').textContent = 'State estimates are available in the full study.'; });
    const maker = $('home-maker-preview');
    map(maker,[],new Map(),'senate',null,'United States scenario canvas').then(()=>{
      maker.querySelector('.fea-legend')?.remove();
    }).catch(()=>{});
    const stories = get('/data/articles.json').then(articles => {
      const ordered = [...articles].sort((a,b) => b.date.localeCompare(a.date));
      const featured = ordered[0];
      const card = (article, lead = false) => {
        const image = typeof article.image === 'string' ? article.image : article.image?.url;
        const photo = /^assets\/img\/[a-z0-9_.-]+$/i.test(image || '')
          ? `<img src="/${escape(image)}" alt="${escape(article.image?.alt || '')}" loading="lazy">` : '';
        return `<a class="home-story${photo ? '' : ' home-story-text'}" href="/article?slug=${encodeURIComponent(article.slug)}">${photo}<span class="home-story-copy"><time datetime="${escape(article.date)}">${escape(article.date)}</time><h3>${escape(article.title)}</h3>${lead ? `<p>${escape(article.dek || '')}</p>` : ''}<small>${escape(article.author || 'FEA')}</small></span></a>`;
      };
      $('home-research').innerHTML = featured
        ? card(featured,true) + `<div class="home-story-stack">${ordered.filter(article => article !== featured).slice(0,3).map(article => card(article)).join('')}</div>`
        : '<p>No published articles available.</p>';
    }).catch(() => { $('home-research').textContent = 'The article list could not load.'; });
    try {
      const data = await get('/api/live-results');
      const list = rows(data);
      if (!list.length) throw new Error('No results available');
      const ranked = FEALabAnalysis.findings(list.map(race=>({race,current:FEALabAnalysis.contest(race.candidates)}))).close;
      const senate = ranked.filter(row=>row.race.type==='senate').slice(0,3);
      if (senate.length) {
        $('home-lab-preview').textContent = 'The tightest reported Senate contests by percentage points. Compare vote margins, historical benchmarks and local returns.';
        previewBars('home-lab-chart',senate.map(row=>({name:title(row.race),value:row.current.gapPoints})),gapLabel);
      }
      const reporting = list.filter(race => votes(race.candidates).total > 0).length;
      const calledCount = list.filter(race => race.calls?.length).length;
      const panels = Object.entries(offices).map(([office,label]) => {
        const races = list.filter(race => race.type === office);
        const called = races.filter(race => race.calls?.length);
        const count = code => called.filter(race => {
          const winner = race.candidates.find(candidate => candidate.name === race.calls[0]?.candidate);
          return winner && party(winner) === code;
        }).length;
        const d = count('D'), r = count('R');
        return `<article class="home-panel" data-home-office="${office}"><h3>${label}</h3><div class="home-metric"><span class="fea-d">${d} D</span><span class="fea-r">${r} R</span></div><div class="fea-bar" aria-hidden="true"><span style="width:${100*d/(races.length||1)}%"></span><span style="width:${100*r/(races.length||1)}%"></span></div><p class="fea-note">${called.length} of ${races.length} called${called.length>d+r ? ` · ${called.length-d-r} other` : ''}</p><a href="/results?office=${office}">View ${label.toLowerCase()} results →</a></article>`;
      });
      panels.push(`<article class="home-panel"><h3>National reporting</h3><div class="home-metric">${reporting}<small class="fea-note">of ${list.length} races</small></div><div class="fea-bar" aria-hidden="true"><span style="width:${100*reporting/list.length}%"></span></div><p class="fea-note">${calledCount} races called</p><a href="/elections">Browse all results →</a></article>`);
      $('home-overview').innerHTML = panels.join('');
      $('home-source').innerHTML = sourceNote({...data,updatedAt:data.updatedAt || data.generatedAt});
      let mapRevision = 0;
      const mapOffice = $('home-office');
      async function renderHomeMap() {
        const revision = ++mapRevision;
        $('home-zoom').hidden = true;
        const office = mapOffice.value;
        $('home-board-link').href = '/results?' + new URLSearchParams({office});
        document.querySelectorAll("[data-home-office]").forEach(panel=>panel.classList.toggle("is-selected",panel.dataset.homeOffice===office));
        const races = list.filter(race => race.type === office);
        const stage = document.createElement('div');
        try {
          await map(stage,races,new Map(races.map(race => [race.id,votes(race.candidates).margin])),office,null,offices[office]+' reported margins');
          if (revision !== mapRevision) return;
          const legend = stage.querySelector('.fea-legend');
          legend.prepend(document.createTextNode('Reported vote margin'));
          $('home-map').replaceChildren(...stage.childNodes);
          enableHomeMapZoom();
        } catch {
          if (revision === mapRevision) $('home-map').textContent = 'Map unavailable. Open the results board for the full view.';
        }
      }
      mapOffice.addEventListener('change',renderHomeMap);
      void renderHomeMap();
      const calls = list.flatMap(race => (race.calls || []).map(call => ({race,call,time:Date.parse(call.calledAt)})))
        .filter(entry => Number.isFinite(entry.time)).sort((a,b) => b.time-a.time).slice(0,5);
      $('home-calls').innerHTML = calls.length ? calls.map(({race,call}) =>
        `<li><time datetime="${escape(call.calledAt)}">${escape(stamp(call.calledAt))}</time><a href="${raceUrl(race.id)}">${escape(title(race))}</a><div>${escape(call.candidate)} · ${escape(call.provider || call.source || 'FEA')}</div></li>`
      ).join('') : '<li>No timestamped race calls in this snapshot.</li>';
      const uncalled = ranked.filter(({race})=>!race.calls?.length);
      const selected = (uncalled.length ? uncalled : ranked).slice(0,4);
      $('home-watch-title').textContent = uncalled.length ? 'Closest uncalled races' : 'Closest reported races';
      $('home-watch-note').textContent = 'Ranked by the reported percentage-point gap between the top two candidates. The gap can change as votes arrive.';
      $('home-watch').innerHTML = selected.length ? selected.map(({race,current}) =>
        `<article class="home-panel"><p class="fea-note">${escape(offices[race.type])} · ${status(race)}</p><h3><a href="${raceUrl(race.id)}">${escape(title(race))}</a></h3><ul>${current.ranked.slice(0,2).map(candidate => `<li><span>${escape(candidate.name)}</span><strong>${(100*candidate.votes/current.total).toFixed(1)}%</strong></li>`).join('')}</ul><strong class="home-gap">${escape(gapLabel(current.gapPoints))}${current.gap ? ' apart' : ''}</strong></article>`
      ).join('') : '<p>No contests have two candidates with reported votes in this snapshot.</p>';
    } catch {
      $('home-map').textContent = 'Reported map data unavailable.';
      $('home-overview').innerHTML = '<p class="fea-note">Results unavailable. <a href="/results">Open the results board</a>.</p>';
      $('home-source').textContent = 'Reported returns could not load.';
      $('home-calls').innerHTML = '<li>Published calls could not load.</li>';
      $('home-watch').textContent = 'Featured race results could not load.';
    }
    await stories;
  }
  async function elections() {
    const data = await get('/api/live-results');
    const all = rows(data);
    const office = $('race-office'), state = $('race-state'), find = $('race-find');
    const sort = $('race-sort'), filter = $('race-status');
    const searchable = all.map(race => {
      const result = votes(race.candidates);
      const candidates = [...race.candidates].sort((a,b)=>b.votes-a.votes);
      return {race,result,leader:candidates[0],lead: candidates.length>1 && result.total ? (candidates[0].votes-candidates[1].votes)/result.total : Infinity,
        calledAt: Math.max(0,...(race.calls || []).map(call=>Date.parse(call.calledAt)||0)),
        search:[title(race),race.id,race.state,offices[race.type],...candidates.map(c=>c.name)].join(' ').toLowerCase()};
    });
    office.innerHTML = options([['','All offices'],...Object.entries(offices)],query.get('office'));
    state.innerHTML = options([['','All states'],...[...new Set(all.map(race => race.state))].sort().map(code => [code,code])],query.get('state'));
    $('election-source').innerHTML = sourceNote(data);
    find.value = query.get('q') || '';
    for (const [field,key] of [[sort,'sort'],[filter,'status']]) {
      const value = query.get(key);
      if ([...field.options].some(option=>option.value===value)) field.value=value;
    }
    const render = () => {
      const params = new URLSearchParams();
      for (const [key,value] of [['office',office.value],['state',state.value],['q',find.value.trim()],['sort',sort.value==='state'?'':sort.value],['status',filter.value]]) if (value) params.set(key,value);
      history.replaceState(null,'',params.size ? '?'+params : location.pathname);
      const terms = find.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const list = searchable.filter(({race,result,search}) => {
        if ((office.value && office.value!==race.type) || (state.value && state.value!==race.state) || !terms.every(term=>search.includes(term))) return false;
        const called = !!race.calls?.length;
        return !filter.value || (filter.value==='called' ? called : !called && (filter.value!=='reporting' || result.total>0));
      });
      const order = {state:(a,b)=>a.race.state.localeCompare(b.race.state)||title(a.race).localeCompare(title(b.race),undefined,{numeric:true}),closest:(a,b)=>a.lead-b.lead,votes:(a,b)=>b.result.total-a.result.total,recent:(a,b)=>b.calledAt-a.calledAt};
      list.sort(order[sort.value]);
      const called = list.filter(({race})=>race.calls?.length).length;
      const reporting = list.filter(({result})=>result.total>0).length;
      $('race-summary').innerHTML = [[list.length,'Contests'],[called,'Called'],[list.length-called,'Uncalled'],[reporting,'With reported votes']].map(([value,label])=>`<div><strong>${value}</strong><span>${label}</span></div>`).join('');
      $('race-count').textContent = `${list.length} matching contests`;
      $('election-list').innerHTML = list.length ? table(['Race','Status','Top vote share','Votes','D–R margin'],list.map(({race,result,leader})=>`<tr><td><a href="${raceUrl(race.id)}">${escape(title(race))}</a><small>${escape(race.state)} · ${escape(offices[race.type])}</small></td><td><span class="fea-result-status${race.calls?.length?' is-called':''}">${status(race)}</span></td><td>${result.total ? `<strong>${(100*leader.votes/result.total).toFixed(1)}%</strong><small>${escape(leader.name)}</small>` : '—'}</td><td>${result.total?number(result.total):'—'}</td><td>${marginLabel(result.margin)}</td></tr>`).join(''),'Filtered election results') : '<p>No races match these filters.</p>';
    };
    for (const control of [office,state,find,sort,filter]) control.addEventListener('input',render);
    render();
  }
  function candidateTable(race) {
    const total = votes(race.candidates).total;
    const list = [...race.candidates].sort((a,b) => b.votes-a.votes);
    if (!list.length) return '<p>Candidate returns unavailable.</p>';
    return table(['Candidate','Party','Votes','Share'],list.map(candidate => `<tr><td>${escape(candidate.name)}${race.calls?.some(call => call.candidate === candidate.name) ? ' <small>· Called</small>' : ''}</td><td>${escape(party(candidate))}</td><td>${total ? number(candidate.votes) : '—'}</td><td>${total ? (100*candidate.votes/total).toFixed(1)+'%' : '—'}</td></tr>`).join(''),'Candidate results');
  }
  function contribution(race, selected = '', order = 'impact') {
    const counties = race.counties || [];
    const candidates = [...race.candidates].sort((a,b) => b.votes-a.votes);
    const called = candidates.find(candidate => race.calls?.some(call => call.candidate === candidate.name));
    const first = called || candidates[0];
    const second = candidates.find(candidate => candidate !== first);
    const pair = first && second && first.votes > 0;
    const ranked = counties.map(county => {
      const result = votes(county.candidates);
      const localVotes = name => county.candidates.find(candidate => candidate.name === name)?.votes || 0;
      const edge = pair ? localVotes(first.name) - localVotes(second.name) : result.d - result.r;
      return {county,result,edge};
    }).filter(row => row.result.total > 0).sort((a,b) => order==='votes' ? b.result.total-a.result.total : order==='leader' ? b.edge-a.edge : order==='opponent' ? a.edge-b.edge : Math.abs(b.edge)-Math.abs(a.edge));
    if (!ranked.length) return '<p>No local votes have been published for this race in the existing feed.</p>';
    const visible = selected ? ranked.filter(row => row.county.fips === selected) : ranked;
    const coverage = ranked.reduce((sum,row) => sum+row.result.total,0);
    const total = votes(race.candidates).total;
    const matchup = pair ? `<p class="fea-note">${called ? 'Called candidate' : 'Reported leader'} ${escape(first.name)} versus ${escape(second.name)}. A positive local vote difference favors ${escape(first.name)}.</p>` : '';
    const headings = ['Reporting unit','Votes',...(pair ? ['Candidate vote Δ'] : []),'D–R votes','D–R margin'];
    return matchup + `<p class="fea-note">${number(coverage)} votes across ${ranked.length} reporting units · ${number(total)} votes in the race-wide feed. Figures can differ as reporting arrives.</p>` + (visible.length ? table(headings, visible.map(({county,result,edge}) => `<tr><td>${escape(county.name)}</td><td>${number(result.total)}</td>${pair ? `<td>${number(edge)}</td>` : ''}<td>${number(result.d-result.r)}</td><td>${marginLabel(result.margin)}</td></tr>`).join(''),'Local margin contributions') : '<p>This unit has no published votes.</p>');
  }
  async function racePage() {
    const id = query.get('race') || '';
    if (!/^(house|senate|governor)-[A-Z]{2}(-([0-9]{1,2}|AL))?$/.test(id)) {
      $('race-page').innerHTML = '<p>Choose a race from the <a href="/elections">election directory</a>.</p>';
      return;
    }
    const race = await get('/api/live-results/race?id='+encodeURIComponent(id));
    document.title = title(race) + ' | Federal Elections Analysis';
    $('race-title').textContent = title(race);
    $('race-page').innerHTML = `<p class="fea-note">${status(race)} · Preliminary reported returns · ${escape(race.provider || 'FEA results')} · ${escape(stamp(race.lastUpdated))}</p>
      <div class="fea-actions"><a class="fea-button fea-primary" href="${boardUrl(race)}">Open map and trends</a><a class="fea-button" href="/analysis-center?office=${race.type}&race=${encodeURIComponent(race.id)}">Compare elections</a><a class="fea-button" href="/elections?state=${escape(race.state)}">All ${escape(race.state)} races</a></div>
      <section class="fea-section"><h2>Candidate results</h2>${candidateTable(race)}</section>
      <section class="fea-section"><h2>Geographic contributions</h2><p class="fea-note">Positive D–R votes favor Democrats. Negative values favor Republicans.</p>${contribution(race)}</section>
      <section class="fea-section"><h2>Historical benchmarks</h2><div id="race-history">Loading comparisons…</div></section>
      <section class="fea-section"><h2>Polling reference</h2><div id="race-poll">Loading polling reference…</div></section>`;
    await Promise.allSettled([
      comparison().then(async sources => {
        $('race-history').innerHTML = await timeline(race,sources);
      }).catch(() => { $('race-history').textContent = 'Historical data could not load.'; }),
      get('/data/results/polling-reference.json').then(data => {
        const row = data.races[race.id];
        $('race-poll').innerHTML = row ? pollingTable([[race.id,row]]) + pollingNote(data) : '<p>No eligible unweighted polling reference for this race.</p>';
      }).catch(() => { $('race-poll').textContent = 'Polling data could not load.'; })
    ]);
  }
  async function timeline(race,sources, guided = false) {
    const snapshots = await Promise.all(sources.filter(s=>s.appliesTo.includes(race.type)).map(async source => [source,(await historical([race],source).catch(()=>new Map())).get(race.id)]));
    const current = votes(race.candidates);
    if (current.total > 0) snapshots.push([{id:'current-2026'},{year:2026,label:'2026 reported '+offices[race.type],margin:current.margin,total:current.total}]);
    const values = snapshots.filter(([,snapshot])=>snapshot).sort(([a,x],[b,y])=>(x.year||Number(a.id.slice(-4))||0)-(y.year||Number(b.id.slice(-4))||0));
    if (!values.some(([source])=>source.id!=='current-2026')) return '<p>No verified historical benchmark for this geography.</p>';
    if (guided) {
      const past = values.filter(([s])=>s.id!=='current-2026');
      const [source, prior] = past.filter(([s])=>!s.id.startsWith('pres-')).at(-1) || past.at(-1);
      const reference = prior.label || compareName(source);
      const change = FEALabAnalysis.shift(FEALabAnalysis.contest(race.candidates),prior);
      const summary = Number.isFinite(change.value)
        ? `${title(race)} moved from ${marginLabel(prior.margin)} in ${reference} to ${marginLabel(current.margin)} in the 2026 returns${change.value ? `, a ${Math.abs(change.value).toFixed(1)}-point move toward ${change.value>0?'Democrats':'Republicans'}` : ''}.`
        : `${title(race)} has a verified ${reference} benchmark. ${change.reason}.`;
      const extent = Math.max(10, ...values.map(([,row])=>Math.abs(row.margin)));
      const caveat = source.id.startsWith('pres-') ? ' The reference is a presidential election on the same verified geography.' : '';
      return `<p class="lab-finding">${escape(summary+caveat)}</p><p class="fea-note">Separate election benchmarks, shown on a common scale of ±${extent.toFixed(1)} points around zero.</p><ol class="lab-bars">${values.map(([s,row])=>`
        <li><span>${escape(row.label || compareName(s))}</span><strong>${marginLabel(row.margin)}</strong>
        <span class="lab-dot-track" aria-hidden="true"><i style="left:${50+50*row.margin/extent}%" class="${row.margin<0?'lab-bar-r':'lab-bar-d'}"></i></span>
        <small>${number(row.total)} votes${s.sourceUrls?.[0]?.startsWith('https://') ? ` · <a href="${escape(s.sourceUrls[0])}">Source</a>` : ''}</small></li>`).join('')}</ol>`;
    }
    return '<p class="fea-note">These are separate election benchmarks. The series includes different offices where labeled.</p>' + values.map(([source,snapshot]) => `<div class="fea-row"><strong>${escape(snapshot.label || compareName(source))}</strong> · ${marginLabel(snapshot.margin)}<div class="fea-bar" aria-hidden="true"><span style="width:${snapshot.margin>0?Math.abs(snapshot.margin):0}%"></span><span style="width:${snapshot.margin<0?Math.abs(snapshot.margin):0}%"></span></div><small>${number(snapshot.total)} votes${source.sourceUrls?.[0]?.startsWith('https://') ? ` · <a href="${escape(source.sourceUrls[0])}">Source</a>` : ''}</small></div>`).join('');
  }
  const pollingNote = data => `<p class="fea-note">${escape(data.method)} · As of ${escape(data.asOf)} · <a href="https://votehub.com/polls/api/">VoteHub public polling data</a> · ${escape(data.license)}</p>`;
  function pollingTable(entries) {
    return table(['Race','Candidate averages','Pollsters','Latest poll'],entries.map(([id,row])=>`<tr><td><a href="${raceUrl(id)}">${escape(id)}</a></td><td>${row.candidates.map(c=>escape(c.name)+' '+escape(c.percent)+'%').join(' · ')}</td><td>${number(row.pollCount)}</td><td>${escape(row.latestPoll)}</td></tr>`).join(''),'Unofficial polling reference');
  }
  async function polling() {
    const data = await get('/data/results/polling-reference.json');
    $('polling-table').innerHTML = pollingNote(data) + pollingTable(Object.entries(data.races));
  }
  async function search() {
    const results = await Promise.allSettled([get('/data/election-night-races.json'),get('/data/articles.json'),get('/data/features/polling-bias.json?v=20261030-1')]);
    const links = FEAResearchLinks;
    const stateRows = results[2].value?.states || [];
    const stateNames = new Map(stateRows.map(state=>[state.abbr,state.state]));
    const index = [
      ['Presidential election archive','Historical results','/election-history','2016 2020 2024 statewide'],
      ['2026 Midterm elections','Election cycle','/results','house senate governors archive'],
      ['Election Results Board','Election results','/results','returns'],
      ['Map Maker','Maps','/features/map-maker','scenarios map'],
      ['Election Lab','Post-election analysis','/analysis-center','swing historical'],
      ['State polling bias','Research tool','/features/polling-bias','polling'],
      ['Unofficial polling reference','Unweighted reference','/polling','polls'],
      ...stateRows.flatMap(({abbr,state})=>[
        [state+' presidential returns','Historical results',links.archive(abbr),abbr+' 2016 2020 2024'],
        [state+' Senate polling bias','Original research',links.bias(abbr),abbr]
      ]),
      ...(results[0].value?.races || []).map(race=>[title(race),'2026 race',links.results(race),[race.id,stateNames.get(race.state),...race.candidates.map(c=>c.name)].join(' ')]),
      ...(results[1].value || []).map(article=>[article.title,'Article','/article?slug='+encodeURIComponent(article.slug),article.author||''])
    ];
    const field = $('site-search');
    field.value=query.get('q') || '';
    const render = () => {
      const terms=field.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const found=terms.length ? index.filter(item=>terms.every(term=>item.join(' ').toLowerCase().includes(term))) : index.slice(0,7);
      $('search-count').textContent=terms.length ? `${found.length} matches${found.length>60?' · showing first 60':''}` : 'Browse popular destinations';
      $('search-results').innerHTML=found.slice(0,60).map(([name,kind,url])=>`<div class="fea-row"><a href="${escape(url)}">${escape(name)}</a><small>${escape(kind)}</small></div>`).join('') || '<p>No results found.</p>';
    };
    field.addEventListener('input',render);
    render();
  }
  async function localMap(race,container,select,stillCurrent = () => true) {
    if (!globalThis.d3) return;
    const manifest=await get('/data/results/map-assets.json');
    const stateFips=Object.keys(states).find(key=>states[key]===race.state);
    const local=race.counties.some(county=>county.fips?.length===10);
    let file;
    if (race.type==='house') {
      const geography=await get('/data/results/district-geography.json');
      const district=geography.districts?.[FEAResultsUI.districtId(race)];
      if (district?.currentComparable) file=district.geometryFile;
    } else {
      file=local ? manifest.municipalities?.[stateFips]?.path : manifest.counties[stateFips];
    }
    if (!file) return;
    const collection=await get('/'+file);
    if (!stillCurrent()) return;
    const byFips=new Map(race.counties.filter(c=>c.fips).map(c=>[c.fips,{
      id:c.fips,title:c.name,href:boardUrl(race)+'&tab=counties&county='+encodeURIComponent(c.fips),
      result:votes(c.candidates)
    }]));
    const geographyKey=feature=>String(feature.properties.countyFips||feature.properties.GEOID||feature.id||'');
    drawMap(container,collection,feature=>byFips.get(geographyKey(feature)),new Map([...byFips].map(([id,c])=>[id,c.result.margin])),county=>select(county.id),'Local reported D–R margins',undefined,'margin',true);
  }
  async function archive() {
    const sources = await comparison();
    const year = $('archive-year'), state = $('archive-state');
    state.innerHTML = options([['','All states'],...Object.values(states).sort().map(code=>[code,code])],query.get('state'));
    if (['2016','2020','2024'].includes(query.get('year'))) year.value = query.get('year');
    let revision = 0;
    async function render() {
      const current = ++revision;
      const selected = state.value;
      const source = sources.find(item=>item.id==='pres-'+year.value);
      const params = new URLSearchParams({year:year.value});
      if (selected) params.set('state',selected);
      history.replaceState(null,'','?'+params);
      $('archive-table').replaceChildren();
      $('archive-source').textContent = 'Loading published historical returns…';
      try {
        const data = await get('/'+source.stateFile);
        if (current!==revision) return;
        const entries = data.states.filter(row=>row.valid!==false && (!selected || row.state===selected));
        $('archive-source').textContent = data.source || compareName(source);
        for (const url of source.sourceUrls || []) {
          if (!url.startsWith('https://')) continue;
          const link = document.createElement('a');
          link.href = url;
          link.textContent = 'Source';
          $('archive-source').append(' · ',link);
        }
        $('archive-table').innerHTML = table(['State','Democratic votes','Republican votes','Total votes','D–R margin'],entries.map(row=>`<tr><td><a href="/elections?state=${escape(row.state)}">${escape(row.state)}</a></td><td>${number(row.demVotes)}</td><td>${number(row.repVotes)}</td><td>${number(row.totalVotes)}</td><td>${marginLabel(row.margin)}</td></tr>`).join(''),'Published statewide presidential returns');
      } catch {
        if (current===revision) $('archive-source').textContent = 'Historical results could not load.';
      }
    }
    for (const field of [year,state]) field.addEventListener('change',()=>void render());
    await render();
  }
  function labBars(entries, label, select) {
    if (!entries.length) return '<p>No qualifying data for this selection.</p>';
    const scale = Math.max(...entries.map(row=>Math.abs(row.value)),1);
    const list = document.createElement('ol');
    list.className = 'lab-bars';
    list.setAttribute('aria-label',label);
    list.innerHTML = entries.map(({race,value,reading,partyColor}) =>
      `<li><button type="button">${escape(title(race))}</button><strong>${escape(reading)}</strong><span class="lab-bar-track" aria-hidden="true"><i style="width:${100*Math.abs(value)/scale}%" class="${partyColor ? value<0?'lab-bar-r':'lab-bar-d' : ''}"></i></span></li>`).join('');
    list.querySelectorAll('button').forEach((button,i)=>{
      if (entries[i].selected) button.setAttribute('aria-current','true');
      button.onclick=()=>select(entries[i].race);
    });
    return list;
  }
  function labStory(sources, controls, national) {
    const {office,lens,raceSelect,unit} = controls;
    const sections = [...document.querySelectorAll('.story-chapter')];
    const headings = ['National returns','Margin shifts','Closest reported races','Local vote margins','Historical benchmarks'];
    const visual = $('story-visual');
    const selectRace = race => {
      raceSelect.value = race.id;
      raceSelect.dispatchEvent(new Event('change'));
    };
    for (const [id, field] of [['story-office',office],['story-baseline',lens],['story-race',raceSelect],['story-history-race',raceSelect],['story-unit',unit]]) {
      $(id).onchange = () => {
        field.value = $(id).value;
        field.dispatchEvent(new Event('change'));
      };
    }
    $('story-local-race').onchange = () => {
      if ($('story-local-race').value) selectRace({id:$('story-local-race').value});
    };
    let chapter = -1, stats = [], renderId = 0;
    const stages = new Map();
    const cachedStage = (key, draw) => {
      if (!stages.has(key)) {
        if (stages.size >= 10) stages.delete(stages.keys().next().value);
        const stage = document.createElement('div');
        stages.set(key,Promise.resolve(draw(stage)).then(()=>stage).catch(error=>{stages.delete(key);throw error;}));
      }
      return stages.get(key);
    };
    const selectedRace = () => stats.find(row=>row.race.id===raceSelect.value)?.race;
    const direction = value => value>0?'Democrats':'Republicans';
    let findings = FEALabAnalysis.findings([]);
    const output = (target, content) => {
      const focused = target.contains(document.activeElement) && document.activeElement?.matches('button');
      if (typeof content === 'string') target.innerHTML = content;
      else target.replaceChildren(content);
      if (focused) target.querySelector('button[aria-current="true"]')?.focus({preventScroll:true});
    };
    function sync() {
      for (const [id, field] of [['story-office',office],['story-baseline',lens],['story-race',raceSelect],['story-history-race',raceSelect],['story-unit',unit]]) {
        $(id).innerHTML = field.innerHTML;
        $(id).value = field.value;
        $(id).disabled = field.disabled;
      }
      const selected = stats.find(({race})=>race.id===raceSelect.value)?.race;
      // The national feed may omit county metadata even when detail has local votes.
      $('story-local-race').innerHTML = options([['','Choose a race'],...stats.map(({race})=>[race.id,title(race)])],selected?.id);
      const {calls,reported,swings,towardD,towardR} = findings;
      const called = calls.D+calls.R+calls.other;
      const source = sources.find(item=>item.id===lens.value);
      const lead = calls.D===calls.R ? 'The parties are even in calls' : `${calls.D>calls.R?'Democrats':'Republicans'} lead in calls`;
      $('story-coverage').textContent = (called
        ? `${lead} for this office, with ${calls.D} Democratic and ${calls.R} Republican calls${calls.other ? ` and ${calls.other} other or unclassified` : ''}. ${stats.length-called} races are still uncalled.`
        : `The feed has reported votes in ${reported} of ${stats.length} contests, with no public calls in this snapshot.`);
      $('story-national-detail').textContent = `${reported} of ${stats.length} races have usable reported returns. A call can arrive before counting is complete. Next, compare the reported margins with past elections.`;
      const biggest = swings[0];
      const reference = biggest?.past?.label || (source && compareName(source));
      const contender = biggest?.current.ranked.find(candidate=>!['D','R'].includes(party(candidate)) && candidate.votes>0);
      const writeIn = biggest?.current.ranked.find(candidate=>['D','R'].includes(party(candidate)) && /write.in/i.test(candidate.name));
      const expected = biggest?.race.expectedVotePercent;
      $('story-shift-note').textContent = biggest
        ? `${title(biggest.race)} had the largest absolute change: ${marginLabel(biggest.past.margin)} in ${reference} to ${marginLabel(biggest.current.margin)} in the reported returns${biggest.swing ? ` (${Math.abs(biggest.swing).toFixed(1)} points toward ${direction(biggest.swing)})` : ''}. Across ${swings.length} comparable races, ${towardD} moved toward Democrats and ${towardR} toward Republicans.`
        : 'No comparable swings for this office and benchmark. Open the evidence table to see the exclusions.';
      $('story-shift-method').textContent = [
        source?.id.startsWith('pres-') ? 'This compares different offices on the same verified geography.' : 'Margins are Democratic share minus Republican share, using all votes in both elections.',
        writeIn && `The largest shift involves a major-party write-in (${writeIn.name}, ${number(writeIn.votes)} reported votes).`,
        contender && `${contender.name} received ${(100*contender.votes/biggest.current.total).toFixed(1)}% of the reported vote there.`,
        Number.isFinite(expected) && `The feed estimates ${expected}% of the expected vote is in for that race.`
      ].filter(Boolean).join(' ');
      $('story-swing-data').innerHTML = table(['Race ID','Reference','2026 D / R / all votes','Prior D / R / all votes','Change or exclusion'],stats.map(({race,current,past,history,swing,reason})=>
        `<tr><td>${escape(race.id)}</td><td>${escape(past?.label || (source ? compareName(source) : 'Unavailable'))}</td><td>${[current.d,current.r,current.total].map(number).join(' / ')}</td><td>${history ? [history.d,history.r,past.total].map(number).join(' / ') : '—'}</td><td>${reason ? escape(reason) : points(swing)}</td></tr>`).join(''),'Inputs to the swing calculation')+
        (source?.sourceUrls||[]).filter(url=>/^https:\/\//.test(url)).map((url,i)=>`<a href="${escape(url)}">Historical source ${i+1}</a> `).join('');
      const row = stats.find(item=>item.race===selected);
      $('story-race-data').innerHTML = row ? `<p class="fea-note">${status(selected)}${Number.isFinite(row.current.gap) ? ` · Top-two gap ${number(row.current.gap)} votes (${row.current.gapPoints.toFixed(2)} points)` : ''}${Number.isFinite(selected.reportingPercent)?` · ${selected.reportingPercent}% reporting (feed estimate)`:''}</p>${candidateTable(selected)}<p><a href="${boardUrl(selected)}">Open this race on the Results Board →</a></p>` : '<p>Choose a race to see candidate votes, shares, and call status.</p>';
    }
    async function show(index) {
      visual.setAttribute('aria-busy','true');
      const render = renderChapter(index);
      const current = renderId;
      const loading = $('story-loading');
      const timer = setTimeout(() => { if (current===renderId) loading.hidden=false; }, 200);
      try { await render; }
      finally {
        clearTimeout(timer);
        if (current===renderId) {
          visual.setAttribute('aria-busy','false');
          loading.hidden=true;
        }
      }
    }
    async function renderChapter(index) {
      chapter = index;
      const revision = ++renderId;
      sections.forEach((section,i)=>section.classList.toggle('is-current',i===index));
      document.querySelectorAll('.lab-chapter-nav a').forEach((link,i)=>{
        if (i===index) link.setAttribute('aria-current','location'); else link.removeAttribute('aria-current');
      });
      $('story-step').textContent = `2026 / 0${index+1} · ${offices[office.value]}`;
      $('story-map-title').textContent = headings[index];
      $('story-key').textContent = '';
      const selected = stats.find(row=>row.race.id===raceSelect.value)?.race;
      const list = stats.map(row=>row.race);
      if (index===0 && $('story-returns-view').value==='calls') {
        const focused = visual.contains(document.activeElement) && document.activeElement?.hasAttribute('data-story-office');
        visual.innerHTML = `<ul class="lab-national-calls" aria-label="Public calls by office">${national.map(({type,label,total,calls})=>{
          const counts = [calls.D,calls.R,calls.other,total-calls.D-calls.R-calls.other];
          const names = ['Democratic','Republican','Other or unclassified','Uncalled'];
          return `<li><button type="button" data-story-office="${type}" aria-pressed="${office.value===type}">${label}</button><span>${total} on the ballot</span><div class="lab-call-track" aria-hidden="true">${counts.map((count,i)=>`<i class="lab-call-${i}" style="width:${100*count/(total||1)}%"></i>`).join('')}</div><small>${counts.map((count,i)=>`${count} ${names[i]}`).join(' · ')}</small></li>`;
        }).join('')}</ul>`;
        visual.querySelectorAll('[data-story-office]').forEach(button=>button.onclick=()=>{
          if (office.value===button.dataset.storyOffice) return;
          office.value=button.dataset.storyOffice;
          office.dispatchEvent(new Event('change'));
        });
        if (focused) visual.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
        $('story-key').textContent = 'Public calls in the current results snapshot. Totals cover races on the 2026 ballot.';
        return;
      }
      if (index===2) {
        const raw = $('story-close-sort').value==='votes';
        const rank = row=>raw ? row.current.gap : row.current.gapPoints;
        const entries = (raw ? findings.closeVotes : findings.close).slice(0,8);
        const first = entries[0];
        const alternate = (raw ? findings.close : findings.closeVotes)[0];
        $('story-close-finding').textContent = first
          ? `${title(first.race)} has the smallest ${raw?'raw vote':'percentage-point'} gap in the reported returns. ${first.current.leader.name} and ${first.current.runnerUp.name} are separated by ${number(first.current.gap)} votes (${first.current.gapPoints.toFixed(2)} points).` +
            (alternate && alternate!==first ? ` By ${raw?'percentage points':'raw votes'}, ${title(alternate.race)} ranks closest.` : '')
          : 'No contests in this office have two candidates with published votes.';
        output(visual,labBars(entries.map(row=>{
          const voteGap = number(row.current.gap)+' votes';
          const shareGap = row.current.gapPoints.toFixed(2)+' pts';
          return {race:row.race,value:rank(row),reading:raw ? voteGap+' · '+shareGap : shareGap+' · '+voteGap,selected:row.race===selected};
        }),'Smallest top-two gaps',selectRace));
        $('story-key').textContent = 'Choose a ranked race to inspect its votes and call status.';
        return;
      }
      if (index===4 || index===3) {
        const race = selected || findings.close[0]?.race;
        if (!race) { visual.textContent = 'Choose a race to continue.'; return; }
        $('story-key').textContent = selected ? title(race) : `Featured race · ${title(race)}`;
        if (index===4) {
          const benchmarks = $('story-history-scope').value==='office' ? sources.filter(s=>!s.id.startsWith('pres-')) : sources;
          const html = await timeline(race,benchmarks,true).catch(()=>'<p>Historical data unavailable.</p>');
          if (revision===renderId) visual.innerHTML = html;
          return;
        }
        try {
          const detail = await get('/api/live-results/race?id='+encodeURIComponent(race.id));
          if (revision!==renderId) return;
          const local = FEALabAnalysis.localFindings(detail.counties);
          $('story-local-data').innerHTML = contribution(detail,selected ? unit.value : '',controls.localSort.value);
          if (!local.rows.length) {
            $('story-local-finding').textContent = `${title(race)} has no published local returns in this snapshot.`;
            visual.textContent = 'Choose another race or return to the national map.';
            return;
          }
          const notes = [local.dem,local.rep].filter(Boolean).map(row=>`${row.county.name} gave ${direction(row.d-row.r)} a ${number(Math.abs(row.d-row.r))}-vote edge`);
          const chosen = selected && local.rows.find(row=>row.county.fips===unit.value);
          $('story-local-finding').textContent = chosen
            ? `${chosen.county.name} reported ${number(chosen.total)} votes and a ${marginLabel(chosen.margin)} margin.`
            : `${title(race)} has ${number(local.votes)} votes across ${local.rows.length} reporting units${local.edge ? `, with a combined ${number(Math.abs(local.edge))}-vote D–R edge for ${direction(local.edge)}` : ''}. ${notes.length ? notes.join('; ') + '.' : ''}`;
          const chooseUnit = id => {
            if (raceSelect.value!==race.id) {
              unit.dataset.pending = id;
              selectRace(race);
              return;
            }
            unit.value = id;
            unit.dispatchEvent(new Event('change'));
          };
          if ($('story-local-view').value==='chart') {
            const largest = [...local.rows].sort((a,b)=>Math.abs(b.d-b.r)-Math.abs(a.d-a.r)).slice(0,8);
            output(visual,labBars(largest.map(row=>{
              const value = row.d-row.r;
              return {race:{id:row.county.fips,title:row.county.name},value,partyColor:value!==0,
                reading:value===0 ? 'Even' : `${value>0?'D':'R'} +${number(Math.abs(value))} votes`,
                selected:row===chosen};
            }),'Largest local D–R vote differences',row=>chooseUnit(row.id)));
            $('story-key').textContent = 'Raw Democratic minus Republican votes in each reporting unit. Choose a unit to inspect its share and contribution.';
            return;
          }
          const stage = await cachedStage('local:'+race.id,host=>localMap(detail,host,chooseUnit));
          if (revision===renderId) {
            if (!stage.childNodes.length) visual.textContent='Local geometry is unavailable. Open the contribution data for the published vote breakdown.';
            else if (visual.firstChild!==stage) visual.replaceChildren(stage);
          }
        } catch { if (revision===renderId) visual.textContent='Local map unavailable. Check the published contribution table.'; }
        return;
      }
      const swing = index===1;
      if (swing && $('story-shift-view').value==='chart') {
        const ranked = findings.swings.slice(0,8);
        output(visual,labBars(ranked.map(({race,swing:value})=>({race,value,reading:points(value),partyColor:true})),'Largest absolute shifts',selectRace));
        $('story-key').textContent = 'Positive values moved toward Democrats. Negative values moved toward Republicans.';
        return;
      }
      const values = new Map(stats.map(row=>[row.race.id,swing?row.swing:row.current.margin]));
      try {
        const stage = await cachedStage(office.value+':'+(swing?lens.value:'returns'),host=>map(host,list,values,office.value,selectRace,headings[index],undefined,swing?'swing':'margin'));
        if (revision!==renderId) return;
        stage.querySelectorAll('svg a').forEach(link=>link.classList.toggle('lab-selected-shape',!!selected && link.getAttribute('href')===raceUrl(selected.id)));
        if (visual.firstChild!==stage) visual.replaceChildren(stage);
        $('story-key').textContent = selected ? `${title(selected)} selected. Follow the chapters or continue in the workspace.` : 'Choose a race to carry it through the investigation.';
      } catch { if (revision===renderId) visual.textContent='Map unavailable. The workspace provides the underlying race table.'; }
    }
    let queued = false;
    function scroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(()=>{
        queued = false;
        const line = innerWidth<=760 ? Math.min(innerHeight*.72,450) : innerHeight*.48;
        let index = 0;
        sections.forEach((section,i)=>{if(section.getBoundingClientRect().top<=line) index=i;});
        if (index!==chapter) void show(index);
      });
    }
    addEventListener('scroll',scroll,{passive:true});
    addEventListener('resize',scroll);
    for (const [id,index] of [['story-returns-view',0],['story-shift-view',1],['story-close-sort',2],['story-local-view',3],['story-history-scope',4]]) $(id).onchange=()=>void show(index);
    return {
      update(rows) { stats=rows; findings=FEALabAnalysis.findings(rows); sync(); if(chapter<0) scroll(); else void show(chapter); },
      local() { sync(); if(chapter===3) void show(chapter); }
    };
  }
  async function lab() {
    const [data,sources] = await Promise.all([get('/api/live-results'),comparison()]);
    $('lab-source').innerHTML=sourceNote(data);
    const all = rows(data);
    const links = FEAResearchLinks;
    const defaults = {house:'house-2024',senate:'senate-last',governor:'governor-last'};
    const national = Object.entries(offices).map(([type,label]) => {
      const races = all.filter(race => race.type === type);
      const {calls} = FEALabAnalysis.findings(races.map(race => ({
        race, current:FEALabAnalysis.contest(race.candidates)
      })));
      return {type,label,total:races.length,calls};
    });
    const office = $('lab-office'), lens = $('lab-lens'), raceSelect = $('lab-race'), metric = $('lab-metric'), unit = $('lab-unit'), localSort = $('lab-local-sort');
    if ([...localSort.options].some(option=>option.value===query.get('local-sort'))) localSort.value=query.get('local-sort');
    let revision = 0, localRevision = 0, localRaceId = '', pendingUnit = '';
    const shared = links.labView(query, all, sources);
    const requested = shared.race;
    office.innerHTML=options(Object.entries(offices),shared.office);
    metric.value=shared.metric;
    const sort = $('lab-sort'), display = $('lab-display'), search = $('lab-search');
    search.value = shared.find;
    display.value = shared.display;
    const story = labStory(sources,{office,lens,raceSelect,unit,localSort},national);
    sort.value = shared.sort;
    function setFilters(preferred, baseline) {
      const list=all.filter(race=>race.type===office.value);
      raceSelect.innerHTML=options([['','Select a race'],...list.map(race=>[race.id,title(race)])],preferred);
      const available=sources.filter(source=>source.appliesTo.includes(office.value));
      const chosen = available.some(source=>source.id===baseline) ? baseline : defaults[office.value];
      lens.innerHTML=options(available.map(source=>[source.id,compareName(source)]),chosen);
    }
    function share() {
      const params=new URLSearchParams({office:office.value,metric:metric.value});
      if (display.value==='chart') params.set('display','chart');
      if (search.value.trim()) params.set('find',search.value.trim());
      if (sort.value !== 'race') params.set('sort',sort.value);
      if (lens.value) params.set('baseline',lens.value);
      if (raceSelect.value) params.set('race',raceSelect.value);
      if (!unit.disabled && unit.value) params.set('unit',unit.value);
      if (localSort.value!=='impact') params.set('local-sort',localSort.value);
      history.replaceState(null,'','?'+params+location.hash);
      $('lab-share').href='?'+params+'#analysis-workspace';
      const race = all.find(row => row.id === raceSelect.value);
      const related = $('lab-related');
      related.hidden = !race;
      if (!race) { related.replaceChildren(); return; }
      const source = sources.find(item => item.id === lens.value);
      const archiveYear = source?.id.match(/^pres-(2016|2020|2024)$/)?.[1] || '2024';
      const destinations = [
        [links.results(race, unit.disabled ? '' : unit.value),'View race results'],
        ['#lab-benchmarks','Historical benchmarks'],
        [links.maker(race),'Open geography in Map Maker'],
        ...(race.type === 'house' ? [] : [[links.archive(race.state,archiveYear),'State presidential archive']]),
        ...(race.type === 'senate' ? [[links.bias(race.state),'Senate polling-bias research']] : [])
      ];
      if (related.children.length !== destinations.length) {
        related.replaceChildren(...destinations.map(()=>document.createElement('a')));
      }
      destinations.forEach(([url,label],index) => {
        const link = related.children[index];
        link.href = url;
        if (link.textContent !== label) link.textContent = label;
      });
    }
    async function local(race, desired, source) {
      const sequence=++localRevision;
      localRaceId = race?.id || '';
      pendingUnit = desired;
      unit.disabled=true;
      unit.onchange=null;
      localSort.onchange=null;
      $('lab-local-map').replaceChildren();
      unit.innerHTML=options([['','All reporting units']], '');
      $('lab-detail').textContent=race ? 'Loading race details…' : 'Choose a race on the map or in the race selector.';
      if (!race) return;
      try {
        const detail=await get('/api/live-results/race?id='+encodeURIComponent(race.id));
        if (sequence!==localRevision) return;
        const choices=(detail.counties || []).filter(c=>c.fips).map(c=>[c.fips,c.name]);
        unit.innerHTML=options([['','All reporting units'],...choices],desired);
        unit.disabled=!choices.length;
        pendingUnit = '';
        share();
        const mapTarget=$('lab-local-map');
        if (choices.length) localMap(detail,mapTarget,countyId=>{
          if (sequence!==localRevision) return;
          unit.value=countyId;
          unit.dispatchEvent(new Event('change'));
          unit.focus();
        },()=>sequence===localRevision).catch(()=>{
          if(sequence===localRevision) mapTarget.textContent='Local map unavailable. Use the reporting unit selector.';
        });
        const renderLocal=async () => {
          const selected=unit.value;
          $('lab-detail').innerHTML=contribution(detail,selected,localSort.value);
          if (!selected) return;
          const county=detail.counties.find(row=>row.fips===selected);
          if (!county) return;
          const unavailable = '<p class="fea-note">No verified local baseline for this election and geography.</p>';
          if (race.type==='house' || !source?.countyFile || !source.countyCompatible) {
            $('lab-detail').insertAdjacentHTML('beforeend',unavailable);
            return;
          }
          try {
            const baseline=await get('/'+source.countyFile);
            if (sequence!==localRevision || unit.value!==selected) return;
            const historicalRow=FEAResultsUI.historicalSnapshot(race,source,new Map([[source.id+':county',baseline]]),selected);
            if (!historicalRow) {
              $('lab-detail').insertAdjacentHTML('beforeend',unavailable);
              return;
            }
            const change=FEALabAnalysis.shift(FEALabAnalysis.contest(county.candidates),historicalRow);
            $('lab-detail').insertAdjacentHTML('beforeend',`<p class="fea-note">${escape(historicalRow.label || compareName(source))} · ${marginLabel(historicalRow.margin)} · ${change.reason ? escape(change.reason) : 'Change '+points(change.value)}</p>`);
          } catch {}
        };
        unit.onchange=localSort.onchange=()=>{share();void renderLocal();story.local();};
        await renderLocal();
        story.local();
      } catch {
        if (sequence===localRevision) $('lab-detail').textContent='Race details are unavailable.';
      }
    }
    async function render(desiredUnit) {
      const sequence=++revision;
      const list=all.filter(race=>race.type===office.value);
      const source=sources.find(item=>item.id===lens.value);
      const selected=list.find(race=>race.id===raceSelect.value);
      const view=metric.value;
      const retainedUnit = selected?.id === localRaceId ? unit.value || pendingUnit : '';
      void local(selected,unit.dataset.pending || desiredUnit || retainedUnit,source);
      delete unit.dataset.pending;
      share();
      $('lab-comparison').textContent='Loading verified benchmarks…';
      $('lab-map').setAttribute('aria-busy','true');
      $('lab-selection').textContent = selected ? `${title(selected)} · ${status(selected)}` : `${offices[office.value]} · All races`;
      $('lab-timeline').textContent=selected ? 'Loading historical benchmarks…' : 'Choose a race to view its historical benchmarks.';
      if (selected) timeline(selected,sources,true).then(markup=>{
        if (sequence===revision) $('lab-timeline').innerHTML=markup;
      }).catch(()=>{if(sequence===revision)$('lab-timeline').textContent='Historical data could not load.';});
      const benchmarks=await historical(list,source).catch(()=>new Map());
      if (sequence!==revision) return;
      const stats=list.map(race=>{
        const current=FEALabAnalysis.contest(race.candidates), past=benchmarks.get(race.id);
        const comparison=FEALabAnalysis.shift(current,past);
        const history=past ? FEALabAnalysis.contest(past.candidates,past.total) : null;
        return {race,current,past,history,swing:comparison.value,reason:comparison.reason,lead:current.gapPoints};
      });
      story.update(stats);
      const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const visible = stats.filter(({race})=>{
        const text = [race.id,race.state,title(race),...race.candidates.map(candidate=>candidate.name)].join(' ').toLowerCase();
        return terms.every(term=>text.includes(term));
      });
      const metrics=new Map(visible.map(({race,current,swing})=>[race.id,view==='swing' ? swing : view==='margin' ? current.margin : current.total ? 100*current[view==='dem-share'?'d':'r']/current.total : NaN]));
      const available = [...metrics.values()].filter(Number.isFinite).length;
      $('lab-filter-status').textContent = [
        terms.length ? `${visible.length} of ${stats.length} races match the filter.` : '',
        `${available} of ${visible.length} shown races have a usable ${view==='swing' ? 'historical comparison' : 'value for this measure'}.`,
        selected && !visible.some(row=>row.race===selected) ? 'The selected race is outside this filter.' : ''
      ].filter(Boolean).join(' ');
      const palette=view==='dem-share'?['#e7eaf0','#2368ba']:view==='rep-share'?['#e7eaf0','#b84555']:undefined;
      const stage=document.createElement('div');
      if (display.value==='chart') {
        const entries = visible.map(row=>({race:row.race,value:metrics.get(row.race.id)}))
          .filter(row=>Number.isFinite(row.value)).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,12);
        const chart = labBars(entries.map(row=>({...row,selected:row.race===selected,reading:view.endsWith('-share')?row.value.toFixed(1)+'%':points(row.value),partyColor:!view.endsWith('-share') && row.value!==0})),
          'Largest values for the selected measure',race=>{raceSelect.value=race.id;raceSelect.focus();void render();});
        if (typeof chart==='string') $('lab-map').innerHTML=chart;
        else $('lab-map').replaceChildren(chart);
        $('lab-map').setAttribute('aria-busy','false');
      } else map(stage,visible.map(row=>row.race),metrics,office.value,race=>{raceSelect.value=race.id;raceSelect.focus();void render();},'Election explorer map',palette,view).then(()=>{
        if(sequence===revision) {
          stage.querySelectorAll('svg a').forEach(link=>{
            if (selected && link.getAttribute('href')===raceUrl(selected.id)) {
              link.classList.add('lab-selected-shape');
              link.setAttribute('aria-current','true');
            }
          });
          if (stage.childNodes.length) $('lab-map').replaceChildren(...stage.childNodes);
          else $('lab-map').textContent='Map unavailable. Use the race selector or table.';
        }
      }).catch(()=>{if(sequence===revision)$('lab-map').textContent='Map unavailable. Use the race selector or table.';})
        .finally(()=>{if(sequence===revision)$('lab-map').setAttribute('aria-busy','false');});
      function renderMapTable() {
        const sorted = [...visible];
        if (sort.value === 'votes') sorted.sort((a,b)=>b.current.total-a.current.total);
        if (sort.value === 'value') {
          const rank = row => Number.isFinite(metrics.get(row.race.id)) ? metrics.get(row.race.id) : -Infinity;
          sorted.sort((a,b)=>rank(b)-rank(a));
        }
        $('lab-table').innerHTML=view==='dem-share'||view==='rep-share'
          ? table(['Race','Votes',view==='dem-share'?'Democratic share':'Republican share'],sorted.map(({race,current})=>`<tr><td><a href="${raceUrl(race.id)}">${escape(title(race))}</a></td><td>${number(current.total)}</td><td>${current.total?metrics.get(race.id).toFixed(1)+'%':'—'}</td></tr>`).join(''),'Reported vote shares')
          : raceList(sorted.map(row=>row.race),metrics,view);
      }
      sort.onchange = () => { share(); renderMapTable(); };
      renderMapTable();
      const valid=stats.filter(row=>Number.isFinite(row.swing));
      const compared=selected ? valid.filter(row=>row.race.id===selected.id) : valid;
      const sameOffice=source && !source.id.startsWith('pres-');
      const swingChart = selected && compared.length ? compared.map(({current,past,history}) =>
        `<div class="fea-swing-chart" aria-label="Vote share comparison">${[[compareName(source),history,past.total],['2026 reported',current,current.total]].map(([label,result,total])=>`<div><strong>${escape(label)}</strong><span>D ${(result.d/total*100).toFixed(1)}% · R ${(result.r/total*100).toFixed(1)}%</span><div class="fea-bar" aria-hidden="true"><span style="width:${result.d/total*100}%"></span><span style="width:${result.r/total*100}%"></span></div></div>`).join('')}</div>`
      ).join('') : '';
      $('lab-comparison').innerHTML=`<p class="fea-note">${escape(source ? compareName(source) : 'No historical baseline')} · ${valid.length} of ${list.length} contests with reported votes and verified comparison geography.</p>`+swingChart+
        (compared.length ? table(['Race','Historical D–R','2026 D–R','Swing','D share Δ','R share Δ',...(sameOffice?['Reported vote Δ']:[])],compared.map(({race,current,past,history,swing})=>`<tr><td><a href="${raceUrl(race.id)}">${escape(title(race))}</a></td><td>${marginLabel(past.margin)}</td><td>${marginLabel(current.margin)}</td><td>${points(swing)}</td><td>${points(100*(current.d/current.total-history.d/past.total))}</td><td>${points(100*(current.r/current.total-history.r/past.total))}</td>${sameOffice?`<td>${number(current.total-past.total)}</td>`:''}</tr>`).join(''),'Swing and vote-share comparisons') : `<p>${escape(stats.find(row=>row.race===selected)?.reason || 'No verified comparison for this selection.')}</p>`)+
        (source?.sourceUrls?.length ? '<p class="fea-note">Historical sources · '+source.sourceUrls.filter(url=>/^https:\/\//.test(url)).map((url,i)=>`<a href="${escape(url)}">Source ${i+1}</a>`).join(' · ')+'</p>' : '');
      const closest=stats.filter(row=>Number.isFinite(row.lead)).sort((a,b)=>a.lead-b.lead).slice(0,5);
      const swings=[...valid].sort((a,b)=>b.swing-a.swing);
      const discovery=(label,entries,value)=>`<section class="fea-card"><h3>${label}</h3>${entries.length?entries.map(row=>`<div class="fea-row"><a href="${raceUrl(row.race.id)}">${escape(title(row.race))}</a><small>${value(row)}</small></div>`).join(''):'<p>No qualifying races.</p>'}</section>`;
      $('lab-discoveries').innerHTML=discovery('Closest reported races',closest,row=>points(row.lead).replace(/^\+/,'')+' between top two candidates')+
        discovery('Largest shifts toward D',swings.filter(row=>row.swing>0).slice(0,5),row=>points(row.swing))+
        discovery('Largest shifts toward R',swings.filter(row=>row.swing<0).reverse().slice(0,5),row=>points(row.swing));
    }
    setFilters(requested?.id,shared.baseline);
    office.addEventListener('change',()=>{setFilters('',lens.value);void render();});
    for(const control of [raceSelect,metric,lens,display,search]) control.addEventListener('change',()=>void render());
    $('lab-reset').onclick=()=>{office.value='senate';metric.value='margin';display.value='map';search.value='';sort.value='race';localSort.value='impact';setFilters('','senate-last');void render();};
    await render(shared.unit);
    const landing = document.getElementById(location.hash.slice(1));
    if (requested && landing) landing.scrollIntoView();
    else if (!location.hash && (query.get('mode')==='explorer' || requested)) $('analysis-workspace').scrollIntoView();
  }
  const entry={home:homepage,elections,race:racePage,polling,search,lab,archive}[document.body.dataset.page];
  if(entry) entry().catch(error=>{
    console.error(error);
    const target=document.querySelector('[data-load-status]');
    if(target) target.textContent='This data could not load. Refresh to retry, or open the results board.';
  });
})();
