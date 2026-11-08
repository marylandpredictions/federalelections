"""Forward county-component experiment. Requires numpy and scipy."""
import csv
import hashlib
import json
import os
import sys
from pathlib import Path
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
import numpy as np
from scipy.stats import t

if len(sys.argv) != 2:
    raise SystemExit("Usage: probability-partial-county-study.py <capture directory>")
root = Path(sys.argv[1])
historic = {}
with (root / "probability-medsl-county-priors.csv").open(newline="") as source:
    for row in csv.DictReader(source):
        if row["year"] == "2016":
            d, r = float(row["democrat"]), float(row["republican"])
            if d + r:
                historic[row["FIPS"].zfill(5)] = (d - r) / (d + r)
prior2024 = {}
for row in json.loads(Path("data/baselines/pres-2020-counties.json").read_text())["rows"]:
    if row["valid"]:
        prior2024[row["fips"]] = (row["demVotes"] - row["repVotes"]) / (row["demVotes"] + row["repVotes"])
data = {year: json.loads((root / f"probability-medsl{year}-checkpoints.json").read_text()) for year in (2020, 2024)}


def prepared(year):
    prior = historic if year == 2020 else prior2024
    return [dict(row, prior=prior[row["fips"]], current=(row["d"]-row["r"])/(row["d"]+row["r"]),
                 final=(row["truth"]["d"]-row["truth"]["r"])/(row["truth"]["d"]+row["truth"]["r"]))
            for row in data[year]["points"] if not row["requiresCountCorrection"] and
            row["fips"] in prior and row["d"]+row["r"] > 0]


def features(rows, method):
    columns = [np.ones(len(rows))]
    if method != "count":
        columns.append(np.array([row["prior"]-row["current"] for row in rows]))
    if method == "partial":
        columns.append(np.array([1-row["reported"]/100 for row in rows]))
    return np.column_stack(columns)


def target(rows):
    return np.array([row["final"]-row["current"] for row in rows])


def weights(rows):
    counts = {}
    for row in rows:
        counts[row["state"]] = counts.get(row["state"], 0)+1
    return np.array([1/counts[row["state"]] for row in rows])


def fit(rows, method, penalty):
    x, w = features(rows, method), weights(rows)
    ridge = np.eye(x.shape[1])*penalty
    ridge[0, 0] = 0
    return np.linalg.lstsq(x.T @ (w[:, None]*x)+ridge, x.T @ (w*target(rows)), rcond=None)[0]


def errors(rows, method, penalty):
    result = np.zeros(len(rows))
    states = sorted({row["state"] for row in rows})
    for state in states:
        train = [row for row in rows if row["state"] != state]
        indices = [i for i, row in enumerate(rows) if row["state"] == state]
        test = [rows[i] for i in indices]
        result[indices] = target(test) - features(test, method) @ fit(train, method, penalty)
    return result


def trained(rows, method):
    w = weights(rows)
    options = []
    for penalty in (0, 1, 10, 100):
        error = errors(rows, method, penalty)
        options.append((np.average(error**2, weights=w), penalty, error))
    _, penalty, error = min(options, key=lambda item: item[0])
    bias = np.average(error, weights=w)
    scale = np.sqrt(np.average((error-bias)**2, weights=w)*3/5)
    if not scale > 0:
        raise ValueError("No residual distribution available")
    return {"penalty": penalty, "bias": bias, "scale": scale, "coefficients": fit(rows, method, penalty)}


def evaluate(rows, mean, scale):
    actual = np.array([row["final"] for row in rows])
    winner = actual > 0
    p = t.cdf(mean/scale, df=5)
    w = weights(rows)
    low, high = mean+t.ppf(.1, df=5)*scale, mean+t.ppf(.9, df=5)*scale
    return {"counties": len(rows), "states": len({row["state"] for row in rows}),
            "brier": float(np.average(2*(p-winner)**2, weights=w)),
            "logLoss": float(np.average(-np.log(np.maximum(1e-15, np.where(winner, p, 1-p))), weights=w)),
            "marginMAE": float(np.average(abs(mean-actual)*100, weights=w)),
            "covered80": float(np.average((actual>=low)&(actual<=high), weights=w)),
            "loserAbove95": int(np.sum(np.where(winner, 1-p, p) > .95))}


def evaluate_mixture(rows, components):
    q = np.array([row["reported"]/100 for row in rows])
    def cdf(value):
        return ((1-q)*t.cdf((value-components["geographic"]["mu"])/components["geographic"]["scale"], df=5)
                +q*t.cdf((value-components["count"]["mu"])/components["count"]["scale"], df=5))
    quantiles = []
    for percentile in (.1, .5, .9):
        lo, hi = np.full(len(rows), -10.), np.full(len(rows), 10.)
        for _ in range(50):
            middle = (lo+hi)/2
            below = cdf(middle) < percentile
            lo, hi = np.where(below, middle, lo), np.where(below, hi, middle)
        quantiles.append(np.clip((lo+hi)/2, -1, 1))
    low, median, high = quantiles
    p, w = 1-cdf(0), weights(rows)
    actual = np.array([row["final"] for row in rows])
    winner = actual > 0
    return {"counties": len(rows), "states": len({row["state"] for row in rows}),
            "brier": float(np.average(2*(p-winner)**2, weights=w)),
            "logLoss": float(np.average(-np.log(np.maximum(1e-15, np.where(winner, p, 1-p))), weights=w)),
            "marginMAE": float(np.average(abs(median-actual)*100, weights=w)),
            "covered80": float(np.average((actual>=low)&(actual<=high), weights=w)),
            "loserAbove95": int(np.sum(np.where(winner, 1-p, p)>.95))}


train, holdout = prepared(2020), prepared(2024)
report = {"training": 2020, "holdout": 2024, "df": 5, "weighting": "Equal states, then equal counties",
          "policy": "Ridge penalty selected on 2020 leave-state-out margin error; 2024 outcomes used only in evaluation",
          "trainingPoints": len(train), "holdoutPoints": len(holdout), "stages": {}}
for stage in ("1-24", "25-59", "60-89", "90-99", "100"):
    earlier = [row for row in train if row["stage"] == stage]
    later = [row for row in holdout if row["stage"] == stage]
    stage_report = {}
    components = {}
    for method in ("count", "geographic", "partial"):
        model = trained(earlier, method)
        mu = np.array([row["current"] for row in later]) + features(later, method) @ model["coefficients"] + model["bias"]
        components[method] = {"mu": mu, "scale": model["scale"]}
        model["coefficients"] = model["coefficients"].tolist()
        stage_report[method] = {"fit": model, "predictionHash": hashlib.sha256(mu.tobytes()).hexdigest(),
                                "scores": evaluate(later, mu, model["scale"])}
        if method == "partial":
            close = [i for i, row in enumerate(later) if abs(row["current"]) <= .1]
            if close:
                stage_report[method]["closeScores"] = evaluate([later[i] for i in close], mu[close], model["scale"])
    stage_report["reportingBlend"] = {"scores": evaluate_mixture(later, components)}
    report["stages"][stage] = stage_report
    (root / "probability-partial-county-trial.json").write_text(json.dumps(report, indent=2))
    print(stage, json.dumps({key: value["scores"] for key, value in stage_report.items()}), flush=True)
(root / "probability-partial-county-trial.json").write_text(json.dumps(report, indent=2))
