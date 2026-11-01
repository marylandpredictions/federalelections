"""Read the Clerk's official 2024 PDF text; never manufacture missing returns.
Requires a text export made with pypdf's layout extraction. Does not edit PDFs.
Usage: python scripts/results/import-clerk-comparisons.py text-file pdf-file
"""
import sys,re,json,hashlib
from pathlib import Path

states=dict(x.split(':') for x in 'AL:ALABAMA|AK:ALASKA|AZ:ARIZONA|AR:ARKANSAS|CA:CALIFORNIA|CO:COLORADO|CT:CONNECTICUT|DE:DELAWARE|FL:FLORIDA|GA:GEORGIA|HI:HAWAII|ID:IDAHO|IL:ILLINOIS|IN:INDIANA|IA:IOWA|KS:KANSAS|KY:KENTUCKY|LA:LOUISIANA|ME:MAINE|MD:MARYLAND|MA:MASSACHUSETTS|MI:MICHIGAN|MN:MINNESOTA|MS:MISSISSIPPI|MO:MISSOURI|MT:MONTANA|NE:NEBRASKA|NV:NEVADA|NH:NEW HAMPSHIRE|NJ:NEW JERSEY|NM:NEW MEXICO|NY:NEW YORK|NC:NORTH CAROLINA|ND:NORTH DAKOTA|OH:OHIO|OK:OKLAHOMA|OR:OREGON|PA:PENNSYLVANIA|RI:RHODE ISLAND|SC:SOUTH CAROLINA|SD:SOUTH DAKOTA|TN:TENNESSEE|TX:TEXAS|UT:UTAH|VT:VERMONT|VA:VIRGINIA|WA:WASHINGTON|WV:WEST VIRGINIA|WI:WISCONSIN|WY:WYOMING'.split('|'))
by_name={v:k for k,v in states.items()}
state=None;office=None;district=None;house={};senate={};unparsed=[];last=None
for lineno,line in enumerate(Path(sys.argv[1]).read_text(encoding='utf-8').splitlines(),1):
    line=line.strip().replace('\ufffd',' ').replace('\u00a0',' ')
    heading=re.split(r'[—–]|\s+Continued',line)[0].strip()
    if heading in by_name:state=by_name[heading];office=None;district=None;last=None;continue
    if line.startswith('FOR UNITED STATES REPRESENTATIVE'):office='house';continue
    if line.startswith('FOR UNITED STATES SENATOR'):office='senate';continue
    if line.startswith('FOR PRESIDENTIAL') or line.startswith('Recapitulation') or line.startswith('DISTRICT OF COLUMBIA'):office=None;continue
    if office=='house' and line=='AT LARGE':district='AL';continue
    if not state or not office:continue
    match=re.match(r'^(.*?)\.{3,}\s*([\d,]+)\s*$',line)
    if not match:continue
    name,votes=match.groups();name=name.strip()
    d=re.match(r'^(\d+)\.\s*(.*)',name)
    if d:district=f'{int(d[1]):02d}';name=d[2]
    if office=='house' and district is None:unparsed.append({'line':lineno,'text':line[:90]});continue
    if re.match(r'^(blank|over|under|void|continuing ballots|exhausted ballots|total)(\s|$)',name,re.I):continue
    if ', ' in name:name,party=name.rsplit(', ',1)
    elif re.match(r'^(write-in|write-ins|other write-ins|all others|others|scattering)(\s|$|\()',name,re.I):party='Write-in / other'
    elif last is not None:
        # Indented fusion ballot lines belong to the immediately preceding
        # named candidate. They are vote counts, not a second candidate.
        last['votes']+=int(votes.replace(',',''));last.setdefault('fusionLabels',[]).append(name);continue
    else:unparsed.append({'line':lineno,'text':line[:90]});continue
    row={'name':name.strip(),'partyLabel':party.strip(),'votes':int(votes.replace(',','')),'sourceLine':lineno}
    target=house if office=='house' else senate
    key=f'{state}-{district}' if office=='house' else state
    target.setdefault(key,[]).append(row)
    last=row

source={'authority':'Office of the Clerk, U.S. House of Representatives','url':'https://clerk.house.gov/member_info/electionInfo/2024/statistics2024.pdf','publishedAt':'2025-03-10','sha256':hashlib.sha256(Path(sys.argv[2]).read_bytes()).hexdigest()}
output={'source':source,'house':house,'senate':senate,'unparsed':unparsed}
Path('data/baselines/source/clerk-2024-candidates.json').write_text(json.dumps(output,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print('Clerk extraction:',len(house),'House districts,',len(senate),'Senate states;',len(unparsed),'unparsed candidate lines')
if len(house)!=435: print('Missing districts require review; do not assume complete coverage.')
