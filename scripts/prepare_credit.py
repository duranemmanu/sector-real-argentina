"""Series de crédito: definiciones bancarias, tasas, ingresos y contexto real."""

from __future__ import annotations

import base64
import io
import json
import math
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MONTHS = dict(
    zip(
        [
            "ene",
            "feb",
            "mar",
            "abr",
            "may",
            "jun",
            "jul",
            "ago",
            "sep",
            "oct",
            "nov",
            "dic",
        ],
        range(1, 13),
    )
)


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def links(text, base):
    return [
        urljoin(
            base,
            "/" + link.lstrip("./")
            if link.lstrip("./").startswith(("ftp/", "uploads/"))
            else link.removeprefix("blank:#"),
        )
        for link in re.findall(r'href=["\x27]([^"\x27]+)', text)
    ]


def publication_order(url):
    match = re.search(r"_(\d{2})_(\d{2})[^/]*\.(?:xlsx?|pdf)$", url, re.IGNORECASE)
    if not match:
        from prepare_indec import MONTHS as SPANISH_MONTHS

        named = re.search(r"_([a-z]+)_(20\d{2})[^/]*\.pdf$", url, re.IGNORECASE)
        if named and named[1].lower() in SPANISH_MONTHS:
            return int(named[2]) - 2000, SPANISH_MONTHS[named[1].lower()]
        raise ValueError("No se reconoce la fecha del archivo de publicación")
    return int(match[2]), int(match[1])


def download_credit(source, session, snapshots=None):
    payload = {"files": {}, "urls": {}, "dates": []}
    for key, resource in source["resources"].items():
        if "snapshot" in resource:
            data = (
                snapshots[resource["snapshot"]]
                if snapshots is not None
                else json.loads(
                    (ROOT / "data/cache" / (resource["snapshot"] + ".json")).read_text(
                        encoding="utf-8"
                    )
                )
            )
            if data["status"] not in {"ready", "partial"}:
                raise ValueError("El insumo de contexto no tiene una consulta vigente")
            raw, url = json.dumps(data).encode(), data["sourceUrl"]
            payload["dates"].append(data["lastSuccessfulFetchAt"])
        else:
            url = resource["url"]
            if resource.get("bcraCategory"):
                response = session.get(
                    "https://www.bcra.gob.ar/wp-json/bcra/v1/publicaciones",
                    params={
                        "category": resource["bcraCategory"],
                        "lang": "es",
                        "action": "list",
                    },
                    timeout=(8, 25),
                )
                response.raise_for_status()
                listing = response.json()
                if (
                    listing.get("success") is not True
                    or not listing["data"]["publicaciones"]
                ):
                    raise ValueError("No se encontró la publicación vigente del BCRA")
                publication = listing["data"]["publicaciones"][0]
                page = publication["url"]
                if urlparse(page).hostname != "www.bcra.gob.ar":
                    raise ValueError("Dominio de publicación inesperado")
                response = session.get(page, timeout=(8, 25))
                response.raise_for_status()
                candidates = [
                    u
                    for u in links(response.text, page)
                    if re.search(resource["filePattern"], u, re.IGNORECASE)
                ]
                if not candidates:
                    raise ValueError("La publicación no contiene la planilla esperada")
                url = candidates[0]
                payload["publicationUrl"] = page
                match = re.fullmatch(
                    r"(\d{2}) (\w{3}) (\d{4})", publication["fecha"].lower()
                )
                if match and match[2] in MONTHS:
                    payload["publishedAt"] = (
                        f"{match[3]}-{MONTHS[match[2]]:02}-{match[1]}"
                    )
            elif resource.get("indexUrl"):
                response = session.get(resource["indexUrl"], timeout=(8, 25))
                response.raise_for_status()
                candidates = [
                    u
                    for u in links(response.text, resource["indexUrl"])
                    if re.search(resource["filePattern"], u)
                ]
                if not candidates:
                    raise ValueError(
                        "No se encontró el archivo vigente de la publicación"
                    )
                url = (
                    max(candidates, key=publication_order)
                    if resource.get("monthYearRelease")
                    else max(candidates)
                )
            response = session.get(url, timeout=(8, 40))
            response.raise_for_status()
            raw, url = response.content, response.url
            if len(raw) < 100:
                raise ValueError("El recurso de crédito está vacío")
        payload["files"][key] = base64.b64encode(raw).decode("ascii")
        payload["urls"][key] = url
    return json.dumps(payload).encode(), payload["urls"][
        source.get("primaryResource", next(iter(source["resources"])))
    ]


