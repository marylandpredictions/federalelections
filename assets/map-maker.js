(async function(){
  const $=id=>document.getElementById(id),S=FEAScenario,M=FeaPredictionMaps,T=FEADeskTheme;
  const cycleId=document.body.dataset.mapCycle||'2026';
  let cycle,model,races=[],map,brush='Safe Democratic',paintParty='D',selected='',generation=0,stroke=new Map(),detail,ink,inspecting=false,cities=[],mayorView='map',declaredCandidates={},outlineThumbCache=new Map();
  const outlineOnly=()=>cycle?.nationalEditMode==='outline';
  try{mayorView=localStorage.getItem('feaMakerMayorView.v1')==='list'?'list':'map';}catch{}
  function seedDeclaredCandidates(){
    if(!declaredCandidates||typeof declaredCandidates!=='object'||!model)return;
    let changed=false;
    for(const [raceId,list] of Object.entries(declaredCandidates)){
      if(!Array.isArray(list)||!list.length)continue;
      if((model.state.candidates[raceId]||[]).length)continue;
      const seeded=list.slice(0,20).map((c,i)=>({
        id:`decl-${raceId}-${i}`,
        name:String(c.name||'').trim().slice(0,80),
        party:['D','R','I'].includes(c.party)?c.party:'I'
      })).filter(c=>c.name);
      if(!seeded.length)continue;
      model.state.candidates[raceId]=seeded;
      changed=true;
    }
    if(changed)save();
  }
  async function loadOutlineThumb(url){
    const key=(url||'').replace(/^\//,'');
    if(!key)return '';
    if(outlineThumbCache.has(key))return outlineThumbCache.get(key);
    const pending=(async()=>{
      try{
        const fc=await(await fetch('/'+key,{cache:'force-cache'})).json();
        const feature=(fc.features||[]).find(f=>f?.geometry)||(fc.type==='Feature'?fc:null);
        if(!feature?.geometry||typeof d3==='undefined')return '';
        const projection=d3.geoIdentity().reflectY(true).fitSize([88,64],feature);
        const path=d3.geoPath(projection);
        const d=path(feature);
        if(!d)return '';
        return `<svg class="maker-mayor-card-outline" viewBox="0 0 88 64" aria-hidden="true"><path d="${d}"></path></svg>`;
      }catch{return '';}
    })();
    outlineThumbCache.set(key,pending);
    return pending;
  }
  const short=rating=>rating.replace(' Democratic',' D').replace(' Republican',' R').replace(' Independent',' I');
  const BRUSH_PARTIES=[
    {id:'D',label:'Democratic',short:'Dem',levels:['Safe Democratic','Likely Democratic','Lean Democratic','Tilt Democratic']},
    {id:'R',label:'Republican',short:'Rep',levels:['Safe Republican','Likely Republican','Lean Republican','Tilt Republican']},
    {id:'I',label:'Independent',short:'Ind',levels:['Safe Independent','Likely Independent','Lean Independent','Tilt Independent']},
    {id:'T',label:'Tossup',short:'Tossup',levels:['Tossup']}
  ];
  const partyOf=rating=>rating==='Tossup'?'T':rating.includes('Democratic')?'D':rating.includes('Republican')?'R':'I';
  function selectParty(id){
    const party=BRUSH_PARTIES.find(p=>p.id===id);if(!party)return;
    paintParty=party.id;
    brush=party.levels[0];
    syncBrushUi();palette();
    status(party.id==='T'?'Paint: Tossup · click a race to clear it':`Paint: ${party.label} · click a race to cycle Safe→Likely→Lean→Tilt`);
  }
  function ratingForClick(current){
    const party=BRUSH_PARTIES.find(p=>p.id===paintParty)||BRUSH_PARTIES[0];
    if(party.id==='T')return 'Tossup';
    const index=party.levels.indexOf(current);
    if(partyOf(current)!==party.id||index<0)return party.levels[0];
    return party.levels[(index+1)%party.levels.length];
  }
  function syncBrushUi(){
    if($('maker-county-brush'))$('maker-county-brush').value=brush;
    if($('maker-brush'))$('maker-brush').value=brush;
    if($('maker-race-rating'))$('maker-race-rating').value=brush;
  }
  const title=r=>{
    if(!r)return '';
    if(r.type==='house')return `${r.state}-${['0','AL'].includes(String(r.district))?'AL':String(r.district).padStart(2,'0')}`;
    if(r.type==='mayor')return `${r.city||r.name||'City'} Mayor`;
    if(r.type==='president'){
      if(r.displayName||r.name)return r.displayName||r.name;
      if((r.state==='ME'||r.state==='NE')&&r.district!=null){
        const d=String(r.district).toUpperCase();
        return d==='AL'||d==='0'?`${r.state} at-large`:`${r.state} CD-${Number(d)||d}`;
      }
      return `${r.state} President`;
    }
    return `${r.state} ${r.type==='senate'?'Senate':'Governor'}`;
  };
  function ensureMakerPresentation(){
    // Map-maker session only — default FEA Night; YAPms is opt-in via Appearance.
    try{
      let saved=localStorage.getItem('feaMakerPresentation.v1');
      // Legacy auto-default wrote bare "yapms"; treat that as unset so FEA Night returns.
      if(saved==='yapms'){
        saved='';
        localStorage.setItem('feaMakerPresentation.v1','fea-night');
      }
      if(saved){
        const preset=T.presets?.find?.(p=>p.presentation===saved||p.id===saved);
        if(preset){T.apply(preset,false);return;}
      }
      const night=T.presets?.find?.(p=>p.id==='fea-night')||T.presets?.[0];
      if(night)T.apply(night,false);
      else document.body.dataset.presentation='';
      if(!localStorage.getItem('feaMakerPresentation.v1'))localStorage.setItem('feaMakerPresentation.v1','fea-night');
    }catch{document.body.dataset.presentation=document.body.dataset.presentation||'';}
  }
  const status=text=>$('maker-status').textContent=text;
  const current=()=>races.filter(r=>r.type===model.state.office);
  const token=name=>getComputedStyle(document.body).getPropertyValue('--'+name).trim()||T.resolved.tokens[name];
  const storageKey=()=>cycle.storageKey||`fea-map-maker-${cycleId}-v1`;
  function save(){try{localStorage.setItem(storageKey(),JSON.stringify(model.state));}catch{status('Browser saving is unavailable. Save a scenario file to keep your map.');}}
  function fitMapFrame(){
    const svg=$('maker-map').querySelector('svg'),layer=svg?.querySelector('.prediction-shape-layer');if(!svg||!layer)return;
    svg.dataset.standardViewBox ||= svg.getAttribute('viewBox');
    if(T.current.presentation!=='yapms'){svg.setAttribute('viewBox',svg.dataset.standardViewBox);return;}
    try{const box=layer.getBBox();if(box.width>0&&box.height>0)svg.setAttribute('viewBox',[box.x-16,box.y-16,box.width+32,box.height+32].join(' '));}catch{}
  }
  function palette(){
    const canvas=token('map-bg'),canvasInk=T.foreground(canvas);
    document.body.style.setProperty('--maker-canvas-ink',canvasInk);
    for(const node of [$('desk-masthead'),document.querySelector('.maker-tools'),document.querySelector('.election-chamber-board')]){
      if(!node)continue;
      for(const name of ['text-primary','text-secondary','control-bg','panel-border','panel-raised'])node.style.removeProperty('--'+name);
      if(document.body.dataset.presentation==='broadcast')for(const [name,value] of Object.entries({'text-primary':canvasInk,'text-secondary':T.mix(canvasInk,canvas,.2),'control-bg':T.mix(canvas,canvasInk,.12),'panel-border':T.mix(canvas,canvasInk,.4),'panel-raised':T.mix(canvas,canvasInk,.15)}))node.style.setProperty('--'+name,value);
    }
    for(const rating of S.ratings)M.colors[rating]=FEAMakerTheme.color(T,rating,document.body.dataset.presentation==='broadcast'?'#d3dde7':token('panel-bg'));
    for(const button of $('maker-palette')?.querySelectorAll('[data-party]')||[]){
      const party=BRUSH_PARTIES.find(p=>p.id===button.dataset.party);
      const sample=party.levels[0];
      const color=M.colors[sample];
      button.style.setProperty('--paint-color',color);
      button.style.setProperty('--paint-ink',T.foreground(color));
      button.setAttribute('aria-pressed',String(party.id===paintParty));
      button.innerHTML=`<strong>${party.short}</strong><small>${party.id==='T'?'Clear / unset':'Click race to cycle'}</small>`;
      button.title=party.id==='T'?'Tossup: click a race to unset it':`${party.label}: click a race repeatedly to move Safe → Likely → Lean → Tilt`;
      button.dataset.rating=sample;
    }
    syncBrushUi();
    fitMapFrame();
  }
  function seatRing(){
    const show=T.current.presentation==='yapms';$('maker-seat-summary').hidden=!show;layoutYapmsRail();if(!show)return;
    const ns='http://www.w3.org/2000/svg',svg=$('maker-seat-ring');
    const weight=(id,race)=>{
      if(model.state.office!=='president')return 1;
      const row=race||races.find(r=>r.id===id);
      return model.electoralVotesFor?.(row)||model.electoralVotes?.[row?.evUnit||row?.state]||0;
    };
    const parts=FEAMakerTheme.segments(current(),id=>model.rating(id),model.heldSeats[model.state.office]||{D:0,R:0,I:0},weight);
    const circumference=2*Math.PI*78;
    const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);if(text)n.textContent=text;svg.append(n);return n;};
    svg.replaceChildren();const total=parts[0]?.total||0;svg.setAttribute('aria-label',parts.map(p=>p.count+' '+short(p.label)).join(', '));
    // Caption under the FEA badge stays fixed ("YOUR SCENARIO") — do not rewrite it per office.
    for(const p of parts){const arc=add('circle',{cx:110,cy:110,r:78,fill:'none',stroke:M.colors[p.label],'stroke-width':42,'stroke-dasharray':`${p.fraction*circumference} ${circumference}`,'stroke-dashoffset':-p.start*circumference,transform:'rotate(-90 110 110)'});const titleNode=document.createElementNS(ns,'title');titleNode.textContent=p.count+' '+p.label;arc.append(titleNode);}
    for(const p of parts){const a=p.start*Math.PI*2-Math.PI/2;add('line',{x1:110+57*Math.cos(a),y1:110+57*Math.sin(a),x2:110+99*Math.cos(a),y2:110+99*Math.sin(a),stroke:'#eeeeef','stroke-width':1});}
    for(const r of [57,99])add('circle',{cx:110,cy:110,r,fill:'none',stroke:'#eeeeef','stroke-width':1.2});
    add('text',{'class':'maker-ring-total',x:110,y:110,'text-anchor':'middle',fill:token('text-primary'),'font-family':'Arial,sans-serif','font-size':26,'font-weight':700},String(total));
    add('text',{'class':'maker-ring-caption',x:110,y:129,'text-anchor':'middle',fill:token('text-secondary'),'font-family':'Arial,sans-serif','font-size':10},'SEATS');
  }
  function layoutYapmsRail(){
    const summary=$('maker-seat-summary');
    const tools=document.querySelector('.maker-tools');
    const workspace=document.querySelector('.maker-workspace');
    if(!summary||!tools||!workspace)return;
    const desktop=window.matchMedia('(min-width:801px) and (min-height:481px)').matches;
    const yapms=T.current.presentation==='yapms'&&desktop&&!summary.hidden;
    if(yapms){
      if(tools.parentElement!==summary)summary.appendChild(tools);
    }else if(tools.parentElement===summary){
      workspace.insertBefore(tools,workspace.firstElementChild);
    }
  }
  function splitEvLabel(race){
    const raw=String(race?.evUnit||race?.id?.replace(/^president-/,'')||'');
    const m=raw.toUpperCase().match(/^([A-Z]{2})-(AL|\d{1,2})$/);
    if(!m)return raw;
    if(m[2]==='AL')return `${m[1]}-AL`;
    return `${m[1]}-${m[2].padStart(2,'0')}`;
  }
  function syncSplitEv(){
    // Split boxes are drawn inside the map SVG (zoom layer). Keep the HTML host empty.
    const host=$('maker-split-ev');
    if(host){host.hidden=true;host.replaceChildren();}
  }
  function syncTicketBar(){
    const host=$('maker-ticket-bar');
    if(!host)return;
    const isPres=model.state.office==='president'&&model.electoralVotes;
    host.hidden=!isPres;
    if(!isPres)return;
    const counts=model.electoralCounts();
    const dem=model.ticket('D'),rep=model.ticket('R');
    // Same chip language as 2027 totals — compact, not block cards.
    const chip=(party,n,label,{edit=false}={})=>{
      const span=document.createElement(edit?'button':'span');
      if(edit)span.type='button';
      span.className=`maker-ticket maker-${party.toLowerCase()}`;
      span.style.setProperty('--tower-color',party==='T'?M.colors.Tossup:T.candidateColor({party}));
      span.style.setProperty('--tower-ink',party==='T'?T.foreground(M.colors.Tossup):(T.contrast(T.candidateColor({party}),'#ffffff')>=3?'#ffffff':T.foreground(T.candidateColor({party}))));
      span.setAttribute('aria-label',`${label} ${n} electoral votes`);
      const number=document.createElement('strong');number.className='maker-total-number';number.textContent=n;
      const name=document.createElement('small');name.className='maker-total-party';name.textContent=label;
      if(edit){
        name.classList.add('maker-ticket-edit');
        name.title='Click to rename ticket';
        span.onclick=()=>{
          const next=window.prompt(party==='D'?'Democratic ticket name':'Republican ticket name',label);
          if(next==null)return;
          const trimmed=String(next).trim().slice(0,40);
          if(!trimmed)return;
          model.setTickets({...model.state.tickets,[party]:trimmed});
          edited(`${party==='D'?'Democratic':'Republican'} ticket · ${trimmed}`);
        };
      }else{
        span.onclick=()=>selectParty(party);
      }
      span.append(name,document.createTextNode(' '),number);
      return span;
    };
    host.replaceChildren(
      chip('T',counts.T,'Tossup'),
      chip('D',counts.D,dem,{edit:true}),
      chip('R',counts.R,rep,{edit:true})
    );
  }
  function sync(){
    const byId=new Map(races.map(r=>[r.id,r])),muted=T.mix(token('map-neutral'),token('map-bg'),.72);
    for(const race of races)race.prediction.rating=model.rating(race.id);
    for(const node of $('maker-map').querySelectorAll('[data-race-id]')){
      const race=byId.get(node.dataset.raceId);if(!race){if(node.tagName!=='circle'&&node.tagName!=='text')node.setAttribute('fill',muted);continue;}
      const rating=model.rating(race.id),decided=rating!=='Tossup',fill=M.colors[rating];
      node.setAttribute('data-rating',rating);
      node.classList.toggle('is-selected',race.id===selected);
      if(node.classList.contains('mayor-marker')||node.tagName==='text'){
        /* hit targets / labels stay unfilled */
      }else if(node.classList.contains('mayor-halo')){
        node.setAttribute('fill',fill);
        node.setAttribute('fill-opacity',decided?'0.4':'0.22');
        node.setAttribute('stroke',fill);
      }else if(node.classList.contains('mayor-pin')){
        node.setAttribute('fill',fill);
      }else if(node.classList.contains('mayor-city')){
        node.setAttribute('fill',fill);
        node.setAttribute('fill-opacity',decided?'0.5':'0.18');
        node.setAttribute('stroke',decided?fill:'currentColor');
        node.classList.toggle('is-decided',decided);
      }else if(node.classList.contains('prediction-split-unit')){
        node.setAttribute('fill',rating==='Tossup'?'var(--map-neutral)':fill);
      }else{
        node.setAttribute('fill',fill);
      }
      const winner=model.winnerCandidate(race.id);
      node.setAttribute('aria-label',winner?`${title(race)}: ${winner.name} (${winner.party})`:`${title(race)}: ${rating}`);
    }
    syncCityRail();
    const counts=model.state.office==='president'?model.electoralCounts():model.totalCounts(model.state.office);
    const held=model.heldSeats[model.state.office]||{D:0,R:0,I:0};
    const total=Object.values(counts).reduce((n,v)=>n+v,0)||1;
    const isPres=model.state.office==='president';
    if(isPres){
      $('maker-totals').replaceChildren();
    }else{
      $('maker-totals').replaceChildren(...Object.entries(counts).map(([party,n])=>{const span=document.createElement('span');span.className='maker-'+party.toLowerCase();span.hidden=party==='I'&&!n;span.style.setProperty('--tower-color',party==='T'?M.colors.Tossup:T.candidateColor({party}));span.style.setProperty('--tower-ink',party==='T'?T.foreground(M.colors.Tossup):(T.contrast(T.candidateColor({party}),'#ffffff')>=3?'#ffffff':T.foreground(T.candidateColor({party}))));span.setAttribute('aria-label',`${n} ${party==='T'?'Tossup':party}`);const number=document.createElement('strong'),label=document.createElement('small');number.className='maker-total-number';number.textContent=n;label.className='maker-total-party';label.textContent=party==='T'?'Tossup':party;span.append(number,document.createTextNode(' '),label);return span;}));
    }
    $('maker-seat-bar').replaceChildren(...['D','I','T','R'].map(party=>{const span=document.createElement('span');span.style.width=counts[party]/total*100+'%';span.style.background=party==='T'?M.colors.Tossup:T.candidateColor({party});return span;}));
    const office=model.state.office;
    const unit=office==='president'?'electoral votes':office==='governor'?'governors':office==='mayor'?'cities':'seats';
    const up=current().length;
    let caption=`${total} ${unit} · ${up} up for election.`;
    if(office==='president')caption=`${counts.D}–${counts.R} · ${counts.T} unset · 270 to win. ME/NE: paint districts on the map; at-large via the panels.`;
    else if(office!=='house'&&office!=='mayor')caption+=` Includes ${held.D} D / ${held.R} R${held.I?` / ${held.I} I`:''} not up.`;
    caption+=' Your scenario · Not election calls.';
    $('maker-count-caption').textContent=caption;
    syncSplitEv();
    syncTicketBar();
    seatRing();
    $('maker-undo').disabled=!model.past.length;$('maker-redo').disabled=!model.future.length;
    document.querySelectorAll('[data-office]').forEach(b=>{b.classList.toggle('active',b.dataset.office===model.state.office);b.setAttribute('aria-selected',String(b.dataset.office===model.state.office));});
    renderDetailCandidates();
  }
  function edited(text){sync();detail?.refresh();$('maker-map').querySelectorAll('.prediction-map-tooltip').forEach(n=>n.hidden=true);status(text);save();}
  function inspectRace(race){selected=race.id;if($('maker-race'))$('maker-race').value=selected;$('board-menu').hidden=true;$('maker-menu-button')?.setAttribute('aria-expanded','false');detail.open(race);renderDetailCandidates();}
  function setInspect(value){
    inspecting=!!value;
    for(const b of document.querySelectorAll('[data-maker-interaction]'))b.setAttribute('aria-pressed',String((b.dataset.makerInteraction==='inspect')===inspecting));
    if($('maker-drag'))$('maker-drag').disabled=inspecting;
    status(inspecting?'Inspect mode · tap a race for detail, past elections, and geography.':'Paint mode · tap a race to cycle ratings. Right-click or Inspect for detail.');
  }
  function paint(race){
    if(inspecting){inspectRace(race);return;}
    selected=race.id;if($('maker-race'))$('maker-race').value=selected;
    const next=ratingForClick(model.rating(race.id));
    brush=next;syncBrushUi();palette();
    if(model.apply([[race.id,next]]))edited(`${title(race)} · ${next}`);
  }
  function syncMayorViewChrome(){
    const isMayor=model.state.office==='mayor';
    const detailOpen=document.body.classList.contains('maker-detail-open');
    const view=$('maker-mayor-view');
    if(view)view.hidden=!isMayor;
    document.body.classList.toggle('maker-mayor-list-mode',isMayor&&mayorView==='list'&&!detailOpen);
    document.body.classList.toggle('maker-mayor-map-mode',isMayor&&mayorView==='map'&&!detailOpen);
    for(const b of document.querySelectorAll('[data-mayor-view]'))b.setAttribute('aria-pressed',String(b.dataset.mayorView===mayorView));
    const board=$('maker-mayor-board');
    const mapHost=$('maker-map');
    const detailMap=$('maker-detail-map');
    if(detailOpen){
      if(board)board.hidden=true;
      if(mapHost)mapHost.hidden=true;
      if(detailMap)detailMap.hidden=false;
      return;
    }
    if(!isMayor){
      if(board)board.hidden=true;
      if(mapHost)mapHost.hidden=false;
      return;
    }
    if(board)board.hidden=mayorView!=='list';
    if(mapHost)mapHost.hidden=mayorView==='list';
  }
  function syncCityRail(){
    const rail=$('maker-city-rail');
    const board=$('maker-mayor-board');
    const list=$('maker-mayor-list');
    const mayors=current().filter(r=>r.type==='mayor');
    const isMayor=model.state.office==='mayor'&&mayors.length;
    syncMayorViewChrome();
    if(rail){
      if(!isMayor||mayorView==='list'){rail.hidden=true;rail.replaceChildren();}
      else{
        rail.hidden=false;
        rail.innerHTML=`<strong>Cities</strong>${mayors.map(r=>{
          const rating=model.rating(r.id);
          return `<button type="button" data-city-id="${r.id}" data-rating="${rating}" aria-pressed="${selected===r.id}" style="--paint-color:${M.colors[rating]}"><span>${title(r).replace(/ Mayor$/,'')}</span><small>${short(rating)}</small></button>`;
        }).join('')}`;
      }
    }
    if(list&&board){
      if(!isMayor||mayorView!=='list'){list.replaceChildren();return;}
      const caption=$('maker-mayor-board-caption');
      if(caption)caption.textContent=`${mayors.length} cities · click to cycle ratings · open for wards`;
      list.replaceChildren(...mayors.map(r=>{
        const rating=model.rating(r.id);
        const winner=model.winnerCandidate(r.id);
        const button=document.createElement('button');
        button.type='button';
        button.className='maker-mayor-card';
        button.dataset.cityId=r.id;
        button.dataset.rating=rating;
        button.setAttribute('aria-pressed',String(selected===r.id));
        button.style.setProperty('--paint-color',M.colors[rating]);
        button.innerHTML=`<span class="maker-mayor-card-swatch" aria-hidden="true"></span>
          <span class="maker-mayor-card-thumb" data-outline-host="${r.id}" aria-hidden="true"></span>
          <span class="maker-mayor-card-body">
            <strong>${title(r).replace(/ Mayor$/,'')}</strong>
            <small>${r.state}${r.openSeat?' · Open seat':''}</small>
          </span>
          <span class="maker-mayor-card-meta">
            <b>${short(rating)}</b>
            <small>${winner?winner.name:'No winner set'}</small>
          </span>`;
        const host=button.querySelector('[data-outline-host]');
        if(host&&r.outlineUrl){
          loadOutlineThumb(r.outlineUrl).then(svg=>{
            if(!svg||!host.isConnected)return;
            host.innerHTML=svg;
          });
        }
        return button;
      }));
    }
  }
  function setMayorView(mode){
    mayorView=mode==='list'?'list':'map';
    try{localStorage.setItem('feaMakerMayorView.v1',mayorView);}catch{}
    syncCityRail();
    if(model.state.office==='mayor'){
      if(mayorView==='map'&&!map)render();
      else sync();
      status(mayorView==='list'?'List mode · click a city to cycle ratings, or open for detail.':'Map mode · city markers show every mayoral race.');
    }
  }
  function handleCityPick(race,{inspect=false}={}){
    if(!race)return;
    selected=race.id;if($('maker-race'))$('maker-race').value=selected;
    if(inspect||inspecting)inspectRace(race);
    else{
      const next=ratingForClick(model.rating(race.id));
      brush=next;syncBrushUi();palette();
      if(model.apply([[race.id,next]]))edited(`${title(race)} · ${next}`);
      else {map?.focusRace?.(race.id);syncCityRail();}
    }
  }
  function bindPanelResize(){
    const handle=$('maker-focus-resize'),panel=$('focused-race-panel');
    if(!handle||!panel||handle.dataset.bound)return;
    handle.dataset.bound='1';
    let startX=0,startY=0,startW=0,startH=0;
    const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
    const persist=()=>{try{localStorage.setItem('feaMakerPanelSize.v1',JSON.stringify({w:panel.offsetWidth,h:panel.offsetHeight}));}catch{}};
    try{
      const saved=JSON.parse(localStorage.getItem('feaMakerPanelSize.v1')||'null');
      if(saved?.w){document.body.style.setProperty('--maker-panel-width',`${clamp(saved.w,300,640)}px`);panel.style.width=`${clamp(saved.w,300,640)}px`;}
      if(saved?.h)panel.style.height=`${clamp(saved.h,280,Math.floor(window.innerHeight*0.88))}px`;
    }catch{}
    handle.addEventListener('pointerdown',e=>{
      if(panel.hidden)return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      startX=e.clientX;startY=e.clientY;startW=panel.offsetWidth;startH=panel.offsetHeight;
      const move=ev=>{
        const nextW=clamp(startW+(ev.clientX-startX),300,Math.min(640,window.innerWidth-48));
        const nextH=clamp(startH+(ev.clientY-startY),280,Math.floor(window.innerHeight*0.9));
        panel.style.width=`${nextW}px`;
        panel.style.height=`${nextH}px`;
        document.body.style.setProperty('--maker-panel-width',`${nextW}px`);
      };
      const up=()=>{handle.releasePointerCapture(e.pointerId);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);persist();};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);
    });
  }
  function renderDetailCandidates(){
    const host=$('maker-detail-candidates');
    if(!host)return;
    const race=races.find(r=>r.id===selected||r.id===detail?.raceId);
    if(!race){host.innerHTML='<p class="desk-hint">Open a race to set candidates and a winner.</p>';return;}
    // Results roster for paint/outline cycles once candidates exist (or always in non-2026).
    if(cycleId==='2026'&&!outlineOnly()&&race.type!=='mayor'&&!(model.candidates(race.id)||[]).length){host.innerHTML='';return;}
    const roster=model.candidates(race.id);
    const winnerId=model.winner(race.id);
    host.innerHTML=`
      <p class="desk-hint">Set declared candidates and a winner here, or paint a rating on the map.</p>
      <ul class="maker-candidate-list">${roster.map(c=>`<li data-party="${c.party}" class="maker-candidate-row">
        <span class="maker-candidate-meta"><strong>${c.name}</strong><small>${c.party==='D'?'Democratic':c.party==='R'?'Republican':'Independent / other'}</small></span>
        <button type="button" data-winner="${c.id}" aria-pressed="${winnerId===c.id}">${winnerId===c.id?'Winner':'Set winner'}</button>
        <button type="button" data-remove="${c.id}">Remove</button>
      </li>`).join('')||'<li class="desk-hint">No candidates yet.</li>'}</ul>
      <form id="maker-add-candidate" class="maker-add-candidate">
        <label>Name <input name="name" maxlength="80" required placeholder="Candidate name"></label>
        <label>Party <select name="party"><option value="D">D</option><option value="R">R</option><option value="I">I / other</option></select></label>
        <button type="submit">Add candidate</button>
      </form>
      ${winnerId?`<button type="button" id="maker-clear-winner">Clear winner</button>`:''}
    `;
    host.querySelector('#maker-add-candidate')?.addEventListener('submit',e=>{
      e.preventDefault();
      const fd=new FormData(e.target);
      const name=String(fd.get('name')||'').trim();
      const party=String(fd.get('party')||'D');
      if(!name)return;
      const next=[...roster,{id:`c${Date.now().toString(36)}`,name,party}];
      model.setCandidates(race.id,next);edited(`${title(race)} · added ${name}`);
    });
    host.querySelectorAll('[data-winner]').forEach(b=>b.onclick=()=>{model.setWinner(race.id,b.dataset.winner);edited(`${title(race)} · winner set`);});
    host.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{
      const next=roster.filter(c=>c.id!==b.dataset.remove);
      model.setCandidates(race.id,next);
      if(winnerId===b.dataset.remove)model.setWinner(race.id,null);
      edited(`${title(race)} · candidate removed`);
    });
    host.querySelector('#maker-clear-winner')?.addEventListener('click',()=>{model.setWinner(race.id,null);edited(`${title(race)} · winner cleared`);});
  }
  async function render(){
    ink?.setEnabled(false);
    detail?.close();
    const tokenGen=++generation;map?.destroy();map=null;selected='';
    const office=model.state.office,data=current();
    if($('maker-race'))$('maker-race').replaceChildren(new Option('Find a race',''),...data.map(r=>new Option(title(r),r.id)));
    syncMayorViewChrome();
    sync();
    if(office==='mayor'&&mayorView==='list'){
      $('maker-map').replaceChildren();
      ink?.sync();
      status('List mode · click a city to cycle ratings, or open for detail.');
      return;
    }
    status(`Loading ${office==='house'?'House districts':office+' map'}…`);
    const host=document.createElement('div');host.style.height='100%';$('maker-map').replaceChildren(host);$('maker-map').hidden=false;
    ink?.sync();
    try{
      const controller=await M.renderRaceShapeMap({
        container:host,data:{races:data},office,stateLabels:!outlineOnly(),ratingLabel:'Your rating',
        onSelect:paint,
        outlineOnly:outlineOnly(),
        blankBasemap:outlineOnly(),
        isPaintEnabled:()=>!inspecting&&$('maker-drag')?.checked,
        onPaintStart:()=>{stroke=new Map();},
        onPaintRace:race=>{
          if(!stroke.has(race.id)){
            stroke.set(race.id,model.rating(race.id));
            const next=ratingForClick(model.rating(race.id));
            model.assign(race.id,next);race.prediction.rating=next;
          }
        },
        onPaintEnd:()=>{const updates=[...stroke.keys()].map(id=>[id,model.rating(id)]);for(const [id,before] of stroke)model.assign(id,before);model.apply(updates);edited(`${updates.length} race${updates.length===1?'':'s'} painted`);stroke.clear();}
      });
      if(tokenGen!==generation){controller?.destroy();return;}
      map=controller;fitMapFrame();
      host.querySelector('svg')?.setAttribute('aria-label',`Your ${office} ratings map`);
      host.querySelector('svg')?.setAttribute('role','group');
      host.querySelectorAll('[data-race-id]').forEach(n=>{n.setAttribute('role',n.dataset.raceId?'button':'img');if(!n.dataset.raceId){n.setAttribute('tabindex','-1');n.setAttribute('aria-label',`${n.getAttribute('aria-label')||'State'} · ${cycle.copy?.notOnBallot||'Not on this ballot'}`);}});
      sync();ink?.sync();
      status(office==='mayor'?'Map mode · city markers show every mayoral race. Click to paint, right-click for detail.':outlineOnly()?'Click a race to open detail and set candidates or a winner.':'Choose a rating, then tap or click a race.');
    }catch(err){console.error(err);if(tokenGen===generation){host.textContent='The map could not load. Try another office or reload the page. Your saved ratings are unchanged.';status('Map unavailable. Your ratings are still saved.');}}
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function image(){
    const original=$('maker-map').querySelector('svg');if(!original){status('Wait for the map to load first.');return;}
    $('maker-image').disabled=true;
    try{
      const ns='http://www.w3.org/2000/svg',outer=document.createElementNS(ns,'svg');outer.setAttribute('xmlns',ns);outer.setAttribute('width','1600');outer.setAttribute('height','1100');
      const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;outer.append(n);return n;};
      add('rect',{width:1600,height:1100,fill:token('map-bg')});
      const officeLabel={house:'House',senate:'Senate',governor:'Governors',president:'President',mayor:'Mayorals'}[model.state.office]||model.state.office;
      add('text',{x:30,y:45,fill:token('text-primary'),'font-family':'Arial','font-size':30},`${model.state.title||cycle.defaultTitle} · ${officeLabel}`);
      add('text',{x:30,y:75,fill:token('text-secondary'),'font-family':'Arial','font-size':18},'User-created scenario · Not FEA’s forecast or live election results');
      const clone=original.cloneNode(true);clone.setAttribute('x','0');clone.setAttribute('y','90');clone.setAttribute('width','1600');clone.setAttribute('height','880');clone.removeAttribute('class');
      clone.querySelector('.prediction-shape-layer')?.removeAttribute('transform');
      clone.querySelectorAll('path').forEach(n=>{n.setAttribute('stroke',token('state-border'));n.setAttribute('stroke-width','.6');n.setAttribute('vector-effect','non-scaling-stroke');});ink?.appendTo(clone,model.state.office);outer.append(clone);
      BRUSH_PARTIES.forEach((party,i)=>{
        const rating=party.levels[0];
        const x=30+i*280,y=1000;
        add('rect',{x,y:y-15,width:18,height:18,fill:M.colors[rating]});
        add('text',{x:x+25,y,fill:token('text-primary'),'font-family':'Arial','font-size':17},party.label+(party.id==='T'?'':' (Safe→Tilt)'));
      });
      if(model.state.office!=='house'){add('rect',{x:1350,y:1025,width:18,height:18,fill:token('panel-raised')});add('text',{x:1375,y:1040,fill:token('text-primary'),'font-family':'Arial','font-size':14},cycle.copy?.notOnBallot||'Not on ballot');}
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(outer)],{type:'image/svg+xml'}));
      try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1100;canvas.getContext('2d').drawImage(img,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Image unavailable');download(blob,`fea-${cycleId}-${model.state.office}-scenario.png`);status('PNG downloaded with your map and rating legend.');}finally{URL.revokeObjectURL(url);}
    }catch{status('The image could not be created. Save a scenario file to keep your work.');}finally{$('maker-image').disabled=false;}
  }

  function buildOfficeTabs(){
    const host=document.querySelector('.election-mode-toggle');
    if(!host)return;
    const labels={president:'President',house:'House',senate:'Senate',governor:'Governors',mayor:'Mayorals'};
    host.replaceChildren(...(cycle.offices||[]).map(office=>{
      const b=document.createElement('button');
      b.type='button';b.dataset.office=office;b.setAttribute('role','tab');b.textContent=labels[office]||office;
      return b;
    }));
  }

  function setOutlineChrome(){
    const lead=$('maker-tools-lead');
    // Keep the rail short — long copy belongs in status, not under the logo.
    if(lead){
      lead.textContent=cycleId==='2027'
        ?'Click KY, LA, or MS to cycle ratings.'
        :cycleId==='2028'
          ?'Click a race to cycle ratings.'
          :(cycle.copy?.toolsLead||'Click a race to cycle ratings.');
    }
    const toolsH=$('maker-tools-title');
    if(toolsH)toolsH.textContent='Paint';
    if(outlineOnly()){
      document.body.classList.add('maker-outline-mode');
      if($('maker-interaction'))$('maker-interaction').hidden=false;
      if($('maker-detail-enabled'))$('maker-detail-enabled').checked=true;
      if($('maker-open-detail'))$('maker-open-detail').hidden=false;
    }else{
      document.body.classList.remove('maker-outline-mode');
      if($('maker-interaction'))$('maker-interaction').hidden=false;
      if($('maker-detail-enabled'))$('maker-detail-enabled').checked=true;
      if($('maker-open-detail'))$('maker-open-detail').hidden=false;
    }
  }

  try{
    const cyclesRes=await fetch('/data/features/map-maker/cycles.json',{cache:'no-cache'});
    if(!cyclesRes.ok)throw Error('Cycle config unavailable');
    cycle=(await cyclesRes.json()).cycles[cycleId];
    if(!cycle)throw Error('Unknown map cycle');
    document.title=`${cycle.label} | Federal Elections Analysis`;
    const mast=document.querySelector('#desk-masthead strong');if(mast)mast.textContent=cycle.label;
    buildOfficeTabs();
    setOutlineChrome();

    const response=await fetch(cycle.catalogue,{cache:'no-cache'});if(!response.ok)throw Error('Catalogue unavailable');
    const cataloguePayload=await response.json();
    const catalogue=cataloguePayload.races;
    if(cycle.cities){
      try{cities=(await(await fetch(cycle.cities,{cache:'no-cache'})).json()).cities||[];}catch{cities=[];}
    }
    let saved;try{const raw=localStorage.getItem(storageKey());if(raw)saved=S.validate(JSON.parse(raw),catalogue,{offices:cycle.offices});}catch{status('An older saved map could not be restored. Starting a blank map.');}
    model=new S.Scenario(catalogue,saved,{
      offices:cycle.offices,
      heldSeats:cycle.heldSeats,
      electoralVotes:cycle.electoralVotes||null,
      defaultTitle:cycle.defaultTitle,
      defaultOffice:cycle.defaultOffice,
      schemaVersion:cycleId==='2026'?(outlineOnly()?2:1):2
    });
    let mayorHistory=null;
    if(cycleId==='2027'){
      try{
        const declaredPayload=await(await fetch('/data/features/map-maker/declared-candidates-2027.json',{cache:'no-cache'})).json();
        declaredCandidates=declaredPayload?.races||{};
      }catch{declaredCandidates={};}
    }
    seedDeclaredCandidates();
    detail=FEAMakerDetail.create({
      model,brush:()=>$('maker-county-brush')?.value||brush,edited,title,onContext:()=>{ink?.sync();renderDetailCandidates();syncCityRail();},
      outlineMode:outlineOnly(),
      getMap:()=>map,
      mayorHistory,
      nextRating:ratingForClick,
      cycleId
    });
    ink=FEAMapInk.create({getScope:()=>detail.raceId||model.state.office});
    races=catalogue.map(r=>{
      const city=cities.find(c=>c.id===r.id);
      return {
        id:r.id,raceId:r.id,type:r.type,state:r.state,district:r.district,
        evUnit:r.evUnit,name:r.name,displayName:r.displayName||r.name||title({...r,city:r.city||city?.name}),
        city:r.city||city?.name,
        detailMode:r.detailMode||city?.detailMode,
        subdivisionKind:r.subdivisionKind||city?.subdivisionKind,
        subdivisionUrl:r.subdivisionUrl||city?.subdivisionUrl,
        outlineUrl:r.outlineUrl||city?.outlineUrl,
        subdivisionNote:r.subdivisionNote||city?.subdivisionNote,
        lat:r.lat??city?.lat,lon:r.lon??city?.lon,openSeat:r.openSeat??city?.openSeat,
        prediction:{rating:model.rating(r.id)}
      };
    });
    if($('maker-palette')){
      $('maker-palette').replaceChildren();
      $('maker-palette').classList.add('maker-palette-compact');
      for(const party of BRUSH_PARTIES){
        const b=document.createElement('button');
        b.type='button';
        b.dataset.party=party.id;
        b.dataset.rating=party.levels[0];
        b.onclick=()=>selectParty(party.id);
        $('maker-palette').append(b);
      }
      for(const rating of S.ratings){
        $('maker-brush')?.add(new Option(rating,rating));
        $('maker-county-brush')?.add(new Option(rating,rating));
        $('maker-race-rating')?.add(new Option(rating,rating));
      }
      if($('maker-brush'))$('maker-brush').onchange=e=>{brush=e.target.value;syncBrushUi();palette();};
      palette();
    }
    $('maker-title').value=model.state.title;$('maker-title').oninput=e=>{model.state.title=e.target.value;save();};
    document.querySelectorAll('[data-office]').forEach(b=>b.onclick=()=>{if(model.state.office===b.dataset.office)return;model.state.office=b.dataset.office;save();render();});
    for(const b of document.querySelectorAll('[data-mayor-view]'))b.onclick=()=>setMayorView(b.dataset.mayorView);
    $('maker-undo').onclick=()=>{if(model.undo())edited('Last change undone.');};$('maker-redo').onclick=()=>{if(model.redo())edited('Change restored.');};
    $('maker-clear').onclick=()=>{
      model.apply(current().map(r=>[r.id,'Tossup']));
      if(outlineOnly()){
        for(const r of current()){model.setWinner(r.id,null);}
      }
      edited('This office is cleared to Tossup. Undo restores your scenario.');
    };
    if($('maker-race'))$('maker-race').onchange=e=>{selected=e.target.value;if(selected){const race=races.find(r=>r.id===selected);if(!race)return;map?.focusRace?.(selected);status(`${title(race)} · ${model.rating(selected)}`);if(inspecting)inspectRace(race);}};
    if($('maker-apply'))$('maker-apply').onclick=()=>{const race=races.find(r=>r.id===selected);if(race)paint(race);else status('Choose a race first.');};
    const onCityClick=e=>{
      const button=e.target.closest('[data-city-id]');if(!button)return;
      const race=races.find(r=>r.id===button.dataset.cityId);if(!race)return;
      handleCityPick(race,{inspect:e.shiftKey});
    };
    const onCityMenu=e=>{
      const button=e.target.closest('[data-city-id]');if(!button)return;
      e.preventDefault();
      const race=races.find(r=>r.id===button.dataset.cityId);if(race)inspectRace(race);
    };
    $('maker-city-rail')?.addEventListener('click',onCityClick);
    $('maker-city-rail')?.addEventListener('contextmenu',onCityMenu);
    $('maker-mayor-list')?.addEventListener('click',onCityClick);
    $('maker-mayor-list')?.addEventListener('contextmenu',onCityMenu);
    $('maker-mayor-list')?.addEventListener('dblclick',e=>{
      const button=e.target.closest('[data-city-id]');if(!button)return;
      const race=races.find(r=>r.id===button.dataset.cityId);if(race)inspectRace(race);
    });
    bindPanelResize();
    $('maker-save').onclick=()=>download(new Blob([JSON.stringify(model.state,null,2)],{type:'application/json'}),`fea-scenario-${cycleId}.json`);
    $('maker-open').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{
      if(file.size>5000000)throw Error('This file is too large.');const raw=JSON.parse(await file.text());let message;
      if(raw.map&&typeof FEAYapms!=='undefined'){
        let imported=FEAYapms.read(raw,catalogue);
        if(imported.unknown?.length){
          const choices=$('maker-import-parties');choices.replaceChildren();
          for(const c of imported.unknown){const l=document.createElement('label');l.textContent=c.name;const select=document.createElement('select');select.dataset.candidate=c.id;for(const [value,name] of [['','Choose party'],['D','Democratic'],['R','Republican'],['I','Independent / other'],['T','Tossup']])select.add(new Option(name,value));select.required=true;l.append(select);choices.append(l);}
          const review=$('maker-import-review'),answer=new Promise(resolve=>review.addEventListener('close',()=>resolve(review.returnValue),{once:true}));review.returnValue='cancel';review.showModal();
          if(await answer!=='apply'){status('Import cancelled. Your map is unchanged.');return;}
          imported=FEAYapms.read(raw,catalogue,Object.fromEntries([...choices.querySelectorAll('select')].map(s=>[s.dataset.candidate,s.value])));
        }
        if(imported.unknown?.length)throw Error('Choose a party for every custom candidate.');
        model.apply(imported.entries);model.state.office=imported.office;
        message=`YAPms imported · ${imported.entries.length} races.`;
      }else{
        const data=S.validate(raw,catalogue,{offices:cycle.offices});
        const units=new Set([...Object.keys(model.state.countyRatings),...Object.keys(data.countyRatings||{})]);
        model.apply([...catalogue.map(r=>[r.id,data.ratings[r.id]||'Tossup']),...[...units].map(id=>[id,data.countyRatings?.[id]||'Tossup'])]);
        model.state.office=data.office;model.state.title=data.title;model.state.candidates=data.candidates||{};model.state.winners=data.winners||{};$('maker-title').value=data.title;
        message='Scenario opened. Undo restores the previous map.';
      }
      save();await render();status(message);
    }catch(error){status(error.message||'This scenario file could not be opened.');}finally{e.target.value='';}};
    const openDetail=id=>{const race=races.find(r=>r.id===id);if(race)inspectRace(race);};
    if($('maker-detail-enabled')){
      $('maker-detail-enabled').onchange=e=>{
        if($('maker-open-detail'))$('maker-open-detail').hidden=!e.target.checked;
        if(!e.target.checked&&!outlineOnly()){setInspect(false);detail.close();}
      };
    }
    for(const b of document.querySelectorAll('[data-maker-interaction]'))b.onclick=()=>setInspect(b.dataset.makerInteraction==='inspect');
    setInspect(false);
    if($('maker-open-detail'))$('maker-open-detail').onclick=()=>{if(selected)openDetail(selected);else status('Select a race first.');};
    $('maker-map').addEventListener('contextmenu',e=>{const id=e.target.closest('[data-race-id]')?.dataset.raceId;if(id){e.preventDefault();openDetail(id);}});
    $('maker-map').addEventListener('dblclick',e=>{const id=e.target.closest('[data-race-id]')?.dataset.raceId;if(id){e.preventDefault();openDetail(id);}});
    $('maker-image').onclick=image;
    const labels=$('maker-labels');
    if(labels){
      try{labels.checked=localStorage.getItem('feaMakerLabels.v1')!=='off';}catch{}
      const updateLabels=()=>{document.body.classList.toggle('maker-labels-hidden',!labels.checked);};updateLabels();
      labels.onchange=()=>{updateLabels();try{localStorage.setItem('feaMakerLabels.v1',labels.checked?'on':'off');}catch{}};
    }
    const appearance=FEAAppearance();$('maker-appearance').onclick=()=>{ $('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');appearance.open();};
    $('maker-menu-button').onclick=()=>{const menu=$('board-menu');menu.hidden=!menu.hidden;$('maker-menu-button').setAttribute('aria-expanded',String(!menu.hidden));};
    document.addEventListener('click',e=>{if(!e.target.closest('.board-overflow')){$('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',e=>{if(ink.enabled)return;if(e.key==='Escape'){$('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('input,select,textarea,dialog')){e.preventDefault();e.shiftKey?$('maker-redo').click():$('maker-undo').click();}});
    document.addEventListener('fea-desk-theme',()=>{try{localStorage.setItem('feaMakerPresentation.v1',T.current.id||T.current.presentation||'fea-night');}catch{}layoutYapmsRail();palette();sync();detail.refresh();ink.sync();});
    window.addEventListener('resize',layoutYapmsRail);
    ensureMakerPresentation();
    layoutYapmsRail();
    palette();await render();
  }catch(err){console.error(err);status('The map maker could not start. Reload to try again.');}
})();
