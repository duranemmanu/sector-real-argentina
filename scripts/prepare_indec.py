"""Lectores de cuadros oficiales con posiciones y encabezados declarados en el registro."""

import base64
import io
import json
import re
from datetime import date, datetime

import numpy as np
import pandas as pd

MONTHS = {
    name: i + 1
    for i, name in enumerate(
        [
            "enero",
            "febrero",
            "marzo",
            "abril",
            "mayo",
            "junio",
            "julio",
            "agosto",
            "septiembre",
            "octubre",
            "noviembre",
            "diciembre",
        ]
    )
}
MONTHS.update({name[:3]: number for name, number in list(MONTHS.items())})
MONTHS.update({"setiembre": 9, "set": 9, "sept": 9})


def parse_consumption(source, raw):
    import pdfplumber

    payload = json.loads(raw)
    series = [dict(item) for item in source["series"]]
    observations = []
    for key, layout, sheet, header, item in [
        (
            "original",
            "quarterlyWide",
            "cuadro 1",
            "Cuadro 1",
            {**series[0], "row": 11, "expect": "Consumo privado"},
        ),
        (
            "adjusted",
            "quarterlyColumns",
            "desestacionalizado n",
            "Oferta y demanda globales",
            {**series[1], "column": 4},
        ),
    ]:
        _, rows = parse_workbook(
            {
                **source,
                "layout": layout,
                "sheet": sheet,
                "headerContains": header,
                "series": [item],
            },
            base64.b64decode(payload[key]),
        )
        observations.extend(rows)
    original = [r for r in observations if r["series"] == series[0]["id"]]
    adjusted = [r for r in observations if r["series"] == series[1]["id"]]
    periods = [r["date"] for r in original]
    if periods != [r["date"] for r in adjusted] or len(periods) < 12:
        raise ValueError("Los históricos de consumo original y ajustado no coinciden")
    with pdfplumber.open(io.BytesIO(base64.b64decode(payload["report"]))) as book:
        figures = [
            (page, match)
            for page in book.pages
            for match in page.search(re.escape(source["figureTitle"]))
            if sum(
                len(c["pts"]) == len(periods) and c["top"] > match["bottom"]
                for c in page.curves
            )
            >= 3
        ]
        if len(figures) != 1:
            raise ValueError("No se identifica un único gráfico oficial de consumo")
        page, title = figures[0]
        bottom = min(
            m["top"] for m in page.search("Fuente:") if m["top"] > title["bottom"]
        )
        curves = [
            c
            for c in page.curves
            if len(c["pts"]) == len(periods)
            and title["bottom"] < c["top"] < c["bottom"] < bottom
        ]
        if len(curves) != 3:
            raise ValueError("Cambió el número de curvas o trimestres publicados")
        width = min(c["width"] for c in curves)
        grid = [
            line
            for line in page.lines
            if title["bottom"] < line["top"] < bottom
            and line["height"] < 0.01
            and line["width"] >= width
        ]
        left = min(line["x0"] for line in grid)
        labels = [
            w
            for w in page.extract_words()
            if w["x1"] < left
            and min(line["top"] for line in grid) - 6
            < w["top"]
            < max(line["top"] for line in grid) + 6
            and re.fullmatch(r"\d+(?:,\d+)?", w["text"])
        ]
        if len(labels) != len(grid) or len(labels) < 4:
            raise ValueError("No se verifican las etiquetas del eje de consumo")
        axis = []
        for word in labels:
            center = (word["top"] + word["bottom"]) / 2
            line = min(grid, key=lambda line: abs(line["top"] - center))
            if abs(line["top"] - center) > 3:
                raise ValueError("Etiqueta de eje sin línea de referencia")
            axis.append((line["top"], float(word["text"].replace(",", "."))))
        axis = np.array(axis)
        if len(set(axis[:, 0])) != len(axis):
            raise ValueError("Etiquetas de eje duplicadas")
        slope, intercept = np.polyfit(axis[:, 0], axis[:, 1], 1)
        tolerance = source["validationToleranceBillion"]
        if (
            slope >= 0
            or max(abs(slope * axis[:, 0] + intercept - axis[:, 1])) > tolerance
        ):
            raise ValueError(
                "La escala del gráfico no se reproduce con precisión suficiente"
            )
        extracted = {}
        reference_x = None
        for item in series:
            matches = [
                c
                for c in curves
                if np.allclose(
                    c["stroking_color"], source["curveColors"][item["id"]], atol=0.0001
                )
            ]
            if len(matches) != 1:
                raise ValueError("Cambió la identificación de las curvas oficiales")
            points = np.array(matches[0]["pts"])
            if (
                np.any(np.diff(points[:, 0]) <= 0)
                or max(
                    abs(
                        points[:, 0]
                        - np.linspace(points[0, 0], points[-1, 0], len(periods))
                    )
                )
                > 0.1
            ):
                raise ValueError(
                    "El calendario del gráfico no tiene puntos trimestrales regulares"
                )
            if reference_x is not None and not np.allclose(
                points[:, 0], reference_x, atol=0.01
            ):
                raise ValueError(
                    "Las curvas del gráfico no comparten el mismo calendario"
                )
            reference_x = points[:, 0]
            extracted[item["id"]] = slope * points[:, 1] + intercept
        errors = [
            float(
                np.max(
                    np.abs(
                        extracted[item["id"]]
                        - np.array([r["value"] for r in rows]) / 1000
                    )
                )
            )
            for item, rows in [(series[0], original), (series[1], adjusted)]
        ]
        if max(errors) > tolerance:
            raise ValueError(
                "El gráfico y los XLS difieren; no se acepta la digitalización"
            )
        series[2]["controlMaxAbsErrorBillion"] = round(max(errors), 6)
        series[2]["roundingBillion"] = 0.1
        observations.extend(
            {
                "date": period,
                "series": series[2]["id"],
                "value": round(float(value) * 10) * 100,
            }
            for period, value in zip(periods, extracted[series[2]["id"]])
        )
    return series, observations


