import {mkdir,readFile,readdir,writeFile,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {resultStorage} from './storage.mjs';
import {modelVersion,simulateWinProbability} from './win-probability.mjs';

export async function runProbabilityReplay({prior,snapshots,settings},root=process.cwd(),{persist=true,deduplicate=true}={}) {
  if (!Array.isArray(snapshots) || !snapshots.length) throw Error('No historical snapshots');
  for (let i=0;i<snapshots.length;i++) {
    const at=Date.parse(snapshots[i].at);
    if (!Number.isFinite(at) || i>0 && at<=Date.parse(snapshots[i-1].at))
      throw Error('Replay snapshots must be in strictly increasing observed-time order');
  }
  const points=[], skipped=[];
  let previous, accepted;
  for (const snapshot of snapshots) {
    const units=new Map(snapshot.units?.map(unit=>[unit.id,unit]));
    const regressed=previous?.units.some(unit=>{
      const next=units.get(unit.id);
      return !next || unit.complete && !next.complete ||
        Object.entries(unit.votes).some(([id,votes])=>next.votes?.[id]<votes);
    });
    if (regressed && (typeof snapshot.correctionSource!=='string' || !snapshot.correctionSource.trim()))
      throw Error('Reporting regression requires a documented correction');
    if (previous && Date.parse(snapshot.sourceUpdatedAt)<Date.parse(previous.sourceUpdatedAt))
      throw Error('Provider timestamp regressed');
    const point=simulateWinProbability(prior,snapshot,settings,deduplicate?accepted?.inputHash:undefined);
    if (point.status==='unavailable') {
      skipped.push({at:snapshot.at,reason:point.reason});
    } else if (point.status==='research') {
      const reason=regressed?'documented-correction':accepted?'reporting-update':'first-supported-snapshot';
      accepted={...point,mode:'reconstructed',reason,...(regressed?{correctionSource:snapshot.correctionSource}:{})};
      points.push(accepted);
    }
    previous=snapshot;
  }
  // Stage complete files before making them visible. Identical reruns leave
  // existing points in place and a changed timeline cannot overwrite history.
  if (persist && points.length) {
    const directory=join(resultStorage(root).directory,'win-probability','reconstructed',modelVersion,points[0].method,prior.raceId);
    await mkdir(directory,{recursive:true});
    for (const point of points) {
      const file=join(directory,Date.parse(point.at)+'.json');
      const tmp=join(directory,randomUUID()+'.tmp');
      const json=JSON.stringify(point)+'\n';
      await writeFile(tmp,json,{flag:'wx'});
      try {
        await link(tmp,file);
      } catch (error) {
        if (error.code!=='EEXIST' || await readFile(file,'utf8')!==json) throw error;
      } finally {
        await unlink(tmp);
      }
    }
  }
  return {raceId:prior.raceId,mode:'reconstructed',status:points.length?'research':'unavailable',points,skipped};
}

export async function readProbabilityReplay(raceId,root=process.cwd(),method='full-coverage') {
  if (!/^[\w-]{1,100}$/.test(raceId)) throw Error('Invalid race ID');
  if (!['full-coverage','partial-pool','frozen-baseline'].includes(method)) throw Error('Invalid research method');
  const directory=join(resultStorage(root).directory,'win-probability','reconstructed',modelVersion,method,raceId);
  const files=await readdir(directory).catch(error=>{
    if (error.code==='ENOENT') return [];
    throw error;
  });
  return Promise.all(files.filter(name=>/^\d{13}\.json$/.test(name)).sort().map(async name=>
    JSON.parse(await readFile(join(directory,name),'utf8'))));
}

// Final outcomes are passed only to this scoring function, never the simulator.
export function scoreProbabilityReplay(points,truth) {
  const bins=new Map();
  for (const point of points) {
    const stage=Math.min(9,Math.floor(point.estimatedCounted*10));
    const key=point.raceId+':'+stage;
    const prior=bins.get(key);
    if (!prior || Date.parse(point.at)<Date.parse(prior.at)) bins.set(key,point);
  }
  const scores=[], calibration=new Map();
  for (const point of bins.values()) {
    const actual=truth[point.raceId];
    if (!actual || !point.candidates.some(candidate=>candidate.id===actual.winner) ||
        JSON.stringify(actual.marginCandidateIds)!==JSON.stringify(point.margin.candidateIds) ||
        !Number.isFinite(actual.margin)) throw Error('Missing or incompatible held-out outcome');
    const winner=point.candidates.find(candidate=>candidate.id===actual.winner);
    const [low,high]=point.margin.interval80;
    const stage=Math.min(9,Math.floor(point.estimatedCounted*10));
    scores.push({raceId:point.raceId,stage,
      brier:point.candidates.reduce((score,c)=>score+(c.probability-Number(c.id===actual.winner))**2,0),
      logLoss:-Math.log(winner.probability),marginError:point.margin.median-actual.margin,
      covered80:low<=actual.margin&&actual.margin<=high});
    for (const candidate of point.candidates) {
      const bucket=Math.min(9,Math.floor(candidate.probability*10));
      const key=stage+':'+bucket;
      if (!calibration.has(key)) calibration.set(key,{stage,bucket,count:0,probability:0,wins:0});
      const row=calibration.get(key);
      row.count++;
      row.probability+=candidate.probability;
      row.wins+=Number(candidate.id===actual.winner);
    }
  }
  return {scores,calibration:[...calibration.values()].map(({stage,bucket,count,probability,wins})=>
    ({stage,bucket,count,meanProbability:probability/count,observedWinRate:wins/count}))};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw Error('Usage: node scripts/results/probability-replay.mjs <frozen-race-bundle.json>');
  const result=await runProbabilityReplay(JSON.parse(await readFile(process.argv[2],'utf8')));
  console.log(JSON.stringify({...result,points:result.points.length},null,2));
}
