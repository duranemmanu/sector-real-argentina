import type { PreparedView } from '../data/types';
import { formatPeriod } from './format';

export type ForecastModel =
  | 'naive'
  | 'seasonal'
  | 'mean'
  | 'trend'
  | 'seasonalTrend'
  | 'logTrend'
  | 'logSeasonalTrend'
  | 'ar1'
  | 'holt';
const NAMES: Record<ForecastModel, string> = {
  naive: 'Último valor',
  seasonal: 'Ingenuo estacional',
  mean: 'Media histórica',
  trend: 'Regresión con tendencia',
  seasonalTrend: 'Regresión con tendencia y estacionalidad',
  logTrend: 'Regresión logarítmica con tendencia',
  logSeasonalTrend: 'Regresión logarítmica con estacionalidad',
  ar1: 'Autorregresión AR(1)',
  holt: 'Holt con tendencia amortiguada',
};
const CYCLES = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1, seasonal: 1 };
const BASELINES: ForecastModel[] = ['naive', 'seasonal', 'mean'];
const PARAMETER_FORMAT = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 4 });
export interface ForecastProfile {
  name: string;
  rationale: string;
  seasonal: boolean;
  nonNegative: boolean;
  models: ForecastModel[];
  windows: number[];
}
export interface ValidationFold {
  origin: string;
  through: string;
  mae: number;
  baselineMae: number;
}
export interface ModelScore {
  model: ForecastModel;
  name: string;
  window: number;
  mae: number;
  baseline: boolean;
}
export type ForecastResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      model: ForecastModel;
      modelName: string;
      profile: ForecastProfile;
      parameters: string;
      validationMae: number;
      validationPeriods: number;
      baselineName: string;
      baselineMae: number;
      skill: number;
      folds: ValidationFold[];
      scores: ModelScore[];
      trainingCount: number;
      availableCount: number;
      trainingStart: string;
      trainedThrough: string;
      view: PreparedView;
      table: PreparedView;
    };
export interface ForecastOption {
  seriesId: string;
  seriesLabel: string;
  horizon: number;
  result: Extract<ForecastResult, { ok: true }>;
}

export function nextPeriod(period: string, frequency: PreparedView['frequency'], steps = 1): string {
  return new Date(
    Date.UTC(
      Number(period.slice(0, 4)),
      Number(period.slice(5, 7)) - 1 + (12 / CYCLES[frequency]) * steps,
      1,
    ),
  )
    .toISOString()
    .slice(0, 10);
}
export function forecastHorizons(frequency: PreparedView['frequency']): number[] {
  return frequency === 'monthly'
    ? [6, 12, 24]
    : frequency === 'quarterly'
      ? [4, 8]
      : frequency === 'semiannual'
        ? [2, 4]
        : [1, 2, 3];
}

export function forecastProfile(view: PreparedView, seriesId: string): ForecastProfile {
  const series = view.series.find((s) => s.id === seriesId);
  const rate = /variación|crecimiento|puntos porcentuales/i.test(view.unit);
  const share = /% del PIB|participación|aporte.*PIB/i.test(view.unit);
  const adjusted = /desestacional|ajustad|adjusted/i.test(`${series?.id} ${series?.label}`);
  const signed = /exportaciones netas/i.test(series?.label ?? '');
  const cycle = CYCLES[view.frequency];
  const seasonal = cycle > 1 && !rate && !adjusted;
  const windows = cycle === 1 ? [12, Infinity] : cycle === 4 ? [32, 64] : rate ? [36, 60] : [60, 120];
  if (rate)
    return {
      name: 'Tasas y variaciones',
      rationale:
        'Se modela la variación publicada, que puede ser negativa. Se comparan persistencia autorregresiva y tendencia local amortiguada contra el último valor, la media y el último ciclo. No se impone una tendencia lineal indefinida a una tasa.',
      seasonal: false,
      nonNegative: false,
      models: ['ar1', 'holt'],
      windows,
    };
  if (adjusted)
    return {
      name: 'Nivel desestacionalizado',
      rationale:
        'La fuente ya retiró la estacionalidad: no se vuelven a agregar efectos mensuales o trimestrales. Se comparan tendencia, evolución proporcional, persistencia y suavizado de tendencia amortiguada.',
      seasonal: false,
      nonNegative: !signed,
      models: ['ar1', 'trend', 'logTrend', 'holt'],
      windows,
    };
  if (share)
    return {
      name: 'Proporción del PIB',
      rationale:
        'Se pronostica el porcentaje publicado, no los niveles de sus componentes por separado. Se comparan tendencia, persistencia y suavizado amortiguado; se rechazan porcentajes negativos. No se interpreta la evolución como una relación causal con el PIB.',
      seasonal: false,
      nonNegative: true,
      models: ['ar1', 'trend', 'holt'],
      windows,
    };
  return {
    name: seasonal
      ? `Nivel ${view.frequency === 'monthly' ? 'mensual' : 'trimestral'} original`
      : 'Nivel anual',
    rationale: seasonal
      ? 'Se evalúan efectos del calendario de la fuente, tendencia en niveles y evolución proporcional. La opción logarítmica requiere valores positivos y estima una mediana. Se comparan ventanas recientes para reducir la influencia de cambios antiguos de régimen.'
      : 'La frecuencia anual no tiene estacionalidad dentro del año. Se comparan tendencia en niveles, evolución proporcional, persistencia y suavizado amortiguado, conservando la unidad original.',
    seasonal,
    nonNegative: !signed,
    models: seasonal
      ? ['trend', 'seasonalTrend', 'logTrend', 'logSeasonalTrend', 'holt']
      : ['trend', 'logTrend', 'ar1', 'holt'],
    windows,
  };
}

