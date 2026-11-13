import { useState } from 'react';
import { Chart } from 'react-chartjs-2';
import type { Dataset, Panel } from '../data/types';
import { prepareView } from '../lib/calculations';
import { makeChartConfig } from '../lib/chartConfig';
import { exportPng } from '../lib/exportPng';
import { formatNumber, formatPeriod, formatTimestamp } from '../lib/format';
import { DataTable } from './DataTable';

export function StoredForecastPanel({
  panel,
  table,
  data,
  dark,
}: {
  panel: Panel;
  table?: Panel;
  data: Dataset;
  dark: boolean;
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const view = prepareView(panel, data, 'catalog');
  const forecastTable = prepareView(
    table ?? { ...panel, forecastOnly: true, countries: ['forecast', 'lower95', 'upper95'] },
    data,
    'catalog',
  );
  const config = makeChartConfig(view, 'line', false, dark);
  const mae = data.validationMAE?.[data.modelName ?? ''];
  const period = `${formatPeriod(view.firstPeriod, view.frequency)} – ${formatPeriod(view.lastPeriod, view.frequency)}`;
  const context = `${data.methodNote} Corte observado: ${formatPeriod(data.trainedThrough ?? null, data.frequency)}. Modelo: ${data.modelName}. Estimado: ${formatTimestamp(data.generatedAt ?? null)}.`;
  async function download() {
    setExporting(true);
    setError('');
    try {
      await exportPng(makeChartConfig(view, 'line', true), {
        id: panel.downloadId ?? panel.id,
        title: 'EMAE · pronóstico automático',
        unit: view.unit,
        period,
        source: data.source,
        sourceUrl: data.sourceUrl,
        note: context,
        lastPeriod: view.lastPeriod,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo exportar el pronóstico.');
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="forecast-panel stored-forecast">
      <div className="detail-toolbar">
        <span className="stored-horizon">12 meses desde el último dato observado</span>
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
        <aside className="forecast-summary" aria-label="Resumen del pronóstico EMAE">
          <h3>Modelo y validación</h3>
          <div>
            <span>Modelo seleccionado</span>
            <strong>{data.modelName}</strong>
          </div>
          <div>
            <span>Último observado</span>
            <strong>{formatPeriod(data.trainedThrough ?? null, data.frequency)}</strong>
          </div>
          <div>
            <span>Error absoluto medio · reserva de 12 meses</span>
            <strong>
              {mae === undefined ? '—' : formatNumber(mae)} <small>{view.unit}</small>
            </strong>
          </div>
          <div>
            <span>Observaciones originales</span>
            <strong>
              {
                data.observations.filter(
                  (row) =>
                    row.series === 'original' &&
                    row.value !== null &&
                    row.date <= (data.trainedThrough ?? ''),
                ).length
              }
            </strong>
          </div>
          <div>
            <span>Intervalos de predicción</span>
            <strong>95% · condicionados al modelo</strong>
          </div>
        </aside>
        <div className="forecast-plot">
          <p className="forecast-profile">
            <strong>EMAE original mensual.</strong> El modelo utiliza el nivel original, con
            estacionalidad de doce meses. La serie desestacionalizada se muestra como referencia; no se
            agrega una segunda estacionalidad ni se proyecta la tendencia-ciclo filtrada.
          </p>
          <div className="chart-container detail-chart">
            <Chart
              type={config.type}
              data={config.data}
              options={config.options}
              plugins={config.plugins}
              role="img"
              aria-label={`EMAE observado y pronóstico propio. ${data.modelName}. Corte ${formatPeriod(data.trainedThrough ?? null, data.frequency)}.`}
            />
          </div>
          <p className="forecast-note">
            Intervalos de predicción 95% condicionados al modelo · elaboración propia · estimado el{' '}
            {formatTimestamp(data.generatedAt ?? null)}.
          </p>
        </div>
      </div>
      <details className="forecast-method">
        <summary>Metodología y comparación de modelos del EMAE</summary>
        <p>{data.methodNote}</p>
        <p>
          Los órdenes del SARIMA combinan rezagos, diferenciación y medias móviles, con un componente
          estacional de doce meses. Sólo se admiten ajustes convergentes, finitos y con proyecciones no
          negativas. Tras elegir por MAE en la reserva de doce meses, se vuelve a ajustar con la historia
          completa. Esta validación es un único bloque y se usa para seleccionar el modelo; no es un test
          independiente ni garantiza precisión futura.
        </p>
        <p>
          El pronóstico se recalcula al llegar una observación o revisión oficial. Se comprueba que el
          hash de entrada y el corte coincidan con el histórico mostrado. Si el ajuste falla, queda
          desactualizado o sólo produce una referencia ingenua, la pestaña se oculta.
        </p>
        {data.validationMAE && (
          <div
            className="table-scroll"
            role="region"
            aria-label="Validación de modelos del EMAE"
            tabIndex={0}
          >
            <table>
              <caption>MAE sobre los mismos doce meses reservados; menor es mejor.</caption>
              <thead>
                <tr>
                  <th>Modelo</th>
                  <th>MAE · índice</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.validationMAE)
                  .sort((a, b) => a[1] - b[1])
                  .map(([name, value]) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>{formatNumber(value)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <a href="https://otexts.com/fpp3/arima.html" target="_blank" rel="noreferrer">
          Referencia · modelos ARIMA estacionales
        </a>
      </details>
      <DataTable
        view={forecastTable}
        id={table?.downloadId ?? table?.id ?? 'SR-06'}
        source={`${data.source}: ${data.sourceUrl}. ${context}`}
      />
    </div>
  );
}
