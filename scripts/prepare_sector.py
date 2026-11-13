"""Producción minera y mercado laboral: series oficiales y comparaciones homogéneas."""

import base64
import io
import json
import math
import re

import pandas as pd
from prepare_credit import ipc_frame, rebase, workbook_frame
from prepare_indec import MONTHS, year_number


def numeric(value):
    if isinstance(value, bool):
        raise TypeError("Un valor lógico no es una observación numérica")
    if value is None or str(value).strip().lower() in {"", "s", "///", "...", "…"}:
        return None
    if str(value).strip() == "-":
        return 0.0
    if isinstance(value, str):
        text = value.strip()
        if re.fullmatch(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?", text):
            value = text.replace(".", "").replace(",", ".")
        else:
            value = text.replace(",", ".")
    result = float(value)
    if not math.isfinite(result):
        raise ValueError("Valor no finito en la publicación")
    return result


def normalize(frame, frequency="monthly"):
    frame = frame.sort_index()
    if frame.empty or frame.index.has_duplicates:
        raise ValueError("Períodos vacíos o duplicados")
    return frame.reindex(
        pd.date_range(
            frame.index.min(),
            frame.index.max(),
            freq="QS" if frequency == "quarterly" else "MS",
        )
    )


def parse_mining(source, raw):
    import openpyxl

    book = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    rows = list(book[source["sheet"]].values)
    if not all(
        token.lower() in str(rows[0][0]).lower() for token in source["headerContains"]
    ):
        raise ValueError("Cambió el título, la base o la unidad del cuadro minero")
    for item in source["series"]:
        if (
            item["headerToken"].strip().casefold()
            not in str(rows[item.get("headerRow", source["headerRow"])][item["column"]])
            .strip()
            .casefold()
        ):
            raise ValueError("Cambió la columna de una serie minera")
    data = []
    year = None
    for row in rows[7:]:
        year = year_number(row[1]) or year
        month = MONTHS.get(str(row[2]).strip().lower())
        if month:
            if year is None:
                raise ValueError("Mes minero sin año")
            data.append(
                [
                    pd.Timestamp(year, month, 1),
                    *[numeric(row[s["column"]]) for s in source["series"]],
                ]
            )
    book.close()
    return normalize(
        pd.DataFrame(
            data, columns=["date", *[s["id"] for s in source["series"]]]
        ).set_index("date")
    )


def parse_eph(source, raw):
    import xlrd

    if not raw.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        raise ValueError("La respuesta de EPH no es una planilla XLS")
    try:
        book = xlrd.open_workbook(file_contents=raw)
        book.sheet_by_name(source.get("sheet", "Cuadro 1.3"))
    except (xlrd.biffh.XLRDError, xlrd.compdoc.CompDocError) as error:
        raise ValueError("Cambió el formato o la hoja esperada de la EPH") from error
    columns = {}
    for item in source["series"]:
        if item["id"] == "other_employed":
            continue
        try:
            sheet = book.sheet_by_name(
                item.get("sheet", source.get("sheet", "Cuadro 1.3"))
            )
        except xlrd.biffh.XLRDError as error:
            raise ValueError("Cambió la hoja esperada de la EPH") from error
        if "Total 31 aglomerados urbanos" not in str(sheet.cell_value(0, 0)):
            raise ValueError("Cambió el universo geográfico de la EPH")
        matches = [
            i
            for i in range(5, sheet.nrows)
            if str(sheet.cell_value(i, 0)).strip().casefold()
            == item["rowLabel"].casefold()
        ]
        if len(matches) != 1:
            raise ValueError("Cambió el rótulo o el denominador de la EPH")
        year = None
        values = {}
        for column in range(1, sheet.ncols):
            heading = re.search(r"Año\s+(\d{4})", str(sheet.cell_value(3, column)))
            if heading:
                year = int(heading[1])
            quarter = re.match(
                r"([1-4])[º°]?\s*trimestre", str(sheet.cell_value(4, column))
            )
            if not quarter:
                continue
            if year is None:
                raise ValueError("Trimestre EPH sin año")
            period = pd.Timestamp(year, (int(quarter[1]) - 1) * 3 + 1, 1)
            if period in values:
                raise ValueError("Trimestre EPH duplicado")
            values[period] = numeric(sheet.cell_value(matches[0], column))
        if not values:
            raise ValueError("La EPH no contiene períodos reconocibles")
        columns[item["id"]] = values
    frame = normalize(pd.DataFrame(columns), "quarterly")
    if source.get("kind") == "stocks":
        for _, values in frame.iterrows():
            if not (values.population >= values.active >= values.employed > 0):
                raise ValueError("No se verifica la jerarquía de población y empleo")
            if abs(values.active - values.employed - values.unemployed) > 1.1:
                raise ValueError(
                    "PEA distinta de ocupados más desocupados, fuera del redondeo"
                )
        frame["other_employed"] = frame.employed - frame.informal
    return frame[[s["id"] for s in source["series"]]]


def change(frame, operation, frequency="monthly"):
    frame = normalize(frame, frequency)
    lag = 4 if frequency == "quarterly" else 12
    if operation == "differenceYear":
        return frame - frame.shift(lag)
    if operation == "yoy":
        return (frame / frame.shift(lag).replace(0, float("nan")) - 1) * 100
    if operation == "mom":
        return (frame / frame.shift(1).replace(0, float("nan")) - 1) * 100
    if operation == "ytd":
        result = frame.copy() * float("nan")
        for period in frame.index:
            base = pd.Timestamp(period.year - 1, 12, 1)
            if base in frame.index:
                result.loc[period] = (
                    frame.loc[period] / frame.loc[base].replace(0, float("nan")) - 1
                ) * 100
        return result
    return frame


def wages(source, files):
    frame = pd.read_csv(io.BytesIO(files["wages"]), sep=";", decimal=",")
    names = {s["externalField"]: s["id"] for s in source["series"]}
    if not {"periodo", *names}.issubset(frame.columns):
        raise ValueError("Cambió el esquema del índice salarial")
    frame["date"] = pd.to_datetime(frame.periodo, dayfirst=True)
    frame = normalize(frame.set_index("date")[list(names)].rename(columns=names))
    if source.get("real"):
        prices = ipc_frame(files["ipc"])
        frame = frame.loc[frame.index.intersection(prices.index)]
        frame = frame.div(prices.ipc.reindex(frame.index), axis=0)
    if source["operation"] == "index":
        return rebase(frame, source["base"], retain_history=True)
    return change(frame, source["operation"])


def employment(source, files, url):
    frames = []
    for sheet in dict.fromkeys(item["sheet"] for item in source["series"]):
        definitions = [item for item in source["series"] if item["sheet"] == sheet]
        frames.append(
            workbook_frame(
                {
                    **source,
                    "sheet": sheet,
                    "series": definitions,
                    "headerRows": 2,
                    "headerContains": [
                        sheet,
                        "En miles",
                        "Sin estacionalidad"
                        if sheet == "T.2.2"
                        else "Con estacionalidad",
                    ],
                },
                files["workbook"],
            )
        )
    frame = pd.concat(frames, axis=1)
    release = re.search(r"trabajoregistrado_(\d{2})(\d{2})_estadisticas\.xlsx$", url)
    if not release or frame.index.max() != pd.Timestamp(
        2000 + int(release[1]), int(release[2]), 1
    ):
        raise ValueError("El último mes de empleo no coincide con la publicación")
    return frame[[item["id"] for item in source["series"]]]


def ripte(source, files):
    import pdfplumber

    with pdfplumber.open(io.BytesIO(files["report"])) as book:
        title = book.pages[0].extract_text() or ""
        period = re.search(r"(\w+)\s+(20\d{2})", title)
        if "Trabajadores" not in title or not period or period[1].lower() not in MONTHS:
            raise ValueError("No se identifica el título o el mes de RIPTE")
        last = pd.Timestamp(int(period[2]), MONTHS[period[1].lower()], 1)
        year, data = None, []
        for page in book.pages[1:]:
            for line in (page.extract_text() or "").splitlines():
                if re.fullmatch(r"(?:19|20)\d{2}", line.strip()):
                    year = int(line.strip())
                row = re.match(r"^(\w+)\s+\$\s*([\d.]+,\d{2})\s+", line.strip())
                if not row:
                    continue
                if year is None or row[1].lower() not in MONTHS:
                    raise ValueError("Monto RIPTE sin período reconocible")
                data.append(
                    [pd.Timestamp(year, MONTHS[row[1].lower()], 1), numeric(row[2])]
                )
    frame = normalize(pd.DataFrame(data, columns=["date", "ripte"]).set_index("date"))
    if (
        frame.index.max() != last
        or frame.isna().any().any()
        or (frame.ripte <= 0).any()
    ):
        raise ValueError(
            "La historia RIPTE tiene faltantes o no coincide con el mes de portada"
        )
    if source.get("real"):
        prices = ipc_frame(files["ipc"])
        frame = frame.loc[frame.index.intersection(prices.index)]
        frame = frame.div(prices.ipc.reindex(frame.index), axis=0)
        frame = rebase(frame, source["base"], retain_history=True)
    return frame


def parse_sector(source, raw):
    payload = json.loads(raw)
    files = {key: base64.b64decode(value) for key, value in payload["files"].items()}
    layout = source["layout"]
    if layout == "mining":
        frame = parse_mining(source, files["workbook"])
    elif layout == "eph":
        frame = parse_eph(source, files["workbook"])
    elif layout == "snapshot":
        data = json.loads(files["input"])
        frame = pd.DataFrame(data["observations"]).pivot(
            index="date", columns="series", values="value"
        )
        frame.index = pd.to_datetime(frame.index)
        frame = frame[[s["id"] for s in source["series"]]]
        frame = change(frame, source["operation"], source["frequency"])
    elif layout == "wages":
        frame = wages(source, files)
    elif layout == "employment":
        frame = employment(source, files, payload["urls"]["workbook"])
    elif layout == "ripte":
        frame = ripte(source, files)
    elif layout == "ipc":
        frame = change(
            ipc_frame(files["ipc"])[[s["id"] for s in source["series"]]],
            source["operation"],
        )
    else:
        raise ValueError("Lector sectorial desconocido")
    frame = normalize(frame, source["frequency"])
    if source.get("start"):
        frame = frame.loc[source["start"] :]
    observations = [
        {
            "date": date.date().isoformat(),
            "series": item["id"],
            "value": None if pd.isna(row[item["id"]]) else float(row[item["id"]]),
        }
        for date, row in frame.iterrows()
        for item in source["series"]
    ]
    return source["series"], observations
