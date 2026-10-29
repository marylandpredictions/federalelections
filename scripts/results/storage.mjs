import { join, resolve, relative, isAbsolute } from "node:path";
import {tmpdir} from 'node:os';
const within=(base,path)=>{const rel=relative(resolve(base),resolve(path));return rel===''||!rel.startsWith('..')&&!isAbsolute(rel);};
export function storageConfiguration(root=process.cwd(),directory=process.env.RESULTS_STORAGE_DIR,env=process.env){
  const expected=env.RESULTS_REQUIRE_PERSISTENCE==='1'||env.NODE_ENV==='production'||env.RENDER==='true';
  const path=resolve(directory||join(root,'.runtime')),issues=[];
  if(expected){
    if(!directory||!isAbsolute(directory))issues.push('Production requires an explicit absolute RESULTS_STORAGE_DIR.');
    const explicitNestedMount=env.RESULTS_EXPECTED_STORAGE_ROOT&&resolve(env.RESULTS_EXPECTED_STORAGE_ROOT)!==resolve(root)&&within(env.RESULTS_EXPECTED_STORAGE_ROOT,path);
    if(within(root,path)&&!explicitNestedMount)issues.push('Results storage is inside the application checkout without an explicit expected mount root.');
    if(within(tmpdir(),path)||['/tmp','/var/tmp'].some(base=>within(base,path)))issues.push('Results storage points into a temporary directory.');
    if(env.RESULTS_EXPECTED_STORAGE_ROOT&&!within(env.RESULTS_EXPECTED_STORAGE_ROOT,path))issues.push('Results storage is outside RESULTS_EXPECTED_STORAGE_ROOT.');
  }
  return {expected,directory:path,issues,hostPersistenceVerified:false};
}
export function assertStorageConfiguration(root,directory,env=process.env){const report=storageConfiguration(root,directory,env);if(report.issues.length)throw Error('Unsafe election persistence configuration: '+report.issues.join(' '));return report;}
export function resultStorage(
  root = process.cwd(),
  directory = process.env.RESULTS_STORAGE_DIR,
) {
  const durable = directory ? resolve(directory) : null;
  return {
    directory: durable || join(root, ".runtime"),
    state: join(durable || join(root, ".runtime"), "results-state.json"),
    calls: durable
      ? join(durable, "result-calls.json")
      : join(root, "data/result-calls.json"),
    details: durable
      ? join(durable, "race-details")
      : join(root, "data/live-results-races"),
    durable: !!durable,
  };
}
