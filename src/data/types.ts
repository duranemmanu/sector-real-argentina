export type DataStatus = 'ready' | 'partial' | 'stale' | 'unavailable';
export type SectionId =
  | 'activity'
  | 'industry'
  | 'construction'
  | 'agriculture'
  | 'tourism'
  | 'exports'
  | 'credit'
  | 'mining'
  | 'labor';
export type PanelChart = 'line' | 'bar' | 'horizontalBar' | 'doughnut' | 'stackedBar' | 'table';

export interface SeriesInfo {
  id: string;
  label: string;
  sourceUnit?: string;
  role?: 'observed' | 'forecast' | 'lower' | 'upper';
}

export interface Observation {
  date: string;
  series: string;
  value: number | null;
}

export interface DatasetMeta {
  id: string;
  source: string;
  sourceUrl: string;
  unit: string;
  frequency: 'annual' | 'quarterly' | 'semiannual' | 'monthly' | 'seasonal';
  supportingSources?: { label: string; url: string }[];
  periodLabel?: string;
  series: SeriesInfo[];
  status: DataStatus;
  note: string;
  methodNote: string;
  lastObservedPeriod: string | null;
  lastObservedBySeries?: Record<string, string | null>;
  lastSuccessfulFetchAt: string | null;
  lastAttemptAt: string;
  sourcePublishedAt: string | null;
  isAutoUpdated: boolean;
  dataFile: string;
  observationCount: number;
  contentHash?: string;
  inputHash?: string;
  isForecast?: boolean;
  hasIntervals?: boolean;
  trainedThrough?: string;
  forecastStart?: string;
  generatedAt?: string;
  modelName?: string;
  validationMAE?: Record<string, number>;
}

export interface Dataset extends DatasetMeta {
  observations: Observation[];
}

export interface PanelView {
  dataset?: string;
  shortTitle?: string;
  chartType?: PanelChart;
  countries?: string[];
  selectableSeries?: string[];
  forecastOnly?: boolean;
  forecastDisabled?: boolean;
  observedPeriodsOnly?: boolean;
  comparePeriods?: string[];
  sortDescending?: boolean;
  denominator?: string;
  transform?:
    | 'yoy'
    | 'yoyLatest'
    | 'share'
    | 'shareLatest'
    | 'ratio'
    | 'ratioLatest'
    | 'contributionLatest'
    | 'base2020'
    | 'annualSum'
    | 'latest';
  unitOverride?: string;
  scale?: number;
  start?: string;
  end?: string;
  targetEnd?: string;
  partialNote?: string;
  methodNote?: string;
}

export interface Panel extends PanelView {
  id: string;
  downloadId?: string;
  title: string;
  section: SectionId;
  reason: string;
  sourceLinks: { label: string; url: string }[];
  views?: PanelView[];
}

export interface PreparedView {
  title: string;
  unit: string;
  labels: string[];
  series: (SeriesInfo & { values: (number | null)[] })[];
  periods: string[];
  firstPeriod: string;
  lastPeriod: string;
  frequency: DatasetMeta['frequency'];
  categorical: boolean;
  invalidCompositions: number;
  forecastCutoffIndex?: number;
}

export interface Manifest {
  schemaVersion: number;
  generatedAt: string;
  datasets: DatasetMeta[];
}
