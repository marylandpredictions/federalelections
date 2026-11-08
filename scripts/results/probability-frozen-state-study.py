"""Evaluate the frozen House candidate/uncertainty method across offices."""
import csv
from datetime import datetime,timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

root=Path('.runtime')
spec=importlib.util.spec_from_file_location('house',Path('scripts/results/probability-frozen-house-study.py'))
house=importlib.util.module_from_spec(spec)
spec.loader.exec_module(house)
study=house.study
office=sys.argv[1]
if office not in ['senate','governor']:raise ValueError('Unsupported office')
plan=study.read('data/results/probability-state-forward-plan.json')
for path,expected in plan['normalizedLfCodeSha256'].items():
    if hashlib.sha256(Path(path).read_bytes().replace(b'\r\n',b'\n')).hexdigest()!=expected:
        raise ValueError('Frozen statistical implementation changed: '+path)
meta=study.read(root/f'probability-538-{office}-2022-pre-election-capture.json')
source=f'https://projects.fivethirtyeight.com/2022-general-election-forecast-data/{office}_state_toplines_2022.csv'
if meta['source']!=source:raise ValueError('Unexpected anchor source')
raw=(root/meta['file']).read_bytes()
if hashlib.sha256(raw).hexdigest()!=meta['sha256'] or len(raw)!=meta['decodedBytes']:raise ValueError('Anchor checksum mismatch')
available=datetime.strptime(meta['capturedAt'],'%Y%m%d%H%M%S').replace(tzinfo=timezone.utc)
if available>=datetime(2022,11,8,tzinfo=timezone.utc):raise ValueError('Anchor is not pre-election')
latest={}
for row in csv.DictReader(raw.decode('utf-8-sig').splitlines()):
    if row['cycle']!='2022' or row['branch']!={'senate':'Senate','governor':'Governor'}[office] or row['expression']!='_deluxe':continue
    date=datetime.strptime(row['forecastdate'],'%m/%d/%y').replace(tzinfo=timezone.utc)
    if date>available:raise ValueError('Future anchor row')
    key=row['district']
    if key in latest and latest[key][0]==date:raise ValueError('Duplicate frozen row')
    if key not in latest or date>latest[key][0]:latest[key]=(date,row)

county,history,refs,priors,_,_=study.load_study(root)
model=study.fit(county,history,refs)
frames_path=root/f'probability-state-extension-{office}-frames.json'
captured=study.read(frames_path)
report={'status':'research-only; conditional D/R component, not approval of a complete candidate win vector',
    'office':office,'planSha256':hashlib.sha256(Path('data/results/probability-state-forward-plan.json').read_bytes()).hexdigest(),
    'anchorSource':meta,'framesSha256':hashlib.sha256(frames_path.read_bytes()).hexdigest(),
    'runs':[],'quarantined':captured['quarantined'].copy()}
for frame in captured['frames']:
    try:
        matches=[row for key,(_,row) in latest.items() if key.startswith(frame['state']+'-') and
            all(house.identity(row['name_'+party+'1'])==house.identity(frame['candidateControlNames'][party]) for party in ('D','R'))]
        if len(matches)!=1:raise ValueError('Frozen candidate identities missing or ambiguous')
        row=matches[0]
        if any(float(row['voteshare_mean_'+party+str(index)] or 0)!=0 for party in ('D','R') for index in (2,3,4)):
            raise ValueError('Multiple major-party candidates outside conditional component')
        d,r=(float(row['voteshare_mean_'+party+'1']) for party in ('D','R'))
        if min(d,r)<=0 or d+r>100.001:raise ValueError('Invalid anchor share')
        historical={unit['fips']:priors[2024][unit['fips']] for unit in frame['units']}
        anchored=house.tilt(historical,(d-r)/(d+r),float(row['mean_predicted_turnout']))
        anchored_model,uncertainty=house.anchored_uncertainty(model,anchored,row)
        predictions={'historical-only':study.forecast(frame,historical,model),
            'candidate-and-uncertainty':study.forecast(frame,anchored,anchored_model)}
        pair=d+r
        prior={'probabilityD':float(row['winner_D1'])/(float(row['winner_D1'])+float(row['winner_R1'])),
            'median':d-r,'interval80':[float(row['p10_netpartymargin']),float(row['p90_netpartymargin'])]}
        predictions['frozen-source']=prior
        report['runs'].append({'id':frame['id'],'state':frame['state'],'at':frame['at'],'reported':frame['reported'],
            'previouslyInspected':frame['id'] in plan['previouslyInspected'],
            'anchorMarginPoints':d-r,'anchorNames':frame['candidateControlNames'],
            'forecasts':predictions,'uncertainty':uncertainty,'truthMargin':frame['truthMargin'],'winnerD':frame['winnerD']})
    except (ValueError,KeyError) as error:report['quarantined'].append({'id':frame['id'],'reason':str(error)})
path=root/f'probability-state-extension-{office}-forecasts.json'
path.write_text(json.dumps(report,indent=2))
print(json.dumps({'office':office,'forecasts':len(report['runs']),'quarantined':len(report['quarantined']),'output':str(path)}))
