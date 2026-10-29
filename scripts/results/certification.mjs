import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {auditCandidateFiles} from './audit-candidates.mjs';
import {readiness} from './readiness.mjs';
import {ResultsControl} from './control.mjs';
import {storageConfiguration} from './storage.mjs';
const root=process.cwd(),temp=await mkdtemp(join(tmpdir(),'fea-certification-'));
try{
 const control=await new ResultsControl({root,storageDir:join(temp,'disk')}).init();
 const checks=await readiness(control,root,{storageEnvironment:{}}),candidates=auditCandidateFiles(root),provider=JSON.parse(await readFile(join(root,'data/results-provider.json'),'utf8'));
 for(const check of checks.checks)if(['Storage configuration','Storage writable','Production persistence','Last-good snapshot','Provider'].includes(check.name))check.scope='ISOLATED_DISPOSABLE_CONTROL; not the running hosted service';
 const value=flag=>{const i=process.argv.indexOf(flag);return i<0?null:process.argv[i+1];};
 let tests={status:'NOT_RUN',passed:null,failed:null,skipped:null};const log=value('--test-log');
 if(log){const text=await readFile(log,'utf8'),n=kind=>Number(text.match(new RegExp('(?:#|ℹ) '+kind+' (\\d+)'))?.[1]??NaN),passed=n('pass'),failed=n('fail'),skipped=n('skipped');tests={status:Number.isFinite(passed)&&Number.isFinite(failed)?failed?'FAIL':'PASS':'UNKNOWN',passed,failed,skipped};}
 const report={schemaVersion:1,at:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),trackedWorktreeChanges:!!execFileSync('git',['-c','core.autocrlf=false','diff','HEAD','--name-only'],{encoding:'utf8'}).trim(),classification:'NEEDS MANUAL VERIFICATION',scope:'Local code/data checks only. No live Render, actual NBC contract, native OBS or physical devices certified.',candidateAudit:candidates,tests,pollSchedule:checks.checks.find(c=>c.name==='Poll-close schedule'),providerConfig:{sources:provider.sources?.map(s=>({url:s.url,status:s.status,election:s.election,mappings:s.races?.length})),activation:provider.sources?.length?'CONFIGURED_NOT_LIVE_CERTIFIED':'DISABLED_UNVERIFIED',hostVerified:false},storageConfig:storageConfiguration(root),checks:checks.checks,externalRequired:['Live source identity and projection contract','Live mounted-disk restart/redeploy/recovery','Native OBS compositing','Physical Safari/touch/TV path']};
 if(!candidates.passed||report.storageConfig.issues.length||checks.checks.some(c=>c.status==='FAIL'&&c.name!=='Production persistence')||tests.status==='FAIL')report.classification='NOT READY';
 const output=resolve(value('--output')||'.runtime/results-certification.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({output,classification:report.classification,candidates:{total:candidates.total,official:candidates.official,secondary:candidates.secondaryReviewed,issues:candidates.issues.length},tests},null,2));if(report.classification==='NOT READY')process.exitCode=1;
}finally{await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
