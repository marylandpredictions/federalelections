// Production-format adapter for the partial-count statistical kernel.
// Publication is still controlled by the live service's release validator.
// This adapter supports an exactly two-candidate D/R plurality contest only.
import {createHash} from 'node:crypto';
import {simulatePartialCounts,partialModelVersion} from './probability-partial-model.mjs';
import {probabilityRule} from './probability-inputs.mjs';

export const partialLiveModelVersion='fea-live-partial-count-1';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const requireInput=(condition,message)=>{if(!condition)throw Error(message);};
const dated=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));

export function tiltPartialGeography(units,marginPoints){
  requireInput(Number.isFinite(marginPoints)&&Math.abs(marginPoints)<100&&Array.isArray(units)&&units.length&&
    units.every(unit=>Number.isFinite(unit.margin)&&Math.abs(unit.margin)<1&&Number.isFinite(unit.weight)&&unit.weight>0),
  'Invalid candidate mean or historical geographic weights');
  const total=units.reduce((sum,unit)=>sum+unit.weight,0);
  requireInput(Number.isFinite(total),'Unsafe historical geographic weights');
  const logits=units.map(unit=>Math.log((1+unit.margin)/(1-unit.margin)));
  const target=(1+marginPoints/100)/2;
  let low=-60,high=60;
  for(let iteration=0;iteration<100;iteration++){
    const shift=(low+high)/2;
    const mean=units.reduce((sum,unit,i)=>sum+unit.weight/total/(1+Math.exp(-logits[i]-shift)),0);
    if(mean<target)low=shift;else high=shift;
  }
  return units.map((unit,i)=>({...unit,margin:2/(1+Math.exp(-logits[i]-(low+high)/2))-1}));
}

export function partialCalibrationWithPrior(calibration,units,marginSigmaPoints){
  requireInput(Number.isFinite(marginSigmaPoints)&&marginSigmaPoints>0&&marginSigmaPoints<100,
    'Missing frozen candidate-margin uncertainty');
  requireInput(Array.isArray(units)&&units.length&&units.every(unit=>Number.isFinite(unit.weight)&&unit.weight>0),
    'Missing historical geographic weights');
  const total=units.reduce((sum,unit)=>sum+unit.weight,0);
  requireInput(Number.isFinite(total),'Unsafe geographic weights');
  const countyVariance=calibration.countyVariance;
  requireInput(Number.isFinite(countyVariance)&&countyVariance>0,'Missing trained county residual variance');
  const local=countyVariance*units.reduce((sum,unit)=>sum+(unit.weight/total)**2,0);
  return {...structuredClone(calibration),swingLoading:[[Math.sqrt(Math.max(0,(marginSigmaPoints/100)**2-local)),0],[0,0]]};
}

