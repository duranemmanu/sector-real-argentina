import type { Panel } from '../data/types';

export function catalogViews(catalog: Panel[]): Panel[] {
  return catalog.flatMap((panel) =>
    (panel.views ?? [{}]).map((view, i) => ({
      ...panel,
      ...view,
      downloadId: panel.views ? `${panel.id}-${i + 1}` : panel.id,
    })),
  );
}

const TABLE_PARENTS: Record<string, string> = {
  'SR-02': 'SR-01',
  'SR-04': 'SR-03',
  'SR-06': 'SR-47',
  'SR-30': 'SR-31',
  'SR-33': 'SR-32',
  'SR-34': 'SR-32',
};

export function relatedTables(panel: Panel, all: Panel[]): Panel[] {
  return all.filter(
    (candidate) =>
      candidate.chartType === 'table' &&
      candidate.downloadId !== panel.downloadId &&
      (candidate.id === panel.id || TABLE_PARENTS[candidate.id] === panel.id),
  );
}

export function standaloneTables(all: Panel[]): Panel[] {
  const chartIds = new Set(all.filter((p) => p.chartType !== 'table').map((p) => p.id));
  return all.filter((p) => p.chartType === 'table' && !chartIds.has(TABLE_PARENTS[p.id] ?? p.id));
}

export function viewKind(panel: Panel): string {
  if (panel.chartType === 'table') return 'table';
  if (panel.chartType === 'doughnut' || panel.chartType === 'stackedBar') return 'composition';
  return panel.chartType === 'horizontalBar' ||
    panel.comparePeriods ||
    panel.transform?.endsWith('Latest') ||
    panel.transform === 'latest'
    ? 'comparison'
    : 'series';
}

export function overviewCharts(all: Panel[]): Panel[] {
  return all.filter((panel) => panel.chartType !== 'table' && panel.id !== 'SR-05');
}

export function linkedForecast(panel: Panel, all: Panel[]): Panel | undefined {
  return panel.id === 'SR-47' ? all.find((p) => p.id === 'SR-05') : undefined;
}
