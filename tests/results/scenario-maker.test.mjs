import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const {Scenario,validate,ratings,validUnit}=createRequire(import.meta.url)('../../assets/scenario-model.js');
const catalogue=JSON.parse(readFileSync('data/election-night-races.json')).races;
test('Scenario ratings use the existing FEA rating vocabulary and all 506 contest IDs',()=>{
 const context={window:{}};vm.createContext(context);vm.runInContext(readFileSync('assets/prediction-map-utils.js','utf8'),context);
 assert.deepEqual([...context.window.FeaPredictionMaps.allowedRatings].sort(),[...ratings].sort());
 assert.deepEqual(JSON.parse(readFileSync('data/features/map-maker-races.json')).races,catalogue.map(({id,type,state,district})=>({id,type,state,...(district!==undefined?{district}:{})})));
 const model=new Scenario(catalogue);assert.equal(catalogue.length,506);
 assert.deepEqual(model.counts('house'),{D:0,R:0,I:0,T:435});assert.equal(model.counts('senate').T,35);assert.equal(model.counts('governor').T,36);
});
test('Rating strokes undo atomically, redo correctly, preserve other offices and stay bounded',()=>{
 const model=new Scenario(catalogue),a=catalogue.find(r=>r.type==='house').id,b=catalogue.find(r=>r.type==='senate').id;
 model.apply([[a,'Safe Democratic'],[b,'Lean Independent']]);assert.equal(model.counts('house').D,1);assert.equal(model.counts('senate').I,1);
 model.undo();assert.equal(model.rating(a),'Tossup');assert.equal(model.rating(b),'Tossup');model.redo();assert.equal(model.rating(b),'Lean Independent');
 for(let i=0;i<300;i++)model.apply([[a,i%2?'Safe Republican':'Safe Democratic']]);assert.equal(model.past.length,100);
 model.undo();model.apply([[a,'Tilt Independent']]);assert.equal(model.future.length,0);
 const before=JSON.stringify(model.state);assert.throws(()=>model.apply([[a,'Safe Democratic'],['not-a-race','Safe Republican']]));assert.equal(JSON.stringify(model.state),before);
});
test('Scenario files restore exact ratings and reject unsafe, invalid and incompatible imports',()=>{
 const model=new Scenario(catalogue),id=catalogue[0].id;model.apply([[id,'Likely Republican']]);model.state.title='<My scenario>';
 assert.deepEqual(new Scenario(catalogue,JSON.parse(JSON.stringify(model.state))).state,model.state);
 for(const bad of [{...model.state,schemaVersion:3},{...model.state,office:'president'},{...model.state,title:'x'.repeat(81)},{...model.state,ratings:{[id]:'winner'}},{...model.state,ratings:{unknown:'Safe Democratic'}},{...model.state,ratings:[]}])assert.throws(()=>validate(bad,catalogue));
 assert.throws(()=>validate(JSON.parse('{"schemaVersion":1,"title":"x","office":"house","ratings":{"__proto__":"Safe Democratic"}}'),catalogue));
});

test('Full scenario totals include held seats, use held Senate caucus alignment, and survive edits/imports/undo',()=>{
 const model=new Scenario(catalogue);
 assert.deepEqual(model.totalCounts('senate'),{D:34,R:31,I:0,T:35});
 assert.deepEqual(model.totalCounts('governor'),{D:6,R:8,I:0,T:36});
 assert.deepEqual(model.totalCounts('house'),{D:0,R:0,I:0,T:435});
 model.apply([['senate-CO','Safe Democratic'],['governor-CO','Lean Republican']]);
 assert.deepEqual(model.totalCounts('senate'),{D:35,R:31,I:0,T:34});assert.deepEqual(model.totalCounts('governor'),{D:6,R:9,I:0,T:35});
 for(const [office,total] of [['senate',100],['governor',50],['house',435]])assert.equal(Object.values(model.totalCounts(office)).reduce((n,v)=>n+v,0),total);
 model.undo();assert.deepEqual(model.totalCounts('senate'),{D:34,R:31,I:0,T:35});
 const restored=new Scenario(catalogue,JSON.parse(JSON.stringify(model.state)));assert.deepEqual(restored.totalCounts('governor'),{D:6,R:8,I:0,T:36});
 model.apply(catalogue.filter(r=>r.type==='senate').map(r=>[r.id,'Safe Republican']));assert.deepEqual(model.totalCounts('senate'),{D:34,R:66,I:0,T:0});
});

