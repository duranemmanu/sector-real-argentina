"""Revisiones, calendario, reutilización y fallback del pronóstico con historia oficial."""

import copy
import unittest
from unittest.mock import patch

from forecast_emae import build_forecast, validate_forecast
from update_all import ROOT, content_hash, read_json


class ForecastTests(unittest.TestCase):
    def setUp(self):
        self.history = read_json(ROOT / "data/cache/emae.json")

    def baseline(self, history=None, previous=None, at="2026-11-12T12:00:00Z"):
        with patch(
            "forecast_emae.fit_model", side_effect=RuntimeError("Fallo simulado")
        ) as fit:
            result = build_forecast(history or self.history, previous, at)
            return result, fit.call_count

    def test_failed_models_use_labeled_reference_without_intervals(self):
        result, calls = self.baseline()
        self.assertEqual(calls, 3)
        self.assertEqual(result["status"], "partial")
        self.assertFalse(result["hasIntervals"])
        self.assertIn("ingenuo", result["modelName"])
        self.assertTrue(
            all(
                r["lower95"] is None and r["upper95"] is None
                for r in result["forecasts"]
            )
        )
        self.assertEqual(len(result["forecasts"]), 12)
        validate_forecast(result)

    def test_unchanged_input_reuses_generated_date_without_fitting(self):
        first, _ = self.baseline()
        second, calls = self.baseline(previous=first, at="2026-11-13T12:00:00Z")
        self.assertEqual(calls, 0)
        self.assertEqual(first["generatedAt"], second["generatedAt"])
        self.assertEqual(first["forecasts"], second["forecasts"])

    def test_new_observation_reestimates_and_moves_cutoff(self):
        earlier = copy.deepcopy(self.history)
        previous_period = sorted({r["date"] for r in earlier["observations"]})[-2]
        earlier["observations"] = [
            r for r in earlier["observations"] if r["date"] <= previous_period
        ]
        earlier["contentHash"] = content_hash(earlier["observations"])
        first, _ = self.baseline(earlier)
        second, calls = self.baseline(previous=first)
        self.assertEqual(calls, 3)
        self.assertGreater(second["trainedThrough"], first["trainedThrough"])
        self.assertGreater(
            second["forecasts"][0]["date"], first["forecasts"][0]["date"]
        )

    def test_revision_reestimates_without_moving_cutoff(self):
        first, _ = self.baseline()
        revised = copy.deepcopy(self.history)
        next(r for r in reversed(revised["observations"]) if r["series"] == "original")[
            "value"
        ] += 0.1
        revised["contentHash"] = content_hash(revised["observations"])
        second, calls = self.baseline(revised, first, "2026-11-13T12:00:00Z")
        self.assertEqual(calls, 3)
        self.assertEqual(second["trainedThrough"], first["trainedThrough"])
        self.assertNotEqual(second["inputHash"], first["inputHash"])
        self.assertNotEqual(second["generatedAt"], first["generatedAt"])

    def test_future_observed_value_and_false_intervals_are_rejected(self):
        result, _ = self.baseline()
        invalid = copy.deepcopy(result)
        next(
            r
            for r in invalid["observations"]
            if r["date"] > invalid["trainedThrough"] and r["series"] == "original"
        )["value"] = 1
        with self.assertRaises(ValueError):
            validate_forecast(invalid)
        invalid = copy.deepcopy(result)
        invalid["forecasts"][0].update(lower95=0, upper95=1000)
        with self.assertRaises(ValueError):
            validate_forecast(invalid)


if __name__ == "__main__":
    unittest.main()
