import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseDirectory,parseGeneralTable,parseHouseLists} from './ballot-review.mjs';
import {genericName} from './candidate-roster.mjs';
const cache=process.argv.find(a=>a.startsWith('--cache='))?.slice(8);
if(!cache)throw Error('Supply --cache=PATH containing the downloaded public Ballotpedia pages. No forecast fallback is allowed.');
const catalogue=JSON.parse(fs.readFileSync('data/election-night-races.json'));
const stateText=fs.readFileSync('assets/election-night.js','utf8').match(/const STATE_NAMES = \{([\s\S]*?)\n\};/)[1];
const states=Object.fromEntries([...stateText.matchAll(/([A-Z]{2}): "([^"]+)"/g)].map(m=>[m[1],m[2]]));
const read=f=>fs.readFileSync(path.join(cache,f),'utf8');
const senate=parseDirectory(read('Senate.html')), governors=parseDirectory(read('governors-index.html'));
const previous=JSON.parse(fs.readFileSync('data/results/reviewed-ballots-2026.json'));
const official=previous.races.filter(r=>r.official!==false);
const officialIds=new Set([...official.map(r=>r.id),'senate-LA',...Array.from({length:6},(_,i)=>'house-LA-'+(i+1))]);
const house=new Map();
const changes=[], reviewed=[];
for(const race of catalogue.races){
 if(officialIds.has(race.id))continue;
 const state=states[race.state], slug=state.replaceAll(' ','_');
 let candidates, file, sourceUrl;
 if(race.type==='house'){
  file='house-'+slug+'.html';
  if(!house.has(slug))house.set(slug,parseHouseLists(read(file)));
  const lists=house.get(slug);
  candidates=lists.length?lists.find(r=>Number(r.district)===Number(race.district))?.candidates:parseGeneralTable(read(file),/General election for U\.S\. House[^<]*<\/h5>/i);
  sourceUrl='https://ballotpedia.org/United_States_House_of_Representatives_'+(lists.length?'elections':'election')+'_in_'+slug+',_2026';
 }else{
  const directory=race.type==='senate'?senate:governors;
  candidates=directory.get((race.type==='senate'?'U.S. Senate ':'Governor of ')+state);
  file=race.type==='senate'?'Senate.html':'governors-index.html';
  sourceUrl='https://ballotpedia.org/'+(race.type==='senate'?'United_States_Senate':'Gubernatorial')+'_elections,_2026';
  if(!candidates){
   file=race.type+'-'+slug+'.html';
   const html=read(file);
   candidates=parseGeneralTable(html,race.type==='senate'?/General election for U\.S\. Senate[^<]*<\/h5>/i:/General election for Governor[^<]*<\/h5>/i);
   sourceUrl='https://ballotpedia.org/'+(race.type==='senate'?'United_States_Senate_'+(['FL','OH'].includes(race.state)?'special_':'')+'election_in_'+slug:slug+'_gubernatorial_and_lieutenant_gubernatorial_election')+',_2026';
  }
 }
 if(!candidates?.length||candidates.some(c=>genericName(c.name)))throw Error('Missing or filler candidates: '+race.id);
 const names=new Map();
 for(const c of candidates){const key=c.name.normalize('NFKC').toLowerCase();const prior=names.get(key);if(prior)prior.partyLabels=[...new Set([...prior.partyLabels,...c.partyLabels])];else names.set(key,c);}
 candidates=[...names.values()];
 const before=race.candidates.map(c=>c.name),after=candidates.map(c=>c.name);
 if(JSON.stringify([...before].sort())!==JSON.stringify([...after].sort()))changes.push({id:race.id,before,after});
 reviewed.push({id:race.id,official:false,completeReview:true,sourceName:'Ballotpedia',sourceUrl,checkedAt:'2026-10-28',sourceSha256:createHash('sha256').update(read(file)).digest('hex'),note:'Every general-election candidate listed in this source; primary, withdrawn, and defeated candidates excluded. Official ballot certification remains separate.',candidates});
}
if(reviewed.length+officialIds.size!==506)throw Error('Coverage mismatch');
const output={electionDate:'2026-11-03',checkedAt:'2026-10-28',races:[...official,...reviewed]};
fs.writeFileSync('data/results/reviewed-ballots-2026.json',JSON.stringify(output,null,2)+'\n');
fs.writeFileSync('data/results/candidate-review-changes.json',JSON.stringify({checkedAt:output.checkedAt,scope:'All 506 board races; official Louisiana and Wyoming sources take precedence.',reviewed:reviewed.length,official:officialIds.size,changes},null,2)+'\n');
console.log({reviewed:reviewed.length,official:officialIds.size,changed:changes.length,candidates:reviewed.reduce((n,r)=>n+r.candidates.length,0)});
