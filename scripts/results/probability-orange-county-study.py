"""Test county vote-mode adjustments using official Orange County snapshots."""

import argparse
from datetime import datetime, timedelta, timezone
from hashlib import file_digest
import json
from pathlib import Path
import re
from statistics import mean

from pypdf import PdfReader


COUNT_REPORTS = {
    (2022, 11): "58ff0e99e13fec5dd86d2919c4e88728ed8f4c906fdd7caa049f09868eddaee8",
    (2022, 12): "c51cf9010e7af24ac0a398c205efdbdddf6d5041ed93121ffb765aa1ef0ca44e",
    (2022, 14): "b3dbf01434f9632a16eca6bc999a93f5dc7ca450f14cfb083f2d8c22b56f1af5",
    (2022, 26): "22600ffe0bc0cb39bac2b919343d8222792e8c4f56506da8900cec43b8cdad3c",
    (2024, 12): "0622c587f9f28283f116ea1dd26cf6d7f2189c992983b277ee85608ddc853198",
    (2024, 13): "9696e1e6edd348826bd6e5f9082fd10b7af62edb2425d06401c5af7ce395f4ed",
    (2024, 30): "ecb0ced041171997c304db7710f4a1d1a00a13df1c80775a0139fcadb8698900",
}
INVENTORY_REPORTS = {
    12: ("20241108", "d9542b18721ac75c8a6c109df9edf423a56c35211daa8406cb963297a559a840"),
    13: ("20241109", "2205f472fa1b7a0a9cdda71a9f6e1a666509f47de696e8ff9056dbf01d7e0b79"),
}
PRESS_RELEASE_AT = "2024-11-09T18:42:00-08:00"
PACIFIC_STANDARD = timezone(timedelta(hours=-8))
DISTRICT = re.compile(r"^UNITED STATES REPRESENTATIVE (\d+)(?:st|nd|rd|th) District - Vote for One$", re.M | re.I)
NUM = r"([\d,]+)"
COUNT_COLUMNS = rf"\s+{NUM}\s+[\d.]+%\s+{NUM}\s+[\d.]+%\s+{NUM}\s+[\d.]+%\s*$"
CANDIDATE = re.compile(r"^(.+?)\s{2,}(DEM|REP)" + COUNT_COLUMNS, re.M)
CONTROL = re.compile(r"^\s*Cast Votes:" + COUNT_COLUMNS, re.M)


def number(value):
    return int(value.strip().replace(",", ""))


def pinned_pdf(path, expected):
    with path.open("rb") as file:
        actual = file_digest(file, "sha256").hexdigest()
    if actual != expected:
        raise ValueError(f"Checksum mismatch in {path.name}")
    return PdfReader(path)


def count_report(directory, year, run):
    path = directory / f"probability-oc-{year}-run-{run:02}.pdf"
    reader = pinned_pdf(path, COUNT_REPORTS[year, run])
    first = reader.pages[0].extract_text(extraction_mode="layout")
    date = re.search(r"Run Date\s+(\d+/\d+/\d+)", first)[1]
    clock = re.search(r"Run Time\s+(\d+:\d+ [AP]M)", first)[1]
    ballot_pattern = (
        r"Ballots Cast[^\n]*\n[^\n]*\s+(\d+)\s*\n"
        if year == 2022
        else r"Registered Voters[^\n]*\n[^\n]*\s+(\d+) of \d+"
    )
    ballots = re.search(ballot_pattern, first)
    at = datetime.strptime(f"{date} {clock}", "%m/%d/%Y %I:%M %p").replace(tzinfo=PACIFIC_STANDARD)
    if at.year != year or not ballots:
        raise ValueError(f"Unexpected election or county ballot total in {path.name}")
    districts = {}
    for page in reader.pages:
        content = page.extract_text(extraction_mode="layout")
        for header in DISTRICT.finditer(content):
            key = int(header[1])
            body = content[header.end():]
            control = CONTROL.search(body)
            if not control or key in districts:
                raise ValueError(f"Missing or duplicate county portion for CA-{key}")
            rows = list(CANDIDATE.finditer(body[:control.start()]))
            if len(rows) != 2 or {row[2] for row in rows} != {"DEM", "REP"}:
                continue
            totals = tuple(map(number, control.groups()))
            candidates = {row[2]: (row[1].strip(), tuple(map(number, row.groups()[2:]))) for row in rows}
            if any(in_person + mail != total for _, (in_person, mail, total) in candidates.values()) or any(
                sum(counts[i] for _, counts in candidates.values()) != totals[i] for i in range(3)
            ):
                raise ValueError(f"Candidate or ballot-mode totals do not reconcile in CA-{key}")
            districts[key] = candidates
    if not districts:
        raise ValueError(f"No eligible county portions in {path.name}")
    return {"at": at, "county_ballots": number(ballots[1]), "districts": districts}


