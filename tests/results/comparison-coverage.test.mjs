import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {normalizeDemographics} from '../../scripts/results/build-county-demographics.mjs';
import {resultRow,historicalParty} from '../../scripts/results/expand-comparisons.mjs';
const require=createRequire(import.meta.url),ui=require('../../assets/results-ui.js');
const read=p=>JSON.parse(readFileSync(p,'utf8'));
test('House county IDs use county FIPS instead of district/county composite GEOIDs; municipalities remain distinct',()=>{
 const source=readFileSync('assets/election-night.js','utf8');
 const code=source.slice(source.indexOf('function featureCountyFipsForElectionNight('),source.indexOf('\nfunction countyForFeature('));
 const context={};vm.createContext(context);vm.runInContext(code,context);
 assert.equal(context.featureCountyFipsForElectionNight({id:'4801405',properties:{GEOID:'4801405',countyFips:'48405'}}),'48405');
 assert.equal(context.featureCountyFipsForElectionNight({properties:{GEOID:'4801405',STATEFP:'48',COUNTYFP:'405'}}),'48405');
 assert.equal(context.featureCountyFipsForElectionNight({properties:{localType:'municipality',GEOID:'2300100170'}}),'2300100170');
});
test('Census district normalization preserves separate districts within the same state',()=>{
 const data=normalizeDemographics([['NAME','state','congressional district','B01003_001E','B19013_001E'],['First','01','01','750000','75000'],['Second','01','02','760000','68000']]);
 assert.equal(data['0101'].population,750000);assert.equal(data['0102'].population,760000);assert.equal(data['0102'].income,68000);assert.equal(Object.keys(data).length,2);
});
test('All 435 House Census profiles exist; changed-boundary profiles are explicitly historical and never receive a current geometry ID',()=>{
 const data=read('data/results/district-demographics.min.json'),geo=read('data/results/district-geography.json');
 assert.equal(Object.keys(data.districts).length,435);assert.equal(data.product,'ACS 1-year');assert.equal(data.congress,119);
 assert.equal(Object.values(geo.districts).filter(r=>r.currentComparable).length,435);
 for(const [id,row] of Object.entries(data.districts)) {
  assert.ok(row.population>0);
  const geography=geo.districts[id];
  // Existing IDs record hashes from both LF and CRLF checkouts.
  const lf=readFileSync(geography.geometryFile,'utf8').replaceAll('\r\n','\n');
  const checkoutHashes=[lf,lf.replaceAll('\n','\r\n')].map(text=>createHash('sha256').update(text).digest('hex'));
  assert.ok(checkoutHashes.includes(geography.sha256),`Geometry content changed for ${id}`);
  if(!geo.districts[id].historicalComparable){assert.equal(row.boundaryStatus,'historical-boundaries');assert.equal(row.geometryId,null);}
 }
 assert.equal(data.districts['TX-01'].boundaryStatus,'historical-boundaries');assert.equal(data.districts['CO-04'].boundaryStatus,'current-comparable');
});
test('All 35 Senate comparisons use the correct prior seat, including special elections and the Ossoff runoff',()=>{
 const rows=read('data/results/comparisons/senate-last-states.json').states;assert.equal(rows.length,35);
 const find=s=>rows.find(r=>r.state===s),names=s=>find(s).candidates.map(c=>c.name).join('|');
 assert.match(names('OH'),/Vance/);assert.doesNotMatch(names('OH'),/Moreno/);assert.equal(find('OH').year,2022);
 assert.match(names('FL'),/Rubio/);assert.doesNotMatch(names('FL'),/Scott/);
 assert.match(names('NE'),/Ricketts/);assert.doesNotMatch(names('NE'),/Osborn|Fischer/);
 assert.match(names('OK'),/Mullin/);assert.doesNotMatch(names('OK'),/Lankford/);
 assert.equal(find('GA').totalVotes,4484902);assert.equal(find('GA').year,2021);
 assert.equal(find('AK').candidates.find(c=>/Gross/.test(c.name)).party,'I');
 for(const row of rows)assert.equal(row.candidates.reduce((n,c)=>n+c.votes,0),row.totalVotes);
});
test('Reviewed governor returns reconcile all candidate counts and all 434 county sums to eight statewide controls',()=>{
 const data=read('data/baselines/source/reviewed-governor-returns.json');assert.equal(data.states.length,8);assert.equal(data.rows.length,434);
 for(const state of data.states) {
  const controls=data.sources.find(s=>s.state===state.state).controls,rows=data.rows.filter(r=>r.state===state.state);
  assert.equal(rows.length,controls.counties);assert.equal(state.totalVotes,controls.total);assert.equal(state.demVotes,controls.d);assert.equal(state.repVotes,controls.r);
  assert.equal(rows.reduce((n,r)=>n+r.totalVotes,0),state.totalVotes);
  for(const row of rows){assert.match(row.fips,/^\d{5}$/);assert.equal(row.candidates.reduce((n,c)=>n+c.votes,0),row.totalVotes);assert.ok(!row.candidates.some(c=>/^(under|over)\s*votes/i.test(c.name)));}
 }
});
test('Clerk fusion candidate votes are combined once, while redrawn and unopposed House comparisons remain blocked',()=>{
 const data=read('data/results/comparisons/house-2024-districts.json'),row=data.districts.find(r=>r.id==='NY-01');
 assert.equal(row.candidates.find(c=>/LaLota/.test(c.name)).votes,226285);assert.equal(row.candidates.find(c=>/Avlon/.test(c.name)).votes,183540);
 assert.equal(data.districts.find(r=>r.id==='TX-01').geographyVerified,false);assert.ok(!data.districts.some(r=>r.id==='OK-03'));
});
test('House whole-county references require explicit permission, retain scope labels, and never substitute for district-wide data',()=>{
 const source={id:'pres-2020',status:'available',appliesTo:['house'],countyCompatible:true},race={type:'house',state:'TX',district:1};
 const data=new Map([['pres-2020:county',{marginBasis:'all-votes',rows:[{fips:'48405',demVotes:10,repVotes:20,totalVotes:31}]}]]);
 assert.equal(ui.historicalSnapshot(race,source,data,'48405'),null);
 assert.equal(ui.historicalSnapshot(race,{...source,countyReferenceCompatible:true},data,'48405').scope,'whole-county-reference');
 assert.equal(ui.historicalSnapshot(race,{...source,countyReferenceCompatible:true},data),null);
});
test('Candidate lead margin handles major independents and same-party contests without using the D-R party gap',()=>{
 const lead=ui.candidateLead([{name:'Independent',party:'I',votes:55},{name:'Republican',party:'R',votes:40},{name:'Democrat',party:'D',votes:5}],100);
 assert.equal(lead.party,'I');assert.equal(lead.margin,15);
 assert.equal(ui.candidateLead([{name:'First',party:'D',votes:60},{name:'Second',party:'D',votes:30},{name:'Third',party:'R',votes:10}],100).margin,30);
 assert.equal(ui.candidateLead([{name:'First',party:'D',votes:0}],0),null);
 assert.equal(historicalParty('N(D)/D'),'I');assert.throws(()=>resultRow([{name:'Invalid',party:'R',votes:1.5}]),/Invalid/);
});
test('At-large presidential comparisons use official complete statewide denominators, including Alaska write-ins',()=>{
 for(const year of [2016,2020,2024]) {
  const data=read(`data/baselines/pres-${year}-districts.json`),states=read(`data/baselines/pres-${year}-states.json`);
  const row=data.districts.find(r=>r.id==='AK-AL'),state=states.states.find(r=>r.state==='AK');
  assert.equal(row.totalVotes,state.totalVotes);assert.equal(row.demVotes,state.demVotes);assert.equal(row.repVotes,state.repVotes);
 }
});

test('Published House comparisons actually render through the public geometry gate',()=>{
 const manifest=read('data/result-comparison-baselines.json'),geo=read('data/results/district-geography.json');
 for(const [id,count] of [['pres-2024',435],['pres-2020',262],['pres-2016',6],['house-2024',261]]) {
  const source=manifest.sources.find(s=>s.id===id),data=read(source.districtFile);
  const snapshots=Object.entries(geo.districts).filter(([key,g])=>ui.historicalSnapshot({type:'house',state:key.slice(0,2),district:key.slice(3),geometryId:g.geometryId},source,new Map([[`${id}:district`,data]])));
  assert.equal(snapshots.length,count,id);
 }
});
