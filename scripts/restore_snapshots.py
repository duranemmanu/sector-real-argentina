"""Recupera snapshots verificados sin escribir datos en el historial del código."""

from __future__ import annotations

import io
import json
import logging
import os
import re
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

import requests
from forecast_emae import validate_forecast
from update_all import ROOT, content_hash, read_json, validate_dataset

LOGGER = logging.getLogger("sector-real")
MAX_BYTES = 50 * 1024 * 1024


def timestamp(dataset: dict) -> datetime:
    value = dataset.get("lastSuccessfulFetchAt")
    return (
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        if value
        else datetime.min.replace(tzinfo=UTC)
    )


def restore_bundle(files: dict[str, bytes], root: Path, expected: set[str]) -> int:
    """Valida el lote completo antes de reemplazar cualquier respaldo local."""
    if set(files) != {f"{identifier}.json" for identifier in expected}:
        raise ValueError("El respaldo no contiene exactamente los datasets esperados")
    if sum(map(len, files.values())) > MAX_BYTES:
        raise ValueError("Respaldo demasiado grande")
    decoded = {}
    for name, payload in files.items():
        dataset = json.loads(payload)
        if dataset["id"] + ".json" != name or not dataset.get("observations"):
            raise ValueError("Identidad o contenido del dataset inválidos")
        if dataset["status"] not in {"ready", "partial", "stale"}:
            raise ValueError("Estado del respaldo inválido")
        if dataset.get("isForecast"):
            validate_forecast(dataset)
        else:
            validate_dataset(dataset)
        if content_hash(dataset["observations"]) != dataset["contentHash"]:
            raise ValueError("Hash del respaldo inválido")
        if timestamp(dataset).tzinfo is None:
            raise ValueError("Fecha del respaldo sin zona horaria")
        decoded[name] = dataset
    cache = root / "data/cache"
    cache.mkdir(parents=True, exist_ok=True)
    restored = 0
    with tempfile.TemporaryDirectory(dir=cache.parent) as temporary:
        for name, dataset in decoded.items():
            destination = cache / name
            try:
                if destination.exists() and timestamp(
                    read_json(destination)
                ) > timestamp(dataset):
                    continue
            except (ValueError, KeyError, TypeError):
                pass
            staged = Path(temporary) / name
            staged.write_bytes(files[name])
            staged.replace(destination)
            restored += 1
    return restored


def unpack_archive(payload: bytes, expected: set[str]) -> dict[str, bytes]:
    if len(payload) > MAX_BYTES:
        raise ValueError("Archivo demasiado grande")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or set(names) != {
            f"{identifier}.json" for identifier in expected
        }:
            raise ValueError("Nombres o rutas del archivo inválidos")
        if sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("Contenido descomprimido demasiado grande")
        return {name: archive.read(name) for name in names}


def limited_get(url: str, **kwargs) -> bytes:
    with requests.get(url, stream=True, timeout=(15, 90), **kwargs) as response:
        response.raise_for_status()
        payload = bytearray()
        for chunk in response.iter_content(65536):
            payload.extend(chunk)
            if len(payload) > MAX_BYTES:
                raise ValueError("Descarga demasiado grande")
        return bytes(payload)


def restore_artifact(expected: set[str]) -> bool:
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN")
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository) or not token:
        return False
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    api = f"https://api.github.com/repos/{repository}/actions/artifacts"
    result = json.loads(
        limited_get(api + "?name=verified-snapshots&per_page=10", headers=headers)
    )
    for artifact in result.get("artifacts", []):
        run = artifact.get("workflow_run", {})
        if (
            artifact.get("expired")
            or run.get("head_branch") != "main"
            or str(run.get("head_repository_id"))
            != os.environ.get("GITHUB_REPOSITORY_ID")
        ):
            continue
        try:
            response = requests.get(
                f"{api}/{int(artifact['id'])}/zip",
                headers=headers,
                timeout=30,
                allow_redirects=False,
            )
            if response.status_code != 302:
                response.raise_for_status()
                raise ValueError("Respuesta de descarga inesperada")
            location = response.headers["Location"]
            if urlparse(location).scheme != "https":
                raise ValueError("Descarga sin HTTPS")
            # La URL firmada se consulta sin reenviar el token de GitHub.
            files = unpack_archive(limited_get(location), expected)
            count = restore_bundle(files, ROOT, expected)
            LOGGER.info("Respaldo de Actions recuperado: %s datasets", count)
            return True
        except (requests.RequestException, ValueError, KeyError, zipfile.BadZipFile):
            LOGGER.warning("Respaldo de Actions descartado; se probará otro")
    return False


def restore_published(expected: set[str]) -> bool:
    base = os.environ.get("PAGES_DATA_URL", "")
    parsed = urlparse(base)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or not parsed.hostname.endswith(".github.io")
    ):
        return False
    manifest = json.loads(limited_get(base.rstrip("/") + "/manifest.json"))
    if {dataset["id"] for dataset in manifest["datasets"]} != expected:
        raise ValueError("El sitio publicado tiene otro catálogo")
    files = {
        f"{identifier}.json": limited_get(base.rstrip("/") + f"/{identifier}.json")
        for identifier in sorted(expected)
    }
    count = restore_bundle(files, ROOT, expected)
    LOGGER.info("Respaldo publicado recuperado: %s datasets", count)
    return True


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    expected = {
        source["id"] for source in read_json(ROOT / "scripts/source_registry.json")
    }
    expected.add("forecast-emae")
    for restore in [restore_artifact, restore_published]:
        try:
            if restore(expected):
                return
        except (requests.RequestException, ValueError, KeyError, OSError):
            LOGGER.warning("Recuperación no disponible: %s", restore.__name__)
    LOGGER.info("Se utilizarán los snapshots verificados incluidos en el código")


if __name__ == "__main__":
    main()
