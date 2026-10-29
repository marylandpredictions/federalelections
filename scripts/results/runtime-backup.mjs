// Private, offline operator backup. Never upload this archive to public GitHub.
import {readFile,writeFile,readdir,lstat,mkdir,rename} from 'node:fs/promises';
import {resolve,relative,dirname,join,isAbsolute} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {validateRuntime,validateCalls} from './recovery.mjs';
const allowed=p=>/^(?:results-state\.json|result-calls\.json|race-details\/[\w-]+\.json|county-history\/[\w-]+\/\d{5}(?:\d{5})?\.ndjson)$/.test(p);
const sha=b=>createHash('sha256').update(b).digest('hex');
function outside(directory,path){const r=relative(resolve(directory),resolve(path));if(!r.startsWith('..')&&!isAbsolute(r))throw Error('Private archive must be outside the application checkout.');}
export async function backupRuntime(directory,output){
  directory=resolve(directory);outside(process.cwd(),output);const files=[];let bytes=0;
  async function walk(path,prefix=''){
    for(const name of await readdir(path)){const full=join(path,name),key=prefix+name,info=await lstat(full);
      if(info.isSymbolicLink())throw Error('Refusing runtime symlink: '+key);
      if(info.isDirectory()){if(/^(?:race-details|county-history)(?:\/[\w-]+)?$/.test(key))await walk(full,key+'/');continue;}
      if(!allowed(key))continue;const data=await readFile(full);bytes+=data.length;
      if(bytes>128*1024*1024||files.length>=20000)throw Error('Runtime backup size limit exceeded.');
      if(key==='results-state.json')validateRuntime(JSON.parse(data));if(key==='result-calls.json')validateCalls(JSON.parse(data));
      files.push({path:key,sha256:sha(data),data:data.toString('base64')});
    }
  }
  await walk(directory);
  if(!files.some(f=>f.path==='results-state.json')||!files.some(f=>f.path==='result-calls.json'))throw Error('Calls and runtime envelope are required for a full backup.');
  const archive={format:'fea-private-runtime-v1',at:new Date().toISOString(),files};
  await mkdir(dirname(resolve(output)),{recursive:true,mode:0o700});await writeFile(output,gzipSync(JSON.stringify(archive)),{flag:'wx',mode:0o600});return {files:files.length,bytes,hostVerified:false};
}
export async function restoreRuntime(input,directory){
  directory=resolve(directory);if(dirname(directory)===directory)throw Error('Cannot restore over a filesystem root.');outside(process.cwd(),input);
  try{outside(directory,process.cwd());}catch{throw Error('Cannot restore over the application checkout or its ancestor.');}
  const archive=JSON.parse(gunzipSync(await readFile(input),{maxOutputLength:192*1024*1024}));
  if(archive.format!=='fea-private-runtime-v1'||!Array.isArray(archive.files)||archive.files.length>20000)throw Error('Invalid runtime archive.');
  const ids=new Set(),files=archive.files.map(f=>{if(!allowed(f.path)||ids.has(f.path))throw Error('Unsafe or duplicate archive path.');ids.add(f.path);const bytes=Buffer.from(f.data,'base64');if(sha(bytes)!==f.sha256)throw Error('Archive checksum mismatch.');return {...f,bytes};});
  const runtime=files.find(f=>f.path==='results-state.json'),calls=files.find(f=>f.path==='result-calls.json');if(!runtime||!calls)throw Error('Incomplete full-state archive.');validateRuntime(JSON.parse(runtime.bytes));validateCalls(JSON.parse(calls.bytes));
  // Install children inside the existing mount; mount roots cannot be renamed.
  await mkdir(directory,{recursive:true});
  const stage=join(directory,'.restore-stage-'+randomUUID()),previous=join(directory,'.before-restore-'+randomUUID());await mkdir(stage,{mode:0o700});await mkdir(previous,{mode:0o700});
  for(const file of files){await mkdir(dirname(join(stage,file.path)),{recursive:true});await writeFile(join(stage,file.path),file.bytes,{mode:0o600});}
  const moved=[],installed=[];
  try{
    for(const name of ['result-calls.json','results-state.json','race-details','county-history']){
      try{if((await lstat(join(directory,name))).isSymbolicLink())throw Error('Refusing restore over runtime symlink.');await rename(join(directory,name),join(previous,name));moved.push(name);}catch(e){if(e.code!=='ENOENT')throw e;}
      try{await rename(join(stage,name),join(directory,name));installed.push(name);}catch(e){if(e.code!=='ENOENT')throw e;}
    }
  }catch(error){
    for(const name of installed.reverse())await rename(join(directory,name),join(stage,name));
    for(const name of moved.reverse())await rename(join(previous,name),join(directory,name));
    throw error;
  }
  return {files:files.length,previousDirectory:moved.length?previous:null,hostVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [action,directory,file,...flags]=process.argv.slice(2);
  if(!['backup','restore'].includes(action)||!directory||!file||!flags.includes('--offline'))throw Error('Usage: runtime-backup.mjs backup|restore ABS_STORAGE ABS_ARCHIVE --offline. Stop all writers first. Archive is PRIVATE.');
  console.log(JSON.stringify(await(action==='backup'?backupRuntime(directory,file):restoreRuntime(file,directory)),null,2));
}
