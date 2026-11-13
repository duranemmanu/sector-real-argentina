"""Casos de calendario, confidencialidad y unidades de los indicadores sectoriales."""

import unittest
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

import pandas as pd
from prepare_credit import links, publication_order
from prepare_indec import parse_workbook
from prepare_sector import change, numeric, parse_eph, ripte, wages


class SectorTests(unittest.TestCase):
    def test_primary_eph_rates_are_read_from_the_declared_table(self):
        def sheet(value, label):
            cells = {
                (0, 0): "Total 31 aglomerados urbanos",
                (3, 1): "Año 2024",
                (4, 1): "2° trimestre",
                (6, 0): label,
                (6, 1): value,
            }
            return SimpleNamespace(
                nrows=7, ncols=2, cell_value=lambda r, c: cells.get((r, c), "")
            )

        tables = {
            "Cuadro 1.1": sheet(48.5, "Actividad"),
            "Cuadro 1.3": sheet(48, "Tasa de actividad"),
        }
        book = SimpleNamespace(sheet_by_name=lambda name: tables[name])
        config = {
            "series": [
                {"id": "activity", "rowLabel": "Actividad", "sheet": "Cuadro 1.1"}
            ]
        }
        with patch("xlrd.open_workbook", return_value=book):
            result = parse_eph(config, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
        self.assertEqual(result.loc["2024-04-01", "activity"], 48.5)

    def test_ripte_reads_currency_not_the_index_and_checks_the_cover_period(self):
        document = MagicMock()
        document.__enter__.return_value.pages = [
            SimpleNamespace(
                extract_text=lambda: "Trabajadores Estables (RIPTE)\nEnero 2024"
            ),
            SimpleNamespace(
                extract_text=lambda: (
                    "2023\nDiciembre $ 484.298,40 8,3% 55.356,61 55.356,61\n2024\nEnero $ 555.269,16 14,7% 63.468,76 63.468,76"
                )
            ),
        ]
        with patch("pdfplumber.open", return_value=document):
            result = ripte({}, {"report": b"pdf"})
            self.assertEqual(result.loc["2023-12-01", "ripte"], 484298.4)
            self.assertEqual(result.loc["2024-01-01", "ripte"], 555269.16)
            prices = pd.DataFrame(
                {"ipc": [100, 110, 120]},
                index=pd.date_range("2023-12-01", periods=3, freq="MS"),
            )
            with patch("prepare_sector.ipc_frame", return_value=prices):
                real = ripte(
                    {"real": True, "base": "2023-12-01"},
                    {"report": b"pdf", "ipc": b"csv"},
                )
            self.assertEqual(real.index.max(), pd.Timestamp("2024-01-01"))
            self.assertAlmostEqual(
                real.loc["2024-01-01", "ripte"], 100 * 555269.16 / 484298.4 / 1.1
            )
            document.__enter__.return_value.pages[0].extract_text = lambda: (
                "Trabajadores Estables (RIPTE)\nFebrero 2024"
            )
            with self.assertRaisesRegex(ValueError, "portada"):
                ripte({}, {"report": b"pdf"})

    def test_real_wage_index_uses_exact_nominal_levels_and_the_same_months_ipc(self):
        nominal = b"periodo;salary\n01/11/2023;90\n01/12/2023;100\n01/01/2024;120\n01/02/2024;150\n"
        prices = pd.DataFrame(
            {"ipc": [90, 100, 110, 125]},
            index=pd.date_range("2023-11-01", periods=4, freq="MS"),
        )
        source = {
            "series": [{"id": "total", "externalField": "salary"}],
            "real": True,
            "operation": "index",
            "base": "2023-12-01",
        }
        with patch("prepare_sector.ipc_frame", return_value=prices):
            result = wages(source, {"wages": nominal, "ipc": b"csv"})
        self.assertEqual(result.loc["2023-12-01", "total"], 100)
        self.assertEqual(result.loc["2023-11-01", "total"], 100)
        self.assertAlmostEqual(result.loc["2024-01-01", "total"], 100 * 1.2 / 1.1)
        self.assertEqual(result.loc["2024-02-01", "total"], 120)

    def test_epi_changed_units_fail_before_producing_observations(self):
        frame = pd.DataFrame([["Título", None], [None, "Miles de toneladas"]])
        source = {
            "sheet": "09",
            "layout": "monthlyRows",
            "series": [],
            "unit": "toneladas",
            "unitHeaderCell": [1, 1],
        }
        with (
            patch("prepare_indec.pd.ExcelFile"),
            patch("prepare_indec.pd.read_excel", return_value=frame),
        ):
            with self.assertRaisesRegex(ValueError, "unidad"):
                parse_workbook(source, b"xls")

    def test_confidential_and_missing_are_not_absolute_zero(self):
        for value in [None, "s", "///", "...", "…", ""]:
            self.assertIsNone(numeric(value))
        self.assertEqual(numeric("-"), 0)
        self.assertEqual(numeric(0), 0)
        self.assertEqual(numeric("29.593"), 29593)
        self.assertEqual(numeric("7,1"), 7.1)
        with self.assertRaises(ValueError):
            numeric("cambio de estructura")
        with self.assertRaises(TypeError):
            numeric(True)

    def test_international_year_change_selects_the_newest_release(self):
        urls = [
            "https://www.indec.gob.ar/ftp/cuadros/eph_12_26.xls",
            "https://www.indec.gob.ar/ftp/cuadros/eph_03_27.xls",
        ]
        self.assertEqual(max(urls, key=publication_order), urls[1])
        self.assertGreater(
            publication_order("https://www.argentina.gob.ar/ripte_enero_2027-mdch.pdf"),
            publication_order(
                "https://www.argentina.gob.ar/ripte_diciembre_2026-mdch.pdf"
            ),
        )
        resolved = links(
            '<a href="../../ftp/cuadros/sociedad/cuadros.xls">Archivo</a>',
            "https://www.indec.gob.ar/Nivel4/Tema/4/31/58",
        )
        self.assertEqual(
            resolved, ["https://www.indec.gob.ar/ftp/cuadros/sociedad/cuadros.xls"]
        )

    def test_year_on_year_uses_four_quarters_and_no_missing_period_substitution(self):
        dates = pd.date_range("2025-01-01", periods=6, freq="QS")
        frame = pd.DataFrame({"stock": [100, 200, 300, 400, 110, 240]}, index=dates)
        self.assertAlmostEqual(change(frame, "yoy", "quarterly").iloc[-1, 0], 20)
        self.assertAlmostEqual(
            change(frame, "differenceYear", "quarterly").iloc[-1, 0], 40
        )
        with_gap = frame.drop(pd.Timestamp("2025-04-01"))
        self.assertTrue(pd.isna(change(with_gap, "yoy", "quarterly").iloc[-1, 0]))

    def test_annual_accumulation_uses_previous_december_and_preserves_monthly_gaps(
        self,
    ):
        frame = pd.DataFrame(
            {"index": [100, 110, 120]},
            index=pd.to_datetime(["2025-12-01", "2026-01-01", "2026-03-01"]),
        )
        accumulated = change(frame, "ytd")
        self.assertAlmostEqual(accumulated.loc["2026-03-01", "index"], 20)
        self.assertTrue(pd.isna(accumulated.loc["2026-02-01", "index"]))
        self.assertTrue(pd.isna(change(frame, "mom").loc["2026-03-01", "index"]))

    def test_eph_html_response_fails_before_becoming_observations(self):
        with self.assertRaisesRegex(ValueError, "no es una planilla XLS"):
            parse_eph({}, b"<!DOCTYPE html><html>Unavailable</html>")

    def test_changed_eph_sheet_is_a_recoverable_source_error(self):
        from xlrd.biffh import XLRDError

        with (
            patch(
                "xlrd.open_workbook", side_effect=XLRDError("No sheet named Cuadro 1.3")
            ),
            self.assertRaisesRegex(ValueError, "hoja esperada"),
        ):
            parse_eph({}, b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")


if __name__ == "__main__":
    unittest.main()