test('Race explorer uses an inline board panel and shared map region, not a modal',()=>{
 const html=readFileSync('features/map-maker/2026.html','utf8'),code=readFileSync('assets/map-maker-detail.js','utf8');
 assert.match(html,/<aside id="focused-race-panel"[^>]*hidden>/);assert.doesNotMatch(html,/<dialog id="focused-race-panel"/);
 assert.doesNotMatch(code,/showModal\(/);assert.match(code,/\$\('maker-map'\)\.hidden=true/);
 assert.match(code,/\$\('maker-map'\)\.hidden=false/);assert.match(code,/maker-detail-open/);
 assert.match(code,/FEANight.fitRenderedGeometry\(d3.geoAlbersUsa\(\)/);assert.doesNotMatch(code,/geoIdentity\(/);
 assert.match(code,/FEAResultsUI.comparisonColumn/);assert.doesNotMatch(html,/data-detail-tab="trends"/);
 assert.match(readFileSync('assets/election-night.js','utf8'),/GOVERNOR_NOT_UP_BY_PARTY = \{ D: 6, R: 8 \}/);
});


test('Inspect mode opens detail without painting and disabling detail restores painting',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=readFileSync('assets/map-maker.js','utf8');
 const lines=source.split('\n');
 const sliceFn=name=>{
  const start=lines.findIndex(line=>line.trim().startsWith('function '+name+'('));
  let depth=0,end=start;
  for(let i=start;i<lines.length;i++){
   depth+=(lines[i].match(/\{/g)||[]).length-(lines[i].match(/\}/g)||[]).length;
   end=i;if(i>start&&depth<=0)break;
  }
  return lines.slice(start,end+1).join('\n');
 };
 const functions=['inspectRace','setInspect','paint'].map(sliceFn).join('\n');
 const nodes=Object.fromEntries(['maker-race','board-menu','maker-menu-button','maker-detail-enabled','maker-drag'].map(id=>[id,{checked:true,setAttribute(){}}]));
 const buttons=['paint','inspect'].map(value=>({dataset:{makerInteraction:value},setAttribute(key,value){this[key]=value;}}));
 let opened=0,painted=0;const ratings={};
 const context={
  inspecting:false,selected:'',brush:'Safe Republican',paintParty:'R',outlineOnly:()=>false,
  $:id=>nodes[id],document:{querySelectorAll:()=>buttons},detail:{open(){opened++;}},
  model:{rating(id){return ratings[id]||'Tossup';},apply(entries){for(const [id,rating] of entries)ratings[id]=rating;painted++;return true;}},
  ratingForClick(current){return current==='Tossup'?'Safe Republican':current==='Safe Republican'?'Likely Republican':'Tilt Republican';},
  syncBrushUi(){},palette(){},edited(){},title:r=>r.id,status(){},renderDetailCandidates(){}
 };
 runInNewContext(functions,context);
 context.setInspect(true);context.paint({id:'senate-OH'});
 assert.equal(opened,1);assert.equal(painted,0);assert.equal(nodes['maker-drag'].disabled,true);assert.equal(buttons[1]['aria-pressed'],'true');
 context.setInspect(false);context.paint({id:'senate-OH'});assert.equal(painted,1);assert.equal(ratings['senate-OH'],'Safe Republican');assert.equal(nodes['maker-drag'].disabled,false);
 context.setInspect(true);context.paint({id:'senate-OH'});assert.equal(opened,2);assert.equal(painted,1);
 assert.match(source,/isPaintEnabled:\(\)=>!inspecting&&/);assert.doesNotMatch(source,/lastTouch|pointerType!==.touch/);
});

test('Multi-year catalogues, president EV splits, tickets, and YAPms FEA shell',()=>{
 const cycles=JSON.parse(readFileSync('data/features/map-maker/cycles.json')).cycles;
 assert.equal(cycles['2026'].nationalEditMode,'paint');
 assert.equal(cycles['2027'].nationalEditMode,'paint');
 assert.equal(cycles['2028'].nationalEditMode,'paint');
 assert.deepEqual(cycles['2027'].offices,['governor']);
 assert.equal(cycles['2027'].storageKey,'fea-map-maker-2027-v2');
 assert.equal(cycles['2028'].storageKey,'fea-map-maker-2028-v2');
 assert.equal(cycles['2027'].cities,undefined);
 const c26=JSON.parse(readFileSync('data/features/map-maker/races-2026.json'));
 const c27=JSON.parse(readFileSync('data/features/map-maker/races-2027.json'));
 const c28=JSON.parse(readFileSync('data/features/map-maker/races-2028.json'));
 assert.equal(c26.races.length,506);
 assert.equal(c27.races.length,3);
 assert.equal(c27.races.filter(r=>r.type==='governor').map(r=>r.state).sort().join(','),'KY,LA,MS');
 assert.equal(c27.races.filter(r=>r.type==='mayor').length,0);
 assert.equal(c28.races.filter(r=>r.type==='president').length,56);
 assert.ok(c28.races.some(r=>r.id==='president-ME-AL'));
 assert.ok(c28.races.some(r=>r.id==='president-ME-2'));
 assert.ok(c28.races.some(r=>r.id==='president-NE-3'));
 assert.equal(c28.races.filter(r=>r.type==='senate').length,33);
 assert.equal(Object.values(cycles['2028'].electoralVotes).reduce((n,v)=>n+v,0),538);
 assert.equal(cycles['2028'].electoralVotes['ME-AL'],2);
 assert.equal(cycles['2028'].electoralVotes['ME-1'],1);
 assert.equal(cycles['2028'].electoralVotes.ME,undefined);

 const detail=readFileSync('assets/map-maker-detail.js','utf8');
 assert.match(detail,/enterDedicatedMap/);
 assert.match(detail,/\$\('maker-map'\)\.hidden=false/);
 assert.match(detail,/Statewide presidential returns/);
 const mapUtils=readFileSync('assets/prediction-map-utils.js','utf8');
 assert.match(mapUtils,/presidentEvUnit/);
 assert.match(mapUtils,/presidentCd/);
 assert.match(mapUtils,/president-clip-/);
 assert.match(mapUtils,/prediction-split-panels/);
 assert.match(mapUtils,/ME-01/);
 assert.match(readFileSync('assets/results-ui.js','utf8'),/function historyOffice/);
 const makerJs=readFileSync('assets/map-maker.js','utf8');
 assert.match(makerJs,/ensureYapmsDefault/);
 assert.match(makerJs,/syncTicketBar/);
 assert.match(makerJs,/syncSplitEv/);
 assert.match(makerJs,/layoutYapmsRail/);
 assert.match(makerJs,/splitEvLabel/);
 assert.match(makerJs,/padStart\(2,'0'\)/);
 assert.match(makerJs,/setTickets/);
 assert.match(makerJs,/ratingForClick/);
 assert.match(makerJs,/seedDeclaredCandidates/);
 assert.match(makerJs,/Caption under the FEA badge stays fixed/);
 assert.match(readFileSync('assets/map-maker.css','utf8'),/maker-seat-badge/);
 assert.match(readFileSync('assets/map-maker.css','utf8'),/maker-ticket-bar/);
 assert.match(readFileSync('assets/map-maker.css','utf8'),/maker-split-ev/);
 assert.match(readFileSync('assets/map-maker.css','utf8'),/maker-detail-open #maker-map/);
 assert.match(readFileSync('features/map-maker/2027.html','utf8'),/map-maker\.css\?v=20261121-rebuild6/);
 assert.match(readFileSync('features/map-maker/2027.html','utf8'),/FEA_Badge\.png/);
 assert.match(readFileSync('features/map-maker/2027.html','utf8'),/YOUR SCENARIO/);
 assert.match(readFileSync('features/map-maker/2028.html','utf8'),/maker-ticket-bar/);
 assert.match(readFileSync('features/map-maker/2028.html','utf8'),/maker-split-ev/);
 assert.match(readFileSync('features/map-maker/2028.html','utf8'),/All Map Makers/);
 assert.doesNotMatch(readFileSync('features/map-maker/2028.html','utf8'),/Trump Approval/);
 assert.doesNotMatch(readFileSync('assets/prediction-map-utils.js','utf8'),/prediction-president-al-markers/);
 assert.match(readFileSync('features/map-maker/2027.html','utf8'),/data-map-cycle="2027"/);
 assert.match(readFileSync('features/map-maker/2028.html','utf8'),/data-map-cycle="2028"/);
 assert.match(readFileSync('features/map-maker.html','utf8'),/Kentucky, Louisiana, and Mississippi/);
 assert.doesNotMatch(readFileSync('features/map-maker.html','utf8'),/mayoral races/);
 assert.match(readFileSync('features/map-maker.html','utf8'),/maker-hub-grid/);
 assert.doesNotMatch(readFileSync('features/map-maker.html','utf8'),/href="\/features\/map-maker\/2026"/);
 assert.match(readFileSync('archive.html','utf8'),/map-maker\/2026/);
 assert.match(readFileSync('index.html','utf8'),/map-maker\/2028.*map-maker\/2027.*\/archive/s);
 const declared=JSON.parse(readFileSync('data/features/map-maker/declared-candidates-2027.json'));
 assert.ok(declared.races['governor-MS']?.length>=4);
 assert.equal(declared.races['mayor-chicago'],undefined);

 const model=new Scenario(c28.races,null,{
  offices:cycles['2028'].offices,
  heldSeats:cycles['2028'].heldSeats,
  electoralVotes:cycles['2028'].electoralVotes,
  defaultOffice:'president',
  schemaVersion:2
 });
 assert.deepEqual(model.electoralCounts(),{D:0,R:0,I:0,T:538});
 model.apply([['president-ME-2','Safe Democratic']]);
 assert.equal(model.electoralCounts().D,1);
 assert.equal(model.electoralCounts().T,537);
 model.apply([['president-ME-AL','Likely Democratic']]);
 assert.equal(model.electoralCounts().D,3);
 model.setTickets({D:'Josh Shapiro',R:'JD Vance'});
 assert.equal(model.ticket('D'),'Josh Shapiro');
 assert.equal(model.ticket('R'),'JD Vance');
 model.setCandidates('president-PA',[{id:'d1',name:'Dem',party:'D'},{id:'r1',name:'Rep',party:'R'}]);
 model.setWinner('president-PA','d1');
 assert.equal(model.rating('president-PA'),'Safe Democratic');
 assert.equal(model.electoralCounts().D,22);
 assert.equal(model.winnerCandidate('president-PA').name,'Dem');
 const exported=JSON.parse(JSON.stringify(model.state));
 assert.equal(exported.schemaVersion,2);
 assert.equal(exported.tickets.D,'Josh Shapiro');
 assert.deepEqual(validate(exported,c28.races,{offices:cycles['2028'].offices}).winners,{['president-PA']:'d1'});
 assert.match(readFileSync('assets/map-maker.js','utf8'),/blankBasemap:outlineOnly\(\)/);
 assert.match(readFileSync('assets/scenario-model.js','utf8'),/electoralVotesFor/);
 assert.match(readFileSync('assets/map-maker-theme.js','utf8'),/weightFn/);
});
