"""Research-only candidate anchoring using a checksummed PRE-election archive.

No outcome is used to choose the forecast date, expression, or county tilt.
The existing counting-order uncertainty is unchanged to isolate this input fix.
This is a conditional D/R component experiment, not publishable race odds.
"""
import csv
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import unicodedata

spec = importlib.util.spec_from_file_location("partial_state", Path(__file__).with_name("probability-partial-state-study.py"))
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


def identity(value):
    normalized = unicodedata.normalize("NFKD", value)
    return re.sub(r"[^A-Z0-9]", "", normalized.upper())


def read_anchors(root):
    metadata = study.read(root / "probability-538-house-2022-pre-election-capture.json")
    expected_source = "https://projects.fivethirtyeight.com/2022-general-election-forecast-data/house_district_toplines_2022.csv"
    if metadata["source"] != expected_source:
        raise ValueError("Unexpected forecast authority")
    available = datetime.strptime(metadata["capturedAt"], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    if available >= datetime(2022, 11, 8, tzinfo=timezone.utc):
        raise ValueError("Forecast archive is not before Election Day")
    path = root / metadata["file"]
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != metadata["sha256"] or len(content) != metadata["decodedBytes"]:
        raise ValueError("Forecast archive checksum mismatch")
    latest = {}
    with path.open(newline="", encoding="utf-8-sig") as source:
        for row in csv.DictReader(source):
            if row["cycle"] != "2022" or row["branch"] != "House" or row["expression"] != "_deluxe":
                continue
            date = datetime.strptime(row["forecastdate"], "%m/%d/%y").replace(tzinfo=timezone.utc)
            if date > available:
                raise ValueError("Forecast row is newer than the capture")
            district = row["district"]
            if district in latest and latest[district][0] == date:
                raise ValueError("Duplicate frozen forecast")
            if district not in latest or date > latest[district][0]:
                latest[district] = (date, row)
    return {key: row for key, (_, row) in latest.items()}, metadata


def tilt(priors, target_margin, expected_turnout):
    """Logistic intercept shift preserves geographic ordering; no fake counts."""
    import math
    if not -1 < target_margin < 1 or not math.isfinite(expected_turnout) or not expected_turnout > 0 or not priors:
        raise ValueError("Invalid frozen candidate mean or expected turnout")
    total = sum(row["total"] for row in priors.values())
    if not math.isfinite(total) or total <= 0 or any(row["total"] <= 0 or not -1 < row["margin"] < 1 for row in priors.values()):
        raise ValueError("Invalid historical geographic prior")
    logits = {key: math.log((1+row["margin"])/(1-row["margin"])) for key, row in priors.items()}
    target = (1+target_margin)/2
    low, high = -60., 60.
    for _ in range(100):
        mid = (low+high)/2
        mean = sum(priors[key]["total"] / total / (1+math.exp(-value-mid)) for key, value in logits.items())
        if mean < target:
            low = mid
        else:
            high = mid
    shift = (low+high)/2
    return {key: {**row, "margin": 2/(1+math.exp(-logits[key]-shift))-1,
                  "total": row["total"]/total*expected_turnout} for key, row in priors.items()}


def anchored_uncertainty(model, priors, row):
    """Moment match the frozen 80% race interval, without inspecting outcomes.

    Normal approximation is a research assumption to evaluate, not a claim that
    the source forecast is Gaussian. County residual variance remains trained.
    """
    import copy
    import math
    import numpy as np
    d, r = (float(row["voteshare_mean_"+party+"1"]) for party in ("D", "R"))
    lower, upper = (float(row[key]) for key in ("p10_netpartymargin", "p90_netpartymargin"))
    if not -100 <= lower < upper <= 100 or not 0 < d+r <= 100.001:
        raise ValueError("Invalid frozen forecast uncertainty")
    sd = (upper-lower)/(2*1.2815515655446004)/(d+r)
    total = sum(unit["total"] for unit in priors.values())
    local_variance = model["countyVariance"]*sum((unit["total"]/total)**2 for unit in priors.values())
    # Never narrow the independently trained county residual simply to fit a
    # national interval. Excess local uncertainty is retained and reported.
    state_sd = math.sqrt(max(0, sd**2-local_variance))
    result = copy.deepcopy(model)
    result["swingLoading"] = np.array([[state_sd, 0.], [0., 0.]])
    return result, {"frozenInterval80": [lower, upper], "approximatePairSd": sd,
                    "countyVarianceContribution": local_variance, "stateSd": state_sd}


def run(root, frames_path=None, output_path=None):
    anchors, metadata = read_anchors(root)
    county, history, refs, priors, _, _ = study.load_study(root)
    model = study.fit(county, history, refs)
    path = frames_path or root / "probability-house-county-frames.json"
    captured = study.read(path)
    report = {"status": "research-only", "comparison": "conditional D/R; not a complete candidate win vector",
              "anchorSource": metadata, "expression": "_deluxe", "uncertainty": "2020 count likelihood; third variant moment matches frozen prior interval",
              "captureSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
              "codeSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "runs": [], "quarantined": captured["quarantined"].copy()}
    for frame in captured["frames"]:
        try:
            row = anchors[f'{frame["state"]}-{frame["district"]}']
            names = frame["candidateControlNames"]
            # The alias was reviewed against the representative's official bio.
            aliases = {"MICHAELVLAWLER": "MIKELAWLER"}
            norm = lambda name: aliases.get(identity(name), identity(name))
            if any(norm(row["name_"+party+"1"]) != norm(names[party]) for party in ("D", "R")):
                raise ValueError("Frozen candidate identity does not match the election")
            if any(float(row["voteshare_mean_"+party+str(index)] or 0) != 0
                   for party in ("D", "R") for index in (2, 3, 4)):
                raise ValueError("Multiple major-party candidates need a candidate-vector model")
            d, r = (float(row["voteshare_mean_"+party+"1"]) for party in ("D", "R"))
            if min(d, r) <= 0 or d+r > 100.001:
                raise ValueError("Invalid frozen candidate shares")
            source_priors = frame.get("historicalPriors", priors[2024])
            source_priors = {unit["fips"]: source_priors[unit["fips"]] for unit in frame["units"]}
            anchored = tilt(source_priors, (d-r)/(d+r), float(row["mean_predicted_turnout"]))
            predictions = {name: study.forecast(frame, inputs, model) for name, inputs in
                           [("historical-only", source_priors), ("candidate-anchored", anchored)]}
            source_model, uncertainty = anchored_uncertainty(model, anchored, row)
            predictions["candidate-and-uncertainty"] = study.forecast(frame, anchored, source_model)
            report["runs"].append({"id": frame["id"], "at": frame["at"], "forecastDate": row["forecastdate"],
                                   "anchorNames": {party: row["name_"+party+"1"] for party in ("D", "R")},
                                   "anchorMarginPoints": d-r, "uncertainty": uncertainty, "forecasts": predictions,
                                   "truthMargin": frame["truthMargin"], "winnerD": frame["winnerD"]})
        except (ValueError, KeyError) as error:
            report["quarantined"].append({"id": frame["id"], "reason": str(error)})
    for method in ("historical-only", "candidate-anchored", "candidate-and-uncertainty"):
        rows = [row for row in report["runs"] if row["forecasts"][method]["status"] == "research"]
        print(json.dumps({"method": method, "n": len(rows),
                          "brier": sum((row["forecasts"][method]["probabilityD"]-row["winnerD"])**2 for row in rows)/len(rows),
                          "coverage80": sum(row["forecasts"][method]["interval80"][0] <= row["truthMargin"] <= row["forecasts"][method]["interval80"][1] for row in rows)/len(rows)}))
    output = output_path or root / "probability-frozen-house-transfer.json"
    output.write_text(json.dumps(report, indent=2))
    print(json.dumps({"output": str(output), "quarantined": report["quarantined"]}))


if __name__ == "__main__":
    import sys
    run(Path(sys.argv[1] if len(sys.argv) > 1 else ".runtime"),
        Path(sys.argv[2]) if len(sys.argv)>2 else None,
        Path(sys.argv[3]) if len(sys.argv)>3 else None)
