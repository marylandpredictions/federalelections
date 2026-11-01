import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseDelimited} from './csv.mjs';

// Published totals checked independently; unreviewed/incomplete statewide files
// are deliberately excluded, even when all their rows parse successfully.
const controls={
 CO:{year:2022,counties:64,total:2508830,d:1468481,r:983040,url:'https://historicalelectiondata.coloradosos.gov/contest/25580'},
 IA:{year:2022,counties:99,total:1221864,d:482950,r:709198,url:'https://sos.iowa.gov/elections/pdf/2022/general/govcanvsummary.pdf'},
 NM:{year:2022,counties:33,total:712256,d:370168,r:324701,url:'https://electionresults.sos.nm.gov/resultsSW.aspx?eid=2838&map=CTY&type=SW'},
 NH:{year:2024,counties:10,total:813497,d:360149,r:436122,url:'https://gc.nh.gov/house/calendars_journals/Journals/2025/HJ%2002%20January%208%2C%202025.PDF'},
 PA:{year:2022,counties:67,total:5366179,d:3031137,r:2238477,url:'https://www.legis.state.pa.us/WU01/LI/HJ/2023/0/20230103.pdf'},
 SD:{year:2022,counties:66,total:350166,d:123148,r:217035,url:'https://uselectionatlas.org/RESULTS/state2.php?elect=0&fips=46&off=5&year=2022'},
 WI:{year:2022,counties:72,total:2656490,d:1358774,r:1268535,url:'https://ballotpedia.org/Wisconsin_gubernatorial_election,_2022'},
 WY:{year:2022,counties:23,total:194000,d:30686,r:143696,url:'https://sos.wyo.gov/Elections/Docs/2022/Results/General/2022_General_Statewide_Candidates_Summary.pdf'},
};
const demo=JSON.parse(readFileSync('data/results/county-demographics.min.json','utf8'));
const geom=JSON.parse(readFileSync('data/house-districts-119.geojson','utf8'));
const stateNames=Object.fromEntries(geom.features.map(f=>[f.properties.state,f.properties.stateName]));
const clean=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(county|parish|borough)\b/g,'').replace(/[^a-z0-9]/g,'');
const stateFips=Object.fromEntries(Object.entries(stateNames).map(([abbr,name])=>[abbr,Object.entries(demo.states).find(([,r])=>r.name===name)?.[0]]));
const party=s=>/^(dem|democrat|democratic|dfl)$/i.test(s)?'D':/^(rep|republican|r)$/i.test(s)?'R':/^(ind|independent|una|upa|i)$/i.test(s)?'I':s||'O';
const sourceIndex=JSON.parse(readFileSync('.runtime/source-audit/openelections-index.json','utf8'));
const states=[],rows=[],sources=[];
for(const [state,control] of Object.entries(controls)) {
 const file=`.runtime/source-audit/oe-${state}-${control.year}.csv`,raw=readFileSync(file);
 const records=parseDelimited(raw.toString('utf8').replace(/^\uFEFF/,''));
 const lookup=new Map(Object.entries(demo.counties).filter(([fips])=>fips.startsWith(stateFips[state])).map(([fips,r])=>[clean(r.name.split(',')[0]),fips]));
 const groups=new Map();
 for(const record of records) {
  if(!/^governor(?:$|\s+and\s+lieutenant\s+governor$)/i.test(record.office||''))continue;
  if(/^(under\s*votes?|over\s*votes?|blank|void|total)/i.test(record.candidate))continue;
  const votes=Number(record.votes);if(!Number.isSafeInteger(votes)||votes<0)throw Error(`Invalid governor votes: ${state}`);
  const fips=lookup.get(clean(record.county));if(!fips)throw Error(`Unmapped county: ${state} ${record.county}`);
  if(!groups.has(fips))groups.set(fips,new Map());const candidates=groups.get(fips);
  const name=record.candidate.trim(),key=clean(name),code=party(record.party);
  if(!candidates.has(key))candidates.set(key,{name,party:code,partyLabel:record.party,votes:0});
  candidates.get(key).votes+=votes;
 }
 if(groups.size!==control.counties)throw Error(`Incomplete governor county coverage: ${state}`);
 const all=new Map();
 for(const [fips,candidates] of groups) {
  const values=[...candidates.values()];
  rows.push({state,fips,year:control.year,baselineRace:`${control.year} Governor`,candidates:values,demVotes:values.filter(c=>c.party==='D').reduce((n,c)=>n+c.votes,0),repVotes:values.filter(c=>c.party==='R').reduce((n,c)=>n+c.votes,0),totalVotes:values.reduce((n,c)=>n+c.votes,0),valid:true});
  for(const c of values){const key=clean(c.name);if(!all.has(key))all.set(key,{...c,votes:0});all.get(key).votes+=c.votes;}
 }
 const values=[...all.values()],d=values.filter(c=>c.party==='D').reduce((n,c)=>n+c.votes,0),r=values.filter(c=>c.party==='R').reduce((n,c)=>n+c.votes,0),total=values.reduce((n,c)=>n+c.votes,0);
 if(d!==control.d||r!==control.r||total!==control.total)throw Error(`Governor controls do not reconcile: ${state}: ${d}/${r}/${total}`);
 states.push({state,year:control.year,baselineRace:`${control.year} Governor`,candidates:values,demVotes:d,repVotes:r,totalVotes:total,valid:true,sourceUrl:control.url});
 const entry=sourceIndex.find(r=>r.state===state),selected=entry.files.filter(f=>f.name.includes(control.year===2024?'20241105':'20221108')).find(f=>f.name.includes('__county.'))||entry.files.find(f=>f.name.includes('__governor__'))||entry.files.find(f=>f.name.endsWith('__precinct.csv'))||entry.files[0];
 sources.push({state,year:control.year,url:selected.url,sha256:createHash('sha256').update(raw).digest('hex'),controlUrl:control.url,controls:control});
}
writeFileSync('data/baselines/source/reviewed-governor-returns.json',JSON.stringify({source:'OpenElections historical returns; independently reconciled statewide controls',marginBasis:'all-votes',denominator:'Reported candidate votes; blank, overvote and undervote ballots excluded',sources,states,rows},null,2)+'\n');
console.log(`Reviewed governor comparisons: ${states.length} states, ${rows.length} counties. Reconciled every candidate vote to statewide controls.`);
