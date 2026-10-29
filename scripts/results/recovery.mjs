import {readFile} from 'node:fs/promises';
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
export async function readStateFile(path,fallback){
  try{return JSON.parse(await readFile(path,'utf8'));}
  catch(error){if(error.code==='ENOENT')return fallback;throw Error(`Cannot recover election state ${path}: ${error.message}`,{cause:error});}
}
export function validateCalls(calls){
  if(!object(calls)||!object(calls.races)||calls.automation!==undefined&&!object(calls.automation))throw Error('Invalid saved calls schema');
  for(const [id,row]of Object.entries(calls.races))if(!/^[\w-]+$/.test(id)||!object(row)||row.calls!==undefined&&(!Array.isArray(row.calls)||row.calls.some(c=>!object(c)||typeof c.candidate!=='string'||!c.candidate.trim())))throw Error('Invalid saved call: '+id);
  return calls;
}
export function validateRuntime(runtime){
  if(!object(runtime)||!object(runtime.races)||runtime.schemaVersion!==undefined&&runtime.schemaVersion!==1||runtime.health!==undefined&&!object(runtime.health)||runtime.audit!==undefined&&!Array.isArray(runtime.audit))throw Error('Invalid saved runtime schema');
  for(const[id,race]of Object.entries(runtime.races||{}))if(!object(race)||race.id!==id||!Array.isArray(race.candidates)||!race.candidates.length||race.candidates.some(c=>!object(c)||typeof c.name!=='string'||!Number.isSafeInteger(c.votes)||c.votes<0))throw Error('Invalid saved result: '+id);
  if(runtime.committedCalls)validateCalls(runtime.committedCalls);
  return runtime;
}
