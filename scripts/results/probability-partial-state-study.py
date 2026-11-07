"""Offline partial-count hierarchy study; this file never publishes live odds.

Requires numpy. Fit only on 2020 outcomes; evaluate 2024 separately. Source
percentages are noisy turnout estimates, including at 100%. Both variants are
exploratory after repeated inspection of the evaluation sample.
"""
import csv
import hashlib
import json
import os
from pathlib import Path
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
import numpy as np

stages=["1-24","25-59","60-89","90-99","100"]
def bucket(q):
    return 0 if q<25 else 1 if q<60 else 2 if q<90 else 3 if q<100 else 4
def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def state_statistics(rows, field):
    groups={}
    for row in rows:
        groups.setdefault(row["state"],[]).append(row[field])
    means={state:float(np.mean(values)) for state,values in groups.items()}
    mean=float(np.mean(list(means.values())))
    within=float(np.mean([np.mean((np.array(values)-means[state])**2) for state,values in groups.items()]))
    return mean,means,within


def fit(county, history, refs, excluded=None, partisan=False, margin_basis="two-party", prior_mode="historical"):
    if margin_basis not in ("two-party","all-votes"):
        raise ValueError("Unknown historical margin denominator")
    all_votes=margin_basis=="all-votes"
    if prior_mode not in ("historical","count-only") or prior_mode=="count-only" and partisan:
        raise ValueError("Unsupported historical-margin prior mode")
    if all_votes:
        history={key:{**row,"margin":row["allMargin"]} for key,row in history.items()}
    if any(not str(row.get("at", "")).startswith("2020-") for row in county):
        raise ValueError("This study fits exclusively on the 2020 training archive")
    rows=[]
    for row in county:
        prior=history.get(row["fips"])
        if row["state"]==excluded or row["requiresCountCorrection"] or not prior or row["d"]+row["r"]<=0:
            continue
        final=row["truth"]
        rows.append(dict(row,error=(row["d"]-row["r"])/(row["total"] if all_votes else row["d"]+row["r"])-(final["d"]-final["r"])/(final["total"] if all_votes else final["d"]+final["r"]),
                         turnout=np.log(final["total"]/(row["total"]/(row["reported"]/100)))))
    biases,measurement,turnout_means,turnout_unit,turnout_state=[],[],[],[],[]
    state_errors=[]
    for stage in stages:
        group=[r for r in rows if r["stage"]==stage]
        mean,states,variance=state_statistics(group,"error")
        biases.append(mean);measurement.append(variance);state_errors.append(states)
        mean,states,variance=state_statistics(group,"turnout")
        turnout_means.append(mean);turnout_unit.append(variance)
        turnout_state.append(float(np.var(list(states.values()))))
    covariance=np.zeros((5,5))
    for i in range(5):
        for j in range(5):
            common=sorted(state_errors[i].keys()&state_errors[j].keys())
            covariance[i,j]=np.mean([(state_errors[i][s]-biases[i])*(state_errors[j][s]-biases[j]) for s in common])
    values,vectors=np.linalg.eigh(covariance)
    loading=vectors@np.diag(np.sqrt(np.maximum(values,0)))
    by_state={}
    drift=[]
    for fips,reference in refs.items():
        prior=history.get(fips)
        if not prior or reference["state"]==excluded:
            continue
        change=(reference["demVotes"]-reference["repVotes"])/(reference["totalVotes"] if all_votes else reference["demVotes"]+reference["repVotes"])-(prior["margin"] if prior_mode=="historical" else 0)
        drift.append({"state":reference["state"],"error":change,"prior":prior["margin"],"weight":prior["total"],
                      "turnout":np.log(reference["totalVotes"]/prior["total"])})
    _,means,within=state_statistics(drift,"error")
    state_sd=np.sqrt(np.mean(np.array(list(means.values()))**2))
    turnout_mean,turnout_means_prior,turnout_prior_unit=state_statistics(drift,"turnout")
    turnout_prior_state=float(np.var(list(turnout_means_prior.values())))
    slopes=[];residuals=[]
    for state in sorted({row["state"] for row in drift}):
        group=[row for row in drift if row["state"]==state]
        center=np.average([r["prior"] for r in group],weights=[r["weight"] for r in group])
        x=np.column_stack([np.ones(len(group)),[r["prior"]-center for r in group]])
        y=np.array([r["error"] for r in group])
        coefficient=np.linalg.lstsq(x,y,rcond=None)[0] if len(group)>=3 else np.array([float(np.mean(y)),0])
        slopes.append(coefficient)
        residuals.append(float(np.mean((y-x@coefficient)**2)))
    slope_cov=np.mean([np.outer(row,row) for row in slopes],axis=0)
    eigen,vectors=np.linalg.eigh(slope_cov)
    swing_loading=vectors@np.diag(np.sqrt(np.maximum(eigen,0)))
    if not partisan:
        swing_loading=np.array([[state_sd,0.0],[0.0,0.0]])
    return {**({"marginBasis":"all-votes"} if all_votes else {}),
            **({"priorMode":"count-only"} if prior_mode=="count-only" else {}),
            "bias":np.array(biases),"measurement":np.array(measurement),"loading":loading,
            "stateSD":state_sd,"swingLoading":swing_loading,"countyVariance":float(np.mean(residuals)) if partisan else within,
            "turnoutMean":np.array(turnout_means),
            "turnoutUnit":np.array(turnout_unit),"turnoutState":np.array(turnout_state),
            "priorTurnout":(turnout_mean,turnout_prior_unit,turnout_prior_state)}


