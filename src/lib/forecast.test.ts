import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Dataset, PreparedView } from '../data/types';
import {
  availableForecasts,
  fitForecastModel,
  forecastProfile,
  forecastSeries,
  nextPeriod,
} from './forecast';
import { storedForecastAvailable } from './storedForecast';
import { filterView } from './viewFilters';

function fixture(
  values: (number | null)[],
  frequency: PreparedView['frequency'] = 'monthly',
  start = '2018-04-01',
): PreparedView {
  const periods = values.map((_, i) => nextPeriod(start, frequency, i));
  return {
    title: 'Serie de prueba',
    unit: 'unidades',
    frequency,
    periods,
    labels: periods,
    firstPeriod: periods[0],
    lastPeriod: periods.at(-1)!,
    categorical: false,
    invalidCompositions: 0,
    series: [{ id: 'a', label: 'Serie A', values }],
  };
}

test('MCO recupera tendencia y estacionalidad con corte fuera de enero y tres validaciones', () => {
  const value = (t: number) => 100 + 2 * t + 18 * Math.sin(((t % 12) * Math.PI) / 6);
  const view = fixture(Array.from({ length: 94 }, (_, i) => value(i)));
  const result = forecastSeries(view, 'a', 12);
  assert.ok(result.ok);
  assert.equal(result.model, 'seasonalTrend');
  assert.ok(result.validationMae < 1e-8);
  assert.equal(result.folds.length, 3);
  assert.equal(result.validationPeriods, 36);
  result.table.series[0].values.forEach((v, i) => assert.ok(Math.abs(v! - value(94 + i)) < 1e-8));
  assert.equal(result.table.firstPeriod, nextPeriod(view.lastPeriod, 'monthly'));
  assert.equal(result.view.forecastCutoffIndex, 35);
  assert.equal(result.view.series[0].values.at(-1), null);
  assert.equal(result.view.series[1].values[35], value(93));
});

test('regresión anual exacta y rechazo de curvas planas o sin mejora sobre el ingenuo estacional', () => {
  const trend = forecastSeries(
    fixture(
      Array.from({ length: 20 }, (_, i) => 3 + 2 * i),
      'annual',
      '2006-01-01',
    ),
    'a',
    3,
  );
  assert.ok(trend.ok);
  assert.equal(trend.model, 'trend');
  assert.deepEqual(trend.table.series[0].values, [43, 45, 47]);
  assert.equal(forecastSeries(fixture(Array(96).fill(100)), 'a', 12).ok, false);
  const seasonal = fixture(
    Array.from({ length: 48 }, (_, i) => [8, 10, 12, 20][i % 4]),
    'quarterly',
    '2010-01-01',
  );
  assert.equal(forecastSeries(seasonal, 'a', 4).ok, false);
  assert.deepEqual(availableForecasts(seasonal), []);
});

test('cada corte evalúa sólo un modelo ajustado con el prefijo conocido, sin filtración del futuro', () => {
  const values = Array.from(
    { length: 120 },
    (_, t) => 100 + 0.6 * t + 12 * Math.sin(((t % 12) * Math.PI) / 6) + 0.5 * Math.sin(t * 1.3),
  );
  const view = fixture(values);
  const result = forecastSeries(view, 'a', 12);
  assert.ok(result.ok);
  result.folds.forEach((fold, i) => {
    const origin = values.length - 12 * (3 - i);
    assert.equal(fold.origin, view.periods[origin - 1]);
    assert.equal(fold.through, view.periods[origin + 11]);
    const train = values.slice(Math.max(0, origin - result.trainingCount), origin);
    const fit = fitForecastModel(train, 12, 12, result.model)!;
    const expected =
      values
        .slice(origin, origin + 12)
        .reduce((sum, value, j) => sum + Math.abs(value - fit.values[j]), 0) / 12;
    assert.ok(Math.abs(expected - fold.mae) < 1e-10);
  });
  assert.ok(result.skill >= 0.05);
  assert.ok(result.folds.filter((f) => f.mae < f.baselineMae).length >= 2);
});

