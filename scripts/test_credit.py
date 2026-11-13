"""Controla calendarios y comparaciones económicas de la sección de crédito."""

import base64
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path

import openpyxl
import pandas as pd
import requests
from prepare_credit import (
    chain_real_changes,
    context_frame,
    download_credit,
    parse_credit,
    wages_frame,
)
from update_all import (
    ROOT,
    content_hash,
    download,
    download_key,
    read_json,
    refresh_source,
)


class CreditTests(unittest.TestCase):
    def test_different_curated_tables_from_one_publication_do_not_share_a_payload(self):
        sources = [
            s
            for s in read_json(ROOT / "scripts/source_registry.json")
            if s["id"].startswith("credit-") and s["adapter"] == "curated_csv_columns"
        ]
        self.assertGreater(len(sources), 1)
        self.assertEqual(len({s["sourceUrl"] for s in sources}), 1)
        self.assertEqual(len({download_key(s) for s in sources}), len(sources))
        payloads = {}
        with tempfile.TemporaryDirectory() as directory:
            for source in sources:
                key = download_key(source)
                if key not in payloads:
                    payloads[key] = download(source, None)
                result = refresh_source(
                    source,
                    Path(directory),
                    lambda s: payloads[download_key(s)],
                    "2026-11-13T12:00:00Z",
                )
                self.assertEqual(result["status"], "ready", source["id"])

    def test_derived_context_does_not_hide_an_upstream_outage(self):
        source = {"resources": {"input": {"snapshot": "supermarkets"}}}
        with self.assertRaises(ValueError):
            download_credit(source, None, {"supermarkets": {"status": "stale"}})

    def test_chained_balance_anchors_base_and_refuses_to_bridge_a_gap(self):
        dates = pd.date_range("2024-12-01", periods=3, freq="MS")
        changes = pd.DataFrame({"balance": [50.0, 5.0, -10.0]}, index=dates)
        result = chain_real_changes(changes, "2024-12-01")
        self.assertAlmostEqual(result.iloc[0, 0], 100)
        self.assertAlmostEqual(result.iloc[-1, 0], 94.5)
        changes.iloc[1, 0] = None
        with self.assertRaises(ValueError):
            chain_real_changes(changes, "2024-12-01")
        with self.assertRaises(ValueError):
            chain_real_changes(changes, "2024-11-01")

    def test_year_to_date_uses_the_same_months_and_keeps_missing_months(self):
        observations = [
            {"date": date, "series": "original", "value": value}
            for date, value in [
                ("2023-01-01", 10),
                ("2023-02-01", 30),
                ("2023-03-01", 100),
                ("2026-01-01", 20),
                ("2026-02-01", 30),
                ("2026-03-01", None),
            ]
        ]
        source = {
            "operation": "ytd",
            "referenceYear": 2023,
            "start": "2026-01-01",
            "series": [{"id": "activity", "inputSeries": "original"}],
        }
        frame = context_frame(source, json.dumps({"observations": observations}))
        self.assertEqual(frame.loc["2026-02-01", "activity"], 25)
        self.assertTrue(pd.isna(frame.loc["2026-03-01", "activity"]))

    def test_prices_and_private_wages_use_a_common_cut_and_not_total_wages(self):
        ipc = "Codigo;Periodo;Region;Indice_IPC\n0;202311;Nacional;100\n04;202311;Nacional;100\n0;202312;Nacional;150\n04;202312;Nacional;200\n0;202401;Nacional;180\n04;202401;Nacional;250\n"
        wages = "periodo;IS_sector_privado_registrado;IS_sector_publico;IS_sector_no_registrado;IS_indice_total;IS_total_registrado\n1/11/2023;100;100;100;100;100\n1/12/2023;120;105;130;115;110\n"
        files = {"ipc": ipc.encode(), "wages": wages.encode()}
        nominal = wages_frame(files, "nominal")
        real = wages_frame(files, "real")
        self.assertEqual(nominal.index.max(), pd.Timestamp("2023-12-01"))
        self.assertEqual(nominal.loc["2023-12-01", "registered"], 120)
        self.assertEqual(nominal.loc["2023-12-01", "housing"], 200)
        self.assertAlmostEqual(real.loc["2023-12-01", "private"], 80)

    def test_retail_uses_monthly_tna_and_keeps_sparse_months_null(self):
        book = openpyxl.Workbook()
        sheet = book.active
        sheet.title = "Tasas"
        sheet.append(["Tasas en porcentaje nominal anual. Promedios mensuales."])
        sheet.append([])
        sheet.append(
            [
                "Tasas",
                pd.Timestamp("2026-10-31").to_pydatetime(),
                "TEA",
                pd.Timestamp("2026-08-31").to_pydatetime(),
            ]
        )
        sheet.append(["Personales", 60, 80, 72])
        sheet.append(["Personas humanas hasta $1 millón (30-35 días)", 20, 22, 24])
        raw = io.BytesIO()
        book.save(raw)
        payload = json.dumps(
            {
                "files": {"workbook": base64.b64encode(raw.getvalue()).decode()},
                "urls": {"workbook": "https://www.bcra.gob.ar/series.xlsx"},
            }
        ).encode()
        source = {"layout": "retail", "series": [{"id": "personal"}, {"id": "spread"}]}
        _, observations = parse_credit(source, payload)
        lookup = {(r["date"], r["series"]): r["value"] for r in observations}
        self.assertIsNone(lookup[("2026-09-01", "personal")])
        self.assertEqual(lookup[("2026-10-01", "personal")], 60)
        self.assertEqual(lookup[("2026-10-01", "spread")], 40)

    def test_rolling_publication_preserves_history_revisions_and_outage_backup(self):
        source = copy.deepcopy(
            next(
                s
                for s in read_json(ROOT / "scripts/source_registry.json")
                if s["id"] == "credit-retail-rates"
            )
        )
        source.update(
            adapter="curated_csv_columns",
            dateColumn="date",
            preserveObservedWhenOmitted=True,
        )
        for item in source["series"]:
            item["externalField"] = item["id"]
        first = b"date,personal,deposit\n2026-08-01,70,20\n2026-09-01,60,18\n"
        second = (
            b"date,personal,deposit\n2026-08-01,,\n2026-09-01,61,18\n2026-10-01,59,17\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            before = refresh_source(
                source,
                cache,
                lambda _: (first, source["sourceUrl"]),
                "2026-11-12T12:00:00Z",
            )
            after = refresh_source(
                source,
                cache,
                lambda _: (second, source["sourceUrl"]),
                "2026-11-13T12:00:00Z",
            )
            lookup = {
                (r["date"], r["series"]): r["value"] for r in after["observations"]
            }
            self.assertEqual(lookup[("2026-08-01", "personal")], 70)
            self.assertEqual(lookup[("2026-09-01", "personal")], 61)
            self.assertEqual(after["revisedObservations"], 1)
            self.assertNotEqual(before["contentHash"], after["contentHash"])

            def offline(_):
                raise requests.Timeout("Fuente no disponible")

            fallback = refresh_source(source, cache, offline, "2026-11-13T13:00:00Z")
            self.assertEqual(fallback["status"], "stale")
            self.assertEqual(
                content_hash(fallback["observations"]), after["contentHash"]
            )


if __name__ == "__main__":
    unittest.main()
