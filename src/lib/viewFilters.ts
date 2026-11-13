import type { PreparedView } from '../data/types';

export interface ViewWindow {
  preset: string;
  from: string;
  to: string;
}

export const DEFAULT_WINDOW: ViewWindow = { preset: 'catalog', from: '', to: '' };

export function filterView(view: PreparedView, window: ViewWindow): PreparedView {
  // Los cuadros de cortes fijos y las composiciones conservan el universo que comparan.
  if (view.categorical) return view;
  let from = '';
  let to = '9999-12-31';
  if (window.preset === 'custom') {
    from = window.from ? `${window.from}-01-01` : '';
    to = window.to ? `${window.to}-12-31` : to;
  } else if (/^\d+$/.test(window.preset) && view.lastPeriod) {
    from = `${Number(view.lastPeriod.slice(0, 4)) - Number(window.preset) + 1}-01-01`;
  } else return view;
  const indices = view.periods.flatMap((period, i) => (period >= from && period <= to ? [i] : []));
  return {
    ...view,
    periods: indices.map((i) => view.periods[i]),
    labels: indices.map((i) => view.labels[i]),
    series: view.series.map((series) => ({ ...series, values: indices.map((i) => series.values[i]) })),
    firstPeriod: view.periods[indices[0]] ?? '',
    lastPeriod: view.periods[indices.at(-1) ?? -1] ?? '',
    forecastCutoffIndex:
      view.forecastCutoffIndex === undefined ? undefined : indices.indexOf(view.forecastCutoffIndex),
  };
}

export function historyRange(window: ViewWindow): string {
  return window.preset === 'catalog' ? 'catalog' : 'full';
}
