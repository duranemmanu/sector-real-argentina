import type { Dataset, DatasetMeta, Panel, PreparedView } from '../data/types';
import { formatPeriod } from './format';

export function panelStatus(panel: Panel, meta?: DatasetMeta): DatasetMeta['status'] {
  if (!meta || meta.status === 'unavailable') return 'unavailable';
  if (meta.status === 'stale') return 'stale';
  const incomplete = meta.series.some(
    (s) =>
      (panel.countries ?? meta.series.map((i) => i.id)).includes(s.id) &&
      panel.targetEnd &&
      (meta.lastObservedBySeries?.[s.id] ?? '') < panel.targetEnd,
  );
  if (
    panel.partialNote ||
    meta.status === 'partial' ||
    incomplete ||
    (panel.targetEnd && (meta.lastObservedPeriod ?? '') < panel.targetEnd)
  )
    return 'partial';
  return 'ready';
}

export function prepareView(
  panel: Panel,
  data: Dataset,
  range: string,
  selected?: string[],
): PreparedView {
  const definition = data.series.filter((s) => (selected ?? panel.countries)?.includes(s.id) ?? true);
  const lookup = new Map(data.observations.map((r) => [`${r.date}|${r.series}`, r.value]));
  const allDates = [...new Set(data.observations.map((r) => r.date))].sort();
  const baseDates = allDates.filter((date) => date.startsWith('2020-'));
  const expectedBasePeriods = data.frequency === 'monthly' ? 12 : data.frequency === 'quarterly' ? 4 : 1;
  const baseValues = new Map(
    definition.map((s) => {
      const values = baseDates.map((date) => lookup.get(`${date}|${s.id}`));
      return [
        s.id,
        values.length === expectedBasePeriods && values.every((v) => v !== null && v !== undefined)
          ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0) / values.length
          : null,
      ];
    }),
  );
  let invalidCompositions = 0;
  let transformed = allDates.map((period) => {
    const previous = `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;
    const total = panel.denominator ? lookup.get(`${period}|${panel.denominator}`) : undefined;
    const components = definition.map((s) => lookup.get(`${period}|${s.id}`) ?? null);
    const validShare =
      total !== undefined &&
      total !== null &&
      total > 0 &&
      components.every((v) => v !== null && v >= 0) &&
      Math.abs(components.reduce<number>((sum, v) => sum + (v ?? 0), 0) - total) <=
        Math.max(1, Math.abs(total) * 0.0001);
    const isShare = panel.transform?.startsWith('share');
    if (isShare && !validShare) invalidCompositions += 1;
    return {
      period,
      values: definition.map((s) => {
        const value = lookup.get(`${period}|${s.id}`) ?? null;
        if (value === null) return null;
        if (isShare) return validShare ? (100 * value) / (total as number) : null;
        if (panel.transform?.startsWith('ratio')) {
          return total === null || total === undefined || total === 0 ? null : (100 * value) / total;
        }
        if (panel.transform === 'contributionLatest') {
          const base = lookup.get(`${previous}|${s.id}`);
          const previousGdp = lookup.get(`${previous}|gdp`);
          return base === null || base === undefined || !previousGdp
            ? null
            : (100 * (value - base)) / previousGdp;
        }
        if (panel.transform === 'base2020') {
          const base = baseValues.get(s.id);
          return base === null || base === undefined || base === 0 ? null : (100 * value) / base;
        }
        if (panel.transform?.startsWith('yoy')) {
          const base = lookup.get(`${previous}|${s.id}`);
          return base === undefined || base === null || base === 0 ? null : (value / base - 1) * 100;
        }
        return value * (panel.scale ?? 1);
      }),
    };
  });
  if (panel.transform === 'annualSum') {
    const expected = data.frequency === 'monthly' ? 12 : data.frequency === 'quarterly' ? 4 : 2;
    transformed = [...new Set(allDates.map((date) => date.slice(0, 4)))].map((year) => {
      const periods = transformed.filter((row) => row.period.startsWith(year + '-'));
      return {
        period: year + '-01-01',
        values: definition.map((_, index) =>
          periods.length === expected && periods.every((row) => row.values[index] !== null)
            ? periods.reduce((sum, row) => sum + (row.values[index] ?? 0), 0)
            : null,
        ),
      };
    });
  }
  const frequency = panel.transform === 'annualSum' ? 'annual' : data.frequency;
  const fixedWindow =
    panel.transform === 'annualSum' ||
    panel.transform === 'latest' ||
    (panel.transform?.endsWith('Latest') ?? false) ||
    !!panel.comparePeriods;
  const start =
    panel.transform === 'annualSum'
      ? (panel.start ?? '')
      : panel.forecastOnly
        ? (data.forecastStart ?? '')
        : range === 'full'
          ? ''
          : range === 'recent'
            ? '2023-01-01'
            : (panel.start ?? '');
  const end = range === 'catalog' || fixedWindow ? (panel.end ?? '9999-12-31') : '9999-12-31';
  let rows = transformed.filter((r) => r.period >= start && r.period <= end);
  if (data.frequency === 'semiannual' || panel.observedPeriodsOnly)
    rows = rows.filter((r) => r.values.some((value) => value !== null));
  const categorical =
    !!panel.comparePeriods ||
    panel.transform === 'latest' ||
    (panel.transform?.endsWith('Latest') ?? false);
  if (panel.comparePeriods) rows = transformed.filter((r) => panel.comparePeriods?.includes(r.period));
  if (categorical && !panel.comparePeriods) {
    // El último corte debe ser válido; no se retrocede silenciosamente a otra composición.
    const latest = rows.at(-1);
    rows = latest && latest.values.some((v) => v !== null) ? [latest] : [];
    if (panel.chartType === 'doughnut' && rows.length > 0) {
      const values = rows[0].values;
      const complete = values.every((v) => v !== null && v >= 0);
      const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
      if (!complete || total <= 0 || (data.unit.includes('%') && Math.abs(total - 100) > 0.100001))
        rows = [];
    }
  }
  const unit =
    panel.unitOverride ??
    (panel.transform?.startsWith('yoy')
      ? '% de variación interanual'
      : panel.transform?.startsWith('share')
        ? '% del total de ventas a precios corrientes'
        : panel.transform?.startsWith('ratio')
          ? '% del PIB'
          : panel.transform === 'contributionLatest'
            ? 'puntos porcentuales de variación interanual del PIB'
            : panel.transform === 'base2020'
              ? 'índice, promedio 2020=100'
              : data.unit);
  const categoryOrder = definition.map((_, i) => i);
  if (categorical && panel.sortDescending)
    categoryOrder.sort(
      (a, b) => (rows.at(-1)?.values[b] ?? -Infinity) - (rows.at(-1)?.values[a] ?? -Infinity),
    );
  return {
    title: panel.shortTitle ?? panel.title,
    unit,
    labels: categorical
      ? categoryOrder.map((i) => definition[i].label)
      : rows.map((r) => formatPeriod(r.period, frequency)),
    series: categorical
      ? panel.comparePeriods
        ? rows.map((r) => ({
            id: r.period,
            label: formatPeriod(r.period, data.frequency),
            values: categoryOrder.map((i) => r.values[i]),
          }))
        : [{ id: 'value', label: unit, values: categoryOrder.map((i) => rows[0]?.values[i] ?? null) }]
      : definition.map((s, index) => ({ ...s, values: rows.map((r) => r.values[index]) })),
    periods: rows.map((r) => r.period),
    firstPeriod: rows[0]?.period ?? '',
    lastPeriod: rows.at(-1)?.period ?? '',
    frequency,
    categorical,
    invalidCompositions,
    forecastCutoffIndex: data.isForecast
      ? rows.findIndex((r) => r.period === data.trainedThrough)
      : undefined,
  };
}
