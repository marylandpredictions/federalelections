"""Reduce an official Alaska CVR export to anonymous rank-pattern counts."""

from argparse import ArgumentParser
from collections import Counter
from hashlib import file_digest
import json
import re
from zipfile import ZipFile


def aggregate(path, contest_id, expected_hash):
    with open(path, "rb") as source:
        digest = file_digest(source, "sha256").hexdigest()
    if digest != expected_hash:
        raise ValueError("Alaska CVR checksum mismatch")
    with ZipFile(path) as archive:
        contests = json.loads(archive.read("ContestManifest.json"))["List"]
        contest = next(row for row in contests if row["Id"] == contest_id)
        ranks = contest["NumOfRanks"]
        if contest["VoteFor"] != 1 or not 2 <= ranks <= 10 or contest.get("Disabled", False):
            raise ValueError("Expected an enabled single-winner ranked contest")
        candidates = {
            row["Id"]: {
                "name": row["Description"],
                "writeIn": row["Type"] == "WriteIn",
                "disabled": bool(row.get("Disabled", False)),
            }
            for row in json.loads(archive.read("CandidateManifest.json"))["List"]
            if row["ContestId"] == contest_id
        }
        patterns = Counter()
        election_id = None
        for member in archive.infolist():
            if not re.fullmatch(r"CvrExport_\d+\.json", member.filename):
                continue
            if member.file_size > 64 * 1024 * 1024:
                raise ValueError("Unexpected size for a CVR part")
            data = json.loads(archive.read(member))
            if election_id is None:
                election_id = data["ElectionId"]
            if election_id != data["ElectionId"]:
                raise ValueError("CVR parts disagree on election identity")
            for session in data["Sessions"]:
                profiles = [
                    session[key] for key in ("Original", "Modified")
                    if key in session and session[key]["IsCurrent"] is True
                ]
                if len(profiles) != 1:
                    raise ValueError("Expected one adjudicated profile per CVR session")
                matches = [
                    row for card in profiles[0]["Cards"] for row in card["Contests"]
                    if row["Id"] == contest_id
                ]
                if not matches:
                    continue
                if len(matches) != 1:
                    raise ValueError("Duplicate ranked contest on one ballot")
                choices = [set() for _ in range(ranks)]
                for mark in matches[0]["Marks"]:
                    if mark["IsVote"] is not True:
                        continue
                    candidate, rank = mark["CandidateId"], mark["Rank"]
                    if candidate not in candidates or not 1 <= rank <= ranks:
                        raise ValueError("Unrecognized candidate or rank in official CVR")
                    choices[rank - 1].add(candidate)
                patterns[tuple(tuple(sorted(rank)) for rank in choices)] += 1
        if not patterns:
            raise ValueError("No ranked ballot records in this archive")
        return {
            "status": "scanned-ballots-only",
            "archiveSha256": digest,
            "electionId": election_id,
            "contestId": contest_id,
            "contest": contest["Description"],
            "candidates": candidates,
            "ballots": sum(patterns.values()),
            "patterns": [
                {"ranks": [list(rank) for rank in pattern], "count": count}
                for pattern, count in sorted(patterns.items())
            ],
        }


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("contest_id", type=int)
    parser.add_argument("sha256")
    args = parser.parse_args()
    print(json.dumps(aggregate(args.archive, args.contest_id, args.sha256.lower())))
