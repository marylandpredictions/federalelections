"""Report every accepted cross-office result, including weak subgroups."""
import hashlib
import importlib.util
import json
from pathlib import Path
spec=importlib.util.spec_from_file_location('scores',Path('scripts/results/probability-house-forward-score.py'))
scores=importlib.util.module_from_spec(spec)
spec.loader.exec_module(scores)
root=Path('.runtime')
output={'status':'research-only; sample size and rule/candidate scope still require review','offices':{}}
plan_path=Path('data/results/probability-state-forward-plan.json')
plan=json.loads(plan_path.read_text())
for path,expected in plan['normalizedLfCodeSha256'].items():
    if hashlib.sha256(Path(path).read_bytes().replace(b'\r\n',b'\n')).hexdigest()!=expected:
        raise ValueError('Frozen statistical implementation changed: '+path)
for office in ('senate','governor'):
    path=root/f'probability-state-extension-{office}-forecasts.json'
    report=json.loads(path.read_text())
    if report['planSha256']!=hashlib.sha256(plan_path.read_bytes()).hexdigest():
        raise ValueError('Forecasts do not bind this evaluation plan')
    cohorts={}
    for name,select in [('all',lambda r:True),('new',lambda r:not r['previouslyInspected']),
        ('supported-new',lambda r:not r['previouslyInspected'] and r['reported']>=25),
        ('supported-new-competitive',lambda r:not r['previouslyInspected'] and r['reported']>=25 and abs(r['anchorMarginPoints'])<=10),
        ('production-inputs-new',lambda r:not r['previouslyInspected'] and r['productionInputsEligible']),
        ('production-inputs-new-competitive',lambda r:not r['previouslyInspected'] and r['productionInputsEligible'] and abs(r['anchorMarginPoints'])<=10)]:
        rows=[r for r in report['runs'] if select(r)]
        if not rows:
            cohorts[name]={'races':0};continue
        cohorts[name]={'metrics':{method:scores.summarize(rows,method) for method in ('historical-only','candidate-and-uncertainty','frozen-source')},
            'paired':scores.paired_brier(rows,'candidate-and-uncertainty','frozen-source'),
            'false95Ids':[r['id'] for r in rows if (r['forecasts']['candidate-and-uncertainty']['probabilityD']>=.95 and not r['winnerD']) or
                (r['forecasts']['candidate-and-uncertainty']['probabilityD']<=.05 and r['winnerD'])]}
    output['offices'][office]={'forecastSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'cohorts':cohorts,'quarantined':report['quarantined']}
(root/'probability-state-extension-scores.json').write_text(json.dumps(output,indent=2))
print(json.dumps({office:{name:{'metrics':{k:{x:v[x] for x in ('races','brier','coverage80','false95') if x in v} for k,v in cohort.get('metrics',{}).items()},
    'paired':cohort.get('paired')} for name,cohort in report['cohorts'].items()} for office,report in output['offices'].items()}))
