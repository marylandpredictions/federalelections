import {createHash} from 'node:crypto';

export const modelVersion = 'fea-outstanding-vote-research-2';
const defaults = {simulations:20000,stateSd:.18,regionSd:.14,unitSd:.22,method:'full-coverage',
  completedUnitError:.30,sharedTurnoutSd:.08,minimumCompleteUnits:2};
const time = value => typeof value==='string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const count = value => Number.isSafeInteger(value) && value>=0;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sum = values => values.reduce((total,value)=>total+value,0);
const safeId = value => typeof value==='string' && /^[\w-]{1,100}$/.test(value);
const requireInput = (ok,message) => {if (!ok) throw Error(message);};

function rng(key) {
  let seed = Number.parseInt(key.slice(0,8),16);
  const uniform = () => {
    seed = (seed+0x6D2B79F5)|0;
    let n = Math.imul(seed^(seed>>>15),seed|1);
    n ^= n+Math.imul(n^(n>>>7),n|61);
    return ((n^(n>>>14))>>>0)/4294967296;
  };
  return () => Math.sqrt(-2*Math.log(1-uniform()))*Math.cos(2*Math.PI*uniform());
}

function prepare(prior,snapshot,settings) {
  requireInput(safeId(prior?.raceId) && snapshot?.raceId===prior.raceId &&
    /^\d{4}-\d{2}-\d{2}$/.test(prior.electionDate) &&
    ['house','senate','governor'].includes(prior.office) && prior.rule==='plurality','Unsupported race or voting rule');
  requireInput(time(snapshot.at)>=time(prior.electionDate+'T00:00:00Z') && time(snapshot.sourceUpdatedAt)<=time(snapshot.at) &&
    time(prior.availableAt)<time(prior.electionDate+'T00:00:00Z') && time(prior.availableAt)<time(snapshot.at) &&
    typeof prior.source==='string' && prior.source.trim() &&
    typeof snapshot.source==='string' && snapshot.source.trim(),'Missing provenance or look-ahead timestamp');
  const ids = prior.candidateIds;
  requireInput(Array.isArray(ids) && ids.length>=2 && ids.length<=12 && ids.every(safeId) &&
    new Set(ids).size===ids.length,'Candidate identities are missing or ambiguous');
  requireInput(Array.isArray(prior.units) && prior.units.length>=2 && prior.units.length<=400 &&
    Array.isArray(snapshot.units) && snapshot.units.length===prior.units.length,'Reporting-unit coverage is incomplete');
  const reports = new Map(snapshot.units.map(unit=>[unit.id,unit]));
  const ordered = [...prior.units].sort((a,b)=>a.id.localeCompare(b.id));
  requireInput(reports.size===ordered.length && new Set(ordered.map(unit=>unit.id)).size===ordered.length,'Duplicate reporting units');
  const reference = ids.at(-1);
  const votesFor = (votes,id)=>votes[id];
  const units = ordered.map(unit=>{
    const report = reports.get(unit.id);
    requireInput(safeId(unit.id) && safeId(unit.region) && report &&
      time(report.availableAt)<=time(snapshot.at) && typeof report.complete==='boolean' &&
      (!report.complete || typeof report.completionSource==='string' && report.completionSource.trim()),
    'Reporting-unit timestamp or verified completion is missing');
    requireInput(count(unit.turnout) && unit.turnout>0 && Number.isFinite(unit.turnoutLogSd) &&
      unit.turnoutLogSd>0 && unit.turnoutLogSd<=1 &&
      ids.every(id=>Number.isFinite(unit.shares?.[id]) && unit.shares[id]>0) &&
      Math.abs(sum(ids.map(id=>unit.shares[id]))-1)<1e-6,'Invalid pre-election turnout or vote-share prior');
    requireInput(report.votes && Object.keys(report.votes).length===ids.length &&
      ids.every(id=>Object.hasOwn(report.votes,id) && count(report.votes[id])),'Missing, unmatched, or invalid votes');
    const votes = ids.map(id=>votesFor(report.votes,id));
    const total = sum(votes);
    requireInput(Number.isSafeInteger(total),'Unsafe reported vote total');
    const baseline = ids.slice(0,-1).map(id=>Math.log(unit.shares[id]/unit.shares[reference]));
    return {...unit,baseline,votes,total,complete:report.complete};
  });
  const reported = ids.map((_,index)=>sum(units.map(unit=>unit.votes[index])));
  requireInput(reported.every(count) && count(sum(reported)) && snapshot.totals &&
    Object.keys(snapshot.totals).length===ids.length &&
    ids.every((id,index)=>Object.hasOwn(snapshot.totals,id)&&snapshot.totals[id]===reported[index]),
  'Geographic totals do not reconcile with reported race totals');
  requireInput(Number.isInteger(settings.simulations) && settings.simulations>=100 && settings.simulations<=50000 &&
    ['full-coverage','partial-pool','frozen-baseline'].includes(settings.method) &&
    Number.isInteger(settings.minimumCompleteUnits) && settings.minimumCompleteUnits>=2 &&
    ['stateSd','regionSd','unitSd','completedUnitError','sharedTurnoutSd'].every(key=>
      Number.isFinite(settings[key])&&settings[key]>0&&settings[key]<=2),'Invalid simulation settings');
  return {ids,units,reported};
}

