import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyPage, discoverUrls, ownedUrl, robotsAllowed, PublicReader, mappingsForPayload, detect} from '../../scripts/results/nbc-discovery.mjs';
import {parseNbcResults, NbcProvider} from '../../scripts/results/nbc-provider.mjs';
import vm from 'node:vm';
import {run} from '../../scripts/detect-nbc-2026-results.mjs';
import {createCertificationControl} from '../../scripts/results/certification.mjs';

const base='https://www.nbcnews.com', page=base+'/politics/2026-elections/senate-results', feed=base+'/data/2026/general/ohio.json';
const catalogue=[{id:'senate-OH',type:'senate',state:'OH',rosterReviewed:true,candidates:[{id:'d',name:'Jane Smith',party:'D'},{id:'r',name:'John Brown',party:'R'}]}];
const payload=()=>({stateAbbr:'OH',electionDate:'2026-11-03',races:[{summary:{raceId:'OH-SEN',officeName:'U.S. Senate',percentIn:0,candidates:[{candidateId:'a',name:'Jane Smith',party:'DEM',votes:0,isWinner:true},{candidateId:'b',name:'John Brown',party:'GOP',votes:0,isWinner:false}]}}]});
const html=(data={electionDate:'2026-11-03',electionType:'GENERAL',offices:['Senate','House','Governor'],races:[]})=>`<html><head><title>NBC News 2026 Election Results</title><link rel="canonical" href="${page}"></head><body><script type="application/json">${JSON.stringify(data)}</script><a href="${feed}">Data</a></body></html>`;
const verify=(body,options={})=>verifyPage({url:page,status:200,html:body,...options});
const silent=()=>{};
const mockReader=(body=html(),data=payload())=>({get:async url=>({status:200,finalUrl:url,text:url===page?body:url===feed?JSON.stringify(data):'<title>404 page not found</title>'})});

test('NBC general-election application and zero-vote pre-election application are accepted',()=>{
  assert.equal(verify(html()).accepted,true);
  assert.equal(verify(html(payload())).accepted,true);
  assert.equal(verify(html({...payload(),races:payload().races.map(r=>({...r,summary:{...r.summary,candidates:r.summary.candidates.map(c=>({...c,votes:null}))}}))})).accepted,true);
});
for(const[name,body,options]of[
  ['primary',html().replaceAll('GENERAL','PRIMARY').replaceAll('Election Results','Primary Election Results'),{}],
  ['2024',html().replaceAll('2026','2024'),{}],
  ['coverage article',html({'@type':'NewsArticle',headline:'NBC 2026 Election Results',electionDate:'2026-11-03',electionType:'GENERAL',offices:['Senate']}),{}],
  ['generic politics', '<title>NBC News Politics</title><p>2026 elections</p>',{}],
  ['soft 404','<title>NBC News 2026 Election Results</title><h1>Page not found</h1>'+html(),{}],
  ['homepage redirect',html(),{finalUrl:base+'/'}],
  ['challenge',html()+'<p>Verify you are human</p>',{}],
  ['mention without application','<title>NBC 2026 Election Results</title><p>Coverage begins soon</p>',{}],
  ['external canonical',html().replace(page,'https://evil.example/results'),{}],
  ['primary URL',html(),{finalUrl:base+'/politics/2026-elections/primary-results'}],
  ['HTTP 500',html(),{status:500}],
])test(`reject ${name}`,()=>assert.equal(verify(body,options).accepted,false));

