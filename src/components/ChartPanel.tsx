import { useEffect, useId, useMemo, useState } from 'react';
import { Chart } from 'react-chartjs-2';
import type { Dataset, DatasetMeta, Panel, PanelChart } from '../data/types';
import { loadDataset } from '../data/load';
import { panelStatus, prepareView } from '../lib/calculations';
import { makeChartConfig } from '../lib/chartConfig';
import { exportPng } from '../lib/exportPng';
import { formatPeriod, frequencyLabel } from '../lib/format';
import { filterView, historyRange } from '../lib/viewFilters';
import type { ViewWindow } from '../lib/viewFilters';
import { DataTable } from './DataTable';
import { SourceNote } from './SourceNote';
import { PeriodControls } from './PeriodControls';
import { ForecastPanel } from './ForecastPanel';
import { StoredForecastPanel } from './StoredForecastPanel';
import { availableForecasts } from '../lib/forecast';
import { storedForecastAvailable } from '../lib/storedForecast';

export const STATUS_LABELS = {
  ready: 'Datos disponibles',
  partial: 'Cobertura parcial',
  stale: 'Consulta fallida · respaldo',
  unavailable: 'Datos no disponibles',
};
type DetailTab = 'chart' | 'data' | 'forecast' | 'source';

function tableSource(meta: DatasetMeta, panel: Panel): string {
  return [
    `${meta.source}: ${meta.sourceUrl}`,
    ...(meta.supportingSources ?? []).map((source) => `${source.label}: ${source.url}`),
    meta.note,
    panel.partialNote,
    panel.methodNote,
    meta.methodNote,
  ]
    .filter(Boolean)
    .join('. ');
}

