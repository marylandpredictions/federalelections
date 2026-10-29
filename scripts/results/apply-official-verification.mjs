// Apply independently extracted authority facts only when the complete reviewed
// roster matches one-to-one. This never imports votes, calls or predictions.
import {matchBallotCandidate} from './candidate-roster.mjs';
export function verifyOfficialRoster(race, source, facts, metadata, aliases={}){
  if(!metadata.authority||!/^https:\/\//.test(metadata.sourceUrl)||metadata.electionDate!=='2026-11-03'||!Number.isFinite(Date.parse(metadata.checkedAt))||!/^[a-f0-9]{64}$/.test(metadata.sha256))throw Error('Incomplete official provenance');
  if(facts.length!==race.candidates.length)throw Error('Official candidate count differs: '+race.id);
  const used=new Set(),key=v=>String(v).toLowerCase().replace(/[^a-z]/g,'');
  const candidates=facts.map(fact=>{
    let local;
    try{local=matchBallotCandidate(fact,race.candidates);}catch(error){
      if(!aliases[fact.name])throw error;
      local=matchBallotCandidate({...fact,name:aliases[fact.name]},race.candidates);
    }
    if(used.has(local.name))throw Error('Duplicate official identity');used.add(local.name);
    const a=key(fact.party),b=key(local.partyCode||local.party);
    const equivalent=a===b||race.state==='CO'&&((a==='forwardparty'&&b==='coloradoforwardparty')||(a==='c'&&b==='americanconstitutionparty')||(a==='americanconstitutionparty'&&b==='c'));
    if(!equivalent)throw Error('Official party differs: '+race.id+': '+fact.name);
    return {...fact,name:local.name,ballotName:fact.name,party:local.partyCode||local.party};
  });
  const verification={...metadata,status:'OFFICIAL_SOURCE_VERIFIED',candidates};
  source.previousReview||={sourceName:source.sourceName,sourceUrl:source.sourceUrl,checkedAt:source.checkedAt};
  Object.assign(source,{official:true,completeReview:true,sourceName:metadata.authority,sourceUrl:metadata.sourceUrl,checkedAt:metadata.checkedAt,verification});
  for(const rows of [source.candidates,race.candidates])for(const c of rows){
    const fact=candidates.find(k=>k.name===c.name);if(!fact)throw Error('Reviewed source identity differs');
    c.rosterSource=metadata.sourceUrl;
    if(fact.ballotName!==c.name)c.aliases=[...new Set([...(c.aliases||[]),fact.ballotName])];
    if(fact.writeIn)c.writeIn=true;
  }
  Object.assign(race,{rosterVerified:true,rosterReviewed:true,rosterSource:metadata.sourceUrl,candidateStatus:'Official ballot roster: '+metadata.authority+'.',rosterVerification:{...metadata,status:verification.status}});
  return verification;
}
