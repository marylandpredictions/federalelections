// Public discovery only. Never execute NBC JavaScript or infer a Decision Desk call.
import {createHash} from 'node:crypto';
import {parseNbcResults} from './nbc-provider.mjs';
const HOST='www.nbcnews.com', DATE='2026-11-03';
const oldOrPrimary=/(?:202[0-57-9]|primary|primaries|peacock|preview|\bppe\b)/i;
const challenge=/captcha|verify (?:you are|you're) human|access denied|request blocked|cf-chl-|challenge-platform|unusual traffic|enable javascript and cookies/i;
export function ownedUrl(value,base='https://www.nbcnews.com/'){
  try{const u=new URL(value,base);if(u.protocol!=='https:'||![HOST,'nbcnews.com'].includes(u.hostname)||u.port||u.username||u.password)return null;u.hash='';return u.href;}catch{return null;}
}
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
function tagValue(html,key){
  for(const tag of html.matchAll(/<(?:meta|link)\b[^>]*>/gi)){
    const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m=>[m[1].toLowerCase(),m[3]]));
    if(attrs.property===key||attrs.name===key)return clean(attrs.content);
    if(key==='canonical'&&attrs.rel?.toLowerCase()==='canonical')return attrs.href?.replace(/&amp;/g,'&');
  }
}
export function jsonDocuments(html){
  const docs=[];
  for(const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    if(!/application\/(?:ld\+)?json|__NEXT_DATA__|__NBC.*DATA/i.test(m[1])||m[2].length>4*1024*1024)continue;
    try{docs.push(JSON.parse(m[2]));}catch{}
  }
  return docs;
}
function objects(root){
  const found=[],queue=[{value:root,depth:0}];let seen=0;
  while(queue.length&&seen++<30000){const{value,depth}=queue.pop();if(!value||typeof value!=='object'||depth>24)continue;found.push(value);for(const child of Object.values(value))if(child&&typeof child==='object')queue.push({value:child,depth:depth+1});}
  return found;
}
export function verifyPage({url,finalUrl=url,status,html=''}){
  const final=ownedUrl(finalUrl),reject=reason=>({accepted:false,reason});
  if(status!==200)return reject('HTTP '+status);
  if(!final||new URL(final).pathname==='/')return reject('Not an NBC results URL; homepage/external redirect');
  if(challenge.test(html))return reject('Challenge/access/error page');
  const title=clean(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||tagValue(html,'og:title'));
  if(/\b404\b/.test(title)||/page not found|does not exist|couldn.t find|something went wrong|temporarily unavailable/i.test(title+' '+html.slice(0,1200)))return reject('Soft 404/error page');
  const canonical=ownedUrl(tagValue(html,'canonical')||final,final);
  if(!canonical||new URL(canonical).pathname==='/'||oldOrPrimary.test(new URL(final).pathname+new URL(final).search+' '+new URL(canonical).pathname+new URL(canonical).search+' '+title))return reject('Old election, primary, preview, or non-results canonical');
  if(!/\b2026\b/.test(title)||!/(?:election|midterm)/i.test(title)||!/results/i.test(title)||!/NBC(?:\s+News)?/i.test(title+' '+tagValue(html,'og:site_name')))return reject('Missing NBC 2026 election-results metadata');
  const docs=jsonDocuments(html),nodes=docs.flatMap(objects);
  if(nodes.some(n=>['NewsArticle','Article','ReportageNewsArticle'].includes(n['@type'])))return reject('Article, not a results application');
  const identified=nodes.filter(n=>String(n.electionDate||n.date||'').slice(0,10)===DATE&&(/^(?:GENERAL|GENERAL_ELECTION|2026-general)$/i.test(n.electionType||n.election||n.type||'')||!n.electionType&&!n.election&&!n.type&&/^[A-Z]{2}$/.test(n.stateAbbr||'')&&n.races?.some(r=>r.summary?.raceId&&r.summary?.officeName)));
  if(!identified.length&&nodes.some(n=>/primary|primaries/i.test(n.electionType||n.election||'')))return reject('Explicit primary-only application identity');
  const raceApp=identified.some(n=>Array.isArray(n.races)&&n.races.length&&n.races.some(r=>r.summary?.raceId||r.raceId||r.officeName||r.office||r.type)||Array.isArray(n.offices)&&n.offices.some(o=>/senate|house|governor/i.test(typeof o==='string'?o:JSON.stringify(o))));
  const applicationAsset=/<script\b[^>]*src=["'][^"']*(?:election|firecracker|results)[^"']*\.js(?:[?"'])/i.test(html);
  const applicationMount=/\bdata-election(?:-results)?=["']2026-general["']|\bid=["'](?:election-results-app|nbc-election-results)["']/i.test(html);
  const linked=new Set(discoverUrls(html,final).filter(u=>/2026-elections/.test(u)&&/senate|house|governor|state|results/i.test(u))).size;
  const shell=applicationAsset&&applicationMount&&linked>=2&&/polls? close|awaiting results|expected vote|general election/i.test(clean(html));
  if(!raceApp&&!shell)return reject('No confidently identified general-election results application');
  return {accepted:true,canonical,title,reason:raceApp?'NBC metadata + explicit general-election identity + structured race/office application':'NBC metadata + election application mount/assets + cross-linked results pages',documents:docs};
}
export function discoverUrls(text,base){
  const urls=new Set();
  // Read URLs/config strings only, never evaluate downloaded script text.
  for(const m of String(text).replace(/\\\//g,'/').replace(/\\u002f/gi,'/').replace(/\\u0026/gi,'&').matchAll(/(?:["'`])((?:https:\/\/|\/)[^\s<>"'`\\]{1,1200})(?:["'`])/g)){
    const url=ownedUrl(m[1].replace(/&amp;/g,'&'),base);if(!url)continue;
    const u=new URL(url);if(oldOrPrimary.test(u.pathname+u.search)||/[{}]|%7[bd]/i.test(url)||!/(?:2026|firecracker|election|results|sitemap|\/api\/|\/data\/|\.json|\/_next\/static\/)/i.test(u.pathname+u.search))continue;
    urls.add(url);
  }
  return [...urls].sort();
}
// RFC-style group selection and longest path rule, with allow winning ties.
export function robotsAllowed(text,url,agent='fea-nbc2026-detector'){
  const groups=[];let group=null,hasRules=false;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.replace(/#.*$/,'').trim(),m=line.match(/^([\w-]+)\s*:\s*(.*)$/);if(!m)continue;
    const key=m[1].toLowerCase(),value=m[2].trim();
    if(key==='user-agent'){if(!group||hasRules){group={agents:[],rules:[]};groups.push(group);hasRules=false;}group.agents.push(value.toLowerCase());}
    else if(group&&['allow','disallow'].includes(key)){hasRules=true;if(value)group.rules.push({allow:key==='allow',path:value});}
  }
  const rank=g=>Math.max(-1,...g.agents.map(a=>a==='*'?0:agent.includes(a)?a.length:-1)),best=Math.max(-1,...groups.map(rank));
  if(best<0)return true; // Rules for an unrelated bot do not apply to this agent.
  const path=new URL(url).pathname+new URL(url).search,matches=[];
  for(const g of groups.filter(g=>rank(g)===best))for(const rule of g.rules){const pattern=rule.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\\\$$/,'$');if(new RegExp('^'+pattern).test(path))matches.push({...rule,length:rule.path.replace(/\*/g,'').length});}
  matches.sort((a,b)=>b.length-a.length||Number(b.allow)-Number(a.allow));return !matches.length||matches[0].allow;
}
export class PublicReader{
  constructor({fetchImpl=fetch,log=console.log,maxRequests=28,timeoutMs=8000}={}){Object.assign(this,{fetchImpl,log,maxRequests,timeoutMs});this.requests=0;this.robots=new Map();this.blocked=new Set();}
  async raw(url,limit){
    if(this.requests++>=this.maxRequests)throw Error('Request budget reached');
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),this.timeoutMs);
    try{
      const r=await this.fetchImpl(url,{redirect:'manual',signal:abort.signal,headers:{'User-Agent':'FEA-NBC2026-Detector/1.0 (+https://github.com/marylandpredictions/federalelections)','Accept':'text/html, application/json, text/plain;q=0.9'}});
      if([401,403,429].includes(r.status))this.blocked.add(new URL(url).origin);
      if(r.status>=300&&r.status<400&&r.status!==304)return {status:r.status,location:r.headers.get('location'),text:''};
      if(Number(r.headers.get('content-length'))>limit)throw Error('Response exceeds size limit');
      const chunks=[];let bytes=0;
      if(r.body?.getReader){const reader=r.body.getReader();try{while(true){const{value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw Error('Response exceeds size limit');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}}
      else{const value=await r.text();bytes=Buffer.byteLength(value);if(bytes>limit)throw Error('Response exceeds size limit');chunks.push(Buffer.from(value));}
      return {status:r.status,text:Buffer.concat(chunks).toString('utf8'),contentType:r.headers.get('content-type')||''};
    }finally{clearTimeout(timer);}
  }
  async allowed(url){
    const origin=new URL(url).origin;if(this.blocked.has(origin))return false;
    if(!this.robots.has(origin)){
      let policy=null;
      try{let next=origin+'/robots.txt';for(let i=0;i<3;i++){const r=await this.raw(next,256000);this.log(JSON.stringify({url:next,status:r.status,reason:'robots policy'}));if(r.location){const u=new URL(r.location,next);if(u.origin!==origin)break;next=u.href;continue;}if(r.status===404||r.status===410)policy='';else if(r.status===200&&!/<html|<!doctype|captcha|access denied/i.test(r.text))policy=r.text;break;}}catch(e){this.log(JSON.stringify({url:origin+'/robots.txt',reason:e.message}));}
      this.robots.set(origin,policy);
    }
    const policy=this.robots.get(origin);return policy!==null&&!this.blocked.has(origin)&&robotsAllowed(policy,url);
  }
  async get(value){
    const original=ownedUrl(value);let url=original;
    if(!url)return {status:0,finalUrl:value,text:'',error:'Unapproved origin/protocol'};
    try{for(let hops=0;hops<5;hops++){
      if(!await this.allowed(url))throw Error('robots/access policy disallows request');
      const r=await this.raw(url,8*1024*1024);
      if(r.location){const next=ownedUrl(r.location,url);this.log(JSON.stringify({url,status:r.status,finalUrl:next||r.location,result:'redirect'}));if(!next)throw Error('External/unsafe redirect');url=next;continue;}
      if(challenge.test(r.text))this.blocked.add(new URL(url).origin);
      return {...r,finalUrl:url};
    }throw Error('Redirect limit');}catch(error){return {status:0,finalUrl:url,text:'',error:error.message};}
  }
}
export function mappingsForPayload(data,catalogue){
  if(!data||data.electionDate!==DATE||!Array.isArray(data.races)||!/^[A-Z]{2}$/.test(data.stateAbbr))throw Error('Unsupported/missing state general-election JSON identity');
  if(data.electionType&&!/^(?:GENERAL|GENERAL_ELECTION|2026-general)$/i.test(data.electionType))throw Error('Explicit non-general election type');
  const mappings=[],errors=[];
  for(const raw of data.races){
    const summary=raw?.summary;if(!summary)continue;
    const office=String(summary.officeName||'').toLowerCase(),type=office.includes('senate')?'senate':office.includes('house')?'house':office.includes('governor')?'governor':null;
    const district=v=>/^(?:0|AL|AT.LARGE)$/i.test(String(v))?'AL':String(Number(v));
    const matches=catalogue.filter(r=>r.state===data.stateAbbr&&r.type===type&&(type!=='house'||district(r.district)===district(summary.district)));
    if(matches.length!==1)continue;
    const mapping={feaRaceId:matches[0].id,providerRaceId:String(summary.raceId??raw.raceId??raw.id??'')};if(!mapping.providerRaceId)continue;
    try{parseNbcResults(data,{races:[mapping],projection:{verified:false}},catalogue);mappings.push(mapping);}catch(error){errors.push({race:mapping.feaRaceId,reason:error.message});}
  }
  if(new Set(mappings.map(m=>m.feaRaceId)).size!==mappings.length||new Set(mappings.map(m=>m.providerRaceId)).size!==mappings.length)throw Error('Ambiguous/duplicate race mappings');
  return {mappings:mappings.sort((a,b)=>a.feaRaceId.localeCompare(b.feaRaceId)),errors};
}
export function seedUrls(now=new Date()){
  const base='https://www.nbcnews.com/politics/2026-elections';
  // A small fixed family plus rotating state samples; discovered links take priority.
  const states=['ohio','texas','georgia','pennsylvania','michigan','arizona','north-carolina','wisconsin','california','florida','new-york','nevada'];
  const offset=Math.floor(+now/300000)%states.length;
  return [base,base+'/senate-results',base+'/house-results',base+'/governor-results',base+'/senate',base+'/house',base+'/governor',base+'/'+states[offset]+'-results'];
}
const signature=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function detect({config,catalogue,reader=new PublicReader(),now=new Date(),seeds=seedUrls(now),log=console.log}={}){
  const prior=config.automaticDiscovery;
  if(!catalogue?.length)throw Error('Empty election catalogue');
  if(prior?.status==='ACTIVE'&&prior.pageUrls?.length&&catalogue.every(r=>config.sources.some(s=>s.status==='CONFIRMED'&&s.election==='2026-general'&&s.races?.some(m=>m.feaRaceId===r.id))))return {changed:false,config,reason:'Already activated; no NBC requests needed'};
  const next=structuredClone(config),pages=new Set(prior?.pageUrls||[]),trusted=new Set(),feeds=new Map(),visited=new Set(),queue=[...seeds,...[...pages].slice(0,2)],assets=[];
  // Previously verified pages may expose additional data endpoints on later checks.
  while(queue.length&&visited.size<18){
    const url=queue.shift();if(visited.has(url))continue;visited.add(url);
    const r=await reader.get(url),verdict=verifyPage({url,finalUrl:r.finalUrl,status:r.status,html:r.text});
    log(JSON.stringify({url,status:r.status,finalUrl:r.finalUrl,result:verdict.accepted?'ACCEPT':'REJECT',reason:r.error||verdict.reason}));
    // A coverage/hub page is never activation evidence, but may link to the real
    // application under a different route. Follow only bounded owned 2026 links.
    if(r.status===200&&ownedUrl(r.finalUrl)&&!challenge.test(r.text))for(const link of discoverUrls(r.text,r.finalUrl))if(/2026/.test(link)&&/election|results/i.test(new URL(link).pathname)&&!(/\.(?:js|json)(?:\?|$)|\/api\/|\/firecracker\//.test(link))&&!visited.has(link)&&!queue.includes(link))queue.push(link);
    if(!verdict.accepted)continue;
    // Keep a few stable entry points, not an ever-growing list of every state
    // page. Feed provenance still records its exact verified parent page.
    if(pages.size<4)pages.add(verdict.canonical);trusted.add(verdict.canonical);
    const links=discoverUrls(r.text,r.finalUrl),offset=links.length?Math.floor(+now/300000)%links.length:0;
    for(const link of [...links.slice(offset),...links.slice(0,offset)]){
      if(/\.(?:js)(?:\?|$)/.test(link)){if(assets.length<3)assets.push({url:link,page:verdict.canonical});}
      else if(/\/firecracker\/|\.json(?:\?|$)|\/api\//.test(link))feeds.set(link,verdict.canonical);
      else if(!visited.has(link)&&!queue.includes(link))queue.push(link);
    }
    for(const doc of verdict.documents)for(const node of objects(doc))if(node.stateAbbr&&node.races&&node.electionDate===DATE){
      // Embedded JSON verifies the application, but is not a polling endpoint.
      log(JSON.stringify({url:verdict.canonical,result:'APP_DATA',reason:'Embedded state data found; seeking its referenced JSON endpoint'}));break;
    }
  }
  for(const asset of assets){const r=await reader.get(asset.url);log(JSON.stringify({url:asset.url,status:r.status,finalUrl:r.finalUrl,result:'ASSET',reason:r.error||'Inspect referenced application URLs only'}));if(r.status===200&&!challenge.test(r.text))for(const u of discoverUrls(r.text,r.finalUrl))if(/\/firecracker\/|\.json(?:\?|$)|\/api\//.test(u))feeds.set(u,asset.page);}
  const reserved=new Set(next.sources.flatMap(s=>s.races||[]).map(m=>m.feaRaceId));
  const covered=new Set(next.sources.filter(s=>s.status==='CONFIRMED'&&s.election==='2026-general').flatMap(s=>s.races||[]).map(m=>m.feaRaceId));let added=0;
  const existingUrls=new Set(next.sources.map(s=>s.url));
  const feedCandidates=[...feeds].sort(([a],[b])=>Number(existingUrls.has(a))-Number(existingUrls.has(b))||a.localeCompare(b));
  for(const[url,page]of feedCandidates.slice(0,8)){
    if(!trusted.has(page))continue;
    const r=await reader.get(url);let reason=r.error||'Not a supported JSON response',accepted=false;
    if(r.status===200&&!challenge.test(r.text))try{
      const data=JSON.parse(r.text),result=mappingsForPayload(data,catalogue),mappings=result.mappings.filter(m=>!reserved.has(m.feaRaceId));
      for(const error of result.errors)log(JSON.stringify({url,result:'RACE_REJECT',...error}));
      if(mappings.length){
        if(new URL(r.finalUrl).hostname!==HOST)throw Error('Adapter requires production www.nbcnews.com');
        const existing=next.sources.find(s=>s.url===r.finalUrl&&s.discovery?.method==='NBC_2026_GENERAL_APP_AND_SCHEMA_V1');
        if(existing){existing.races.push(...mappings);existing.discovery.mappingFingerprint=signature(existing.races);}else next.sources.push({url:r.finalUrl,status:'CONFIRMED',election:'2026-general',races:mappings,projection:{verified:false},discovery:{method:'NBC_2026_GENERAL_APP_AND_SCHEMA_V1',pageUrl:page,verifiedAt:now.toISOString(),mappingFingerprint:signature(mappings)}});
        for(const m of mappings){covered.add(m.feaRaceId);reserved.add(m.feaRaceId);}added+=mappings.length;
      }
      accepted=result.mappings.length>0;reason=accepted?'Existing strict adapter and complete local roster matched; projections NOT authorized':'No compatible mapped races';
    }catch(error){reason=error.message;}
    log(JSON.stringify({url,status:r.status,finalUrl:r.finalUrl,result:accepted?'DATA_ACCEPT':'DATA_REJECT',reason}));
  }
  if(!pages.size)return {changed:false,config,reason:'No verified NBC general-election application'};
  const status=catalogue.every(r=>covered.has(r.id))?'ACTIVE':covered.size?'DATA_PARTIAL':'PAGE_CONFIRMED';
  const pageUrls=[...pages].sort();
  if(!prior||JSON.stringify(prior.pageUrls)!==JSON.stringify(pageUrls)||prior.status!==status||added){next.automaticDiscovery={status,election:'2026-general',pageUrls,firstDetectedAt:prior?.firstDetectedAt||now.toISOString(),configuredRaceCount:covered.size,projectionPolicy:'Unverified Decision Desk flags remain disabled'};}
  const changed=JSON.stringify(next)!==JSON.stringify(config);
  if(changed){log('NBC 2026 GENERAL-ELECTION RESULTS DETECTED');for(const url of pageUrls)log('Canonical NBC results: '+url);log(`Configured ${covered.size}/${catalogue.length} races. Decision Desk projection inference remains disabled.`);}
  return {changed,config:changed?next:config,reason:changed?'Verified application/configuration advanced':'Verified configuration unchanged'};
}
