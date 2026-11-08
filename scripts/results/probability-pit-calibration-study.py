"""Offline predictive-CDF recalibration, fitted exclusively on 2020 state folds.

The general CDF-recalibration approach is described by Kuleshov, Fenner and
Ermon (ICML 2018). This experiment's two-parameter Beta-CDF family is a separate
parametric choice, evaluated forward rather than assumed to confer a guarantee.
Requires numpy and scipy. Does not authorize public odds.
"""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from scipy.special import betaln, betainc
from scipy.stats import beta

spec=importlib.util.spec_from_file_location("partial",Path(__file__).with_name("probability-partial-state-study.py"))
study=importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


def fit_calibration(rows):
    if len({row["state"] for row in rows})<20:
        raise ValueError("Too few independent training states for pooled recalibration")
    n=Counter(row["state"] for row in rows)
    w=np.array([1/n[row["state"]] for row in rows],dtype=float)
    w/=sum(w)
    values=np.array([row["pit"] for row in rows])
    if np.any(~np.isfinite(values)|(values<=0)|(values>=1)):
        raise ValueError("Invalid open-interval training PIT")
    def objective(log_parameters):
        a,b=np.exp(log_parameters)
        return float(-np.sum(w*((a-1)*np.log(values)+(b-1)*np.log1p(-values)-betaln(a,b))))
    fitted=minimize(objective,np.zeros(2),method="L-BFGS-B",bounds=[(np.log(.05),np.log(20))]*2)
    if not fitted.success:
        raise ValueError("Predictive-CDF calibration failed: "+str(fitted.message))
    a,b=np.exp(fitted.x)
    return {"alpha":float(a),"beta":float(b),"trainingStates":len(n),"trainingFrames":len(rows),
            "objective":float(fitted.fun),"boundReached":bool(np.any(np.isclose([a,b],.05)|np.isclose([a,b],20))),
            "trainingHash":hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()}


def recalibrate(prediction,calibration):
    samples=prediction["samples"]
    a,b=calibration["alpha"],calibration["beta"]
    levels=beta.ppf([.1,.5,.9],a,b)
    quantiles=np.quantile(samples,levels)
    # Use the Monte Carlo CDF consistently for probability and quantiles.
    cdf_zero=(np.sum(samples<0)+.5*np.sum(samples==0)+.5)/(len(samples)+1)
    p=1-betainc(a,b,cdf_zero)
    return {"probabilityD":float(p),"median":float(quantiles[1]),"interval80":[float(quantiles[0]),float(quantiles[2])],
            "rawQuantileLevels":levels.tolist()}


def run(root,count_only=False,all_votes=False):
    county,history,refs,priors,frames,truth=study.load_study(root)
    options={"prior_mode":"count-only" if count_only else "historical","margin_basis":"all-votes" if all_votes else "two-party"}
    training=[];models={}
    for frame in frames[2020]:
        if frame.get("stateControl")!="exact-match":continue
        state=frame["state"]
        if state not in models:models[state]=study.fit(county,history,refs,excluded=state,**options)
        prediction=study.forecast(frame,priors[2020],models[state],return_samples=True)
        if prediction["status"]!="research":continue
        actual=truth[2020][state]
        margin=100*(actual["demVotes"]-actual["repVotes"])/actual["totalVotes"]
        samples=prediction["samples"]
        pit=(np.sum(samples<margin)+.5*np.sum(samples==margin)+.5)/(len(samples)+1)
        training.append({"state":state,"stage":frame["stage"],"pit":float(pit),"inputHash":prediction["inputHash"]})
    calibration=fit_calibration(training)
    print(json.dumps({"fit":calibration,**options}),flush=True)
    model=study.fit(county,history,refs,**options)
    report={"status":"research-recalibration-only","method":"2020-fitted-pooled-beta-PIT","trainingCycle":2020,
            "evaluationCycle":2024,"options":options,"calibration":calibration,"runs":[],"quarantined":[]}
    for frame in frames[2024]:
        if frame.get("stateControl")!="exact-match":continue
        prediction=study.forecast(frame,priors[2024],model,return_samples=True)
        if prediction["status"]!="research":
            report["quarantined"].append({"state":frame["state"],"stage":frame["stage"],"reason":prediction["status"]})
            continue
        calibrated=recalibrate(prediction,calibration)
        actual=truth[2024][frame["state"]]
        report["runs"].append({"year":2024,"state":frame["state"],"stage":frame["stage"],
            "truthMargin":100*(actual["demVotes"]-actual["repVotes"])/actual["totalVotes"],
            "winnerD":actual["demVotes"]>actual["repVotes"],
            "forecasts":{"baseline":{key:value for key,value in prediction.items() if key!="samples"},
                         "partial":{"status":"research",**calibrated}}})
    name="probability-pit-"+("allvote-" if all_votes else "")+("count-only" if count_only else "historical")+".json"
    report["codeSha256"]=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    (root/name).write_text(json.dumps(report))
    print(json.dumps({"output":str(root/name),"frames":len(report["runs"])}))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_directory",type=Path)
    parser.add_argument("--count-only",action="store_true")
    parser.add_argument("--all-votes",action="store_true")
    args=parser.parse_args()
    run(args.capture_directory,args.count_only,args.all_votes)
