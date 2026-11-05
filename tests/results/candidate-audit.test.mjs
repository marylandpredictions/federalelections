import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {genericName} from '../../scripts/results/candidate-roster.mjs';
import {reviewPublicRoster} from '../../scripts/results/public-roster-audit.mjs';
import {parseHouseLists,parseDirectory,parseGeneralTable} from '../../scripts/results/ballot-review.mjs';
const read=p=>JSON.parse(readFileSync(p));
const desk=createRequire(import.meta.url)('../../assets/results-desk.js');
test('Saved summary and detail records agree on candidates, votes and calls at the same version',()=>{
 const catalogue=new Map(read('data/election-night-races.json').races.map(r=>[r.id,r]));
 const snapshot=read('data/live-results.json').groups.flatMap(g=>g.races);
 assert.equal(snapshot.length,506);
 for(const row of snapshot){
  assert.ok(catalogue.has(row.id),row.id);
  const detail=read('data/live-results-races/'+row.id+'.json');
  assert.equal(detail.id,row.id);
  for(const record of [row,detail]) assert.ok(record.candidates.every(c=>!genericName(c.name)&&!c.placeholder),row.id);
  assert.equal(row.detailVersion,detail.detailVersion,row.id);
  assert.deepEqual(row.candidates,detail.candidates,row.id);
  assert.deepEqual(row.calls,detail.calls,row.id);
 }
});
test('Mapped NBC omissions, proven aliases and aggregate write-ins preserve reported votes',()=>{
 const sourceUrl='https://www.nbcnews.com/test';
 const base={id:'house-XX-1',type:'house',state:'XX',candidates:[
  {name:'Ada Example',aliases:['Ada E. Example'],party:'D'},{name:'Bob Example',party:'R'}
 ]};
 const config={sources:[{format:'nbc-national-v2',url:sourceUrl,races:[{feaRaceId:base.id,providerRaceId:'0101'}]}]};
 const row={...base,sourceUrl,provider:'NBC',providerScope:'national',providerRaceId:'0101',
  electionDate:'2026-11-03',lastUpdated:'2026-11-04T04:00:00Z',status:'uncalled',calls:[],candidates:[
   {id:'a',name:'Ada E. Example',party:'D',votes:70},{id:'w',name:'Total Write-ins',party:'O',votes:12}
 ]};
 const check=(overrides)=>reviewPublicRoster(base,{...row,...overrides},config);
 assert.deepEqual(check({}).issues,[]);
 assert.deepEqual(check({}).differences.map(d=>d.kind),['verified-alias','provider-write-in-aggregate','not-reported-by-provider']);
 assert.deepEqual(check({}).reported.map(c=>c.votes),[70,12]);
 assert.ok(check({sourceUrl:'https://example.com/invalid'}).issues.length);
 for(const change of [{votes:-1},{party:'R'},{name:'Unknown Person'},{isWinner:true}])
  assert.ok(check({candidates:[{...row.candidates[0],...change},row.candidates[1]]}).issues.length);
 assert.ok(check({status:'called',calls:[{candidate:'Unknown Person',status:'projected',calledAt:row.lastUpdated}]}).issues.length);
 assert.ok(check({candidates:[...row.candidates,{...row.candidates[0],id:'other'}]}).issues.some(i=>i.includes('Duplicate reviewed identity')));
});
test('All 506 public races exactly retain every reviewed named candidate, with no filler or missing roster',()=>{
 const catalogue=read('data/election-night-races.json'), reviewed=read('data/results/reviewed-ballots-2026.json'), la=read('data/results/louisiana-ballot-2026.json');
 const sources=new Map([...reviewed.races,...la.races].map(r=>[r.id,r]));
 assert.equal(catalogue.races.length,506);
 assert.equal(sources.size,506);
 for(const race of catalogue.races){
  assert.ok(race.rosterReviewed,race.id);
  assert.equal(race.rosterIncomplete,false,race.id);
  assert.ok(race.candidates.length,race.id);
  assert.deepEqual(race.candidates.map(c=>c.name).sort(),sources.get(race.id).candidates.map(c=>c.name).sort(),race.id);
  for(const c of race.candidates){assert.ok(!genericName(c.name)&&!c.placeholder,race.id+': '+c.name);assert.equal(c.votes,0);assert.equal(c.isWinner,false);}
 }
 for(const text of ['independent longshot, caucus not credited','Gentner Drummond / Mike Mazzei runoff','Dakarai Larriett / Everett Wess runoff','Candidate A','Democratic nominee'])assert.ok(genericName(text),text);
});
test('Prominent independents survive compact summaries while every minor candidate remains in detail data',()=>{
 const all=read('data/election-night-races.json').races;
 for(const [id,name]of[['senate-SD','Brian Bengs'],['senate-ID','Todd Achilles'],['senate-MT','Seth Bodnar'],['senate-NE','Dan Osborn']]){
  const race=all.find(r=>r.id===id), summary=desk.summaryCandidates(race);
  assert.ok(summary.some(c=>c.name===name),id);
  assert.ok(race.candidates.find(c=>c.name===name).summaryVisible);
  assert.ok(summary.every(c=>['D','R'].includes(c.party)||c.summaryVisible));
 }
 const mt=all.find(r=>r.id==='senate-MT');
 assert.ok(mt.candidates.some(c=>c.name==='Kyle Austin'));
 assert.ok(!desk.summaryCandidates(mt).some(c=>c.name==='Kyle Austin'));
 const county=mt.candidates.map((c,i)=>({...c,id:'provider-'+i,summaryVisible:undefined,votes:c.name==='Kyle Austin'?100:0}));
 const active=desk.summaryCandidates(mt,county);
 assert.ok(active.some(c=>c.name==='Seth Bodnar'));
 assert.ok(active.some(c=>c.name==='Kyle Austin'));
});
test('General-election parsers exclude primary/withdrawn rows and preserve write-ins, fusion parties and quoted names',()=>{
 const cell=(name,status)=>`<tr><td data-cell="candidate"><div class="widget-candidate-info"><a>${name}</a></div></td><td data-cell="party">Democratic, Working Families Party</td><td data-cell="office">Governor of Test</td><td data-cell="status">${status}</td></tr>`;
 const rows=parseDirectory(cell('Named Nominee','On the Ballot General')+cell('Declared Writer','Candidacy Declared (Write-in) General')+cell('Lost Person','Lost Primary')+cell('Withdrawn Person','Withdrew General'));
 assert.deepEqual(rows.get('Governor of Test').map(c=>c.name),['Named Nominee','Declared Writer']);
 assert.equal(rows.get('Governor of Test')[0].party,'D');
 assert.equal(rows.get('Governor of Test')[1].writeIn,true);
 assert.match(rows.get('Governor of Test')[1].ballotStatus,/registration not verified/);
 const html='<h3>District 1</h3>General election candidates<ul><li><a>Caleb &quot;With a C&quot; Walker</a> (Democratic Party)</li><li><a>Named Writer</a> (Independent) (Write-in)</li></ul>Democratic primary candidates<ul><li><a>Defeated Person</a> (Democratic Party)</li></ul>';
 assert.equal(parseHouseLists(html)[0].candidates.length,2);
 assert.equal(parseHouseLists(html)[0].candidates[0].name,'Caleb "With a C" Walker');
 assert.throws(()=>parseGeneralTable('Republican primary table only',/General election for Governor/));
});