// Partial returns are kept in the count but excluded from swing fitting.
// Treat each completed unit as a noisy observation, with a floor for
// between-unit variation so one high-turnout unit cannot dominate.
function posterior(units,dimensions,settings) {
  const stateVariance=settings.stateSd**2, regionVariance=settings.regionSd**2;
  const groups=new Map();
  for (const unit of units) {
    if (!groups.has(unit.region)) groups.set(unit.region,[]);
    if (settings.method!=='frozen-baseline' && unit.complete && unit.total>0) groups.get(unit.region).push(unit);
  }
  return Array.from({length:dimensions},(_,index)=>{
    const regions=new Map();
    let weight=1/stateVariance, signal=0;
    for (const [region,completed] of groups) {
      let precision=0, weightedSwing=0;
      for (const unit of completed) {
        const a=unit.votes[index]+.5, b=unit.votes.at(-1)+.5;
        const p=1/(settings.completedUnitError**2+1/a+1/b);
        precision+=p;
        weightedSwing+=p*(Math.log(a/b)-unit.baseline[index]);
      }
      const scale=1+regionVariance*precision;
      weight+=precision/scale;
      signal+=weightedSwing/scale;
      regions.set(region,{precision,weightedSwing});
    }
    return {mean:signal/weight,sd:Math.sqrt(1/weight),regions,regionVariance};
  });
}

export function simulateWinProbability(prior,snapshot,options={},previousInputHash) {
  requireInput(Object.keys(options).every(key=>Object.hasOwn(defaults,key)),'Unknown simulation setting');
  const settings=Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,options[key]??value]));
  const {ids,units,reported}=prepare(prior,snapshot,settings);
  const completed=units.filter(unit=>unit.complete && unit.total>0);
  const regions = new Set(units.map(unit=>unit.region));
  const coveredRegions = new Set(completed.map(unit=>unit.region));
  const verifiedComplete=units.every(unit=>unit.complete);
  if (verifiedComplete && !sum(reported)) return {status:'unavailable',reason:'Completed returns have no votes'};
  if (!verifiedComplete && settings.method!=='frozen-baseline' &&
      (completed.length<settings.minimumCompleteUnits ||
       settings.method==='full-coverage' && coveredRegions.size!==regions.size ||
       settings.method==='partial-pool' && coveredRegions.size<Math.min(2,regions.size)))
    return {status:'unavailable',reason:'Insufficient completed reporting units across regions'};
  const evidence=units.map(({id,votes,complete})=>({id,votes,complete}));
  const comparison=prior.marginCandidateIds;
  requireInput(Array.isArray(comparison)&&comparison.length===2&&comparison[0]!==comparison[1]&&
    comparison.every(id=>ids.includes(id)),'Missing fixed margin comparison candidates');
  const priorHash=hash({raceId:prior.raceId,electionDate:prior.electionDate,ids,comparison,
    units:units.map(({id,region,turnout,turnoutLogSd,baseline})=>({id,region,turnout,turnoutLogSd,baseline}))});
  const inputHash=hash({priorHash,settings,evidence});
  if (inputHash===previousInputHash) return {status:'unchanged'};
  // Keep draws paired across methods so score differences reflect the update,
  // rather than independent Monte Carlo noise.
  const {method,...drawSettings}=settings;
  const normal=rng(hash({priorHash,settings:drawSettings,evidence}));
  const fit=posterior(units,ids.length-1,settings);
  const wins=ids.map(()=>0), shareSums=ids.map(()=>0), margins=[];
  let completeness=0;
  const reportedVotes=sum(reported);
  const [first,second]=comparison.map(id=>ids.indexOf(id));
  for (let i=0;i<settings.simulations;i++) {
    const sharedTurnout=normal()*settings.sharedTurnoutSd;
    const regionEffects=fit.map(effect=>{
      const statewide=effect.mean+normal()*effect.sd;
      return new Map([...effect.regions].map(([region,{precision,weightedSwing}])=>{
        const variance=1/(1/effect.regionVariance+precision);
        return [region,variance*(statewide/effect.regionVariance+weightedSwing)+normal()*Math.sqrt(variance)];
      }));
    });
    const votes=[...reported];
    for (const unit of units) {
      if (unit.complete) continue;
      const turnout=unit.turnout*Math.exp(sharedTurnout+normal()*unit.turnoutLogSd);
      const outstanding=Math.max(0,turnout-unit.total);
      const logits=[...unit.baseline.map((value,k)=>value+regionEffects[k].get(unit.region)+normal()*settings.unitSd),0];
      const max=Math.max(...logits);
      const weights=logits.map(value=>Math.exp(value-max)), weight=sum(weights);
      for (let k=0;k<ids.length;k++) votes[k]+=outstanding*weights[k]/weight;
    }
    const total=sum(votes), best=Math.max(...votes);
    const tied=votes.filter(value=>value===best).length;
    for (let k=0;k<ids.length;k++) {
      if (votes[k]===best) wins[k]+=1/tied;
      shareSums[k]+=votes[k]/total;
    }
    completeness+=reportedVotes/total;
    margins.push(100*(votes[first]-votes[second])/total);
  }
  margins.sort((a,b)=>a-b);
  const quantile=p=>margins[Math.floor(p*(margins.length-1))];
  return {status:'research',raceId:prior.raceId,office:prior.office,electionDate:prior.electionDate,method,
    geography:{completedUnits:completed.length,coveredRegions:coveredRegions.size,regions:regions.size},
    at:snapshot.at,source:snapshot.source,
    sourceUpdatedAt:snapshot.sourceUpdatedAt,reportedVotes,modelVersion,priorHash,inputHash,snapshotId:hash(snapshot),
    simulations:settings.simulations,verifiedComplete,
    candidates:ids.map((id,i)=>({id,probability:verifiedComplete?wins[i]/settings.simulations:
      (wins[i]+.5)/(settings.simulations+ids.length*.5),projectedShare:shareSums[i]/settings.simulations})),
    margin:{candidateIds:comparison,median:quantile(.5),interval80:[quantile(.1),quantile(.9)]},
    estimatedCounted:completeness/settings.simulations};
}
