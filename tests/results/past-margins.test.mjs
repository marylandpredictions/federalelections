import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ui = require('../../assets/results-ui.js');
const themes = require('../../assets/desk-theme.js');
const source = {id:'pres-2024', label:'2024 presidential shift', status:'available', appliesTo:['senate','house'], countyCompatible:true};
const state = {marginBasis:'all-votes', states:[{state:'OH',demVotes:55,repVotes:40,totalVotes:100}]};
test('Past margins identify the historical election and calculate an all-vote margin', () => {
  const rows = ui.pastMargins({type:'senate',state:'OH'},[source],new Map([['pres-2024:state',state]]));
  assert.deepEqual(rows,[{id:'pres-2024',label:'2024 presidential margin',margin:15}]);
});
test('Past margins stay blank for unverified, redrawn or absent House geography, never using statewide returns', () => {
  const race = {type:'house',state:'OH',district:1,geometryId:'current'};
  const district = {marginBasis:'all-votes',districts:[{id:'OH-01',geometryId:'old',geographyVerified:true,demVotes:60,repVotes:40,totalVotes:100}]};
  const data = new Map([['pres-2024:state',state],['pres-2024:district',district]]);
  assert.equal(ui.pastMargins(race,[source],data)[0].margin,null);
  district.districts[0].geometryId='current';
  assert.equal(ui.pastMargins(race,[source],data)[0].margin,20);
  district.districts[0].geographyVerified=false;
  assert.equal(ui.pastMargins(race,[source],data)[0].margin,null);
});
test('Locked counties require one exact valid local match, without state or House fallback', () => {
  const data = new Map([['pres-2024:state',state],['pres-2024:county',{marginBasis:'all-votes',rows:[{fips:'39001',demVotes:30,repVotes:65,totalVotes:100}]}]]);
  const race = {type:'senate',state:'OH'};
  assert.equal(ui.pastMargins(race,[source],data,'39001')[0].margin,-35);
  assert.equal(ui.pastMargins(race,[source],data,'39003')[0].margin,null);
  assert.equal(ui.pastMargins({...race,type:'house'},[source],data,'39001')[0].margin,null);
  data.get('pres-2024:county').rows.push({...data.get('pres-2024:county').rows[0]});
  assert.equal(ui.pastMargins(race,[source],data,'39001')[0].margin,null);
});
test('Unavailable comparisons remain blank even if a historical dataset exists', () => {
  assert.equal(ui.pastMargins({type:'senate',state:'OH'},[{...source,status:'unavailable'}],new Map([['pres-2024:state',state]]))[0].margin,null);
});
test('Historical columns use raw all-vote totals, named source candidates and separate other votes',()=>{
  const named={...source,candidateLabels:{D:'Past Democrat',R:'Past Republican'}};
  const snapshot=ui.historicalSnapshot({type:'senate',state:'OH'},named,new Map([['pres-2024:state',state]]));
  assert.equal(snapshot.total,100); assert.equal(snapshot.margin,15);
  assert.deepEqual(snapshot.candidates,[{name:'Past Democrat',party:'D',votes:55},{name:'Past Republican',party:'R',votes:40},{name:'Other votes',party:'O',votes:5}]);
  assert.equal(ui.historicalSnapshot({type:'house',state:'OH',district:1,geometryId:'redrawn'},named,new Map([['pres-2024:state',state]])),null);
  assert.equal(ui.historicalSnapshot({type:'senate',state:'OH'},{...named,status:'unavailable'},new Map([['pres-2024:state',state]])),null);
});
test('Historical map lens leaves live votes/calls unchanged and returns to the existing live colors',()=>{
  function Page(){}
  Page.prototype.comparisonColorForRace=()=> 'live-race';
  Page.prototype.comparisonColorForCounty=()=> 'live-county';
  const context={window:{},FEADeskTheme:themes,FEAResultsUI:ui};
  vm.createContext(context);vm.runInContext(readFileSync(new URL('../../assets/desk-experience.js',import.meta.url),'utf8'),context);
  context.window.FEACompleteBoard(Page);
  const page=new Page(),race={type:'senate',state:'OH',candidates:[{name:'Current',party:'R',votes:70}],calls:[{candidate:'Current',provider:'NBC'}]};
  page.comparisonManifest={sources:[source]};page.comparisonData=new Map([['pres-2024:state',state]]);
  const before=JSON.stringify(race);
  assert.equal(page.comparisonColorForRace(race),'live-race');
  page.pastMapSource='pres-2024';
  assert.notEqual(page.comparisonColorForRace(race),'live-race');
  assert.equal(JSON.stringify(race),before);
  assert.equal(page.historicalMapColor({...race,type:'house',district:1}),themes.resolved.tokens['map-neutral']);
  page.pastMapSource=null;assert.equal(page.comparisonColorForRace(race),'live-race');
});
test('Closing a race and switching office clear the temporary historical lens and comparison layout',()=>{
  function Page(){}
  Page.prototype.clearFocus=function(){this.currentRace=null;return 'closed';};
  Page.prototype.switchMode=function(mode){this.selectedMode=mode;this.currentRace=null;return 'switched';};
  const removed=[];
  const context={window:{},document:{body:{classList:{remove:c=>removed.push(c)}}},FEADeskTheme:themes,FEAResultsUI:ui};
  vm.createContext(context);vm.runInContext(readFileSync(new URL('../../assets/desk-experience.js',import.meta.url),'utf8'),context);
  context.window.FEACompleteBoard(Page);
  const page=new Page();page.pastMapSource='pres-2024';page.pastMarginRace='senate-OH';page.currentRace={id:'senate-OH'};page.selectedMode='senate';
  page.setHistoricalMap=function(id){this.pastMapSource=id;};
  page.renderPresentationShell=function(){this.shellRace=this.currentRace;};
  assert.equal(page.clearFocus(),'closed');assert.equal(page.pastMapSource,null);assert.equal(page.pastMarginRace,null);assert.equal(page.shellRace,null);
  page.pastMapSource='pres-2024';page.pastMarginRace='senate-OH';page.pastColumnIds=['pres-2024'];
  assert.equal(page.switchMode('house'),'switched');assert.equal(page.pastMapSource,null);assert.equal(page.pastColumnIds,null);
  assert.equal(page.selectedMode,'house');assert.ok(removed.includes('has-history-comparison'));
});
test('Historical map restores the prior lens on close, while the explicit 2026 button selects live results',async()=>{
  function Page(){}
  const writes=[];
  const context={window:{},document:{getElementById:()=>null,body:{classList:{toggle(){}}}},localStorage:{setItem:(k,v)=>writes.push([k,v])},FEADeskTheme:themes,FEAResultsUI:ui};
  vm.createContext(context);vm.runInContext(readFileSync(new URL('../../assets/desk-experience.js',import.meta.url),'utf8'),context);
  context.window.FEACompleteBoard(Page);
  const page=new Page(),race={id:'senate-OH',type:'senate',state:'OH'};
  Object.assign(page,{currentRace:race,dataByMode:{senate:[race]},comparisonMode:'pres-2024',comparisonManifest:{sources:[source]},comparisonData:new Map([['pres-2024:state',state]])});
  for(const method of ['reflectHistoricalLens','hideTooltip','updateMapFills','renderPastMargins'])page[method]=()=>{};
  await page.setHistoricalMap('pres-2024');assert.equal(page.pastMapSource,'pres-2024');
  await page.setHistoricalMap(null);assert.equal(page.pastMapSource,null);assert.equal(page.comparisonMode,'pres-2024');
  await page.setHistoricalMap('pres-2024');await page.setHistoricalMap('');
  assert.equal(page.comparisonMode,'live');assert.equal(page.pastMapSource,null);assert.deepEqual(writes.at(-1),['electionNightComparison','live']);
});
test('Appearance profiles migrate old presets and survive custom duplication, export and local restore', () => {
  for (const [id,profile] of [['nbc-big-board','broadcast'],['nyt-results','editorial'],['fea-light','standard'],['high-contrast','contrast'],['california-inspired','studio']]) {
    const preset = themes.presets.find(p=>p.id===id);
    const legacy = {...preset}; delete legacy.presentation;
    assert.equal(themes.validate(legacy).presentation,profile);
    const custom = themes.validate({...preset,id:'custom-copy'});
    const storage = {getItem:()=>JSON.stringify({schemaVersion:1,current:custom,saved:[custom]})};
    assert.equal(themes.read(storage).current.presentation,profile);
    assert.equal(themes.validate(JSON.parse(JSON.stringify(custom))).presentation,profile);
  }
  assert.throws(()=>themes.validate({...themes.presets[0],presentation:'url(evil)'}),/appearance style/);
});