export function ChartPanel({
  panel,
  meta,
  window,
  dark,
  onOpen,
  related = [],
  metadata,
  storedForecast,
}: {
  panel: Panel;
  meta?: DatasetMeta;
  window: ViewWindow;
  dark: boolean;
  onOpen?: () => void;
  related?: Panel[];
  metadata?: Map<string, DatasetMeta>;
  storedForecast?: Panel;
}) {
  const detail = !onOpen;
  const [data, setData] = useState<Dataset | null>(null);
  const [storedData, setStoredData] = useState<Dataset | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(panel.countries);
  const [localWindow, setLocalWindow] = useState(window);
  const [kind, setKind] = useState<PanelChart>(panel.chartType ?? 'line');
  const [tab, setTab] = useState<DetailTab>(panel.chartType === 'table' ? 'data' : 'chart');
  const [tableId, setTableId] = useState(panel.downloadId ?? panel.id);
  const [exporting, setExporting] = useState(false);
  const tabId = useId();
  const actualWindow = detail ? localWindow : window;
  const storedMeta = metadata?.get(storedForecast?.dataset ?? '');
  useEffect(() => {
    let active = true;
    if (detail && storedMeta)
      loadDataset(storedMeta)
        .then((result) => {
          if (active) setStoredData(result);
        })
        .catch(() => {
          if (active) setStoredData(null);
        });
    return () => {
      active = false;
    };
  }, [detail, storedMeta]);
  useEffect(() => {
    let active = true;
    if (!meta || meta.status === 'unavailable') return;
    loadDataset(meta)
      .then((result) => {
        if (active) {
          setData(result);
          setError('');
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'No se pudo leer esta serie.');
      });
    return () => {
      active = false;
    };
  }, [meta, attempt]);
  const view = useMemo(
    () =>
      data
        ? filterView(
            prepareView(panel, data, historyRange(actualWindow), selected),
            panel.transform === 'annualSum' ? { ...actualWindow, preset: 'catalog' } : actualWindow,
          )
        : null,
    [data, panel, actualWindow, selected],
  );
  const fullView = useMemo(() => (data ? prepareView(panel, data, 'full') : null), [data, panel]);
  const forecastOptions = useMemo(
    () =>
      detail &&
      fullView &&
      !panel.forecastDisabled &&
      !storedForecast &&
      !['table', 'doughnut', 'stackedBar'].includes(panel.chartType ?? '')
        ? availableForecasts(fullView)
        : [],
    [detail, fullView, storedForecast, panel.chartType, panel.forecastDisabled],
  );
  const storedAvailable = !!data && !!storedData && storedForecastAvailable(data, storedData);
  const hasForecast =
    !panel.forecastDisabled && (storedForecast ? storedAvailable : forecastOptions.length > 0);
  const activeTab =
    tab === 'forecast' && !hasForecast ? (panel.chartType === 'table' ? 'data' : 'chart') : tab;
  const config = useMemo(
    () => (view ? makeChartConfig(view, kind, false, dark) : null),
    [view, kind, dark],
  );
  const status = error && !data ? 'unavailable' : panelStatus(panel, meta);
  const hasData =
    view && view.periods.length > 0 && view.series.some((s) => s.values.some((v) => v !== null));
  const period = view
    ? view.firstPeriod === view.lastPeriod
      ? formatPeriod(view.lastPeriod, view.frequency)
      : `${formatPeriod(view.firstPeriod, view.frequency)} – ${formatPeriod(view.lastPeriod, view.frequency)}`
    : '';
  const tableOptions = [panel, ...related];
  const tablePanel = tableOptions.find((p) => (p.downloadId ?? p.id) === tableId) ?? panel;
  const selectable =
    data?.series.filter(
      (s) =>
        (!s.role || s.role === 'observed') &&
        ((panel.selectableSeries ?? panel.countries)?.includes(s.id) ?? true),
    ) ?? [];
  async function downloadPng() {
    if (!view || !meta) return;
    setExporting(true);
    setError('');
    try {
      await exportPng(makeChartConfig(view, kind, true), {
        id: panel.downloadId ?? panel.id,
        title: view.title,
        unit: view.unit,
        period,
        source: meta.source,
        sourceUrl: [meta.sourceUrl, ...(meta.supportingSources ?? []).map((s) => s.url)].join(' '),
        lastPeriod: view.lastPeriod,
        note: [
          meta.note,
          panel.partialNote,
          panel.methodNote,
          meta.isForecast
            ? `Corte observado: ${formatPeriod(meta.trainedThrough ?? null, meta.frequency)}. Modelo: ${meta.modelName}.`
            : '',
          meta.methodNote,
        ]
          .filter(Boolean)
          .join(' '),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo exportar el PNG.');
    } finally {
      setExporting(false);
    }
  }
  const content =
    !meta || status === 'unavailable' ? (
      <div className="panel-message">
        <strong>Datos no disponibles</strong>
        <p role={error ? 'alert' : undefined}>{error || meta?.note || panel.reason}</p>
        {error && (
          <button
            onClick={() => {
              setError('');
              setAttempt(attempt + 1);
            }}
          >
            Volver a intentar
          </button>
        )}
      </div>
    ) : !data ? (
      <p role="status" className="panel-message">
        Cargando serie…
      </p>
    ) : !hasData ? (
      <p className="panel-message">
        {selected?.length === 0
          ? 'Seleccioná al menos una serie.'
          : 'No hay observaciones en el período seleccionado.'}
      </p>
    ) : config && kind !== 'table' ? (
      <div
        className={`chart-container ${detail ? 'detail-chart' : ''} ${kind === 'horizontalBar' ? 'chart-tall' : ''}`}
      >
        <Chart
          type={config.type}
          data={config.data}
          options={config.options}
          plugins={config.plugins}
          role="img"
          aria-label={`${view.title}. ${view.unit}. ${period}.`}
        />
      </div>
    ) : null;
  if (!detail)
    return (
      <article
        className="chart-panel preview-panel"
        data-indicator-id={panel.downloadId ?? panel.id}
        aria-label={panel.shortTitle ?? panel.title}
        onClick={onOpen}
      >
        <header className="panel-heading">
          <h3>
            <button
              aria-haspopup="dialog"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
            >
              {panel.shortTitle ?? panel.title}
              <span className="expand-icon" aria-hidden="true">
                ↗
              </span>
            </button>
          </h3>
          <p>
            {view?.unit ?? meta?.unit} {view && <span>· {period}</span>}
          </p>
        </header>
        {content}
        <div className="preview-footer">
          <span>
            {meta ? frequencyLabel[meta.frequency] : ''}
            {status !== 'ready' && <span className="warning"> · {STATUS_LABELS[status]}</span>}
          </span>
          <button
            className="open-indicator"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            aria-haspopup="dialog"
          >
            Ver indicador <span aria-hidden="true">↗</span>
          </button>
        </div>
      </article>
    );
  return (
    <section className="indicator-detail" data-indicator-id={panel.downloadId ?? panel.id}>
      <div className="detail-meta">
        <span>{view?.unit ?? meta?.unit}</span>
        <span>{meta ? frequencyLabel[meta.frequency] : ''}</span>
        <span>{period}</span>
        {status !== 'ready' && <span className="warning">{STATUS_LABELS[status]}</span>}
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Detalle del indicador">
        {(
          [
            ...(panel.chartType === 'table' ? [] : [['chart', 'Gráfico']]),
            ['data', 'Datos'],
            ...(hasForecast ? [['forecast', 'Pronóstico']] : []),
            ['source', 'Fuentes y notas'],
          ] as [DetailTab, string][]
        ).map(([id, label], i, tabs) => (
          <button
            key={id}
            id={`${tabId}-${id}`}
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`${tabId}-panel`}
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              setTab(tabs[next][0]);
              document.getElementById(`${tabId}-${tabs[next][0]}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${activeTab}`}>
        {(activeTab === 'chart' || activeTab === 'data') && (
          <>
            <div className="detail-toolbar">
              {!view?.categorical && panel.transform !== 'annualSum' && (
                <PeriodControls value={localWindow} onChange={setLocalWindow} />
              )}
              {activeTab === 'chart' &&
                !view?.categorical &&
                !meta?.isForecast &&
                ['line', 'bar'].includes(panel.chartType ?? '') && (
                  <label>
                    Gráfico
                    <select value={kind} onChange={(event) => setKind(event.target.value as PanelChart)}>
                      <option value="line">Líneas</option>
                      <option value="bar">Barras</option>
                    </select>
                  </label>
                )}
              {activeTab === 'chart' && hasData && (
                <button className="primary-button" onClick={downloadPng} disabled={exporting}>
                  {exporting ? 'Preparando PNG…' : 'Descargar PNG'}
                </button>
              )}
            </div>
            {activeTab === 'chart' &&
              !['doughnut', 'stackedBar'].includes(kind) &&
              selectable.length > 1 && (
                <details className="series-selector">
                  <summary>
                    Series del gráfico{' '}
                    <span>
                      {selectable.filter((s) => !selected || selected.includes(s.id)).length}{' '}
                      seleccionadas
                    </span>
                  </summary>
                  <fieldset className="country-filter">
                    <legend className="sr-only">Series visibles</legend>
                    {selectable.map((s) => (
                      <label key={s.id}>
                        <input
                          type="checkbox"
                          checked={(selected ?? selectable.map((s) => s.id)).includes(s.id)}
                          onChange={(event) => {
                            const current = selected ?? selectable.map((s) => s.id);
                            setSelected(
                              event.target.checked
                                ? [...current, s.id]
                                : current.filter((id) => id !== s.id),
                            );
                          }}
                        />
                        {s.label}
                      </label>
                    ))}
                  </fieldset>
                </details>
              )}
            {error && data && (
              <p role="alert" className="panel-message warning">
                {error}
              </p>
            )}
            {activeTab === 'chart' ? (
              <>
                {content}
                {(panel.partialNote || panel.methodNote || meta?.note || meta?.isForecast) && (
                  <p className="chart-note">
                    {[
                      panel.partialNote,
                      panel.methodNote,
                      meta?.note,
                      meta?.isForecast
                        ? `Pronóstico propio · ${meta.modelName}. Corte observado: ${formatPeriod(meta.trainedThrough ?? null, meta.frequency)}.`
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </p>
                )}
              </>
            ) : (
              <>
                {related.length > 0 && (
                  <label className="table-picker">
                    Cuadro
                    <select value={tableId} onChange={(event) => setTableId(event.target.value)}>
                      {tableOptions.map((p) => (
                        <option key={p.downloadId ?? p.id} value={p.downloadId ?? p.id}>
                          {p === panel && panel.chartType !== 'table'
                            ? 'Datos del gráfico'
                            : (p.shortTitle ?? p.title)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {tablePanel === panel ? (
                  hasData && view && meta ? (
                    <DataTable
                      key={`${tableId}-${selected?.join(',')}`}
                      view={view}
                      id={panel.downloadId ?? panel.id}
                      source={tableSource(meta, panel)}
                    />
                  ) : (
                    content
                  )
                ) : (
                  <RelatedTable
                    key={tableId}
                    panel={tablePanel}
                    meta={metadata?.get(tablePanel.dataset ?? '')}
                    window={localWindow}
                  />
                )}
              </>
            )}
          </>
        )}
        {activeTab === 'forecast' &&
          (storedAvailable && storedForecast && storedData ? (
            <StoredForecastPanel
              panel={storedForecast}
              table={related.find((p) => p.id === 'SR-06')}
              data={storedData}
              dark={dark}
            />
          ) : fullView && meta ? (
            <ForecastPanel
              key={panel.downloadId ?? panel.id}
              view={fullView}
              meta={meta}
              panel={panel}
              dark={dark}
              options={forecastOptions}
            />
          ) : (
            content
          ))}
        {activeTab === 'source' && (
          <div className="detail-sources">
            {meta && <SourceNote data={meta} />}
            {[panel.partialNote, panel.methodNote, meta?.methodNote].filter(Boolean).map((note, i) => (
              <p key={i}>{note}</p>
            ))}
            {panel.targetEnd && view && view.lastPeriod < panel.targetEnd && (
              <p className="warning">
                Período de referencia hasta {formatPeriod(panel.targetEnd, view.frequency)}. La fuente
                llega hasta {formatPeriod(view.lastPeriod, view.frequency)}.
              </p>
            )}
            {panel.sourceLinks.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function RelatedTable({
  panel,
  meta,
  window,
}: {
  panel: Panel;
  meta?: DatasetMeta;
  window: ViewWindow;
}) {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (meta)
      loadDataset(meta)
        .then((result) => {
          if (active) setData(result);
        })
        .catch((reason: unknown) => {
          if (active)
            setError(reason instanceof Error ? reason.message : 'No se pudo cargar el cuadro.');
        });
    return () => {
      active = false;
    };
  }, [meta]);
  if (error)
    return (
      <p role="alert" className="panel-message">
        {error}
      </p>
    );
  if (!data || !meta)
    return (
      <p role="status" className="panel-message">
        Cargando cuadro…
      </p>
    );
  const view = filterView(
    prepareView(panel, data, historyRange(window)),
    panel.transform === 'annualSum' ? { ...window, preset: 'catalog' } : window,
  );
  return (
    <>
      <DataTable view={view} id={panel.downloadId ?? panel.id} source={tableSource(meta, panel)} />
      <div className="related-source">
        <SourceNote data={meta} />
        {panel.methodNote && <p>{panel.methodNote}</p>}
        {panel.partialNote && <p>{panel.partialNote}</p>}
      </div>
    </>
  );
}
