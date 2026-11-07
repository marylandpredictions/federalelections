"""No-network invariants for the candidate-anchor research experiment."""
import copy
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np

spec = importlib.util.spec_from_file_location("frozen_house", Path(__file__).parents[2] / "scripts/results/probability-frozen-house-study.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class FrozenHouseTests(unittest.TestCase):
    def test_tilt_matches_frozen_mean_and_preserves_order(self):
        priors = {"a": {"margin": -.3, "total": 300}, "b": {"margin": .5, "total": 100}}
        original = copy.deepcopy(priors)
        result = module.tilt(priors, .1, 500)
        self.assertEqual(priors, original)
        self.assertAlmostEqual(sum(row["total"] for row in result.values()), 500)
        self.assertAlmostEqual(sum(row["margin"]*row["total"] for row in result.values())/500, .1)
        self.assertLess(result["a"]["margin"], result["b"]["margin"])
        self.assertAlmostEqual(result["a"]["total"]/result["b"]["total"], 3)
        for turnout in (0, -1, float("nan"), float("inf")):
            with self.assertRaises(ValueError): module.tilt(priors, .1, turnout)

    def test_interval_matching_does_not_modify_training_likelihood(self):
        model = {"countyVariance": .0025, "measurement": np.arange(5), "swingLoading": np.eye(2)*.03}
        priors = {"a": {"total": 300}, "b": {"total": 100}}
        row = {"voteshare_mean_D1": "52", "voteshare_mean_R1": "48", "p10_netpartymargin": "-10", "p90_netpartymargin": "18"}
        adjusted, audit = module.anchored_uncertainty(model, priors, row)
        np.testing.assert_array_equal(adjusted["measurement"], model["measurement"])
        np.testing.assert_array_equal(model["swingLoading"], np.eye(2)*.03)
        self.assertAlmostEqual(adjusted["swingLoading"][0,0]**2+audit["countyVarianceContribution"], audit["approximatePairSd"]**2)

    def test_archive_checksums_and_pre_election_date_are_required(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            body = "cycle,branch,district,forecastdate,expression\n2022,House,CA-13,9/23/22,_deluxe\n"
            path = root / "test.csv"
            path.write_text(body, encoding="utf8")
            metadata = {"file": "test.csv", "source": "https://projects.fivethirtyeight.com/2022-general-election-forecast-data/house_district_toplines_2022.csv",
                        "capturedAt": "20220924034118", "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "decodedBytes": len(path.read_bytes())}
            meta = root / "probability-538-house-2022-pre-election-capture.json"
            meta.write_text(json.dumps(metadata))
            anchors, _ = module.read_anchors(root)
            self.assertEqual(anchors["CA-13"]["forecastdate"], "9/23/22")
            path.write_text(body + "changed")
            with self.assertRaisesRegex(ValueError, "checksum"): module.read_anchors(root)
            metadata["capturedAt"] = "20221109000000"
            meta.write_text(json.dumps(metadata))
            with self.assertRaisesRegex(ValueError, "before Election Day"): module.read_anchors(root)


if __name__ == "__main__": unittest.main()