def calendar(frame, start=None):
    frame = frame.sort_index()
    if frame.index.has_duplicates or frame.empty:
        raise ValueError("Fechas duplicadas o planilla sin observaciones")
    if start:
        frame = frame.loc[start:]
    return frame.reindex(pd.date_range(frame.index.min(), frame.index.max(), freq="MS"))


def rebase(frame, base, retain_history=False):
    if (
        pd.Timestamp(base) not in frame.index
        or frame.loc[base].isna().any()
        or (frame.loc[base] <= 0).any()
    ):
        raise ValueError("Falta una base de comparación positiva y completa")
    indexed = frame.div(frame.loc[base]).mul(100)
    return indexed if retain_history else indexed.loc[base:]


def chain_real_changes(frame, base):
    """Encadena sin saltar faltantes; la observación base no necesita su variación previa."""
    frame = calendar(frame)
    if pd.Timestamp(base) not in frame.index:
        raise ValueError("La publicación ya no contiene el mes base")
    tail = frame.loc[base:].copy()
    if tail.iloc[1:].isna().any().any() or (tail.iloc[1:] <= -100).any().any():
        raise ValueError("No se puede encadenar un saldo con variaciones faltantes")
    tail.iloc[0] = 0
    return (1 + tail / 100).cumprod() * 100


def workbook_frame(source, raw):
    import openpyxl

    book = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    sheet = book[source["sheet"]]
    rows = list(sheet.values)
    header = " ".join(
        str(v)
        for row in rows[: source.get("headerRows", 12)]
        for v in row
        if v is not None
    )
    if not all(token.lower() in header.lower() for token in source["headerContains"]):
        raise ValueError("Cambió el título, universo o unidad de la planilla")
    for item in source["series"]:
        if item.get("headerToken") and not any(
            item["headerToken"].lower() in str(row[item["column"]]).lower()
            for row in rows[: source.get("headerRows", 12)]
        ):
            raise ValueError("Cambió la columna de una serie de crédito")
    date_column = source.get("dateColumn", 0)
    data = []
    for row in rows:
        period = row[date_column]
        if source["layout"] == "employment" and isinstance(period, str):
            match = re.fullmatch(r"([a-z]{3})-(\d{2})\s*\*?", period.lower().strip())
            period = (
                datetime(2000 + int(match[2]), MONTHS[match[1]], 1)
                if match and match[1] in MONTHS
                else None
            )
        if not isinstance(period, datetime):
            continue
        data.append(
            [
                pd.Timestamp(period).replace(day=1),
                *[number(row[item["column"]]) for item in source["series"]],
            ]
        )
    book.close()
    frame = pd.DataFrame(
        data, columns=["date", *[s["id"] for s in source["series"]]]
    ).set_index("date")
    frame = calendar(frame, source.get("start"))
    if source.get("scale"):
        frame *= source["scale"]
    if source.get("operation") == "difference":
        if (
            pd.Timestamp(source["base"]) not in frame.index
            or frame.loc[source["base"]].isna().any()
        ):
            raise ValueError("Falta el nivel de empleo del mes base")
        frame = frame.subtract(frame.loc[source["base"]]).loc[source["base"] :]
    if source.get("operation") == "chain":
        frame = chain_real_changes(frame, source["base"])
    if source.get("operation") == "yoy":
        frame = (frame / frame.shift(12) - 1) * 100
        frame = frame.dropna(how="all")
    if source.get("operation") == "halfYearGrowth":
        frame = (frame / frame.shift(6) - 1) * 100
        frame = frame.dropna(how="all")
    return frame


def ipc_frame(raw):
    frame = pd.read_csv(
        io.BytesIO(raw), sep=";", decimal=",", encoding="latin1", dtype={"Codigo": str}
    )
    if not {"Codigo", "Periodo", "Region", "Indice_IPC"}.issubset(frame.columns):
        raise ValueError("Cambió el esquema del IPC")
    frame["Codigo"] = frame.Codigo.str.strip().str.lstrip("0").replace("", "0")
    frame = frame.loc[frame.Region.eq("Nacional") & frame.Codigo.isin(["0", "4"])]
    frame["date"] = pd.to_datetime(frame.Periodo.astype(str), format="%Y%m")
    result = frame.pivot(index="date", columns="Codigo", values="Indice_IPC").rename(
        columns={"0": "ipc", "4": "housing"}
    )
    if set(result.columns) != {"ipc", "housing"} or (result <= 0).any().any():
        raise ValueError("No se verifican nivel general y vivienda del IPC nacional")
    return calendar(result)


