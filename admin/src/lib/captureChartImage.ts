/**
 * Reads the REAL, already-rendered Chart.js <canvas> out of a chart
 * container at PDF-build time — never redraws or recalculates
 * anything. Chart.js (react-chartjs-2) always renders onto a plain
 * HTMLCanvasElement, so its own native toDataURL() is enough; no chart
 * library API is needed here, which is also why this works identically
 * for Bar/Line/Doughnut without caring which one a given page used.
 *
 * Returns the canvas's REAL captured pixel dimensions alongside the
 * image so callers (chartImageSection, reportDocument.ts) can preserve
 * the exact aspect ratio rather than guessing one.
 */
export function captureChartImage(container: HTMLDivElement | null): { dataUrl: string; width: number; height: number } | null {
  if (!container) return null;
  const canvas = container.querySelector('canvas');
  if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
  try {
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } catch (e) {
    console.warn('[captureChartImage] toDataURL failed:', e);
    return null;
  }
}