def inventory(directory, run, observed_ballots):
    date, digest = INVENTORY_REPORTS[run]
    path = directory / f"probability-oc-unprocessed-{date}.pdf"
    fields = pinned_pdf(path, digest).get_fields()
    field = lambda key: fields[key]["/V"]
    components = ["undefined_3", "undefined_4", "1_2", "2_2", "undefined_5", "undefined_6"]
    remaining = number(field("undefined_7"))
    if field("County Name") != "Orange" or number(field("1")) != observed_ballots or sum(
        number(field(key)) for key in components
    ) != remaining:
        raise ValueError("Inventory and reported county ballots do not reconcile")
    return remaining


def observed(row):
    _, dem = row["DEM"]
    _, rep = row["REP"]
    return dem, rep


def difference(before, after):
    if any(before[party][0] != after[party][0] for party in ("DEM", "REP")):
        raise ValueError("County candidate roster changed within a count")
    additions = [[later - earlier for earlier, later in zip(first, last)] for first, last in zip(observed(before), observed(after))]
    if any(count < 0 for counts in additions for count in counts):
        raise ValueError("A reported ballot-mode count decreased")
    return additions


def shift_analogs(before, final, target):
    shifts = []
    for district, counts in before["districts"].items():
        if district == target or district not in final["districts"]:
            continue
        dem, rep = observed(counts)
        d_add, r_add = difference(counts, final["districts"][district])
        if dem[1] + rep[1] > 0 and d_add[1] + r_add[1] > 0:
            shifts.append(d_add[1] / (d_add[1] + r_add[1]) - dem[1] / (dem[1] + rep[1]))
    return shifts


def score(before, final, remaining, historical=None, historical_final=None):
    rows = []
    for district, counts in before["districts"].items():
        if district not in final["districts"]:
            continue
        dem, rep = observed(counts)
        dem_final, rep_final = observed(final["districts"][district])
        difference(counts, final["districts"][district])
        turnout = dem[2] + rep[2]
        if turnout <= 0 or dem[1] + rep[1] <= 0:
            continue
        share = dem[2] / turnout
        mail_share = dem[1] / (dem[1] + rep[1])
        future_votes = remaining * turnout / before["county_ballots"]
        actual_share = dem_final[2] / (dem_final[2] + rep_final[2])
        scenarios = {
            "reported_share": share,
            "reported_mail_mix": (dem[2] + future_votes * mail_share) / (turnout + future_votes),
        }
        if historical is not None:
            shifts = shift_analogs(historical, historical_final, district)
            if len(shifts) < 4:
                continue
            remaining_share = min(1, max(0, mail_share + mean(shifts)))
            scenarios["earlier_mail_shift"] = (dem[2] + future_votes * remaining_share) / (turnout + future_votes)
        rows.append({"district": district, "actual_margin": 200 * actual_share - 100,
                     "estimated_margins": {name: 200 * p - 100 for name, p in scenarios.items()}})
    if not rows:
        raise ValueError("No comparable holdout county portions")
    return {
        "county_portions": len(rows),
        "mean_absolute_margin_error_points": {
            name: mean(abs(row["estimated_margins"][name] - row["actual_margin"]) for row in rows)
            for name in rows[0]["estimated_margins"]
        },
        "rows": rows,
    }


def run_study(directory):
    reports = {(year, run): count_report(directory, year, run) for year, run in COUNT_REPORTS}
    certified_2022 = reports[2022, 26]
    certified_2024 = reports[2024, 30]
    if (certified_2022["county_ballots"], certified_2024["county_ballots"]) != (994227, 1417397):
        raise ValueError("County report totals do not match the published certifications")
    results = []
    for holdout, training in ((12, 11), (13, 12)):
        before = reports[2024, holdout]
        remaining = inventory(directory, holdout, before["county_ballots"])
        results.append({
            "generated_at": before["at"].isoformat(),
            "source_available_by": PRESS_RELEASE_AT,
            "published_unprocessed_estimate": remaining,
            "actual_added_county_ballots": certified_2024["county_ballots"] - before["county_ballots"],
            **score(before, certified_2024, remaining, reports[2022, training], certified_2022),
        })
    reported_2022 = reports[2022, 14]
    if reported_2022["county_ballots"] != 821216:
        raise ValueError("2022 count does not match the bulletin's rounded 821,000 ballots")
    comparison_2022 = {
        "generated_at": reported_2022["at"].isoformat(),
        "bulletin_as_of": "2022-11-14T17:00:00-08:00",
        "source_available_by": None,
        "published_unprocessed_estimate": 176000,
        "estimate_rounded": True,
        "actual_added_county_ballots": certified_2022["county_ballots"] - reported_2022["county_ballots"],
        **score(reported_2022, certified_2022, 176000),
    }
    return {"status": "research-only-county-portions", "training_year": 2022, "holdout_year": 2024,
            "results": results, "rounded_bulletin_comparison_2022": comparison_2022}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capture_directory", type=Path)
    print(json.dumps(run_study(parser.parse_args().capture_directory), indent=2))
