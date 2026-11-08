// Offline cross-office transfer check using dated, checksum-verified NYT
// captures. No forecast/model parameters are fitted using these outcomes.
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {parseDelimited} from './csv.mjs';
import {matchBallotCandidate} from './candidate-roster.mjs';

const [root,office='senate',houseManifestPath,captureDirectory,outputPath]=process.argv.slice(2);
if(!root||!['senate','governor','house'].includes(office))throw Error('Usage: probability-senate-county-frames.mjs <capture directory> [senate|governor|house]');
const manifest=JSON.parse(await readFile(join(root,'probability-external-capture-manifest.json'),'utf8'));
const entries=new Map(Object.entries(manifest.holdout));
for(const [state,code] of Object.entries({arizona:'az',nevada:'nv',ohio:'oh',pennsylvania:'pa',wisconsin:'wi'})){
  const entry=manifest['2022']?.[state+'-us-senate'];
  if(entry&&!entries.has('2022-'+code+'-senate'))entries.set('2022-'+code+'-senate',entry);
}
entries.set('2022-az-governor',manifest['2022']['arizona-governor']);
if(office==='house'){
  for(const capture of JSON.parse(await readFile(houseManifestPath||'data/results/probability-house-capture-manifest.json','utf8')))
    entries.set(capture.file.replace(/\.body$/,''),{url:capture.source,captures:[[capture.at,capture.sha256]]});
}
const baseline=JSON.parse(await readFile('data/baselines/pres-2020-counties.json','utf8'));
const expected=new Map();
for(const row of baseline.rows.filter(row=>row.valid)){
  if(!expected.has(row.state))expected.set(row.state,new Set());
  expected.get(row.state).add(row.fips);
}
const certifiedPath=office==='house'?'data/baselines/source/1976-2024-house.tab':'data/baselines/source/1976-2024-senate-state.tab';
const certified=await readFile(certifiedPath);
// Aggregate fusion ballot lines by candidate identity before matching. Party
// labels in the historical file can misclassify a candidate or include several
// write-ins from one party, so party alone never selects the final control.
const truth=new Map();
const reviewedAliases={
  'MICHAEL V LAWLER':{aliases:['Mike Lawler'],source:'https://lawler.house.gov/about/'},
};
for(const row of parseDelimited(certified.toString('utf8'),office==='house'?',':'\t')){
  if(!['2022','2024'].includes(row.year)||!/^gen$/i.test(row.stage)||!/^false$/i.test(row.special)||
      !/^false$/i.test(row.unofficial)||!/^total$/i.test(row.mode))continue;
  const key=row.year+'-'+row.state_po+(office==='house'?'-'+(Number(row.district)||1):''),contest=truth.get(key)||{total:Number(row.totalvotes),ballot:new Map()};
  const count=Number(row.candidatevotes);
  if(!row.candidatevotes||!Number.isSafeInteger(count)||count<0||contest.total!==Number(row.totalvotes))contest.invalid=true;
  // The FEC/MEDSL file uses both FIRST LAST and LAST, FIRST forms.
  const name=row.candidate.replace(/^([^,]+),\s*(.+)$/,'$2 $1').trim();
  if(/^(?:over(?:\s*votes?)?|under(?:\s*votes?)?|blank(?:\s*votes?)?|void(?:\s*votes?)?)$/i.test(name)){
    contest.invalidBallotVotes=(contest.invalidBallotVotes||0)+count;
    truth.set(key,contest);continue;
  }
  contest.ballot.set(name,(contest.ballot.get(name)||0)+count);
  truth.set(key,contest);
}
if(office==='governor'){
  truth.clear();
  const transcription=await readFile(join(root,'probability-certified-governor-transcription.csv'));
  if(createHash('sha256').update(transcription).digest('hex')!=='22ff0589b8ccc4c1c6f6f8c20ea5099d20fa044c696db9392823d59ead1364dc')
    throw Error('Governor transcription checksum mismatch');
  for(const row of parseDelimited(transcription.toString('utf8'))){
    if(!['2022','2024'].includes(row.cycle)||row.stage!=='general'||row.special!=='false'||row.ranked_choice_round||
      !/^https:\/\/[^/]+\.gov\//.test(row.source)||/^(?:overvotes?|undervotes?|void|blank)$/i.test(row.alt_result_text.trim()))continue;
    const key=row.cycle+'-'+row.state_abbrev,contest=truth.get(key)||{ballot:new Map(),total:0};
    const count=Number(row.votes);
    if(!row.candidate_name||!row.votes||!Number.isSafeInteger(count)||count<0)contest.invalid=true;
    contest.ballot.set(row.candidate_name,(contest.ballot.get(row.candidate_name)||0)+count);
    contest.total+=count;
    truth.set(key,contest);
  }
  const controls=JSON.parse(await readFile('data/results/comparisons/governor-last-states.json','utf8'));
  for(const row of controls.states){
    if(!row.valid||![2022,2024].includes(row.year)||!/^https:\/\/[^/]+\.gov\//.test(row.sourceUrl))continue;
    const ballot=new Map(row.candidates.map(c=>[c.name.split(/\s+\/\s+|\s+and\s+/i)[0],c.votes]));
    if(ballot.size!==row.candidates.length)continue;
    truth.set(row.year+'-'+row.state,{total:row.totalVotes,ballot});
  }
}
const excluded=new Set(['AK','CT','MA','ME','NH','RI','VT']);
const finalGeography=office==='house'?JSON.parse(await readFile('data/results/probability-nyt2022-manifest.json','utf8')):[];
const frames=[],quarantined=[];
for(const file of (await readdir(captureDirectory||join(root,'probability-turnout-captures'))).sort()){
  const match=new RegExp(`^((2022|2024)-([a-z]{2})-${office}(?:-([1-9]\\d?))?)(\\.next)?\\.body$`).exec(file);
  if(!match)continue;
  const [,id,cycle,postal,districtToken,next]=match,year=Number(cycle),state=postal.toUpperCase(),district=Number(districtToken||1);
  try{
    if(excluded.has(state))throw Error('Reporting geography outside county model');
    const entry=entries.get(id);
    if(!entry)throw Error('No capture provenance');
    const bytes=await readFile(join(captureDirectory||join(root,'probability-turnout-captures'),file));
    const raw=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes):bytes;
    const sha256=createHash('sha256').update(raw).digest('hex');
    const index=entry.captures.findIndex(([,digest])=>digest===sha256);
    if(index<0||next&&index!==1||!next&&year===2022&&index!==0)throw Error('Unexpected capture checksum or capture order');
    const at=entry.captures[index][0].replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,'$1-$2-$3T$4:$5:$6Z');
    const data=JSON.parse(raw),races=data.races?.filter(r=>r.office_id===({senate:'S',governor:'G',house:'H'}[office])&&r.election_date===`${year}-11-${year===2022?'08':'05'}`&&r.type==='General');
    if(races?.length!==1)throw Error('Wrong election or ambiguous Senate contest');
    const race=races[0],metadata=race.candidate_metadata;
    if(office==='house'&&Number(race.seat_number)!==district)throw Error('Wrong House district in captured response');
    const controls=race.reporting_units.filter(unit=>unit.level==='state');
    if(controls.length!==1||controls[0].state_postal!==state||!(Date.parse(race.updated_at)<=Date.parse(at)))throw Error('Invalid state identity or timestamp');
    const byParty=party=>Object.values(metadata).filter(candidate=>candidate.party?.nyt_id===party);
    const ds=byParty('DEM'),rs=byParty('GOP'),contest=truth.get(year+'-'+state+(office==='house'?'-'+district:''));
    if(ds.length!==1||rs.length!==1||!contest||contest.invalid||
      [...contest.ballot.values()].reduce((sum,v)=>sum+v,0)+(contest.invalidBallotVotes||0)!==contest.total)throw Error('No reconciled certified ballot control');
    const named=candidate=>matchBallotCandidate({name:[candidate.first_name,candidate.last_name,candidate.suffix].filter(Boolean).join(' ')},
      [...contest.ballot.keys()].map(name=>({name,...(reviewedAliases[name]?{aliases:reviewedAliases[name].aliases}:{})}))).name;
    const dn=named(ds[0]),rn=named(rs[0]),actual={d:contest.ballot.get(dn),r:contest.ballot.get(rn),total:contest.total-(contest.invalidBallotVotes||0)};
    if(dn===rn||Math.max(actual.d,actual.r)<=Math.max(...[...contest.ballot].filter(([name])=>name!==dn&&name!==rn).map(([,count])=>count),0))
      throw Error('Final winner outside named D/R comparison');
    const parse=unit=>{
      const candidates=unit.candidates;
      if(!Array.isArray(candidates)||new Set(candidates.map(c=>c.nyt_id)).size!==candidates.length||candidates.some(c=>
        !metadata[c.nyt_id]||!Number.isSafeInteger(c.votes?.total)||c.votes.total<0)||
        candidates.reduce((sum,c)=>sum+c.votes.total,0)!==unit.total_votes)throw Error('Malformed full-ballot unit counts');
      const candidateVotes=id=>candidates.find(c=>c.nyt_id===id)?.votes.total??(unit.total_votes===0?0:NaN);
      const d=candidateVotes(ds[0].nyt_id),r=candidateVotes(rs[0].nyt_id);
      if(!Number.isSafeInteger(d)||!Number.isSafeInteger(r))throw Error('Missing named candidate');
      return {d,r,total:unit.total_votes,reported:unit.eevp??null};
    };
    const units=race.reporting_units.filter(unit=>unit.level==='county').map(unit=>{
      if(!/^\d{2}$/.test(unit.fips_state)||!/^\d{3}$/.test(unit.fips_county)||unit.fips_suffix)throw Error('Invalid county identifier');
      return {fips:unit.fips_state+unit.fips_county,...parse(unit)};
    });
    const ids=new Set(units.map(unit=>unit.fips));
    let required=expected.get(state),historicalPriors;
    if(office==='house'&&!['DE','WY'].includes(state)){
      const geographyMeta=finalGeography.find(row=>row.source===entry.url);
      if(!geographyMeta)throw Error('No checked historical district geography');
      const geographyBytes=await readFile(join(root,geographyMeta.file));
      if(createHash('sha256').update(geographyBytes).digest('hex')!==geographyMeta.sha256)throw Error('District geography checksum mismatch');
      const finalRace=JSON.parse(geographyBytes).races.filter(r=>r.office_id==='H'&&Number(r.seat_number)===district&&r.election_date==='2022-11-08');
      if(finalRace.length!==1)throw Error('Ambiguous district geography control');
      // Only identifiers enter from the later geography control. Historical
      // prior values below come exclusively from the dated partial capture.
      required=new Set(finalRace[0].reporting_units.filter(u=>u.level==='county').map(u=>u.fips_state+u.fips_county));
      historicalPriors={};
      for(const unit of race.reporting_units.filter(u=>u.level==='county')){
        const h=unit.historical_2020_pres;
        if(!h||!Number.isSafeInteger(h.votes)||h.votes<=0||![h.pct_dem,h.pct_rep,h.margin].every(Number.isFinite)||
            h.pct_dem<0||h.pct_rep<0||h.pct_dem+h.pct_rep>100.1||h.pct_dem+h.pct_rep<=0||
            Math.abs(h.pct_dem-h.pct_rep-h.margin)>.11)throw Error('Missing or inconsistent dated historical district-part prior');
        historicalPriors[unit.fips_state+unit.fips_county]={margin:(h.pct_dem-h.pct_rep)/(h.pct_dem+h.pct_rep),
          allMargin:h.margin/100,total:h.votes};
      }
    }
    if(ids.size!==units.length||ids.size!==required?.size||[...required].some(id=>!ids.has(id)))throw Error('Incomplete or duplicate county geography');
    const stateCounts=parse(controls[0]);
    for(const key of ['d','r','total'])if(units.reduce((sum,u)=>sum+u[key],0)!==stateCounts[key])throw Error('County counts differ from state control');
    if(stateCounts.total<=0)throw Error('Pre-results snapshot; evaluated separately from partial counts');
    if(stateCounts.d>actual.d||stateCounts.r>actual.r||stateCounts.total>actual.total)throw Error('Source count requires correction against certified controls');
    const q=stateCounts.reported;
    const stage=q<25?'1-24':q<60?'25-59':q<90?'60-89':q<100?'90-99':'100';
    frames.push({id,file,year,state,...(office==='house'?{district}:{}),at,source:entry.url,sha256,captureIndex:index,stage,stageBasis:'source estimated vote reporting',
      candidateControlNames:{D:dn,R:rn},
      ...(historicalPriors?{historicalPriors,historicalPriorYear:2020,historicalPriorAvailableAt:at,
        historicalPriorPrecision:'Source-published rounded percentages; no precise candidate vote counts reconstructed'}:{}),
      finalBallotControl:{allBallots:contest.total,invalidBallots:contest.invalidBallotVotes||0,candidateVotes:actual.total},
      identityAliasSources:[dn,rn].filter(name=>reviewedAliases[name]).map(name=>({name,...reviewedAliases[name]})),
      stateControl:'exact-match',units,...stateCounts,truthMargin:100*(actual.d-actual.r)/actual.total,winnerD:actual.d>actual.r,
      truthSource:office==='governor'?'data/results/comparisons/governor-last-states.json':certifiedPath});
  }catch(error){quarantined.push({file,reason:error.message});}
}
const output={status:'research-transfer-inputs',office,frames,quarantined,
  truthSha256:createHash('sha256').update(office!=='governor'?certified:await readFile('data/results/comparisons/governor-last-states.json')).digest('hex')};
await writeFile(outputPath||join(root,`probability-${office}-county-frames.json`),JSON.stringify(output,null,2));
console.log(JSON.stringify({frames:frames.length,quarantined}));