test('AR(1) recupera persistencia estable y rechaza una raíz explosiva', () => {
  const values = Array.from({ length: 30 }, (_, t) => 10 + 3 * 0.8 ** t);
  const fit = fitForecastModel(values, 6, 1, 'ar1');
  assert.ok(fit);
  fit.values.forEach((v, i) => assert.ok(Math.abs(v - (10 + 3 * 0.8 ** (30 + i))) < 1e-9));
  assert.equal(
    fitForecastModel(
      Array.from({ length: 20 }, (_, i) => 1.1 ** i),
      3,
      1,
      'ar1',
    ),
    null,
  );
});

test('regresión logarítmica preserva el crecimiento proporcional y requiere valores positivos', () => {
  const fit = fitForecastModel(
    Array.from({ length: 20 }, (_, i) => 100 * 1.05 ** i),
    3,
    1,
    'logTrend',
  );
  assert.ok(fit);
  fit.values.forEach((v, i) => assert.ok(Math.abs(v - 100 * 1.05 ** (20 + i)) < 1e-8));
  assert.equal(fitForecastModel([1, 2, 0, 4], 3, 1, 'logTrend'), null);
});

test('las tasas y las series desestacionalizadas usan familias acordes y no se proyecta la tendencia filtrada', () => {
  const view = fixture(Array.from({ length: 120 }, (_, i) => 100 + i));
  const rate = forecastProfile({ ...view, unit: '% de variación interanual' }, 'a');
  assert.equal(rate.seasonal, false);
  assert.equal(rate.nonNegative, false);
  assert.deepEqual(rate.models, ['ar1', 'holt']);
  const adjusted = { ...view, series: [{ ...view.series[0], label: 'Desestacionalizada' }] };
  assert.equal(forecastProfile(adjusted, 'a').seasonal, false);
  assert.ok(!forecastProfile(adjusted, 'a').models.includes('seasonalTrend'));
  assert.deepEqual(
    availableForecasts({ ...view, series: [{ ...view.series[0], label: 'Tendencia-ciclo' }] }),
    [],
  );
});

test('rechaza historia corta, datos faltantes, calendarios irregulares y horizontes sin tres bloques', () => {
  assert.equal(forecastSeries(fixture(Array(48).fill(10)), 'a', 12).ok, false);
  const missing = fixture(Array(96).fill(10));
  missing.series[0].values[12] = null;
  assert.equal(forecastSeries(missing, 'a', 12).ok, false);
  const gap = fixture(Array(96).fill(10));
  gap.periods[12] = gap.periods[11];
  assert.equal(forecastSeries(gap, 'a', 12).ok, false);
  const invalid = fixture(Array(96).fill(10));
  invalid.series[0].values[12] = Infinity;
  assert.equal(forecastSeries(invalid, 'a', 12).ok, false);
});

test('la muestra de cada serie termina en su propio último observado y no completa extremos nulos', () => {
  const values = Array.from(
    { length: 94 },
    (_, i) => 100 + 2 * i + 15 * Math.sin(((i % 12) * Math.PI) / 6),
  );
  const view = fixture([null, ...values, null, null]);
  const result = forecastSeries(view, 'a', 6);
  assert.ok(result.ok);
  assert.equal(result.availableCount, 94);
  assert.equal(result.trainedThrough, view.periods[94]);
  assert.equal(result.table.firstPeriod, view.periods[95]);
});

test('no pronostica categorías, composiciones ni estimaciones previas y descarta horizontes inválidos', () => {
  const view = fixture(Array.from({ length: 96 }, (_, i) => 100 + i));
  assert.equal(forecastSeries({ ...view, categorical: true }, 'a', 12).ok, false);
  assert.equal(forecastSeries({ ...view, unit: '% del total de ventas' }, 'a', 12).ok, false);
  assert.equal(
    forecastSeries({ ...view, series: [{ ...view.series[0], role: 'forecast' }] }, 'a', 12).ok,
    false,
  );
  for (const horizon of [0, 25, 1.5, NaN]) assert.equal(forecastSeries(view, 'a', horizon).ok, false);
});

