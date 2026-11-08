import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {auditNbcProbabilityInputs} from '../../scripts/results/probability-nbc-readiness.mjs';

test('Captured NBC readiness reconciles candidate codes, preserves missing races and rejects altered evidence',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'fea-nbc-readiness-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const offices=JSON.parse(readFileSync('tests/fixtures/nbc-national-2026.json','utf8')).offices;
  const counties=JSON.parse(readFileSync('tests/fixtures/nbc-counties-2026.json','utf8')).co;
  const config=JSON.parse(readFileSync('data/results-provider.json','utf8'));
  const raw=counties.races[0];
  const summary=raw.summary;
  for(const unit of Object.values(raw.mapData)){
    for(const c of unit.candidates)c.votes=10;
    unit.totalVote=unit.candidates.length*10;
  }
  for(const c of summary.candidates)c.votes=20;
  summary.votes=summary.candidates.length*20;
  const tooltip=offices.senate.mapData.CO.tooltip;
  for(const c of tooltip.candidates)c.votes=20;
  tooltip.totalVote=tooltip.candidates.length*20;
  const report={startedAt:'2026-11-04T01:00:00Z',finishedAt:'2026-11-04T01:01:00Z',captures:[]};
  async function capture(path,source,data){
    const body=JSON.stringify(data);
    await writeFile(join(directory,path),gzipSync(body));
    report.captures.push({path,source,at:report.finishedAt,
      sha256:createHash('sha256').update(body).digest('hex')});
  }
  for(const source of config.sources.filter(s=>s.format==='nbc-national-v2'))
    await capture(source.office+'.json.gz',source.url,offices[source.office]);
  await capture('senate-CO.json.gz',counties.updateUrl,counties);
  await writeFile(join(directory,'audit.json'),JSON.stringify(report));
  const first=await auditNbcProbabilityInputs(directory);
  assert.equal(first.total,506);
  assert.equal(first.counts.nationalReconciled,1);
  assert.equal(first.counts.sameResponseReconciled,1);
  assert.equal(first.counts.completionVerified,0);
  assert.equal(first.races.find(r=>r.id==='senate-CO').sourceVotes,summary.votes);
  await writeFile(join(directory,'senate-CO.json.gz'),gzipSync(JSON.stringify({...counties,currentTime:'2026-11-04T00:10:00Z'})));
  const changed=await auditNbcProbabilityInputs(directory);
  assert.equal(changed.counts.sameResponseReconciled,0);
  assert.match(changed.races.find(r=>r.id==='senate-CO').issues.join(' '),/checksum/);
});
