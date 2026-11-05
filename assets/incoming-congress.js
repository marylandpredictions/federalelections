(() => {
  const $ = id => document.getElementById(id);
  if (!FEAHomeCycle.phase(document.body.dataset.electionPhase).updates) return;
  const module = FEAIncomingCongress;
  const chart = $('incoming-chart'), layer = $('incoming-seats'), detail = $('incoming-detail');
  const picker = $('incoming-find'), hover = $('incoming-hover'), status = $('incoming-source');
  const number = new Intl.NumberFormat('en-US');
  const date = new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'});
  const labels = {D:'Democratic',R:'Republican',I:'Independent',O:'Other',uncalled:'Uncalled',missing:'Unavailable',vacant:'Vacant'};
  let office = 'senate', selected = '', filter = '', snapshot, catalogue, config, delayed = false;
  let active = new Map(), blocks = new Map(), drawnOffice, pickerKey, detailKey;
  const el = (tag,text) => Object.assign(document.createElement(tag),{textContent:text});
  const svg = (tag,attrs) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [name,value] of Object.entries(attrs)) node.setAttribute(name,value);
    return node;
  };
  const link = (href,text) => Object.assign(el('a',text),{href});
  const resultHref = seat => '/results?'+new URLSearchParams({office,race:seat?.race?.id || ''});
  const reading = seat => seat.winner?.name || seat.name || (seat.ranked?.[0]?.votes ? seat.ranked[0].name+' leads' : '');
  const description = seat => [seat.title,reading(seat),seat.status==='continuing'?'Continuing':labels[seat.group]].filter(Boolean).join(' · ');
  function seatSize() {
    const senate = office==='senate';
    return senate ? {w:12,d:5,height:5} : {w:6.5,d:3,height:3};
  }
  function buildSeat(id) {
    const {w,d,height} = seatSize();
    const block = svg('g',{'data-seat':id,class:'incoming-seat'});
    const faces = svg('g',{class:'incoming-faces'});
    faces.append(
      svg('path',{class:'incoming-side',d:`M${w} 0 l${d} ${-d} v${height} l${-d} ${d}Z`}),
      svg('path',{class:'incoming-front',d:`M${-w} 0 H${w} V${height} H${-w}Z`}),
      svg('path',{class:'incoming-top',d:`M${-w} 0 H${w} l${d} ${-d} H${-w+d}Z`})
    );
    block.append(faces,svg('rect',{class:'incoming-hit',x:-w-1,y:-d-1,width:2*w+d+2,height:d+height+2}));
    return block;
  }
  function drawGuides(seats, slots, majority) {
    const guides = $('incoming-guides');
    const zones = $('incoming-zones');
    const {w,d,height} = seatSize();
    const cutouts = $('incoming-guide-cutouts');
    if (cutouts.childElementCount!==slots.length) cutouts.replaceChildren(...slots.map(({x,y})=>
      svg('rect',{x:x-w-4,y:y-d-7,width:2*w+d+8,height:d+height+11})));
    const point = (radius,angle) => `${450+radius*Math.cos(angle)} ${340-.70*radius*Math.sin(angle)}`;
    const outlines = [];
    const fills = [];
    for (const group of ['D','I','R']) {
      const angles = seats.flatMap((seat,i)=>seat.status==='continuing' && module.section(seat)===group ? [slots[i].angle] : []);
      if (!angles.length) continue;
      const start = Math.min(Math.PI,Math.max(...angles)+.032);
      const end = Math.max(0,Math.min(...angles)-.032);
      const d = `M${point(428,start)} A428 299.6 0 0 1 ${point(428,end)} L${point(83,end)} A83 58.1 0 0 0 ${point(83,start)}Z`;
      fills.push(svg('path',{class:'incoming-continuing-fill','data-group':group,d}));
      outlines.push(svg('path',{class:'incoming-continuing-outline','data-group':group,d}));
    }
    if (slots[majority-1] && slots[majority-2]) {
      const angle = (slots[majority-1].angle+slots[majority-2].angle)/2;
      outlines.push(svg('path',{class:'incoming-majority-line',d:`M${point(438,angle)} L${point(80,angle)}`}));
      const label = svg('text',{class:'incoming-majority-label',x:450+438*Math.cos(angle),y:21,'text-anchor':'middle'});
      label.textContent = majority;
      outlines.push(label);
    }
    zones.replaceChildren(...fills);
    guides.replaceChildren(...outlines);
  }
  function showDetail(seat) {
    const key = JSON.stringify(seat);
    if (key===detailKey) return;
    detailKey = key;
    if (!seat) {
      detail.replaceChildren(el('h3','Explore a seat'),el('p','Choose a block or use the seat picker to inspect the results.'));
      return;
    }
    const heading = el('h3',seat.title);
    const badge = el('p',seat.status==='called' ? 'Called · '+labels[seat.group] : seat.status==='continuing'
      ? 'Continuing · '+labels[seat.group] : labels[seat.group]);
    badge.className = 'incoming-seat-status';
    detail.replaceChildren(badge,heading);
    if (seat.status==='continuing') {
      detail.append(el('strong',seat.name),el('p',`Term ends January 3, ${seat.termEnds}.`));
      if (seat.caucus==='D') detail.append(el('p','Independent · caucuses with Democrats.'));
      detail.append(link(seat.source,'U.S. Senate class roster ↗'));
      if (seat.caucus) detail.append(el('br'),link(config.caucusSource,'Senate caucus reference ↗'));
      return;
    }
    if (seat.special) detail.append(el('p','Special election for the term ending January 3, 2029.'));
    if (seat.status==='missing') detail.append(el('p','A result or usable call record is unavailable for this seat.'));
    if (seat.winner) {
      const source = seat.call.provider || (seat.call.source==='admin' ? 'FEA' : '');
      detail.append(el('strong',seat.winner.name),el('p',source ? 'Call source · '+source : 'Published race call'));
      if (seat.gap!==null) detail.append(el('p',`Reported winning margin · ${seat.margin.toFixed(2)} points · ${number.format(seat.gap)} votes`));
    } else if (seat.status==='uncalled' && seat.total) {
      const [first,second] = seat.ranked;
      if (first.votes===second?.votes) detail.append(el('p','Tied in reported votes.'));
      else detail.append(el('p',first.name+' leads the reported count.'));
      if (second?.votes>0) detail.append(el('p',`Current top-two gap · ${(100*(first.votes-second.votes)/seat.total).toFixed(2)} points`));
    } else if (seat.status==='uncalled') detail.append(el('p','Awaiting reported votes.'));
    if (seat.total) {
      const list = el('ul','');
      list.className = 'incoming-candidates';
      for (const candidate of seat.ranked) list.append(el('li',`${candidate.name} · ${number.format(candidate.votes)} (${(100*candidate.votes/seat.total).toFixed(1)}%)`));
      detail.append(list);
    }
    const expected = seat.race?.expectedVotePercent;
    const updated = Date.parse(seat.race?.lastUpdated || seat.race?.updatedAt || '');
    const meta = [seat.race?.provider,Number.isFinite(expected) ? expected+'% of expected vote in' : '',
      Number.isFinite(updated) ? date.format(updated)+' ET' : ''].filter(Boolean);
    if (meta.length) detail.append(el('p',meta.join(' · ')));
    if (seat.race) detail.append(link(resultHref(seat),'Full race results →'));
  }
  function select(id) {
    selected = active.has(id) ? id : '';
    picker.value = selected;
    for (const [key,node] of blocks) node.classList.toggle('is-selected',key===selected);
    showDetail(active.get(selected));
  }
  function applyFilter() {
    for (const [id,node] of blocks) {
      const seat = active.get(id);
      node.classList.toggle('is-muted',Boolean(filter && seat.group!==filter ||
        $('incoming-close').checked && !(seat.margin!==null && seat.margin!==undefined && seat.margin<=2)));
    }
    $('incoming-totals').querySelectorAll('button').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.group===filter)));
  }
  function render() {
    if (!catalogue || !config) return;
    const {seats,counts,complete} = module.composition(office,catalogue,config,snapshot?.races || []);
    active = new Map(seats.map(seat=>[seat.id,seat]));
    const totals = $('incoming-totals');
    const entries = Object.entries(counts).filter(([key,value])=>['D','R','I','uncalled'].includes(key) || value);
    if (totals.dataset.key!==JSON.stringify(entries)) {
      totals.dataset.key = JSON.stringify(entries);
      totals.replaceChildren(...entries.map(([key,value])=>{
        const button = el('button','');
        button.type = 'button';
        button.dataset.group = key;
        button.append(el('strong',value),el('span',labels[key]));
        button.onclick = () => { filter = filter===key ? '' : key; applyFilter(); };
        return button;
      }),el('p',`${config.majority[office]} seats for an outright majority${office==='senate'?' · 50–50 ties may be broken by the vice president':''}`));
    }
    if (drawnOffice!==office) {
      drawnOffice = office;
      chart.dataset.chamber = office;
      layer.replaceChildren();
      blocks = new Map(seats.map(seat=>[seat.id,buildSeat(seat.id)]));
      layer.append(...blocks.values());
    }
    const slots = module.layout(seats.length);
    const mode = $('incoming-order').value;
    const arranged = module.arrange(seats,mode);
    drawGuides(arranged,slots,complete ? config.majority[office] : 0);
    arranged.forEach((seat,index)=>{
      const node = blocks.get(seat.id), {x,y} = slots[index];
      node.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
      node.dataset.group = seat.group;
      node.dataset.status = seat.status;
      const shade = mode==='margin' && Number.isFinite(seat.margin)
        ? seat.margin<=2 ? 'pale' : seat.margin<=5 ? 'light' : seat.margin<=10 ? 'medium' : 'deep'
        : 'default';
      node.dataset.shade = shade;
    });
    const choices = [...seats].sort((a,b)=>a.state.localeCompare(b.state)||a.id.localeCompare(b.id,undefined,{numeric:true}))
      .map(seat=>[seat.id,description(seat)]);
    const key = JSON.stringify(choices);
    if (pickerKey!==key) {
      pickerKey = key;
      picker.replaceChildren(new Option('Choose a seat',''),...choices.map(([id,label])=>new Option(label,id)));
    }
    select(selected);
    applyFilter();
    const stamp = Date.parse(snapshot?.provider?.lastUpstreamUpdate || snapshot?.updatedAt || '');
    const text = [!complete ? `Partial composition · ${seats.length} mapped seats` : `${seats.length} seats`,
      snapshot?.provider?.name,
      Number.isFinite(stamp) ? 'Feed updated '+date.format(stamp)+' ET' : '',
      delayed || snapshot?.provider?.stale ? 'Updates may be delayed' : '',
      !snapshot ? (delayed ? 'Election returns unavailable' : 'Loading election returns…') : 'Reported returns and public calls',
      office==='senate' ? 'Outlined groups are continuing seats' : '',
      {margin:'Lighter seats nearer the center have narrower reported winning margins (≤2, ≤5, ≤10, over 10 pts)',
        state:'Seats sorted by state within each section'}[mode],
      'Seat order is illustrative'].filter(Boolean).join(' · ');
    if (status.textContent!==text) status.textContent = text;
    $('incoming-results').href = '/results?office='+office;
    $('incoming-election').textContent = `${config.election} · ${config.congress}th Congress`;
  }
  $('incoming-order').onchange = render;
  $('incoming-close').onchange = applyFilter;
  picker.onchange = () => select(picker.value);
  layer.onclick = event => select(event.target.closest('[data-seat]')?.dataset.seat || selected);
  layer.onpointerover = event => {
    const seat = active.get(event.target.closest('[data-seat]')?.dataset.seat);
    hover.textContent = seat ? description(seat) : '';
  };
  layer.onpointerleave = () => { hover.textContent = ''; };
  document.querySelectorAll('[data-chamber]').forEach(button=>button.onclick=()=>{
    if (button.dataset.chamber===office) return;
    office = button.dataset.chamber;
    selected = filter = '';
    hover.textContent = '';
    document.querySelectorAll('button[data-chamber]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
    render();
  });
  document.addEventListener('fea-home-results',({detail:result})=>{
    delayed = Boolean(result.unavailable);
    if (!delayed) snapshot = result;
    render();
  });
  const get = async path => {
    const response = await fetch(path,{signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw Error('Chamber data unavailable');
    return response.json();
  };
  Promise.all([get('/data/features/map-maker-races.json'),get('/data/features/incoming-congress-120.json')])
    .then(([data,terms])=>{ catalogue=data.races; config=terms; render(); })
    .catch(()=>{ status.textContent='Seat data could not load. The Results Board remains available.'; });
})();
