"""Different-cycle confirmation of the frozen aggregate D/R component."""
import csv
from datetime import datetime,timezone
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import zipfile
import numpy as np

root=Path('.runtime')
plan_path=Path('data/results/probability-aggregate-forward-plan.json')
plan=json.loads(plan_path.read_text())
for path,expected in plan['normalizedLfCodeSha256'].items():
    if hashlib.sha256(Path(path).read_bytes().replace(b'\r\n',b'\n')).hexdigest()!=expected:
        raise ValueError('Frozen statistical implementation changed: '+path)
meta=json.loads((root/'probability-538-2024-pre-election-capture.json').read_text())
raw=(root/meta['file']).read_bytes()
if hashlib.sha256(raw).hexdigest()!=meta['sha256']:raise ValueError('Anchor checksum mismatch')
available=datetime.strptime(meta['capturedAt'],'%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
if available>=datetime(2024,11,5,tzinfo=timezone.utc):raise ValueError('Anchor is not pre-election')
page=(root/'probability-538-2024-forecast-page.html').read_bytes()
if hashlib.sha256(page).hexdigest()!=plan['confirmation']['intervalEvidence']['sha256'] or b'95% of outcomes fall in this range' not in page:
    raise ValueError('Unverified source interval level')
if b'Harris' not in page or b'Trump' not in page:raise ValueError('Unverified contemporaneous candidate identity')
z=zipfile.ZipFile(io.BytesIO(raw))
daily=list(csv.DictReader(z.read('538_2024_election_forecast_data/daily_summary.csv').decode().splitlines()))
for row in daily:
    if datetime.fromisoformat(row['timestamp'].replace('Z','+00:00'))>available:
        raise ValueError('Future forecast row inside archive')
latest=max(row['model_date'] for row in daily)
states={}
for row in daily:
    if row['model_date']!=latest or len(row['state_abb'])!=2:continue
    key=(row['party'],row['variable'],row['metric'])
    state=states.setdefault(row['state_abb'],{})
    if key in state:raise ValueError('Duplicate source metric')
    state[key]=float(row['value'])
spec=importlib.util.spec_from_file_location('house',Path(__file__).with_name('probability-frozen-house-study.py'))
house=importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)
study=house.study
county,history,refs,_,_,_=study.load_study(root)
model=study.fit(county,history,refs)
frames_path=root/'probability-medsl2024-state-frames.json'
frames=json.loads(frames_path.read_text())['frames']
truth={r['state']:r for r in study.read('data/baselines/pres-2024-states.json')['states'] if r['valid']}
result={'status':'research-only conditional D/R component; not a full multicandidate release',
    'cycle':2024,'planSha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),'anchorSource':meta,
    'intervalLevel':.95,'sourceModelDate':latest,'framesSha256':hashlib.sha256(frames_path.read_bytes()).hexdigest(),
    'runs':[],'quarantined':[]}
for frame in frames:
    try:
        # Only contemporaneous source counts and estimates define this input.
        units=frame['units']
        if not units or any(u['total']<=0 or not isinstance(u.get('reported'),(int,float)) or not 0<u['reported']<=100 for u in units):
            raise ValueError('Cannot aggregate source estimate with a missing/zero-count county')
        estimated=sum(u['total']/(u['reported']/100) for u in units)
        reported=min(100,100*frame['total']/estimated)
        if reported<25:raise ValueError('Source-estimated reporting below frozen scope')
        if any(sum(u[k] for u in units)!=frame[k] for k in ('d','r','total')):raise ValueError('State reconciliation failed')
        final=truth[frame['state']]
        if frame['d']>final['demVotes'] or frame['r']>final['repVotes'] or frame['total']>final['totalVotes']:
            raise ValueError('Source count requires correction against certified controls')
        prior=states[frame['state']]
        d,r=(prior[(party,'state vote','median')] for party in ('DEM','REP'))
        pair=d+r
        center=prior[('DEM','state vote dem margin','median')]
        lo,hi=(prior[('DEM','state vote dem margin',metric)] for metric in ('lower','upper'))
        if not 0<pair<=1.0001 or min(d,r)<=0 or not -1<lo<center<hi<1:raise ValueError('Invalid source candidate/interval metrics')
        # The source documents a 95% interval, not p10/p90. No outcome tuning.
        sd=(hi-lo)/(2*1.959963984540054)/pair
        unit='race:2024-'+frame['state']
        priors={unit:{'margin':center/pair,'total':1}}
        calibrated=dict(model)
        calibrated['swingLoading']=np.array([[math.sqrt(max(0,sd**2-model['countyVariance'])),0.],[0.,0.]])
        collapsed={'state':frame['state'],'at':frame['at'],'units':[{'fips':unit,
            **{k:frame[k] for k in ('d','r','total')},'reported':reported}]}
        prediction=study.forecast(collapsed,priors,calibrated)
        pd,pr=(prior[(party,'state vote','p_win')] for party in ('DEM','REP'))
        if not 0<pd+pr<=1.0001:raise ValueError('Invalid source win denominator')
        result['runs'].append({'id':frame['state']+'@'+frame['at'],'state':frame['state'],'at':frame['at'],
            'reported':reported,'anchorMarginPoints':100*center,'priorSigma':sd,
            'kernelInput':{'id':'race-2024-'+frame['state'],'margin':center/pair,'marginSigmaPoints':sd*100,
                **{k:frame[k] for k in ('d','r','total')},'reported':reported},
            'forecasts':{'aggregate':prediction,'frozen-source':{'probabilityD':pd/(pd+pr)}},
            'truthMargin':final['margin'],'winnerD':final['demVotes']>final['repVotes']})
    except (KeyError,ValueError) as error:
        result['quarantined'].append({'state':frame['state'],'at':frame['at'],'reason':str(error)})
path=root/'probability-aggregate-2024-study.json'
path.write_text(json.dumps(result,indent=2))
print(json.dumps({'forecasts':len(result['runs']),'quarantined':len(result['quarantined']),'modelDate':latest,'output':str(path)}))
