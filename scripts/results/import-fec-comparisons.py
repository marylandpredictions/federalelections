"""Read-only FEC extraction. Usage: python import-fec-comparisons.py YEAR workbook.xlsx
Requires openpyxl; does not author or edit the workbook.
"""
import sys,json,hashlib
from pathlib import Path
import openpyxl
year=int(sys.argv[1]);path=Path(sys.argv[2]);book=openpyxl.load_workbook(path,read_only=True,data_only=True)
source=f'https://www.fec.gov/resources/cms-content/documents/federalelections{year}.xlsx' if year!=2020 else 'https://www.fec.gov/documents/4228/federalelections2020.xlsx'
sha=hashlib.sha256(path.read_bytes()).hexdigest()
if year in [2016,2020]:
    sheet=next(s for s in book.sheetnames if 'Table 2' in s and 'Elect' in s);rows=[]
    for row in book[sheet].values:
        state=str(row[0] or '').replace('*','')
        if len(state)!=2 or not isinstance(row[3],(int,float)):continue
        d,r=(row[4],row[3]) if year==2016 else (row[3],row[4])
        rows.append(dict(state=state,demVotes=int(d),repVotes=int(r),totalVotes=int(row[6]),valid=True))
    controls={k:sum(r[k] for r in rows) for k in ['demVotes','repVotes','totalVotes']}
    expected={2016:(65853514,62984828,136669276),2020:(81283501,74223975,158429631)}[year]
    assert len(rows)==51 and tuple(controls.values())==expected,'FEC national controls failed'
    out={'source':f'Federal Election Commission, Federal Elections {year}, Table 2','sourceUrl':source,'sourceSha256':sha,'worksheet':sheet,'marginBasis':'all-votes','controls':controls,'states':rows}
    Path(f'data/baselines/source/fec-president-{year}-states.json').write_text(json.dumps(out,indent=2)+'\n',encoding='utf-8')
if year in [2020,2022]:
    sheet=next(s for s in book.sheetnames if 'US Senate Results' in s);rows=[]
    for row in book[sheet].values:
        if not isinstance(row[1],str) or len(row[1])!=2 or not isinstance(row[15],(int,float)) or not row[8] or row[9]:continue
        if year==2022 and row[1] not in ['FL','OH','OK']:continue
        item={'state':row[1],'district':row[3],'id':row[4],'first':str(row[6] or '').strip(),'last':str(row[7] or '').strip(),'name':str(row[8]).strip(),'party':row[10],'votes':int(row[15])}
        if year==2020:item['runoffVotes']=int(row[17]) if isinstance(row[17],(int,float)) else None
        rows.append(item)
    suffix='rows' if year==2020 else 'special-seats'
    Path(f'data/baselines/source/fec-senate-{year}-{suffix}.json').write_text(json.dumps({'source':source,'sourceSha256':sha,'worksheet':sheet,'rows':rows},indent=2)+'\n',encoding='utf-8')
print('Imported FEC returns with workbook hash and worksheet provenance.')