def rates_frame(files):
    import xlrd

    sheet = xlrd.open_workbook(file_contents=files["loans"]).sheet_by_name(
        "Tasas_sector_privado"
    )
    merged_header = " ".join(
        str(sheet.cell_value(r, c)) for r in range(24) for c in range(sheet.ncols)
    )
    if (
        "PERSONAL" not in merged_header.upper()
        or "TARJETA" not in merged_header.upper()
    ):
        raise ValueError("No se verifican las líneas de tasas activas")
    rows = []
    for r in range(sheet.nrows):
        values = sheet.row_values(r)
        code = number(values[2])
        if code and 200001 <= code <= 209912 and code == int(code):
            year, month = divmod(int(code), 100)
            if 1 <= month <= 12:
                rows.append(
                    [
                        pd.Timestamp(year, month, 1),
                        *[number(values[c]) for c in [50, 56, 4, 12]],
                    ]
                )
    loans = pd.DataFrame(
        rows, columns=["date", "personal", "card", "overdraft", "documents"]
    ).set_index("date")
    sheet = xlrd.open_workbook(file_contents=files["deposits"]).sheet_by_name(
        "Serie_Mensual"
    )
    if "30 a 59" not in " ".join(str(sheet.cell_value(r, 5)) for r in range(24)):
        raise ValueError("Cambió el plazo de la tasa pasiva")
    rows = []
    for r in range(sheet.nrows):
        values = sheet.row_values(r)
        code = number(values[2])
        if code and 2000 < code < 2100:
            year, month = int(code), round((code % 1) * 100)
            if 1 <= month <= 12:
                rows.append([pd.Timestamp(year, month, 1), number(values[5])])
    deposits = pd.DataFrame(rows, columns=["date", "deposit"]).set_index("date")
    result = calendar(loans.join(deposits, how="outer"), "2022-01-01")
    result["spread"] = result.personal - result.deposit
    if "ipc" in files:
        prices = ipc_frame(files["ipc"])
        inflation = prices.ipc / prices.ipc.shift(1)
        result["real_personal"] = ((1 + result.personal / 1200) / inflation - 1) * 100
        result = result.loc[
            : min(result.personal.last_valid_index(), prices.ipc.last_valid_index())
        ]
    return result


def retail_frame(raw):
    import openpyxl

    book = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    rows = list(book["Tasas"].values)
    if "nominal anual" not in str(
        rows[0][0]
    ).lower() or "Promedios mensuales" not in str(rows[0][0]):
        raise ValueError("Cambió la unidad de las tasas minoristas")
    labels = {str(r[0]).strip(): r for r in rows if r[0] is not None}
    personal, deposit = (
        labels["Personales"],
        labels["Personas humanas hasta $1 millón (30-35 días)"],
    )
    data = []
    for c, period in enumerate(rows[2]):
        if isinstance(period, datetime):
            a, b = number(personal[c]), number(deposit[c])
            data.append(
                [
                    pd.Timestamp(period).replace(day=1),
                    a,
                    b,
                    a - b if a is not None and b is not None else None,
                ]
            )
    book.close()
    return calendar(
        pd.DataFrame(data, columns=["date", "personal", "deposit", "spread"]).set_index(
            "date"
        )
    )


def wages_frame(files, operation):
    prices = ipc_frame(files["ipc"])
    wages = pd.read_csv(io.BytesIO(files["wages"]), sep=";", decimal=",")
    wages["date"] = pd.to_datetime(wages.periodo, dayfirst=True)
    names = {
        "IS_sector_privado_registrado": "private",
        "IS_sector_publico": "public",
        "IS_sector_no_registrado": "unregistered",
        "IS_indice_total": "total",
        "IS_total_registrado": "registered",
    }
    if not set(names).issubset(wages.columns):
        raise ValueError("Cambió el esquema de salarios")
    wages = calendar(wages.set_index("date")[list(names)].rename(columns=names))
    common = wages.join(prices, how="inner")
    if operation == "real":
        return rebase(
            common[list(names.values())].div(common.ipc, axis=0), "2023-11-01"
        )
    return rebase(
        common[["ipc", "housing", "private"]].rename(columns={"private": "registered"}),
        "2023-11-01",
    )


