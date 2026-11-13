import { Chart as ChartJS } from 'chart.js';
import type { ChartConfig } from './chartConfig';
import { safeName } from './format';

function wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  const words = text.split(/\s+/).flatMap((word) => {
    if (ctx.measureText(word).width <= width) return [word];
    const chunks: string[] = [];
    let part = '';
    for (const character of word) {
      if (ctx.measureText(part + character).width > width) {
        chunks.push(part);
        part = '';
      }
      part += character;
    }
    return [...chunks, part];
  });
  for (const word of words) {
    if (line && ctx.measureText(`${line} ${word}`).width > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

export async function exportPng(
  config: ChartConfig,
  context: {
    id: string;
    title: string;
    unit: string;
    period: string;
    source: string;
    sourceUrl: string;
    note: string;
    lastPeriod: string;
  },
): Promise<void> {
  const chartCanvas = document.createElement('canvas');
  chartCanvas.width = 1400;
  chartCanvas.height = 720;
  const chart = new ChartJS(chartCanvas, {
    ...config,
    options: { ...config.options, responsive: false, devicePixelRatio: 1, animation: false },
  });
  try {
    const picture = new Image();
    picture.src = chart.toBase64Image('image/png');
    await picture.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no pudo preparar la imagen.');
    ctx.font = 'bold 26px Arial';
    const title = wrapText(ctx, context.title, 1400);
    ctx.font = '18px Arial';
    const foot = wrapText(ctx, `Fuente: ${context.source}. ${context.note}`, 1400);
    ctx.font = '15px Arial';
    const urls = wrapText(ctx, context.sourceUrl, 1400);
    const headerHeight = 90 + title.length * 32;
    canvas.height = headerHeight + 720 + foot.length * 24 + urls.length * 20 + 85;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#183b60';
    ctx.font = 'bold 16px Arial';
    ctx.fillText('SECTOR REAL | ARGENTINA', 40, 32);
    ctx.fillStyle = '#202020';
    ctx.font = 'bold 26px Arial';
    title.forEach((line, index) => ctx.fillText(line, 40, 70 + index * 32));
    ctx.font = '18px Arial';
    ctx.fillText(`${context.unit} · ${context.period}`, 40, headerHeight - 20);
    ctx.drawImage(picture, 40, headerHeight, 1400, 720);
    let top = headerHeight + 750;
    ctx.font = '18px Arial';
    foot.forEach((line) => {
      ctx.fillText(line, 40, top);
      top += 24;
    });
    ctx.font = '15px Arial';
    urls.forEach((line) => {
      ctx.fillText(line, 40, top + 10);
      top += 20;
    });
    const link = document.createElement('a');
    link.download = `sector-real-${safeName(context.id)}-${context.lastPeriod}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } finally {
    chart.destroy();
  }
}
