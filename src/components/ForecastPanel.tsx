import { useState } from 'react';
import { Chart } from 'react-chartjs-2';
import type { DatasetMeta, Panel, PreparedView } from '../data/types';
import type { ForecastOption } from '../lib/forecast';
import { makeChartConfig } from '../lib/chartConfig';
import { exportPng } from '../lib/exportPng';
import { formatNumber, formatPeriod } from '../lib/format';
import { DataTable } from './DataTable';

export function ForecastPanel({
  view,
  meta,
  panel,
  dark,
  options,
}: {
  view: PreparedView;
  meta: DatasetMeta;
  panel: Panel;
  dark: boolean;
  options: ForecastOption[];
}) {
  const initial =
    options.find(
      (o) =>
        o.seriesId === options[0]?.seriesId &&
        o.horizon === (view.frequency === 'monthly' ? 12 : view.frequency === 'quarterly' ? 4 : 2),
    ) ?? options[0];
  const [choice, setChoice] = useState({ seriesId: initial?.seriesId, horizon: initial?.horizon });
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const selected =
    options.find((o) => o.seriesId === choice.seriesId && o.horizon === choice.horizon) ?? initial;
  if (!selected) return null;
  const { result, horizon, seriesId } = selected;
  const series = [...new Map(options.map((o) => [o.seriesId, o.seriesLabel])).entries()];
  const horizons = options.filter((o) => o.seriesId === seriesId).map((o) => o.horizon);
  const config = makeChartConfig(result.view, 'line', false, dark);
  const unit =
    view.frequency === 'monthly'
      ? 'meses'
      : view.frequency === 'quarterly'
        ? 'trimestres'
        : view.frequency === 'semiannual'
          ? 'semestres'
          : 'años';
  const method = `${result.modelName}. Perfil: ${result.profile.name}. Muestra de ajuste: ${formatPeriod(result.trainingStart, view.frequency)}–${formatPeriod(result.trainedThrough, view.frequency)} (${result.trainingCount} observaciones). ${result.parameters}. Validación: tres bloques de ${horizon} períodos; MAE=${formatNumber(result.validationMae)} ${view.unit}; referencia ${result.baselineName}, MAE=${formatNumber(result.baselineMae)}. Mejora=${formatNumber(result.skill * 100)}%. Estimación propia sin intervalos de predicción.`;
  const context = [method, meta.note, panel.partialNote, panel.methodNote, meta.methodNote]
    .filter(Boolean)
    .join(' ');
  async function download() {
    setExporting(true);
    setError('');
    try {
      await exportPng(makeChartConfig(result.view, 'line', true), {
        id: `${panel.downloadId ?? panel.id}-forecast`,
        title: result.view.title,
        unit: view.unit,
        period: `${formatPeriod(result.view.firstPeriod, view.frequency)} – ${formatPeriod(result.view.lastPeriod, view.frequency)}`,
        source: `${meta.source} · pronóstico propio`,
        sourceUrl: [meta.sourceUrl, ...(meta.supportingSources ?? []).map((s) => s.url)].join(' '),
        note: context,
        lastPeriod: result.view.lastPeriod,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo exportar el pronóstico.');
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="forecast-panel">
      <div className="detail-toolbar">
        <label>
          Serie
          <select
            value={seriesId}
            onChange={(event) => {
              const matching =
                options.find((o) => o.seriesId === event.target.value && o.horizon === horizon) ??
                options.find((o) => o.seriesId === event.target.value)!;
              setChoice({ seriesId: matching.seriesId, horizon: matching.horizon });
            }}
          >
            {series.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Horizonte
          <select
            value={horizon}
            onChange={(event) => setChoice({ seriesId, horizon: Number(event.target.value) })}
          >
            {horizons.map((h) => (
              <option key={h} value={h}>
                {h} {h === 1 ? 'año' : unit}
              </option>
            ))}
          </select>
        </label>
        <button className="primary-button" disabled={exporting} onClick={download}>
          {exporting ? 'Preparando PNG…' : 'Descargar PNG'}
        </button>
      </div>
      {error && (
        <p role="alert" className="panel-message warning">
          {error}
        </p>
      )}
      <div className="forecast-workspace">
        <aside className="forecast-summary" aria-label="Resumen del pronóstico">
          <h3>Modelo y validación</h3>
          <div>
            <span>Modelo seleccionado</span>
            <strong>{result.modelName}</strong>
          </div>
          <div>
            <span>Último observado</span>
            <strong>{formatPeriod(result.trainedThrough, view.frequency)}</strong>
          </div>
          <div>
            <span>Error absoluto medio · validación</span>
            <strong>
              {formatNumber(result.validationMae)} <small>{view.unit}</small>
            </strong>
          </div>
          <div>
            <span>Observaciones del ajuste</span>
            <strong>{result.trainingCount}</strong>
          </div>
          <div>
            <span>Mejora del MAE frente a la referencia</span>
            <strong>{formatNumber(result.skill * 100)}%</strong>
          </div>
        </aside>
        <div className="forecast-plot">
          <p className="forecast-profile">
            <strong>{result.profile.name}.</strong> {result.profile.rationale}
          </p>
          <div className="chart-container detail-chart">
            <Chart
              type={config.type}
              data={config.data}
              options={config.options}
              plugins={config.plugins}
              role="img"
              aria-label={`${result.view.title}. Observado hasta ${formatPeriod(result.trainedThrough, view.frequency)}. Pronóstico propio.`}
            />
          </div>
          <p className="forecast-note">
            Ajuste con {result.trainingCount} de {result.availableCount} observaciones disponibles ·{' '}
            {formatPeriod(result.trainingStart, view.frequency)}–
            {formatPeriod(result.trainedThrough, view.frequency)} · sin intervalos de predicción.
          </p>
        </div>
      </div>
      <details className="forecast-method">
        <summary>Selección del modelo y validación histórica</summary>
        <p>
          Para esta serie y este horizonte se evaluaron tres bloques consecutivos de {horizon} {unit},
          sin superposición. En cada corte sólo se usó información anterior al período pronosticado. El
          modelo y la ventana de ajuste se eligieron por su menor MAE:{' '}
          {formatNumber(result.validationMae)} {view.unit}, frente a {formatNumber(result.baselineMae)}{' '}
          de la referencia «{result.baselineName}»; mejora del {formatNumber(result.skill * 100)}%.
        </p>
        <p>
          Se ofrece el resultado cuando mejora al menos 5% la referencia y obtiene un error menor en dos
          de los tres cortes. Es un criterio de selección, no una prueba de significación estadística ni
          un test independiente del modelo elegido. No garantiza precisión futura. Se excluyen series sin
          historia regular y curvas cuya variación no supera el 1% del desvío histórico.
        </p>
        <p>
          Parámetros del ajuste final: {result.parameters}.{' '}
          {result.profile.models.includes('logTrend') ||
          result.profile.models.includes('logSeasonalTrend')
            ? 'Las regresiones logarítmicas se prueban sólo con valores positivos y devuelven una mediana en la unidad original.'
            : ''}{' '}
          En Holt, los coeficientes de suavizado y amortiguación se seleccionan dentro de una rejilla
          acotada usando sólo el entrenamiento de cada corte.
        </p>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Validaciones del pronóstico"
        >
          <table>
            <caption>Cada origen es el último período conocido al ajustar.</caption>
            <thead>
              <tr>
                <th>Origen</th>
                <th>Pronóstico hasta</th>
                <th>MAE modelo</th>
                <th>MAE referencia</th>
              </tr>
            </thead>
            <tbody>
              {result.folds.map((fold) => (
                <tr key={fold.origin}>
                  <th scope="row">{formatPeriod(fold.origin, view.frequency)}</th>
                  <td>{formatPeriod(fold.through, view.frequency)}</td>
                  <td>{formatNumber(fold.mae)}</td>
                  <td>{formatNumber(fold.baselineMae)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Comparación de modelos">
          <table>
            <caption>
              Modelos admisibles evaluados para esta serie. Ventana: máximo de observaciones de
              entrenamiento.
            </caption>
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Ventana</th>
                <th>MAE</th>
              </tr>
            </thead>
            <tbody>
              {result.scores.map((score) => (
                <tr key={`${score.model}-${score.window}`}>
                  <th scope="row">
                    {score.name}
                    {score.baseline ? ' · referencia' : ''}
                  </th>
                  <td>{score.window}</td>
                  <td>{formatNumber(score.mae)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <a
          href="https://otexts.com/fpp3/toolbox.html#time-series-cross-validation"
          target="_blank"
          rel="noreferrer"
        >
          Referencia · validación temporal
        </a>
        {' · '}
        <a href="https://otexts.com/fpp3/exponential-smoothing.html" target="_blank" rel="noreferrer">
          Suavizado exponencial
        </a>
      </details>
      <DataTable
        view={result.table}
        id={`${panel.downloadId ?? panel.id}-forecast`}
        source={`${meta.source}: ${[meta.sourceUrl, ...(meta.supportingSources ?? []).map((s) => s.url)].join(' ')}. ${context}`}
      />
    </div>
  );
}
