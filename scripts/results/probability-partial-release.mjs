import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {partialLiveModelVersion} from './probability-partial-adapter.mjs';
import {multiAggregateModelVersion} from './probability-multi-aggregate-adapter.mjs';
import {unopposedModelVersion} from './probability-unopposed-adapter.mjs';
import {majorityLockModelVersion} from './probability-majority-lock-adapter.mjs';
import {probabilityRule} from './probability-inputs.mjs';
import {genericName} from './candidate-roster.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const objectHash=value=>hash(JSON.stringify(value));
const normalizedHash=path=>hash(readFileSync(new URL(path,import.meta.url),'utf8').replace(/\r\n/g,'\n'));
const validTime=value=>typeof value==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const check=(condition,message)=>{if(!condition)throw Error('Partial-count release: '+message);};
const implementationFiles=['./probability-partial-model.mjs','./probability-partial-adapter.mjs',
  './probability-aggregate-adapter.mjs','./probability-multi-aggregate-adapter.mjs','./probability-unopposed-adapter.mjs',
  './probability-majority-lock-adapter.mjs','./probability-rule-outcomes.mjs','./probability-partial-release.mjs',
  './probability-live.mjs','./probability-inputs.mjs','./probability-ballot-filter.mjs','./candidate-roster.mjs','./nbc-counties.mjs'];

