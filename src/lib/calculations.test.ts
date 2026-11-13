import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dataset, Panel } from '../data/types';
import { prepareView } from './calculations';

function fixture(
  rows: [string, string, number | null][],
  frequency: Dataset['frequency'] = 'monthly',
): Dataset {
  return {
    id: 'test',
    source: 'Fixture de prueba',
    sourceUrl: 'https://example.test',
    frequency,
    unit: 'unidades',
    series: [...new Set(rows.map((r) => r[1]))].map((id) => ({ id, label: id })),
    observations: rows.map(([date, series, value]) => ({ date, series, value })),
    status: 'ready',
    note: '',
    methodNote: '',
    lastObservedPeriod: rows.at(-1)?.[0] ?? null,
    lastSuccessfulFetchAt: null,
    lastAttemptAt: '2026-11-12T00:00:00Z',
    sourcePublishedAt: null,
    isAutoUpdated: false,
    dataFile: '',
    observationCount: rows.length,
  };
}
const panel: Panel = {
  id: 'SR-test',
  section: 'activity',
  title: 'Prueba',
  reason: '',
  sourceLinks: [],
};

test('los períodos informados omiten sólo filas vacías de las series visibles, sin interpolar', () => {
  const data = fixture([
    ['2026-01-01', 'a', 0],
    ['2026-01-01', 'b', null],
    ['2026-02-01', 'a', null],
    ['2026-02-01', 'b', null],
    ['2026-03-01', 'a', null],
    ['2026-03-01', 'b', 12],
  ]);
  const configured = { ...panel, observedPeriodsOnly: true };
  const view = prepareView(configured, data, 'full');
  assert.deepEqual(view.periods, ['2026-01-01', '2026-03-01']);
  assert.deepEqual(
    view.series.map((s) => s.values),
    [
      [0, null],
      [null, 12],
    ],
  );
  assert.deepEqual(prepareView(configured, data, 'full', ['a']).periods, ['2026-01-01']);
  assert.equal(prepareView(panel, data, 'full').periods.length, 3);
  assert.equal(data.observations.length, 6);
});

test('la ventana inicial puede evitar efectos de base sin alterar los porcentajes históricos', () => {
  const data = fixture([
    ['2018-01-01', 'a', 0.001],
    ['2019-01-01', 'a', 20],
    ['2020-01-01', 'a', 24],
    ['2021-01-01', 'a', 30],
  ]);
  const configured = { ...panel, transform: 'yoy' as const, start: '2020-01-01' };
  const initial = prepareView(configured, data, 'catalog');
  const complete = prepareView(configured, data, 'full');
  assert.equal(initial.firstPeriod, '2020-01-01');
  assert.ok(Math.abs(initial.series[0].values[0]! - 20) < 1e-10);
  assert.equal(complete.series[0].values[1], 1_999_900);
  assert.equal(complete.series[0].values.at(-1), initial.series[0].values.at(-1));
});

test('cortes comparativos conservan el trimestre rotulado al ampliar la historia', () => {
  const data = fixture(
    [
      ['2026-01-01', 'a', 10],
      ['2026-04-01', 'a', 20],
    ],
    'quarterly',
  );
  const configured = { ...panel, transform: 'latest' as const, end: '2026-01-01' };
  for (const range of ['catalog', 'full', 'recent'])
    assert.equal(prepareView(configured, data, range).lastPeriod, '2026-01-01');
});

test('totales anuales requieren doce meses; un año parcial permanece sin dato', () => {
  const rows: [string, string, number][] = Array.from({ length: 12 }, (_, i) => [
    `2019-${String(i + 1).padStart(2, '0')}-01`,
    'a',
    1,
  ]);
  rows.push(
    ...Array.from({ length: 11 }, (_, i): [string, string, number] => [
      `2020-${String(i + 1).padStart(2, '0')}-01`,
      'a',
      1,
    ]),
  );
  const view = prepareView({ ...panel, transform: 'annualSum' }, fixture(rows), 'full');
  assert.equal(view.frequency, 'annual');
  assert.deepEqual(view.series[0].values, [12, null]);
});

