// Race-total input port of the frozen fallback experiment. Importing this
// module does not approve or activate a production race.
import {createHash} from 'node:crypto';
import {partialLiveModelVersion,partialCalibrationWithPrior} from './probability-partial-adapter.mjs';
import {simulatePartialCounts,partialModelVersion} from './probability-partial-model.mjs';
import {probabilityRule} from './probability-inputs.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const dated=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const check=(condition,message)=>{if(!condition)throw Error('Race-total model: '+message);};

export function simulateAggregateProbability(prior,snapshot,settings={},previousInputHash){
 check(prior?.inputMode==='race-total'&&prior.method==='calibrated-partial-count'&&prior.modelVersion===partialLiveModelVersion,
  'unknown input mode or model');
 check(['house','senate','governor'].includes(prior.office)&&
  new RegExp('^'+prior.office+'-[A-Z]{2}'+(prior.office==='house'?'-(?:AL|[1-9]\\d?)':'')+'$').test(prior.raceId)&&
  prior.electionDate==='2026-11-03'&&prior.rule==='plurality'&&probabilityRule(prior.raceId,prior.electionDate)==='plurality',
  'unsupported office or election rule');
 check(Array.isArray(prior.candidateIds)&&prior.candidateIds.length===2&&new Set(prior.candidateIds).size===2&&
  prior.candidateIds.every(id=>typeof id==='string'&&/^[\w-]{1,100}$/.test(id)),'exactly two stable candidate identities required');
 const [d,r]=prior.candidateIds;
 check(prior.parties?.[d]==='D'&&prior.parties?.[r]==='R','this component requires a complete D/R ballot');
 check(dated(prior.anchorAvailableAt)&&Date.parse(prior.anchorAvailableAt)<Date.parse(prior.electionDate+'T00:00:00Z'),
  'anchor must precede Election Day');
 check(snapshot?.raceId===prior.raceId&&snapshot.electionDate===prior.electionDate&&snapshot.source==='NBC News'&&
  dated(snapshot.at)&&dated(snapshot.sourceUpdatedAt)&&Date.parse(snapshot.sourceUpdatedAt)<=Date.parse(snapshot.at),
  'matching dated NBC input required');
 check(Array.isArray(prior.units)&&prior.units.length===1&&prior.units[0].id==='race:'+prior.raceId&&
  prior.units[0].weight===1&&Number.isFinite(prior.units[0].margin)&&Math.abs(prior.units[0].margin)<1,
  'one explicit race reporting unit required; no synthetic county identity');
 check(Array.isArray(snapshot.units)&&snapshot.units.length===1&&snapshot.units[0].id===prior.units[0].id,
  'race reporting unit identity mismatch');
 const unit=snapshot.units[0];
 check(dated(unit.availableAt)&&Date.parse(unit.availableAt)<=Date.parse(snapshot.at)&&unit.complete!==true,
  'race estimates cannot certify reporting-unit completion');
 check(Object.keys(snapshot.totals||{}).length===2&&Object.keys(unit.votes||{}).length===2&&
  [d,r].every(id=>Number.isSafeInteger(snapshot.totals[id])&&snapshot.totals[id]>=0&&unit.votes[id]===snapshot.totals[id]),
  'malformed or unreconciled candidate counts');
 const total=unit.votes[d]+unit.votes[r],reported=snapshot.expectedVotePercent;
 check(Number.isSafeInteger(total),'unsafe candidate total');
 if(total<=0||!Number.isFinite(reported)||reported<60||reported>100||unit.expectedVotePercent!==reported)
  return {status:'unavailable',reason:'The conservative race-total model requires positive NBC counts and at least 60% source-estimated reporting.'};
 check((settings.simulations??20000)===20000,'20,000 simulations required');
 check(settings.implementationHash===undefined||/^[a-f0-9]{64}$/.test(settings.implementationHash),'invalid implementation identity');
 check(prior.calibration?.priorMode!=='count-only'&&prior.calibration?.marginBasis!=='all-votes',
  'validated frozen-candidate two-party prior required');
 const calibration=partialCalibrationWithPrior(prior.calibration,prior.units,prior.marginSigmaPoints);
 // The unchanged kernel accepts word/hyphen identifiers. Retain the explicit
 // race namespace without widening its geographic-ID parser or changing math.
 const kernelId='race-'+prior.raceId;
 const reports=[{id:kernelId,d:unit.votes[d],r:unit.votes[r],total,reported}];
 const priorHash=hash(prior),inputHash=hash([partialLiveModelVersion,'race-total',settings.implementationHash??null,priorHash,reports,20000]);
 if(inputHash===previousInputHash)return {status:'unchanged',inputHash};
 const result=simulatePartialCounts([{id:kernelId,margin:prior.units[0].margin}],reports,calibration,{simulations:20000});
 return {status:'research',raceId:prior.raceId,office:prior.office,electionDate:prior.electionDate,
  method:prior.method,inputMode:'race-total',modelVersion:partialLiveModelVersion,kernelVersion:partialModelVersion,
  at:snapshot.at,source:snapshot.source,sourceUpdatedAt:snapshot.sourceUpdatedAt,priorHash,inputHash,snapshotId:hash(snapshot),simulations:20000,
  reportedVotes:total,verifiedComplete:false,geography:{reportedUnits:1,scheme:'race-total'},
  candidates:[{id:d,probability:result.conditionalProbabilityD},{id:r,probability:1-result.conditionalProbabilityD}],
  margin:{candidateIds:[d,r],median:result.medianMarginPoints,interval80:result.interval80},
  estimatedCounted:Math.min(1,total/result.medianFinalVotes)};
}
