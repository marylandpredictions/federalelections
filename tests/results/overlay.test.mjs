import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
async function scope(){
 const s={console};vm.createContext(s);
 for(const file of ['results-ui','results-desk','projection-card','overlay-model'])vm.runInContext(await readFile(`assets/${file}.js`,'utf8'),s);
 return s;
}
const race=(id='senate-OH',calls=[])=>({id,type:'senate',state:'OH',electionDate:'2026-11-03',candidates:[{name:'A',party:'D',votes:100},{name:'B',party:'R',votes:80}],calls});
const full=(rows,v='v1')=>({version:v,groups:[{races:rows}]});
test('OBS starts without replay, observes explicit NBC/FEA calls across midnight, and retains unchanged races',async()=>{
 const s=await scope(),m=new s.FEAOverlay.Model();
 assert.equal(m.accept(full([race(),race('senate-PA')])).length,0);
 for(const provider of ['NBC','FEA']){
  const call={candidate:'A',status:'projected',calledAt:'2026-11-04T06:00:00Z',provider,source:provider==='NBC'?'nbc-auto':'fea-manual'};
  const e=m.accept({version:provider,races:[race('senate-OH',[call])]});
  assert.equal(e.length,1);assert.equal(m.races.size,2);
  assert.match(s.FEAProjectionCard.content(e[0]),new RegExp(provider==='NBC'?'NBC PROJECTS':'PROJECTION UPDATE'));
  assert.equal(s.FEAProjectionCard.source(call),provider);
 }
 assert.equal(m.accept({version:'again',races:[m.races.get('senate-OH')]}).length,0);
 const events=m.accept({version:'retract',races:[race()]});
 assert.equal(events.length,1);assert.equal(events[0].correction,true);assert.equal(events[0].call,null);
 assert.match(s.FEAProjectionCard.content(events[0]),/Previous projection withdrawn/);
});
test('OBS never infers projections from vote leaders/winner flags, and invalid data retains last good snapshot',async()=>{
 const s=await scope(),m=new s.FEAOverlay.Model();m.accept(full([race()]));
 const leading=race();leading.candidates[0].apiWinner=true;
 assert.equal(m.accept({version:'v2',races:[leading]}).length,0);
 for(const payload of [full([], 'bad'),{version:'bad',races:[{id:'bad'}]},full([race('senate-OH',[{candidate:'missing'}])],'bad')]){
  assert.throws(()=>m.accept(payload));assert.equal(m.version,'v2');assert.equal(m.races.size,1);
 }
 assert.equal(m.accept({version:'recovery',races:[race()]}).length,0);
});
test('OBS queues 15 calls and replaces corrections immediately; queues remain bounded',async()=>{
 const s=await scope(),m=new s.FEAOverlay.Model(),q=new s.FEAOverlay.ProjectionQueue();
 const rows=Array.from({length:15},(_,i)=>race('race-'+i));m.accept(full(rows));
 const events=m.accept(full(rows.map(r=>({...r,calls:[{candidate:'A',status:'projected',provider:'NBC'}]})),'v2'));
 assert.equal(events.length,15);for(const e of events)q.add(e);q.next();assert.equal(q.pending.length,14);
 const correction={...q.active,correction:true,call:null};assert.equal(q.add(correction),true);assert.equal(q.active.call,null);
 for(let i=0;i<3000;i++)q.add({race:race('extra-'+i)});assert.equal(q.pending.length,600);
 q.retain(new Set([q.active.race.id]));assert.equal(q.pending.length,0);
});
test('Public and OBS cards share source/title/winner markup, escape names, and OBS omits interaction controls',async()=>{
 const s=await scope(),event={race:race(),call:{candidate:'<A & B>',source:'nbc-auto',provider:'FEA'}};
 const publicHTML=s.FEAProjectionCard.content(event),obsHTML=s.FEAProjectionCard.content(event,{interactive:false});
 assert.match(obsHTML,/NBC PROJECTS/);assert.match(obsHTML,/Ohio Senate/);assert.match(obsHTML,/&lt;A &amp; B&gt;/);
 assert.equal(publicHTML.replace(/<button[^>]*>.*?<\/button>/g,''),obsHTML);
 assert.doesNotMatch(obsHTML,/<button/);
});
// Runs the real overlay controller against a small DOM/transport adapter.
async function controller({preview=false}={}){
 const s=await scope(),nodes=new Map(),timers=new Map(),requests=[];let seq=0,fail=false,payload=full([race()]);
 const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{}});return nodes.get(id)};
 Object.assign(s,{URLSearchParams,AbortController,location:{search:preview?'?preview=1':''},sessionStorage:null,localStorage:null,window:{addEventListener(){}},document:{getElementById:node},setInterval:()=>++seq,clearInterval(){},setTimeout:(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),FEADeskTheme:{read:()=>({current:{}}),presets:[{}],apply(){},candidateColor:()=> '#123456',resolved:{tokens:{warning:'#ffa500'}}}});
 s.fetch=async(url,options)=>{
  requests.push({url,options});if(fail==='timeout'&&url.startsWith('/api/'))return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout'))));if(fail&&url.startsWith('/api/'))throw Error('network down');
  const data=url==='/api/results-version'?{version:payload.version}:url.startsWith('/api/live-results')?payload:url==='/data/overlay-config.json'?{tickerItems:[]} : null;
  return {ok:true,status:200,headers:{get:()=>null},json:async()=>data};
 };
 vm.runInContext(await readFile('assets/call-overlay.js','utf8'),s);
 const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};await settle();
 return {nodes,requests,abort(){for(const t of timers.values())if(t.ms===12000)t.fn();},setPayload:p=>payload=p,setFailure:f=>fail=f,async tick(){const entry=[...timers.entries()].find(([,t])=>t.ms===15000);assert.ok(entry,'next refresh scheduled');timers.delete(entry[0]);await entry[1].fn();await settle();}};
}
test('Real overlay transport retains last data on failure, recovers with deltas, retracts visibly and sends ETags',async()=>{
 const c=await controller();assert.match(c.nodes.get('broadcast-ticker-track').innerHTML,/UNCALLED/);
 assert.ok(c.requests.some(r=>r.url==='/api/live-results'));
 c.setPayload({version:'v2',races:[race('senate-OH',[{candidate:'A',provider:'NBC',status:'projected'}])]});await c.tick();
 assert.match(c.nodes.get('broadcast-call-slot').innerHTML,/NBC PROJECTS/);
 assert.ok(c.requests.some(r=>r.url.includes('/changes?since=v1')));
 c.setFailure(true);await c.tick();assert.match(c.nodes.get('broadcast-health').textContent,/Updates delayed/);assert.match(c.nodes.get('broadcast-ticker-track').innerHTML,/NBC PROJECTS/);
 c.setFailure(false);c.setPayload({version:'v3',races:[race()]});await c.tick();
 assert.match(c.nodes.get('broadcast-call-slot').innerHTML,/PROJECTION UPDATE/);assert.match(c.nodes.get('broadcast-call-slot').innerHTML,/Previous projection withdrawn/);
 assert.doesNotMatch(c.nodes.get('broadcast-ticker-track').innerHTML,/NBC PROJECTS/);
 assert.ok(c.requests.some(r=>r.options?.headers?.['If-None-Match']==='"v2"'));
 assert.ok(c.requests.every(r=>!r.url.includes('result-calls.json')));
});
test('Overlay preview is unmistakable and never reads or writes public results',async()=>{
 const c=await controller({preview:true});assert.equal(c.requests.length,0);
 assert.match(c.nodes.get('call-overlay').innerHTML,/SIMULATED RESULTS/);assert.match(c.nodes.get('broadcast-call-slot').innerHTML,/Sample Candidate/);
});


test('Overlay aborts a stalled request and schedules recovery without blanking data',async()=>{
 const c=await controller();c.setFailure('timeout');const pending=c.tick();
 await new Promise(resolve=>setImmediate(resolve));c.abort();await pending;
 assert.match(c.nodes.get('broadcast-health').textContent,/Updates delayed/);
 assert.match(c.nodes.get('broadcast-ticker-track').innerHTML,/UNCALLED/);
 c.setFailure(false);await c.tick();assert.equal(c.nodes.get('broadcast-health').textContent,'');
});
