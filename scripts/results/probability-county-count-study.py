"""Extract dated partial county counts from pinned MEDSL archives.

Certified totals enter only after checkpoint selection, for evaluation.
"""

import csv
import gzip
import hashlib
import json
import math
import sys
from pathlib import Path


SOURCES = {
    2020: ("sha1", "cea67c7573f67bc82f8b3c3c8ef3580d13144097", 99615781),
    2024: ("md5", "006fd66d300a0d585bc374e35019da65", 1534777951),
}
EXCLUDED = {"AK", "CT", "DC", "MA", "ME", "NH", "RI", "VT"}


def verified(path, year):
    kind, expected, size = SOURCES[year]
    digest = hashlib.new(kind)
    if year == 2020:
        digest.update(f"blob {size}\0".encode())
    total = 0
    with gzip.open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            total += len(block)
            digest.update(block)
    if total != size or digest.hexdigest() != expected:
        raise ValueError(f"Archive checksum mismatch for {year}")


def number(value):
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def integer(value):
    result = number(value)
    return int(result) if result is not None and result >= 0 and result.is_integer() else None


def stage(reported):
    if reported is None or not 0 < reported <= 100:
        return None
    return "1-24" if reported < 25 else "25-59" if reported < 60 else "60-89" if reported < 90 else "90-99" if reported < 100 else "100"


def select(points, row):
    bucket = stage(row.get("reported"))
    values = [row.get(key) for key in ("d", "r", "total")]
    if bucket is None or any(value is None for value in values) or not row["total"] or row["d"] + row["r"] > row["total"]:
        return False
    key = (row["fips"], bucket)
    previous = points.get(key)
    if previous is None or row["at"] < previous["at"]:
        points[key] = {**row, "stage": bucket}
    return True


def read_2020(path, references, on_snapshot=None):
    points, rejected = {}, 0
    with gzip.open(path, "rt", encoding="utf-8-sig", errors="replace", newline="") as source:
        for row in csv.DictReader(source):
            fips = row["fips"].zfill(5)
            reference = references.get(fips)
            if reference is None or reference["state"] in EXCLUDED:
                continue
            record = {"fips": fips, "state": reference["state"], "at": row["time"],
                      "sourceUpdatedAt": row["last_updated"], "d": integer(row["bidenj"]),
                      "r": integer(row["trumpd"]), "total": integer(row["votes"]),
                      "stateReportedTotal": integer(row["total.votes"]),
                      "reported": number(row["eevp"])}
            if on_snapshot is not None:
                on_snapshot(record)
            if not select(points, record):
                rejected += 1
    return points, {"invalidOrZeroSnapshots": rejected}


def read_2024(path, references, on_snapshot=None):
    points, identities, ambiguous = {}, {}, set()
    rejected, snapshots = 0, 0
    key, members = None, []

    def finish(key, rows):
        nonlocal rejected, snapshots
        if not rows:
            return
        state, code, at = key
        fips = rows[0]["jurisdiction_fips"].zfill(5)
        reference = references.get(fips)
        if state in EXCLUDED or reference is None or reference["state"] != state:
            return
        snapshots += 1
        identity = (state, fips)
        if identity in identities and identities[identity] != code:
            ambiguous.add(fips)
        identities[identity] = code
        names = [row["candidate"] for row in rows]
        totals = {row["total"] for row in rows}
        progress = {row["reported"] for row in rows}
        candidates = {row["candidate"]: integer(row["votes"]) for row in rows}
        total = integer(rows[0]["total"])
        if (len(set(names)) != len(names) or len(totals) != 1 or len(progress) != 1 or
                any(row["jurisdiction_fips"].zfill(5) != fips for row in rows) or
                any(value is None for value in candidates.values()) or
                sum(candidates.values()) != total):
            rejected += 1
            return
        record = {"fips": fips, "state": state, "at": at, "d": candidates.get("Harris"),
                  "r": candidates.get("Trump"), "total": total, "reported": number(rows[0]["reported"])}
        if on_snapshot is not None:
            on_snapshot(record)
        if not select(points, record):
            rejected += 1

    with gzip.open(path, "rt", encoding="utf-8-sig", newline="") as source:
        for row in csv.DictReader(source):
            next_key = (row["state"], row["cnn_code"], row["datetime"])
            if next_key != key:
                finish(key, members)
                key, members = next_key, []
            members.append(row)
            if len(members) > 50:
                raise ValueError("Unexpected number of candidates in one snapshot")
        finish(key, members)
    points = {key: row for key, row in points.items() if row["fips"] not in ambiguous}
    return points, {"snapshots": snapshots, "invalidOrZeroSnapshots": rejected,
                    "ambiguousCountyIdentities": sorted(ambiguous)}


def extract(root, year):
    path = root / f"probability-medsl{year}-counties.csv.gz"
    verified(path, year)
    reference_path = Path(f"data/baselines/pres-{year}-counties.json")
    metadata = json.loads(reference_path.read_text(encoding="utf-8"))
    references = {row["fips"]: row for row in metadata["rows"] if row.get("valid")}
    points, diagnostics = (read_2020 if year == 2020 else read_2024)(path, references)
    for row in points.values():
        truth = references[row["fips"]]
        row["truth"] = {"d": truth["demVotes"], "r": truth["repVotes"], "total": truth["totalVotes"]}
        row["requiresCountCorrection"] = any(row[key] > row["truth"][key] for key in ("d", "r", "total"))
    return {"year": year, "status": "research-inputs",
            "timeConvention": "Preserved source timestamps. No timezone conversion is asserted.",
            "truthSource": metadata["sourceUrl"], "excludedStates": sorted(EXCLUDED),
            "diagnostics": diagnostics, "counties": len({row["fips"] for row in points.values()}),
            "points": sorted(points.values(), key=lambda row: (row["fips"], row["stage"]))}


if __name__ == "__main__":
    directory, year = Path(sys.argv[1]), int(sys.argv[2])
    result = extract(directory, year)
    output = directory / f"probability-medsl{year}-checkpoints.json"
    output.write_text(json.dumps(result), encoding="utf-8")
    print(json.dumps({**{key: value for key, value in result.items() if key != "points"},
                      "points": len(result["points"]),
                      "corrections": sum(row["requiresCountCorrection"] for row in result["points"]),
                      "output": str(output)}))