def numeric(value):
    if pd.isna(value) or str(value).strip() in {
        "",
        "///",
        "...",
        "…",
        "-",
        "--",
        "s/d",
    }:
        return None
    return float(value)


def year_number(value):
    match = re.match(r"^(20\d{2})(?:\D|$)", str(value).strip())
    return int(match[1]) if match else None


def quarterly_rows(frame, definitions):
    for item in definitions:
        if (
            item.get("expect", "").casefold()
            not in str(frame.iloc[item["row"], 1]).casefold()
        ):
            raise ValueError(f"Cambió el rótulo del cuadro: {item['id']}")
    year = None
    observations = []
    for column in range(2, frame.shape[1]):
        year = year_number(frame.iloc[3, column]) or year
        quarter = re.match(r"^([1-4])[º°]?\s*trimestre", str(frame.iloc[4, column]))
        if not quarter:
            continue
        if not year:
            raise ValueError("Trimestre sin año")
        period = date(year, (int(quarter[1]) - 1) * 3 + 1, 1).isoformat()
        for item in definitions:
            observations.append(
                {
                    "date": period,
                    "series": item["id"],
                    "value": numeric(frame.iloc[item["row"], column]),
                }
            )
    return observations


def ipi_contributions(definitions, levels):
    lookup = {(r["date"], r["series"]): r["value"] for r in levels}
    periods = sorted({r["date"] for r in levels})
    matrix = np.array(
        [[lookup[(period, item["id"])] for item in definitions] for period in periods],
        dtype=float,
    )
    aggregate = np.array(
        [lookup[(period, "general")] for period in periods], dtype=float
    )
    if (
        len(periods) < 76
        or not np.isfinite(matrix).all()
        or not np.isfinite(aggregate).all()
    ):
        raise ValueError(
            "Historia insuficiente/incompleta para identificar la agregación del IPI"
        )
    weights, _, rank, _ = np.linalg.lstsq(matrix[:64], aggregate[:64], rcond=None)
    if (
        rank != len(definitions)
        or np.linalg.cond(matrix[:64]) > 1e6
        or (weights < 0).any()
        or abs(weights.sum() - 1) > 1e-8
    ):
        raise ValueError(
            "No se identifican ponderaciones implícitas únicas y positivas"
        )
    if np.max(np.abs(matrix @ weights - aggregate)) > 1e-7:
        raise ValueError(
            "No se verifica la identidad ponderada del IPI fuera del tramo de identificación"
        )
    observations = []
    for period in periods:
        prior = f"{int(period[:4]) - 1}{period[4:]}"
        base = lookup.get((prior, "general"))
        values = [
            None
            if not base
            else 100
            * float(weight)
            * (lookup[(period, item["id"])] - lookup[(prior, item["id"])])
            / base
            for item, weight in zip(definitions, weights)
        ]
        if (
            base
            and abs(sum(values) - 100 * (lookup[(period, "general")] / base - 1)) > 1e-7
        ):
            raise ValueError(
                "Las contribuciones no suman la variación interanual del IPI"
            )
        observations.extend(
            {
                "date": period,
                "series": item["id"],
                "value": None if value is None else round(value, 8),
            }
            for item, value in zip(definitions, values)
        )
    return [
        {**item, "inferredWeight": round(float(weight), 12)}
        for item, weight in zip(definitions, weights)
    ], observations


