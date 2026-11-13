"""Lectores de Construya y estimaciones agrícolas con universos explícitos."""

import base64
import html
import io
import json
import re

import pandas as pd
from prepare_indec import MONTHS


def parse_tourism_region(raw):
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw.decode("utf-8")))
    text = re.sub(r"\s+", " ", text)
    match = re.search(
        r"Travel & Tourism contributed US\$[\d,.]+ billion to LAC.s economy in 2024, "
        r"accounting for ([\d.]+)% of the region.s total GDP",
        text,
    )
    if not match or "Latin America and the Caribbean (LAC)" not in text:
        raise ValueError("No se verifica el año, concepto o región del comunicado WTTC")
    return float(match[1])


def parse_tourism_latin_america(source, raw, definition):
    import pdfplumber

    with pdfplumber.open(io.BytesIO(raw)) as book:
        text = book.pages[source["latinAmericaPage"] - 1].extract_text()
    text = re.sub(r"\s+", " ", text)
    match = re.search(
        r"in 2024, accounted for ([\d.]+)% of the economy in Central & South America "
        r"with a total contribution of \$[\d,.]+ billion to GDP",
        text,
    )
    scope = html.unescape(re.sub(r"<[^>]+>", " ", definition.decode("utf-8")))
    scope = re.sub(r"\s+", " ", scope)
    if (
        not match
        or "AMERICAS: CENTRAL & SOUTH AMERICA" not in text
        or "Latin America region" not in scope
        or "covering Central America and South America economies" not in scope
    ):
        raise ValueError(
            "No se verifica el aporte 2024 o la definición regional de WTTC"
        )
    return float(match[1])


def parse_tourism_comparison(source, raw):
    import pdfplumber

    payload = json.loads(raw)
    with pdfplumber.open(io.BytesIO(base64.b64decode(payload[0]))) as book:
        text = book.pages[13].extract_text()
    if "RELATIVE CONTRIBUTION, 2024" not in text:
        raise ValueError("Cambió el cuadro de participación de WTTC")
    block = text.split("Contribution to GDP % share")[-1].split(
        "Travel & Tourism's Direct 2024"
    )[0]
    totals = {
        country: float(value)
        for country, value in re.findall(
            r"\d+\s+(Portugal|Greece|Spain|Italy)\s+([\d.]+)", block
        )
    }
    with pdfplumber.open(io.BytesIO(base64.b64decode(payload[1]))) as book:
        text = book.pages[0].extract_text()
    match = re.search(
        r"Tourism contribution to GDP\s*\(%\)\s*([\d.]+)\s*\(2024\)", text
    )
    if not match or "ARGENTINA" not in text:
        raise ValueError("No se verifica país/año en la ficha del Banco Mundial")
    totals["Argentina"] = float(match[1])
    totals["Latin America and the Caribbean"] = parse_tourism_region(
        base64.b64decode(payload[2])
    )
    totals["Latin America"] = parse_tourism_latin_america(
        source, base64.b64decode(payload[3]), base64.b64decode(payload[4])
    )
    return source["series"], [
        {
            "date": "2024-01-01",
            "series": s["id"],
            "value": totals.get(s["externalName"]),
        }
        for s in source["series"]
    ]


def parse_curated(source, raw):
    frame = pd.read_csv(io.BytesIO(raw))
    if set(frame.columns) != {"date", "value", "source", "sourceUrl", "note"}:
        raise ValueError("Cambió el registro de curación documentada")
    lookup = {row["date"]: row["value"] for _, row in frame.iterrows()}
    observations = [
        {
            "date": f"{year}-07-01",
            "series": "tourists",
            "value": float(lookup[f"{year}-07-01"])
            if f"{year}-07-01" in lookup
            else None,
        }
        for year in range(2019, 2027)
    ]
    return source["series"], observations


def parse_tourism(source, raw):
    payload = json.loads(raw)
    observations = []
    for key in ["inbound", "outbound"]:
        frame = pd.read_csv(io.StringIO(payload[key]))
        if list(frame.columns) != ["Año", "Mes", "Viajes de turistas"]:
            raise ValueError(
                "El CSV no corresponde a turistas: revisar filtros/universo"
            )
        frame = frame[frame["Año"] >= 2016]
        for _, row in frame.iterrows():
            value = float(row["Viajes de turistas"])
            if value < 0:
                raise ValueError("Viajes negativos")
            observations.append(
                {
                    "date": f"{int(row['Año'])}-{MONTHS[row['Mes'].lower()]:02}-01",
                    "series": key,
                    "value": value,
                }
            )
    lookup = {(r["date"], r["series"]): r["value"] for r in observations}
    for period in sorted({r["date"] for r in observations}):
        observations.append(
            {
                "date": period,
                "series": "balance",
                "value": lookup[(period, "inbound")] - lookup[(period, "outbound")],
            }
        )
    return source["series"], observations


