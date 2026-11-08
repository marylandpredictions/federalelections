"""Score every race-level fallback experiment; never tunes a parameter."""
import hashlib
import importlib.util
import json
from pathlib import Path
spec=importlib.util.spec_from_file_location('scores',Path(__file__).with_name('probability-house-forward-score.py'))
scores=importlib.util.module_from_spec(spec)
spec.loader.exec_module(scores)
root=Path('.runtime')
path=root/'probability-aggregate-study.json'
data=json.loads(path.read_text())
plan_path=Path('data/results/probability-aggregate-forward-plan.json')
if data['planSha256']!=hashlib.sha256(plan_path.read_bytes()).hexdigest():raise ValueError('Plan identity mismatch')
result={'status':'Exploratory evidence on previously inspected races; no release approval',
    'planSha256':data['planSha256'],'forecastSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
    'cohorts':{},'quarantined':data['quarantined']}
inspected=set(json.loads(Path('data/results/probability-house-forward-plan.json').read_text())['previouslyInspected'])
for office in ('all','house','senate','governor','house-not-previously-inspected'):
    selected=[r for r in data['runs'] if office=='all' or r['office']==office or
        office=='house-not-previously-inspected' and r['office']=='house' and r['id'] not in inspected]
    result['cohorts'][office]={}
    for name,rows in [('all',selected),('prior-competitive',[r for r in selected if abs(r['anchorMarginPoints'])<=10]),
        ('60-100',[r for r in selected if r['reported']>=60]),
        ('60-100-prior-competitive',[r for r in selected if r['reported']>=60 and abs(r['anchorMarginPoints'])<=10])]:
        if not rows:continue
        result['cohorts'][office][name]={'metrics':{m:scores.summarize(rows,m) for m in ('aggregate','geographic','frozen-source')},
            'paired':[scores.paired_brier(rows,'aggregate',m) for m in ('geographic','frozen-source')],
            'false95Ids':[r['id'] for r in rows if (r['forecasts']['aggregate']['probabilityD']>=.95 and not r['winnerD']) or
                (r['forecasts']['aggregate']['probabilityD']<=.05 and r['winnerD'])]}
target=root/'probability-aggregate-scores.json'
target.write_text(json.dumps(result,indent=2))
print(json.dumps({'output':str(target),'cohorts':result['cohorts']}))
