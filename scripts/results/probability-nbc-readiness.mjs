import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {parseNbcNational} from './nbc-provider.mjs';
import {NbcCountyProvider,nbcCountyPage,parseNbcCounties,parseNbcCountyAggregates,parseNbcNativeReportingUnits,countyGeographies} from './nbc-counties.mjs';
import {normalizeProbabilitySnapshot,readGeographicReferences,probabilityGeographyBasis} from './probability-inputs.mjs';
import {matchBallotCandidate} from './candidate-roster.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path,'utf8'));

async function captured(directory,metadata) {
  if(!/^[\w-]+\.json\.gz$/.test(metadata?.path||'')||!/^https:\/\/www\.nbcnews\.com\//.test(metadata.source||'')||
      !Number.isFinite(Date.parse(metadata.at)))throw Error('Invalid NBC capture metadata');
  const body=gunzipSync(await readFile(join(directory,metadata.path)),{maxOutputLength:12000000});
  if(hash(body)!==metadata.sha256)throw Error('NBC capture checksum mismatch');
  const data=JSON.parse(body);
  if(!(Date.parse(data.currentTime)<=Date.parse(metadata.at)))throw Error('NBC capture contains a future source timestamp');
  return data;
}

export async function auditNbcProbabilityInputs(directory,{root=process.cwd(),districtTablesDir}={}) {
  const captureReport=await json(join(directory,'audit.json'));
  const {races:catalogue}=await json(join(root,'data/election-night-races.json'));
  const {sources}=await json(join(root,'data/results-provider.json'));
  const geography=new Map(readGeographicReferences(root,{districtTablesDir}).races.map(row=>[row.raceId,row]));
  const captures=new Map((captureReport.captures||[]).map(row=>[row.path,row]));
  if(captures.size!==captureReport.captures?.length)throw Error('Duplicate captured NBC response');
  const national=new Map(),invalid=new Map(),provider=new NbcCountyProvider({root});
  for(const source of sources.filter(source=>source.format==='nbc-national-v2')){
    const metadata=captures.get(source.office+'.json.gz');
    if(metadata?.source!==source.url)throw Error('NBC national capture does not match configured source');
    const data=await captured(directory,metadata);
    for(const race of parseNbcNational(data,source,catalogue,{onInvalid:issue=>invalid.set(issue.race,issue.reason)}))
      national.set(race.id,race);
  }
  const rows=[];
  for(const base of catalogue){
    const race=national.get(base.id),g=geography.get(base.id);
    const row={id:base.id,office:base.type,rule:g.rule,historicalBasis:probabilityGeographyBasis(g),
      historicalUnits:g.countyReferences.length,nationalAvailable:!!race,nationalReconciled:false,sameResponseReconciled:false,
      geographyMatched:false,completionVerified:false,issues:[]};
    rows.push(row);
    if(!race){row.issues.push(invalid.get(base.id)||'No healthy NBC national race');continue;}
    row.candidates=race.candidates.length;
    const metadata=captures.get(base.id+'.json.gz');
    if(!metadata){row.issues.push('No county response captured');continue;}
    try {
      const page=nbcCountyPage(race),endpoint=page?.replace('/politics/','/firecracker/api/v2/state-results/');
      if(metadata.source!==endpoint)throw Error('County capture does not match this race page');
      const data=await captured(directory,metadata);
      row.asOf=metadata.at;
      row.sourceUpdatedAt=data.currentTime;
      if(data.updateUrl!==endpoint)throw Error('NBC update URL disagrees with captured endpoint');
      const issues=[],lookup=countyGeographies(data,race,await provider.localFeatures(race.state));
      row.countyIssues=issues;
      const native=base.state==='AK';
      const counties=native?parseNbcNativeReportingUnits(data,race):parseNbcCounties(data,race,{lookup,onInvalid:issue=>issues.push(issue)});
      const scheme=native?{reportingUnitScheme:'nbc-alaska-state-house-districts'}:{};
      // An inventory of the verified source units, not a historical prior.
      const captureOptions={at:metadata.at,source:'NBC News',...(native?{reportingUnitIds:counties.map(unit=>unit.id)}:{})};
      row.nbcUnits=counties.length;
      const office={house:'H',senate:'S',governor:'G'}[base.type];
      const district=/^(AL|0)$/i.test(String(base.district))?1:Number(base.district);
      const summaries=data.races.filter(r=>r.summary.officeCode===office&&
        (base.type!=='house'||Number(r.summary.district)===district));
      if(summaries.length!==1)throw Error('County page has ambiguous race summaries');
      const summary=summaries[0].summary;
      // National tooltips omit NBC candidate codes. Use the codes from the
      // same dated race summary and match both count views to its named roster.
      const roster=summary.candidates.map(candidate=>({
        ...matchBallotCandidate({name:candidate.name},race.candidates),
        id:String(candidate.candidateId??candidate.id??candidate.code??''),
      }));
      const candidates=summary.candidates.map(candidate=>({
        ...matchBallotCandidate({name:candidate.name},roster),votes:candidate.votes,
      }));
      const total=candidates.reduce((sum,candidate)=>sum+candidate.votes,0);
      if(!Number.isSafeInteger(total)||total!==summary.votes)
        throw Error('County page summary omits '+(summary.votes-total)+' ballots or votes');
      let modelCounties=counties;
      try {
        normalizeProbabilitySnapshot({...race,...scheme,lastUpdated:data.currentTime,candidates,counties},
          roster,captureOptions);
      }catch(error){
        row.nativeMapIssue=error.message;
        if(roster.length<2||!['ME','MA','NH','CT','RI','VT'].includes(race.state))throw error;
        modelCounties=parseNbcCountyAggregates(data,race,{lookup});
        normalizeProbabilitySnapshot({...race,lastUpdated:data.currentTime,candidates,counties:modelCounties},
          roster,{at:metadata.at,source:'NBC News'});
        row.usedMunicipalityArray=true;
      }
      row.sameResponseReconciled=true;
      try {
        normalizeProbabilitySnapshot({...race,...scheme,counties:modelCounties},roster,captureOptions);
        row.nationalReconciled=true;
      }catch(error){row.issues.push(error.message);}
      row.sourceVotes=total;
      if(native)row.nativeUnitsReconciled=true;
      const expected=new Set(g.countyReferences.map(county=>county.fips));
      if(expected.size>=2)try{
        const aligned=normalizeProbabilitySnapshot({...race,lastUpdated:data.currentTime,candidates,counties:modelCounties},
          roster,{at:metadata.at,source:'NBC News',reportingUnitIds:[...expected]});
        row.geographyMatched=true;
        row.modelUnits=aligned.units.length;
      }catch(error){row.issues.push(error.message);}
      if(!row.geographyMatched)row.issues.push('Reporting units do not match historical county portions');
    }catch(error){row.issues.push(error.message);}
  }
  const counts=Object.fromEntries(['nationalAvailable','nationalReconciled','sameResponseReconciled','nativeUnitsReconciled','geographyMatched','completionVerified']
    .map(key=>[key,rows.filter(row=>row[key]).length]));
  return {status:'input-audit',startedAt:captureReport.startedAt,finishedAt:captureReport.finishedAt||null,
    total:rows.length,capturedRaces:rows.filter(row=>row.asOf).length,counts,
    note:'Reconciled counts do not establish completed reporting units or validated win probabilities.',
    races:rows};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2])throw Error('Usage: probability-nbc-readiness.mjs <capture directory> [district table directory]');
  console.log(JSON.stringify(await auditNbcProbabilityInputs(process.argv[2],{districtTablesDir:process.argv[3]}),null,2));
}
