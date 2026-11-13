"""Pronóstico mensual reproducible, con validación temporal y fallback sin bandas inventadas."""

import json
import warnings
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pandas as pd

MODEL_VERSION = "sarima-reference-v1"
CANDIDATES = [
    ((0, 1, 1), (0, 1, 1, 12)),
    ((1, 1, 0), (0, 1, 1, 12)),
    ((1, 0, 0), (1, 0, 0, 12)),
]


def fit_model(series, order, seasonal):
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    with warnings.catch_warnings(record=True):
        result = SARIMAX(
            series,
            order=order,
            seasonal_order=seasonal,
            enforce_stationarity=True,
            enforce_invertibility=True,
        ).fit(disp=False, maxiter=100)
    if not result.mle_retvals.get("converged") or not np.isfinite(result.params).all():
        raise ValueError("El ajuste no convergió")
    return result


def validate_forecast(data):
    predictions = data["forecasts"]
    if data["lastObservedPeriod"] != data["trainedThrough"]:
        raise ValueError("El último dato observado no puede ser un pronóstico")
    expected = pd.date_range(
        pd.Timestamp(data["trainedThrough"]) + pd.offsets.MonthBegin(),
        periods=data["horizon"],
        freq="MS",
    )
    if len(predictions) != data["horizon"] or not 6 <= data["horizon"] <= 12:
        raise ValueError("Horizonte de pronóstico inválido")
    for row, period in zip(predictions, expected):
        if (
            row["date"] != period.strftime("%Y-%m-%d")
            or not np.isfinite(row["mean"])
            or row["mean"] < 0
        ):
            raise ValueError("Calendario o media inválidos")
        if row["lower95"] is None or row["upper95"] is None:
            if (
                data["hasIntervals"]
                or row["lower95"] is not None
                or row["upper95"] is not None
            ):
                raise ValueError("Intervalos incompletos")
        elif (
            not data["hasIntervals"]
            or not np.isfinite([row["lower95"], row["upper95"]]).all()
            or not row["lower95"] <= row["mean"] <= row["upper95"]
        ):
            raise ValueError("Intervalos no válidos")
    seen = set()
    observed_ids = {s["id"] for s in data["series"] if s.get("role") == "observed"}
    for row in data["observations"]:
        key = (row["date"], row["series"])
        if key in seen or (row["value"] is not None and not np.isfinite(row["value"])):
            raise ValueError("Observaciones duplicadas o no finitas")
        if (
            row["series"] in observed_ids
            and row["date"] > data["trainedThrough"]
            and row["value"] is not None
        ):
            raise ValueError("El histórico no se extiende con predicciones")
        seen.add(key)


