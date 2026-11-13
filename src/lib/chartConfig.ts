import { Chart as ChartJS, registerables } from 'chart.js';
import type { ChartConfiguration, Plugin } from 'chart.js';
import type { PanelChart, PreparedView } from '../data/types';
import { formatNumber } from './format';

export type SupportedChart = 'line' | 'bar' | 'doughnut';
export type ChartConfig = ChartConfiguration<SupportedChart, (number | null)[], string>;
export const SERIES_COLORS = [
  '#4F81BD',
  '#C0504D',
  '#9BBB59',
  '#8064A2',
  '#4BACC6',
  '#F79646',
  '#595959',
  '#9C6A47',
];
const whiteBackground: Plugin<SupportedChart> = {
  id: 'whiteBackground',
  beforeDraw(chart) {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};
ChartJS.register(...registerables);
ChartJS.defaults.font.family = 'Arimo, Arial, Tahoma, sans-serif';
ChartJS.defaults.color = '#40464c';

export function makeChartConfig(
  view: PreparedView,
  type: PanelChart,
  forExport = false,
  dark = false,
): ChartConfig {
  const text = dark && !forExport ? '#c9d4e0' : '#40464c';
  const grid = dark && !forExport ? '#354252' : '#e0e0e0';
  const colors =
    dark && !forExport
      ? ['#7ba9df', '#e58783', '#b0ca7c', '#baa3dc', '#72c6d9', '#efb16d', '#b9bfc7', '#cd9c7d']
      : SERIES_COLORS;
  const doughnut = type === 'doughnut';
  const chartType = type === 'line' ? 'line' : doughnut ? 'doughnut' : 'bar';
  const cutoff = view.forecastCutoffIndex;
  const plotFrame: Plugin<SupportedChart> = {
    id: 'plotFrame',
    afterDraw(chart) {
      if (doughnut) return;
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.strokeStyle = dark && !forExport ? '#53677c' : '#b9bec4';
      ctx.lineWidth = 1;
      ctx.strokeRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
      ctx.restore();
    },
  };
  return {
    type: chartType,
    plugins: [
      plotFrame,
      ...(forExport ? [whiteBackground] : []),
      ...(cutoff === undefined || cutoff < 0
        ? []
        : [
            {
              id: 'forecastCutoff',
              afterDraw(chart: ChartJS<SupportedChart>) {
                const x = chart.scales.x.getPixelForValue(cutoff + 0.5);
                const { ctx, chartArea } = chart;
                ctx.save();
                ctx.strokeStyle = text;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = text;
                ctx.font = `${forExport ? 15 : 10}px Arial`;
                const fits = x + ctx.measureText('Pronóstico →').width + 5 <= chartArea.right;
                ctx.textAlign = fits ? 'left' : 'right';
                ctx.fillText('Pronóstico →', x + (fits ? 5 : -5), chartArea.top + 15);
                ctx.restore();
              },
            },
          ]),
    ],
    data: {
      labels: doughnut
        ? view.labels.map(
            (label, index) => `${label}: ${formatNumber(view.series[0].values[index] ?? null)} %`,
          )
        : view.labels,
      datasets: view.series.map((s, index) => ({
        label: s.role === 'upper' ? 'Intervalo de predicción 95%' : s.label,
        data: s.values,
        borderColor: doughnut
          ? '#ffffff'
          : s.role === 'upper' || s.role === 'lower'
            ? 'transparent'
            : s.role === 'forecast'
              ? colors[1]
              : colors[index % colors.length],
        backgroundColor: doughnut
          ? colors
          : s.role === 'upper' || s.role === 'lower'
            ? 'rgba(120, 120, 120, 0.18)'
            : s.role === 'forecast'
              ? colors[1]
              : colors[index % colors.length],
        borderWidth: s.role === 'lower' || s.role === 'upper' ? 0 : chartType === 'line' ? 2 : 1,
        borderDash: s.role === 'forecast' ? [6, 4] : [],
        fill:
          s.role === 'upper'
            ? {
                target: view.series.findIndex((series) => series.role === 'lower'),
                above: 'rgba(120, 120, 120, 0.18)',
              }
            : false,
        pointRadius: chartType === 'line' && view.labels.length <= 36 && !s.role ? 1.5 : 0,
        pointStyle: 'rect',
        pointHoverRadius: 3,
        tension: 0,
        spanGaps: false,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      devicePixelRatio: 2,
      font: { family: forExport ? 'Arial, Tahoma, sans-serif' : 'Arimo, Arial, Tahoma, sans-serif' },
      indexAxis: type === 'horizontalBar' ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: text,
            boxWidth: 12,
            boxHeight: 10,
            font: { size: forExport ? 16 : 11 },
            filter: (item) => view.series[item.datasetIndex ?? 0]?.role !== 'lower',
          },
          onClick() {},
        },
        tooltip: {
          callbacks: {
            label: (context) =>
              `${context.dataset.label}: ${new Intl.NumberFormat('es-AR', {
                maximumFractionDigits: 2,
              }).format(
                Number(
                  type === 'horizontalBar'
                    ? context.parsed.x
                    : doughnut
                      ? context.parsed
                      : context.parsed.y,
                ),
              )}`,
          },
        },
      },
      scales: doughnut
        ? {}
        : {
            x: {
              stacked: type === 'stackedBar',
              grid: { color: grid },
              ticks: {
                color: text,
                callback: function (value) {
                  return type === 'horizontalBar'
                    ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(Number(value))
                    : this.getLabelForValue(Number(value));
                },
                maxTicksLimit: type === 'horizontalBar' ? 7 : forExport ? 14 : 8,
                font: { size: forExport ? 15 : 10 },
                maxRotation: 0,
              },
            },
            y: {
              stacked: type === 'stackedBar',
              beginAtZero: chartType === 'bar',
              max: type === 'stackedBar' ? 100 : undefined,
              grid: { color: grid },
              ticks: {
                color: text,
                font: { size: forExport ? 15 : 10 },
                callback:
                  type === 'horizontalBar'
                    ? function (value) {
                        const label = this.getLabelForValue(Number(value));
                        return !forExport && label.length > 34 ? label.slice(0, 32) + '…' : label;
                      }
                    : (value) =>
                        new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 }).format(
                          Number(value),
                        ),
              },
            },
          },
    },
  };
}