export function partialReleaseEvidence({aggregate=false,multi=false,majorityLock=false}={}){
 // Git normalizes line endings between Windows development and Linux hosting.
 // Bind the same JSON text, not the platform's newline convention.
 const validationBytes=readFileSync(new URL('../../data/results/probability-house-forward-validation.json',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const calibrationBytes=readFileSync(new URL('../../data/results/probability-partial-calibration.json',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const aggregateEvidence=aggregate?Object.fromEntries(['probability-aggregate-validation.json','probability-aggregate-2024-validation.json','probability-aggregate-node-validation.json'].map(file=>
   [file,JSON.parse(readFileSync(new URL('../../data/results/'+file,import.meta.url),'utf8'))])):undefined;
 const multiEvidence=multi||majorityLock?Object.fromEntries(['probability-multi-aggregate-validation.json','probability-multi-aggregate-2024-validation.json'].map(file=>
   [file,JSON.parse(readFileSync(new URL('../../data/results/'+file,import.meta.url),'utf8'))])):undefined;
 const majorityLockEvidence=majorityLock?JSON.parse(readFileSync(new URL('../../data/results/probability-majority-lock-validation.json',import.meta.url),'utf8').replace(/\r\n/g,'\n')):undefined;
 return {validation:JSON.parse(validationBytes),validationHash:hash(validationBytes),
  calibration:JSON.parse(calibrationBytes).calibration,calibrationHash:hash(calibrationBytes),
  ...(aggregate?{aggregateEvidence,aggregateValidationHash:objectHash(aggregateEvidence)}:{}),
  ...(multiEvidence?{multiEvidence,multiValidationHash:objectHash(multiEvidence)}:{}),
  ...(majorityLock?{majorityLockEvidence,majorityLockValidationHash:objectHash(majorityLockEvidence)}:{}),
  implementationHash:objectHash(implementationFiles.map(normalizedHash))};
}

function validateAggregateEvidence(release,evidence){
 check(release.aggregateValidationHash===evidence.aggregateValidationHash&&evidence.aggregateEvidence,
   'race-total evidence is not bound to the release');
 const a=evidence.aggregateEvidence['probability-aggregate-validation.json'];
 const b=evidence.aggregateEvidence['probability-aggregate-2024-validation.json'];
 const port=evidence.aggregateEvidence['probability-aggregate-node-validation.json'];
 const house=a?.cohorts?.['house-not-previously-inspected'];
 for(const [group,n]of [['60-100',100],['60-100-prior-competitive',15]]){
  const row=house?.[group],m=row?.metrics?.aggregate;
  check(m?.races>=n&&m.states>=(group==='60-100'?20:10)&&m.false95===0&&m.coverage80>=.7&&m.coverage80<=1&&
   m.brier<row.metrics['frozen-source']?.brier&&row.paired?.some(p=>p.method==='aggregate'&&p.comparison==='frozen-source'&&p.interval95?.[1]<0),
  'race-total held-out House skill is insufficient');
 }
 for(const [group,n]of [['60-100',20],['60-100-prior-competitive',5]]){
  const row=b?.cohorts?.[group],m=row?.metrics?.aggregate;
  check(row?.states>=n&&m?.false95Ids?.length===0&&m.coverage80>=.7&&m.coverage80<=1&&
   m.brier<row.metrics['frozen-source']?.brier&&row.pairedBrierDifference?.interval95?.[1]<0,
  'race-total different-cycle confirmation is insufficient');
 }
 check(port?.simulations===20000&&port.summary?.cases>=200&&port.monteCarloCheck?.comparisons>=200&&
  port.monteCarloCheck.failures===0&&port.monteCarloCheck.minimumP>=port.monteCarloCheck.threshold,
 'race-total numerical port is not verified');
 if(Object.values(release.races).some(c=>c.prior.inputMode==='race-total'&&c.prior.office==='governor')){
  const row=a?.cohorts?.governor?.['60-100'],m=row?.metrics?.aggregate;
  check(m?.races>=10&&m.false95===0&&m.coverage80>=.7&&m.brier<row.metrics['frozen-source']?.brier&&
    row.paired?.some(p=>p.method==='aggregate'&&p.comparison==='frozen-source'&&p.interval95?.[1]<0),
   'governor transfer evidence is insufficient');
 }
}

function validateMultiEvidence(release,evidence){
 check(release.multiValidationHash===evidence.multiValidationHash&&evidence.multiEvidence,
  'multi race-total evidence is not bound to the release');
 const a=evidence.multiEvidence['probability-multi-aggregate-validation.json'];
 const b=evidence.multiEvidence['probability-multi-aggregate-2024-validation.json'];
 check(a?.modelVersion===multiAggregateModelVersion&&b?.modelVersion===multiAggregateModelVersion,
  'multi race-total model identity mismatch');
 const house=a?.cohorts?.['house-not-previously-inspected'];
 for(const [group,n,states]of [['60-100',100,20],['60-100-prior-competitive',15,10],
  ['50-100',100,20],['50-100-prior-competitive',15,10]]){
  const row=house?.[group],m=row?.metrics?.multi;
  check(m?.races>=n&&m.states>=states&&m.false95===0&&m.coverage80>=.7&&m.coverage80<=1&&
   m.brier<row.metrics['frozen-source']?.brier,
  'multi race-total held-out House skill is insufficient');
 }
 // Different-cycle confirmation must show significant skill; the 2022 paired
 // interval can be borderline while still beating the frozen prior on Brier.
 for(const [group,n]of [['60-100',20],['60-100-prior-competitive',5],
  ['50-100',20],['50-100-prior-competitive',5]]){
  const row=b?.cohorts?.[group],m=row?.metrics?.multi;
  check(row?.states>=n&&m?.false95Ids?.length===0&&m.coverage80>=.7&&m.coverage80<=1&&
   m.brier<row.metrics['frozen-source']?.brier&&row.pairedBrierDifference?.interval95?.[1]<0,
  'multi race-total different-cycle confirmation is insufficient');
 }
}

function validateMajorityLockEvidence(release,evidence){
 check(release.majorityLockValidationHash===evidence.majorityLockValidationHash&&evidence.majorityLockEvidence,
  'majority-lock evidence is not bound to the release');
 const doc=evidence.majorityLockEvidence;
  check(doc?.modelVersion===majorityLockModelVersion&&doc.kernelVersion===multiAggregateModelVersion&&
  doc.boundMultiEvidence===true&&doc.requirements?.unresolvedShareMustBeZero===true&&
  doc.requirements?.terminalResolution===true&&
  doc.requirements?.simulations===20000&&doc.requirements?.minimumReportedPercent===20,
 'majority-lock gate identity is incomplete');
 validateMultiEvidence({...release,multiValidationHash:release.multiValidationHash||evidence.multiValidationHash},evidence);
}

export function validatePartialProbabilityRelease(release,evidence=partialReleaseEvidence({
  aggregate:Object.values(release?.races||{}).some(c=>c.prior?.inputMode==='race-total'),
  multi:Object.values(release?.races||{}).some(c=>c.prior?.inputMode==='race-total-multi'||c.prior?.inputMode==='majority-lock'),
  majorityLock:Object.values(release?.races||{}).some(c=>c.prior?.inputMode==='majority-lock')})){
 const {policy,approval,races}=release||{},entries=Object.entries(races||{});
 check(release?.modelVersion===partialLiveModelVersion&&policy?.method==='calibrated-partial-count', 'unknown model version or method');
 check(approval?.kind==='automated-source-and-statistical-review'&&validTime(approval.at)&&
  Date.parse(approval.at)<=Date.now()+120000&&
  release.validationHash===evidence.validationHash&&release.calibrationHash===evidence.calibrationHash&&
  release.implementationHash===evidence.implementationHash,'approval does not bind current code, calibration and evidence');
 check(policy.simulations===20000&&policy.minimumReportedPercent===25&&policy.maximumInputAgeMs===7*24*60*60*1000,
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
 const exact=cohorts?.['production-inputs'],exactClose=cohorts?.['production-inputs-prior-competitive'];
 const x=exact?.metrics?.['candidate-and-uncertainty'],y=exactClose?.metrics?.['candidate-and-uncertainty'];
 check(x?.races>=100&&x.states>=20&&y?.races>=20&&x.false95===0&&y.false95===0&&
  x.coverage80>=.7&&x.coverage80<=.9&&y.coverage80>=.7&&y.coverage80<=.9&&
  x.brier<exact.metrics['frozen-source']?.brier&&y.brier<exactClose.metrics['frozen-source']?.brier&&
  [exact,exactClose].every(group=>group.paired?.some(row=>row.method==='candidate-and-uncertainty'&&
    row.comparison==='frozen-source'&&row.interval95?.[1]<0)),
 'exact production-input validation does not establish held-out skill');
 check(entries.length>0&&entries.length<=506,'missing or excessive races');
 const hasAggregate=entries.some(([,c])=>c.prior?.inputMode==='race-total');
 const hasMulti=entries.some(([,c])=>c.prior?.inputMode==='race-total-multi');
 const hasMajorityLock=entries.some(([,c])=>c.prior?.inputMode==='majority-lock');
 if(hasAggregate)validateAggregateEvidence(release,evidence);
 if(hasMulti&&!hasMajorityLock)validateMultiEvidence(release,evidence);
 if(hasMajorityLock)validateMajorityLockEvidence(release,evidence);
 const calibrationIdentity=objectHash(evidence.calibration);
 for(const [id,{prior,roster} ]of entries){
  const aggregate=prior?.inputMode==='race-total';
  const multi=prior?.inputMode==='race-total-multi';
  const unopposed=prior?.inputMode==='unopposed';
  const majorityLock=prior?.inputMode==='majority-lock';
  if(unopposed){
   check(/^(?:house-[A-Z]{2}-(?:AL|[1-9]\d?)|senate-[A-Z]{2}|governor-[A-Z]{2})$/.test(id)&&
    prior?.raceId===id&&prior.modelVersion===unopposedModelVersion&&
    prior.method==='sole-candidate-certainty'&&['house','senate','governor'].includes(prior.office)&&
    id.startsWith(prior.office+'-')&&prior.electionDate==='2026-11-03'&&
    prior.rule==='plurality'&&probabilityRule(id,prior.electionDate)==='plurality',
   'unopposed race is outside the validated office or voting rule');
   check(Array.isArray(roster)&&roster.length===1&&Array.isArray(prior.candidateIds)&&prior.candidateIds.length===1&&
    prior.candidateIds[0]===roster[0].id&&!genericName(roster[0].name)&&roster[0].name.length<=180&&
    (roster[0].partyCode||roster[0].party)===prior.parties?.[roster[0].id],
   'unopposed race is not a sole reviewed candidate');
   check(validTime(prior.anchorAvailableAt)&&Date.parse(prior.anchorAvailableAt)<Date.parse(prior.electionDate+'T00:00:00Z'),
    'future or undated unopposed prior');
   const s=prior.anchorSource;
   check(s&&/^[a-f0-9]{40}$/.test(s.commit)&&/^[a-f0-9]{64}$/.test(s.sha256)&&s.availableAt===prior.anchorAvailableAt&&
    objectHash(s)===objectHash(release.unopposedPriorSources?.[prior.office]),'unbound unopposed prior source');
   check(Array.isArray(prior.units)&&prior.units.length===1&&prior.units[0].id==='race:'+id&&prior.units[0].weight===1,
    'invalid unopposed race unit');
   continue;
  }
  if(majorityLock){
   const rule=probabilityRule(id,prior.electionDate);
   check(/^(?:house-[A-Z]{2}-(?:AL|[1-9]\d?)|senate-[A-Z]{2}|governor-[A-Z]{2})$/.test(id)&&
    prior?.raceId===id&&prior.modelVersion===majorityLockModelVersion&&
    prior.method==='dirichlet-majority-lock'&&['house','senate','governor'].includes(prior.office)&&
    id.startsWith(prior.office+'-')&&prior.electionDate==='2026-11-03'&&
    prior.rule===rule&&['majority-runoff','ranked-choice','legislative-contingency'].includes(rule),
   'majority-lock race is outside the validated office or voting rule');
   check(Array.isArray(roster)&&roster.length>=2&&roster.length<=20&&
    Array.isArray(prior.candidateIds)&&prior.candidateIds.length===roster.length&&
    new Set(prior.candidateIds).size===roster.length&&
    prior.candidateIds.every(candidate=>typeof candidate==='string'&&/^[\w-]{1,100}$/.test(candidate))&&
    new Set(roster.map(c=>c.id)).size===roster.length&&new Set(roster.map(c=>c.name)).size===roster.length&&
    roster.every(c=>prior.candidateIds.includes(c.id)&&!genericName(c.name)&&c.name.length<=180&&
     (c.partyCode||c.party)===prior.parties?.[c.id]),
   'majority-lock race is not a complete reviewed candidate field');
   check(validTime(prior.anchorAvailableAt)&&Date.parse(prior.anchorAvailableAt)<Date.parse(prior.electionDate+'T00:00:00Z'),
    'future or undated majority-lock prior');
   const s=prior.anchorSource;
   check(s&&/^[a-f0-9]{40}$/.test(s.commit)&&/^[a-f0-9]{64}$/.test(s.sha256)&&s.availableAt===prior.anchorAvailableAt&&
    objectHash(s)===objectHash(release.majorityLockPriorSources?.[prior.office]),'unbound majority-lock prior source');
   check(Number.isFinite(prior.shareConcentration)&&prior.shareConcentration>=2&&prior.shareConcentration<=500&&
    Number.isFinite(prior.marginSigmaPoints)&&prior.marginSigmaPoints>0&&prior.marginSigmaPoints<100,
   'unbound majority-lock concentration or forecast uncertainty');
   check(Array.isArray(prior.units)&&prior.units.length===1&&prior.units[0].id==='race:'+id&&prior.units[0].weight===1&&
    prior.units[0].shares&&prior.candidateIds.every(candidateId=>Number.isFinite(prior.units[0].shares[candidateId])&&prior.units[0].shares[candidateId]>0)&&
    Math.abs(prior.candidateIds.reduce((sum,candidateId)=>sum+prior.units[0].shares[candidateId],0)-1)<1e-6,
   'invalid majority-lock share center');
   continue;
  }
  if(multi){
   check(/^(?:house-[A-Z]{2}-(?:AL|[1-9]\d?)|senate-[A-Z]{2}|governor-[A-Z]{2})$/.test(id)&&
    prior?.raceId===id&&prior.modelVersion===multiAggregateModelVersion&&
    prior.method==='dirichlet-remaining-count'&&['house','senate','governor'].includes(prior.office)&&
    id.startsWith(prior.office+'-')&&prior.electionDate==='2026-11-03'&&
    prior.rule==='plurality'&&probabilityRule(id,prior.electionDate)==='plurality',
   'multi race is outside the validated office or voting rule');
   check(Array.isArray(roster)&&roster.length>=2&&roster.length<=20&&
    Array.isArray(prior.candidateIds)&&prior.candidateIds.length===roster.length&&
    new Set(prior.candidateIds).size===roster.length&&
    prior.candidateIds.every(candidate=>typeof candidate==='string'&&/^[\w-]{1,100}$/.test(candidate))&&
    new Set(roster.map(c=>c.id)).size===roster.length&&new Set(roster.map(c=>c.name)).size===roster.length&&
    roster.every(c=>prior.candidateIds.includes(c.id)&&!genericName(c.name)&&c.name.length<=180&&
     (c.partyCode||c.party)===prior.parties?.[c.id]),
   'multi race is not a complete reviewed candidate field');
   check(validTime(prior.anchorAvailableAt)&&Date.parse(prior.anchorAvailableAt)<Date.parse(prior.electionDate+'T00:00:00Z'),
    'future or undated multi prior');
   const s=prior.anchorSource;
   check(s&&/^[a-f0-9]{40}$/.test(s.commit)&&/^[a-f0-9]{64}$/.test(s.sha256)&&s.availableAt===prior.anchorAvailableAt&&
    s.file===(prior.office==='house'?'data/house-forecast.json':prior.office==='senate'?'data/forecast.json':'data/governor-forecast.json')&&
    objectHash(s)===objectHash(release.multiPriorSources?.[prior.office]),'unbound multi race-total candidate prior');
   check(Number.isFinite(prior.shareConcentration)&&prior.shareConcentration>=2&&prior.shareConcentration<=500&&
    Number.isFinite(prior.marginSigmaPoints)&&prior.marginSigmaPoints>0&&prior.marginSigmaPoints<100,
   'unbound multi share concentration or forecast uncertainty');
   check(Array.isArray(prior.units)&&prior.units.length===1&&prior.units[0].id==='race:'+id&&prior.units[0].weight===1&&
    prior.units[0].shares&&prior.candidateIds.every(candidateId=>Number.isFinite(prior.units[0].shares[candidateId])&&prior.units[0].shares[candidateId]>0)&&
    Math.abs(prior.candidateIds.reduce((sum,candidateId)=>sum+prior.units[0].shares[candidateId],0)-1)<1e-6,
   'invalid multi race-total share center');
   continue;
  }
  check((aggregate?/^(?:house-[A-Z]{2}-(?:AL|[1-9]\d?)|governor-[A-Z]{2})$/:/^house-[A-Z]{2}-(?:AL|[1-9]\d?)$/).test(id)&&
   prior?.raceId===id&&prior.modelVersion===partialLiveModelVersion&&
   prior.method===policy.method&&(aggregate?['house','governor'].includes(prior.office):prior.office==='house')&&
   (prior.inputMode===undefined||aggregate)&&id.startsWith(prior.office+'-')&&prior.electionDate==='2026-11-03'&&
   prior.rule==='plurality'&&probabilityRule(id,prior.electionDate)==='plurality','race is outside the validated office or voting rule');
  check(Array.isArray(roster)&&roster.length===2&&Array.isArray(prior.candidateIds)&&prior.candidateIds.length===2&&
   new Set(prior.candidateIds).size===2&&prior.candidateIds.every(candidate=>typeof candidate==='string'&&/^[\w-]{1,100}$/.test(candidate))&&
   new Set(roster.map(c=>c.id)).size===2&&new Set(roster.map(c=>c.name)).size===2&&
   roster.every(c=>prior.candidateIds.includes(c.id)&&!genericName(c.name)&&c.name.length<=180&&
    (c.partyCode||c.party)===prior.parties?.[c.id])&&
   prior.parties?.[prior.candidateIds[0]]==='D'&&prior.parties?.[prior.candidateIds[1]]==='R',
  'race is not the declared two-candidate D/R field');
  check(validTime(prior.anchorAvailableAt)&&Date.parse(prior.anchorAvailableAt)<Date.parse(prior.electionDate+'T00:00:00Z')&&
   (aggregate||validTime(prior.geographyAvailableAt)&&Date.parse(prior.geographyAvailableAt)<=Date.parse(approval.at)), 'future or undated prior');
  if(aggregate){
   const s=prior.anchorSource;
   check(s&&/^[a-f0-9]{40}$/.test(s.commit)&&/^[a-f0-9]{64}$/.test(s.sha256)&&s.availableAt===prior.anchorAvailableAt&&
    s.file===(prior.office==='house'?'data/house-forecast.json':'data/governor-forecast.json')&&
    objectHash(s)===objectHash(release.aggregatePriorSources?.[prior.office]),'unbound race-total candidate prior');
  }
  check(Number.isFinite(prior.marginSigmaPoints)&&prior.marginSigmaPoints>0&&prior.marginSigmaPoints<100&&
   (prior.calibration===undefined||objectHash(prior.calibration)===calibrationIdentity),'unbound uncertainty or counting calibration');
  check(Array.isArray(prior.units)&&prior.units.length>0&&prior.units.length<=600&&
   new Set(prior.units.map(unit=>unit.id)).size===prior.units.length&&
   prior.units.every(unit=>typeof unit.id==='string'&&(aggregate?prior.units.length===1&&unit.id==='race:'+id&&unit.weight===1:/^[\w-]{1,100}$/.test(unit.id))&&Number.isFinite(unit.margin)&&Math.abs(unit.margin)<1&&
    Number.isFinite(unit.weight)&&unit.weight>0),'invalid geographic prior');
 }
 return entries.map(([id,{prior,roster}])=>[id,{
  prior:['race-total-multi','unopposed','majority-lock'].includes(prior.inputMode)?prior:{...prior,calibration:evidence.calibration},
  roster,
 }]);
}