def forecast(frame, priors, model, use_counts=True, variance_factor=1, return_samples=False, simulations=5000):
    # Whitelist contemporaneous evidence. Evaluation strata and final outcomes
    # must never influence a prediction or its deterministic random seed.
    units=sorted([{key:u.get(key) for key in ("fips","d","r","total","reported")}
                  for u in frame["units"]],key=lambda u:u["fips"])
    if not units or len({u["fips"] for u in units})!=len(units):
        return {"status":"invalid-geography"}
    for unit in units:
        values=[unit[k] for k in ("d","r","total")]
        q=unit["reported"]
        if any(not isinstance(v,(int,float)) or not np.isfinite(v) or v<0 or v!=int(v) for v in values) or values[0]+values[1]>values[2]:
            return {"status":"invalid-counts"}
        if q is not None and (not isinstance(q,(int,float)) or not np.isfinite(q) or q<0 or q>100):
            return {"status":"invalid-reporting"}
    if not isinstance(simulations,int) or simulations<100:
        raise ValueError("At least 100 simulation draws are required")
    if not np.isfinite(variance_factor) or variance_factor<=0:
        raise ValueError("Invalid uncertainty multiplier")
    all_votes=model.get("marginBasis")=="all-votes"
    margin_key="allMargin" if all_votes else "margin"
    count_only=model.get("priorMode")=="count-only"
    if not count_only and any(unit["fips"] not in priors for unit in units):
        return {"status":"missing-prior"}
    if not count_only and any(margin_key not in priors[unit["fips"]] for unit in units):
        return {"status":"missing-prior-margin-basis"}
    n=len(units)
    d=np.array([u["d"] for u in units],dtype=float);r=np.array([u["r"] for u in units],dtype=float)
    total=np.array([u["total"] for u in units],dtype=float)
    q=np.array([u["reported"] if u["reported"] is not None else 0 for u in units])
    reported=(d+r)>0
    indices=np.array([bucket(p) for p in q])
    prior=np.zeros(n) if count_only else np.array([priors[u["fips"]][margin_key] for u in units])
    prior_weight=np.ones(n) if count_only else np.array([priors[u["fips"]]["total"] for u in units])
    center=np.average(prior,weights=prior_weight)
    swing_design=np.column_stack([np.ones(n),prior-center])@model["swingLoading"]
    design=np.column_stack([swing_design,model["loading"][indices]])
    denominator=total if all_votes else d+r
    current=np.divide(d-r,denominator,out=np.zeros(n),where=reported)
    observation=current-model["bias"][indices]-prior
    second_moment=np.divide(d+r,total,out=np.zeros(n),where=total>0) if all_votes else np.ones(n)
    sample_variance=np.divide(second_moment-current**2,denominator,out=np.zeros(n),where=reported)
    noise=model["measurement"][indices]+sample_variance
    variance=model["countyVariance"]+noise
    precision=reported/variance if use_counts else np.zeros(n)
    covariance=np.linalg.inv(np.eye(7)+design.T@(precision[:,None]*design))
    mean=covariance@(design.T@(precision*observation))
    evidence={"state":frame["state"],"at":frame["at"],"units":units}
    input_hash=hashlib.sha256(json.dumps(evidence,sort_keys=True).encode()).hexdigest()
    rng=np.random.default_rng(int(input_hash[:16],16))
    z=mean[:,None]+variance_factor*np.linalg.cholesky(covariance)@rng.normal(size=(7,simulations))
    fraction=np.where(reported,model["countyVariance"]/variance,0) if use_counts else np.zeros(n)
    conditional=prior[:,None]+swing_design@z[:2]+fraction[:,None]*(observation[:,None]-design@z)
    county_noise=np.sqrt(np.where(reported&use_counts,model["countyVariance"]*noise/variance,model["countyVariance"]))
    conditional+=variance_factor*county_noise[:,None]*rng.normal(size=(n,simulations))
    has_estimate=(q>0)&(total>0)
    prior_total=np.array([priors.get(u["fips"],{}).get("total",np.nan) for u in units],dtype=float)
    if np.any(~has_estimate&(~np.isfinite(prior_total)|(prior_total<=0))):
        return {"status":"missing-turnout-fallback"}
    estimated=np.divide(total,q/100,out=prior_total.copy(),where=has_estimate)
    no_estimate=~has_estimate
    turnover=np.where(no_estimate,model["priorTurnout"][0],model["turnoutMean"][indices])
    state_variance=np.where(no_estimate,model["priorTurnout"][2],model["turnoutState"][indices])
    unit_variance=np.where(no_estimate,model["priorTurnout"][1],model["turnoutUnit"][indices])
    projected=estimated[:,None]*np.exp(turnover[:,None]+variance_factor*(
        np.sqrt(state_variance)[:,None]*rng.normal(size=(1,simulations))
        +np.sqrt(unit_variance)[:,None]*rng.normal(size=(n,simulations))))
    outstanding=np.maximum(0,projected-total[:,None])
    other_share=np.divide(total-d-r,total,out=np.zeros(n),where=total>0)
    remaining_pair=outstanding*(1-other_share[:,None])
    final_denominator=total[:,None]+outstanding if all_votes else d[:,None]+r[:,None]+remaining_pair
    desired=(conditional*final_denominator-(d-r)[:,None]+remaining_pair)/2
    extra_d=np.clip(desired,0,remaining_pair)
    final_d=np.sum(d[:,None]+extra_d,axis=0);final_r=np.sum(r[:,None]+remaining_pair-extra_d,axis=0)
    margins=100*(final_d-final_r)/np.sum(total[:,None]+outstanding,axis=0)
    p=(np.sum(final_d>final_r)+.5*np.sum(final_d==final_r)+.5)/(simulations+1)
    return {"status":"research","inputHash":input_hash,"probabilityD":float(p),"median":float(np.median(margins)),
            **({"samples":margins} if return_samples else {}),
            "interval80":np.quantile(margins,[.1,.9]).tolist(),"reportedVotes":float(sum(total)), "medianFinalVotes":float(np.median(np.sum(total[:,None]+outstanding,axis=0)))}


