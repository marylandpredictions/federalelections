// Audit only. NBC's historical margin fields omit dates/turnout; discovering
// them does not certify a prior or authorize live probability publication.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readGeographicReferences,probabilityGeographyBasis} from './probability-inputs.mjs';

const [directory,tables,output]=process.argv.slice(2);
if(!output)throw Error('Usage: probability-nbc-prior-margin-audit.mjs <NBC capture directory> <district tables> <report>');
const metadata=JSON.parse(await readFile(join(directory,'audit.json'),'utf8'));
const captures=new Map(metadata.captures.map(row=>[row.path,row]));
const geography=readGeographicReferences(process.cwd(),{districtTablesDir:tables});
const rows=[];
for(const prior of geography.races.filter(row=>row.office==='house')){
  const row={id:prior.raceId,historicalBasis:probabilityGeographyBasis(prior),status:'unverified'};
  try{
    const capture=captures.get(prior.raceId+'.json.gz');
    if(!capture||!/^https:\/\/www\.nbcnews\.com\/(?:politics|firecracker\/api\/v2\/state-results)\/2026-elections\/[a-z0-9-]+-results$/.test(capture.source))throw Error('Missing verified NBC capture');
    const bytes=gunzipSync(await readFile(join(directory,capture.path)),{maxOutputLength:12000000});
    if(createHash('sha256').update(bytes).digest('hex')!==capture.sha256)throw Error('NBC capture checksum mismatch');
    const data=JSON.parse(bytes),districtToken=prior.raceId.split('-').at(-1);
    const district=/^(?:AL|0)$/.test(districtToken)?1:Number(districtToken);
    if(data.brand!=='news'||data.electionDate!=='2026-11-03'||data.electionType!=='general'||
        data.stateAbbr!==prior.state||!(Date.parse(data.currentTime)<=Date.parse(capture.at)))throw Error('NBC source identity or timestamp mismatch');
    const races=data.races?.filter(race=>race.summary?.officeCode==='H'&&Number(race.summary.district)===district);
    if(races?.length!==1||races[0].summary.raceId!==`2026-11-03~${prior.state}${String(district).padStart(3,'0')}~H`)throw Error('NBC district identity mismatch');
    const race=races[0],map=race.mapData?.[String(district).padStart(2,'0')]?.counties;
    const units=race.voteShiftMapUnits;
    if(!Array.isArray(units)||!units.length||units.length>600)throw Error('No bounded historical margin units');
    const ids=new Set(),reference=new Map(prior.countyReferences.map(unit=>[unit.fips,unit])),comparisons=[];
    let harris=0,trump=0;
    for(const unit of units){
      const id=unit.fips_code;
      if(!/^\d{5}$/.test(id)||ids.has(id)||!map?.[id]||unit.total_vote!==map[id].totalVote)throw Error('Historical field is not attached to a unique current district part');
      ids.add(id);
      const history=unit.margin_past_races;
      if(!Array.isArray(history)||history.length!==1)throw Error('Ambiguous historical comparison');
      const past=history[0];
      if(!Number.isFinite(past.margin)||past.margin<0||past.margin>100||
          !(['Dem','Rep'].includes(past.leading_party)))throw Error('Malformed historical margin');
      if(past.leading_party==='Dem'&&String(past.leading_candidate_id)==='64984'&&past.leading_candidate_name==='Harris')harris++;
      else if(past.leading_party==='Rep'&&String(past.leading_candidate_id)==='8639'&&past.leading_candidate_name==='Trump')trump++;
      else throw Error('Historical candidate does not identify the expected presidential comparison');
      const signed=past.margin*(past.leading_party==='Dem'?1:-1),known=reference.get(id);
      if(known?.valid&&known.totalVotes>0)comparisons.push({id,sourceMarginPoints:signed,
        referenceMarginPoints:100*(known.demVotes-known.repVotes)/known.totalVotes,
        differencePoints:signed-100*(known.demVotes-known.repVotes)/known.totalVotes});
    }
    if(units.reduce((sum,unit)=>sum+unit.total_vote,0)!==race.summary.votes)throw Error('Current district parts do not reconcile');
    Object.assign(row,{status:'historical-margin-discovered',source:capture.source,sha256:capture.sha256,capturedAt:capture.at,
      units:units.length,harrisUnits:harris,trumpUnits:trump,comparisons,
      maxAbsoluteReferenceDifference:comparisons.length?Math.max(...comparisons.map(v=>Math.abs(v.differencePoints))):null,
      missingRequirements:['Explicit historical election/denominator provenance','Historical district-part turnout or validated turnout-free treatment']});
  }catch(error){row.reason=error.message;}
  rows.push(row);
}
const found=rows.filter(row=>row.status==='historical-margin-discovered');
const report={status:'research-discovery-only',total:rows.length,discovered:found.length,
  discoveredWithoutExistingGeographicBasis:found.filter(row=>!row.historicalBasis).length,
  rows};
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({...report,rows:undefined}));
