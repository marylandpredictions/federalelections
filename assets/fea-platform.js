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
  const status = race => race.calls?.length ? 'Called' : votes(race.candidates).total ? 'Reporting' : 'Awaiting returns';
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
      const tip = `${race ? title(race) : feature.properties.name || feature.properties.NAME || 'No contest'} · ${isShare && Number.isFinite(value) ? value.toFixed(1)+'%' : marginLabel(value)}`;
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
  async function homepage() {
    const stories = get('/data/articles.json').then(articles => {
      const ordered = [...articles].sort((a,b) => b.date.localeCompare(a.date));
      const featured = ordered.find(article => article.featured) || ordered[0];
      const card = (article, lead = false) => {
        const image = typeof article.image === 'string' ? article.image : article.image?.url;
        const photo = /^assets\/img\/[a-z0-9_.-]+$/i.test(image || '')
          ? `<img src="/${escape(image)}" alt="" loading="lazy">` : '';
        return `<a class="home-story${photo ? '' : ' home-story-text'}" href="/article?slug=${encodeURIComponent(article.slug)}">${photo}<span class="home-story-copy"><small>${escape(article.date)}</small><h3>${escape(article.title)}</h3>${lead ? `<p>${escape(article.dek || '')}</p>` : ''}<small>${escape(article.author || 'FEA')}</small></span></a>`;
      };
      $('home-research').innerHTML = featured
        ? card(featured,true) + `<div class="home-story-stack">${ordered.filter(article => article !== featured).slice(0,3).map(article => card(article)).join('')}</div>`
        : '<p>No published articles available.</p>';
    }).catch(() => { $('home-research').textContent = 'The article list could not load.'; });
    try {
      const data = await get('/api/live-results');
      const list = rows(data);
      if (!list.length) throw new Error('No results available');
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
        return `<article class="home-panel"><h3>${label} races called</h3><div class="home-metric"><span class="fea-d">${d} D</span><span class="fea-r">${r} R</span></div><div class="fea-bar" aria-hidden="true"><span style="width:${100*d/(races.length||1)}%"></span><span style="width:${100*r/(races.length||1)}%"></span></div><p class="fea-note">${called.length} of ${races.length} on the ballot${called.length>d+r ? ` · ${called.length-d-r} other` : ''}</p><a href="/elections?office=${office}">View ${label.toLowerCase()} races →</a></article>`;
      });
      panels.push(`<article class="home-panel"><h3>National reporting</h3><div class="home-metric">${reporting}<small class="fea-note">of ${list.length} races</small></div><div class="fea-bar" aria-hidden="true"><span style="width:${100*reporting/list.length}%"></span></div><p class="fea-note">${calledCount} races called</p><a href="/elections">Browse all results →</a></article>`);
      $('home-overview').innerHTML = panels.join('');
      $('home-source').innerHTML = sourceNote(data);
      const calls = list.flatMap(race => (race.calls || []).map(call => ({race,call,time:Date.parse(call.calledAt)})))
        .filter(entry => Number.isFinite(entry.time)).sort((a,b) => b.time-a.time).slice(0,5);
      $('home-calls').innerHTML = calls.length ? calls.map(({race,call}) =>
        `<li><time datetime="${escape(call.calledAt)}">${escape(stamp(call.calledAt))}</time><a href="${raceUrl(race.id)}">${escape(title(race))}</a><div>${escape(call.candidate)} · ${escape(call.provider || call.source || 'FEA')}</div></li>`
      ).join('') : '<li>No timestamped race calls in this snapshot.</li>';
      try {
        const watch = await get('/data/election-night-watchlist.json');
        const featured = list.filter(race => watch.races?.[race.id]?.watch || watch.races?.[race.id]?.tossup)
          .map(race => {
            const total = votes(race.candidates).total;
            const leading = [...race.candidates].filter(c => c.votes>0).sort((a,b)=>b.votes-a.votes).slice(0,2);
            const gap = total && leading.length===2 ? (leading[0].votes-leading[1].votes)/total : Infinity;
            return {race,total,leading,gap};
          }).sort((a,b) => Number(!!a.race.calls?.length)-Number(!!b.race.calls?.length) || a.gap-b.gap);
        const diverse = Object.keys(offices).map(office => featured.find(entry => entry.race.type===office)).filter(Boolean);
        const selected = [...diverse,...featured.filter(entry => !diverse.includes(entry))].slice(0,4);
        $('home-watch').innerHTML = selected.length ? selected.map(({race,total,leading}) =>
          `<article class="home-panel"><p class="fea-note">${escape(offices[race.type])} · ${status(race)}</p><h3>${escape(title(race))}</h3>${total ? `<ul>${leading.map(candidate => `<li><span>${escape(candidate.name)}</span><strong>${(100*candidate.votes/total).toFixed(1)}%</strong></li>`).join('')}</ul>` : '<p class="fea-note">Awaiting reported votes.</p>'}<a href="${raceUrl(race.id)}">View race →</a></article>`
        ).join('') : '<p>No watchlist races in this snapshot.</p>';
      } catch {
        $('home-watch').textContent = 'The watchlist could not load.';
      }
    } catch {
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
    office.innerHTML = options([['','All offices'],...Object.entries(offices)],query.get('office'));
    state.innerHTML = options([['','All states'],...[...new Set(all.map(race => race.state))].sort().map(s => [s,s])],query.get('state'));
    $('election-source').innerHTML = sourceNote(data);
    find.value = query.get('q') || '';
    const render = () => {
      const params = new URLSearchParams();
      if (office.value) params.set('office',office.value);
      if (state.value) params.set('state',state.value);
      if (find.value.trim()) params.set('q',find.value.trim());
      history.replaceState(null,'',params.size ? '?'+params : location.pathname);
      const needle = find.value.trim().toLowerCase();
      const list = all.filter(race => (!office.value || office.value === race.type) && (!state.value || state.value === race.state) && (!needle || [title(race),race.id,...race.candidates.map(c => c.name)].some(value => value.toLowerCase().includes(needle))));
      $('race-count').textContent = `${list.length} contests`;
      $('election-list').innerHTML = list.length ? raceList(list) : '<p>No races match these filters.</p>';
    };
    for (const control of [office,state,find]) control.addEventListener('input',render);
    render();
  }
  function candidateTable(race) {
    const total = votes(race.candidates).total;
    const list = [...race.candidates].sort((a,b) => b.votes-a.votes);
    if (!list.length) return '<p>Candidate returns unavailable.</p>';
    return table(['Candidate','Party','Votes','Share'],list.map(candidate => `<tr><td>${escape(candidate.name)}${race.calls?.some(call => call.candidate === candidate.name) ? ' <small>· Called</small>' : ''}</td><td>${escape(party(candidate))}</td><td>${total ? number(candidate.votes) : '—'}</td><td>${total ? (100*candidate.votes/total).toFixed(1)+'%' : '—'}</td></tr>`).join(''),'Candidate results');
  }
  function contribution(race, selected = '') {
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
    }).filter(row => row.result.total > 0).sort((a,b) => Math.abs(b.edge)-Math.abs(a.edge));
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
        $('race-poll').innerHTML = row ? pollingTable([[race.id,row]]) + pollingNote(data) : '<p>No eligible FEA polling average for this race.</p>';
      }).catch(() => { $('race-poll').textContent = 'Polling data could not load.'; })
    ]);
  }
  async function timeline(race,sources) {
    const snapshots = await Promise.all(sources.filter(s=>s.appliesTo.includes(race.type)).map(async source => [source,(await historical([race],source)).get(race.id)]));
    const current = votes(race.candidates);
    if (current.total > 0) snapshots.push([{id:'current-2026'},{year:2026,label:'2026 reported '+offices[race.type],margin:current.margin,total:current.total}]);
    const values = snapshots.filter(([,snapshot])=>snapshot).sort(([a,x],[b,y])=>(x.year||Number(a.id.slice(-4))||0)-(y.year||Number(b.id.slice(-4))||0));
    if (!values.some(([source])=>source.id!=='current-2026')) return '<p>No verified historical benchmark for this geography.</p>';
    return '<p class="fea-note">These are separate election benchmarks. The series includes different offices where labeled.</p>' + values.map(([source,snapshot]) => `<div class="fea-row"><strong>${escape(snapshot.label || compareName(source))}</strong> · ${marginLabel(snapshot.margin)}<div class="fea-bar" aria-hidden="true"><span style="width:${snapshot.margin>0?Math.abs(snapshot.margin):0}%"></span><span style="width:${snapshot.margin<0?Math.abs(snapshot.margin):0}%"></span></div><small>${number(snapshot.total)} votes${source.sourceUrls?.[0]?.startsWith('https://') ? ` · <a href="${escape(source.sourceUrls[0])}">Source</a>` : ''}</small></div>`).join('');
  }
  const pollingNote = data => `<p class="fea-note">${escape(data.method)} · As of ${escape(data.asOf)} · <a href="https://votehub.com/polls/api/">VoteHub public polling data</a> · ${escape(data.license)}</p>`;
  function pollingTable(entries) {
    return table(['Race','Candidate averages','Pollsters','Latest poll'],entries.map(([id,row])=>`<tr><td><a href="${raceUrl(id)}">${escape(id)}</a></td><td>${row.candidates.map(c=>escape(c.name)+' '+escape(c.percent)+'%').join(' · ')}</td><td>${number(row.pollCount)}</td><td>${escape(row.latestPoll)}</td></tr>`).join(''),'FEA polling reference');
  }
  async function polling() {
    const data = await get('/data/results/polling-reference.json');
    $('polling-table').innerHTML = pollingNote(data) + pollingTable(Object.entries(data.races));
  }
  async function search() {
    const results = await Promise.allSettled([get('/data/election-night-races.json'),get('/data/articles.json')]);
    const index = [
      ['Presidential election archive','Historical results','/election-history','2016 2020 2024 statewide'],
      ['2026 Midterm elections','Election cycle','/elections','house senate governors archive'],
      ['Election Results Board','Election results','/results','returns'],
      ['FEA Atlas','Map Maker','/features/map-maker','scenarios map'],
      ['Election Lab','Post-election analysis','/analysis-center','swing historical'],
      ['State polling bias','Research tool','/features/polling-bias','polling'],
      ['Polling Center','Polling','/polling','averages'],
      ['FEA ratings archive','Ratings','/predictions','forecast'],
      ...(results[0].value?.races || []).map(race=>[title(race),'2026 race',raceUrl(race.id),race.id+' '+race.candidates.map(c=>c.name).join(' ')]),
      ...(results[1].value || []).map(article=>[article.title,'Article','/article?slug='+encodeURIComponent(article.slug),article.author||''])
    ];
    const field = $('site-search');
    field.value=query.get('q') || '';
    const render = () => {
      const terms=field.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const found=terms.length ? index.filter(item=>terms.every(term=>item.join(' ').toLowerCase().includes(term))) : index.slice(0,8);
      $('search-count').textContent=terms.length ? `${found.length} matches${found.length>60?' · showing first 60':''}` : 'Browse popular destinations';
      $('search-results').innerHTML=found.slice(0,60).map(([name,kind,url])=>`<div class="fea-row"><a href="${escape(url)}">${escape(name)}</a><small>${escape(kind)}</small></div>`).join('') || '<p>No results found.</p>';
    };
    field.addEventListener('input',render);
    render();
  }
  async function localMap(race,container,select,stillCurrent) {
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
  async function lab() {
    const [data,sources] = await Promise.all([get('/api/live-results'),comparison()]);
    const all = rows(data);
    const office = $('lab-office'), lens = $('lab-lens'), raceSelect = $('lab-race'), metric = $('lab-metric'), unit = $('lab-unit');
    let revision = 0, localRevision = 0;
    office.innerHTML=options(Object.entries(offices),query.get('office') || 'senate');
    metric.value=['margin','swing','dem-share','rep-share'].includes(query.get('metric')) ? query.get('metric') : 'margin';
    $('lab-source').innerHTML=sourceNote(data);
    function setFilters(preferred, baseline) {
      const list=all.filter(race=>race.type===office.value);
      raceSelect.innerHTML=options([['','Select a race'],...list.map(race=>[race.id,title(race)])],preferred);
      const available=sources.filter(source=>source.appliesTo.includes(office.value));
      lens.innerHTML=options(available.map(source=>[source.id,compareName(source)]),baseline || 'pres-2024');
    }
    function share() {
      const params=new URLSearchParams({office:office.value,metric:metric.value});
      if (lens.value) params.set('baseline',lens.value);
      if (raceSelect.value) params.set('race',raceSelect.value);
      if (!unit.disabled && unit.value) params.set('unit',unit.value);
      history.replaceState(null,'','?'+params);
      $('lab-share').href=location.href;
    }
    async function local(race, desired, source) {
      const sequence=++localRevision;
      unit.disabled=true;
      unit.onchange=null;
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
          $('lab-detail').innerHTML=contribution(detail,selected);
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
            const current=votes(county.candidates).margin;
            $('lab-detail').insertAdjacentHTML('beforeend',`<p class="fea-note">${escape(compareName(source))} · ${marginLabel(historicalRow.margin)} · Change ${points(current-historicalRow.margin)}</p>`);
          } catch {}
        };
        unit.onchange=()=>{share();void renderLocal();};
        await renderLocal();
      } catch {
        if (sequence===localRevision) $('lab-detail').textContent='Race details are unavailable.';
      }
    }
    async function render(desiredUnit='') {
      const sequence=++revision;
      const list=all.filter(race=>race.type===office.value);
      const source=sources.find(item=>item.id===lens.value);
      const selected=list.find(race=>race.id===raceSelect.value);
      const view=metric.value;
      void local(selected,desiredUnit,source);
      share();
      $('lab-comparison').textContent='Loading verified benchmarks…';
      $('lab-map').textContent='Loading map…';
      $('lab-timeline').textContent=selected ? 'Loading historical benchmarks…' : 'Choose a race to view its historical benchmarks.';
      if (selected) timeline(selected,sources).then(markup=>{
        if (sequence===revision) $('lab-timeline').innerHTML=markup;
      }).catch(()=>{if(sequence===revision)$('lab-timeline').textContent='Historical data could not load.';});
      const benchmarks=await historical(list,source).catch(()=>new Map());
      if (sequence!==revision) return;
      const stats=list.map(race=>{
        const current=votes(race.candidates), past=benchmarks.get(race.id);
        const history=past ? votes(past.candidates) : null;
        const leader=FEAResultsUI.candidateLead(race.candidates,current.total);
        return {race,current,past,history,swing:current.margin-(past?.margin ?? NaN),lead:leader?.margin ?? NaN};
      });
      const metrics=new Map(stats.map(({race,current,swing})=>[race.id,view==='swing' ? swing : view==='margin' ? current.margin : current.total ? 100*current[view==='dem-share'?'d':'r']/current.total : NaN]));
      const palette=view==='dem-share'?['#e7eaf0','#2368ba']:view==='rep-share'?['#e7eaf0','#b84555']:undefined;
      const stage=document.createElement('div');
      map(stage,list,metrics,office.value,race=>{raceSelect.value=race.id;raceSelect.focus();void render();},'Election explorer map',palette,view).then(()=>{
        if(sequence===revision) {
          if (stage.childNodes.length) $('lab-map').replaceChildren(...stage.childNodes);
          else $('lab-map').textContent='Map unavailable. Use the race selector or table.';
        }
      }).catch(()=>{if(sequence===revision)$('lab-map').textContent='Map unavailable. Use the race selector or table.';});
      $('lab-table').innerHTML=view==='dem-share'||view==='rep-share'
        ? table(['Race','Votes',view==='dem-share'?'Democratic share':'Republican share'],stats.map(({race,current})=>`<tr><td><a href="${raceUrl(race.id)}">${escape(title(race))}</a></td><td>${number(current.total)}</td><td>${current.total?metrics.get(race.id).toFixed(1)+'%':'—'}</td></tr>`).join(''),'Reported vote shares')
        : raceList(list,metrics,view);
      const valid=stats.filter(row=>Number.isFinite(row.swing));
      const compared=selected ? valid.filter(row=>row.race.id===selected.id) : valid;
      const sameOffice=source && !source.id.startsWith('pres-');
      $('lab-comparison').innerHTML=`<p class="fea-note">${escape(source ? compareName(source) : 'No historical baseline')} · ${valid.length} of ${list.length} contests with reported votes and verified comparison geography.</p>`+
        (compared.length ? table(['Race','Historical D–R','2026 D–R','Swing','D share Δ','R share Δ',...(sameOffice?['Reported vote Δ']:[])],compared.map(({race,current,past,history,swing})=>`<tr><td><a href="${raceUrl(race.id)}">${escape(title(race))}</a></td><td>${marginLabel(past.margin)}</td><td>${marginLabel(current.margin)}</td><td>${points(swing)}</td><td>${points(100*(current.d/current.total-history.d/past.total))}</td><td>${points(100*(current.r/current.total-history.r/past.total))}</td>${sameOffice?`<td>${number(current.total-past.total)}</td>`:''}</tr>`).join(''),'Swing and vote-share comparisons') : '<p>No verified comparison for this selection.</p>')+
        (source?.sourceUrls?.length ? '<p class="fea-note">Historical sources · '+source.sourceUrls.filter(url=>/^https:\/\//.test(url)).map((url,i)=>`<a href="${escape(url)}">Source ${i+1}</a>`).join(' · ')+'</p>' : '');
      const closest=stats.filter(row=>Number.isFinite(row.lead)).sort((a,b)=>a.lead-b.lead).slice(0,5);
      const swings=[...valid].sort((a,b)=>b.swing-a.swing);
      const discovery=(label,entries,value)=>`<section class="fea-card"><h3>${label}</h3>${entries.length?entries.map(row=>`<div class="fea-row"><a href="${raceUrl(row.race.id)}">${escape(title(row.race))}</a><small>${value(row)}</small></div>`).join(''):'<p>No qualifying races.</p>'}</section>`;
      $('lab-discoveries').innerHTML=discovery('Closest reported races',closest,row=>points(row.lead).replace(/^\+/,'')+' between top two candidates')+
        discovery('Largest shifts toward D',swings.filter(row=>row.swing>0).slice(0,5),row=>points(row.swing))+
        discovery('Largest shifts toward R',swings.filter(row=>row.swing<0).reverse().slice(0,5),row=>points(row.swing));
    }
    setFilters(query.get('race'),query.get('baseline'));
    office.addEventListener('change',()=>{setFilters('',lens.value);void render();});
    for(const control of [raceSelect,metric,lens]) control.addEventListener('change',()=>void render());
    await render(query.get('unit') || '');
  }
  const entry={home:homepage,elections,race:racePage,polling,search,lab,archive}[document.body.dataset.page];
  if(entry) entry().catch(error=>{
    console.error(error);
    const target=document.querySelector('[data-load-status]');
    if(target) target.textContent='This data could not load. Refresh to retry, or open the results board.';
  });
})();
