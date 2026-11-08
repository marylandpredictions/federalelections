"""Forward tests on official King County counts, for research use."""

import csv
import hashlib
import io
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, median


CAPTURES = {
    2018: (
        "4a81394fffb8150768573b184968c99cdde07884ba6587c05f0fe0cd71668f91",
        "51911771cf125ad030a5d2fe18de6e8f2a38d218290143376a3fab0cb471cd00",
        "87b5f47db9b85b0c042cf3a7e02dc785129ed9c14bf39d50341f6541c73a70cc",
    ),
    2020: (
        "bc1c43a33b30d0ca72298da9d1f4581a1f1cab01606399907b7628d1b5fcaa79",
        "8d786a5cb0874495dc7bbdc9f5be42eb917eea48ee5f7fbb72b3102f2a415ab0",
        "a6f10c6ed2321974720f57a7a7bea6f06a2ad00ca4c3bf8dce1058a04e2ac207",
    ),
    2022: (
        "1984fcbade625f8af7a74ce6e21bbac37ba7945135dc2611ee269a6663756dd5",
        "5709151fd09009d6c32bbbe6d956e9baa88b35fdb0c3ab9af0ed607835da56e8",
        "9f637d1f0e55e4d5b347f837d9530769e8aba64d3cd514739c156aeaf5c36d46",
    ),
    2024: (
        "4b07815c0bfeeddf18b55a432ead006b91f21167585a620fa38f42241ddbe8d3",
        "936be7991dcb41153eb41243d8286e523d9bda2f3a06128406358345823b1fd2",
        "ba5351bc0deb95450915d8ccd69dd07f2f34aa6f5b4359e16f9ad13d9cdee950",
    ),
}


def read_capture(path, digest):
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError(f"Unverified capture {path.name}")
    races = defaultdict(list)
    for row in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        district = row["District Name"].strip()
        title = row["Ballot Title"].strip()
        house = re.fullmatch(r"Congressional District No\. (\d+)", district)
        if house and re.fullmatch(r"(US|United States) Representative", title):
            races[f"house-WA-{house[1]}"].append(row)
        elif row["District Type"].strip() == "Federal" and re.fullmatch(r"(US|United States) Senator", title):
            races["senate-WA"].append(row)
        elif district == "State of Washington" and title == "Governor":
            races["governor-WA"].append(row)

    result = {}
    for race, rows in races.items():
        ballots = {int(row["Ballots Counted for District"]) for row in rows}
        votes = [int(row["Votes"]) for row in rows]
        names = [row["Ballot Response"].strip() for row in rows]
        if len(ballots) != 1 or min(votes) < 0 or sum(votes) > min(ballots) or len(set(names)) != len(names):
            raise ValueError(f"Inconsistent totals or candidates for {race} in {path.name}")
        pair = {}
        for name, count, row in zip(names, votes, rows):
            party = row["Party Preference"].strip()
            if party in {"(Prefers Democratic Party)", "(Prefers Republican Party)", "(Prefers GOP Party)"}:
                pair.setdefault("D" if "Democratic" in party else "R", []).append((name, count))
        if len(pair) == 2 and all(len(candidates) == 1 for candidates in pair.values()):
            result[race] = tuple(pair[party][0] for party in ("D", "R"))
    return result


def matched_panel(captures):
    first, next_day, final = captures
    panel = {}
    for race in first.keys() & next_day.keys() & final.keys():
        rows = [stage[race] for stage in captures]
        if any(tuple(name for name, _ in row) != tuple(name for name, _ in rows[0]) for row in rows):
            continue
        counts = [tuple(count for _, count in row) for row in rows]
        if any(a > b for earlier, later in zip(counts, counts[1:]) for a, b in zip(earlier, later)):
            raise ValueError(f"Regressed archived count for {race}")
        panel[race] = counts
    return panel


def margin(counts):
    return (counts[0] - counts[1]) / sum(counts)


def difference(later, earlier):
    return tuple(new - old for new, old in zip(later, earlier))


def forecast(observed, training, stage):
    current = observed[stage]
    forecasts = {"unchanged": margin(current)}
    remaining_ratios = [sum(difference(row[-1], row[stage])) / sum(row[stage]) for row in training]
    remaining_shifts = [margin(difference(row[-1], row[stage])) - margin(row[stage]) for row in training]
    ratio, historical = median(remaining_ratios), median(remaining_shifts)
    shifts = {"historical": historical}
    if stage == 1:
        local = margin(difference(observed[1], observed[0])) - margin(current)
        shifts.update(latest_batch=local, equal_blend=(local + historical) / 2)
    for name, shift in shifts.items():
        outstanding_margin = min(1, max(-1, margin(current) + shift))
        forecasts[name] = (margin(current) + ratio * outstanding_margin) / (1 + ratio)
    return forecasts


def study(captures):
    report = {}
    for year, earlier in [(2022, 2018), (2024, 2020)]:
        final = matched_panel(captures[year])
        training = matched_panel(captures[earlier])
        stages = []
        for stage in (0, 1):
            rows = []
            for race, observed in sorted(final.items()):
                office = race.split("-")[0]
                analogs = [row for key, row in training.items()
                           if key.startswith(office + "-") and (office != "house" or key != race)]
                if not analogs:
                    continue
                estimates = forecast(observed[:stage + 1], analogs, stage)
                truth = margin(observed[-1])
                rows.append({"race": race, "analogs": len(analogs), "actualMargin": 100 * truth,
                             "countedShareForScoring": sum(observed[stage]) / sum(observed[-1]),
                             "errors": {name: 100 * abs(value - truth) for name, value in estimates.items()}})
            house = [row for row in rows if row["race"].startswith("house-")]
            stages.append({"day": stage, "races": rows, "houseMAE": {
                name: mean(row["errors"][name] for row in house) for name in house[0]["errors"]
            }})
        report[year] = {"trainingYear": earlier, "stages": stages}
    return report


if __name__ == "__main__":
    root = Path(sys.argv[1])
    captures = {
        year: [read_capture(root / f"probability-king-{year}-{stage}.csv", digest)
               for stage, digest in zip(("day0", "day1", "final"), hashes)]
        for year, hashes in CAPTURES.items()
    }
    print(json.dumps(study(captures), indent=2))
