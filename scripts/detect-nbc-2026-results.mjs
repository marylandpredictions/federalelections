import {readFile,writeFile,rename,appendFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {detect} from './results/nbc-discovery.mjs';
export async function run({root=process.cwd(),now=new Date(),write=false,manual=false,reader,log=console.log,output=process.env.GITHUB_OUTPUT}={}){
  const finish=async result=>{if(output)await appendFile(output,`changed=${result.changed?'true':'false'}\n`);log(result.reason);return result;};
  if(!manual&&(now<new Date('2026-10-29T00:00:00Z')||now>=new Date('2026-11-08T00:00:00Z')))return finish({changed:false,reason:'Outside the bounded 2026 election watch window; no requests.'});
  const path=join(root,'data/results-provider.json'),config=JSON.parse(await readFile(path,'utf8'));
  if(!Array.isArray(config.sources))throw Error('Existing provider registry malformed; refusing to replace it.');
  const catalogue=JSON.parse(await readFile(join(root,'data/election-night-races.json'),'utf8')).races;
  let result;
  try{result=await detect({config,catalogue,now,reader,log});}catch(error){return finish({changed:false,reason:'Discovery failed safely: '+error.message});}
  if(write&&result.changed){const temp=path+'.detector.tmp';await writeFile(temp,JSON.stringify(result.config,null,2)+'\n');await rename(temp,path);}
  return finish({...result,reason:(result.changed&&!write?'Dry run only: ':'')+result.reason});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await run({write:process.argv.includes('--write'),manual:process.argv.includes('--manual')});}
  catch(error){console.error('Detector configuration error: '+error.message);process.exitCode=1;}
}
