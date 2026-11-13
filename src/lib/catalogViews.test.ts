import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Dataset, Panel } from '../data/types';
import { isCatalog } from '../data/load';
import {
  catalogViews,
  relatedTables,
  standaloneTables,
  overviewCharts,
  linkedForecast,
} from './catalogViews';
import { prepareView } from './calculations';

test('las 48 necesidades y los 13 cuadros conservan acceso en el catálogo de detalle', () => {
  const catalog: Panel[] = JSON.parse(readFileSync('public/data/catalog.json', 'utf8'));
  const all = catalogViews(catalog.filter((panel) => panel.id.startsWith('SR-')));
  const charts = overviewCharts(all);
  const accessible = [
    ...charts,
    ...standaloneTables(all),
    ...charts.flatMap((p) => relatedTables(p, all)),
    ...charts.flatMap((p) => linkedForecast(p, all) ?? []),
  ];
  assert.equal(new Set(accessible.map((p) => p.downloadId)).size, all.length);
  assert.equal(new Set(accessible.map((p) => p.id)).size, 48);
  assert.equal(charts.length, 58);
  assert.ok(!charts.some((p) => p.id === 'SR-05'));
  assert.equal(
    new Set(accessible.filter((p) => p.chartType === 'table').map((p) => p.downloadId)).size,
    13,
  );
});

test('el catálogo admite crédito privado y rechaza duplicados, secciones inválidas y necesidades faltantes', () => {
  const catalog: Panel[] = JSON.parse(readFileSync('public/data/catalog.json', 'utf8'));
  const original = catalog.filter((panel) => panel.id.startsWith('SR-'));
  const credit: Panel = {
    id: 'CP-01',
    title: 'Mora bancaria',
    section: 'credit',
    reason: '',
    sourceLinks: [],
  };
  assert.ok(isCatalog([...original, credit]));
  assert.equal(isCatalog([...original, credit, credit]), false);
  assert.equal(isCatalog([...original.slice(1), credit]), false);
  assert.equal(isCatalog([...original, { ...credit, section: 'activity' }]), false);
  assert.equal(isCatalog([...original, { ...credit, id: 'SR-49' }]), false);
  assert.equal(isCatalog([...original, { ...credit, id: 'CP-00' }]), false);
  assert.ok(isCatalog([...original, { ...credit, id: 'MN-01', section: 'mining' }]));
  assert.ok(isCatalog([...original, { ...credit, id: 'TR-01', section: 'labor' }]));
  assert.ok(isCatalog([...original, { ...credit, id: 'EP-01', section: 'industry' }]));
  assert.equal(isCatalog([...original, { ...credit, id: 'EP-01', section: 'labor' }]), false);
  assert.equal(isCatalog([...original, { ...credit, id: 'MN-01', section: 'labor' }]), false);
});

test('los indicadores de crédito tienen series representables y mantienen separados los pronósticos', () => {
  const catalog: Panel[] = JSON.parse(readFileSync('public/data/catalog.json', 'utf8'));
  const panels = overviewCharts(catalogViews(catalog)).filter((panel) => panel.section === 'credit');
  assert.ok(panels.length > 0, 'Falta la sección de crédito privado');
  for (const panel of panels) {
    assert.equal(panel.forecastDisabled, true, panel.id);
    assert.ok(panel.dataset, panel.id);
    assert.ok(panel.sourceLinks.length > 0, panel.id);
    const data: Dataset = JSON.parse(readFileSync(`public/data/${panel.dataset}.json`, 'utf8'));
    const view = prepareView(panel, data, 'catalog');
    assert.ok(view.unit && view.firstPeriod && view.lastPeriod, panel.id);
    assert.ok(view.series.length > 0, panel.id);
    assert.ok(
      view.series.some((series) => series.values.some((value) => value !== null)),
      panel.id,
    );
    for (const series of view.series) {
      assert.equal(series.values.length, view.labels.length, panel.id);
      assert.ok(
        series.values.every((value) => value === null || Number.isFinite(value)),
        panel.id,
      );
    }
  }
});