function regression(
  values: number[],
  horizon: number,
  groups: number,
): { values: number[]; slope: number } {
  const counts = Array<number>(groups).fill(0);
  const meanT = Array<number>(groups).fill(0);
  const meanY = Array<number>(groups).fill(0);
  values.forEach((value, t) => {
    const g = t % groups;
    counts[g]++;
    meanT[g] += t;
    meanY[g] += value;
  });
  for (let g = 0; g < groups; g++) {
    meanT[g] /= counts[g];
    meanY[g] /= counts[g];
  }
  // MCO con interceptos por estación y pendiente común; centrado dentro de cada grupo.
  let numerator = 0;
  let denominator = 0;
  values.forEach((value, t) => {
    const g = t % groups;
    numerator += (t - meanT[g]) * (value - meanY[g]);
    denominator += (t - meanT[g]) ** 2;
  });
  const slope = numerator / denominator;
  return {
    slope,
    values: Array.from({ length: horizon }, (_, i) => {
      const t = values.length + i;
      return meanY[t % groups] + slope * (t - meanT[t % groups]);
    }),
  };
}

export function fitForecastModel(
  values: number[],
  horizon: number,
  cycle: number,
  model: ForecastModel,
): { values: number[]; parameters: string } | null {
  if (model === 'naive') return { values: Array(horizon).fill(values.at(-1)), parameters: '' };
  if (model === 'mean')
    return {
      values: Array(horizon).fill(values.reduce((a, b) => a + b, 0) / values.length),
      parameters: '',
    };
  if (model === 'seasonal')
    return {
      values: Array.from({ length: horizon }, (_, i) => values[values.length - cycle + (i % cycle)]),
      parameters: '',
    };
  if (model === 'ar1') {
    const x = values.slice(0, -1);
    const y = values.slice(1);
    const mx = x.reduce((a, b) => a + b, 0) / x.length;
    const my = y.reduce((a, b) => a + b, 0) / y.length;
    const denominator = x.reduce((sum, value) => sum + (value - mx) ** 2, 0);
    const phi = x.reduce((sum, value, i) => sum + (value - mx) * (y[i] - my), 0) / denominator;
    if (!Number.isFinite(phi) || Math.abs(phi) >= 1) return null;
    const intercept = my - phi * mx;
    let last = values.at(-1)!;
    return {
      values: Array.from({ length: horizon }, () => {
        last = intercept + phi * last;
        return last;
      }),
      parameters: `φ=${parameterNumber(phi)}; intercepto=${parameterNumber(intercept)}`,
    };
  }
  if (model === 'holt') {
    let best: {
      loss: number;
      level: number;
      trend: number;
      phi: number;
      alpha: number;
      beta: number;
    } | null = null;
    // Rejilla acotada ajustada exclusivamente con el tramo de entrenamiento de cada corte.
    for (const alpha of [0.2, 0.5, 0.8])
      for (const beta of [0.05, 0.2])
        for (const phi of [0.8, 0.95]) {
          let level = values[0];
          let trend = values[1] - values[0];
          let loss = 0;
          for (let t = 1; t < values.length; t++) {
            const prediction = level + phi * trend;
            if (t >= Math.max(2, cycle)) loss += (values[t] - prediction) ** 2;
            const nextLevel = alpha * values[t] + (1 - alpha) * prediction;
            trend = beta * (nextLevel - level) + (1 - beta) * phi * trend;
            level = nextLevel;
          }
          if (Number.isFinite(loss) && (!best || loss < best.loss))
            best = { loss, level, trend, phi, alpha, beta };
        }
    if (!best) return null;
    const { level, trend, phi, alpha, beta } = best;
    return {
      values: Array.from(
        { length: horizon },
        (_, i) => level + (trend * phi * (1 - phi ** (i + 1))) / (1 - phi),
      ),
      parameters: `α=${parameterNumber(alpha)}; β=${parameterNumber(beta)}; φ=${parameterNumber(phi)}`,
    };
  }
  const logarithmic = model === 'logTrend' || model === 'logSeasonalTrend';
  if (logarithmic && values.some((v) => v <= 0)) return null;
  const predictions = regression(
    logarithmic ? values.map(Math.log) : values,
    horizon,
    model === 'seasonalTrend' || model === 'logSeasonalTrend' ? cycle : 1,
  );
  return {
    values: logarithmic ? predictions.values.map(Math.exp) : predictions.values,
    parameters: logarithmic
      ? `β de tendencia=${parameterNumber(predictions.slope)} por período en logaritmos; mediana en la unidad original`
      : `β de tendencia=${parameterNumber(predictions.slope)} por período; ${model === 'seasonalTrend' ? `${cycle - 1} efectos de calendario` : 'sin efectos estacionales'}`,
  };
}

