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
 ...(candidate.providerName?{providerName:candidate.providerName}:{}),...(candidate.aliases?.length?{aliases:candidate.aliases}: {})}));
export function compilePartialRelease(inventory,crosscheck,catalogue,evidence=partialReleaseEvidence(),at=new Date().toISOString(),aggregateInventory){
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
 const hasAggregate=Object.values(races).some(c=>c.prior.inputMode==='race-total');
 const release={schemaVersion:2,modelVersion:partialLiveModelVersion,
  description:'Scoped calibrated partial-count rollout with an independently tested race-total fallback. Not certification of all 506 races.',
  policy:{method:'calibrated-partial-count',simulations:20000,minimumReportedPercent:25,maximumInputAgeMs:48*60*60*1000},
  approval:{kind:'automated-source-and-statistical-review',at,performedBy:'Automated replay checks and Codex source review; no independent human review claimed'},
  validationHash:evidence.validationHash,calibrationHash:evidence.calibrationHash,implementationHash:evidence.implementationHash,
  priorSource:{commit:inventory.priorCommit,availableAt:inventory.anchorAvailableAt,sha256:inventory.anchorSha256},
  ...(hasAggregate?{aggregateValidationHash:evidence.aggregateValidationHash,aggregatePriorSources:aggregateInventory.anchorSources}:{}),
  limitations:['Exactly two-candidate Democratic/Republican plurality fields only; geographic path limited to House races',
    'At least 25% source-estimated reporting and positive counts/estimates in every model area',
    'Race-total fallback requires at least 60% source reporting and has conservative intervals; House and governor only',
    'Evidence covers a new-race 2022 holdout, not a second independent House cycle',
    'Delayed NBC inputs are explicitly stale; provider failure cannot manufacture fresh estimates',
    'Other races remain unavailable pending their own validated model and input coverage'],
  races};
 validatePartialProbabilityRelease(release,evidence);
 return {release,excluded};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [inventoryPath,crosscheckPath,outputPath,aggregateInventoryPath]=process.argv.slice(2);
 if(!outputPath)throw Error('Usage: build-partial-probability-release.mjs <private NBC input audit> <geography crosscheck> <release output>');
 const inventoryBytes=await readFile(inventoryPath),crosscheckBytes=await readFile(crosscheckPath);
 const catalogue=JSON.parse(await readFile('data/election-night-races.json','utf8')).races;
 const aggregateBytes=aggregateInventoryPath?await readFile(aggregateInventoryPath):undefined;
 const {release,excluded}=compilePartialRelease(JSON.parse(inventoryBytes),JSON.parse(crosscheckBytes),catalogue,
   partialReleaseEvidence({aggregate:Boolean(aggregateBytes)}),new Date().toISOString(),aggregateBytes?JSON.parse(aggregateBytes):undefined);
 if(aggregateBytes)release.aggregateInputAuditHash=hash(aggregateBytes);
 release.inputAuditHash=hash(inventoryBytes);release.geographicCrosscheckHash=hash(crosscheckBytes);
 await writeFile(outputPath,JSON.stringify(release,null,2)+'\n');
 console.log(JSON.stringify({modelVersion:release.modelVersion,races:Object.keys(release.races).length,excludedInputPaths:excluded,
  note:'Scope is limited; this does not complete the 506-race publication goal.'}));
}
