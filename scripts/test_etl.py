"""Casos de fallo/revisión basados en un fragmento del snapshot oficial verificado."""

import copy
import json
import tempfile
import unittest
from pathlib import Path

import requests
from update_all import ROOT, read_json, refresh_source, validate_dataset


class EtlTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.cache = Path(self.directory.name)
        self.source = next(
            s
            for s in read_json(ROOT / "scripts/source_registry.json")
            if s["id"] == "ipi"
        )
        self.source = {**self.source, "adapter": "datos"}
        verified = read_json(ROOT / "data/cache/ipi.json")
        periods = sorted({r["date"] for r in verified["observations"]})[:24]
        lookup = {
            (r["date"], r["series"]): r["value"] for r in verified["observations"]
        }
        self.payload = {
            "count": len(periods),
            "meta": [{"frequency": "month"}]
            + [
                {"field": {"id": s["id"], "units": verified["unit"]}}
                for s in self.source["series"]
            ],
            "data": [
                [p] + [lookup[(p, s["id"])] for s in self.source["series"]]
                for p in periods
            ],
        }

    def tearDown(self):
        self.directory.cleanup()

    def update(self, payload=None, at="2026-11-11T12:00:00Z"):
        def fetch(_source):
            return json.dumps(
                payload or self.payload
            ).encode(), "https://apis.datos.gob.ar/series/api/series"

        return refresh_source(self.source, self.cache, fetch, at)

    def test_valid_then_unchanged_preserves_data_change_date(self):
        first = self.update()
        second = self.update(at="2026-11-12T12:00:00Z")
        self.assertEqual(first["contentHash"], second["contentHash"])
        self.assertEqual(first["dataChangedAt"], second["dataChangedAt"])
        self.assertFalse(second["changedSinceLastFetch"])
        self.assertNotEqual(
            first["lastSuccessfulFetchAt"], second["lastSuccessfulFetchAt"]
        )

    def test_network_outage_retains_last_verified_snapshot(self):
        first = self.update()
        original_cache = (self.cache / "ipi.json").read_bytes()

        def offline(_source):
            raise requests.ConnectionError("Caída simulada")

        fallback = refresh_source(
            self.source, self.cache, offline, "2026-11-12T12:00:00Z"
        )
        self.assertEqual(fallback["status"], "stale")
        self.assertEqual(first["observations"], fallback["observations"])
        self.assertEqual(
            first["lastSuccessfulFetchAt"], fallback["lastSuccessfulFetchAt"]
        )
        self.assertEqual(original_cache, (self.cache / "ipi.json").read_bytes())

    def test_schema_change_isolated_from_other_valid_source(self):
        first = self.update()
        wrong = copy.deepcopy(self.payload)
        wrong["meta"][1]["field"]["id"] = "schema-changed-test"
        failed = self.update(wrong)
        other = self.update(at="2026-11-12T12:00:00Z")
        self.assertEqual(failed["status"], "stale")
        self.assertEqual(failed["contentHash"], first["contentHash"])
        self.assertNotEqual(other["status"], "stale")

    def test_no_backup_reports_unavailable_without_zeros(self):
        def offline(_source):
            raise requests.Timeout("Timeout simulado")

        result = refresh_source(
            self.source, self.cache, offline, "2026-11-11T12:00:00Z"
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["observations"], [])
        self.assertIsNone(result["lastSuccessfulFetchAt"])

    def test_invalid_cached_json_never_becomes_a_valid_fallback(self):
        first = self.update()
        first["observations"].append(first["observations"][0])
        (self.cache / "ipi.json").write_text(json.dumps(first), encoding="utf-8")

        def offline(_source):
            raise requests.Timeout("Caída simulada")

        result = refresh_source(
            self.source, self.cache, offline, "2026-11-12T12:00:00Z"
        )
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["observations"], [])

    def test_official_revision_changes_hash_and_retains_period(self):
        first = self.update()
        revised = copy.deepcopy(self.payload)
        revised["data"][-1][1] += 0.1  # Perturbación de prueba; jamás se publica.
        result = self.update(revised, "2026-11-12T12:00:00Z")
        self.assertNotEqual(first["contentHash"], result["contentHash"])
        self.assertEqual(result["revisedObservations"], 1)
        self.assertEqual(first["lastObservedPeriod"], result["lastObservedPeriod"])

    def test_new_period_advances_observation_and_rejects_truncation(self):
        first = self.update()
        extended = copy.deepcopy(self.payload)
        year = int(extended["data"][-1][0][:4]) + 1
        extended["data"].append([f"{year}-01-01", *extended["data"][-1][1:]])
        extended["count"] += 1
        result = self.update(extended)
        self.assertGreater(result["lastObservedPeriod"], first["lastObservedPeriod"])
        truncated = self.update()
        self.assertEqual(truncated["status"], "stale")
        self.assertEqual(truncated["lastObservedPeriod"], result["lastObservedPeriod"])

    def test_duplicate_gap_and_future_periods_fail_validation(self):
        valid = self.update()
        duplicate = copy.deepcopy(valid)
        duplicate["observations"].insert(0, duplicate["observations"][0])
        with self.assertRaises(ValueError):
            validate_dataset(duplicate)
        gap = copy.deepcopy(valid)
        gap["observations"] = gap["observations"][3:6] + gap["observations"][9:]
        with self.assertRaises(ValueError):
            validate_dataset(gap)
        future = copy.deepcopy(valid)
        future["observations"][-1]["date"] = "2099-01-01"
        with self.assertRaises(ValueError):
            validate_dataset(future)


if __name__ == "__main__":
    unittest.main()
