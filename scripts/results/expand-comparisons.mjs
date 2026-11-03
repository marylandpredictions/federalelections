import {readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseDelimited} from './csv.mjs';
import {buildPresidentialRows} from './build-presidential-comparisons.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const write=(p,data)=>{
 const bytes=JSON.stringify(data,null,2)+'\n';
 if(existsSync(p)&&readFileSync(p,'utf8')===bytes)return;
 const temp=p+`.building-${process.pid}`;
 try{writeFileSync(temp,bytes);for(let i=0;;i++){try{renameSync(temp,p);break;}catch(e){if(i===4)throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150*(i+1));}}}
 finally{if(existsSync(temp))unlinkSync(temp);}
};
export function resultRow(candidates,meta={}) {
  if(!Array.isArray(candidates)||!candidates.length)throw Error('Historical candidates missing');
  for(const c of candidates)if(!c.name||!Number.isSafeInteger(c.votes)||c.votes<0)throw Error('Invalid historical candidate votes');
  const totalVotes=candidates.reduce((n,c)=>n+c.votes,0);
  if(!totalVotes)throw Error('Historical election has no reported votes');
  const demVotes=candidates.filter(c=>c.party==='D').reduce((n,c)=>n+c.votes,0),repVotes=candidates.filter(c=>c.party==='R').reduce((n,c)=>n+c.votes,0);
  return {...meta,candidates,demVotes,repVotes,totalVotes,demShare:demVotes/totalVotes*100,repShare:repVotes/totalVotes*100,margin:(demVotes-repVotes)/totalVotes*100,valid:true};
}
export const historicalParty=label=>{
  if(/^(D|DEM|DEMOCRAT|DEMOCRATIC)$/i.test(label))return 'D';
  if(/^(R|REP|REPUBLICAN)$/i.test(label))return 'R';
  if(/^(IND|INDEPENDENT|N\(D\)(?:\/D)?|BY PETITION|UNENROLLED INDEPENDENT)$/i.test(label))return 'I';
  return 'O';
};
export function senateCandidates(state,fec2020,fec2022,clerk) {
  let rows,year=2020,label='2020 Senate';
  if(['OH','FL','OK'].includes(state)) {
    year=2022;label='2022 Senate'+(state==='OK'?' special':'');
    rows=fec2022.filter(r=>r.state===state&&(state!=='OK'||/UNEXPIRED/i.test(r.district)));
  } else if(state==='NE') {
    year=2024;label='2024 Senate special (Ricketts seat)';
    rows=clerk.filter(r=>/Ricketts|Preston Love/i.test(r.name)).map(r=>({...r,party:r.partyLabel}));
  } else rows=fec2020.filter(r=>r.state===state&&!/UNEXPIRED/i.test(r.district));
  if(state==='GA') {year=2021;label='2020 Senate runoff · January 2021';rows=rows.filter(r=>r.runoffVotes!==null).map(r=>({...r,votes:r.runoffVotes}));}
  const candidates=new Map();
  for(const r of rows) {
    const name=r.first?[r.first,r.last].filter(Boolean).join(' '):r.name;
    const key=r.id&&r.id!=='n/a'?r.id:name;
    if(!candidates.has(key))candidates.set(key,{name,party:historicalParty(r.party),partyLabel:r.party,votes:0});
    candidates.get(key).votes+=r.votes;
  }
  return resultRow([...candidates.values()],{state,year,baselineRace:label});
}
export function expandComparisons() {
 mkdirSync('data/results/comparisons',{recursive:true});
 const manifest=read('data/result-comparison-baselines.json'),geography=read('data/results/district-geography.json');
 const races=read('data/election-night-races.json').races;
 manifest.geographyFile='data/results/district-geography.json';
 const raw=parseDelimited(readFileSync('data/baselines/source/countypres_2000-2024.csv','utf8'));
 const countyGeo=read('data/result-counties.geojson');const fips=new Set(countyGeo.features.map(f=>f.properties.GEOID));
 const countySource={source:'MIT Election Data and Science Lab county presidential returns',sourceUrl:'https://doi.org/10.7910/DVN/VOQCHQ',marginBasis:'all-votes',aggregation:'TOTAL rows take priority over ballot-mode components. Invalid rows, unmatched FIPS and Alaska legislative districts are excluded.'};
 for(const year of [2016,2020]) {
  const official=read(`data/baselines/source/fec-president-${year}-states.json`);
  const controls=official.states.reduce((a,r)=>{for(const k of ['demVotes','repVotes','totalVotes'])a[k]+=r[k];return a;},{demVotes:0,repVotes:0,totalVotes:0});
  if(official.states.length!==51||Object.keys(controls).some(k=>controls[k]!==official.controls[k]))throw Error('FEC control mismatch');
  write(`data/baselines/pres-${year}-states.json`,{...official,invalid:[],states:official.states.map(r=>({...r,demShare:r.demVotes/r.totalVotes*100,repShare:r.repVotes/r.totalVotes*100,margin:(r.demVotes-r.repVotes)/r.totalVotes*100}))});
  const built=buildPresidentialRows(raw,year,fips);
  write(`data/baselines/pres-${year}-counties.json`,{...countySource,year,invalid:built.invalid,rows:built.rows});
  let source=manifest.sources.find(s=>s.id===`pres-${year}`);
  if(!source){source={id:`pres-${year}`,label:`${year} presidential shift`};manifest.sources.splice(manifest.sources.findIndex(s=>s.id==='house-2024'),0,source);}
  Object.assign(source,{status:'available',candidateLabels:year===2020?{D:'Joe Biden',R:'Donald J. Trump'}:{D:'Hillary Clinton',R:'Donald J. Trump'},appliesTo:['senate','governor','house'],countyCompatible:true,countyReferenceCompatible:true,stateFile:`data/baselines/pres-${year}-states.json`,countyFile:`data/baselines/pres-${year}-counties.json`,marginBasis:'all-votes',sourceUrls:[official.sourceUrl,countySource.sourceUrl]});
  delete source.unavailableReason;
 }
 const csv=readFileSync('data/baselines/source/downballot-presidential-2026.csv','utf8');
 const districtRows=parseDelimited('district,incumbent,party,unused,d2024,r2024,total2024,ds,rs,margin,unused2,d2020,r2020,total2020,ds20,rs20,margin20\n'+csv.split(/\r?\n/).slice(4).join('\n'));
 const districtSource={source:'The Downballot, published presidential results on 2026 district lines',sourceUrl:'https://docs.google.com/spreadsheets/d/1eZfaFI-c-PFOoKx1-zZA2MP0_dxRq_LVK0re3BOQqy0/edit?gid=1491069057',sourceSha256:createHash('sha256').update(csv).digest('hex'),marginBasis:'all-votes'};
 const number=s=>Number(String(s||'').replace(/,/g,''));
 for(const year of [2016,2020,2024]) {
  const districts=[];
  const official=read(`data/baselines/pres-${year}-states.json`);
  for(const r of districtRows) {
   const geo=geography.districts[r.district],atLarge=r.district.endsWith('-AL')?official.states.find(s=>s.state===r.district.slice(0,2)):null;
   if(!geo||(!atLarge&&!r[`total${year}`]))continue;
   const d=atLarge?.demVotes??number(r[`d${year}`]),rep=atLarge?.repVotes??number(r[`r${year}`]),total=atLarge?.totalVotes??number(r[`total${year}`]);
   if(![d,rep,total].every(Number.isSafeInteger)||total<=0||d<0||rep<0||d+rep>total)throw Error('Malformed district presidential totals');
   districts.push({id:r.district,state:r.district.slice(0,2),year,demVotes:d,repVotes:rep,totalVotes:total,geographyVerified:(year===2024&&districtSource.sourceSha256===geography.presidential2024Verification?.sourceSha256) || (geo.historicalComparable ?? geo.currentComparable),geometryId:geo.geometryId,valid:true,...(atLarge?{sourceNote:'At-large district equals the state; official FEC statewide total, including write-ins.'}:{})});
  }
  write(`data/baselines/pres-${year}-districts.json`,{...districtSource,...(year===2016?{source:'Official FEC statewide returns for at-large congressional districts',sourceUrl:official.sourceUrl}:{}),year,districts});
  const s=manifest.sources.find(s=>s.id===`pres-${year}`);s.appliesTo=['senate','governor','house'];s.districtFile=`data/baselines/pres-${year}-districts.json`;s.countyReferenceCompatible=true;
  delete s.districtUnavailableReason;
 }
 const clerk=read('data/baselines/source/clerk-2024-candidates.json');
 if(clerk.unparsed.length)throw Error('Unresolved Clerk candidate parsing issues');
 const house=[];
 for(const [id,geo] of Object.entries(geography.districts)) {
  const rows=clerk.house[id];
  if(!rows?.length) {if(!['FL-20','OK-03'].includes(id))throw Error(`Unexpected missing Clerk race ${id}`);continue;}
  const candidates=rows.map(r=>({name:r.name,party:historicalParty(r.partyLabel),partyLabel:r.partyLabel,votes:r.votes}));
  house.push(resultRow(candidates,{id,state:id.slice(0,2),year:2024,baselineRace:`2024 House${id==='AK-AL'?' · First-choice votes':id==='ME-02'?' · Final ranked-choice round':''}`,round:id==='AK-AL'?'first-choice':id==='ME-02'?'final-ranked-choice':'general',geographyVerified:geo.historicalComparable ?? geo.currentComparable,geometryId:geo.geometryId}));
 }
 write('data/results/comparisons/house-2024-districts.json',{source:clerk.source.authority,sourceUrl:clerk.source.url,marginBasis:'all-votes',districts:house});
 const houseSource=manifest.sources.find(s=>s.id==='house-2024');Object.assign(houseSource,{status:'available',districtFile:'data/results/comparisons/house-2024-districts.json',marginBasis:'all-votes',sourceUrls:[clerk.source.url]});delete houseSource.unavailableReason;
 const fec2020=read('data/baselines/source/fec-senate-2020-rows.json'),fec2022=read('data/baselines/source/fec-senate-2022-special-seats.json');
 const senate=races.filter(r=>r.type==='senate').map(r=>senateCandidates(r.state,fec2020.rows,fec2022.rows,clerk.senate.NE));
 write('data/results/comparisons/senate-last-states.json',{source:'FEC official 2020/2022 returns; Clerk official 2024 returns for the Ricketts seat',sourceUrls:[fec2020.source,fec2022.source,clerk.source.url],marginBasis:'all-votes',states:senate});
 const senateSource=manifest.sources.find(s=>s.id==='senate-last');Object.assign(senateSource,{status:'available',stateFile:'data/results/comparisons/senate-last-states.json',marginBasis:'all-votes',sourceNotes:['Same-seat comparisons: OH/FL 2022 regular, OK 2022 special, NE 2024 Ricketts special, GA January 2021 Ossoff runoff; other seats 2020. Independents retain their source identities.']});delete senateSource.unavailableReason;
 const governor=read('data/baselines/source/reviewed-governor-returns.json');
 write('data/results/comparisons/governor-last-states.json',{...governor,rows:undefined});write('data/results/comparisons/governor-last-counties.json',{...governor,states:undefined});
 const govSource=manifest.sources.find(s=>s.id==='governor-last');Object.assign(govSource,{status:'available',stateFile:'data/results/comparisons/governor-last-states.json',countyCompatible:true,countyFile:'data/results/comparisons/governor-last-counties.json',marginBasis:'all-votes',sourceNotes:['Partial coverage only. Eight states and 434 counties reconcile to independently checked statewide candidate-vote controls. Other states remain unavailable; no forecast-derived vote totals.'],sourceUrls:governor.sources.map(s=>s.controlUrl)});delete govSource.unavailableReason;
 write('data/result-comparison-baselines.json',manifest);
 const coverage={builtAt:new Date().toISOString(),races:506,senate:{total:senate.length,covered:senate.length},governor:{total:36,covered:governor.states.length,countyRows:governor.rows.length,missing:races.filter(r=>r.type==='governor'&&!governor.states.some(s=>s.state===r.state)).map(r=>r.state)},house:{total:435,currentComparable:Object.values(geography.districts).filter(r=>r.currentComparable).length,boundaryReview:geography.reviewRequiredStates,house2024:house.filter(r=>r.geographyVerified).length,pres2024:read('data/baselines/pres-2024-districts.json').districts.filter(r=>r.geographyVerified).length,pres2020:read('data/baselines/pres-2020-districts.json').districts.filter(r=>r.geographyVerified).length},presidential:manifest.sources.filter(s=>s.id.startsWith('pres-')).map(s=>({id:s.id,states:read(s.stateFile).states.length,counties:read(s.countyFile).rows.length})),limitations:['House county references are whole-county returns, never split-county vote estimates.','Alaska county-equivalent and municipal histories require an exact reporting-unit source; no arbitrary spatial assignment.','2026 redrawn districts are blocked from current-map comparisons until displayed geometry is verified.']};
 write('data/results/comparison-coverage.json',coverage);console.log(JSON.stringify(coverage,null,2));return coverage;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)expandComparisons();