def load_study(root):
    manifest=read("data/results/probability-medsl-count-manifest.json")
    historical_bytes=(root/"probability-medsl-county-priors.csv").read_bytes()
    if hashlib.sha256(historical_bytes).hexdigest()!=manifest["historicalCountyPriors"]["sha256"]:
        raise ValueError("Historical county-prior checksum mismatch")
    history={}
    with (root/"probability-medsl-county-priors.csv").open(newline="") as source:
        for row in csv.DictReader(source):
            if row["year"]=="2016":
                d,r,o=(float(row[key]) for key in ["democrat","republican","other"])
                if d+r>0:
                    history[row["FIPS"].zfill(5)]={"margin":(d-r)/(d+r),"allMargin":(d-r)/(d+r+o),"total":d+r+o}
    priors={2020:history,2024:{}}
    for row in read("data/baselines/pres-2020-counties.json")["rows"]:
        if row["valid"]:
            priors[2024][row["fips"]]={"margin":(row["demVotes"]-row["repVotes"])/(row["demVotes"]+row["repVotes"]),
                                       "allMargin":(row["demVotes"]-row["repVotes"])/row["totalVotes"],
                                       "total":row["totalVotes"]}
    county=read(root/"probability-medsl2020-checkpoints.json")["points"]
    frames={year:read(root/f"probability-medsl{year}-state-frames.json")["frames"] for year in [2020,2024]}
    truth={year:{r["state"]:r for r in read(f"data/baselines/pres-{year}-states.json")["states"] if r["valid"]} for year in [2020,2024]}
    refs={r["fips"]:r for r in read("data/baselines/pres-2020-counties.json")["rows"] if r["valid"]}
    return county, history, refs, priors, frames, truth


