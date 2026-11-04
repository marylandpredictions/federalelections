import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {NbcCountyProvider,parseNbcCounties,countyGeographies,nbcRacePage} from '../../scripts/results/nbc-counties.mjs';
import {ResultsControl} from '../../scripts/results/control.mjs';
import {ResultsChangeFeed} from '../../scripts/results/change-feed.mjs';
import vm from 'node:vm';
const samples=JSON.parse(readFileSync('tests/fixtures/nbc-counties-2026.json','utf8'));
const clone=x=>structuredClone(x);
function race(key){const p=samples[key],type=key==='house'?'house':'senate';return {id:`${type}-${p.stateAbbr}${type==='house'?'-4':''}`,state:p.stateAbbr,type,...(type==='house'?{district:4}:{}),provider:'NBC',providerScope:'national',providerPageUrl:p.clientUrl,candidates:p.races[0].summary.candidates.map(c=>({...c,id:String(c.code),partyCode:{dem:'D',gop:'R',lib:'L',ind:'I',other:'O'}[c.party],party:{dem:'D',gop:'R',lib:'L',ind:'I',other:'O'}[c.party],votes:0,isWinner:false,winner:false})),counties:[],providerCall:null,providerCallVerified:false};}
function batch(data,votes){const a=Object.values(data.races[0].mapData)[0];a.candidates.forEach((c,i)=>c.votes=votes[i]||0);a.totalVote=a.candidates.reduce((n,c)=>n+c.votes,0);}
test('Observed NBC pages supply exact county FIPS, district-only county portions, Senate specials and ME/MA/NH town GEOIDs',async()=>{
 const provider=new NbcCountyProvider();
 for(const key of Object.keys(samples)){const r=race(key),lookup=countyGeographies(samples[key],r,await provider.localFeatures(r.state)),rows=parseNbcCounties(samples[key],r,{lookup});assert.equal(rows.length,2,key);assert.equal(rows[0].fips.length,['me','ma','nh'].includes(key)?10:5);assert.ok(rows.every(c=>c.candidates.every(x=>!x.winner&&!x.isWinner)));}
 assert.equal(parseNbcCounties(samples.house,race('house'))[0].fips,'08001');
 assert.equal(parseNbcCounties(samples.me,race('me'))[0].fips,'2302100100');
});
test('County adapter rejects wrong election, state, district, race, preview, unsafe URLs and missing breakdowns',()=>{
 for(const change of [p=>p.brand='other',p=>p.electionDate='2024-11-05',p=>p.electionType='primary',p=>p.stateAbbr='TX',p=>p.enableLivePreview=true,p=>p.races[0].summary.officeCode='H',p=>p.races[0].summary.raceId='wrong',p=>p.races[0].summary.electionTypeCode='P',p=>p.races[0].mapData={},p=>p.currentTime='invalid']){const p=clone(samples.co);change(p);assert.throws(()=>parseNbcCounties(p,race('co')));}
 const p=clone(samples.house);p.races[0].summary.district=3;assert.throws(()=>parseNbcCounties(p,race('house')));
 for(const url of ['https://evil.example/politics/2026-elections/colorado-senate-results','https://www.nbcnews.com/politics/2026-primary-elections/colorado-senate-results','https://user@www.nbcnews.com/politics/2026-elections/colorado-senate-results'])assert.throws(()=>nbcRacePage(url));
});
test('Malformed or reset county is isolated, last good retained, raw vote math preserved and no projection flag imported',()=>{
 const r=race('co'),p=clone(samples.co);batch(p,[55,45]);let rows=parseNbcCounties(p,r);assert.ok(Math.abs(rows.find(c=>c.fips==='08001').candidates[0].percent-55)<1e-9);
 const previous=rows,bad=clone(p);batch(bad,[0,0]);let issues=[];rows=parseNbcCounties(bad,r,{previous,onInvalid:i=>issues.push(i)});assert.equal(rows.find(c=>c.fips==='08001').candidates[0].votes,55);assert.match(issues[0].reason,/reset/);
 for(const mutate of [a=>a.candidates[0].votes=-1,a=>a.totalVote=999,a=>a.candidates[0].name='Unknown Person',a=>a.candidates.push(clone(a.candidates[0]))]){const d=clone(p);mutate(d.races[0].mapData['08001']);assert.equal(parseNbcCounties(d,r,{previous}).find(c=>c.fips==='08001').candidates[0].votes,55);}
 const d=clone(p);d.races[0].mapData['08001'].candidates[0].isWinner=true;assert.equal(parseNbcCounties(d,r)[0].candidates[0].isWinner,false);
 const partial=clone(p);delete partial.races[0].mapData['08001'];assert.equal(parseNbcCounties(partial,r,{previous}).length,2);
});
test('Duplicate New England town names never select an arbitrary geography',()=>{
 const p=clone(samples.me),r=race('me'),lookup=countyGeographies(p,r),name=Object.values(p.races[0].mapData)[0].raceName;
 lookup.set(name.toLowerCase(),new Set(['2302100100','2300300100']));const issues=[];
 const rows=parseNbcCounties(p,r,{lookup,onInvalid:i=>issues.push(i)});assert.equal(rows.length,1);assert.match(issues[0].reason,/unique GEOID/);
});
test('Explicit plantation/location identities disambiguate the remaining town without merging their votes',()=>{
 const p=clone(samples.me),r=race('me'),areas=Object.values(p.races[0].mapData);areas[0].raceName='Lincoln';areas[1].raceName='Lincoln plantation';p.races[0].mapData={lincoln:areas[0],'lincoln-plantation':areas[1]};
 const lookup=new Map([['lincoln',new Set(['2301939475','2301739422'])],['lincolnplantation',new Set(['2301739422'])]]);
 const rows=parseNbcCounties(p,r,{lookup});assert.equal(rows.length,2);assert.equal(rows.find(c=>c.name==='Lincoln').fips,'2301939475');assert.equal(rows.find(c=>c.name==='Lincoln plantation').fips,'2301739422');
 const oh=clone(samples.oh);oh.isSpecial='special';assert.equal(parseNbcCounties(oh,race('oh')).length,2);
});
test('County HTTP discovers declared updateUrl, coalesces clients, uses 15-second conditional polling and expires inactive subscriptions',async()=>{
 let now=100000,reads=0,fail=false;const p=clone(samples.co),r=race('co');
 const provider=new NbcCountyProvider({now:()=>now,fetchImpl:async(url,options)=>{reads++;await Promise.resolve();if(fail)throw Error('offline');if(reads===1){assert.equal(url,r.providerPageUrl);return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:p}})}</script>`);}assert.equal(url,p.updateUrl);if(reads===2)return new Response(JSON.stringify(p),{headers:{etag:'county-one'}});assert.equal(options.headers['If-None-Match'],'county-one');return new Response(null,{status:304});}});
 const [a,b]=await Promise.all([provider.fetchCounties(r),provider.fetchCounties(r)]);assert.deepEqual(a,b);assert.equal(reads,1);
 await provider.fetchCounties(r);assert.equal(reads,1);now+=15001;await provider.fetchCounties(r);assert.equal(reads,2);now+=15001;await provider.fetchCounties(r);assert.equal(reads,3);
 fail=true;now+=15001;assert.equal(await provider.fetchCounties({...r,counties:a}),null);assert.match(provider.errors.get(r.id),/offline/);assert.deepEqual(provider.cache.get(r.id).counties,a);
 now+=120001;await provider.refresh([r]);assert.equal(provider.active.size,0);assert.equal(reads,4);
});
test('A failed first page fetch retries discovery and a foreign updateUrl cannot be followed',async()=>{
 let now=0,reads=0;const r=race('co'),p=clone(samples.co);
 const provider=new NbcCountyProvider({now:()=>now,fetchImpl:async url=>{reads++;assert.equal(url,r.providerPageUrl);if(reads===1)throw Error('timeout');return new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:p}})}</script>`);}});
 assert.equal(await provider.fetchCounties(r),null);now=15001;assert.equal((await provider.fetchCounties(r)).length,2);
 p.updateUrl='https://evil.example/results';const unsafe=new NbcCountyProvider({fetchImpl:async()=>new Response(`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:p}})}</script>`)});assert.equal(await unsafe.fetchCounties(r),null);assert.match(unsafe.errors.get(r.id),/updateUrl/);
});
test('Real control publishes county-only deltas, preserves totals/calls, persists breakdowns and refreshes watched counties on poll',async t=>{
 const root=await mkdtemp(join(tmpdir(),'fea-counties-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'data'));await mkdir(join(root,'disk'));
 const r=race('co'),p=clone(samples.co);let now=Date.parse(p.currentTime),outage=false,rows=[];
 const cp=new NbcCountyProvider({now:()=>now,fetchImpl:async url=>{if(outage)throw Error('HTTP 500');return new Response(String(url).includes('/politics/')?`<script id="__NEXT_DATA__">${JSON.stringify({props:{pageProps:p}})}</script>`:JSON.stringify(p));}});
 await writeFile(join(root,'data/election-night-races.json'),JSON.stringify({races:[r]}));await writeFile(join(root,'data/results-provider.json'),JSON.stringify({sources:[]}));await writeFile(join(root,'data/result-calls.json'),'{"races":{}}');
 const options={root,storageDir:join(root,'disk'),now:()=>now,provider:{fetchResults:async()=>[clone(r)]},countyProvider:cp};const control=await new ResultsControl(options).init();await control.poll();const feed=new ResultsChangeFeed();const before=feed.update(control.results());
 assert.equal(await control.loadCountyResults(r.id),true);const initial=feed.update(control.results());assert.notEqual(initial.version,before.version);assert.equal(feed.changes(before.version).races.length,1);
 const detail=()=>control.results({details:true}).groups.flatMap(g=>g.races)[0];assert.equal(detail().counties.length,2);assert.equal(detail().calls.length,0);assert.equal(detail().candidates[0].votes,0);
 now+=61000;batch(p,[55,45]);p.currentTime=new Date(now).toISOString();await control.poll();assert.equal(detail().counties[0].candidates[0].votes,55);assert.notEqual(feed.update(control.results()).version,initial.version);
 // An unchanged timestamp-only heartbeat must not create another county delta.
 const same=feed.current.version;now+=61000;p.currentTime=new Date(now).toISOString();await control.poll();assert.equal(feed.update(control.results()).version,same);
 outage=true;now+=61000;await control.poll();assert.equal(detail().counties[0].candidates[0].votes,55);
 const restarted=await new ResultsControl(options).init();assert.equal(restarted.results({details:true}).groups.flatMap(g=>g.races)[0].counties[0].candidates[0].votes,55);
});
test('First-open county hydration is accepted immediately, while an obsolete or unrelated detail response stays rejected',async()=>{
 const context=vm.createContext({window:{}});vm.runInContext(readFileSync('assets/results-desk-board.js','utf8'),context);class Page{}context.window.FEAEnhanceBoard(Page);
 const p=new Page(),r={id:'senate-CO',version:'summary-before'};p.liveRaceDetails=new Map();p.liveRaceIndex=[r];p.currentRace=r;p.query=new URLSearchParams();p.renderProviderStatus=()=>{};
 let response={id:r.id,version:'detail-after',countyHydratedFromVersion:'summary-before',candidates:[],counties:[{fips:'08001'}]};p.safeJson=async()=>response;
 assert.equal(await p.findLiveDetailForRace(r),response);
 p.liveRaceDetails.clear();response={...response,countyHydratedFromVersion:'unrelated-version'};assert.equal(await p.findLiveDetailForRace(r),null);
 response={...response,countyHydratedFromVersion:'summary-before'};p.liveRaceIndex=[{...r,version:'newer-summary'}];assert.equal(await p.findLiveDetailForRace(r),null);
});
