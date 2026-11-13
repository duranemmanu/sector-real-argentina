import type { DatasetMeta, Panel } from '../data/types';
import { formatPeriod, frequencyLabel } from '../lib/format';

export function SourceRegister({ datasets, views }: { datasets: DatasetMeta[]; views: Panel[] }) {
  const groups = new Map<string, DatasetMeta[]>();
  for (const dataset of datasets) {
    const key = dataset.source.trim().replace(/\s+/g, ' ');
    groups.set(key, [...(groups.get(key) ?? []), dataset]);
  }
  return (
    <section className="source-register">
      <h3>Fuentes del catálogo</h3>
      {[...groups.entries()].map(([source, records]) => {
        const primaryUrls = new Set(records.map((record) => record.sourceUrl));
        const links = new Map<string, string>();
        for (const record of records) {
          if (!links.has(record.sourceUrl))
            links.set(
              record.sourceUrl,
              primaryUrls.size === 1
                ? 'Publicación de origen'
                : (views.find((p) => p.dataset === record.id)?.shortTitle ?? record.source),
            );
          for (const link of record.supportingSources ?? [])
            if (!links.has(link.url)) links.set(link.url, link.label);
        }
        return (
          <details key={source} data-source-group={source}>
            <summary>{source}</summary>
            <div className="source-publications">
              {[...links.entries()].map(([url, label]) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  {label} ↗
                </a>
              ))}
            </div>
            <div className="source-datasets">
              {records.map((dataset) => {
                const title = views.find((p) => p.dataset === dataset.id)?.shortTitle ?? dataset.source;
                return (
                  <section key={dataset.id} data-source-dataset={dataset.id}>
                    <h4>{title}</h4>
                    <p>
                      {dataset.unit} · {frequencyLabel[dataset.frequency]} · Último dato:{' '}
                      {formatPeriod(dataset.lastObservedPeriod, dataset.frequency)}.
                    </p>
                    {dataset.note && <p className="warning">{dataset.note}</p>}
                    {dataset.methodNote && <p>{dataset.methodNote}</p>}
                  </section>
                );
              })}
            </div>
          </details>
        );
      })}
    </section>
  );
}
