"""Score research forecasts with paired state-cluster bootstrap uncertainty.

These diagnostics do not authorize publication or generalize presidential
validation to House, Senate, governor, ranked-choice, or multi-candidate races.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path

import numpy as np


def score(rows, draws=5000):
    by_state=defaultdict(list)
    for row in rows:
        predictions=row["forecasts"]
        if any(predictions[key]["status"]!="research" for key in ("baseline","partial")):
            continue
        y=int(row["winnerD"])
        actual=row["truthMargin"]
        metrics=[]
        for key in ("baseline","partial"):
            prediction=predictions[key]
            p=prediction["probabilityD"]
            if not 0<p<1:
                raise ValueError("Non-finite or extreme research probability")
            low,high=prediction["interval80"]
            metrics.extend([(p-y)**2,-y*np.log(p)-(1-y)*np.log(1-p),
                            abs(prediction["median"]-actual),int(low<=actual<=high),
                            int(p>.95 and not y or p<.05 and y)])
        by_state[row["state"]].append(metrics)
    if not by_state:
        return {"states":0,"frames":0}
    # A state contributes equal total weight regardless of how many selected
    # snapshots it has. Draw whole states, retaining paired method differences.
    state_means=np.array([np.mean(values,axis=0) for _,values in sorted(by_state.items())])
    point=np.mean(state_means,axis=0)
    rng=np.random.default_rng(20201103)
    bootstrap=np.mean(state_means[rng.integers(len(state_means),size=(draws,len(state_means)))],axis=1)
    names=["brier","logLoss","marginMAEPoints","interval80Coverage","false95Rate"]
    output={"states":len(by_state),"frames":sum(len(v) for v in by_state.values()),
            "weighting":"equal states; equal frames within each state"}
    for index,key in enumerate(("baseline","partial")):
        output[key]={name:{"mean":float(point[index*5+j]),
                         "stateBootstrap95":np.quantile(bootstrap[:,index*5+j],[.025,.975]).tolist()}
                     for j,name in enumerate(names)}
    output["partialMinusBaseline"]={name:{"mean":float(point[5+j]-point[j]),
        "stateBootstrap95":np.quantile(bootstrap[:,5+j]-bootstrap[:,j],[.025,.975]).tolist()}
        for j,name in enumerate(names[:3])}
    return output


def summarize(report):
    runs=report["runs"]
    output={"status":"exploratory-presidential-component-evidence","method":report["method"],
            "quarantined":report.get("quarantined",[]),"cohorts":{}}
    for year in sorted({r["year"] for r in runs}):
        group=[r for r in runs if r["year"]==year]
        output["cohorts"][str(year)]={"all":score(group),
            "finalMarginWithin10Points":score([r for r in group if abs(r["truthMargin"])<=10]),
            "byStage":{stage:score([r for r in group if r["stage"]==stage])
                       for stage in sorted({r["stage"] for r in group})}}
    return output


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report",type=Path)
    parser.add_argument("output",type=Path)
    args=parser.parse_args()
    raw=args.report.read_bytes()
    result=summarize(json.loads(raw))
    result["forecastReportSha256"]=hashlib.sha256(raw).hexdigest()
    args.output.write_text(json.dumps(result,indent=2))
    print(json.dumps({"output":str(args.output),"cohorts":list(result["cohorts"])}))
