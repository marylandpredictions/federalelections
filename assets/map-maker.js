(async function(){
  const $=id=>document.getElementById(id),key='fea-map-maker-v1',S=FEAScenario,M=FeaPredictionMaps,T=FEADeskTheme;
  let model,races=[],map,brush='Safe Democratic',selected='',generation=0,stroke=new Map(),detail,lastTouch=null;
  const short=rating=>rating.replace(' Democratic',' D').replace(' Republican',' R').replace(' Independent',' I');
  const title=r=>r.type==='house'?`${r.state}-${['0','AL'].includes(String(r.district))?'AL':String(r.district).padStart(2,'0')}`:`${r.state} ${r.type==='senate'?'Senate':'Governor'}`;
  const status=text=>$('maker-status').textContent=text;
  const current=()=>races.filter(r=>r.type===model.state.office);
  const token=name=>getComputedStyle(document.body).getPropertyValue('--'+name).trim()||T.resolved.tokens[name];
  function save(){try{localStorage.setItem(key,JSON.stringify(model.state));}catch{status('Browser saving is unavailable. Save a scenario file to keep your map.');}}
  function palette(){
    for(const rating of S.ratings){
      const party=rating.includes('Democratic')?'D':rating.includes('Republican')?'R':'I';
      const tint=rating.startsWith('Safe')?0:rating.startsWith('Likely')?.2:rating.startsWith('Lean')?.4:.65;
      M.colors[rating]=rating==='Tossup'?token('map-neutral'):T.mix(T.candidateColor({party}),token('panel-bg'),tint);
    }
    for(const button of $('maker-palette').querySelectorAll('button')){button.style.setProperty('--paint-color',M.colors[button.dataset.rating]);button.setAttribute('aria-pressed',String(button.dataset.rating===brush));}
    $('maker-brush').value=brush;
  }
  function sync(){
    const byId=new Map(races.map(r=>[r.id,r])),muted=token('panel-raised');
    for(const race of races)race.prediction.rating=model.rating(race.id);
    for(const node of $('maker-map').querySelectorAll('[data-race-id]')){
      const race=byId.get(node.dataset.raceId);if(!race){node.setAttribute('fill',muted);continue;}
      node.setAttribute('fill',M.colors[model.rating(race.id)]);node.setAttribute('data-rating',model.rating(race.id));node.setAttribute('aria-label',`${title(race)}: ${model.rating(race.id)}`);
    }
    const counts=model.counts(model.state.office),total=current().length;
    $('maker-totals').replaceChildren(...Object.entries(counts).map(([party,n])=>{const span=document.createElement('span');span.className='maker-'+party.toLowerCase();span.style.setProperty('--tower-color',T.candidateColor({party}));span.textContent=`${n} ${party==='T'?'Tossup':party}`;return span;}));
    $('maker-seat-bar').replaceChildren(...['D','I','T','R'].map(party=>{const span=document.createElement('span');span.style.width=counts[party]/total*100+'%';span.style.background=party==='T'?M.colors.Tossup:T.candidateColor({party});return span;}));
    $('maker-count-caption').textContent=`Your ratings · ${total} ${model.state.office==='house'?'districts':'races on the 2026 ballot'} · Not election calls`;
    $('maker-undo').disabled=!model.past.length;$('maker-redo').disabled=!model.future.length;
    document.querySelectorAll('[data-office]').forEach(b=>{b.classList.toggle('active',b.dataset.office===model.state.office);b.setAttribute('aria-selected',String(b.dataset.office===model.state.office));});
  }
  function edited(text){sync();detail?.refresh();$('maker-map').querySelectorAll('.prediction-map-tooltip').forEach(n=>n.hidden=true);status(text);save();}
  function paint(race){selected=race.id;$('maker-race').value=selected;if(model.apply([[race.id,brush]]))edited(`${title(race)} · ${brush}`);}
  async function render(){
    const token=++generation;map?.destroy();map=null;selected='';
    const office=model.state.office,data=current();
    $('maker-race').replaceChildren(new Option('Find a race',''),...data.map(r=>new Option(title(r),r.id)));
    sync();status(`Loading ${office==='house'?'House districts':office+' map'}…`);
    const host=document.createElement('div');host.style.height='100%';$('maker-map').replaceChildren(host);
    try{
      const controller=await M.renderRaceShapeMap({container:host,data:{races:data},office,ratingLabel:'Your rating',onSelect:paint,
        isPaintEnabled:()=>$('maker-drag').checked,
        onPaintStart:()=>{stroke=new Map();},
        onPaintRace:race=>{if(!stroke.has(race.id))stroke.set(race.id,model.rating(race.id));model.assign(race.id,brush);race.prediction.rating=brush;},
        onPaintEnd:()=>{const updates=[...stroke.keys()].map(id=>[id,model.rating(id)]);for(const [id,before] of stroke)model.assign(id,before);model.apply(updates);edited(`${updates.length} race${updates.length===1?'':'s'} painted · ${brush}`);stroke.clear();}
      });
      if(token!==generation){controller?.destroy();return;}
      map=controller;
      host.querySelector('svg')?.setAttribute('aria-label',`Your ${office} ratings map`);
      host.querySelector('svg')?.setAttribute('role','group');
      host.querySelectorAll('[data-race-id]').forEach(n=>{n.setAttribute('role',n.dataset.raceId?'button':'img');if(!n.dataset.raceId){n.setAttribute('tabindex','-1');n.setAttribute('aria-label',`${n.getAttribute('aria-label')||'State'} · Not on the 2026 ballot`);}});
      sync();status('Choose a rating, then click a race. Drag the map to pan; use + and − to zoom.');
    }catch{if(token===generation){host.textContent='The map could not load. Try another office or reload the page. Your saved ratings are unchanged.';status('Map unavailable. Your ratings are still saved.');}}
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function image(){
    const original=$('maker-map').querySelector('svg');if(!original){status('Wait for the map to load first.');return;}
    $('maker-image').disabled=true;
    try{
      const ns='http://www.w3.org/2000/svg',outer=document.createElementNS(ns,'svg');outer.setAttribute('xmlns',ns);outer.setAttribute('width','1600');outer.setAttribute('height','1100');
      const add=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;outer.append(n);return n;};
      add('rect',{width:1600,height:1100,fill:T.resolved.tokens['map-bg']});
      add('text',{x:30,y:45,fill:T.resolved.tokens['text-primary'],'font-family':'Arial','font-size':30},`${model.state.title||'My election map'} · ${model.state.office==='governor'?'Governors':model.state.office==='house'?'House':'Senate'}`);
      add('text',{x:30,y:75,fill:T.resolved.tokens['text-secondary'],'font-family':'Arial','font-size':18},'User-created ratings · Not FEA’s forecast or live election results');
      const clone=original.cloneNode(true);clone.setAttribute('x','0');clone.setAttribute('y','90');clone.setAttribute('width','1600');clone.setAttribute('height','880');clone.removeAttribute('class');
      clone.querySelector('.prediction-shape-layer')?.removeAttribute('transform');
      clone.querySelectorAll('path').forEach(n=>{n.setAttribute('stroke',T.resolved.tokens['state-border']);n.setAttribute('stroke-width','.6');n.setAttribute('vector-effect','non-scaling-stroke');});outer.append(clone);
      S.ratings.forEach((rating,i)=>{const x=30+(i%7)*220,y=1000+Math.floor(i/7)*40;add('rect',{x,y:y-15,width:18,height:18,fill:M.colors[rating]});add('text',{x:x+25,y,fill:T.resolved.tokens['text-primary'],'font-family':'Arial','font-size':17},short(rating));});
      if(model.state.office!=='house'){add('rect',{x:1350,y:1025,width:18,height:18,fill:T.resolved.tokens['panel-raised']});add('text',{x:1375,y:1040,fill:T.resolved.tokens['text-primary'],'font-family':'Arial','font-size':14},'Not on 2026 ballot');}
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(outer)],{type:'image/svg+xml'}));
      try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1100;canvas.getContext('2d').drawImage(img,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('Image unavailable');download(blob,`fea-${model.state.office}-scenario.png`);status('PNG downloaded with your map and rating legend.');}finally{URL.revokeObjectURL(url);}
    }catch{status('The image could not be created. Save a scenario file to keep your work.');}finally{$('maker-image').disabled=false;}
  }
  try{
    const response=await fetch('/data/features/map-maker-races.json');if(!response.ok)throw Error('Catalogue unavailable');
    const catalogue=(await response.json()).races;
    let saved;try{const raw=localStorage.getItem(key);if(raw)saved=S.validate(JSON.parse(raw),catalogue);}catch{status('An older saved map could not be restored. Starting a blank map.');}
    model=new S.Scenario(catalogue,saved);
    detail=FEAMakerDetail.create({model,brush:()=>$('maker-county-brush').value||brush,edited,title});
    races=catalogue.map(r=>({id:r.id,raceId:r.id,type:r.type,state:r.state,district:r.district,displayName:title(r),prediction:{rating:model.rating(r.id)}}));
    for(const rating of S.ratings){const b=document.createElement('button');b.type='button';b.dataset.rating=rating;b.textContent=short(rating);b.title=rating;b.onclick=()=>{brush=rating;$('maker-county-brush').value=brush;palette();status(`Paint rating: ${rating}`);};$('maker-palette').append(b);$('maker-brush').add(new Option(rating,rating));$('maker-county-brush').add(new Option(rating,rating));}
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
    const openDetail=id=>{const race=races.find(r=>r.id===id);if(race&&$('maker-detail-enabled').checked){selected=id;$('maker-race').value=id;detail.open(race);}};
    $('maker-detail-enabled').onchange=e=>{$('maker-open-detail').hidden=!e.target.checked;lastTouch=null;status(e.target.checked?'County detail enabled. Right-click a race, double tap, or use Open selected race detail in this menu.':'County detail disabled. Click or tap to paint.');};
    $('maker-open-detail').onclick=()=>{if(selected)openDetail(selected);else status('Select a race on the map or in Find a race first.');};
    $('maker-map').addEventListener('contextmenu',e=>{const id=e.target.closest('[data-race-id]')?.dataset.raceId;if(id&&$('maker-detail-enabled').checked){e.preventDefault();openDetail(id);}});
    $('maker-map').addEventListener('keydown',e=>{if(e.key==='F10'&&e.shiftKey&&$('maker-detail-enabled').checked){const id=e.target.closest('[data-race-id]')?.dataset.raceId;if(id){e.preventDefault();openDetail(id);}}});
    $('maker-map').addEventListener('click',e=>{if(!$('maker-detail-enabled').checked||e.pointerType!=='touch')return;const id=e.target.closest('[data-race-id]')?.dataset.raceId;if(!id)return;const now=performance.now();if(lastTouch?.id===id&&now-lastTouch.time<450){e.preventDefault();e.stopImmediatePropagation();lastTouch=null;openDetail(id);}else lastTouch={id,time:now};},true);
    $('maker-image').onclick=image;
    const appearance=FEAAppearance();$('maker-appearance').onclick=()=>{ $('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');appearance.open();};
    $('maker-menu-button').onclick=()=>{const menu=$('board-menu');menu.hidden=!menu.hidden;$('maker-menu-button').setAttribute('aria-expanded',String(!menu.hidden));};
    document.addEventListener('click',e=>{if(!e.target.closest('.board-overflow')){$('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('board-menu').hidden=true;$('maker-menu-button').setAttribute('aria-expanded','false');}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!e.target.closest('input,select,textarea,dialog')){e.preventDefault();e.shiftKey?$('maker-redo').click():$('maker-undo').click();}});
    document.addEventListener('fea-desk-theme',()=>{palette();sync();detail.refresh();});
    palette();await render();
  }catch{status('The map maker could not start. Reload to try again.');}
})();
