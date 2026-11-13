import { useEffect, useState } from 'react';
import type { DatasetMeta, Manifest, Panel, SectionId } from './data/types';
import { loadIndex } from './data/load';
import { ChartPanel } from './components/ChartPanel';
import { Modal } from './components/Modal';
import { PeriodControls } from './components/PeriodControls';
import { SourceRegister } from './components/SourceRegister';
import { DEFAULT_WINDOW } from './lib/viewFilters';
import { formatTimestamp } from './lib/format';
import {
  catalogViews,
  relatedTables,
  standaloneTables,
  viewKind,
  overviewCharts,
  linkedForecast,
} from './lib/catalogViews';

const SECTIONS: { id: SectionId; label: string; description: string }[] = [
  {
    id: 'activity',
    label: 'Actividad y PIB',
    description: 'Actividad económica, cuentas nacionales y crecimiento internacional.',
  },
  {
    id: 'industry',
    label: 'Industria y comercio',
    description: 'Producción manufacturera, capacidad instalada y ventas del comercio interior.',
  },
  {
    id: 'construction',
    label: 'Construcción',
    description: 'Actividad, empleo y expectativas de la construcción.',
  },
  {
    id: 'agriculture',
    label: 'Agro',
    description: 'Actividad agropecuaria, superficie, producción y rendimiento de cultivos.',
  },
  { id: 'tourism', label: 'Turismo', description: 'Viajeros, aporte al PIB y turismo en Salta.' },
  {
    id: 'mining',
    label: 'Energía y minería',
    description: 'Actividad minera, extracción de petróleo crudo y producción de carbonato de litio.',
  },
  {
    id: 'labor',
    label: 'Trabajo',
    description: 'Empleo, informalidad y salarios. Precios y poder adquisitivo.',
  },
  {
    id: 'exports',
    label: 'Estructura productiva',
    description: 'Rubros y complejos exportadores. Exportaciones de Salta.',
  },
  {
    id: 'credit',
    label: 'CRÉDITO PRIVADO',
    description: 'Crédito, morosidad y tasas de interés. Ingresos y actividad de familias y empresas.',
  },
];

