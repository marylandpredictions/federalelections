import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {runProbabilityReplay} from './probability-replay.mjs';
import {modelVersion} from './win-probability.mjs';

const mean = values => values.reduce((total,n)=>total+n,0)/values.length;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unitInterval = n => Number.isFinite(n)&&n>=0&&n<=1;
function loss(point,truth) {
  const winner=point.candidates.find(candidate=>candidate.id===truth.winner);
  if (!winner || !Number.isFinite(truth.margin) ||
      JSON.stringify(truth.marginCandidateIds)!==JSON.stringify(point.margin.candidateIds))
    throw Error('Incompatible held-out outcome: '+point.raceId);
  const [low,high]=point.margin.interval80;
  return {
    brier:point.candidates.reduce((total,c)=>total+(c.probability-Number(c===winner))**2,0),
    logLoss:-Math.log(winner.probability),marginError:Math.abs(point.margin.median-truth.margin),
    covered80:Number(low<=truth.margin&&truth.margin<=high),
  };
}

export async function benchmarkProbability({policy,bundles},truth) {
  const {method,cohorts,minimumRaces,minimumCycles,coverageTolerance,settings,holdoutDates,frozenAt}=policy;
  const compareLimits=method==='outstanding-limits';
  if (!['full-coverage','partial-pool','outstanding-limits'].includes(method) || !cohorts?.length ||
      !Number.isInteger(minimumRaces) || minimumRaces<2 ||
      !Number.isInteger(minimumCycles) || minimumCycles<2 || !unitInterval(coverageTolerance) ||
      !holdoutDates?.length || holdoutDates.some(date=>!(Date.parse(frozenAt)<Date.parse(date))) ||
      cohorts.some(({office,stage})=>!['house','senate','governor'].includes(office) ||
        !Number.isInteger(stage)||stage<0||stage>9)) throw Error('Invalid preregistered benchmark policy');
  const groups=new Map(cohorts.map(({office,stage})=>[office+':'+stage,{opportunities:0,pairs:[]}]));
  const seen=new Set();
  for (const bundle of bundles) {
    const {raceId,office,electionDate}=bundle.prior;
    const id=electionDate+':'+raceId;
    if (!holdoutDates.includes(electionDate) || seen.has(id)) throw Error('Unexpected or duplicate held-out race: '+id);
    seen.add(id);
    const snapshots=bundle.snapshots;
    const withLimits=new Set(snapshots.filter(snapshot=>snapshot.units.some(unit=>unit.outstandingLimit!==undefined))
      .map(snapshot=>snapshot.at));
    if (withLimits.size && !compareLimits) throw Error('Ballot limits require a separate benchmark policy');
    const uncapped=compareLimits?snapshots.map(snapshot=>({...snapshot,units:snapshot.units.map(unit=>{
      const {outstandingLimit,...report}=unit;
      return report;
    })})):snapshots;
    const run=(mode,inputs)=>runProbabilityReplay({prior:bundle.prior,snapshots:inputs,settings:{...settings,method:mode}},
      undefined,{persist:false,deduplicate:!compareLimits});
    const baseline=await run(compareLimits?'full-coverage':'frozen-baseline',uncapped);
    const candidate=await run(compareLimits?'full-coverage':method,snapshots);
    const byTime=new Map(candidate.points.map(point=>[point.at,point]));
    // Truth enters only after both runs. Actual completion is for scoring
    // strata, never an input to either forecast.
    const actual=truth[id];
    if (!actual || !Number.isSafeInteger(actual.totalVotes) || actual.totalVotes<=0 || !actual.source)
      throw Error('Missing certified outcome or denominator: '+id);
    if (compareLimits && snapshots.some(({units,totals})=>
      units.every(unit=>unit.complete || unit.outstandingLimit) &&
      Object.values(totals).reduce((total,n)=>total+n,0)+
        units.reduce((total,unit)=>total+(unit.outstandingLimit?.maxBallots??0),0)<actual.totalVotes))
      throw Error('Certified turnout exceeds the claimed all-ballot bound: '+id);
    const stages=new Set();
    for (const reference of baseline.points) {
      if (reference.verifiedComplete || compareLimits && !withLimits.has(reference.at) ||
          method==='partial-pool' && reference.geography.coveredRegions===reference.geography.regions) continue;
      if (reference.reportedVotes>actual.totalVotes) throw Error('Reported votes exceed held-out outcome: '+id);
      const stage=Math.min(9,Math.floor(10*reference.reportedVotes/actual.totalVotes));
      const group=groups.get(office+':'+stage);
      if (!group || stages.has(stage)) continue;
      stages.add(stage);
      group.opportunities++;
      const point=byTime.get(reference.at);
      if (point) group.pairs.push({electionDate,model:loss(point,actual),baseline:loss(reference,actual)});
    }
  }
  const report=[...groups].map(([cohort,{opportunities,pairs}])=>{
    const cycles=new Set(pairs.map(pair=>pair.electionDate.slice(0,4))).size;
    const metrics=key=>Object.fromEntries(['brier','logLoss','marginError','covered80'].map(metric=>
      [metric,pairs.length?mean(pairs.map(pair=>pair[key][metric])):null]));
    const model=metrics('model'), baseline=metrics('baseline');
    const eligible=pairs.length>=minimumRaces && cycles>=minimumCycles;
    return {cohort,opportunities,races:pairs.length,cycles,model,baseline,
      status:!eligible?'insufficient-evidence':model.brier<baseline.brier && model.logLoss<baseline.logLoss &&
        model.marginError<=baseline.marginError && Math.abs(model.covered80-.8)<=coverageTolerance?'passes-screen':'fails-screen'};
  });
  return {modelVersion,method,policyHash:digest(policy),inputHash:digest(bundles),truthHash:digest(truth),
    status:report.every(row=>row.status==='passes-screen')?'requires-independent-review':'blocked',cohorts:report};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]||!process.argv[3]) throw Error('Usage: node scripts/results/probability-benchmark.mjs <holdout-bundles.json> <certified-outcomes.json>');
  const read=async path=>JSON.parse(await readFile(path,'utf8'));
  const result=await benchmarkProbability(await read(process.argv[2]),await read(process.argv[3]));
  console.log(JSON.stringify(result,null,2));
  if (result.status==='blocked') process.exitCode=1;
}
