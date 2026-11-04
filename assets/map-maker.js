(async function(){
  const $=id=>document.getElementById(id),key='fea-map-maker-v1',S=FEAScenario,M=FeaPredictionMaps,T=FEADeskTheme;
  let model,races=[],map,brush='Safe Democratic',selected='',generation=0,stroke=new Map(),detail,ink,inspecting=false;
  const short=rating=>rating.replace(' Democratic',' D').replace(' Republican',' R').replace(' Independent',' I');
  const title=r=>r.type==='house'?`${r.state}-${['0','AL'].includes(String(r.district))?'AL':String(r.district).padStart(2,'0')}`:`${r.state} ${r.type==='senate'?'Senate':'Governor'}`;
  const status=text=>$('maker-status').textContent=text;
  const current=()=>races.filter(r=>r.type===model.state.office);
  const token=name=>getComputedStyle(document.body).getPropertyValue('--'+name).trim()||T.resolved.tokens[name];
  function save(){try{localStorage.setItem(key,JSON.stringify(model.state));}catch{status('Browser saving is unavailable. Save a scenario file to keep your map.');}}
  function fitMapFrame(){
    const svg=$('maker-map').querySelector('svg'),layer=svg?.querySelector('.prediction-shape-layer');if(!svg||!layer)return;
    svg.dataset.standardViewBox ||= svg.getAttribute('viewBox');
    if(T.current.presentation!=='yapms'){svg.setAttribute('viewBox',svg.dataset.standardViewBox);return;}
    const box=layer.getBBox();if(box.width>0&&box.height>0)svg.setAttribute('viewBox',[box.x-16,box.y-16,box.width+32,box.height+32].join(' '));
  }
  function palette(){
    const canvas=token('map-bg'),canvasInk=T.foreground(canvas);
    document.body.style.setProperty('--maker-canvas-ink',canvasInk);
    for(const node of [$('desk-masthead'),document.querySelector('.maker-tools'),document.querySelector('.election-chamber-board')]){
      for(const name of ['text-primary','text-secondary','control-bg','panel-border','panel-raised'])node.style.removeProperty('--'+name);
      if(document.body.dataset.presentation==='broadcast')for(const [name,value] of Object.entries({'text-primary':canvasInk,'text-secondary':T.mix(canvasInk,canvas,.2),'control-bg':T.mix(canvas,canvasInk,.12),'panel-border':T.mix(canvas,canvasInk,.4),'panel-raised':T.mix(canvas,canvasInk,.15)}))node.style.setProperty('--'+name,value);
    }
    for(const rating of S.ratings)M.colors[rating]=FEAMakerTheme.color(T,rating,document.body.dataset.presentation==='broadcast'?'#d3dde7':token('panel-bg'));
    for(const button of $('maker-palette').querySelectorAll('button')){button.style.setProperty('--paint-color',M.colors[button.dataset.rating]);button.style.setProperty('--paint-ink',T.foreground(M.colors[button.dataset.rating]));button.setAttribute('aria-pressed',String(button.dataset.rating===brush));}
    $('maker-brush').value=brush;fitMapFrame();
  }
  function seatRing(){
    const show=T.current.presentation==='yapms';$('maker-seat-summary').hidden=!show;if(!show)return;
    const ns='http://www.w3.org/2000/svg',svg=$('maker-seat-ring'),parts=FEAMakerTheme.segments(current(),id=>model.rating(id),S.heldSeats[model.state.office]),circumference=2*Math.PI*78;
    const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))n.setAttribute(key,value);if(text)n.textContent=text;svg.append(n);return n;};
    svg.replaceChildren();const total=parts[0]?.total||0;svg.setAttribute('aria-label',parts.map(p=>p.count+' '+short(p.label)).join(', ')+(model.state.office==='senate'?'. Democrats include two held independent caucus seats.':''));
    $('maker-seat-summary').querySelector('p').textContent=model.state.office==='senate'?'D includes 2 independent caucus seats':'YOUR SCENARIO';
    for(const p of parts){const arc=add('circle',{cx:110,cy:110,r:78,fill:'none',stroke:M.colors[p.label],'stroke-width':42,'stroke-dasharray':`${p.fraction*circumference} ${circumference}`,'stroke-dashoffset':-p.start*circumference,transform:'rotate(-90 110 110)'});const title=document.createElementNS(ns,'title');title.textContent=p.count+' '+p.label;arc.append(title);}
    for(const p of parts){const a=p.start*Math.PI*2-Math.PI/2;add('line',{x1:110+57*Math.cos(a),y1:110+57*Math.sin(a),x2:110+99*Math.cos(a),y2:110+99*Math.sin(a),stroke:'#eeeeef','stroke-width':1});}
    for(const r of [57,99])add('circle',{cx:110,cy:110,r,fill:'none',stroke:'#eeeeef','stroke-width':1.2});
    const labels=[];for(const p of [...parts].sort((a,b)=>b.count-a.count)){if(p.fraction<.025)continue;const angle=(p.start+p.fraction/2)*Math.PI*2-Math.PI/2,x=110+78*Math.cos(angle),y=110+78*Math.sin(angle);if(labels.some(l=>Math.hypot(l.x-x,l.y-y)<21))continue;labels.push({x,y});const w=String(p.count).length*8+9;add('rect',{x:x-w/2,y:y-10,width:w,height:20,rx:3,fill:'#ffffff'});add('text',{x,y:y+4,'text-anchor':'middle',fill:'#171b25','font-family':'Arial,sans-serif','font-size':12,'font-weight':700},String(p.count));}
    add('text',{'class':'maker-ring-total',x:110,y:110,'text-anchor':'middle',fill:token('text-primary'),'font-family':'Arial,sans-serif','font-size':26,'font-weight':700},String(total));
    add('text',{'class':'maker-ring-caption',x:110,y:129,'text-anchor':'middle',fill:token('text-secondary'),'font-family':'Arial,sans-serif','font-size':10},model.state.office==='governor'?'GOVERNORS':'SEATS');
  }
  function sync(){
    const byId=new Map(races.map(r=>[r.id,r])),muted=T.mix(token('map-neutral'),token('map-bg'),.72);
    for(const race of races)race.prediction.rating=model.rating(race.id);
    for(const node of $('maker-map').querySelectorAll('[data-race-id]')){
      const race=byId.get(node.dataset.raceId);if(!race){node.setAttribute('fill',muted);continue;}
      node.setAttribute('fill',M.colors[model.rating(race.id)]);node.setAttribute('data-rating',model.rating(race.id));node.setAttribute('aria-label',`${title(race)}: ${model.rating(race.id)}`);
    }
    for(const label of $('maker-map').querySelectorAll('[data-label-race-id]'))label.setAttribute('fill',T.foreground(M.colors[model.rating(label.dataset.labelRaceId)]));
    const counts=model.totalCounts(model.state.office),held=S.heldSeats[model.state.office],total=Object.values(counts).reduce((n,v)=>n+v,0);
    $('maker-totals').replaceChildren(...Object.entries(counts).map(([party,n])=>{const span=document.createElement('span');span.className='maker-'+party.toLowerCase();span.hidden=party==='I'&&!n;span.style.setProperty('--tower-color',party==='T'?M.colors.Tossup:T.candidateColor({party}));span.style.setProperty('--tower-ink',party==='T'?T.foreground(M.colors.Tossup):(T.contrast(T.candidateColor({party}),'#ffffff')>=3?'#ffffff':T.foreground(T.candidateColor({party}))));span.setAttribute('aria-label',`${n} ${party==='T'?'Tossup':party}`);const number=document.createElement('strong'),label=document.createElement('small');number.className='maker-total-number';number.textContent=n;label.className='maker-total-party';label.textContent=T.current.presentation==='yapms'?({D:'Democrats',R:'Republicans',I:'Independent',T:'Tossup'}[party]):party==='T'?'Tossup':party;span.append(number,document.createTextNode(' '),label);return span;}));
    $('maker-seat-bar').replaceChildren(...['D','I','T','R'].map(party=>{const span=document.createElement('span');span.style.width=counts[party]/total*100+'%';span.style.background=party==='T'?M.colors.Tossup:T.candidateColor({party});return span;}));
    $('maker-count-caption').textContent=`${total} ${model.state.office==='governor'?'governors':'seats'} · ${current().length} up for election.${model.state.office!=='house'?` Includes ${held.D} D / ${held.R} R${held.I?` / ${held.I} I`:''} not up.`:''} ${model.state.office==='senate'?' D includes 2 independent caucus seats.':''} Your scenario · Not election calls.`;
    seatRing();
    $('maker-undo').disabled=!model.past.length;$('maker-redo').disabled=!model.future.length;
    document.querySelectorAll('[data-office]').forEach(b=>{b.classList.toggle('active',b.dataset.office===model.state.office);b.setAttribute('aria-selected',String(b.dataset.office===model.state.office));});
  }
  function edited(text){sync();detail?.refresh();$('maker-map').querySelectorAll('.prediction-map-tooltip').forEach(n=>n.hidden=true);status(text);save();}
  function inspectRace(race){selected=race.id;$('maker-race').value=selected;$('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');detail.open(race);}
  function setInspect(value){inspecting=!!value&&$('maker-detail-enabled').checked;for(const b of document.querySelectorAll('[data-maker-interaction]'))b.setAttribute('aria-pressed',String((b.dataset.makerInteraction==='inspect')===inspecting));$('maker-drag').disabled=inspecting;status(inspecting?'Inspect mode: tap or click a race to open its details. Ratings stay unchanged.':'Paint mode: tap or click a race to apply your rating.');}
  function paint(race){if(inspecting){inspectRace(race);return;}selected=race.id;$('maker-race').value=selected;if(model.apply([[race.id,brush]]))edited(`${title(race)} · ${brush}`);}
  async function render(){
    ink?.setEnabled(false);
    detail?.close();
    const token=++generation;map?.destroy();map=null;selected='';
    const office=model.state.office,data=current();
    $('maker-race').replaceChildren(new Option('Find a race',''),...data.map(r=>new Option(title(r),r.id)));
    sync();status(`Loading ${office==='house'?'House districts':office+' map'}…`);
    const host=document.createElement('div');host.style.height='100%';$('maker-map').replaceChildren(host);
    ink?.sync();
    try{
      const controller=await M.renderRaceShapeMap({container:host,data:{races:data},office,stateLabels:true,ratingLabel:'Your rating',onSelect:paint,
        isPaintEnabled:()=>!inspecting&&$('maker-drag').checked,
        onPaintStart:()=>{stroke=new Map();},
        onPaintRace:race=>{if(!stroke.has(race.id))stroke.set(race.id,model.rating(race.id));model.assign(race.id,brush);race.prediction.rating=brush;},
        onPaintEnd:()=>{const updates=[...stroke.keys()].map(id=>[id,model.rating(id)]);for(const [id,before] of stroke)model.assign(id,before);model.apply(updates);edited(`${updates.length} race${updates.length===1?'':'s'} painted · ${brush}`);stroke.clear();}
      });
      if(token!==generation){controller?.destroy();return;}
      map=controller;fitMapFrame();
      host.querySelector('svg')?.setAttribute('aria-label',`Your ${office} ratings map`);
      host.querySelector('svg')?.setAttribute('role','group');
      host.querySelectorAll('[data-race-id]').forEach(n=>{n.setAttribute('role',n.dataset.raceId?'button':'img');if(!n.dataset.raceId){n.setAttribute('tabindex','-1');n.setAttribute('aria-label',`${n.getAttribute('aria-label')||'State'} · Not on the 2026 ballot`);}});
      sync();ink?.sync();status(inspecting?'Inspect mode: tap or click a race to open its details. Ratings stay unchanged.':'Choose a rating, then tap or click a race. Enable County detail in the menu for Inspect mode.');
    }catch{if(token===generation){host.textContent='The map could not load. Try another office or reload the page. Your saved ratings are unchanged.';status('Map unavailable. Your ratings are still saved.');}}
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function image(){
    const original=$('maker-map').querySelector('svg');if(!original){status('Wait for the map to load first.');return;}
    $('maker-image').disabled=true;
    try{
      const ns='http://www.w3.org/2000/svg',outer=document.createElementNS(ns,'svg');outer.setAttribute('xmlns',ns);outer.setAttribute('width','1600');outer.setAttribute('height','1100');
      const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;outer.append(n);return n;};
      add('rect',{width:1600,height:1100,fill:token('map-bg')});
      add('text',{x:30,y:45,fill:token('text-primary'),'font-family':'Arial','font-size':30},`${model.state.title||'My election map'} · ${model.state.office==='governor'?'Governors':model.state.office==='house'?'House':'Senate'}`);
      add('text',{x:30,y:75,fill:token('text-secondary'),'font-family':'Arial','font-size':18},'User-created ratings · Not FEA’s forecast or live election results');
      const clone=original.cloneNode(true);clone.setAttribute('x','0');clone.setAttribute('y','90');clone.setAttribute('width','1600');clone.setAttribute('height','880');clone.removeAttribute('class');
      clone.querySelector('.prediction-shape-layer')?.removeAttribute('transform');
      clone.querySelectorAll('path').forEach(n=>{n.setAttribute('stroke',token('state-border'));n.setAttribute('stroke-width','.6');n.setAttribute('vector-effect','non-scaling-stroke');});ink?.appendTo(clone,model.state.office);outer.append(clone);
      S.ratings.forEach((rating,i)=>{const x=30+(i%7)*220,y=1000+Math.floor(i/7)*40;add('rect',{x,y:y-15,width:18,height:18,fill:M.colors[rating]});add('text',{x:x+25,y,fill:token('text-primary'),'font-family':'Arial','font-size':17},short(rating));});
      if(model.state.office!=='house'){add('rect',{x:1350,y:1025,width:18,height:18,fill:token('panel-raised')});add('text',{x:1375,y:1040,fill:token('text-primary'),'font-family':'Arial','font-size':14},'Not on 2026 ballot');}
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(outer)],{type:'image/svg+xml'}));
      try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1100;canvas.getContext('2d').drawImage(img,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Image unavailable');download(blob,`fea-${model.state.office}-scenario.png`);status('PNG downloaded with your map and rating legend.');}finally{URL.revokeObjectURL(url);}
    }catch{status('The image could not be created. Save a scenario file to keep your work.');}finally{$('maker-image').disabled=false;}
  }
  try{
    const response=await fetch('/data/features/map-maker-races.json');if(!response.ok)throw Error('Catalogue unavailable');
    const catalogue=(await response.json()).races;
    let saved;try{const raw=localStorage.getItem(key);if(raw)saved=S.validate(JSON.parse(raw),catalogue);}catch{status('An older saved map could not be restored. Starting a blank map.');}
    model=new S.Scenario(catalogue,saved);
    detail=FEAMakerDetail.create({model,brush:()=>$('maker-county-brush').value||brush,edited,title,onContext:()=>ink?.sync()});
    ink=FEAMapInk.create({getScope:()=>detail.raceId||model.state.office});
    races=catalogue.map(r=>({id:r.id,raceId:r.id,type:r.type,state:r.state,district:r.district,displayName:title(r),prediction:{rating:model.rating(r.id)}}));
    for(const rating of S.ratings){const b=document.createElement('button');b.type='button';b.dataset.rating=rating;b.textContent=short(rating);b.title=rating;if(rating.includes('Democratic')||rating.includes('Republican')){b.style.gridColumn=rating.includes('Democratic')?'1':'2';b.style.gridRow=String(['Safe','Likely','Lean','Tilt'].findIndex(s=>rating.startsWith(s))+1);}else if(rating==='Tossup'){b.style.gridColumn='1 / -1';b.style.gridRow='5';}b.onclick=()=>{brush=rating;$('maker-county-brush').value=brush;palette();status(`Paint rating: ${rating}`);};$('maker-palette').append(b);$('maker-brush').add(new Option(rating,rating));$('maker-county-brush').add(new Option(rating,rating));$('maker-race-rating').add(new Option(rating,rating));}
    $('maker-county-brush').value=brush;
    $('maker-brush').onchange=e=>{brush=e.target.value;$('maker-county-brush').value=brush;palette();};
    $('maker-title').value=model.state.title;$('maker-title').oninput=e=>{model.state.title=e.target.value;save();};
    document.querySelectorAll('[data-office]').forEach(b=>b.onclick=()=>{if(model.state.office===b.dataset.office)return;model.state.office=b.dataset.office;save();render();});
    $('maker-undo').onclick=()=>{if(model.undo())edited('Last rating change undone.');};$('maker-redo').onclick=()=>{if(model.redo())edited('Rating change restored.');};
    $('maker-clear').onclick=()=>{model.apply(current().map(r=>[r.id,'Tossup']));edited('This office is cleared to Tossup. Undo restores your ratings.');};
    $('maker-race').onchange=e=>{selected=e.target.value;if(selected){map?.focusRace(selected);status(`${title(races.find(r=>r.id===selected))} · ${model.rating(selected)}`);}};
    $('maker-apply').onclick=()=>{const race=races.find(r=>r.id===selected);if(race)paint(race);else status('Choose a race first.');};
    $('maker-save').onclick=()=>download(new Blob([JSON.stringify(model.state,null,2)],{type:'application/json'}),'fea-scenario.json');
    $('maker-open').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{
      if(file.size>5000000)throw Error('This file is too large.');const raw=JSON.parse(await file.text());let message;
      if(raw.map){
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
        message=`YAPms imported · ${imported.entries.length} races · Other offices and county ratings preserved.${imported.notes.length?' '+imported.notes.join(' '):''}`;
      }else{
        const data=S.validate(raw,catalogue),units=new Set([...Object.keys(model.state.countyRatings),...Object.keys(data.countyRatings)]);
        model.apply([...catalogue.map(r=>[r.id,data.ratings[r.id]||'Tossup']),...[...units].map(id=>[id,data.countyRatings[id]||'Tossup'])]);model.state.office=data.office;model.state.title=data.title;$('maker-title').value=data.title;
        message='Scenario opened. Undo restores the previous ratings.';
      }
      save();await render();status(message);
    }catch(error){status(error.message||'This scenario file could not be opened.');}finally{e.target.value='';}};
    const openDetail=id=>{const race=races.find(r=>r.id===id);if(race&&$('maker-detail-enabled').checked)inspectRace(race);};
    $('maker-detail-enabled').onchange=e=>{
      $('maker-open-detail').hidden=!e.target.checked;$('maker-interaction').hidden=!e.target.checked;
      if(!e.target.checked){setInspect(false);detail.close();}
      else {setInspect(matchMedia('(pointer: coarse)').matches);status('County detail enabled. Choose Inspect and tap a race, or right-click with a mouse. Choose Paint to resume ratings.');}
    };
    for(const b of document.querySelectorAll('[data-maker-interaction]'))b.onclick=()=>setInspect(b.dataset.makerInteraction==='inspect');
    $('maker-open-detail').onclick=()=>{if(selected)openDetail(selected);else status('Select a race on the map or in Find a race first.');};
    $('maker-map').addEventListener('contextmenu',e=>{const id=e.target.closest('[data-race-id]')?.dataset.raceId;if(id&&$('maker-detail-enabled').checked){e.preventDefault();openDetail(id);}});
    $('maker-map').addEventListener('keydown',e=>{if(e.key==='F10'&&e.shiftKey&&$('maker-detail-enabled').checked){const id=e.target.closest('[data-race-id]')?.dataset.raceId;if(id){e.preventDefault();openDetail(id);}}});
    $('maker-image').onclick=image;
    const labels=$('maker-labels');
    try{labels.checked=localStorage.getItem('feaMakerLabels.v1')!=='off';}catch{}
    const updateLabels=()=>{document.body.classList.toggle('maker-labels-hidden',!labels.checked);};updateLabels();
    labels.onchange=()=>{updateLabels();try{localStorage.setItem('feaMakerLabels.v1',labels.checked?'on':'off');}catch{}status(labels.checked?'Map labels on.':'Map labels off.');};
    const appearance=FEAAppearance();$('maker-appearance').onclick=()=>{ $('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');appearance.open();};
    $('maker-menu-button').onclick=()=>{const menu=$('board-menu');menu.hidden=!menu.hidden;$('maker-menu-button').setAttribute('aria-expanded',String(!menu.hidden));};
    document.addEventListener('click',e=>{if(!e.target.closest('.board-overflow')){$('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',e=>{if(ink.enabled)return;if(e.key==='Escape'){$('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('input,select,textarea,dialog')){e.preventDefault();e.shiftKey?$('maker-redo').click():$('maker-undo').click();}});
    document.addEventListener('fea-desk-theme',()=>{palette();sync();detail.refresh();ink.sync();});
    const requested=FEAResearchLinks.findRace(new URLSearchParams(location.search),races);
    if(requested)model.state.office=requested.type;
    palette();await render();
    if(requested && map && generation===1){
      $('maker-race').value=requested.id;
      $('maker-race').dispatchEvent(new Event('change'));
    }
  }catch{status('The map maker could not start. Reload to try again.');}
})();
