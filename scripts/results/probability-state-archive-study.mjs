import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {matchBallotCandidate} from './candidate-roster.mjs';
import {parseDelimited} from './csv.mjs';

const archiveBase='https://raw.githubusercontent.com/pushbuild/us-2026-election-results/e942083adc31f8d2e07bf521ba8c970b9e11e668/data/';
const archiveCommitAt='2026-11-04T17:18:17Z';
const texas={
  state:'TX',source:'Texas Secretary of State',sourceUrl:'https://goelect.txelections.civixapps.com/ivis-enr-ui/races',
  archive:archiveBase+'tx.csv',archiveCommitAt,
  sha256:'869dae13d75188e90f3a89c48624e2196f07a5d27df475b92b1085119e19ba93',
  notBefore:'2026-11-04T02:00:00Z',expectedCountyCount:254,captureSpreadMs:1000
};
// Texas Secretary of State results.html, November 2026 general election.
const texasHouseLabels={
  'house-TX-8':{'JESSICA HART STEINMANN':'Jessica Steinmann'},
  'house-TX-12':{'ANGELA "HELI" RODRIGUEZ PRILLIMAN':'Heli Rodriguez Prilliman'},
  'house-TX-18':{'CHRISTIAN DASHAUN MENEFEE':'Christian Menefee','RONALD DWAYNE WHITFIELD':'Ronald Whitfield'},
  'house-TX-20':{'EDGARDO RAFAEL BAEZ':'Edgardo Baez'},
  'house-TX-33':{'PATRICK DAVID GILLESPIE':'Patrick Gillespie'}
};
const manifests=[
  {
    id:'senate-OH',state:'OH',contest:'U.S. Senator - Unexpired Term Ending 01/03/2029',
    source:'Ohio Secretary of State',sourceUrl:'https://liveresults.ohiosos.gov/',
    sha256:'9cfb715d766bd8ed5257dcab50106fecf6bb338886f9212e3c9aba4f8ca89045',
    notBefore:'2026-11-04T00:30:00Z',expectedCountyCount:88
  },
  {
    id:'governor-GA',state:'GA',contest:'Governor',
    source:'Georgia Secretary of State',sourceUrl:'https://results.sos.ga.gov/results/public/Georgia/elections/11032026GeneralAndSpecialElection',
    sha256:'af33c6a83575b8dcba0d55c090f8860cde4561ab95a0ccc7d711a20944c2ee58',
    notBefore:'2026-11-04T00:00:00Z',expectedCountyCount:159,captureSpreadMs:1000,
    candidateLabels:{'Keisha Lance Bottoms (Dem)':'Keisha Bottoms','Rick Jackson (Rep)':'Rick Jackson'}
  },
  {
    id:'governor-PA',state:'PA',contest:'Governor',
    source:'Pennsylvania Department of State',sourceUrl:'https://www.electionreturns.pa.gov/',
    sha256:'95fb82e691b34781b2176faca04c86cdeb76fc7bf3305211af8c9d55dadf53f2',
    notBefore:'2026-11-04T01:00:00Z',expectedCountyCount:67,
    candidateLabels:{'Josh Shapiro / Davis, Austin':'Josh Shapiro',
      'Stacy Garrity / Richey, Jason L':'Stacy Garrity','Ken Krawchuk / Thomas, John C':'Ken Krawchuk'}
  },
  {
    id:'senate-NC',state:'NC',contest:'US SENATE',
    source:'NC State Board of Elections',sourceUrl:'https://er.ncsbe.gov/?election_dt=11/03/2026',
    sha256:'b45e182edec7e51e27d3555aa2f878df6e87bb25b626f3f81216a86049f133c0',
    notBefore:'2026-11-04T00:30:00Z',expectedCountyCount:100,captureSpreadMs:10000,
    // NCSBE's IDs run from 1 to 100 in the same order as the official county FIPS suffixes.
    countyQuery:fips=>'&county_id='+((Number(fips.slice(2))+1)/2)
  },
  // The Secretary of State's write-in certificate supplies the ballot labels.
  {...texas,id:'governor-TX',contest:'GOVERNOR',
    candidateLabels:{'JENN MACK':'Jenn Mack Raphoon','EDWARD EARL GILES':'Edward Giles'}},
  {...texas,id:'senate-TX',contest:'U. S. SENATOR'}
].map(entry=>({...entry,archiveCommitAt,
  archive:archiveBase+entry.state.toLowerCase()+'.csv'}));
const countyKey=name=>String(name||'').trim().toUpperCase().replace(/ COUNTY$/,'').replace(/\s+/g,'');
const count=value=>/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):NaN;

