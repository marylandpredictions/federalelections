import {readFileSync,writeFileSync} from 'node:fs';
// Identity-only catalogue: map editing does not need candidates, votes or calls.
const source='data/election-night-races.json';
const races=JSON.parse(readFileSync(source,'utf8')).races.map(({id,type,state,district})=>({id,type,state,...(district!==undefined?{district}:{})}));
writeFileSync('data/features/map-maker-races.json',JSON.stringify({schemaVersion:1,source,races})+'\n');
console.log(`Map maker catalogue: ${races.length} contests`);