def build_forecast(history, previous=None, now=None):
    now = now or datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    if (
        previous
        and previous.get("inputHash") == history["contentHash"]
        and previous.get("modelVersion") == MODEL_VERSION
    ):
        validate_forecast(previous)
        return {
            **previous,
            "status": "stale"
            if history["status"] == "stale"
            else "ready"
            if previous["hasIntervals"]
            else "partial",
            "lastAttemptAt": history["lastAttemptAt"],
            "lastSuccessfulFetchAt": history["lastSuccessfulFetchAt"],
        }
    records = [r for r in history["observations"] if r["series"] == "original"]
    index = pd.DatetimeIndex([r["date"] for r in records], freq="MS")
    values = pd.Series([r["value"] for r in records], index=index, dtype=float)
    if len(values) < 12 or values.isna().any() or not np.isfinite(values).all():
        raise ValueError("Historia mensual incompleta o insuficiente; no se imputa")
    model_name = "Estacional ingenuo (referencia)"
    chosen = None
    metrics = {}
    failures = []
    if len(values) >= 48:
        train, holdout = values.iloc[:-12], values.iloc[-12:]
        baseline = float(
            np.mean(np.abs(holdout.to_numpy() - train.iloc[-12:].to_numpy()))
        )
        metrics[model_name] = baseline
        best = baseline
        for order, seasonal in CANDIDATES:
            name = f"SARIMA{order}{seasonal}"
            try:
                fit = fit_model(train, order, seasonal)
                mean = fit.get_forecast(12).predicted_mean.to_numpy()
                mae = float(np.mean(np.abs(holdout.to_numpy() - mean)))
                if not np.isfinite(mae):
                    raise ValueError("Error de validación no finito")
                metrics[name] = mae
                if mae < best:
                    best, chosen, model_name = mae, (order, seasonal), name
            except (
                ValueError,
                RuntimeError,
                ImportError,
                np.linalg.LinAlgError,
            ) as error:
                failures.append(f"{name}: {type(error).__name__}")
    dates = pd.date_range(
        values.index[-1] + pd.offsets.MonthBegin(), periods=12, freq="MS"
    )
    means = values.iloc[-12:].to_numpy()
    bounds = None
    if chosen:
        try:
            fit = fit_model(values, *chosen)
            prediction = fit.get_forecast(12)
            means = prediction.predicted_mean.to_numpy()
            bounds = prediction.conf_int(alpha=0.05).to_numpy()
            if (
                not np.isfinite(means).all()
                or not np.isfinite(bounds).all()
                or (means < 0).any()
            ):
                raise ValueError("Pronóstico no admisible")
        except (ValueError, RuntimeError, ImportError, np.linalg.LinAlgError) as error:
            failures.append(f"Ajuste final: {type(error).__name__}")
            model_name, means, bounds = (
                "Estacional ingenuo (referencia)",
                values.iloc[-12:].to_numpy(),
                None,
            )
    forecasts = [
        {
            "date": period.strftime("%Y-%m-%d"),
            "mean": float(means[i]),
            "lower95": None if bounds is None else float(bounds[i, 0]),
            "upper95": None if bounds is None else float(bounds[i, 1]),
        }
        for i, period in enumerate(dates)
    ]
    series = [{**s, "role": "observed"} for s in history["series"]] + [
        {
            "id": "forecast",
            "label": "Pronóstico automático · elaboración propia",
            "role": "forecast",
        },
        {
            "id": "lower95",
            "label": "Límite inferior de predicción 95%",
            "role": "lower",
        },
        {
            "id": "upper95",
            "label": "Límite superior de predicción 95%",
            "role": "upper",
        },
    ]
    observed = {(r["date"], r["series"]): r["value"] for r in history["observations"]}
    prediction_lookup = {
        r["date"]: {
            "forecast": r["mean"],
            "lower95": r["lower95"],
            "upper95": r["upper95"],
        }
        for r in forecasts
    }
    cutoff = records[-1]["date"]
    prediction_lookup[cutoff] = {"forecast": records[-1]["value"]}
    all_dates = sorted(
        {r["date"] for r in history["observations"]} | set(prediction_lookup)
    )
    observations = [
        {
            "date": period,
            "series": s["id"],
            "value": observed.get(
                (period, s["id"]), prediction_lookup.get(period, {}).get(s["id"])
            ),
        }
        for period in all_dates
        for s in series
    ]
    method_note = (
        "Elaboración propia, no proyección INDEC. Serie original sin imputaciones. "
        "Selección entre tres SARIMA parsimoniosos y referencia estacional ingenua por MAE "
        "en los últimos 12 meses reservados; reestimación con toda la historia. "
        + (
            "Intervalos de predicción 95% del modelo, condicionados a sus supuestos."
            if bounds is not None
            else "Referencia estacional ingenua: se repite el último ciclo; no se calculan bandas 95%."
        )
    )
    result = {
        "id": "forecast-emae",
        "source": "INDEC (histórico) · elaboración estadística propia",
        "sourceUrl": history["sourceUrl"],
        "unit": history["unit"],
        "frequency": "monthly",
        "series": series,
        "observations": observations,
        "forecasts": forecasts,
        "status": "ready" if bounds is not None else "partial",
        "note": ""
        if bounds is not None
        else "Sin intervalos estadísticos: referencia estacional ingenua.",
        "isForecast": True,
        "hasIntervals": bounds is not None,
        "trainedThrough": cutoff,
        "forecastStart": forecasts[0]["date"],
        "generatedAt": now,
        "modelName": model_name,
        "modelVersion": MODEL_VERSION,
        "sourceSeries": "emae:original",
        "horizon": 12,
        "inputHash": history["contentHash"],
        "validationMAE": metrics,
        "modelFailures": failures,
        "methodNote": method_note,
        "lastObservedPeriod": cutoff,
        "lastObservedBySeries": {s["id"]: cutoff for s in series},
        "lastSuccessfulFetchAt": history["lastSuccessfulFetchAt"],
        "lastAttemptAt": history["lastAttemptAt"],
        "sourcePublishedAt": history["sourcePublishedAt"],
        "isAutoUpdated": True,
    }
    validate_forecast(result)
    return result


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    source = json.loads((root / "data/cache/emae.json").read_text(encoding="utf-8"))
    result = build_forecast(source)
    (root / "output/forecast-emae.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    print(
        result["modelName"],
        result["status"],
        result["trainedThrough"],
        result["validationMAE"],
    )
