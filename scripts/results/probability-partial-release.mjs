import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {partialLiveModelVersion} from './probability-partial-adapter.mjs';
import {probabilityRule} from './probability-inputs.mjs';
import {genericName} from './candidate-roster.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const objectHash=value=>hash(JSON.stringify(value));
const normalizedHash=path=>hash(readFileSync(new URL(path,import.meta.url),'utf8').replace(/\r\n/g,'\n'));
const validTime=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const check=(condition,message)=>{if(!condition)throw Error('Partial-count release: '+message);};

export function partialReleaseEvidence(){
 // Git normalizes line endings between Windows development and Linux hosting.
 // Bind the same JSON text, not the platform's newline convention.
 const validationBytes=readFileSync(new URL('../../data/results/probability-house-forward-validation.json',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const calibrationBytes=readFileSync(new URL('../../data/results/probability-partial-calibration.json',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 return {validation:JSON.parse(validationBytes),validationHash:hash(validationBytes),
  calibration:JSON.parse(calibrationBytes).calibration,calibrationHash:hash(calibrationBytes),
  implementationHash:objectHash(['./probability-partial-model.mjs','./probability-partial-adapter.mjs','./probability-partial-release.mjs','./probability-live.mjs','./probability-inputs.mjs','./candidate-roster.mjs','./nbc-counties.mjs'].map(normalizedHash))};
}

export function validatePartialProbabilityRelease(release,evidence=partialReleaseEvidence()){
 const {policy,approval,races}=release||{},entries=Object.entries(races||{});
 check(release?.modelVersion===partialLiveModelVersion&&policy?.method==='calibrated-partial-count', 'unknown model version or method');
 check(approval?.kind==='automated-source-and-statistical-review'&&validTime(approval.at)&&
  Date.parse(approval.at)<=Date.now()+120000&&
  release.validationHash===evidence.validationHash&&release.calibrationHash===evidence.calibrationHash&&
  release.implementationHash===evidence.implementationHash,'approval does not bind current code, calibration and evidence');
 check(policy.simulations===20000&&policy.minimumReportedPercent===25&&policy.maximumInputAgeMs===48*60*60*1000,
  'unexpected simulation or supported reporting policy');
 const cohorts=evidence.validation.cohorts?.['new-races'];
 const overall=cohorts?.['supported-stages']?.metrics,competitive=cohorts?.['supported-prior-competitive']?.metrics;
 const a=overall?.['candidate-and-uncertainty'],b=overall?.['frozen-source'],c=competitive?.['candidate-and-uncertainty'];
 const supportedComparison=cohorts?.['supported-stages']?.paired?.find(row=>row.method==='candidate-and-uncertainty'&&row.comparison==='frozen-source');
 const competitiveComparison=cohorts?.['supported-prior-competitive']?.paired?.find(row=>row.method==='candidate-and-uncertainty'&&row.comparison==='frozen-source');
 check(a?.races>=100&&a.states>=20&&c?.races>=20&&a.brier<b?.brier&&
  a.coverage80>=.7&&a.coverage80<=.9&&c.coverage80>=.7&&c.coverage80<=.9&&a.false95===0,
  'new-race validation does not support the requested scope');
 check(supportedComparison?.interval95?.[1]<0&&competitiveComparison?.interval95?.[1]<0,
  'state-cluster comparisons do not establish skill in the supported scope');
 // Publication also requires skill on the exact positive-count/percentage
 // input policy, not just the broader research kernel's eligible stages.
 const exact=cohorts?.['production-inputs'],exactClose=cohorts?.['production-inputs-prior-competitive'];
 const x=exact?.metrics?.['candidate-and-uncertainty'],y=exactClose?.metrics?.['candidate-and-uncertainty'];
 check(x?.races>=100&&x.states>=20&&y?.races>=20&&x.false95===0&&y.false95===0&&
   x.coverage80>=.7&&x.coverage80<=.9&&y.coverage80>=.7&&y.coverage80<=.9&&
   x.brier<exact.metrics['frozen-source']?.brier&&y.brier<exactClose.metrics['frozen-source']?.brier&&
   [exact,exactClose].every(group=>group.paired?.some(row=>row.method==='candidate-and-uncertainty'&&
     row.comparison==='frozen-source'&&row.interval95?.[1]<0)),
  'exact production-input validation does not establish held-out skill');
 check(entries.length>0&&entries.length<=506,'missing or excessive races');
 const calibrationIdentity=objectHash(evidence.calibration);
 for(const [id,{prior,roster} ]of entries){
  check(/^house-[A-Z]{2}-(?:AL|[1-9]\d?)$/.test(id)&&prior?.raceId===id&&prior.modelVersion===partialLiveModelVersion&&
   prior.method===policy.method&&prior.office==='house'&&prior.electionDate==='2026-11-03'&&
   prior.rule==='plurality'&&probabilityRule(id,prior.electionDate)==='plurality','race is outside the validated office or voting rule');
  check(Array.isArray(roster)&&roster.length===2&&Array.isArray(prior.candidateIds)&&prior.candidateIds.length===2&&
   new Set(prior.candidateIds).size===2&&prior.candidateIds.every(candidate=>typeof candidate==='string'&&/^[\w-]{1,100}$/.test(candidate))&&
   new Set(roster.map(c=>c.id)).size===2&&new Set(roster.map(c=>c.name)).size===2&&
   roster.every(c=>prior.candidateIds.includes(c.id)&&!genericName(c.name)&&c.name.length<=180&&
    (c.partyCode||c.party)===prior.parties?.[c.id])&&
   prior.parties?.[prior.candidateIds[0]]==='D'&&prior.parties?.[prior.candidateIds[1]]==='R',
  'race is not the declared two-candidate D/R field');
  check(validTime(prior.anchorAvailableAt)&&Date.parse(prior.anchorAvailableAt)<Date.parse(prior.electionDate+'T00:00:00Z')&&
   validTime(prior.geographyAvailableAt)&&Date.parse(prior.geographyAvailableAt)<=Date.parse(approval.at), 'future or undated prior');
  check(Number.isFinite(prior.marginSigmaPoints)&&prior.marginSigmaPoints>0&&prior.marginSigmaPoints<100&&
   (prior.calibration===undefined||objectHash(prior.calibration)===calibrationIdentity),'unbound uncertainty or counting calibration');
  check(Array.isArray(prior.units)&&prior.units.length>0&&prior.units.length<=600&&
   new Set(prior.units.map(unit=>unit.id)).size===prior.units.length&&
   prior.units.every(unit=>typeof unit.id==='string'&&/^[\w-]{1,100}$/.test(unit.id)&&Number.isFinite(unit.margin)&&Math.abs(unit.margin)<1&&
    Number.isFinite(unit.weight)&&unit.weight>0),'invalid geographic prior');
 }
 return entries.map(([id,{prior,roster}])=>[id,{prior:{...prior,calibration:evidence.calibration},roster}]);
}