def solvency_frame(raw, url):
    import pdfplumber

    with pdfplumber.open(io.BytesIO(raw)) as book:
        text = " ".join(page.extract_text() or "" for page in book.pages[:3])
    text = re.sub(r"\s+", " ", text)
    patterns = {
        "provisions": r"previsiones totales representaron\s+([\d,]+)% de la cartera en situaci[oó]n irregular",
        "net_irregular": r"cr[eé]dito en situaci[oó]n irregular neto de previsiones alcanz[oó]\s+a\s+([\d,]+)% de la integraci[oó]n de capital",
        "capital": r"activos ponderados por riesgo\s*\(APR\)\s*hasta\s+([\d,]+)%",
    }
    values = {}
    for key, pattern in patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if not match:
            raise ValueError("Cambió la redacción del indicador de solvencia")
        values[key] = float(match[1].replace(",", "."))
    period = re.search(r"informe-bancos-(\d{4})-(\d{2})\.pdf$", url)
    if not period:
        raise ValueError("No se identifica el período del informe bancario")
    return pd.DataFrame(values, index=[pd.Timestamp(int(period[1]), int(period[2]), 1)])


def context_frame(source, raw):
    data = json.loads(raw)
    frame = pd.DataFrame(data["observations"]).pivot(
        index="date", columns="series", values="value"
    )
    frame.index = pd.to_datetime(frame.index)
    frame = calendar(frame)
    selected = pd.DataFrame(
        {s["id"]: frame[s["inputSeries"]] for s in source["series"]}
    )
    if source["operation"] == "rebase":
        return rebase(selected, source["base"])
    result = selected.loc[source["start"] :].copy() * float("nan")
    for period in result.index:
        for item in source["series"]:
            base_year = item.get(
                "referenceYear", source.get("referenceYear", period.year - 1)
            )
            current = selected[item["id"]].loc[f"{period.year}-01-01" : period]
            reference = selected[item["id"]].loc[
                f"{base_year}-01-01" : f"{base_year}-{period.month:02}-01"
            ]
            if (
                len(current) == len(reference) == period.month
                and not current.isna().any()
                and not reference.isna().any()
                and reference.sum() > 0
            ):
                result.loc[period, item["id"]] = (
                    current.sum() / reference.sum() - 1
                ) * 100
    return result


def parse_credit(source, raw):
    payload = json.loads(raw)
    files = {k: base64.b64decode(v) for k, v in payload["files"].items()}
    layout = source["layout"]
    if layout in {"bank", "employment", "inclusion"}:
        frame = workbook_frame(source, files["workbook"])
    elif layout in {"rates", "real_rate", "spread"}:
        frame = rates_frame(files)
    elif layout == "retail":
        frame = retail_frame(files["workbook"])
    elif layout in {"wages", "prices_wages"}:
        frame = wages_frame(files, "real" if layout == "wages" else "nominal")
    elif layout == "prices":
        frame = ipc_frame(files["ipc"])
        if source["operation"] == "rebase":
            frame = rebase(frame, source["base"])
        else:
            lag = 12 if source["operation"] == "yoy" else 1
            frame = (frame / frame.shift(lag) - 1) * 100
    elif layout == "context":
        frame = context_frame(source, files["input"])
    elif layout == "fortress":
        frame = pd.read_csv(io.BytesIO(files["csv"]))
        frame["date"] = pd.to_datetime(frame.mes, format="%Y-%m")
        frame = frame.set_index("date")
        frame = pd.DataFrame(
            {s["id"]: frame[s["externalField"]] for s in source["series"]}
        )
    elif layout == "solvency":
        frame = solvency_frame(files["report"], payload["urls"]["report"])
    else:
        raise ValueError("Lector de crédito desconocido")
    frame = calendar(frame, source.get("start"))
    if layout == "employment":
        release = re.search(
            r"trabajoregistrado_(\d{2})(\d{2})_estadisticas\.xlsx$",
            payload["urls"]["workbook"],
        )
        if not release or frame.index.max() != pd.Timestamp(
            2000 + int(release[1]), int(release[2]), 1
        ):
            raise ValueError("El último mes de empleo no coincide con la publicación")
    observations = [
        {
            "date": period.date().isoformat(),
            "series": item["id"],
            "value": number(row[item["id"]]),
        }
        for period, row in frame.iterrows()
        for item in source["series"]
    ]
    return source["series"], observations