function parameterNumber(value: number): string {
  return PARAMETER_FORMAT.format(value);
}

function meanAbsoluteError(actual: number[], predicted: number[]): number {
  return actual.reduce((sum, value, i) => sum + Math.abs(value - predicted[i]), 0) / actual.length;
}

export function forecastSeries(view: PreparedView, seriesId: string, horizon: number): ForecastResult {
  const fail = (reason: string): ForecastResult => ({ ok: false, reason });
  if (view.categorical) return fail('Comparación de categorías o cortes fijos.');
  if (/% del total/i.test(view.unit))
    return fail('No se proyectan partes de una composición de forma independiente.');
  const series = view.series.find((s) => s.id === seriesId);
  if (!series || (series.role && series.role !== 'observed'))
    return fail('La serie no contiene observaciones originales.');
  if (/tendencia|trend/i.test(`${series.id} ${series.label}`))
    return fail(
      'No se proyecta una tendencia-ciclo filtrada como si fuera una observación independiente.',
    );
  if (!forecastHorizons(view.frequency).includes(horizon)) return fail('Horizonte no disponible.');
  const cycle = CYCLES[view.frequency];
  const profile = forecastProfile(view, seriesId);
  const first = series.values.findIndex((v) => v !== null);
  const last = series.values.reduce<number>((index, value, i) => (value !== null ? i : index), -1);
  const values = series.values.slice(first, last + 1);
  const dates = view.periods.slice(first, last + 1);
  const minimumTrain = cycle === 1 ? 8 : cycle * 3;
  // Tres bloques sin superposición, del mismo horizonte que la proyección ofrecida.
  if (first < 0 || values.length < minimumTrain + horizon * 3)
    return fail('Historia insuficiente para tres validaciones del horizonte solicitado.');
  if (values.some((v) => v === null || !Number.isFinite(v)))
    return fail('Historia con datos faltantes o no finitos; no se imputa.');
  if (dates.some((date, i) => i > 0 && date !== nextPeriod(dates[i - 1], view.frequency)))
    return fail('La historia no tiene un calendario regular.');
  const observed = values as number[];
  const valid = (p: number[]) => p.every((v) => Number.isFinite(v) && (!profile.nonNegative || v >= 0));
  const origins = [3, 2, 1].map((fold) => observed.length - horizon * fold);
  const windows = [...new Set(profile.windows.map((window) => Math.min(window, observed.length)))];
  const definitions = [
    ...(['naive', ...(cycle > 1 ? ['seasonal'] : []), 'mean'] as ForecastModel[]).map((model) => ({
      model,
      window: Math.max(...windows),
    })),
    ...profile.models.flatMap((model) => windows.map((window) => ({ model, window }))),
  ];
  const fitted = definitions
    .flatMap(({ model, window }) => {
      const final = fitForecastModel(observed.slice(-window), horizon, cycle, model);
      if (!final || !valid(final.values)) return [];
      const errors: number[] = [];
      for (const origin of origins) {
        const train = observed.slice(Math.max(0, origin - window), origin);
        const fit = fitForecastModel(train, horizon, cycle, model);
        if (!fit || !valid(fit.values)) return [];
        errors.push(meanAbsoluteError(observed.slice(origin, origin + horizon), fit.values));
      }
      const mae = errors.reduce((a, b) => a + b, 0) / errors.length;
      return [{ model, window, errors, mae, final }];
    })
    .sort((a, b) =>
      Math.abs(a.mae - b.mae) < 1e-9
        ? definitions.findIndex((d) => d.model === a.model) -
          definitions.findIndex((d) => d.model === b.model)
        : a.mae - b.mae,
    );
  const baseline = fitted.find((f) => BASELINES.includes(f.model));
  const best = fitted.find((f) => !BASELINES.includes(f.model));
  if (!baseline || !best || baseline.mae < 1e-10)
    return fail('No hay mejora verificable frente a una referencia simple.');
  const skill = 1 - best.mae / baseline.mae;
  if (skill < 0.05 || best.errors.filter((e, i) => e < baseline.errors[i]).length < 2)
    return fail(
      'El modelo no mejora al menos 5% el MAE de referencia en tres cortes, con mejora en dos de ellos.',
    );
  const future = best.final.values;
  const average = observed.reduce((a, b) => a + b, 0) / observed.length;
  const deviation = Math.sqrt(
    observed.reduce((sum, v) => sum + (v - average) ** 2, 0) / observed.length,
  );
  const shape = horizon === 1 ? [observed.at(-1)!, ...future] : future;
  if (Math.max(...shape) - Math.min(...shape) <= Math.max(1e-8, deviation * 0.01))
    return fail('El pronóstico es plano a la escala de la serie.');
  const trainedThrough = dates.at(-1)!;
  const futureDates = Array.from({ length: horizon }, (_, i) =>
    nextPeriod(trainedThrough, view.frequency, i + 1),
  );
  const keep = Math.min(dates.length, Math.max(8, cycle * 3));
  const history = observed.slice(-keep);
  const periods = [...dates.slice(-keep), ...futureDates];
  const table: PreparedView = {
    title: `${view.title} · pronóstico de ${series.label}`,
    unit: view.unit,
    frequency: view.frequency,
    categorical: false,
    invalidCompositions: 0,
    periods: futureDates,
    labels: futureDates.map((d) => formatPeriod(d, view.frequency)),
    firstPeriod: futureDates[0],
    lastPeriod: futureDates.at(-1)!,
    series: [
      { id: 'forecast', label: `${series.label} · pronóstico propio`, role: 'forecast', values: future },
    ],
  };
  return {
    ok: true,
    model: best.model,
    modelName: NAMES[best.model],
    profile,
    parameters: best.final.parameters,
    validationMae: best.mae,
    validationPeriods: horizon * 3,
    baselineName: NAMES[baseline.model],
    baselineMae: baseline.mae,
    skill,
    folds: origins.map((origin, i) => ({
      origin: dates[origin - 1],
      through: dates[origin + horizon - 1],
      mae: best.errors[i],
      baselineMae: baseline.errors[i],
    })),
    scores: fitted.map((f) => ({
      model: f.model,
      name: NAMES[f.model],
      window: f.window,
      mae: f.mae,
      baseline: BASELINES.includes(f.model),
    })),
    trainingCount: Math.min(best.window, observed.length),
    availableCount: observed.length,
    trainingStart: dates[Math.max(0, dates.length - best.window)],
    trainedThrough,
    table,
    view: {
      ...table,
      periods,
      labels: periods.map((d) => formatPeriod(d, view.frequency)),
      firstPeriod: periods[0],
      forecastCutoffIndex: keep - 1,
      series: [
        {
          id: 'observed',
          label: `${series.label} · observado`,
          role: 'observed',
          values: [...history, ...Array<null>(horizon).fill(null)],
        },
        {
          ...table.series[0],
          values: [...Array<null>(keep - 1).fill(null), history.at(-1)!, ...future],
        },
      ],
    },
  };
}

export function availableForecasts(view: PreparedView): ForecastOption[] {
  if (view.categorical) return [];
  return view.series.flatMap((series) =>
    forecastHorizons(view.frequency).flatMap((horizon) => {
      const result = forecastSeries(view, series.id, horizon);
      return result.ok ? [{ seriesId: series.id, seriesLabel: series.label, horizon, result }] : [];
    }),
  );
}