def run(root, partisan=False, margin_basis="two-party", prior_mode="historical"):
    county, history, refs, priors, frames, truth=load_study(root)
    models={}
    report={"status":"research-only","method":"partial-county-partisan-slope" if partisan else "partial-county-uniform-swing",
            "marginBasis":margin_basis,"priorMode":prior_mode,"trainingYear":2020,"forwardEvaluationYear":2024,"simulations":5000,"runs":[],"quarantined":[],
            "inputFiles":{str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in [
                root/"probability-medsl2020-checkpoints.json",root/"probability-medsl2020-state-frames.json",
                root/"probability-medsl2024-state-frames.json",root/"probability-medsl-county-priors.csv",
                Path("data/baselines/pres-2020-counties.json"),Path("data/baselines/pres-2020-states.json"),
                Path("data/baselines/pres-2024-states.json"),Path(__file__)]}}
    for year in [2020,2024]:
        for frame in frames[year]:
            if frame.get("stateControl")!="exact-match":
                report["quarantined"].append({"year":year,"state":frame["state"],"at":frame["at"],
                                             "reason":frame.get("stateControl","state control not checked")})
                continue
            key=frame["state"] if year==2020 else "all"
            if key not in models:
                models[key]=fit(county,history,refs,frame["state"] if year==2020 else None,partisan=partisan,margin_basis=margin_basis,prior_mode=prior_mode)
            predictions={name:forecast(frame,priors[year],models[key],use_counts=use)
                         for name,use in [("baseline",False),("partial",True)]}
            actual=truth[year][frame["state"]]
            report["runs"].append({"year":year,"state":frame["state"],"stage":frame["stage"],
                "truthMargin":100*(actual["demVotes"]-actual["repVotes"])/actual["totalVotes"],
                "winnerD":actual["demVotes"]>actual["repVotes"],"forecasts":predictions})
        print(json.dumps({"year":year,"forecasts":sum(r["year"]==year for r in report["runs"])}),flush=True)
    prefix="probability-allvote-" if margin_basis=="all-votes" else "probability-"
    if prior_mode=="count-only":prefix+="count-only-"
    output=root/(prefix+("partisan" if partisan else "partial")+"-state-trial.json")
    output.write_text(json.dumps(report))


def transfer(root, path, partisan=False, margin_basis="two-party", prior_mode="historical"):
    county, history, refs, priors, _, _=load_study(root)
    model=fit(county,history,refs,partisan=partisan,margin_basis=margin_basis,prior_mode=prior_mode)
    captured=read(path)
    office=captured.get("office","senate")
    if office not in ("senate","governor","house"):
        raise ValueError("Unsupported transfer office")
    report={"status":"research-cross-office-transfer-only",
            "method":"partial-county-partisan-slope" if partisan else "partial-county-uniform-swing",
            "training":"2020 presidential county counts with 2016 priors",
            "evaluation":office+" D/R component; 2020 presidential geographic priors",
            "captureSha256":hashlib.sha256(path.read_bytes()).hexdigest(),
            "quarantined":captured["quarantined"],"runs":[]}
    for frame in captured["frames"]:
        # The forecast whitelists only contemporaneous count fields. Truth is
        # added to the report after both forecasts have been generated.
        source_priors=priors[2024]
        if frame.get("historicalPriors") is not None:
            if office!="house" or frame.get("historicalPriorYear")!=2020 or frame.get("historicalPriorAvailableAt")!=frame["at"]:
                raise ValueError("Invalid dated historical district-part prior")
            source_priors=frame["historicalPriors"]
        predictions={name:forecast(frame,source_priors,model,use_counts=use)
                     for name,use in [("baseline",False),("partial",True)]}
        report["runs"].append({**{key:frame[key] for key in
            ("id","year","state","stage","at","captureIndex","truthMargin","winnerD")},
            "forecasts":predictions})
    prefix="probability-allvote-" if margin_basis=="all-votes" else "probability-"
    if prior_mode=="count-only":prefix+="count-only-"
    output=root/(prefix+("partisan" if partisan else "partial")+"-"+office+"-transfer.json")
    output.write_text(json.dumps(report))
    print(json.dumps({"forecasts":len(report["runs"]),"output":str(output)}))


if __name__=="__main__":
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_directory",type=Path)
    parser.add_argument("--partisan",action="store_true",help="Research interaction between historical partisanship and statewide swing")
    parser.add_argument("--transfer-frames",type=Path,help="Evaluate a separately captured Senate county cohort")
    parser.add_argument("--all-votes",action="store_true",help="Use an explicitly all-vote historical margin denominator")
    parser.add_argument("--count-only",action="store_true",help="Fit a wide absolute-margin hierarchy without historical margin inputs")
    args=parser.parse_args()
    if args.transfer_frames:
        transfer(args.capture_directory,args.transfer_frames,partisan=args.partisan,margin_basis="all-votes" if args.all_votes else "two-party",prior_mode="count-only" if args.count_only else "historical")
    else:
        run(args.capture_directory,partisan=args.partisan,margin_basis="all-votes" if args.all_votes else "two-party",prior_mode="count-only" if args.count_only else "historical")
