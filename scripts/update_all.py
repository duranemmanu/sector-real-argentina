"""Actualiza fuentes independientes; nunca reemplaza datos válidos por una descarga inválida."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import itertools
import json
import logging
import math
import re
import sys
from collections.abc import Callable
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import urljoin

import pandas as pd
import requests
from prepare_credit import download_credit, parse_credit
from prepare_indec import parse_consumption, parse_workbook
from prepare_other import (
    parse_agriculture,
    parse_construya,
    parse_curated,
    parse_pdf,
    parse_tourism,
    parse_tourism_comparison,
)
from prepare_sector import parse_sector
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[1]
LOGGER = logging.getLogger("sector-real")
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


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def content_hash(observations: list[dict]) -> str:
    payload = json.dumps(
        observations, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def validate_dataset(dataset: dict, today: date | None = None) -> None:
    today = today or datetime.now(UTC).date()
    frequency = dataset["frequency"]
    value_kind = dataset.get(
        "valueKind", "growth" if dataset["id"] == "wdi-growth" else "level"
    )
    series_ids = {s["id"] for s in dataset["series"]}
    observations = dataset["observations"]
    if not series_ids or not observations:
        raise ValueError("Dataset vacío o sin definición de series")
    keys = set()
    previous = ""
    non_null = 0
    for row in observations:
        parsed = date.fromisoformat(row["date"])
        if parsed.isoformat() != row["date"] or parsed.day != 1:
            raise ValueError("Período no canónico")
        if row["date"] < previous:
            raise ValueError("Fechas fuera de orden")
        previous = row["date"]
        key = (row["date"], row["series"])
        if key in keys or row["series"] not in series_ids:
            raise ValueError("Observación duplicada o serie desconocida")
        keys.add(key)
        if frequency == "annual" and (parsed.month != 1 or parsed.year >= today.year):
            raise ValueError("Año incompleto o futuro")
        if frequency == "monthly" and parsed >= today.replace(day=1):
            raise ValueError("Mes incompleto o futuro")
        if frequency == "seasonal" and (
            parsed.month != 7 or date(parsed.year, 8, 1) > today
        ):
            raise ValueError("Temporada de invierno incompleta o futura")
        if frequency in {"quarterly", "semiannual"}:
            step = 6 if frequency == "semiannual" else 3
            if parsed.month not in range(1, 13, step):
                raise ValueError("Inicio de período inválido")
            next_month = parsed.month + step
            end = date(parsed.year + (next_month > 12), (next_month - 1) % 12 + 1, 1)
            if end > today:
                raise ValueError("Trimestre incompleto o futuro")
        value = row["value"]
        if value is not None:
            if (
                isinstance(value, bool)
                or not isinstance(value, (float, int))
                or not math.isfinite(value)
            ):
                raise ValueError("Valor no numérico o no finito")
            if value_kind in {"level", "percentage"} and value < 0:
                raise ValueError("Nivel negativo inesperado")
            if value_kind == "growth" and not -100 <= value <= 100:
                raise ValueError("Variación del PIB fuera del rango de validación")
            if value_kind == "percentage" and value > 100.01:
                raise ValueError("Porcentaje superior a 100")
            non_null += 1
    if non_null == 0:
        raise ValueError("No hay observaciones numéricas válidas")
    increment = {
        "monthly": 1,
        "quarterly": 3,
        "semiannual": 6,
        "annual": 12,
        "seasonal": 12,
    }[frequency]
    for series_id in series_ids:
        periods = [
            date.fromisoformat(r["date"])
            for r in observations
            if r["series"] == series_id
        ]
        if not periods:
            raise ValueError("Serie sin períodos")
        for previous_date, next_date in itertools.pairwise(periods):
            distance = (
                (next_date.year - previous_date.year) * 12
                + next_date.month
                - previous_date.month
            )
            if distance != increment:
                raise ValueError(
                    "Calendario irregular: declarar los períodos faltantes como null"
                )


def create_session() -> requests.Session:
    session = requests.Session()
    retries = Retry(
        total=1, backoff_factor=0.5, status_forcelist=[429, 500, 502, 503, 504]
    )
    session.mount("https://", HTTPAdapter(max_retries=retries))
    session.headers["User-Agent"] = (
        "SectorRealArgentina/0.1 (estadisticas publicas; ETL)"
    )
    return session


def download(
    source: dict, session: requests.Session, snapshots=None
) -> tuple[bytes, str]:
    if source["adapter"] in {"credit", "sector"}:
        return download_credit(source, session, snapshots)
    if source["adapter"] == "consumption":
        response = session.get(source["indexUrl"], timeout=(8, 25))
        response.raise_for_status()
        links = [
            urljoin(source["indexUrl"], "/" + link.lstrip("./"))
            for link in re.findall(r'href=["\x27]([^"\x27]+)', response.text)
            if link.lstrip("./").startswith(("ftp/", "uploads/"))
        ]
        urls = {}
        payload = {}
        for key, pattern in source["resourcePatterns"].items():
            candidates = [link for link in links if re.search(pattern, link)]
            if not candidates:
                raise ValueError("Falta un recurso de la publicación de consumo")
            urls[key] = candidates[0]
            response = session.get(urls[key], timeout=(8, 25))
            response.raise_for_status()
            payload[key] = base64.b64encode(response.content).decode("ascii")
        releases = [re.search(r"_(\d{2}_\d{2})", url) for url in urls.values()]
        if (
            any(match is None for match in releases)
            or len({match[1] for match in releases}) != 1
        ):
            raise ValueError(
                "El informe y los XLS pertenecen a publicaciones diferentes"
            )
        payload["urls"] = urls
        return json.dumps(payload).encode("utf-8"), urls["report"]
    if source["adapter"] == "tourism_comparison":
        payload = []
        for url in [
            source["sourceUrl"],
            source["additionalUrl"],
            source["regionUrl"],
            source["latinAmericaUrl"],
            source["definitionUrl"],
        ]:
            response = session.get(url, timeout=(8, 25))
            response.raise_for_status()
            payload.append(base64.b64encode(response.content).decode("ascii"))
        return json.dumps(payload).encode("utf-8"), source["sourceUrl"]
    if source["adapter"] in {"curated", "curated_csv_columns"}:
        raw = (ROOT / source["curatedFile"]).read_bytes()
        if source.get("curatedSha256") and (
            hashlib.sha256(raw.replace(b"\r\n", b"\n")).hexdigest()
            != source["curatedSha256"]
        ):
            raise ValueError(
                "Cambió el archivo curado: requiere nueva revisión documentada"
            )
        return raw, source["sourceUrl"]
    if source["adapter"] == "tourism":
        from fetch_tourism import download_tourism

        return download_tourism(source)
    url = source["sourceUrl"]
    if source.get("indexUrl"):
        response = session.get(source["indexUrl"], timeout=(8, 25))
        response.raise_for_status()
        links = re.findall(r'href=["\x27]([^"\x27]+)', response.text)
        candidates = [
            urljoin(
                source["indexUrl"],
                "/" + link.lstrip("./")
                if link.lstrip("./").startswith(("ftp/", "uploads/"))
                else link,
            )
            for link in links
            if re.search(source["filePattern"], link)
        ]
        if not candidates:
            raise ValueError(
                "No se encontró el archivo oficial en la página de publicación"
            )
        url = candidates[0]
    params = source.get("requestParams")
    if source["adapter"] == "datos":
        params = {
            "ids": ",".join(s["id"] for s in source["series"]),
            "format": "json",
            "limit": 5000,
        }
    response = session.get(url, params=params, timeout=(8, 25))
    response.raise_for_status()
    if len(response.content) < 100:
        raise ValueError("Respuesta vacía o demasiado corta")
    return response.content, response.url


def parse_datos(source: dict, raw: bytes) -> tuple[list[dict], list[dict]]:
    payload = json.loads(raw)
    rows, meta = payload["data"], payload["meta"]
    ids = [s["id"] for s in source["series"]]
    if [m["field"]["id"] for m in meta[1:]] != ids:
        raise ValueError("Cambió el esquema o el orden de las series de la API")
    expected = {"monthly": "month", "quarterly": "quarter", "annual": "year"}[
        source["frequency"]
    ]
    if meta[0]["frequency"] != expected or len(rows) != payload["count"]:
        raise ValueError("Frecuencia incorrecta o paginación incompleta")
    observations = []
    for row in rows:
        if len(row) != len(ids) + 1:
            raise ValueError("Cambió el ancho de la respuesta API")
        for index, series_id in enumerate(ids, start=1):
            observations.append(
                {"date": row[0], "series": series_id, "value": row[index]}
            )
    series = [
        {**s, "sourceUnit": meta[i + 1]["field"].get("units")}
        for i, s in enumerate(source["series"])
    ]
    return series, observations


def parse_csv_columns(source: dict, raw: bytes) -> tuple[list[dict], list[dict]]:
    frame = pd.read_csv(io.BytesIO(raw))
    required = [source.get("dateColumn", "indice_tiempo")] + [
        s["externalField"] for s in source["series"]
    ]
    if not set(required).issubset(frame.columns):
        raise ValueError("Cambió el esquema del CSV oficial")
    if source.get("requiredPeriods") and (
        set(frame[required[0]]) != set(source["requiredPeriods"])
        or len(frame) != len(source["requiredPeriods"])
    ):
        raise ValueError("La serie no conserva los períodos verificados")
    observations = [
        {
            "date": row[required[0]],
            "series": item["id"],
            "value": None
            if pd.isna(row[item["externalField"]])
            else float(row[item["externalField"]]),
        }
        for _, row in frame.iterrows()
        for item in source["series"]
    ]
    return source["series"], observations


def parse_wdi(source: dict, raw: bytes) -> tuple[list[dict], list[dict]]:
    payload = json.loads(raw)
    if not isinstance(payload, list) or len(payload) != 2 or payload[0]["pages"] != 1:
        raise ValueError("WDI inválido o incompleto")
    ids = {s["id"] for s in source["series"]}
    observations = []
    for row in payload[1]:
        if (
            row["indicator"]["id"] != source["externalId"]
            or row["countryiso3code"] not in ids
        ):
            raise ValueError("Indicador/país WDI inesperado")
        if 2004 <= int(row["date"]) <= 2025:
            observations.append(
                {
                    "date": row["date"] + "-01-01",
                    "series": row["countryiso3code"],
                    "value": row["value"],
                }
            )
    if {r["series"] for r in observations} != ids:
        raise ValueError("Faltan países en la respuesta WDI")
    return source["series"], observations


def parse_indec(source: dict, raw: bytes) -> tuple[list[dict], list[dict]]:
    sectoral = source["adapter"] == "indec_sectors"
    sheet = "Tabla Letras" if sectoral else "Tabla"
    frame = pd.read_excel(io.BytesIO(raw), sheet_name=sheet, header=None, engine="xlrd")
    if "base 2004=100" not in str(frame.iloc[0, 0]).lower():
        raise ValueError("Cambió el encabezado/base del XLS EMAE")
    if sectoral:
        if "Agricultura" not in str(frame.iloc[2, 2]):
            raise ValueError("Cambió la estructura sectorial EMAE")
        columns = list(range(2, frame.shape[1]))
        series = [
            {
                "id": "agriculture" if c == 2 else f"sector-{c}",
                "label": str(frame.iloc[2, c]).strip(),
            }
            for c in columns
        ]
    else:
        if not all(
            needle in str(frame.iloc[2, c]).lower()
            for c, needle in [
                (2, "original"),
                (4, "desestacionalizada"),
                (6, "tendencia"),
            ]
        ):
            raise ValueError("Cambió la estructura general EMAE")
        columns, series = [2, 4, 6], source["series"]
    observations = []
    year = None
    for _, row in frame.iloc[5:].iterrows():
        if isinstance(row.iloc[0], (int, float)) and pd.notna(row.iloc[0]):
            year = int(row.iloc[0])
        month = MONTHS.get(str(row.iloc[1]).strip().lower())
        if month is None:
            continue
        if year is None or not 2004 <= year <= 2100:
            raise ValueError("Año no reconocido en XLS EMAE")
        for c, series_info in zip(columns, series):
            value = row.iloc[c]
            observations.append(
                {
                    "date": date(year, month, 1).isoformat(),
                    "series": series_info["id"],
                    "value": None if pd.isna(value) else float(value),
                }
            )
    return series, observations


def refresh_source(
    source: dict, cache_dir: Path, fetch: Callable, attempt_at: str
) -> dict:
    cache_path = cache_dir / f"{source['id']}.json"
    old = None
    if cache_path.exists():
        try:
            old = read_json(cache_path)
            validate_dataset(old)
        except (ValueError, KeyError, TypeError):
            old = None
            LOGGER.warning("%s: respaldo inválido descartado", source["id"])
    try:
        raw, resolved_url = fetch(source)
        parser = {
            "credit": parse_credit,
            "sector": parse_sector,
            "csv_columns": parse_csv_columns,
            "curated_csv_columns": parse_csv_columns,
            "datos": parse_datos,
            "wdi": parse_wdi,
            "indec_workbook": parse_workbook,
            "consumption": parse_consumption,
            "construya": parse_construya,
            "agriculture": parse_agriculture,
            "pdf": parse_pdf,
            "tourism": parse_tourism,
            "curated": parse_curated,
            "tourism_comparison": parse_tourism_comparison,
        }.get(source["adapter"], parse_indec)
        series, observations = parser(source, raw)
        if old and source.get("mergeHistory"):
            if old["unit"] != source["unit"] or {s["id"] for s in old["series"]} != {
                s["id"] for s in series
            }:
                raise ValueError(
                    "Cambió la unidad o el universo de una serie con ventana móvil"
                )
            if max(r["date"] for r in observations) < old["lastObservedPeriod"]:
                raise ValueError("La publicación retrocedió respecto del respaldo")
            joined = {(r["date"], r["series"]): r for r in old["observations"]}
            joined.update(
                {
                    (r["date"], r["series"]): r
                    for r in observations
                    if not source.get("preserveObservedWhenOmitted")
                    or r["value"] is not None
                    or (r["date"], r["series"]) not in joined
                }
            )
            observations = list(joined.values())
        observations.sort(key=lambda r: (r["date"], r["series"]))
        dataset = {
            "id": source["id"],
            "source": source["source"],
            "sourceUrl": resolved_url,
            "frequency": source["frequency"],
            "unit": source["unit"],
            "series": series,
            "methodNote": source["transform"],
            "observations": observations,
            **(
                {"supportingSources": source["supportingSources"]}
                if source.get("supportingSources")
                else {}
            ),
            **(
                {"periodLabel": source["periodLabel"]}
                if source.get("periodLabel")
                else {}
            ),
            "valueKind": source.get(
                "valueKind", "growth" if source["id"] == "wdi-growth" else "level"
            ),
        }
        validate_dataset(dataset)
        credit_payload = (
            json.loads(raw) if source["adapter"] in {"credit", "sector"} else None
        )
        if credit_payload:
            dataset["supportingSources"] = [
                *source.get("supportingSources", []),
                *[
                    {
                        "label": source["resources"][key].get(
                            "label", "Archivo de datos"
                        ),
                        "url": url,
                    }
                    for key, url in credit_payload["urls"].items()
                    if url != resolved_url
                ],
                *(
                    [
                        {
                            "label": "Publicación BCRA",
                            "url": credit_payload["publicationUrl"],
                        }
                    ]
                    if credit_payload.get("publicationUrl")
                    else []
                ),
            ]
        if source["adapter"] == "consumption":
            dataset["supportingSources"] = [
                {
                    "label": "INDEC · XLS de consumo "
                    + ("original" if key == "original" else "desestacionalizado"),
                    "url": url,
                }
                for key, url in json.loads(raw)["urls"].items()
                if key != "report"
            ]
        if old:
            prior_keys = {(r["date"], r["series"]) for r in old["observations"]}
            new_keys = {(r["date"], r["series"]) for r in observations}
            if not prior_keys.issubset(new_keys):
                raise ValueError("La respuesta recortó historia previamente validada")
        observed = [r["date"] for r in observations if r["value"] is not None]
        per_series = {
            s["id"]: max(
                (
                    r["date"]
                    for r in observations
                    if r["series"] == s["id"] and r["value"] is not None
                ),
                default=None,
            )
            for s in series
        }
        digest = content_hash(observations)
        old_values = (
            {(r["date"], r["series"]): r["value"] for r in old["observations"]}
            if old
            else {}
        )
        revised = sum(
            1
            for r in observations
            if (r["date"], r["series"]) in old_values
            and old_values[(r["date"], r["series"])] != r["value"]
        )
        lagging = [s["label"] for s in series if per_series[s["id"]] != max(observed)]
        notes = [source.get("qualityNote", "")]
        if lagging:
            notes.append(
                "Hay series con cobertura distinta o sin observaciones: "
                + ", ".join(lagging)
                + "."
            )
        quality_note = " ".join(note for note in notes if note)
        dataset.update(
            {
                "status": "partial" if quality_note else "ready",
                "note": quality_note,
                "lastObservedPeriod": max(observed),
                "firstObservedPeriod": min(observed),
                "lastObservedBySeries": per_series,
                "lastSuccessfulFetchAt": min(credit_payload["dates"])
                if credit_payload and credit_payload.get("dates")
                else source.get("verifiedAt", attempt_at),
                "lastAttemptAt": attempt_at,
                "sourcePublishedAt": credit_payload.get("publishedAt")
                if credit_payload
                else source.get("sourcePublishedAt"),
                "isAutoUpdated": source.get("isAutoUpdated", True),
                "contentHash": digest,
                "rawSha256": hashlib.sha256(raw).hexdigest(),
                "dataChangedAt": attempt_at
                if not old or old["contentHash"] != digest
                else old["dataChangedAt"],
                "revisedObservations": revised,
                "newObservations": sum(
                    (r["date"], r["series"]) not in old_values for r in observations
                ),
                "changedSinceLastFetch": not old or old["contentHash"] != digest,
            }
        )
        write_json(cache_path, dataset)
        LOGGER.info(
            "%s: %s; %d observaciones; hasta %s; revisadas=%d",
            source["id"],
            dataset["status"],
            len(observations),
            max(observed),
            revised,
        )
        return dataset
    except (
        requests.RequestException,
        ValueError,
        KeyError,
        TypeError,
        IndexError,
        OSError,
    ) as error:
        reason = f"Consulta fallida: {type(error).__name__}. Se conserva el último snapshot validado."
        LOGGER.warning("%s: %s", source["id"], str(error)[:240])
        if old:
            return {
                **old,
                "status": "stale",
                "lastAttemptAt": attempt_at,
                "note": " ".join(filter(None, [source.get("qualityNote"), reason])),
            }
        return {
            "id": source["id"],
            "source": source["source"],
            "sourceUrl": source["sourceUrl"],
            "frequency": source["frequency"],
            "unit": source["unit"],
            "series": source["series"],
            "observations": [],
            "status": "unavailable",
            "note": reason.replace(
                "Se conserva el último snapshot validado.",
                "No hay snapshot de respaldo.",
            ),
            "lastObservedPeriod": None,
            "lastSuccessfulFetchAt": None,
            "lastAttemptAt": attempt_at,
            "sourcePublishedAt": None,
            "isAutoUpdated": source.get("isAutoUpdated", True),
            "methodNote": source["transform"],
        }


def write_csv(path: Path, dataset: dict) -> None:
    labels = {s["id"]: s["label"] for s in dataset["series"]}
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter=";")
        writer.writerow(["Período", "Serie", "Valor", "Unidad", "Fuente"])
        for r in dataset["observations"]:
            value = "" if r["value"] is None else str(r["value"]).replace(".", ",")
            writer.writerow(
                [
                    r["date"],
                    labels[r["series"]],
                    value,
                    dataset["unit"],
                    dataset["source"],
                ]
            )


def create_catalog(root: Path) -> list[dict]:
    catalog = read_json(root / "scripts/catalog.json")
    expected = {f"SR-{i:02}" for i in range(1, 49)}
    ids = {panel["id"] for panel in catalog}
    if (
        not expected.issubset(ids)
        or len(ids) != len(catalog)
        or any(
            panel["id"] not in expected
            and (
                not re.fullmatch(r"(?:CP|MN|TR|EP)-(?:0[1-9]|[1-9]\d)", panel["id"])
                or panel["section"]
                != {
                    "CP": "credit",
                    "MN": "mining",
                    "TR": "labor",
                    "EP": "industry",
                }.get(panel["id"][:2])
            )
            for panel in catalog
        )
    ):
        raise ValueError("El catálogo debe conservar los 48 indicadores")
    if any(not panel.get("sourceLinks") for panel in catalog):
        raise ValueError("Cada indicador debe identificar sus fuentes")
    return catalog


def download_key(source: dict) -> tuple:
    return (
        source["adapter"],
        source["sourceUrl"],
        source.get("indexUrl"),
        source.get("curatedFile"),
        tuple(s["id"] for s in source["series"])
        if source["adapter"] == "datos"
        else (),
        json.dumps(source.get("resources", {}), sort_keys=True),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root", type=Path, default=ROOT, help="Directorio de salidas y respaldo"
    )
    parser.add_argument(
        "--offline", action="store_true", help="Probar fallback sin consultar la red"
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    registry = read_json(ROOT / "scripts/source_registry.json")
    output = args.root / "public/data"
    output.mkdir(parents=True, exist_ok=True)
    session = create_session()
    downloads = {}
    refreshed = {}

    def fetch(source):
        if args.offline:
            raise requests.ConnectionError("Simulación de caída de fuentes (--offline)")
        key = download_key(source)
        if key not in downloads:
            downloads[key] = download(source, session, refreshed)
        return downloads[key]

    datasets = []
    for source in registry:
        dataset = refresh_source(source, args.root / "data/cache", fetch, utc_now())
        datasets.append(dataset)
        refreshed[source["id"]] = dataset
    from forecast_emae import build_forecast, validate_forecast

    history = next(d for d in datasets if d["id"] == "emae")
    forecast_path = args.root / "data/cache/forecast-emae.json"
    previous = None
    try:
        if forecast_path.exists():
            previous = read_json(forecast_path)
            validate_forecast(previous)
    except (ValueError, KeyError, TypeError, OSError):
        previous = None
        LOGGER.warning("forecast-emae: respaldo inválido; se intentará reestimar")
    try:
        forecast = build_forecast(history, previous)
        forecast["contentHash"] = content_hash(forecast["observations"])
        if history["status"] == "stale":
            forecast.update(
                status="stale",
                note="La consulta del histórico falló; se conserva el último corte verificado del pronóstico.",
            )
        if forecast["status"] in {"ready", "partial"}:
            write_json(forecast_path, forecast)
        LOGGER.info(
            "forecast-emae: %s; %s; corte %s",
            forecast["status"],
            forecast["modelName"],
            forecast["trainedThrough"],
        )
    except (ValueError, RuntimeError, KeyError, ImportError, OSError) as error:
        LOGGER.warning("forecast-emae: %s", type(error).__name__)
        if previous:
            forecast = {
                **previous,
                "status": "stale",
                "note": "Falló la reestimación. Pronóstico desactualizado: se conserva su histórico y corte anteriores, sin anexarlo al histórico nuevo.",
                "lastAttemptAt": utc_now(),
            }
        else:
            forecast = {
                **{k: v for k, v in history.items() if k != "observations"},
                "id": "forecast-emae",
                "status": "unavailable",
                "observations": [],
                "note": "No se pudo obtener un pronóstico validado; el histórico permanece disponible en SR-47.",
            }
    datasets.append(forecast)
    for dataset in datasets:
        write_json(output / f"{dataset['id']}.json", dataset)
        if dataset["observations"]:
            write_csv(output / f"{dataset['id']}.csv", dataset)
    manifest = {
        "schemaVersion": 1,
        "generatedAt": utc_now(),
        "datasets": [
            {k: v for k, v in dataset.items() if k != "observations"}
            | {
                "dataFile": f"data/{dataset['id']}.json",
                "csvFile": f"data/{dataset['id']}.csv"
                if dataset["observations"]
                else None,
                "observationCount": len(dataset["observations"]),
            }
            for dataset in datasets
        ],
    }
    write_json(output / "manifest.json", manifest)
    write_json(output / "catalog.json", create_catalog(ROOT))
    if not any(d["observations"] for d in datasets):
        LOGGER.error(
            "Sin snapshots utilizables: no se debe reemplazar un despliegue operativo"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
