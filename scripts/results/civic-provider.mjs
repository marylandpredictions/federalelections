// CivicAPI is a secondary vote source. It has no authority over NBC calls.
import {NbcProvider,percent} from './nbc-provider.mjs';
import {genericName,matchBallotCandidate} from './candidate-roster.mjs';
const offices={house:'House of Representatives',senate:'US Senate',governor:'Governor'};
const party=p=>({Democratic:'D',Republican:'R',Independent:'I',Libertarian:'L',Green:'G','No Party Affiliation':'NP','Nonpartisan':'NP','Write-In':'O'})[p]||String(p||'').toUpperCase();
const district=r=>`${r.state}-${/^(AL|0)$/i.test(String(r.district))?'AL':String(Number(r.district)).padStart(2,'0')}`;
export function parseCivicRace(raw,mapping,local,reference=local,{now=Date.now()}={}) {
 if(!raw||raw.test_data!==false||raw.is_disputed===true||raw.country!=='US'||raw.province!==local.state||raw.election_type!==offices[local.type]||!['General','Statewide'].includes(raw.election_scope)||String(raw.election_date).slice(0,10)!=='2026-11-03'||raw.municipality||raw.election_name!==mapping.electionName||String(mapping.feaRaceId)!==local.id)throw Error('CivicAPI election identity mismatch or test/disputed data');
 if(local.type==='house'?raw.district!==district(local):raw.district!==null)throw Error('CivicAPI district mismatch');
 const updated=Date.parse(raw.last_updated);if(!Number.isFinite(updated)||updated>now+120000)throw Error('Invalid CivicAPI timestamp');
 if(!Array.isArray(raw.candidates)||!raw.candidates.length||raw.candidates.length>50)throw Error('Invalid CivicAPI candidate roster');
 const candidates=raw.candidates.map(c=>{
  if(genericName(c.name)||typeof c.party!=='string'||!c.party.trim()||!Number.isSafeInteger(c.votes)||c.votes<0||!Number.isSafeInteger(c.candidate_id))throw Error('Malformed CivicAPI candidate/votes');
  let matched;try{matched=matchBallotCandidate({name:c.name},reference.candidates);}catch(e){if(!e.message.startsWith('Unknown provider candidate:'))throw e;}
  const code=party(c.party);if(['D','R'].includes(code)&&(!matched||code!==(matched.partyCode||matched.party)))throw Error('CivicAPI major candidate does not match the known ballot');
  return {...matched,id:matched?.id||`civic-${c.candidate_id}`,name:matched?.name||c.name,providerName:c.name,party:matched?.party||code,partyCode:matched?.partyCode||code,partyLabels:[c.party],votes:c.votes,percent:null,winner:false,isWinner:false};
 });
 if(new Set(candidates.map(c=>c.name)).size!==candidates.length||new Set(raw.candidates.map(c=>c.candidate_id)).size!==candidates.length||reference.candidates.some(c=>!candidates.some(k=>k.name===c.name)))throw Error('Duplicate or incomplete CivicAPI ballot roster');
 const total=candidates.reduce((n,c)=>n+c.votes,0);if(!Number.isSafeInteger(total))throw Error('Unsafe CivicAPI total');
 if(total>0&&now-updated>20*60000)throw Error('Stale CivicAPI result');
 for(const c of candidates)c.percent=total?c.votes/total*100:0;
 return {...local,provider:'CivicAPI',providerScope:'civic-fallback',source:'CivicAPI',sourceUrl:`https://civicapi.org/api/v2/race/${mapping.civicRaceId}`,providerRaceId:String(mapping.civicRaceId),electionDate:'2026-11-03',candidateStatus:'Reported results via CivicAPI fallback',candidates,estimatedVoteReporting:null,expectedVotePercent:null,reportingPercent:null,percentReporting:null,civicReportingPercent:percent(raw.percent_reporting),lastUpdated:new Date(updated).toISOString(),updatedAt:new Date(updated).toISOString(),providerCallVerified:false,providerCall:null,providerRosterReview:{added:candidates.filter(c=>!reference.candidates.some(k=>k.name===c.name)).map(c=>c.name),missing:[],partyChanges:[]},status:'uncalled',counties:[]};
}
export class ResultsProvider {
 constructor(config,{primary,fetchImpl=fetch,now=()=>Date.now()}={}){this.primary=primary||new NbcProvider(config);this.fallback=config.fallback;this.fetchImpl=fetchImpl;this.now=now;this.cache=new Map();this.attempts=new Map();this.quarantined=[];this.cooldownUntil=0;this.retrySoon=false;}
 async fetchResults(catalogue,{lastGood={}}={}) {
  let rows=[],failure;this.retrySoon=false;const secondaryFailures=new Set();try{rows=await this.primary.fetchResults(catalogue);}catch(e){failure=e;}
  this.primaryConnection=rows.length?(this.primary.quarantined?.length?'partial':'connected'):'failed';this.primaryError=failure?.message||null;
  if(this.primaryConnection==='failed'&&this.previousConnection!=='failed')console.warn(JSON.stringify({event:'primary-provider-failed',provider:'NBC',message:this.primaryError}));
  else if(this.previousConnection==='failed'&&this.primaryConnection==='connected')console.info(JSON.stringify({event:'primary-provider-recovered',provider:'NBC'}));
  this.previousConnection=this.primaryConnection;
  const healthy=new Set(rows.map(r=>r.id));this.quarantined=[...(this.primary.quarantined||[])];
  if(this.fallback?.enabled&&this.fallback.provider==='CivicAPI'){
   const mappings=(this.fallback.races||[]).filter(m=>!healthy.has(m.feaRaceId)&&catalogue.some(r=>r.id===m.feaRaceId));
   const queue=this.cooldownUntil>this.now()?[]:mappings.filter(m=>this.now()-(this.attempts.get(m.feaRaceId)??-Infinity)>=60000).sort((a,b)=>(this.attempts.get(a.feaRaceId)||0)-(this.attempts.get(b.feaRaceId)||0)||(a.priority??100)-(b.priority??100)).slice(0,24);
   const deadline=AbortSignal.timeout(10000);let cursor=0;
   await Promise.all(Array.from({length:Math.min(6,queue.length)},async()=>{
    while(cursor<queue.length&&!deadline.aborted&&this.cooldownUntil<=this.now()){const m=queue[cursor++],local=catalogue.find(r=>r.id===m.feaRaceId);this.attempts.set(local.id,this.now());
     try{
      if(!Number.isSafeInteger(m.civicRaceId)||m.civicRaceId<=0)throw Error('Invalid CivicAPI mapping');
      const r=await this.fetchImpl(`https://civicapi.org/api/v2/race/${m.civicRaceId}`,{signal:AbortSignal.any([deadline,AbortSignal.timeout(4000)]),headers:{Accept:'application/json','User-Agent':'FEA-Election-Results/1.0 (+https://github.com/marylandpredictions/federalelections)'}});
      if(!r.ok){if([403,429,500,502,503,504].includes(r.status)){const retry=r.headers?.get('retry-after'),delay=retry?(/^\d+$/.test(retry)?Number(retry)*1000:Date.parse(retry)-this.now()):r.status===403?300000:60000;this.cooldownUntil=this.now()+Math.max(60000,Math.min(600000,Number.isFinite(delay)?delay:60000));}throw Error(`CivicAPI HTTP ${r.status}`);}const b=await r.text();if(b.length>4000000)throw Error('Oversized CivicAPI race');
      const race=parseCivicRace(JSON.parse(b),m,local,lastGood[local.id]||local,{now:this.now()});this.cache.set(local.id,{race,at:this.now()});
     }catch(e){secondaryFailures.add(local.id);this.quarantined=this.quarantined.filter(q=>q.race!==local.id);this.quarantined.push({race:local.id,reason:e.message});}
    }
   }));
   for(const m of mappings){const cached=this.cache.get(m.feaRaceId);if(cached&&this.now()-cached.at<180000){rows.push(cached.race);healthy.add(m.feaRaceId);}}
   this.quarantined=this.quarantined.filter(q=>!healthy.has(q.race)||secondaryFailures.has(q.race));
   this.retrySoon=this.cooldownUntil<=this.now()&&mappings.some(m=>!this.attempts.has(m.feaRaceId));
  }
  if(!rows.length){const secondary=this.quarantined.find(q=>secondaryFailures.has(q.race));if(failure&&secondary)throw Error(`${failure.message}; CivicAPI: ${secondary.reason}`);throw failure||Error('No healthy result sources');}return rows;
 }
}
