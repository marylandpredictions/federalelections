"""Historical evaluation only. Final turnout selects scoring strata, never model inputs.

Source publisher corrections are checked after selecting the earliest frame per
stratum; a rejected frame is quarantined rather than replaced with a later one.
"""
import importlib.util
import json
import argparse
import csv
import hashlib
import sys
from collections import Counter
from pathlib import Path

spec=importlib.util.spec_from_file_location("county", "scripts/results/probability-county-count-study.py")
county=importlib.util.module_from_spec(spec)
spec.loader.exec_module(county)
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("capture_directory",type=Path)
parser.add_argument("year",type=int,choices=[2020,2024])
args=parser.parse_args()
root=args.capture_directory
year=args.year
path=root/f"probability-medsl{year}-counties.csv.gz"
county.verified(path, year)
references={r["fips"]:r for r in json.loads(Path(f"data/baselines/pres-{year}-counties.json").read_text())["rows"] if r["valid"]}
truth={r["state"]:r for r in json.loads(Path(f"data/baselines/pres-{year}-states.json").read_text())["states"] if r["valid"]}
expected={}
for fips,row in references.items():
    expected.setdefault(row["state"],set()).add(fips)
frames={}

def collect(row):
    if any(row.get(key) is None for key in ("d","r","total")) or row["d"]+row["r"]>row["total"]:
        return
    key=(row["state"],row["at"])
    frame=frames.setdefault(key,{"ids":set(),"records":{},"controls":set(),"d":0,"r":0,"total":0,"duplicate":False})
    if row["fips"] in frame["ids"]:
        old=frame["records"][row["fips"]]
        if any(old.get(field)!=row.get(field) for field in ("d","r","total","reported")):
            frame["duplicate"]=True
        return
    frame["ids"].add(row["fips"])
    frame["records"][row["fips"]]=row
    if row.get("stateReportedTotal") is not None:
        frame["controls"].add(row["stateReportedTotal"])
    for key in ("d","r","total"):
        frame[key]+=row[key]

reader=county.read_2020 if year==2020 else county.read_2024
_,diagnostics=reader(path,references,on_snapshot=collect)
selected={}
rejected=Counter()
for (state,at),frame in sorted(frames.items()):
    if frame["duplicate"]:
        rejected["duplicateCounty"]+=1
        continue
    if frame["ids"]!=expected[state]:
        rejected["incompleteGeography"]+=1
        continue
    if year==2020 and (len(frame["controls"])!=1 or next(iter(frame["controls"]))!=frame["total"]):
        rejected["stateCountyTotalMismatch"]+=1
        continue
    if not frame["total"]:
        continue
    fraction=frame["total"]/truth[state]["totalVotes"]
    bucket=county.stage(100*fraction)
    if bucket is None or bucket=="100":
        continue
    key=(state,bucket)
    if key not in selected:
        selected[key]={"state":state,"at":at,"stage":bucket,"countedShareForScoring":fraction,
                       "counties":len(frame["ids"]),"d":frame["d"],"r":frame["r"],"total":frame["total"]}
targets={(r["state"],r["at"]):r for r in selected.values()}

def retain(row):
    target=targets.get((row["state"],row["at"]))
    if target is not None:
        units=target.setdefault("units",[])
        if not any(unit["fips"]==row["fips"] for unit in units):
            units.append(row)

reader(path,references,on_snapshot=retain)
if year==2024:
    raw=(root/"probability-medsl-state2024.csv").read_bytes()
    digest=hashlib.sha256(raw).hexdigest()
    if digest!="131ca71808573afec6dabddabe312b24d5172fa1ade837938836a7743cb908ee":
        raise ValueError("Corrected state-control checksum mismatch")
    controls={}
    for row in csv.DictReader(raw.decode("utf-8-sig").splitlines()):
        key=(row["state"],row["time"])
        counts=controls.setdefault(key,{})
        if row["candidate"] in counts:
            raise ValueError("Duplicate candidate in state control")
        counts[row["candidate"]]=int(row["votes"])
    for frame in selected.values():
        counts=controls.get((frame["state"],frame["at"]))
        if counts is None:
            frame["stateControl"]="missing-at-exact-source-time"
        elif (counts.get("Harris")!=frame["d"] or counts.get("Trump")!=frame["r"] or sum(counts.values())!=frame["total"]):
            frame["stateControl"]="candidate-or-total-mismatch"
        else:
            frame["stateControl"]="exact-match"
else:
    for frame in selected.values():
        frame["stateControl"]="exact-match"
output={"year":year,"stageBasis":"Actual final turnout is used only to select evaluation strata.",
        "timeConvention":"Original source clock, with no assumed timezone conversion.",
        "diagnostics":diagnostics,"rejectedFrames":dict(rejected),"frames":list(selected.values())}
(root/f"probability-medsl{year}-state-frames.json").write_text(json.dumps(output))
print(json.dumps({"year":year,"states":len({state for state,_ in selected}),"frames":len(selected),
                  "rejected":dict(rejected),"stateControls":dict(Counter(r["stateControl"] for r in selected.values()))}))
