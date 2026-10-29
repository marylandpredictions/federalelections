/* Election-night OBS browser source: the same public results/calls as /results. */
(function(){
  const root=document.getElementById('call-overlay'),params=new URLSearchParams(location.search);
  const filter={race:params.get('race')||null,office:['house','senate','governor'].includes(params.get('office'))?params.get('office'):null};
  const preview=['1','call','correction'].includes(params.get('preview'));
  const Card=FEAProjectionCard,T=FEADeskTheme,esc=Card.esc;
  let storage;try{storage=sessionStorage;}catch{}
  const model=new FEAOverlay.Model(preview?null:storage),queue=new FEAOverlay.ProjectionQueue();
  let pollTimer,callTimer,clockTimer,infoTimer,busy=false,failed=false,stopped=false;
  let schedule=null,config={tickerItems:[],producerNote:''},configETag='',configAt=0,configFailed=false,tickerSignature='',infoIndex=0;
  let theme;try{theme=T.read(localStorage).current;}catch{theme=T.presets[0];}
  theme=T.presets.find(t=>t.id===params.get('theme'))||theme;T.apply(theme);
  root.innerHTML=`<section class="broadcast-overlay-stage"><div id="broadcast-info-panel" class="broadcast-info-panel"></div><div id="broadcast-call-slot" class="broadcast-call-slot fea-projections" aria-live="polite"></div><small id="broadcast-queue"></small><div id="broadcast-health" class="broadcast-health" role="status"></div><div class="broadcast-ticker-shell"><div class="broadcast-ticker-brand"><img src="assets/img/FEA_White.webp" alt="Federal Elections Analysis"><strong>ELECTION NIGHT</strong></div><div class="broadcast-ticker-viewport"><div id="broadcast-ticker-track" class="broadcast-ticker-track"></div></div><div id="broadcast-ticker-clock"></div></div>${preview?'<div class="broadcast-preview">PREVIEW · SIMULATED RESULTS · NOT LIVE</div>':''}</section>`;
  const node=id=>document.getElementById(id);
  function renderCallCard(event){return `<article class="projection-toast ${event.correction?'is-correction':''}" style="--party-accent:${esc(Card.accent(event))}">${Card.content(event,{interactive:false})}</article>`;}
  function renderQueueCount(){node('broadcast-queue').textContent=queue.pending.length?`+${queue.pending.length} projection${queue.pending.length===1?'':'s'} queued`:'';}
  function showActive(){
    clearTimeout(callTimer);
    const event=queue.active;
    node('broadcast-call-slot').innerHTML=event?renderCallCard(event):'';
    renderQueueCount();if(!event)return;
    callTimer=setTimeout(()=>{queue.next();showActive();},18000);
  }
  function addEvents(events){
    let replace=false;
    for(const e of events.filter(e=>(!filter.race||e.race.id===filter.race)&&(!filter.office||e.race.type===filter.office)))replace=queue.add(e)||replace;
    if(!queue.active){queue.next();showActive();}else if(replace)showActive();
    renderQueueCount();
  }
  const time=at=>new Date(at).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'})+' ET';
  function updateClock(){node('broadcast-ticker-clock').textContent=time(Date.now());}
  function items(){
    const races=model.filtered(filter),out=[];
    const recent=races.filter(r=>r.calls.length).sort((a,b)=>String(b.calls[0].calledAt||'').localeCompare(String(a.calls[0].calledAt||''))).slice(0,6);
    for(const r of recent)out.push({tag:Card.source(r.calls[0])+' PROJECTS',text:Card.title(r)+' · '+r.calls[0].candidate});
    for(const item of (config.tickerItems||[]).slice(0,30))if(typeof item.text==='string'&&item.text.trim())out.push({tag:String(item.tag||'FEA').slice(0,24),text:item.text.slice(0,1000)});
    for(const r of races.filter(r=>!r.calls.length&&FEADesk.total(r)>0).sort((a,b)=>Number(b.expectedVotePercent||0)-Number(a.expectedVotePercent||0)).slice(0,8)){
      const leaders=[...r.candidates].sort((a,b)=>b.votes-a.votes),tied=leaders[0]?.votes===leaders[1]?.votes,pct=r.expectedVotePercent??r.estimatedVoteReporting;
      out.push({tag:'UNCALLED',text:`${Card.title(r)} · ${tied?'Tied':leaders[0].name+' leads'}${pct!=null?' · '+Number(pct).toFixed(1)+'% expected vote in':''}`});
    }
    if(!races.some(r=>r.calls.length||FEADesk.total(r)>0))out.push({tag:'NOVEMBER 3',text:races.length?'Awaiting results · '+races.length+' races available on the FEA Big Board':'Waiting for the public results feed'});
    return out;
  }
  function renderTicker(){
    const rows=preview?[{tag:'PREVIEW',text:'Simulated overlay check. No public calls or results are changed.'}]:items();
    const signature=JSON.stringify(rows);if(signature===tickerSignature)return;tickerSignature=signature;
    const html=rows.map(i=>`<span class="broadcast-ticker-item"><b>${esc(i.tag)}</b><span>${esc(i.text)}</span></span>`).join('');
    node('broadcast-ticker-track').innerHTML=`<div class="broadcast-ticker-loop">${html}</div><div class="broadcast-ticker-loop" aria-hidden="true">${html}</div>`;
    node('broadcast-ticker-track').style.animationDuration=Math.max(35,Math.min(300,rows.reduce((n,r)=>n+r.text.length+r.tag.length,0)/4))+'s';
  }
  function renderInfo(advance=false){
    if(advance)infoIndex++;
    const races=model.filtered(filter),called=races.filter(r=>r.calls.length).length;
    if(preview){node('broadcast-info-panel').textContent='Overlay preview · '+(queue.active?'Projection card':'Preview complete');return;}
    let next='Poll-close schedule unavailable';
    if(schedule){const group=FEADesk.nextPollClosures(races,schedule),states=[...new Set(races.filter(r=>group.raceIds.includes(r.id)).map(r=>r.state))];next=group.at?'Next scheduled close · '+time(group.at)+' · '+states.join(' / '):'Scheduled polls closed · counting continues';}
    const count=races.length?`${called} published calls · ${races.length-called} uncalled`:filter.race?'Selected race not available':'Waiting for the public results feed';
    const messages=[count,next,...(config.producerNote?[config.producerNote]:[]),'Federal Elections Analysis · Actual results and published calls'];
    node('broadcast-info-panel').textContent=messages[infoIndex%messages.length];
    node('broadcast-health').textContent=failed?'Updates delayed · retaining last received results':model.provider.stale?'Source delayed · showing last available results':configFailed?'Ticker update delayed · results continue':'';
  }
  async function fetchBounded(url,options={}){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(url,{...options,signal:controller.signal});
      const data=response.ok?await response.json():null;
      return {ok:response.ok,status:response.status,headers:response.headers,json:async()=>data};
    }finally{clearTimeout(timer);}
  }
  async function readConfig(){
    if(Date.now()-configAt<30000)return;
    try{const response=await fetchBounded('/data/overlay-config.json',{cache:'no-cache',headers:configETag?{'If-None-Match':configETag}:{}});if(response.status!==304){if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.tickerItems))throw Error();config=data;configETag=response.headers.get('etag')||'';}configFailed=false;configAt=Date.now();}catch{configFailed=true;configAt=Date.now();}
  }
  async function readResults(){
    const response=await fetchBounded('/api/results-version',{cache:'no-cache',headers:model.version?{'If-None-Match':'"'+model.version+'"'}:{}});
    if(response.status===304)return;
    if(!response.ok)throw Error('Results heartbeat unavailable');const meta=await response.json();
    if(meta.version===model.version)return;
    let data;
    if(model.version){const delta=await fetchBounded('/api/live-results/changes?since='+encodeURIComponent(model.version),{cache:'no-cache'});if(delta.ok)data=await delta.json();}
    if(!data||data.reset){const full=await fetchBounded('/api/live-results',{cache:'no-cache'});if(!full.ok)throw Error('Results snapshot unavailable');data=await full.json();}
    const events=model.accept(data);
    if(queue.retain(new Set(model.races.keys()))){queue.next();showActive();}
    addEvents(events);
  }
  async function update(){
    if(busy||stopped||preview)return;busy=true;
    try{await Promise.all([readResults(),readConfig()]);failed=false;}catch{failed=true;}
    finally{busy=false;renderTicker();renderInfo();if(!stopped)pollTimer=setTimeout(update,15000);}
  }
  updateClock();clockTimer=setInterval(updateClock,10000);infoTimer=setInterval(()=>renderInfo(true),8000);
  if(preview){
    const race={id:'senate-OH',state:'OH',type:'senate',candidates:[{name:'Sample Candidate',party:'D',votes:0}],calls:[]};
    const correction=params.get('preview')==='correction';
    addEvents([{key:'preview',race,correction,call:correction?null:{candidate:'Sample Candidate',provider:'NBC',source:'nbc-auto'}}]);renderTicker();renderInfo();
  }else{
    fetchBounded('/data/results/poll-closes.json',{cache:'no-cache'}).then(r=>r.ok?r.json():null).then(data=>{schedule=data;renderInfo();}).catch(()=>{});
    update();
  }
  window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(pollTimer);clearTimeout(callTimer);clearInterval(clockTimer);clearInterval(infoTimer);});
})();
