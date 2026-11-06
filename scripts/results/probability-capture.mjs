import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';

// The archive manifest hashes decoded response bodies. Capture provenance
// does not establish that any individual county was finished counting.
export function readProbabilityCapture(bytes,{sha256,at,source,raceId,nytId,electionDate}) {
  const body=bytes[0]===31 && bytes[1]===139 ? gunzipSync(bytes,{maxOutputLength:32*1024*1024}) : bytes;
  if (createHash('sha256').update(body).digest('hex')!==sha256) throw Error('Capture checksum mismatch');
  if (!/^https:\/\//.test(source) || !/^[\w-]{1,100}$/.test(raceId) || typeof nytId!=='string' || !nytId ||
      !/T.*Z$/.test(at) || !Number.isFinite(Date.parse(at))) throw Error('Invalid capture provenance');
  const payload=JSON.parse(body);
  const matches=payload.races?.filter(race=>race.nyt_id===nytId && race.election_date===electionDate);
  if (matches?.length!==1) throw Error('Expected exactly one matching race in the capture');
  const race=matches[0];
  if (!(Date.parse(race.updated_at)<=Date.parse(at))) throw Error('Capture contains results from after its observed timestamp');
  const states=race.reporting_units?.filter(unit=>unit.level==='state');
  const counties=race.reporting_units?.filter(unit=>unit.level==='county');
  if (states?.length!==1 || !counties?.length || race.reporting_units.length!==counties.length+1)
    throw Error('Unsupported reporting-unit scope');
  function totals(unit) {
    if (!Array.isArray(unit.candidates) || unit.candidates.length<2) throw Error('Missing candidate totals');
    const votes=new Map();
    for (const candidate of unit.candidates) {
      const id=candidate.nyt_id, count=candidate.votes?.total;
      if (typeof id!=='string' || !/^[\w-]{1,100}$/.test(id) || votes.has(id) ||
          !Number.isSafeInteger(count) || count<0) throw Error('Invalid or duplicate captured candidate');
      votes.set(id,count);
    }
    if (!Number.isSafeInteger(unit.total_votes) ||
        [...votes.values()].reduce((sum,count)=>sum+count,0)!==unit.total_votes)
      throw Error('Captured candidate and reporting-unit totals disagree');
    return Object.fromEntries(votes);
  }
  const state=states[0], raceTotals=totals(state), ids=Object.keys(raceTotals), seen=new Set();
  const units=counties.map(unit=>{
    const id=unit.fips_state+unit.fips_county, votes=totals(unit);
    if (!/^\d{2}$/.test(unit.fips_state) || !/^\d{3}$/.test(unit.fips_county) ||
        unit.fips_state!==state.fips_state || seen.has(id) ||
        Object.keys(votes).length!==ids.length || ids.some(candidate=>!Object.hasOwn(votes,candidate)))
      throw Error('Invalid, duplicate, or incomplete captured reporting unit');
    seen.add(id);
    return {id,availableAt:at,complete:false,votes};
  });
  if (ids.some(id=>units.reduce((sum,unit)=>sum+unit.votes[id],0)!==raceTotals[id]))
    throw Error('Captured county votes do not reconcile with the statewide count');
  return {raceId,at,sourceUpdatedAt:race.updated_at,source,sourceChecksum:sha256,totals:raceTotals,units};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]||!process.argv[3]) throw Error('Usage: node scripts/results/probability-capture.mjs <body> <capture-metadata.json>');
  console.log(JSON.stringify(readProbabilityCapture(await readFile(process.argv[2]),
    JSON.parse(await readFile(process.argv[3],'utf8'))),null,2));
}
