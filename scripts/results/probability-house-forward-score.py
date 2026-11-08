"""Score the frozen House race extension, never fit or update its model."""
import argparse
from collections import defaultdict
import hashlib
import importlib.util
import json
from pathlib import Path
import re

import numpy as np


def normalized_id(value):
    if value in ("2022-de-house", "2022-wy-house"):
        return value+"-1"
    return value


def summarize(rows, method):
    values=[row["forecasts"][method] for row in rows]
    p=np.array([value["probabilityD"] for value in values])
    y=np.array([row["winnerD"] for row in rows],dtype=float)
    if np.any(~np.isfinite(p)|(p<0)|(p>1)) or method!='frozen-source' and np.any((p==0)|(p==1)):
        raise ValueError("Model probabilities must be finite and strictly inside zero and one")
    outcome_probability=np.where(y,p,1-p)
    infinite=int(np.sum(outcome_probability==0))
    result={"races":len(rows),"states":len({row["state"] for row in rows}),
            "brier":float(np.mean((p-y)**2)),
            "logLoss":None if infinite else float(np.mean(-np.log(outcome_probability))),
            "infiniteLogLossCases":infinite,
            "false95":int(np.sum((p>=.95)&(y==0)|(p<=.05)&(y==1)))}
    if all("median" in value and "interval80" in value for value in values):
        result["marginMae"]=float(np.mean([abs(value["median"]-row["truthMargin"]) for value,row in zip(values,rows)]))
        result["coverage80"]=float(np.mean([value["interval80"][0]<=row["truthMargin"]<=value["interval80"][1] for value,row in zip(values,rows)]))
    return result


def paired_brier(rows, method, comparison, draws=5000):
    grouped=defaultdict(list)
    for row in rows:
        truth=float(row["winnerD"])
        difference=(row["forecasts"][method]["probabilityD"]-truth)**2-(row["forecasts"][comparison]["probabilityD"]-truth)**2
        grouped[row["state"]].append(difference)
    if len(grouped)<2:
        return {"status":"too few independent state clusters"}
    groups=list(grouped.values())
    totals=np.array([sum(group) for group in groups])
    sizes=np.array([len(group) for group in groups])
    indices=np.random.default_rng(20261107).integers(0,len(groups),size=(draws,len(groups)))
    samples=np.sum(totals[indices],axis=1)/np.sum(sizes[indices],axis=1)
    return {"method":method,"comparison":comparison,"stateClusters":len(groups),"draws":draws,
            "difference":float(sum(totals)/sum(sizes)),"interval95":np.quantile(samples,[.025,.975]).tolist()}


def run(root, input_path, frames_path, output_path):
    plan_path=Path("data/results/probability-house-forward-plan.json")
    plan=json.loads(plan_path.read_text(encoding="utf8"))
    for path,expected in plan["normalizedLfCodeSha256"].items():
        if hashlib.sha256(Path(path).read_bytes().replace(b"\r\n",b"\n")).hexdigest()!=expected:
            raise ValueError("Frozen research code changed: "+path)
    source=json.loads(input_path.read_text(encoding="utf8"))
    if source["captureSha256"]!=hashlib.sha256(frames_path.read_bytes()).hexdigest():
        raise ValueError("Forecasts do not match the scored source frames")
    frames=json.loads(frames_path.read_text(encoding="utf8"))
    by_id={row["id"]:row for row in frames["frames"]}
    if len(by_id)!=len(frames["frames"]):
        raise ValueError("Repeated race in equal-race evaluation")
    spec=importlib.util.spec_from_file_location("frozen_house",Path(__file__).with_name("probability-frozen-house-study.py"))
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    anchors,_=module.read_anchors(root)
    rows=[]
    for prediction in source["runs"]:
        row={**prediction,"forecasts":dict(prediction["forecasts"])}
        frame=by_id[row["id"]]
        row["state"]=frame["state"]
        row["stage"]=frame["stage"]
        row["productionInputsEligible"]=frame["reported"]>=25 and all(
            unit["total"]>0 and unit.get("reported") is not None and 0<unit["reported"]<=100
            for unit in frame["units"])
        anchor=anchors[f'{frame["state"]}-{frame["district"]}']
        for party in ("D","R"):
            if anchor["name_"+party+"1"]!=row["anchorNames"][party]:
                raise ValueError("Forecast candidate metadata differs from frozen anchor")
        d,r=(float(anchor["winner_"+party+"1"]) for party in ("D","R"))
        if not 0<d+r<=1.000001 or min(d,r)<0:
            raise ValueError("Unusable source candidate-win denominator")
        # Keep the source's actual 0/1 values. Brier comparisons include them;
        # an impossible observed event is explicitly infinite logarithmic loss.
        row["forecasts"]["frozen-source"]={"probabilityD":d/(d+r),"median":float(anchor["mean_netpartymargin"]),
            "pointEstimateType":"source mean", "interval80":[float(anchor["p10_netpartymargin"]),float(anchor["p90_netpartymargin"])]}
        rows.append(row)
    inspected={normalized_id(value) for value in plan["previouslyInspected"]}
    report={"status":"research-score; no release authorized","planSha256":hashlib.sha256(plan_path.read_bytes()).hexdigest(),
            "forecastSha256":hashlib.sha256(input_path.read_bytes()).hexdigest(),"quarantined":source["quarantined"],"cohorts":{}}
    for scope,selected in [("all",rows),("new-races",[row for row in rows if normalized_id(row["id"]) not in inspected])]:
        groups={"all-stages":selected,"prior-competitive":[row for row in selected if abs(row["anchorMarginPoints"])<=10],
                "supported-stages":[row for row in selected if row["stage"]!='1-24'],
                "supported-prior-competitive":[row for row in selected if row["stage"]!='1-24' and abs(row["anchorMarginPoints"])<=10]}
        groups["production-inputs"]=[row for row in selected if row["productionInputsEligible"]]
        groups["production-inputs-prior-competitive"]=[row for row in selected if row["productionInputsEligible"] and abs(row["anchorMarginPoints"])<=10]
        groups.update({stage:[row for row in selected if row["stage"]==stage] for stage in ("1-24","25-59","60-89","90-99","100")})
        report["cohorts"][scope]={}
        for group,cohort in groups.items():
            if not cohort:continue
            methods={method:summarize(cohort,method) for method in plan["models"]}
            paired=[paired_brier(cohort,method,"historical-only") for method in plan["models"] if method!="historical-only"]
            comparable=[row for row in cohort if "frozen-source" in row["forecasts"]]
            if comparable:
                methods["frozen-source"]=summarize(comparable,"frozen-source")
                paired.extend(paired_brier(comparable,method,"frozen-source") for method in plan["models"])
            report["cohorts"][scope][group]={"metrics":methods,"paired":paired}
    report["rows"]=rows
    output_path.write_text(json.dumps(report,indent=2),encoding="utf8")
    print(json.dumps({"cohorts":{scope:{group:data["metrics"] for group,data in groups.items()} for scope,groups in report["cohorts"].items()},
                      "quarantined":len(report["quarantined"])}))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root",type=Path)
    parser.add_argument("forecasts",type=Path)
    parser.add_argument("frames",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    run(args.root,args.forecasts,args.frames,args.output)