def parse_workbook(source, raw):
    book = pd.ExcelFile(io.BytesIO(raw))
    layout = source["layout"]
    if layout == "ipiIncidences":
        definitions = source["series"]
        levels_source = {
            **source,
            "layout": "monthlyRows",
            "yearColumn": 1,
            "monthColumn": 2,
            "series": [{"id": "general", "label": "IPI Manufacturero", "column": 3}]
            + definitions,
        }
        _, levels = parse_workbook(levels_source, raw)
        return ipi_contributions(definitions, levels)
    if layout == "annualConsumptionShares":
        definitions = [
            {"id": "gdp", "row": 6, "expect": "Producto Interno Bruto"},
            {"id": "private", "row": 11, "expect": "Consumo privado"},
            {"id": "public", "row": 12, "expect": "Consumo público"},
        ]
        observations = []
        for sheet, prefix in [("cuadro 1", "constant"), ("cuadro 8", "current")]:
            records = quarterly_rows(
                pd.read_excel(book, sheet_name=sheet, header=None), definitions
            )
            lookup = {(r["date"], r["series"]): r["value"] for r in records}
            for year in sorted({int(r["date"][:4]) for r in records}):
                periods = [f"{year}-{month:02}-01" for month in [1, 4, 7, 10]]
                if any(
                    lookup.get((p, s)) is None
                    for p in periods
                    for s in ["gdp", "private", "public"]
                ):
                    continue
                total = sum(lookup[(p, "gdp")] for p in periods)
                if total <= 0:
                    raise ValueError("PIB anual no positivo")
                for component in ["private", "public"]:
                    observations.append(
                        {
                            "date": f"{year}-01-01",
                            "series": f"{prefix}-{component}",
                            "value": 100
                            * sum(lookup[(p, component)] for p in periods)
                            / total,
                        }
                    )
        return source["series"], observations
    frame = pd.read_excel(book, sheet_name=source["sheet"], header=None)
    if (
        source.get("headerContains")
        and source["headerContains"].casefold() not in str(frame.iloc[0, 0]).casefold()
    ):
        raise ValueError("Cambió el encabezado/base del cuadro oficial")
    definitions = source["series"]
    if source.get("unitHeaderCell"):
        row, column = source["unitHeaderCell"]
        actual_unit = str(frame.iloc[row, column]).strip().casefold()
        if actual_unit != source["unit"].strip().casefold():
            raise ValueError("Cambió la unidad de la columna del cuadro oficial")
    if source.get("columnHeaderRow") is not None:
        for item in definitions:
            actual = str(frame.iloc[source["columnHeaderRow"], item["column"]])
            if re.sub(r"\s+", " ", actual.strip().casefold()) != re.sub(
                r"\s+", " ", item["label"].strip().casefold()
            ):
                raise ValueError(f"Cambió el encabezado de la columna: {item['id']}")
    if layout == "exportsAnnual":
        observations = []
        for row_index, row in frame.iterrows():
            if str(row.iloc[0]).strip() != "Total general":
                continue
            for column in range(1, frame.shape[1]):
                year = year_number(frame.iloc[row_index - 2, column])
                if not year:
                    continue
                for item in definitions:
                    target = frame.iloc[row_index + item["offset"]]
                    if item["expect"].casefold() not in str(target.iloc[0]).casefold():
                        raise ValueError("Cambió el orden de rubros exportadores")
                    observations.append(
                        {
                            "date": f"{year}-01-01",
                            "series": item["id"],
                            "value": numeric(target.iloc[column]),
                        }
                    )
        return definitions, observations
    if layout == "provinceExports":
        target = frame[frame[1].astype(str).str.strip().eq("Salta")]
        if len(target) != 1:
            raise ValueError("No se identifica un único total de Salta")
        observations = []
        for column in range(2, frame.shape[1]):
            year = year_number(frame.iloc[3, column])
            if year:
                observations.append(
                    {
                        "date": f"{year}-01-01",
                        "series": "salta",
                        "value": numeric(target.iloc[0, column]),
                    }
                )
        if source.get("semester"):
            last_year = max(int(r["date"][:4]) for r in observations)
            observations += [
                {"date": f"{r['date'][:4]}-07-01", "series": "salta", "value": None}
                for r in list(observations)
                if int(r["date"][:4]) < last_year
            ]
        return definitions, observations
    if layout == "quarterlyWide":
        observations = quarterly_rows(frame, definitions)
        if source.get("demandIdentity"):
            lookup = {(r["date"], r["series"]): r["value"] for r in observations}
            for period in sorted({r["date"] for r in observations}):
                row = {s["id"]: lookup[(period, s["id"])] for s in definitions}
                if any(value is None for value in row.values()):
                    continue
                net = row["exports"] - row["imports"]
                other = row["inventories"] + row["valuables"] + row["discrepancy"]
                reconstructed = (
                    row["private"] + row["public"] + row["investment"] + net + other
                )
                if abs(reconstructed - row["gdp"]) > max(1, abs(row["gdp"]) * 0.00001):
                    raise ValueError(
                        "No se pudo reconciliar la identidad de demanda del PIB"
                    )
                observations.extend(
                    [
                        {"date": period, "series": "net-exports", "value": net},
                        {"date": period, "series": "other-demand", "value": other},
                    ]
                )
            definitions = definitions + [
                {"id": "net-exports", "label": "Exportaciones netas"},
                {
                    "id": "other-demand",
                    "label": "Existencias, objetos valiosos y discrepancia",
                },
            ]
        return definitions, observations
    observations = []
    year = None
    for _, row in frame.iloc[source.get("startRow", 0) :].iterrows():
        if layout == "datetimeRows":
            period = row.iloc[0]
            if isinstance(period, (date, datetime)):
                observations.extend(
                    {
                        "date": period.strftime("%Y-%m-%d"),
                        "series": item["id"],
                        "value": numeric(row.iloc[item["column"]]),
                    }
                    for item in definitions
                )
            continue
        if layout == "quarterlyColumns":
            year = year_number(row.iloc[0]) or year
            quarter = {"I": 1, "II": 2, "III": 3, "IV": 4}.get(str(row.iloc[1]).strip())
            if quarter and year:
                observations.extend(
                    {
                        "date": f"{year}-{(quarter - 1) * 3 + 1:02}-01",
                        "series": item["id"],
                        "value": numeric(row.iloc[item["column"]]),
                    }
                    for item in definitions
                )
            continue
        if layout == "annualRows":
            year = year_number(row.iloc[source["yearColumn"]])
            if year:
                for item in definitions:
                    observations.append(
                        {
                            "date": date(year, 1, 1).isoformat(),
                            "series": item["id"],
                            "value": numeric(row.iloc[item["column"]]),
                        }
                    )
            continue
        if layout == "expectationRows":
            match = re.match(r"(\w+)\s+(20\d{2})", str(row.iloc[0]).strip())
            if not match:
                continue
            month, year = MONTHS.get(match[1].lower()), int(match[2])
        else:
            year = year_number(row.iloc[source["yearColumn"]]) or year
            month_text = str(row.iloc[source["monthColumn"]]).strip().lower()
            month = MONTHS.get(re.sub(r"[.*()\d\s]+$", "", month_text))
        if not month:
            continue
        if not year:
            raise ValueError("Mes sin año en el archivo oficial")
        period = date(year, month, 1).isoformat()
        if period > source.get("lastAllowedPeriod", "9999-12-31"):
            continue
        for item in definitions:
            observations.append(
                {
                    "date": period,
                    "series": item["id"],
                    "value": numeric(row.iloc[item["column"]]),
                }
            )
    return definitions, observations