test('la composición exportadora usa el total FOB del mismo año y expresa participaciones porcentuales', () => {
  const catalog: Panel[] = JSON.parse(readFileSync('public/data/catalog.json', 'utf8'));
  const data: Dataset = JSON.parse(readFileSync('public/data/export-rubros.json', 'utf8'));
  const panel = catalog.find((p) => p.id === 'SR-40')!;
  const view = prepareView(panel, data, 'catalog');
  assert.equal(view.unit, '% del total de exportaciones FOB');
  assert.equal(view.lastPeriod, '2025-01-01');
  const total = data.observations.find(
    (row) => row.date === view.lastPeriod && row.series === 'total',
  )!.value!;
  const primary = data.observations.find(
    (row) => row.date === view.lastPeriod && row.series === 'primary',
  )!.value!;
  assert.equal(view.series[0].values[0], (100 * primary) / total);
  assert.ok(
    Math.abs(view.series[0].values.reduce<number>((sum, value) => sum + value!, 0) - 100) < 1e-8,
  );
});

test('minería y trabajo conservan acceso a todas las vistas y cuadros con sus unidades', () => {
  const catalog: Panel[] = JSON.parse(readFileSync('public/data/catalog.json', 'utf8'));
  const all = catalogViews(catalog);
  assert.equal(catalog.filter((panel) => panel.section === 'credit').length, 31);
  for (const section of ['mining', 'labor']) {
    const views = all.filter((panel) => panel.section === section);
    assert.ok(views.length > 0, section);
    const charts = overviewCharts(views);
    const accessible = [
      ...charts,
      ...standaloneTables(views),
      ...charts.flatMap((panel) => relatedTables(panel, views)),
    ];
    assert.equal(new Set(accessible.map((panel) => panel.downloadId)).size, views.length);
    for (const panel of views) {
      const data: Dataset = JSON.parse(readFileSync(`public/data/${panel.dataset}.json`, 'utf8'));
      const view = prepareView(panel, data, 'catalog');
      assert.ok(view.unit && view.firstPeriod && view.lastPeriod, panel.downloadId ?? panel.id);
      assert.ok(
        view.series.some((series) => series.values.some((value) => value !== null)),
        panel.downloadId ?? panel.id,
      );
      assert.ok(
        view.series.every((series) => series.values.length === view.labels.length),
        panel.downloadId ?? panel.id,
      );
    }
  }
});

test('EPI conserva unidades físicas y las vistas corregidas conservan sus observaciones', () => {
  const catalog: Panel[] = JSON.parse(readFileSync('public/data/catalog.json', 'utf8'));
  const units = ['toneladas', 'miles de toneladas', 'miles de toneladas', 'miles de toneladas'];
  for (const [index, unit] of units.entries()) {
    const panel = catalog.find((p) => p.id === `EP-0${index + 1}`)!;
    const data: Dataset = JSON.parse(readFileSync(`public/data/${panel.dataset}.json`, 'utf8'));
    const view = prepareView(panel, data, 'catalog');
    assert.equal(panel.section, 'industry');
    assert.equal(data.unit, unit);
    assert.equal(view.lastPeriod, data.lastObservedPeriod);
    assert.ok(view.series[0].values.some((v) => v !== null && v > 0));
  }
  for (const id of ['CP-04', 'CP-05']) {
    const panel = catalog.find((p) => p.id === id)!;
    const data: Dataset = JSON.parse(readFileSync(`public/data/${panel.dataset}.json`, 'utf8'));
    const view = prepareView(panel, data, 'catalog');
    const observed = [
      ...new Set(data.observations.filter((r) => r.value !== null).map((r) => r.date)),
    ].sort();
    assert.deepEqual(view.periods, observed);
    assert.ok(view.series.every((s) => s.values.every((v) => v !== null)));
    assert.ok(data.observations.some((r) => r.value === null));
  }
});
