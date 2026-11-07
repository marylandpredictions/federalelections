"""Export private research inputs for the Node statistical-kernel replay.

Historical response data remain in the local capture directory. No public
release configuration is created. Requires numpy and the partial-state study.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np

spec=importlib.util.spec_from_file_location("partial",Path(__file__).with_name("probability-partial-state-study.py"))
study=importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


def export(root,partisan=False,count_only=False,all_votes=False):
    county,history,refs,priors,frames,truth=study.load_study(root)
    model=study.fit(county,history,refs,partisan=partisan,
                    prior_mode="count-only" if count_only else "historical",
                    margin_basis="all-votes" if all_votes else "two-party")
    serial={key:value.tolist() if isinstance(value,np.ndarray) else value for key,value in model.items()}
    cases=[]
    for frame in frames[2024]:
        if frame.get("stateControl")!="exact-match" or any(u["fips"] not in priors[2024] for u in frame["units"]):
            continue
        source_priors=priors[2024]
        inputs=[]
        for unit in frame["units"]:
            prior={"id":unit["fips"]}
            if not count_only:
                prior["margin"]=source_priors[unit["fips"]]["allMargin" if all_votes else "margin"]
            if partisan or not (unit["total"]>0 and (unit["reported"] or 0)>0):
                prior["turnout"]=source_priors[unit["fips"]]["total"]
            inputs.append(prior)
        reports=[{"id":u["fips"],**{key:u.get(key) for key in ("d","r","total","reported")}} for u in frame["units"]]
        reference={name:study.forecast(frame,source_priors,model,use_counts=use)
                   for name,use in [("baseline",False),("partial",True)]}
        actual=truth[2024][frame["state"]]
        cases.append({"id":frame["state"]+"-"+frame["stage"],"state":frame["state"],"stage":frame["stage"],
                      "at":frame["at"],"priors":inputs,"reports":reports,"python":reference,
                      "scoringOnly":{"winnerD":actual["demVotes"]>actual["repVotes"],
                          "marginPoints":100*(actual["demVotes"]-actual["repVotes"])/actual["totalVotes"]}})
    variant=("allvote-" if all_votes else "")+("count-only" if count_only else "partisan" if partisan else "uniform")
    output={"status":"private-research-replay","variant":variant,
            "calibration":serial,"cases":cases,"sourceFiles":{str(path):hashlib.sha256(path.read_bytes()).hexdigest() for path in [
                Path(__file__),Path(study.__file__),root/"probability-medsl2020-checkpoints.json",
                root/"probability-medsl2024-state-frames.json",root/"probability-medsl-county-priors.csv"]}}
    path=root/("probability-node-"+variant+"-inputs.json")
    path.write_text(json.dumps(output))
    print(json.dumps({"cases":len(cases),"output":str(path)}))


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_directory",type=Path)
    parser.add_argument("--partisan",action="store_true")
    parser.add_argument("--count-only",action="store_true")
    parser.add_argument("--all-votes",action="store_true")
    args=parser.parse_args()
    export(args.capture_directory,args.partisan,args.count_only,args.all_votes)
