"""Research-only race-level input fallback, evaluated without refitting."""
import csv
from datetime import datetime,timezone
import hashlib
import importlib.util
import json
from pathlib import Path

root=Path('.runtime')
plan_path=Path('data/results/probability-aggregate-forward-plan.json')
plan=json.loads(plan_path.read_text())
for path,expected in plan['normalizedLfCodeSha256'].items():
    if hashlib.sha256(Path(path).read_bytes().replace(b'\r\n',b'\n')).hexdigest()!=expected:
        raise ValueError('Frozen statistical source changed: '+path)
spec=importlib.util.spec_from_file_location('house',Path(__file__).with_name('probability-frozen-house-study.py'))
house=importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)
study=house.study
county,history,refs,_,_,_=study.load_study(root)
model=study.fit(county,history,refs)
output={'status':'exploratory race-level fallback; not a production release',
    'planSha256':hashlib.sha256(plan_path.read_bytes()).hexdigest(),'runs':[],'quarantined':[],'sources':{}}
for office in ('house','senate','governor'):
    if office=='house':
        frames_path=root/'probability-house-cohort-frames.json'
        forecasts_path=root/'probability-house-cohort-forecasts.json'
        anchors,metadata=house.read_anchors(root)
    else:
        frames_path=root/f'probability-state-extension-{office}-frames.json'
        forecasts_path=root/f'probability-state-extension-{office}-forecasts.json'
        metadata=study.read(root/f'probability-538-{office}-2022-pre-election-capture.json')
        raw=(root/metadata['file']).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=metadata['sha256']:raise ValueError('Anchor checksum mismatch')
        available=datetime.strptime(metadata['capturedAt'],'%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
        if available>=datetime(2022,11,8,tzinfo=timezone.utc):raise ValueError('Anchor is not pre-election')
        latest={}
        for row in csv.DictReader(raw.decode('utf-8-sig').splitlines()):
            if row['cycle']!='2022' or row['branch']!={'senate':'Senate','governor':'Governor'}[office] or row['expression']!='_deluxe':continue
            at=datetime.strptime(row['forecastdate'],'%m/%d/%y').replace(tzinfo=timezone.utc)
            if at>available:raise ValueError('Future forecast row')
            key=row['district']
            if key not in latest or at>latest[key][0]:latest[key]=(at,row)
        anchors={key:row for key,(_,row) in latest.items()}
    frames={f['id']:f for f in study.read(frames_path)['frames']}
    forecasts=study.read(forecasts_path)['runs']
    output['sources'][office]={'framesSha256':hashlib.sha256(frames_path.read_bytes()).hexdigest(),
        'forecastsSha256':hashlib.sha256(forecasts_path.read_bytes()).hexdigest(),'anchor':metadata}
    for reference in forecasts:
        frame=frames[reference['id']]
        try:
            if frame['reported']<25 or frame['total']<=0:raise ValueError('Race reporting below the specified scope')
            if office=='house':row=anchors[f'{frame["state"]}-{frame["district"]}']
            else:
                matching=[r for key,r in anchors.items() if key.startswith(frame['state']+'-') and all(
                    house.identity(r['name_'+p+'1'])==house.identity(reference['anchorNames'][p]) for p in ('D','R'))]
                if len(matching)!=1:raise ValueError('Missing unique pre-election candidate anchor')
                row=matching[0]
            d,r=(float(row['voteshare_mean_'+p+'1']) for p in ('D','R'))
            if min(d,r)<=0 or d+r>100.001:raise ValueError('Invalid pair shares')
            # This is explicitly a race unit, never a fabricated county FIPS.
            unit='race:'+frame['id']
            priors={unit:{'margin':(d-r)/(d+r),'total':float(row['mean_predicted_turnout'])}}
            calibrated,uncertainty=house.anchored_uncertainty(model,priors,row)
            collapsed={**frame,'units':[{'fips':unit,**{k:frame[k] for k in ('d','r','total','reported')}}]}
            prediction=study.forecast(collapsed,priors,calibrated)
            wins=float(row['winner_D1'])+float(row['winner_R1'])
            if not 0<wins<=1.000001:raise ValueError('Invalid frozen win denominator')
            baseline={'probabilityD':float(row['winner_D1'])/wins,'median':d-r,
                'interval80':[float(row['p10_netpartymargin']),float(row['p90_netpartymargin'])]}
            output['runs'].append({'id':frame['id'],'office':office,'state':frame['state'],
                'at':frame['at'],'reported':frame['reported'],'anchorMarginPoints':d-r,
                'forecasts':{'aggregate':prediction,'geographic':reference['forecasts']['candidate-and-uncertainty'],
                    'frozen-source':baseline},'truthMargin':frame['truthMargin'],'winnerD':frame['winnerD']})
        except (ValueError,KeyError) as error:output['quarantined'].append({'id':frame['id'],'reason':str(error)})
path=root/'probability-aggregate-study.json'
path.write_text(json.dumps(output,indent=2))
print(json.dumps({'output':str(path),'races':len(output['runs']),'quarantined':len(output['quarantined'])}))
