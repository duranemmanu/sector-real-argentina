import type { Dataset } from '../data/types';
import { nextPeriod } from './forecast';

export function storedForecastAvailable(history: Dataset, forecast: Dataset): boolean {
  if (
    forecast.status !== 'ready' ||
    !forecast.isForecast ||
    !forecast.inputHash ||
    forecast.inputHash !== history.contentHash ||
    forecast.trainedThrough !== history.lastObservedPeriod ||
    !forecast.modelName ||
    /ingenuo|referencia/i.test(forecast.modelName)
  )
    return false;
  const future = forecast.observations.filter(
    (r) => r.series === 'forecast' && r.date > forecast.trainedThrough!,
  );
  if (
    future.length !== 12 ||
    future.some(
      (r, i) =>
        r.value === null ||
        !Number.isFinite(r.value) ||
        r.date !== nextPeriod(forecast.trainedThrough!, 'monthly', i + 1),
    )
  )
    return false;
  const values = future.map((r) => r.value!);
  return Math.max(...values) - Math.min(...values) > 1e-8;
}
