"""Controla los artefactos públicos y la trazabilidad del catálogo antes de construir."""

import sys

from update_all import ROOT, content_hash, read_json, validate_dataset


def main() -> int:
    manifest = read_json(ROOT / "public/data/manifest.json")
    catalog = read_json(ROOT / "public/data/catalog.json")
    expected = {f"SR-{i:02}" for i in range(1, 49)}
    assert expected.issubset({p["id"] for p in catalog}) and len(
        {p["id"] for p in catalog}
    ) == len(catalog), "Se perdieron requisitos"
    ids = {d["id"] for d in manifest["datasets"]}
    usable = 0
    for meta in manifest["datasets"]:
        path = ROOT / "public" / meta["dataFile"]
        data = read_json(path)
        assert data["status"] in {"ready", "partial", "stale", "unavailable"}
        for field in [
            "lastObservedPeriod",
            "lastSuccessfulFetchAt",
            "lastAttemptAt",
            "sourcePublishedAt",
            "sourceUrl",
            "frequency",
            "unit",
            "isAutoUpdated",
        ]:
            assert field in data, (data["id"], field)
        if not data["observations"]:
            assert data["status"] == "unavailable"
            continue
        if data.get("isForecast"):
            from forecast_emae import validate_forecast

            validate_forecast(data)
            history = read_json(ROOT / "public/data/emae.json")
            assert (
                data["inputHash"] == history["contentHash"] or data["status"] == "stale"
            )
            assert data["lastObservedPeriod"] == data["trainedThrough"]
        else:
            validate_dataset(data)
        assert data["contentHash"] == content_hash(data["observations"])
        assert data.get("isForecast") or data["lastObservedPeriod"] == max(
            r["date"] for r in data["observations"] if r["value"] is not None
        )
        assert len(data["observations"]) == meta["observationCount"]
        assert (ROOT / "data/cache" / path.name).exists(), "Falta respaldo durable"
        csv_path = ROOT / "public" / meta["csvFile"]
        assert csv_path.read_bytes().startswith(b"\xef\xbb\xbf"), "Falta BOM para Excel"
        usable += 1
        print(
            f"OK {meta['id']}: {len(data['observations'])} observaciones, {data['lastObservedPeriod']}, {data['status']}"
        )
    for panel in catalog:
        assert panel.get("dataset") in ids or not panel.get("dataset"), panel["id"]
        assert panel["sourceLinks"], f"Sin fuente: {panel['id']}"
        for view in panel.get("views", [{}]):
            configured = panel | view
            dataset_id = configured.get("dataset")
            assert not dataset_id or dataset_id in ids, (panel["id"], dataset_id)
            if dataset_id:
                meta = next(d for d in manifest["datasets"] if d["id"] == dataset_id)
                assert set(configured.get("countries", [])).issubset(
                    {s["id"] for s in meta["series"]}
                ), panel["id"]
    assert usable > 0, "Sin datos utilizables"
    print(
        f"OK catálogo: 48 requisitos originales y {len(catalog) - 48} indicadores adicionales; {usable} datasets con respaldo y metadatos."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
