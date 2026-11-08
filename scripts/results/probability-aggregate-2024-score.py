"""Equal-state confirmation scores, with all source exclusions retained."""
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import numpy as np

root=Path('.runtime')
path=root/'probability-aggregate-2024-study.json'
data=json.loads(path.read_text())
if data['planSha256']!=hashlib.sha256(Path('data/results/probability-aggregate-forward-plan.json').read_bytes()).hexdigest():
    raise ValueError('Plan mismatch')
output={'status':'Research confirmation; not a production release',
    'forecastSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'planSha256':data['planSha256'],
    'weighting':'Equal states, equal frames within each state; state-cluster bootstrap',
    'cohorts':{},'quarantined':data['quarantined']}
for name,select in [('all',lambda r:True),('prior-competitive',lambda r:abs(r['anchorMarginPoints'])<=10),
    ('25-59',lambda r:r['reported']<60),('60-89',lambda r:60<=r['reported']<90),
    ('90-100',lambda r:r['reported']>=90)]:
    rows=[r for r in data['runs'] if select(r)]
    if not rows:continue
    groups=defaultdict(list)
    for row in rows:groups[row['state']].append(row)
    metrics={}
    for method in ('aggregate','frozen-source'):
        briers=[];losses=[];maes=[];covers=[];wrong=[]
        for state,members in groups.items():
            briers.append(np.mean([(r['forecasts'][method]['probabilityD']-float(r['winnerD']))**2 for r in members]))
            chances=[r['forecasts'][method]['probabilityD'] if r['winnerD'] else 1-r['forecasts'][method]['probabilityD'] for r in members]
            losses.append(np.mean([-math.log(p) if p>0 else math.inf for p in chances]))
            if method=='aggregate':
                maes.append(np.mean([abs(r['forecasts'][method]['median']-r['truthMargin']) for r in members]))
                covers.append(np.mean([r['forecasts'][method]['interval80'][0]<=r['truthMargin']<=r['forecasts'][method]['interval80'][1] for r in members]))
                wrong.extend(r['id'] for r in members if (r['forecasts'][method]['probabilityD']>=.95 and not r['winnerD']) or
                    (r['forecasts'][method]['probabilityD']<=.05 and r['winnerD']))
        loss=float(np.mean(losses))
        metrics[method]={'brier':float(np.mean(briers)),'logLoss':loss if math.isfinite(loss) else None,
            'infiniteLogLossStates':sum(not math.isfinite(v) for v in losses),
            **({'marginMae':float(np.mean(maes)),'coverage80':float(np.mean(covers)),'false95Ids':wrong} if method=='aggregate' else {})}
    differences=np.array([np.mean([(r['forecasts']['aggregate']['probabilityD']-float(r['winnerD']))**2-
        (r['forecasts']['frozen-source']['probabilityD']-float(r['winnerD']))**2 for r in members]) for members in groups.values()])
    draws=np.mean(differences[np.random.default_rng(20261108).integers(0,len(differences),size=(5000,len(differences)))],axis=1)
    output['cohorts'][name]={'states':len(groups),'frames':len(rows),'metrics':metrics,
        'pairedBrierDifference':{'difference':float(np.mean(differences)),'interval95':np.quantile(draws,[.025,.975]).tolist()}}
target=root/'probability-aggregate-2024-scores.json'
target.write_text(json.dumps(output,indent=2))
print(json.dumps({'output':str(target),'cohorts':output['cohorts']}))
