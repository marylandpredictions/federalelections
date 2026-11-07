// County data comes from the updateUrl declared by NBC's public race page,
// not the national party/race rollups. This adapter has no call authority.
import {matchBallotCandidate, genericName} from './candidate-roster.mjs';
import {percent,nbcReportingUnitBallotAccounting} from './nbc-provider.mjs';
import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
const fips = {AL:'01',AK:'02',AZ:'04',AR:'05',CA:'06',CO:'08',CT:'09',DE:'10',DC:'11',FL:'12',GA:'13',HI:'15',ID:'16',IL:'17',IN:'18',IA:'19',KS:'20',KY:'21',LA:'22',ME:'23',MD:'24',MA:'25',MI:'26',MN:'27',MS:'28',MO:'29',MT:'30',NE:'31',NV:'32',NH:'33',NJ:'34',NM:'35',NY:'36',NC:'37',ND:'38',OH:'39',OK:'40',OR:'41',PA:'42',RI:'44',SC:'45',SD:'46',TN:'47',TX:'48',UT:'49',VT:'50',VA:'51',WA:'53',WV:'54',WI:'55',WY:'56'};
const officeCode={house:'H',senate:'S',governor:'G'};
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function nbcRacePage(value) {
  const u=new URL(value,'https://www.nbcnews.com');
  if(u.origin!=='https://www.nbcnews.com'||u.username||u.password||u.search||u.hash||!/^\/politics\/2026-(?:special-)?elections\/[a-z0-9-]+-results$/.test(u.pathname))throw Error('Invalid NBC race page');
  return u.href;
}
export function nbcCountyPage(race) {
  if (race?.provider !== 'NBC' || race.providerScope !== 'national' || !race.providerPageUrl) return null;
  try { return nbcRacePage(race.providerPageUrl); } catch { return null; }
}
const houseDistrict=value=>/^(AL|0)$/i.test(String(value))?1:Number(value);
function validate(data,race) {
  if(data?.brand!=='news'||data.electionDate!=='2026-11-03'||String(data.electionSeason)!=='2026'||data.electionType!=='general'||data.stateAbbr!==race.state||data.enableLivePreview===true)throw Error('NBC county election identity mismatch');
  const district=houseDistrict(race.district);
  const matching=data.races?.filter(r=>r.summary?.officeCode===officeCode[race.type]&&(race.type!=='house'||Number(r.summary.district)===district));
  if(matching?.length!==1)throw Error('NBC county race/district missing or ambiguous');
  // The rendered page uses true; its update API uses the literal "special".
  const r=matching[0],special=race.type==='senate'&&['FL','OH'].includes(race.state)&&[true,'special'].includes(data.isSpecial)&&new URL(race.providerPageUrl).pathname.startsWith('/politics/2026-special-elections/');
  const expected=race.type==='house'?`2026-11-03~${race.state}${String(district).padStart(3,'0')}~H`:`2026-11-03${special?'P':''}~${race.state}~${officeCode[race.type]}`;
  if(r.electionDate!=='2026-11-03'||r.summary.raceId!==expected||r.summary.electionTypeCode!==(special?'P':'G'))throw Error('NBC county race identity mismatch');
  return r;
}
export function countyGeographies(data,race,localFeatures=[]) {
  const lookup=new Map();
  const add=(name,id)=>{const key=normalize(name);if(!key)return;const ids=lookup.get(key)||new Set();ids.add(id);lookup.set(key,ids);};
  // NBC's older township topology sometimes has an incorrect COUNTYFP or an
  // older town name. Prefer the current Census names, but never resolve a name
  // shared by two municipalities without an explicit geographic identifier.
  for(const f of localFeatures){const p=f.properties||{},id=String(p.GEOID||f.id||'');if(/^\d{10}$/.test(id)&&id.startsWith(fips[race.state]))for(const n of [p.NAME,p.NAMELSAD])if(n)add(n,id);}
  for(const topology of Object.values(data.topojsons||{}))for(const object of Object.values(topology?.objects||{}))for(const g of object.geometries||[]) {
    const p=g.properties||{};let id=String(p.GEOID||g.id||'');
    if(!/^\d{10}$/.test(id)&&p.COUNTYFP){
      const matches=localFeatures.filter(f=>f.properties.STATEFP===fips[race.state]&&f.properties.COUNTYFP===String(p.COUNTYFP).padStart(3,'0')&&normalize(f.properties.NAME)===normalize(p.TOWN||p.NAME));
      if(matches.length===1)id=String(matches[0].properties.GEOID||matches[0].id);
    }
    if(!/^\d{10}$/.test(id)||!id.startsWith(fips[race.state]))continue;
    for(const name of new Set([p.TOWN,p.NAME,p.NAMELSAD,p.NAMELSAD?.replace(/ (?:town|city|plantation|township)$/i,'')].filter(Boolean))) {
      add(name,id);
    }
  }
  return lookup;
}
export function parseNbcCounties(data,race,{lookup=countyGeographies(data,race),previous=race.counties||[],onInvalid=()=>{}}={}) {
  const raw=validate(data,race),updated=Date.parse(data.currentTime||data.lastModified);
  if(!Number.isFinite(updated)||updated>Date.now()+120000)throw Error('Invalid NBC county timestamp');
  let map=raw.mapData;
  if(race.type==='house')map=map?.[String(houseDistrict(race.district)).padStart(2,'0')]?.counties;
  if(!map||typeof map!=='object'||Array.isArray(map)||!Object.keys(map).length)throw Error('NBC county breakdown missing');
  if(Object.keys(map).length>5000)throw Error('Implausible NBC county count');
  // Resolve explicit full names first. For example "Lincoln plantation" and
  // "Lincoln" must not both be assigned to the first Census Lincoln record.
  // A remaining name is usable only when the other unit is uniquely accounted
  // for by the same response; unresolved duplicate names stay quarantined.
  const identities=new Map(),used=new Set();
  for(let pass=0;pass<16;pass++){
    const claims=new Map();
    for(const [key,a]of Object.entries(map))if(!identities.has(key)){
      const options=(/^(?:\d{5}|\d{10})$/.test(key)?[key]:[...(lookup.get(normalize(a?.raceName||key))||[])]).filter(id=>!used.has(id));
      if(options.length===1){const keys=claims.get(options[0])||[];keys.push(key);claims.set(options[0],keys);}
    }
    let added=0;for(const [id,keys]of claims)if(keys.length===1){identities.set(keys[0],id);used.add(id);added++;}
    if(!added)break;
  }
  const counties=[],seen=new Set();
  for(const [key,a]of Object.entries(map))try {
    const id=identities.get(key);if(!id)throw Error('Local reporting unit has no unique GEOID');
    if(!id.startsWith(fips[race.state])||seen.has(id))throw Error('County geography mismatch or duplicate');
    if(genericName(a.raceName)||!Array.isArray(a.candidates)||!a.candidates.length||a.candidates.length>50)throw Error('Invalid county name/roster');
    const candidates=a.candidates.map(c=>{
      if(!Number.isSafeInteger(c.votes)||c.votes<0)throw Error('Invalid county votes');
      const matched=matchBallotCandidate({name:c.name},race.candidates);
      return {...matched,votes:c.votes,percent:0,winner:false,isWinner:false};
    });
    if(new Set(candidates.map(c=>c.name)).size!==candidates.length)throw Error('Duplicate county candidates');
    const total=candidates.reduce((n,c)=>n+c.votes,0);
    const ballotAccounting=nbcReportingUnitBallotAccounting(race,a.totalVote,candidates,a.candidates);
    if(!Number.isSafeInteger(total)||!ballotAccounting&&total!==a.totalVote)throw Error('County total does not match candidate votes');
    const denominator=ballotAccounting?.reportedBallots??total;
    const old=previous.find(c=>c.fips===id);
    if(old&&Date.parse(old.lastUpdated||'')>updated)throw Error('Regressed county timestamp');
    const oldTotal=(old?.candidates||[]).reduce((n,c)=>n+c.votes,0);
    if(oldTotal>0&&total===0||oldTotal>=100&&total<oldTotal*.5)throw Error('County vote reset; last good retained');
    for(const c of candidates){if(old?.candidates?.some(p=>p.name===c.name&&p.votes>=100&&c.votes===0))throw Error('County candidate vote reset');c.percent=denominator?c.votes/denominator*100:0;}
    counties.push({fips:id,name:a.raceName,type:id.length===10?'Town':'County',candidates,
      ...(ballotAccounting?{providerBallotAccounting:ballotAccounting}:{}),
      estimatedVoteReporting:percent(a.percentIn),percentReporting:null,lastUpdated:new Date(updated).toISOString(),source:'NBC News'});seen.add(id);
  }catch(error){onInvalid({county:key,reason:error.message});}
  if(!counties.length)throw Error('No healthy NBC county results');
  // Partial/malformed responses cannot erase previously published counties.
  return [...counties,...previous.filter(c=>!seen.has(c.fips))].sort((a,b)=>a.fips.localeCompare(b.fips));
}

