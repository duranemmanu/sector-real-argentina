import type { DatasetMeta } from '../data/types';
import { formatPeriod, formatTimestamp, frequencyLabel } from '../lib/format';

export function SourceNote({ data }: { data: DatasetMeta }) {
  const oldQuery =
    data.isAutoUpdated &&
    data.lastSuccessfulFetchAt &&
    Date.now() - new Date(data.lastSuccessfulFetchAt).getTime() > 72 * 60 * 60 * 1000;
  return (
    <div className="source-note">
      <p>
        <strong>Fuente:</strong>{' '}
        <a href={data.sourceUrl} target="_blank" rel="noreferrer">
          {data.source}
        </a>
      </p>
      <p>
        {frequencyLabel[data.frequency]} ·{' '}
        {data.isForecast ? 'Histórico utilizado hasta' : 'Último dato'}:{' '}
        <strong>{data.periodLabel ?? formatPeriod(data.lastObservedPeriod, data.frequency)}</strong>
        {' · '}
        {data.isAutoUpdated ? 'Consulta exitosa' : 'Revisión documentada'}:{' '}
        {formatTimestamp(data.lastSuccessfulFetchAt)} (Argentina).
      </p>
      {data.isForecast && (
        <p>
          <strong>Pronóstico estadístico automático · elaboración propia.</strong> Modelo:{' '}
          {data.modelName}. Estimado: {formatTimestamp(data.generatedAt ?? null)}.
        </p>
      )}
      {data.status === 'stale' && (
        <p className="warning">
          La consulta más reciente falló. Se conserva el último snapshot verificado. Último intento:{' '}
          {formatTimestamp(data.lastAttemptAt)}.
        </p>
      )}
      {oldQuery && <p className="warning">Pasaron más de 72 horas desde la última consulta exitosa.</p>}
      {data.note && <p className="warning">{data.note}</p>}
      {data.sourcePublishedAt && (
        <p>
          Publicación de la fuente:{' '}
          {new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeZone: 'UTC' }).format(
            new Date(data.sourcePublishedAt),
          )}
          .
        </p>
      )}
      {!data.isAutoUpdated && (
        <p>Requiere revisión documentada de las publicaciones; no se actualiza automáticamente.</p>
      )}
      {data.supportingSources && (
        <ul>
          {data.supportingSources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
