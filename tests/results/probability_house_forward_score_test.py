"""Known scoring controls; these tests do not consume historical outcomes."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("score",Path(__file__).parents[2]/"scripts/results/probability-house-forward-score.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ScoringTests(unittest.TestCase):
    def test_known_brier_and_coverage(self):
        rows=[{"state":"AA","winnerD":True,"truthMargin":2,"forecasts":{"model":{"probabilityD":.75,"median":3,"interval80":[0,4]}}},
              {"state":"BB","winnerD":False,"truthMargin":-2,"forecasts":{"model":{"probabilityD":.25,"median":-1,"interval80":[0,4]}}}]
        actual=module.summarize(rows,"model")
        self.assertEqual(actual["brier"],.0625)
        self.assertEqual(actual["coverage80"],.5)
        self.assertEqual(actual["marginMae"],1)

    def test_source_zero_is_scored_instead_of_dropping_the_case(self):
        row={"state":"AA","winnerD":True,"forecasts":{"frozen-source":{"probabilityD":0},"model":{"probabilityD":0}}}
        actual=module.summarize([row],"frozen-source")
        self.assertEqual(actual["brier"],1)
        self.assertIsNone(actual["logLoss"])
        self.assertEqual(actual["infiniteLogLossCases"],1)
        with self.assertRaises(ValueError):module.summarize([row],"model")

    def test_paired_cluster_score_retains_equal_race_weights(self):
        def row(state,model,baseline):
            return {"state":state,"winnerD":False,"forecasts":{"model":{"probabilityD":model},"baseline":{"probabilityD":baseline}}}
        result=module.paired_brier([row("AA",.3,.2),row("AA",.3,.2),row("BB",.1,.4)],"model","baseline",draws=1000)
        self.assertAlmostEqual(result["difference"],-.05/3)
        self.assertEqual(result["stateClusters"],2)
        self.assertAlmostEqual(result["interval95"][0],-.15)
        self.assertAlmostEqual(result["interval95"][1],.05)


if __name__=="__main__":unittest.main()