// Some NBC town maps collapse identically named cities and towns into one
// object key. The source's areas array retains both counts. They can still be
// assigned to a county when every matching Census geography has that county.
export function parseNbcCountyAggregates(data,race,{lookup=countyGeographies(data,race)}={}) {
  const raw=validate(data,race),updated=Date.parse(data.currentTime||data.lastModified);
  if(!Number.isFinite(updated)||updated>Date.now()+120000)throw Error('Invalid NBC county timestamp');
  if(!['ME','MA','NH','CT','RI','VT'].includes(race.state)||!Array.isArray(raw.areas)||
      !raw.areas.length||raw.areas.length>5000)throw Error('No supported municipal count array');
  const byCounty=new Map(),names=new Map(race.candidates.map(c=>[c.name,c]));
  for(const area of raw.areas){
    const options=[...(lookup.get(normalize(area.name))||[])];
    const counties=new Set(options.map(id=>id.slice(0,5)));
    if(!options.length||counties.size!==1)throw Error('Municipality has no unique parent county: '+area.name);
    const [id]=counties;
    if(!/^\d{5}$/.test(id)||!id.startsWith(fips[race.state]))throw Error('Municipality county identity mismatch');
    if(!Array.isArray(area.candidates)||!area.candidates.length)throw Error('Missing municipal candidate counts');
    const votes=new Map();
    for(const candidate of area.candidates){
      const matched=matchBallotCandidate({name:candidate.name},race.candidates);
      if(!Number.isSafeInteger(candidate.votes)||candidate.votes<0||votes.has(matched.name))
        throw Error('Invalid or duplicate municipal candidate count');
      votes.set(matched.name,candidate.votes);
    }
    if(votes.size!==names.size||[...names.keys()].some(name=>!votes.has(name))||
        [...votes.values()].reduce((sum,value)=>sum+value,0)!==area.votes)
      throw Error('Municipality count does not reconcile to its full ballot');
    const total=byCounty.get(id)||new Map([...names.keys()].map(name=>[name,0]));
    for(const [name,value] of votes){
      const next=total.get(name)+value;
      if(!Number.isSafeInteger(next))throw Error('Unsafe aggregated county votes');
      total.set(name,next);
    }
    byCounty.set(id,total);
  }
  const expected=new Map();
  for(const candidate of raw.summary.candidates){
    const matched=matchBallotCandidate({name:candidate.name},race.candidates);
    if(!Number.isSafeInteger(candidate.votes)||candidate.votes<0||expected.has(matched.name))
      throw Error('Invalid municipal race summary');
    expected.set(matched.name,candidate.votes);
  }
  if(expected.size!==names.size||[...names.keys()].some(name=>!expected.has(name)||
      [...byCounty.values()].reduce((sum,county)=>sum+county.get(name),0)!==expected.get(name))||
      [...expected.values()].reduce((sum,value)=>sum+value,0)!==raw.summary.votes)
    throw Error('Municipality array does not reconcile to the race summary');
  return [...byCounty].sort(([a],[b])=>a.localeCompare(b)).map(([id,votes])=>{
    const total=[...votes.values()].reduce((sum,value)=>sum+value,0);
    return {fips:id,type:'County',source:'NBC News',lastUpdated:new Date(updated).toISOString(),
      estimatedVoteReporting:null,percentReporting:null,
      candidates:[...votes].map(([name,count])=>({...names.get(name),votes:count,winner:false,isWinner:false,
        percent:total?100*count/total:0}))};
  });
}
// Alaska's NBC feed uses state House districts. Retain their actual identity
// for private model inputs; never invent Census FIPS codes or borough counts.
export function parseNbcNativeReportingUnits(data,race) {
  const raw=validate(data,race),updated=Date.parse(data.currentTime||data.lastModified);
  if(race.state!=='AK'||data.underlyingGeographies!=='legislativeDistricts'||
      !Array.isArray(raw.areas)||raw.areas.length<40||raw.areas.length>41||
      !Number.isFinite(updated)||updated>Date.now()+120000)throw Error('Unsupported native reporting-unit source');
  const roster=new Map(race.candidates.map(c=>[c.name,c]));
  if(roster.size!==race.candidates.length)throw Error('Duplicate native ballot candidate');
  const totals=new Map([...roster.keys()].map(name=>[name,0])),seen=new Set();
  const units=raw.areas.map(area=>{
    const match=/^State House District ([1-9]|[1-3]\d|40)$/.exec(area.name);
    const overseas=area.name==='Overseas Absentee';
    const id=overseas?'AK-OA':match?'AK-HD-'+match[1].padStart(2,'0'):null;
    if(!id||seen.has(id))throw Error('Missing or duplicate Alaska state House district');
    seen.add(id);
    if(!Array.isArray(area.candidates)||area.candidates.length!==roster.size)throw Error('Native reporting unit has an incomplete ballot');
    const votes=new Map();
    for(const candidate of area.candidates){
      const matched=matchBallotCandidate({name:candidate.name},race.candidates);
      if(!Number.isSafeInteger(candidate.votes)||candidate.votes<0||votes.has(matched.name))
        throw Error('Invalid native candidate count');
      votes.set(matched.name,candidate.votes);
    }
    const total=[...votes.values()].reduce((sum,n)=>sum+n,0);
    if(!Number.isSafeInteger(total)||total!==area.votes||[...roster.keys()].some(name=>!votes.has(name)))
      throw Error('Native reporting-unit ballot does not reconcile');
    for(const [name,count] of votes){
      const next=totals.get(name)+count;
      if(!Number.isSafeInteger(next))throw Error('Unsafe native reporting-unit count');
      totals.set(name,next);
    }
    const percent=Number.isFinite(area.percentIn)&&area.percentIn>=0&&area.percentIn<=100?area.percentIn:null;
    return {id,name:area.name,reportingUnitType:overseas?'overseas-absentee':'state-house-district',
      source:'NBC News',lastUpdated:new Date(updated).toISOString(),estimatedVoteReporting:percent,
      candidates:[...votes].map(([name,count])=>({...roster.get(name),votes:count,
        winner:false,isWinner:false,percent:total?100*count/total:0}))};
  });
  if(Array.from({length:40},(_,i)=>'AK-HD-'+String(i+1).padStart(2,'0')).some(id=>!seen.has(id)))
    throw Error('Missing or duplicate Alaska state House district');
  const summary=new Map();
  for(const candidate of raw.summary.candidates){
    const matched=matchBallotCandidate({name:candidate.name},race.candidates);
    if(!Number.isSafeInteger(candidate.votes)||candidate.votes<0||summary.has(matched.name))throw Error('Invalid native race summary');
    summary.set(matched.name,candidate.votes);
  }
  if(summary.size!==roster.size||[...totals].some(([name,count])=>summary.get(name)!==count)||
      [...totals.values()].reduce((sum,n)=>sum+n,0)!==raw.summary.votes)throw Error('Native reporting units do not reconcile to the race');
  return units.sort((a,b)=>a.id.localeCompare(b.id));
}