export function reconcileStateArchive(rows,race,countyIndex,manifest) {
  const selected=rows.filter(row=>row.contest===manifest.contest);
  const index=new Map(countyIndex.map(row=>[countyKey(row.county),row.fips]));
  if (race?.id!==manifest.id||!selected.length||index.size!==manifest.expectedCountyCount||index.size!==countyIndex.length||
      new Set(index.values()).size!==index.size||[...index.values()].some(fips=>!/^\d{5}$/.test(fips))) {
    throw Error('State archive does not match the reviewed race and county index');
  }
  const captureTimes=[...new Set(selected.map(row=>Date.parse(row.fetchedAt)))];
  const firstCapture=Math.min(...captureTimes),capturedAt=Math.max(...captureTimes);
  if (!(firstCapture>=Date.parse(manifest.notBefore)&&capturedAt<=Date.parse(manifest.archiveCommitAt)&&
      capturedAt-firstCapture<=(manifest.captureSpreadMs??0))) {
    throw Error('State archive capture time is missing or inconsistent');
  }
  const sourceTimes=new Set(selected.map(row=>row.sourceUpdatedAt?.trim()?Date.parse(row.sourceUpdatedAt):null));
  const sourceAt=[...sourceTimes][0];
  if (sourceTimes.size!==1||sourceAt!==null&&!(sourceAt>=Date.parse(manifest.notBefore)&&sourceAt<=firstCapture)) {
    throw Error('State archive upstream timestamp is inconsistent');
  }
  const groups=new Map();
  for (const row of selected) {
    const id=row.level==='state'&&!row.county?'race':row.level==='county'?index.get(countyKey(row.county)):null;
    if (!id) throw Error('Unknown county or aggregate row in state archive: '+(row.county||row.level));
    const sourceUrl=manifest.sourceUrl+(id!=='race'&&manifest.countyQuery?manifest.countyQuery(id):'');
    if (row.state!==manifest.state||row.source!==manifest.source||row.sourceUrl!==sourceUrl) {
      throw Error('Unexpected source on a selected state archive row');
    }
    const label=manifest.candidateLabels;
    const name=label&&Object.hasOwn(label,row.candidate)?label[row.candidate]:row.candidate;
    const candidate=matchBallotCandidate({name},race.candidates);
    const candidateId=race.candidates.find(entry=>entry.name===candidate.name).id;
    const total=count(row.contestTotalVotes),votes=count(row.votes);
    const group=groups.get(id)||{id,total,candidateVotes:Object.create(null)};
    if (!Number.isSafeInteger(total)||!Number.isSafeInteger(votes)||total!==group.total||
        Object.hasOwn(group.candidateVotes,candidateId)) throw Error('Invalid or duplicate count in '+id);
    group.candidateVotes[candidateId]=votes;
    groups.set(id,group);
  }
  const statewide=groups.get('race');
  groups.delete('race');
  const counties=[...groups.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const candidates=race.candidates.map(row=>row.id);
  if (!statewide||counties.length!==index.size||[statewide,...counties].some(group=>
    candidates.some(id=>!Object.hasOwn(group.candidateVotes,id))||
    Object.values(group.candidateVotes).reduce((total,votes)=>total+votes,0)!==group.total)) {
    throw Error('State archive has an incomplete roster or geographic count');
  }
  for (const id of candidates) {
    if (counties.reduce((total,group)=>total+group.candidateVotes[id],0)!==statewide.candidateVotes[id]) {
      throw Error('County totals do not reconcile with the state for '+id);
    }
  }
  return {status:'reconciled-observed-counts',raceId:race.id,
    observedAt:new Date(capturedAt).toISOString(),captureStartedAt:new Date(firstCapture).toISOString(),
    archiveCommitAt:manifest.archiveCommitAt,
    sourceUpdatedAt:sourceAt===null?null:new Date(sourceAt).toISOString(),
    source:manifest.source,sourceUrl:manifest.sourceUrl,archive:manifest.archive,
    statewide,counties};
}

function texasHouseCheckpoints(rows,races,countyIndex,official) {
  const fipsIndex=new Map(countyIndex.filter(row=>row.state==='TX').map(row=>[row.fips,row]));
  return Object.entries(official.districts).map(([district,ids])=>{
    const id='house-'+district;
    try {
      const counties=ids.map(fips=>fipsIndex.get(fips));
      if (counties.some(row=>!row)) throw Error('Unmapped district county FIPS');
      const race=races.find(row=>row.id===id);
      const manifest={...texas,id,expectedCountyCount:counties.length,
        contest:'U. S. REPRESENTATIVE DISTRICT '+id.split('-').at(-1),candidateLabels:texasHouseLabels[id]};
      const checkpoint=reconcileStateArchive(rows,race,counties,manifest);
      return {...checkpoint,geography:{plan:official.plan,source:official.source,sha256:official.sha256}};
    } catch(error) {
      return {raceId:id,status:'not-reconciled',reason:error.message};
    }
  });
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [path,raceId='senate-OH']=process.argv.slice(2);
  const manifest=raceId==='--texas-house'?texas:manifests.find(entry=>entry.id===raceId);
  if (!path||!manifest) {
    throw Error('Usage: probability-state-archive-study.mjs <pinned state CSV> [race ID or --texas-house]');
  }
  const [raw,catalogue,countyFile]=await Promise.all([
    readFile(path),readFile('data/election-night-races.json','utf8'),readFile('data/baselines/pres-2024-counties.json','utf8'),
  ]);
  if (createHash('sha256').update(raw).digest('hex')!==manifest.sha256) throw Error('State archive checksum mismatch');
  const races=JSON.parse(catalogue).races;
  const counties=JSON.parse(countyFile).rows.filter(row=>row.state===manifest.state&&row.valid);
  const rows=parseDelimited(raw.toString());
  const observed=raceId==='--texas-house'?texasHouseCheckpoints(rows,races,counties,
    JSON.parse(await readFile('data/results/probability-texas-official-county-sets.json','utf8'))):
    reconcileStateArchive(rows,races.find(row=>row.id===manifest.id),counties,manifest);
  console.log(JSON.stringify(observed,null,2));
}
