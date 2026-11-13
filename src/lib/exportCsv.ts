import type { PreparedView } from '../data/types';
import { safeName } from './format';

export function tableRows(view: PreparedView): (string | number | null)[][] {
  return view.labels.map((label, index) => [
    view.categorical ? label : view.periods[index],
    ...view.series.map((s) => s.values[index]),
  ]);
}

export function exportCsv(view: PreparedView, panelId: string, source: string): void {
  const headers = [
    view.categorical ? 'Categoría' : 'Período',
    ...view.series.map((s) => s.label),
    'Unidad',
    'Fuente',
  ];
  const rows = [headers, ...tableRows(view).map((row) => [...row, view.unit, source])];
  const escape = (value: string | number | null): string => {
    if (value === null) return '';
    if (typeof value === 'number') return String(value).replace('.', ',');
    const safe = /^[=+@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = '\uFEFF' + rows.map((row) => row.map(escape).join(';')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `sector-real-${safeName(panelId)}-${view.lastPeriod}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
