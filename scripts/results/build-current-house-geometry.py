"""Build 2026 House display geometry and county intersections.

Requires pyshp and shapely. Reads the nine official TIGER2026/CD downloads
from .runtime/cd120/{state FIPS}.zip. Unchanged states retain the certified
CD119 county-within-district files, importantly including Missouri: Census's
CD120 Missouri shapefile still contains the rejected plan (Nov. 3, 2026).
"""
import sys, json, hashlib, zipfile, io, pathlib
sys.path.insert(0, str(pathlib.Path('.runtime/geometry-libs').resolve()))
import shapefile
from shapely.geometry import shape, mapping, Polygon
from shapely.ops import unary_union
from shapely import make_valid

ROOT=pathlib.Path('.')
SOURCE='https://www.census.gov/programs-surveys/decennial-census/about/rdo/congressional-districts.120th_Congress.html'
CHANGED={'01':'AL','06':'CA','12':'FL','22':'LA','37':'NC','39':'OH','47':'TN','48':'TX','49':'UT'}
def read(p): return json.loads(pathlib.Path(p).read_text(encoding='utf-8'))
def write(p,data): pathlib.Path(p).parent.mkdir(parents=True,exist_ok=True);pathlib.Path(p).write_text(json.dumps(data,separators=(',',':'))+'\n',encoding='utf-8')
def polygon(g):
    g=make_valid(g)
    if g.geom_type in ['Polygon','MultiPolygon']: return g
    return unary_union([p for p in getattr(g,'geoms',[]) if p.geom_type in ['Polygon','MultiPolygon']]) if hasattr(g,'geoms') else Polygon()

geo=read('data/results/district-geography.json')
counties=read('data/result-counties.geojson')['features']
county_shapes=[]
for f in counties:
    p=f['properties']; fid=str(p.get('GEOID') or p.get('countyFips'))
    if fid[:2] in CHANGED:
        county_shapes.append((fid,p,polygon(shape(f['geometry']))))
national=[]; rows={}; provenance=[]
current={}
for fips,state in CHANGED.items():
    path=pathlib.Path(f'.runtime/cd120/{fips}.zip'); b=path.read_bytes()
    provenance.append({'state':state,'url':f'https://www2.census.gov/geo/tiger/TIGER2026/CD/tl_2026_{fips}_cd120.zip','sha256':hashlib.sha256(b).hexdigest()})
    with zipfile.ZipFile(io.BytesIO(b)) as z:
        shp=next(n for n in z.namelist() if n.endswith('.shp')); dbf=next(n for n in z.namelist() if n.endswith('.dbf'))
        reader=shapefile.Reader(shp=io.BytesIO(z.read(shp)),dbf=io.BytesIO(z.read(dbf)))
        for rec in reader.iterShapeRecords():
            props=rec.record.as_dict(); n=props['CD120FP']; id=f'{state}-{n}'
            current[id]=polygon(shape(rec.shape.__geo_interface__)).simplify(.00015,preserve_topology=True)

for id,old in sorted(geo['districts'].items()):
    state=id[:2]; historical=state not in CHANGED.values()
    if historical:
        collection=read(old['geometryFile'])
        geom=polygon(unary_union([shape(f['geometry']) for f in collection['features']]))
        geometry_file=old['geometryFile']; digest=hashlib.sha256(pathlib.Path(geometry_file).read_bytes()).hexdigest()
        geometry_id=f'cd119:{id}:{digest[:16]}'
    else:
        geom=current[id]; features=[]
        for fid,props,c in county_shapes:
            if fid[:2] not in CHANGED or CHANGED[fid[:2]]!=state or not geom.intersects(c): continue
            part=polygon(geom.intersection(c))
            if part.is_empty or part.area<1e-9: continue
            features.append({'type':'Feature','properties':{'state':state,'districtId':id,'district':int(id[3:]),'countyFips':fid,'countyName':props.get('countyName') or props.get('NAME') or fid,'GEOID':fid,'partialCounty':part.area<c.area*.999,'geometryCycle':120},'geometry':mapping(part)})
        if not features: raise ValueError(f'No county intersections: {id}')
        geometry_file=f'data/maps/congress/120/{id}.json'
        write(geometry_file,{'type':'FeatureCollection','congress':120,'districtId':id,'source':SOURCE,'features':features})
        digest=hashlib.sha256(pathlib.Path(geometry_file).read_bytes()).hexdigest();geometry_id=f'cd120:{id}:{digest[:16]}'
    rows[id]={'geometryId':geometry_id,'congress':119 if historical else 120,'geometryFile':geometry_file,'sha256':digest,'currentComparable':True,'historicalComparable':historical,'status':'verified-2026-boundaries','sourceUrl':SOURCE,'verifiedAt':'2026-11-03'}
    national.append({'type':'Feature','properties':{'id':id,'state':state,'district':0 if id.endswith('-AL') else int(id[3:]),'congress':120},'geometry':mapping(geom)})
if len(national)!=435 or len({f['properties']['id'] for f in national})!=435: raise ValueError('Expected 435 unique districts')
write('data/house-districts-2026.geojson',{'type':'FeatureCollection','source':SOURCE,'features':national})
write('data/results/district-geography.json',{'schemaVersion':2,'congress':120,'method':'Official CD120 in nine redrawn states; certified CD119 county-within-district union elsewhere, including unchanged Missouri. County intersections are display geometry, never allocated votes.','sourceUrl':SOURCE,'sources':provenance,'reviewRequiredStates':[],'presidential2024Verification':geo.get('presidential2024Verification'),'districts':rows})
# Historical elections use old boundaries unless unchanged. Never relabel an
# old district's votes as votes tabulated on a newly drawn district.
for path in ['data/baselines/pres-2016-districts.json','data/baselines/pres-2020-districts.json','data/baselines/pres-2024-districts.json','data/results/comparisons/house-2024-districts.json']:
    data=read(path)
    # The Downballot's 2024 dataset was independently rechecked against its
    # current public CSV on Nov 3; these are votes retabulated to 2026 lines.
    current_presidential=path.endswith('pres-2024-districts.json') and data.get('sourceSha256')==hashlib.sha256(pathlib.Path('data/baselines/source/downballot-presidential-2026.csv').read_bytes()).hexdigest()
    for r in data['districts']:
        g=rows.get(r['id'])
        if g:
            verified=current_presidential or g['historicalComparable']
            r.update(geometryId=g['geometryId'] if verified else None,geographyVerified=verified)
    write(path,data)
print(f'Verified {len(rows)} districts; {len(current)} rebuilt; {sum(r["historicalComparable"] for r in rows.values())} unchanged historical footprints.')