export class NbcCountyProvider {
  constructor({fetchImpl=fetch,now=()=>Date.now(),root=process.cwd()}={}) {Object.assign(this,{fetchImpl,now,root});this.cache=new Map();this.cacheLimit=64;this.inflight=new Map();this.active=new Map();this.errors=new Map();this.running=0;this.retryAt=0;this.localLookups=new Map();}
  async localFeatures(state) {
    if(!['ME','MA','NH','CT','RI','VT'].includes(state))return [];
    if(!this.localLookups.has(state))this.localLookups.set(state,(async()=>{
      const manifest=JSON.parse(await readFile(resolve(this.root,'data/results/map-assets.json'),'utf8')),path=manifest.municipalities?.[fips[state]]?.path;
      if(!/^data\/results\/maps\/municipalities-\d{2}\.[a-f0-9]+\.json\.gz$/.test(path||''))throw Error('Local reporting geometry manifest missing');
      return JSON.parse(gunzipSync(await readFile(resolve(this.root,path))).toString('utf8')).features.map(({id,properties})=>({id,properties}));
    })().catch(error=>{this.localLookups.delete(state);throw error;}));
    return this.localLookups.get(state);
  }
  watch(race){this.active.delete(race.id);this.active.set(race.id,this.now());while(this.active.size>64)this.active.delete(this.active.keys().next().value);}
  modelCountiesFor(race) {
    const cached=this.cache.get(race.id);
    return cached?.page===nbcCountyPage(race)?cached.modelCounties:undefined;
  }
  modelUnitsFor(race) {
    const cached=this.cache.get(race.id);
    return cached?.page===nbcCountyPage(race)?cached.modelUnits:undefined;
  }
  async read(url,json=false,cached) {
    const response=await this.fetchImpl(url,{signal:AbortSignal.timeout(6000),redirect:'error',headers:{Accept:json?'application/json':'text/html','User-Agent':'FEA-Election-Results/1.0 (+https://github.com/marylandpredictions/federalelections)',...(cached?.etag?{'If-None-Match':cached.etag}:{})}});
    const retryAfter=response.headers?.get('retry-after');
    if(response.status===429||(response.status===503&&retryAfter)){
      const now=this.now(),until=/^\d+$/.test(retryAfter||'')?now+1000*Number(retryAfter):Date.parse(retryAfter);
      this.retryAt=Math.max(this.retryAt,Number.isFinite(until)&&until>now?until:now+60000);
    }
    if(response.status===304&&cached)return {unchanged:true};
    if(!response.ok)throw Error(`NBC county HTTP ${response.status}`);
    const body=await response.text();if(body.length>12000000)throw Error('NBC county payload too large');
    const data=json?JSON.parse(body):JSON.parse(body.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)?.[1]||'null')?.props?.pageProps;
    return {data,etag:response.headers?.get('etag')};
  }
  availableRequests() {
    return this.now()<this.retryAt?0:4-this.running;
  }
  async fetchCountyBatch(races) {
    const results=new Map();
    let cursor=0;
    await Promise.all(Array.from({length:Math.min(4,races.length)},async()=>{
      while(cursor<races.length){
        const race=races[cursor++],counties=await this.fetchCounties(race,{watch:false});
        if(counties?.length||this.modelUnitsFor(race)?.length)results.set(race.id,counties||[]);
      }
    }));
    return results;
  }
  async fetchCounties(race,{watch=true}={}) {
    if(race.provider!=='NBC'||race.providerScope!=='national'||!race.providerPageUrl)return null;
    const page=nbcCountyPage(race);
    if(!page){this.errors.set(race.id,'Invalid NBC race page');return null;}
    if(watch)this.watch(race);
    const entry=this.cache.get(race.id),cached=entry?.page===page?entry:null;
    if(cached&&this.now()-cached.at<15000)return cached.counties;
    const requestKey=JSON.stringify([race.id,page]);
    if(this.inflight.has(requestKey))return this.inflight.get(requestKey);
    // Never turn arbitrary public detail requests into an unbounded upstream fan-out.
    if(!this.availableRequests())return null;
    this.running++;
    const task=Promise.resolve().then(async()=>{try {
      const result=await this.read(cached?.endpoint||page,!!cached?.endpoint,cached?.endpoint?cached:null);
      if(result.unchanged){cached.at=this.now();this.errors.delete(race.id);return cached.counties;}
      const data=result.data;validate(data,race);
      const endpoint=new URL(data.updateUrl);
      if(endpoint.origin!=='https://www.nbcnews.com'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!==new URL(page).pathname.replace('/politics/','/firecracker/api/v2/state-results/'))throw Error('NBC county updateUrl does not match public race page');
      const lookup=cached?.lookup||countyGeographies(data,race,await this.localFeatures(race.state)),issues=[];
      const modelUnits=race.state==='AK'?parseNbcNativeReportingUnits(data,race):undefined;
      const counties=modelUnits?[]:parseNbcCounties(data,race,{lookup,previous:race.counties,onInvalid:i=>issues.push(i)});
      let modelCounties;
      if(['ME','MA','NH','CT','RI','VT'].includes(race.state)){
        try{modelCounties=parseNbcCountyAggregates(data,race,{lookup});}catch{/* Incomplete parent geography stays unavailable to the model. */}
      }
      const error=issues.length?`${issues.length} reporting units retained/skipped: ${issues[0].reason}`:null;
      if(error)this.errors.set(race.id,error);else this.errors.delete(race.id);
      // Store normalized rows, never the multi-megabyte HTML/topology response.
      this.cache.delete(race.id);this.cache.set(race.id,{page,at:this.now(),endpoint:endpoint.href,lookup,counties,modelCounties,modelUnits,etag:cached?.endpoint?result.etag:null});
      while(this.cache.size>this.cacheLimit)this.cache.delete(this.cache.keys().next().value);
      return counties;
    }catch(error){if(this.errors.get(race.id)!==error.message)console.warn(JSON.stringify({event:'county-provider-failed',race:race.id,reason:error.message}));this.errors.set(race.id,error.message);this.cache.set(race.id,{...cached,page,at:this.now(),counties:cached?.counties||race.counties||[]});while(this.cache.size>this.cacheLimit)this.cache.delete(this.cache.keys().next().value);return null;}finally{this.running--;this.inflight.delete(requestKey);}});
    this.inflight.set(requestKey,task);return task;
  }
  async refresh(races) {
    for(const [id,at]of this.active)if(this.now()-at>120000)this.active.delete(id);
    const wanted=races.filter(r=>this.active.has(r.id)).sort((a,b)=>(this.cache.get(a.id)?.at||0)-(this.cache.get(b.id)?.at||0)).slice(0,8);
    const batches=await this.fetchCountyBatch(wanted);
    for(const race of wanted)if(batches.has(race.id)){
      race.counties=batches.get(race.id);
      race.probabilityCounties=this.modelCountiesFor(race);
      race.probabilityUnits=this.modelUnitsFor(race);
    }
  }
}
