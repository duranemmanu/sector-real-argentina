import type { DatasetMeta } from '../data/types';

const numeric = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
export const formatNumber = (value: number | null): string =>
  value === null ? '—' : numeric.format(value);

export function formatPeriod(value: string | null, frequency: DatasetMeta['frequency']): string {
  if (!value) return 'Sin observaciones';
  const [year, month] = value.split('-');
  if (frequency === 'annual' || frequency === 'seasonal') return year;
  if (frequency === 'semiannual') return `S${Number(month) <= 6 ? 1 : 2} ${year}`;
  if (frequency === 'quarterly') return `T${Math.floor((Number(month) - 1) / 3) + 1} ${year}`;
  return `${month}/${year}`;
}

export function formatTimestamp(value: string | null): string {
  if (!value) return 'Sin consulta exitosa';
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(value));
}

export const frequencyLabel = {
  annual: 'Anual',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  seasonal: 'Temporada de invierno',
  monthly: 'Mensual',
};

export function safeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '');
}
