"""Forward check of the non-D/R vote-share component, with joint turnout error.

The target is an aggregate share, not a race-winner probability. A model fitted
on small third-party shares must not be certified for major independents by
extrapolation. Raw observed votes are retained in every simulated count.
"""
import argparse
from collections import Counter
import json
from pathlib import Path

import numpy as np


STAGES=["1-24","25-59","60-89","90-99","100"]


def prepared(data):
    accepted=[];rejected=Counter()
    for row in data["points"]:
        final=row["truth"]
        observed_other=row["total"]-row["d"]-row["r"]
        actual_other=final["total"]-final["d"]-final["r"]
        if row["requiresCountCorrection"] or observed_other<0 or actual_other<observed_other:
            rejected["source-count-needs-correction"]+=1;continue
        if not 0<row["reported"]<=100 or row["total"]<=0:
            rejected["no-source-turnout-estimate"]+=1;continue
        observed_logit=np.log((observed_other+.5)/(row["total"]-observed_other+.5))
        final_logit=np.log((actual_other+.5)/(final["total"]-actual_other+.5))
        accepted.append({**row,"observedOther":observed_other,"actualOther":actual_other,
            "observedLogit":observed_logit,"error":np.array([
                np.log(final["total"]/(row["total"]/(row["reported"]/100))),
                final_logit-observed_logit])})
    return accepted,dict(rejected)


def fit(rows):
    models={}
    for stage in STAGES:
        groups={}
        for row in rows:
            if row["stage"]==stage:groups.setdefault(row["state"],[]).append(row["error"])
        if len(groups)<10:raise ValueError("Insufficient independent training states")
        means=np.array([np.mean(values,axis=0) for values in groups.values()])
        center=np.mean(means,axis=0)
        state_cov=np.mean([np.outer(value-center,value-center) for value in means],axis=0)
        unit_cov=np.mean([np.mean([np.outer(v-np.mean(values,axis=0),v-np.mean(values,axis=0))
                                  for v in values],axis=0) for values in groups.values()],axis=0)
        def loading(cov):
            values,vectors=np.linalg.eigh(cov)
            return vectors@np.diag(np.sqrt(np.maximum(values,0)))
        source=[row for row in rows if row["stage"]==stage]
        models[stage]={"mean":center,"stateLoading":loading(state_cov),"unitLoading":loading(unit_cov),
            "states":len(groups),"points":len(source),
            "observedShareRange":[min(r["observedOther"]/r["total"] for r in source),max(r["observedOther"]/r["total"] for r in source)]}
    return models


def evaluate(rows,models):
    results=[]
    for row in rows:
        model=models[row["stage"]]
        # Fixed seed by source identity. Evaluation outcomes never seed a draw.
        import hashlib
        key=json.dumps({k:row[k] for k in ("fips","at","d","r","total","reported")},sort_keys=True)
        rng=np.random.default_rng(int(hashlib.sha256(key.encode()).hexdigest()[:16],16))
        errors=model["mean"][:,None]+model["stateLoading"]@rng.normal(size=(2,5000))+model["unitLoading"]@rng.normal(size=(2,5000))
        projected=np.maximum(row["total"],row["total"]/(row["reported"]/100)*np.exp(errors[0]))
        future=projected-row["total"]
        share=1/(1+np.exp(-np.clip(row["observedLogit"]+errors[1],-700,700)))
        new_other=np.clip(share*projected-row["observedOther"],0,future)
        final_share=(row["observedOther"]+new_other)/projected
        lo,median,hi=np.quantile(final_share,[.1,.5,.9])
        actual=row["actualOther"]/row["truth"]["total"]
        current=row["observedOther"]/row["total"]
        results.append({"state":row["state"],"fips":row["fips"],"stage":row["stage"],
            "absoluteShareError":float(abs(median-actual)),"unchangedShareError":float(abs(current-actual)),
            "covered80":bool(lo<=actual<=hi),"actualShare":actual,
            "outsideTrainingShareRange":not model["observedShareRange"][0]<=current<=model["observedShareRange"][1]})
    report={}
    for stage in STAGES:
        groups={}
        for row in results:
            if row["stage"]==stage:groups.setdefault(row["state"],[]).append(row)
        report[stage]={"states":len(groups),"points":sum(map(len,groups.values())),
            **{metric:float(np.mean([np.mean([r[metric] for r in group]) for group in groups.values()]))
               for metric in ("absoluteShareError","unchangedShareError","covered80")},
            "outsideTrainingShareRange":sum(r["outsideTrainingShareRange"] for group in groups.values() for r in group)}
    return report


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_directory",type=Path)
    args=parser.parse_args();root=args.capture_directory
    train,train_rejected=prepared(json.loads((root/"probability-medsl2020-checkpoints.json").read_text()))
    test,test_rejected=prepared(json.loads((root/"probability-medsl2024-checkpoints.json").read_text()))
    models=fit(train)
    output={"status":"research-other-share-component-only","trainingYear":2020,"evaluationYear":2024,
            "trainingRejected":train_rejected,"evaluationRejected":test_rejected,"scores":evaluate(test,models),
            "models":{stage:{k:v.tolist() if isinstance(v,np.ndarray) else v for k,v in model.items()} for stage,model in models.items()}}
    (root/"probability-other-share-study.json").write_text(json.dumps(output,indent=2))
    print(json.dumps({k:v for k,v in output.items() if k!="models"}))
