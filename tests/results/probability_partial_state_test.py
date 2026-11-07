"""Research-model invariants. Run with Python and numpy; no network/data needed."""
import copy
import importlib.util
from pathlib import Path
import unittest

import numpy as np

spec = importlib.util.spec_from_file_location(
    "partial_state", Path(__file__).parents[2] / "scripts/results/probability-partial-state-study.py")
study = importlib.util.module_from_spec(spec)
spec.loader.exec_module(study)


class PartialStateTests(unittest.TestCase):
    def setUp(self):
        self.model = {
            "bias": np.zeros(5), "measurement": np.full(5, .04),
            "loading": np.eye(5) * .05,
            "swingLoading": np.array([[.08, 0], [0, .04]]),
            "countyVariance": .01,
            "turnoutMean": np.zeros(5), "turnoutUnit": np.full(5, .01),
            "turnoutState": np.full(5, .01), "priorTurnout": (0, .01, .01),
        }
        self.priors = {"01001": {"margin": .4, "total": 10000},
                       "01003": {"margin": -.2, "total": 5000}}
        self.frame = {"state": "AL", "at": "2024-11-06 01:00:00", "units": [
            {"fips": "01001", "d": 700, "r": 300, "total": 1000, "reported": 10},
            {"fips": "01003", "d": 0, "r": 0, "total": 0, "reported": None},
        ]}

    def predict(self, frame=None, **kwargs):
        return study.forecast(frame or self.frame, self.priors, self.model,
                              simulations=2000, **kwargs)

    def test_evaluation_outcomes_and_strata_do_not_change_forecast(self):
        expected = self.predict()
        frame = copy.deepcopy(self.frame)
        frame.update(stage="90-99", truthMargin=-99, winnerD=False,
                     countedShareForScoring=.99)
        for unit in frame["units"]:
            unit["truth"] = {"d": 0, "r": 999999}
        self.assertEqual(expected, self.predict(frame))

    def test_unit_order_is_irrelevant(self):
        frame = copy.deepcopy(self.frame)
        frame["units"].reverse()
        self.assertEqual(self.predict(), self.predict(frame))

    def test_zero_vote_percent_does_not_zero_expected_turnout(self):
        frame = copy.deepcopy(self.frame)
        frame["units"][1]["reported"] = 100
        result = self.predict(frame)
        self.assertGreater(result["medianFinalVotes"], 12000)

    def test_unreported_county_does_not_observe_a_fictitious_zero_margin(self):
        # With no observations, the update must equal the prior-only forecast.
        frame = copy.deepcopy(self.frame)
        for unit in frame["units"]:
            unit.update(d=0, r=0, total=0, reported=None)
        self.assertEqual(self.predict(frame), self.predict(frame, use_counts=False))

    def test_one_hundred_percent_is_not_certified_completion(self):
        frame = copy.deepcopy(self.frame)
        for unit in frame["units"]:
            unit.update(d=501, r=499, total=1000, reported=100)
        result = self.predict(frame)
        self.assertGreater(result["medianFinalVotes"], result["reportedVotes"])
        self.assertLess(result["probabilityD"], .999)
        self.assertGreater(result["probabilityD"], .001)

    def test_rejects_duplicate_units_and_malformed_counts(self):
        frame = copy.deepcopy(self.frame)
        frame["units"].append(frame["units"][0])
        self.assertEqual(self.predict(frame)["status"], "invalid-geography")
        for value in [-1, float("nan"), 3.5]:
            frame = copy.deepcopy(self.frame)
            frame["units"][0]["d"] = value
            self.assertEqual(self.predict(frame)["status"], "invalid-counts")

    def test_missing_prior_and_invalid_reporting_fail_clearly(self):
        frame = copy.deepcopy(self.frame)
        frame["units"][0]["fips"] = "01999"
        self.assertEqual(self.predict(frame)["status"], "missing-prior")
        for value in [-1, 101, float("inf")]:
            frame = copy.deepcopy(self.frame)
            frame["units"][0]["reported"] = value
            self.assertEqual(self.predict(frame)["status"], "invalid-reporting")

    def test_fit_excludes_the_held_out_state(self):
        history, refs, points = {}, {}, []
        for state_index, state in enumerate(["AA", "BB", "CC", "DD"]):
            for county_index in range(3):
                fips = str(state_index * 10 + county_index).zfill(5)
                history[fips] = {"margin": -.2 + county_index * .2, "total": 10000}
                d = 4000 + county_index * 500 + state_index * 50
                refs[fips] = {"state": state, "demVotes": d, "repVotes": 10000-d,
                              "totalVotes": 10000}
                for i, stage in enumerate(study.stages):
                    observed = 500 + i * 1000
                    points.append({"fips": fips, "state": state, "at": "2020-11-04 01:00:00",
                        "d": observed, "r": observed+10, "total": observed*2+10,
                        "reported": [10, 40, 75, 95, 100][i], "stage": stage,
                        "requiresCountCorrection": False,
                        "truth": {"d": d, "r": 10000-d, "total": 10000}})
        for partisan in [False, True]:
            expected = study.fit(points, history, refs, excluded="AA", partisan=partisan)
            changed = copy.deepcopy(points)
            changed_refs = copy.deepcopy(refs)
            for row in changed:
                if row["state"] == "AA":
                    row["truth"]["d"] = 9999
            for row in changed_refs.values():
                if row["state"] == "AA":
                    row["demVotes"] = 9999
            actual = study.fit(changed, history, changed_refs, excluded="AA", partisan=partisan)
            for key in expected:
                np.testing.assert_allclose(expected[key], actual[key])

    def test_fit_rejects_evaluation_cycle(self):
        with self.assertRaisesRegex(ValueError, "2020 training"):
            study.fit([{"at": "2024-11-06"}], {}, {})

    def test_count_only_ignores_missing_or_changed_historical_margins(self):
        self.model.update(priorMode="count-only",swingLoading=np.array([[.3,0],[0,0]]),countyVariance=.2)
        frame=copy.deepcopy(self.frame)
        frame["units"][1].update(d=200,r=300,total=500,reported=10)
        expected=self.predict(frame)
        self.priors={}
        self.assertEqual(self.predict(frame),expected)
        self.assertEqual(self.predict()["status"],"missing-turnout-fallback")


if __name__ == "__main__":
    unittest.main()