test('a strong production application shell counts before any votes or race payload exists',()=>{
  const shell='<title>NBC News 2026 Election Results</title><div id="election-results-app">Polls close at 7 PM</div><script src="/assets/election-results.js"></script><a href="/politics/2026-elections/house-results">House</a><a href="/politics/2026-elections/senate-results">Senate</a>';
  assert.equal(verify(shell).accepted,true);
  assert.equal(verify(shell.replace('election-results-app','generic-app')).accepted,false);
  assert.equal(verify(html()+'<a href="/politics/2024-elections">Previous election</a>').accepted,true);
  assert.equal(verify(shell+'<script type="application/json">{"electionType":"PRIMARY"}</script>').accepted,false);
  assert.equal(verify('<style>body{color:#404040}</style>'+html()).accepted,true);
});
test('discovery handles escaped config URLs and rejects external, old, primary and template URLs',()=>{
  const text=JSON.stringify({data:feed,primary:base+'/2026-primary-results',old:base+'/2024-elections',evil:'https://evil.example/2026-results',template:base+'/2026-results/{state}'}).replaceAll('/','\\/');
  assert.deepEqual(discoverUrls(text,page),[feed]);
  assert.equal(ownedUrl('https://www.nbcnews.com.evil.example/results'),null);
  assert.equal(ownedUrl('https://user@www.nbcnews.com/results'),null);
  assert.equal(ownedUrl('http://www.nbcnews.com/results'),null);
});
test('robots respects specific agents, longest paths, wildcards, anchors and allow ties',()=>{
  const robots='User-agent: *\nDisallow: /\nUser-agent: fea-nbc2026-detector\nDisallow: /private\nAllow: /private/open\nDisallow: /*.json$\nAllow: /ok.json$';
  for(const[path,allowed]of[['/results',true],['/private/a',false],['/private/open/a',true],['/a.json',false],['/ok.json',true],['/a.json?x=1',true]])assert.equal(robotsAllowed(robots,base+path),allowed,path);
  assert.equal(robotsAllowed('User-agent: *\nDisallow: /same\nAllow: /same',base+'/same'),true);
  assert.equal(robotsAllowed('User-agent: UnrelatedBot\nDisallow: /',page),true);
});
test('public reader observes robots before fetching and fails closed on unavailable policy',async()=>{
  for(const[status,text,allowed]of[[200,'User-agent: *\nDisallow: /politics',false],[404,'',true],[500,'oops',false],[403,'denied',false],[429,'limited',false],[200,'<html>captcha</html>',false]]){
    const calls=[];const reader=new PublicReader({log:silent,fetchImpl:async url=>{calls.push(url);return new Response(url.endsWith('/robots.txt')?text:html(),{status:url.endsWith('/robots.txt')?status:200});}});
    const result=await reader.get(page);assert.equal(result.status,allowed?200:0);assert.equal(calls.length,allowed?2:1);
  }
});
test('public reader times out without treating an unavailable resource as verified',async()=>{
  const reader=new PublicReader({log:silent,timeoutMs:5,fetchImpl:async(url,{signal})=>url.endsWith('robots.txt')?new Response('',{status:404}):new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true}))});
  assert.match((await reader.get(page)).error,/timeout/);
});
test('reader checks redirects, stops after access denial, and bounds response/request work',async()=>{
  const calls=[];const reader=new PublicReader({log:silent,fetchImpl:async url=>{calls.push(url);if(url.endsWith('robots.txt'))return new Response('User-agent: *\nDisallow: /blocked');return new Response('',{status:302,headers:{location:'/blocked'}});}});
  assert.equal((await reader.get(page)).status,0);assert.equal(calls.length,2);
  const denied=new PublicReader({log:silent,fetchImpl:async url=>new Response('',{status:url.endsWith('robots.txt')?404:403})});
  assert.equal((await denied.get(page)).status,403);assert.equal((await denied.get(feed)).status,0);assert.equal(denied.requests,2);
  const external=new PublicReader({log:silent,fetchImpl:async url=>url.endsWith('robots.txt')?new Response('',{status:404}):new Response('',{status:302,headers:{location:'https://evil.example'}})});
  assert.match((await external.get(page)).error,/External/);
  const large=new PublicReader({log:silent,fetchImpl:async url=>url.endsWith('robots.txt')?new Response('',{status:404}):new Response('too big',{headers:{'content-length':String(9*1024*1024)}})});
  assert.match((await large.get(page)).error,/size limit/);
  const bounded=new PublicReader({log:silent,maxRequests:1,fetchImpl:async()=>new Response('',{status:404})});
  assert.match((await bounded.get(page)).error,/budget/);
});
test('mapping uses actual source IDs, full reviewed rosters and never authorizes projection flags',()=>{
  const result=mappingsForPayload(payload(),catalogue);assert.deepEqual(result.mappings,[{feaRaceId:'senate-OH',providerRaceId:'OH-SEN'}]);
  const parsed=parseNbcResults(payload(),{races:result.mappings,projection:{verified:false}},catalogue);assert.equal(parsed[0].providerCall,null);
  const missing=payload();missing.races[0].summary.candidates.pop();assert.equal(mappingsForPayload(missing,catalogue).mappings.length,0);
  const wrong=payload();wrong.electionDate='2026-05-05';assert.throws(()=>mappingsForPayload(wrong,catalogue));
  const duplicate=payload();duplicate.races.push(duplicate.races[0]);assert.throws(()=>mappingsForPayload(duplicate,catalogue),/duplicate/);
  assert.throws(()=>mappingsForPayload({...payload(),electionType:'PRIMARY'},catalogue),/non-general/);
});
test('activation discovers linked real JSON, preserves fallback config and becomes request-free',async()=>{
  const config={description:'keep me',sources:[]},logs=[];
  const first=await detect({config,catalogue,reader:mockReader(),seeds:[page],log:x=>logs.push(x)});
  assert.equal(first.changed,true);assert.equal(first.config.description,'keep me');assert.equal(config.sources.length,0);
  assert.equal(first.config.sources[0].url,feed);assert.equal(first.config.sources[0].projection.verified,false);
  assert.equal(first.config.automaticDiscovery.status,'ACTIVE');assert.ok(logs.includes('NBC 2026 GENERAL-ELECTION RESULTS DETECTED'));
  const again=await detect({config:first.config,catalogue,reader:{get:()=>{throw Error('must not fetch');}},log:silent});assert.equal(again.changed,false);
});
test('link-only activation is idempotent, rejected pages cannot authorize feeds, existing providers survive',async()=>{
  const config={sources:[{url:'https://existing.example/feed',races:[]}]};
  const reader=mockReader(html(),{unexpected:'schema'});
  const first=await detect({config,catalogue,reader,seeds:[page],log:silent});assert.equal(first.config.automaticDiscovery.status,'PAGE_CONFIRMED');assert.deepEqual(first.config.sources,config.sources);
  const next=await detect({config:first.config,catalogue,reader,seeds:[page],now:new Date('2026-11-04'),log:silent});assert.equal(next.changed,false);
  const rejected=await detect({config,catalogue,reader:mockReader('<title>Primary results NBC 2026</title>'),seeds:[page],log:silent});assert.equal(rejected.changed,false);assert.deepEqual(rejected.config,config);
});
test('partial data activation safely extends an existing source when another compatible race appears',async()=>{
  const house={...structuredClone(catalogue[0]),id:'house-OH-1',type:'house',district:1},all=[...catalogue,house];
  const first=await detect({config:{sources:[]},catalogue:all,reader:mockReader(),seeds:[page],log:silent});assert.equal(first.config.automaticDiscovery.status,'DATA_PARTIAL');
  const data=payload();data.races.push({summary:{...structuredClone(data.races[0].summary),raceId:'OH-H1',officeName:'US House',district:1}});
  const second=await detect({config:first.config,catalogue:all,reader:mockReader(html(),data),seeds:[page],log:silent});
  assert.equal(second.config.automaticDiscovery.status,'ACTIVE');assert.equal(second.config.sources.length,1);assert.equal(second.config.sources[0].races.length,2);
  assert.notEqual(second.config.sources[0].discovery.mappingFingerprint,first.config.sources[0].discovery.mappingFingerprint);
  assert.equal(second.config.automaticDiscovery.firstDetectedAt,first.config.automaticDiscovery.firstDetectedAt);
});
test('generic NBC hub can discover a different results route but cannot activate itself',async()=>{
  const hub=base+'/politics/2026-elections',actual=base+'/elections/2026/general-election-results';
  const reader={get:async url=>({status:200,finalUrl:url,text:url===hub?`<title>NBC Politics</title><a href="${actual}">Results</a>`:url===actual?html().replace(page,actual):JSON.stringify(payload())})};
  const result=await detect({config:{sources:[]},catalogue,reader,seeds:[hub],log:silent});
  assert.deepEqual(result.config.automaticDiscovery.pageUrls,[actual]);assert.equal(result.config.sources[0].url,feed);
});
test('observed alternative NBC JSON route works only with discovery provenance and strict schema',async()=>{
  const result=await detect({config:{sources:[]},catalogue,reader:mockReader(),seeds:[page],log:silent});
  const source=result.config.sources[0],fetchImpl=async()=>new Response(JSON.stringify(payload()));
  const rows=await new NbcProvider({sources:[source],fetchImpl}).fetchResults(catalogue);assert.equal(rows[0].id,'senate-OH');assert.equal(rows[0].providerCall,null);
  const unverified={...source};delete unverified.discovery;
  await assert.rejects(new NbcProvider({sources:[unverified],fetchImpl}).fetchResults(catalogue),/verified public/);
  const malformed=new NbcProvider({sources:[source],fetchImpl:async()=>new Response('{broken')});await assert.rejects(malformed.fetchResults(catalogue));
});
test('board adds one safe external NBC link and removes it if the source is absent or unsafe',async()=>{
  const nodes=new Map(),menu={append:node=>nodes.set(node.id,node)},status={};nodes.set('board-menu',menu);nodes.set('results-provider-status',status);
  const document={getElementById:id=>nodes.get(id),createElement:()=>({})};
  const context={window:{},FEADeskTheme:{},FEAResultsUI:{},STATE_NAMES:{},URL,Date,document};
  vm.runInNewContext(await readFile('assets/desk-experience.js','utf8'),context);
  class Page {renderProviderStatus(){}}
  context.window.FEACompleteBoard(Page);const board=new Page();board.isLabPage=true;
  board.renderProviderStatus({publicResultsUrl:page});board.renderProviderStatus({publicResultsUrl:page});
  assert.equal(nodes.size,3);assert.equal(nodes.get('desk-nbc-results').href,page);assert.equal(nodes.get('desk-nbc-results').rel,'noopener noreferrer');
  board.renderProviderStatus({publicResultsUrl:'https://evil.example'});assert.equal(nodes.get('desk-nbc-results').hidden,true);
  board.renderProviderStatus({});assert.equal(nodes.get('desk-nbc-results').hidden,true);
});
test('workflow gates bot writes and limits publication to the provider registry on main',async()=>{
  const workflow=await readFile('.github/workflows/detect-nbc-2026-results.yml','utf8');
  assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/\*\/5/);assert.match(workflow,/contents: write/);assert.match(workflow,/refs\/heads\/main/);
  assert.match(workflow,/npm run test:results/);assert.match(workflow,/git add -- data\/results-provider.json/);assert.doesNotMatch(workflow,/--force|secrets\.(?!GITHUB_TOKEN)/);
  const quality=await readFile('.github/workflows/results-quality.yml','utf8');assert.match(quality,/scripts\/detect-nbc-2026-results.mjs/);
});
test('CI static certification isolates committed public calls from disposable runtime recovery',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nbc-certification-'));try{
    await mkdir(join(root,'data'));await writeFile(join(root,'data/election-night-races.json'),JSON.stringify({races:catalogue}));
    const committed=JSON.stringify({races:{'senate-OH':{calls:[{candidate:'Jane Smith',status:'projected',calledAt:'2026-11-03T23:00:00Z'}]}}});
    const path=join(root,'data/result-calls.json');await writeFile(path,committed);
    const control=await createCertificationControl(root,join(root,'isolated'));
    assert.deepEqual(control.calls.races,{});assert.equal(await readFile(path,'utf8'),committed);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('CLI writes only verified changes and respects dry-run/window/failure safety',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nbc-detector-'));try{
    await mkdir(join(root,'data'));const configPath=join(root,'data/results-provider.json');const original='{"sources":[]}\n';
    await writeFile(configPath,original);await writeFile(join(root,'data/election-night-races.json'),JSON.stringify({races:catalogue}));
    const now=new Date('2026-11-03T17:00:00Z'),reader=mockReader();
    await run({root,now,reader,log:silent,output:null});assert.equal(await readFile(configPath,'utf8'),original);
    await run({root,now,reader,write:true,log:silent,output:null});assert.equal(JSON.parse(await readFile(configPath)).automaticDiscovery.status,'ACTIVE');
    await writeFile(configPath,original);
    await run({root,now:new Date('2027-11-03'),reader:{get:()=>{throw Error('no network');}},write:true,log:silent,output:null});assert.equal(await readFile(configPath,'utf8'),original);
    await run({root,now,manual:true,reader:{get:async()=>{throw Error('network failure');}},write:true,log:silent,output:null});assert.equal(await readFile(configPath,'utf8'),original);
  }finally{await rm(root,{recursive:true,force:true});}
});