test('descarta modelos con proyección negativa sin recortar valores a cero', () => {
  const result = forecastSeries(
    fixture(
      Array.from({ length: 20 }, (_, i) => 21 - i),
      'annual',
    ),
    'a',
    3,
  );
  assert.ok(result.ok);
  assert.notEqual(result.model, 'trend');
  assert.ok(result.table.series[0].values.every((v) => v !== null && v > 0));
});

test('todas las opciones ofrecidas superan referencia y controles; nunca exponen un resultado fallido', () => {
  const view = fixture(
    Array.from({ length: 96 }, (_, i) => 100 + 2 * i + 15 * Math.sin(((i % 12) * Math.PI) / 6)),
  );
  const options = availableForecasts(view);
  assert.ok(options.length > 0);
  for (const option of options) {
    assert.ok(option.result.skill >= 0.05);
    assert.ok(option.result.folds.length === 3);
    assert.ok(!['naive', 'seasonal', 'mean'].includes(option.result.model));
    assert.equal(option.result.table.periods.length, option.horizon);
  }
});

test('el EMAE integrado exige mismo hash y corte; no ofrece respaldo desactualizado, ingenuo o plano', () => {
  const base: Dataset = {
    id: 'emae',
    source: 'Fixture',
    sourceUrl: 'https://example.test',
    unit: 'índice',
    frequency: 'monthly',
    series: [{ id: 'original', label: 'Original' }],
    observations: [],
    status: 'ready',
    note: '',
    methodNote: '',
    lastObservedPeriod: '2026-08-01',
    lastSuccessfulFetchAt: null,
    lastAttemptAt: '2026-11-12T00:00:00Z',
    sourcePublishedAt: null,
    isAutoUpdated: true,
    dataFile: '',
    observationCount: 0,
    contentHash: 'hash-de-prueba',
  };
  const forecast: Dataset = {
    ...base,
    id: 'forecast-emae',
    isForecast: true,
    modelName: 'SARIMA(0,1,1)(0,1,1,12)',
    inputHash: base.contentHash,
    trainedThrough: base.lastObservedPeriod!,
    observations: Array.from({ length: 12 }, (_, i) => ({
      date: nextPeriod(base.lastObservedPeriod!, 'monthly', i + 1),
      series: 'forecast',
      value: 100 + i,
    })),
  };
  assert.equal(storedForecastAvailable(base, forecast), true);
  assert.equal(storedForecastAvailable({ ...base, contentHash: 'revision-nueva' }, forecast), false);
  assert.equal(storedForecastAvailable(base, { ...forecast, status: 'stale' }), false);
  assert.equal(
    storedForecastAvailable(base, { ...forecast, modelName: 'Estacional ingenuo (referencia)' }),
    false,
  );
  assert.equal(
    storedForecastAvailable(base, {
      ...forecast,
      observations: forecast.observations.map((r) => ({ ...r, value: 100 })),
    }),
    false,
  );
});

test('los filtros conservan nulos, fechas y frontera del pronóstico sin alterar el original', () => {
  const original = fixture([1, null, 3, 4, 5], 'annual', '2020-01-01');
  original.forecastCutoffIndex = 2;
  const filtered = filterView(original, { preset: 'custom', from: '2021', to: '2023' });
  assert.deepEqual(filtered.series[0].values, [null, 3, 4]);
  assert.equal(filtered.forecastCutoffIndex, 1);
  assert.equal(original.series[0].values.length, 5);
  assert.deepEqual(filterView(original, { preset: '3', from: '', to: '' }).series[0].values, [3, 4, 5]);
  assert.equal(
    filterView({ ...original, categorical: true }, { preset: 'custom', from: '2022', to: '2022' })
      .periods.length,
    5,
  );
});
