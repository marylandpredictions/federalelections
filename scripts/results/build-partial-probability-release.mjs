// Compile a scoped configuration from reconciled private input-audit output.
// Never copies live vote counts, calls, raw NBC responses or secrets into Git.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {partialReleaseEvidence,validatePartialProbabilityRelease} from './probability-partial-release.mjs';
import {partialLiveModelVersion} from './probability-partial-adapter.mjs';
import {matchBallotCandidate} from './candidate-roster.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicRoster=rows=>rows.map(candidate=>({id:candidate.id,name:candidate.name,party:candidate.partyCode||candidate.party,
 ...(candidate.providerName?{providerName:candidate.providerName}:{}),...(candidate.aliases?.length?{aliases:candidate.aliases}:{})}));
export function compilePartialRelease(inventory,crosscheck,catalogue,evidence=partialReleaseEvidence(),at=new Date().toISOString(),aggregateInventory,multiInventory,unopposedInventory,majorityLockInventory){
 if(!String(inventory?.status).startsWith('research-real-NBC')||!inventory.priors||!Array.isArray(crosscheck?.rows))
  throw Error('Missing reconciled NBC input inventory or geographic crosscheck');
 const geography=new Map(crosscheck.rows.map(row=>[row.id,row]));
 const races={},excluded=[];
 for(const [id,config] of Object.entries(inventory.priors))try{
  const audit=geography.get(id);
  if(audit?.maxAbsoluteReferenceDifference>.5)throw Error('Historical geographic sources disagree; review required');
  const base=catalogue.find(race=>race.id===id);
  if(!base||base.type!=='house'||base.candidates.length!==2||config.roster.length!==2)
    throw Error('The reviewed ballot does not confirm an exactly two-candidate field');
  for(const candidate of base.candidates)matchBallotCandidate(candidate,config.roster);
  const roster=publicRoster(config.roster);
  const {calibration:omittedCalibration,...prior}=config.prior;
  // Reuse an already reviewed availability date; never backdate an input.
  if(Date.parse(prior.geographyAvailableAt)>Date.parse(at))throw Error('Geography is not available at approval time');
  races[id]={prior,roster};
 }catch(error){excluded.push({id,path:'geographic',reason:error.message});}
 if(aggregateInventory){
  if(!String(aggregateInventory.status).startsWith('Research-only real NBC aggregate input audit')||!aggregateInventory.priors)
   throw Error('Missing audited race-total input inventory');
  for(const [id,config]of Object.entries(aggregateInventory.priors)){
   if(races[id])continue; // The validated geographic path always takes precedence.
   try{
    const base=catalogue.find(r=>r.id===id);
    if(!base||!['house','governor'].includes(base.type)||base.candidates.length!==2||config.roster.length!==2||config.prior.inputMode!=='race-total')
      throw Error('Outside supported race-total scope');
    for(const candidate of base.candidates)matchBallotCandidate(candidate,config.roster);
    const {calibration:omittedCalibration,...prior}=config.prior;
    races[id]={prior,roster:publicRoster(config.roster)};
   }catch(error){excluded.push({id,path:'race-total',reason:error.message});}
  }
 }
 if(multiInventory){
  if(!String(multiInventory.status).startsWith('Research-only real NBC multi aggregate input audit')||!multiInventory.priors)
   throw Error('Missing audited multi race-total input inventory');
  for(const [id,config]of Object.entries(multiInventory.priors)){
   if(races[id])continue; // Geographic and two-party race-total paths take precedence.
   try{
    const base=catalogue.find(r=>r.id===id);
    if(!base||!['house','senate','governor'].includes(base.type)||
      base.candidates.length<2||base.candidates.length>20||config.roster.length!==base.candidates.length||
      config.prior.inputMode!=='race-total-multi')
      throw Error('Outside supported multi race-total scope');
    for(const candidate of base.candidates)matchBallotCandidate(candidate,config.roster);
    const {calibration:omittedCalibration,...prior}=config.prior;
    races[id]={prior,roster:publicRoster(config.roster)};
   }catch(error){excluded.push({id,path:'race-total-multi',reason:error.message});}
  }
 }
 if(unopposedInventory){
  if(!String(unopposedInventory.status).startsWith('Research-only real NBC unopposed input audit')||!unopposedInventory.priors)
   throw Error('Missing audited unopposed input inventory');
  for(const [id,config]of Object.entries(unopposedInventory.priors)){
   if(races[id])continue;
   try{
    const base=catalogue.find(r=>r.id===id);
    if(!base||base.candidates.length!==1||config.roster.length!==1||config.prior.inputMode!=='unopposed')
      throw Error('Outside supported unopposed scope');
    matchBallotCandidate(base.candidates[0],config.roster);
    const {calibration:omittedCalibration,...prior}=config.prior;
    races[id]={prior,roster:publicRoster(config.roster)};
   }catch(error){excluded.push({id,path:'unopposed',reason:error.message});}
  }
 }
 if(majorityLockInventory){
  if(!String(majorityLockInventory.status).startsWith('Research-only real NBC majority-lock input audit')||!majorityLockInventory.priors)
   throw Error('Missing audited majority-lock input inventory');
  for(const [id,config]of Object.entries(majorityLockInventory.priors)){
   if(races[id])continue;
   try{
    const base=catalogue.find(r=>r.id===id);
    if(!base||base.candidates.length<2||base.candidates.length>20||config.roster.length!==base.candidates.length||
      config.prior.inputMode!=='majority-lock')
      throw Error('Outside supported majority-lock scope');
    for(const candidate of base.candidates)matchBallotCandidate(candidate,config.roster);
    const {calibration:omittedCalibration,...prior}=config.prior;
    races[id]={prior,roster:publicRoster(config.roster)};
   }catch(error){excluded.push({id,path:'majority-lock',reason:error.message});}
  }
 }
 const hasAggregate=Object.values(races).some(c=>c.prior.inputMode==='race-total');
 const hasMulti=Object.values(races).some(c=>c.prior.inputMode==='race-total-multi');
 const hasUnopposed=Object.values(races).some(c=>c.prior.inputMode==='unopposed');
 const hasMajorityLock=Object.values(races).some(c=>c.prior.inputMode==='majority-lock');
 const release={schemaVersion:2,modelVersion:partialLiveModelVersion,
  description:'Scoped calibrated partial-count rollout with race-total, multi-candidate, unopposed and majority-lock paths.',
  policy:{method:'calibrated-partial-count',simulations:20000,minimumReportedPercent:25,maximumInputAgeMs:7*24*60*60*1000},
  approval:{kind:'automated-source-and-statistical-review',at,performedBy:'Automated replay checks and Codex source review; no independent human review claimed'},
  validationHash:evidence.validationHash,calibrationHash:evidence.calibrationHash,implementationHash:evidence.implementationHash,
  priorSource:{commit:inventory.priorCommit,availableAt:inventory.anchorAvailableAt,sha256:inventory.anchorSha256},
  ...(hasAggregate?{aggregateValidationHash:evidence.aggregateValidationHash,aggregatePriorSources:aggregateInventory.anchorSources}:{}),
  ...(hasMulti||hasMajorityLock?{multiValidationHash:evidence.multiValidationHash,multiPriorSources:(multiInventory||majorityLockInventory).anchorSources}:{}),
  ...(hasUnopposed?{unopposedPriorSources:unopposedInventory.anchorSources}:{}),
  ...(hasMajorityLock?{majorityLockValidationHash:evidence.majorityLockValidationHash,majorityLockPriorSources:majorityLockInventory.anchorSources}:{}),
  limitations:['Geographic path limited to two-candidate Democratic/Republican House plurality races',
    'Two-party race-total fallback requires at least 60% source reporting; House and governor only',
    'Multi-candidate race-total covers plurality House, Senate and governor fields with 2-20 reviewed candidates at >=60% reporting',
    'Unopposed races publish certainty for the sole reviewed candidate at >=60% reporting',
    'Special-rule races publish only when every remaining-vote draw still has a first-count majority winner',
    'Delayed NBC inputs are explicitly stale; provider failure cannot manufacture fresh estimates'],
  races};
 validatePartialProbabilityRelease(release,evidence);
 return {release,excluded};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [inventoryPath,crosscheckPath,outputPath,aggregateInventoryPath,multiInventoryPath,unopposedInventoryPath,majorityLockInventoryPath]=process.argv.slice(2);
 if(!outputPath)throw Error('Usage: build-partial-probability-release.mjs <partial> <geography> <out> [aggregate] [multi] [unopposed] [majority-lock]');
 const inventoryBytes=await readFile(inventoryPath),crosscheckBytes=await readFile(crosscheckPath);
 const catalogue=JSON.parse(await readFile('data/election-night-races.json','utf8')).races;
 const aggregateBytes=aggregateInventoryPath?await readFile(aggregateInventoryPath):undefined;
 const multiBytes=multiInventoryPath?await readFile(multiInventoryPath):undefined;
 const unopposedBytes=unopposedInventoryPath?await readFile(unopposedInventoryPath):undefined;
 const majorityBytes=majorityLockInventoryPath?await readFile(majorityLockInventoryPath):undefined;
 const {release,excluded}=compilePartialRelease(JSON.parse(inventoryBytes),JSON.parse(crosscheckBytes),catalogue,
  partialReleaseEvidence({aggregate:Boolean(aggregateBytes),multi:Boolean(multiBytes)||Boolean(majorityBytes),majorityLock:Boolean(majorityBytes)}),
  new Date().toISOString(),
  aggregateBytes?JSON.parse(aggregateBytes):undefined,multiBytes?JSON.parse(multiBytes):undefined,
  unopposedBytes?JSON.parse(unopposedBytes):undefined,majorityBytes?JSON.parse(majorityBytes):undefined);
 if(aggregateBytes)release.aggregateInputAuditHash=hash(aggregateBytes);
 if(multiBytes)release.multiInputAuditHash=hash(multiBytes);
 if(unopposedBytes)release.unopposedInputAuditHash=hash(unopposedBytes);
 if(majorityBytes)release.majorityLockInputAuditHash=hash(majorityBytes);
 release.inputAuditHash=hash(inventoryBytes);release.geographicCrosscheckHash=hash(crosscheckBytes);
 await writeFile(outputPath,JSON.stringify(release,null,2)+'\n');
 console.log(JSON.stringify({modelVersion:release.modelVersion,races:Object.keys(release.races).length,excludedInputPaths:excluded.length,
  modes:Object.values(release.races).reduce((acc,c)=>{const m=c.prior.inputMode||'geographic';acc[m]=(acc[m]||0)+1;return acc;},{})}));
}