export function simulatePartialProbability(prior,snapshot,settings={},previousInputHash){
  requireInput(prior?.method==='calibrated-partial-count'&&prior.modelVersion===partialLiveModelVersion,
    'Unknown calibrated partial-count prior');
  requireInput(prior.rule==='plurality'&&probabilityRule(prior.raceId,prior.electionDate)==='plurality',
    'This partial-count adapter does not resolve runoffs or ranked-choice transfers');
  requireInput(prior.office==='house'&&/^house-[A-Z]{2}-(?:AL|[1-9]\d?)$/.test(prior.raceId),
    'This release adapter currently requires House-specific validation');
  requireInput(Array.isArray(prior.candidateIds)&&prior.candidateIds.length===2&&
    new Set(prior.candidateIds).size===2&&prior.candidateIds.every(id=>typeof id==='string'&&/^[\w-]{1,100}$/.test(id)),
  'An exactly two-candidate roster is required');
  const [d,r]=prior.candidateIds;
  requireInput(prior.parties?.[d]==='D'&&prior.parties?.[r]==='R','Candidate identities are not a D/R contest');
  requireInput(snapshot?.raceId===prior.raceId&&snapshot.electionDate===prior.electionDate&&snapshot.source==='NBC News'&&
    dated(snapshot.at)&&dated(snapshot.sourceUpdatedAt)&&Date.parse(snapshot.sourceUpdatedAt)<=Date.parse(snapshot.at),
  'Missing matching dated NBC snapshot');
  requireInput(dated(prior.anchorAvailableAt)&&Date.parse(prior.anchorAvailableAt)<Date.parse(prior.electionDate+'T00:00:00Z')&&
    dated(prior.geographyAvailableAt)&&Date.parse(prior.geographyAvailableAt)<=Date.parse(snapshot.at),
  'Prior availability does not precede its required cutoff');
  requireInput(Array.isArray(prior.units)&&prior.units.length>0&&prior.units.length<=600&&
    new Set(prior.units.map(unit=>unit.id)).size===prior.units.length&&
    Array.isArray(snapshot.units)&&snapshot.units.length===prior.units.length,
  'Missing or duplicate geographic coverage');
  if(!Number.isFinite(snapshot.expectedVotePercent)||snapshot.expectedVotePercent<25)
    return {status:'unavailable',reason:'The calibrated partial-count model requires at least 25% source-estimated vote reporting.'};
  const ids=new Set(prior.units.map(unit=>unit.id)),seen=new Set();
  const reports=snapshot.units.map(unit=>{
    requireInput(ids.has(unit.id)&&!seen.has(unit.id)&&dated(unit.availableAt)&&Date.parse(unit.availableAt)<=Date.parse(snapshot.at),
      'Reporting geography or timestamp does not match the frozen prior');
    seen.add(unit.id);
    requireInput(Object.keys(unit.votes||{}).length===2&&[d,r].every(id=>Number.isSafeInteger(unit.votes[id])&&unit.votes[id]>=0),
      'Missing, additional or malformed candidate counts');
    const total=unit.votes[d]+unit.votes[r];
    requireInput(Number.isSafeInteger(total),'Unsafe candidate total');
    return {id:unit.id,d:unit.votes[d],r:unit.votes[r],total,reported:unit.expectedVotePercent};
  });
  requireInput(Object.keys(snapshot.totals||{}).length===2&&[d,r].every(id=>
    reports.reduce((sum,unit)=>sum+(id===d?unit.d:unit.r),0)===snapshot.totals[id]),
  'Reporting-unit counts do not reconcile to the race');
  if(reports.some(unit=>unit.total<=0||!Number.isFinite(unit.reported)||unit.reported<=0||unit.reported>100))
    return {status:'unavailable',reason:'Waiting for a positive NBC count and vote-reporting estimate for every model area.'};
  const simulations=settings.simulations??20000;
  requireInput(simulations===20000,'This validation uses 20,000 simulations');
  requireInput(prior.calibration?.priorMode!=='count-only'&&prior.calibration?.marginBasis!=='all-votes',
    'This adapter requires the validated historical two-party margin basis');
  const calibration=partialCalibrationWithPrior(prior.calibration,prior.units,prior.marginSigmaPoints);
  const priors=prior.units.map(({id,margin})=>({id,margin}));
  const priorHash=hash(prior);
  requireInput(settings.implementationHash===undefined||/^[a-f0-9]{64}$/.test(settings.implementationHash),
    'Invalid model implementation identity');
  const inputHash=hash([partialLiveModelVersion,settings.implementationHash??null,priorHash,[...reports].sort((a,b)=>a.id.localeCompare(b.id)),simulations]);
  if(inputHash===previousInputHash)return {status:'unchanged',inputHash};
  const result=simulatePartialCounts(priors,reports,calibration,{simulations});
  return {status:'research',raceId:prior.raceId,office:prior.office,electionDate:prior.electionDate,
    method:prior.method,modelVersion:partialLiveModelVersion,kernelVersion:partialModelVersion,
    at:snapshot.at,source:snapshot.source,sourceUpdatedAt:snapshot.sourceUpdatedAt,
    priorHash,inputHash,snapshotId:hash(snapshot),simulations,
    reportedVotes:result.reportedVotes,verifiedComplete:false,
    geography:{reportedUnits:reports.length},
    candidates:[{id:d,probability:result.conditionalProbabilityD},
      {id:r,probability:1-result.conditionalProbabilityD}],
    margin:{candidateIds:[d,r],median:result.medianMarginPoints,interval80:result.interval80},
    estimatedCounted:Math.min(1,result.reportedVotes/result.medianFinalVotes)};
}