test('ranking semestral conserva dos cortes comparables y ordena por el último', () => {
  const data = fixture(
    [
      ['2025-01-01', 'a', 8],
      ['2025-01-01', 'b', 5],
      ['2025-07-01', 'a', null],
      ['2025-07-01', 'b', null],
      ['2026-01-01', 'a', 9],
      ['2026-01-01', 'b', 10],
    ],
    'semiannual',
  );
  const view = prepareView(
    { ...panel, comparePeriods: ['2025-01-01', '2026-01-01'], sortDescending: true },
    data,
    'catalog',
  );
  assert.deepEqual(view.labels, ['b', 'a']);
  assert.deepEqual(
    view.series.map((s) => s.label),
    ['S1 2025', 'S1 2026'],
  );
  assert.deepEqual(
    view.series.map((s) => s.values),
    [
      [5, 8],
      [10, 9],
    ],
  );
  assert.equal(view.lastPeriod, '2026-01-01');
});

test('la variación usa el mismo mes del año anterior y conserva gaps', () => {
  const data = fixture([
    ['2025-01-01', 'a', 100],
    ['2026-01-01', 'a', 80],
    ['2026-02-01', 'a', 50],
  ]);
  const view = prepareView({ ...panel, transform: 'yoy' }, data, 'full');
  assert.ok(Math.abs((view.series[0].values[1] ?? 0) + 20) < 1e-10);
  assert.equal(view.series[0].values[2], null);
});

test('participación y contribución sectorial usan denominadores distintos', () => {
  const data = fixture(
    [
      ['2025-01-01', 'gdp', 1000],
      ['2025-01-01', 'a', 200],
      ['2026-01-01', 'gdp', 1100],
      ['2026-01-01', 'a', 180],
    ],
    'quarterly',
  );
  const common = { ...panel, countries: ['a'], denominator: 'gdp' };
  assert.equal(
    prepareView({ ...common, transform: 'contributionLatest' }, data, 'full').series[0].values[0],
    -2,
  );
  assert.equal(
    prepareView({ ...common, transform: 'ratioLatest' }, data, 'full').series[0].values[0],
    (100 * 180) / 1100,
  );
});

test('base 2020 utiliza los cuatro trimestres, sin completar un año incompleto', () => {
  const rows: [string, string, number][] = [
    ['2020-01-01', 'a', 100],
    ['2020-04-01', 'a', 200],
    ['2020-07-01', 'a', 300],
    ['2020-10-01', 'a', 400],
    ['2021-01-01', 'a', 500],
  ];
  const configured: Panel = { ...panel, transform: 'base2020' };
  assert.equal(prepareView(configured, fixture(rows, 'quarterly'), 'full').series[0].values.at(-1), 200);
  assert.equal(
    prepareView(
      configured,
      fixture(
        rows.filter((r) => r[0] !== '2020-10-01'),
        'quarterly',
      ),
      'full',
    ).series[0].values.at(-1),
    null,
  );
});

test('un corte de composición inválido no retrocede al anterior ni convierte faltantes en cero', () => {
  const data = fixture([
    ['2026-06-01', 'a', 40],
    ['2026-06-01', 'b', 60],
    ['2026-06-01', 'total', 100],
    ['2026-07-01', 'a', 40],
    ['2026-07-01', 'b', null],
    ['2026-07-01', 'total', 100],
  ]);
  const view = prepareView(
    { ...panel, transform: 'shareLatest', countries: ['a', 'b'], denominator: 'total' },
    data,
    'full',
  );
  assert.deepEqual(view.periods, []);
});

test('las exportaciones netas negativas se conservan y el corte solicitado es explícito', () => {
  const data = fixture(
    [
      ['2026-01-01', 'net', -10],
      ['2026-01-01', 'gdp', 100],
      ['2026-04-01', 'net', 20],
      ['2026-04-01', 'gdp', 100],
    ],
    'quarterly',
  );
  const view = prepareView(
    { ...panel, countries: ['net'], denominator: 'gdp', transform: 'ratioLatest', end: '2026-01-01' },
    data,
    'catalog',
  );
  assert.equal(view.lastPeriod, '2026-01-01');
  assert.equal(view.series[0].values[0], -10);
});