def parse_pdf(source, raw):
    import pdfplumber

    with pdfplumber.open(io.BytesIO(raw)) as book:
        text = book.pages[source["page"] - 1].extract_text()
    if source["expect"] not in text:
        raise ValueError("Cambió el período o cuadro del PDF")
    if source["layout"] == "tourismPandemic":
        table = text.split("A CLOSER LOOK", 1)[1].split("LARGEST T&T", 1)[0]
        if not re.search(r"2020\s+\(2019\)\s+2020\s+\(2019\)", table):
            raise ValueError("Cambió el orden de años del cuadro WTTC")
        match = re.search(r"^\d+\s+Argentina\s+(.+)$", table, re.MULTILINE)
        values = (
            [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", match[1])]
            if match
            else []
        )
        if (
            len(values) != 9
            or values[1] <= 0
            or abs(100 * (values[0] / values[1] - 1) - values[4]) > 0.2
        ):
            raise ValueError(
                "El aporte argentino no concilia con la variación publicada"
            )
        return source["series"], [
            {"date": f"{year}-01-01", "series": "total-share", "value": values[index]}
            for year, index in [(2019, 3), (2020, 2)]
        ]
    if source["layout"] == "emaeIncidences":
        figure = text.split("EMAE nivel general", 1)[1].split("Fuente:", 1)[0]
        codes = re.findall(r"^([A-O])(?:\s|$)", figure, re.MULTILINE)
        if codes != [s["id"] for s in source["series"] if s["id"] != "taxes"]:
            raise ValueError("Cambió el orden de sectores del gráfico EMAE")
        values = [float(n.replace(",", ".")) for n in re.findall(r"-?\d+,\d+", figure)]
        if len(values) != 33 or abs(sum(values[1::2]) - values[0]) > 0.03:
            raise ValueError("Las incidencias no concilian con el EMAE publicado")
        return source["series"], [
            {"date": "2026-08-01", "series": item["id"], "value": values[1 + 2 * i]}
            for i, item in enumerate(source["series"])
        ]
    table = text.split("Cuadro 1. Ranking", 1)[1].split("Fuente:", 1)[0]
    pattern = (
        r"^(.+?)\s+[\d,]+\s+[\d,]+\s+([\d.]+)\s+([\d.]+)\s+[-\d,]+\s+(?:\d{4}\*?|///)$"
    )
    rows = {
        label: (float(new.replace(".", "")), float(old.replace(".", "")))
        for label, new, old in re.findall(pattern, table, re.MULTILINE)
    }
    observations = []
    for item in source["series"]:
        values = rows[item["expect"]]
        observations.extend(
            [
                {"date": "2026-01-01", "series": item["id"], "value": values[0]},
                {"date": "2025-01-01", "series": item["id"], "value": values[1]},
                {"date": "2025-07-01", "series": item["id"], "value": None},
            ]
        )
    for year in [2025, 2026]:
        total = next(
            r["value"]
            for r in observations
            if r["date"] == f"{year}-01-01" and r["series"] == "total"
        )
        parts = sum(
            r["value"]
            for r in observations
            if r["date"] == f"{year}-01-01" and r["series"] != "total"
        )
        if abs(parts - total) > 5:
            raise ValueError(
                "Los complejos y restos no concilian con el total exportado"
            )
    return source["series"], observations


def parse_construya(source, raw):
    text = html.unescape(re.sub(r"<[^>]+>", " ", raw.decode("utf-8")))
    pattern = r"Mes:\s*(\w+)\s+(20\d{2})\s+Con Estacionalidad:\s*([\d.,]+).*?Desestacionalizado:\s*([\d.,]+)"
    observations = []
    for month, year, original, adjusted in re.findall(pattern, text, re.DOTALL):
        period = f"{year}-{MONTHS[month.lower()]:02}-01"
        for key, value in [("original", original), ("adjusted", adjusted)]:
            observations.append(
                {
                    "date": period,
                    "series": key,
                    "value": float(value.replace(".", "").replace(",", ".")),
                }
            )
    if not observations:
        raise ValueError("Cambió la tabla histórica de Construya")
    return source["series"], observations


def parse_agriculture(source, raw):
    payload = json.loads(raw)
    result = payload["result"]
    records = result["records"]
    if not payload["success"] or len(records) != result["total"]:
        raise ValueError("Respuesta agrícola incompleta")
    frame = pd.DataFrame(records)
    if (
        not frame["cultivo"].eq("soja").all()
        or not frame["campania"].eq("2024/2025").all()
    ):
        raise ValueError("Cultivo o campaña no corresponden al pedido")
    keys = ["provincia_id", "departamento_id"]
    if frame.duplicated(keys).any() or frame[keys].isna().any().any():
        raise ValueError("Departamentos duplicados o no identificados")
    if frame["departamento_id"].str.endswith("000").any():
        raise ValueError("No combinar totales provinciales con departamentos")
    fields = ["superficie_sembrada_ha", "superficie_cosechada_ha", "produccion_tm"]
    for field in fields:
        frame[field] = pd.to_numeric(frame[field], errors="raise")
    if frame[fields].isna().any().any() or frame[fields].lt(0).any().any():
        raise ValueError("Valores agrícolas negativos o ausentes")
    if frame["superficie_cosechada_ha"].gt(frame["superficie_sembrada_ha"]).any():
        raise ValueError("Área cosechada superior a sembrada")
    totals = frame.groupby("provincia_id")[fields].sum()
    if set(totals.index) != {s["id"] for s in source["series"]}:
        raise ValueError("Cambió el universo provincial de soja")
    observations = []
    for province, row in totals.iterrows():
        value = (
            (
                1000 * row["produccion_tm"] / row["superficie_cosechada_ha"]
                if row["superficie_cosechada_ha"] > 0
                else None
            )
            if source["metric"] == "yield"
            else row[source["metric"]]
        )
        observations.append(
            {
                "date": "2024-01-01",
                "series": province,
                "value": None if value is None else float(value),
            }
        )
    return source["series"], observations