function initialTheme(): boolean {
  try {
    const saved = localStorage.getItem('sector-real-theme');
    return saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export default function App() {
  const [index, setIndex] = useState<{ manifest: Manifest; catalog: Panel[] } | null>(null);
  const [error, setError] = useState('');
  const [sectionId, setSectionId] = useState<SectionId>('activity');
  const [window, setWindow] = useState(DEFAULT_WINDOW);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [opened, setOpened] = useState<Panel | null>(null);
  const [dark, setDark] = useState(initialTheme);
  useEffect(() => {
    loadIndex()
      .then(setIndex)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'No se pudo cargar el registro de datos.'),
      );
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try {
      localStorage.setItem('sector-real-theme', dark ? 'dark' : 'light');
    } catch {
      /* La preferencia sigue activa durante esta visita. */
    }
  }, [dark]);
  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];
  const metadata = new Map<string, DatasetMeta>(index?.manifest.datasets.map((d) => [d.id, d]));
  const allViews = catalogViews(index?.catalog ?? []);
  const preferred = ['SR-01', 'SR-47', 'SR-43', 'SR-48'];
  const normalize = (text: string) =>
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const matches = (p: Panel) =>
    p.section === sectionId &&
    normalize(p.shortTitle ?? p.title).includes(normalize(search)) &&
    (kind === 'all' || viewKind(p) === kind);
  const charts = overviewCharts(allViews)
    .filter(matches)
    .sort((a, b) => {
      const rank = (p: Panel) => (preferred.includes(p.id) ? preferred.indexOf(p.id) : 10);
      return rank(a) - rank(b);
    });
  const tables = (
    kind === 'table' || search.trim()
      ? allViews.filter((panel) => panel.chartType === 'table')
      : standaloneTables(allViews)
  ).filter(matches);
  const count = charts.length + tables.length;
  const latestQuery =
    index?.manifest.datasets
      .filter((dataset) => dataset.isAutoUpdated && !dataset.isForecast)
      .map((dataset) => dataset.lastSuccessfulFetchAt)
      .filter((date): date is string => !!date && Number.isFinite(Date.parse(date)))
      .sort((a, b) => Date.parse(a) - Date.parse(b))
      .at(-1) ?? null;
  const activeFilters = Number(!!search) + Number(kind !== 'all') + Number(window.preset !== 'catalog');
  return (
    <>
      <a className="skip-link" href="#main">
        Ir al contenido
      </a>
      <header className="site-header">
        <div className="masthead page-width">
          <div>
            <h1>
              SECTOR REAL <span>|</span> ARGENTINA
            </h1>
            <p>Indicadores económicos · Series históricas y cuadros</p>
          </div>
          <div className="header-tools">
            <div className="header-meta">
              {latestQuery && (
                <p className="fetch-summary">Consulta más reciente: {formatTimestamp(latestQuery)}</p>
              )}
              <button
                className="theme-toggle"
                onClick={() => setDark(!dark)}
                aria-label={dark ? 'Activar modo claro' : 'Activar modo oscuro'}
                aria-pressed={dark}
              >
                <span aria-hidden="true">{dark ? '☀' : '☾'}</span>{' '}
                <span>{dark ? 'Modo claro' : 'Modo oscuro'}</span>
              </button>
            </div>
            <button className="text-button" onClick={() => setShowSources(true)} aria-haspopup="dialog">
              Fuentes y metodología
            </button>
          </div>
        </div>
        <nav className="section-nav page-width" aria-label="Secciones">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              aria-current={sectionId === s.id ? 'page' : undefined}
              onClick={() => {
                setSectionId(s.id);
                setSearch('');
                setKind('all');
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>
      <main id="main" className="page-width">
        <section className="section-intro" aria-labelledby="section-title">
          <div>
            <h2 id="section-title">{section.label}</h2>
            <p>{section.description}</p>
          </div>
          <span className="indicator-count">
            {count} {count === 1 ? 'indicador' : 'indicadores'}
          </span>
        </section>
        {error ? (
          <div className="error-box" role="alert">
            <h2>No se pudo cargar el registro de datos</h2>
            <p>{error}</p>
            <button onClick={() => location.reload()}>Volver a intentar</button>
          </div>
        ) : !index ? (
          <p role="status" className="loading">
            Cargando indicadores…
          </p>
        ) : (
          <>
            <button
              className="mobile-filter-toggle"
              aria-expanded={filtersExpanded}
              aria-controls="indicator-filters"
              onClick={() => setFiltersExpanded(!filtersExpanded)}
            >
              <span>Filtros de indicadores{activeFilters > 0 ? ` (${activeFilters})` : ''}</span>
              <span aria-hidden="true">{filtersExpanded ? '−' : '+'}</span>
            </button>
            <div
              id="indicator-filters"
              className={`view-toolbar ${filtersExpanded ? 'filters-expanded' : ''}`}
              aria-label="Filtros de indicadores"
            >
              <label className="search-control">
                Buscar indicador
                <input
                  type="search"
                  placeholder={`Buscar en ${section.label.toLowerCase()}…`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label>
                Vista
                <select value={kind} onChange={(event) => setKind(event.target.value)}>
                  <option value="all">Todas</option>
                  <option value="series">Series temporales</option>
                  <option value="comparison">Comparaciones</option>
                  <option value="composition">Composición</option>
                  <option value="table">Cuadros complementarios</option>
                </select>
              </label>
              <PeriodControls value={window} onChange={setWindow} />
              {(search || kind !== 'all' || window.preset !== 'catalog') && (
                <button
                  className="reset-button"
                  onClick={() => {
                    setSearch('');
                    setKind('all');
                    setWindow(DEFAULT_WINDOW);
                  }}
                >
                  Restablecer
                </button>
              )}
            </div>
            {count === 0 && (
              <div className="empty-section">
                <h3>No hay indicadores con estos filtros</h3>
                <p>Probá otro nombre o cambiá el tipo de vista.</p>
              </div>
            )}
            <div className="chart-grid">
              {charts.map((panel) => (
                <ChartPanel
                  key={panel.downloadId}
                  panel={panel}
                  meta={metadata.get(panel.dataset ?? '')}
                  window={window}
                  dark={dark}
                  onOpen={() => setOpened(panel)}
                />
              ))}
            </div>
            {tables.length > 0 && (
              <section className="supplementary-tables" aria-label="Cuadros complementarios">
                <h3>Cuadros complementarios</h3>
                <div>
                  {tables.map((panel) => (
                    <button
                      key={panel.downloadId}
                      onClick={() => setOpened(panel)}
                      aria-haspopup="dialog"
                    >
                      <span>{panel.shortTitle ?? panel.title}</span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <footer className="site-footer">
        <div className="page-width">
          <span>
            Sector Real | Argentina <span className="footer-divider">·</span>{' '}
            <span className="author-signature">hecho por Emmanuel Duran</span>
          </span>
          <span>Datos públicos</span>
        </div>
      </footer>
      {opened && (
        <Modal title={opened.shortTitle ?? opened.title} onClose={() => setOpened(null)}>
          <ChartPanel
            panel={opened}
            meta={metadata.get(opened.dataset ?? '')}
            metadata={metadata}
            related={relatedTables(opened, allViews)}
            storedForecast={linkedForecast(opened, allViews)}
            window={window}
            dark={dark}
          />
        </Modal>
      )}
      {showSources && (
        <Modal title="Fuentes y metodología" onClose={() => setShowSources(false)}>
          <div className="methodology">
            <section>
              <h3>Datos y actualización</h3>
              <p>
                Las series se obtienen de publicaciones oficiales y fuentes sectoriales identificadas.
                Cada indicador informa unidad, frecuencia, último dato y fecha de consulta. Las fuentes
                pueden revisar períodos anteriores; los faltantes se muestran como —.
              </p>
              <p>
                Las consultas automáticas están programadas a las 09:17 y 20:17 de Argentina. La fecha
                efectiva de consulta figura en el detalle. Las cifras transcritas de informes, como WTTC,
                EcoGo/Austral y turismo de invierno en Salta, conservan el corte verificado y requieren
                una revisión documentada de cada publicación.
              </p>
            </section>
            <section>
              <h3>Cálculos y descargas</h3>
              <p>
                Las variaciones interanuales comparan el mismo período del año anterior. Las
                participaciones usan el total del mismo universo. Las series originales,
                desestacionalizadas y de tendencia se identifican por separado.
              </p>
              <p>
                Los filtros se aplican al gráfico y sus descargas. Los cuadros de comparaciones fijas
                conservan sus períodos. PNG con fondo blanco; CSV con separador punto y coma y decimales
                con coma, compatible con Excel.
              </p>
            </section>
            <section>
              <h3>Pronósticos</h3>
              <p>
                El pronóstico del EMAE se consulta dentro de su indicador: SARIMA mensual, con corte,
                validación e intervalos documentados. En los demás indicadores se distingue entre tasas,
                proporciones, niveles originales y series desestacionalizadas. Los modelos y las ventanas
                de ajuste se comparan en tres bloques históricos del mismo horizonte que el pronóstico.
                Sólo se ofrece la pestaña cuando existe una estimación no plana que mejora al menos 5% el
                error de referencia y mejora en dos de los tres bloques. La metodología particular y los
                errores están dentro de cada indicador. Son estimaciones propias, no proyecciones
                oficiales.
              </p>
              <a href="https://otexts.com/fpp3/" target="_blank" rel="noreferrer">
                Referencia metodológica · Hyndman y Athanasopoulos
              </a>
            </section>
            <SourceRegister datasets={index?.manifest.datasets ?? []} views={allViews} />
          </div>
        </Modal>
      )}
    </>
  );
}
