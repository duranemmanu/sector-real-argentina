import type { Dataset, DatasetMeta, Manifest, Panel } from './types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readPublicJson(path: string): Promise<unknown> {
  const response = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!response.ok) throw new Error(`No se pudo leer ${path} (HTTP ${response.status}).`);
  return response.json() as Promise<unknown>;
}

function isMeta(value: unknown): value is DatasetMeta {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.dataFile === 'string' &&
    typeof value.sourceUrl === 'string' &&
    typeof value.unit === 'string' &&
    ['monthly', 'quarterly', 'semiannual', 'annual', 'seasonal'].includes(String(value.frequency)) &&
    ['ready', 'partial', 'stale', 'unavailable'].includes(String(value.status)) &&
    Array.isArray(value.series) &&
    value.series.every((s) => isObject(s) && typeof s.id === 'string' && typeof s.label === 'string')
  );
}

export function isCatalog(value: unknown): value is Panel[] {
  const sections = [
    'activity',
    'industry',
    'construction',
    'agriculture',
    'tourism',
    'exports',
    'credit',
    'mining',
    'labor',
  ];
  const extensions: Record<string, string> = {
    CP: 'credit',
    MN: 'mining',
    TR: 'labor',
    EP: 'industry',
  };
  const required = Array.from({ length: 48 }, (_, i) => `SR-${String(i + 1).padStart(2, '0')}`);
  if (
    !Array.isArray(value) ||
    !value.every(
      (panel) =>
        isObject(panel) &&
        typeof panel.id === 'string' &&
        (required.includes(panel.id)
          ? !['credit', 'mining', 'labor'].includes(String(panel.section))
          : /^(?:CP|MN|TR|EP)-(?:0[1-9]|[1-9]\d)$/.test(panel.id) &&
            panel.section === extensions[panel.id.slice(0, 2)]) &&
        typeof panel.title === 'string' &&
        sections.includes(String(panel.section)) &&
        Array.isArray(panel.sourceLinks),
    )
  )
    return false;
  const ids = new Set(value.map((panel: { id: string }) => panel.id));
  return ids.size === value.length && required.every((id) => ids.has(id));
}

export async function loadIndex(): Promise<{ manifest: Manifest; catalog: Panel[] }> {
  const [manifest, catalog] = await Promise.all([
    readPublicJson('data/manifest.json'),
    readPublicJson('data/catalog.json'),
  ]);
  if (
    !isObject(manifest) ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.datasets) ||
    !manifest.datasets.every(isMeta) ||
    typeof manifest.generatedAt !== 'string'
  ) {
    throw new Error('El registro de datos no tiene el formato esperado.');
  }
  if (!isCatalog(catalog)) {
    throw new Error('No se pudo validar el catálogo de indicadores.');
  }
  return { manifest: manifest as unknown as Manifest, catalog: catalog as Panel[] };
}

const datasetCache = new Map<string, Promise<Dataset>>();

export function loadDataset(meta: DatasetMeta): Promise<Dataset> {
  const existing = datasetCache.get(meta.id);
  if (existing) return existing;
  const request = readPublicJson(meta.dataFile).then((value) => {
    if (
      !isObject(value) ||
      value.id !== meta.id ||
      !Array.isArray(value.observations) ||
      !value.observations.every(
        (r) =>
          isObject(r) &&
          typeof r.date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
          typeof r.series === 'string' &&
          (r.value === null || (typeof r.value === 'number' && Number.isFinite(r.value))),
      )
    ) {
      throw new Error('El archivo de esta serie no superó la validación.');
    }
    const ids = new Set(meta.series.map((s) => s.id));
    const seen = new Set<string>();
    let previous = '';
    for (const row of value.observations as Dataset['observations']) {
      const key = `${row.date}|${row.series}`;
      if (!ids.has(row.series) || seen.has(key) || row.date < previous) {
        throw new Error('La serie contiene períodos desordenados, duplicados o desconocidos.');
      }
      previous = row.date;
      seen.add(key);
    }
    return { ...meta, observations: value.observations } as Dataset;
  });
  datasetCache.set(meta.id, request);
  request.catch(() => datasetCache.delete(meta.id));
  return request;
}
