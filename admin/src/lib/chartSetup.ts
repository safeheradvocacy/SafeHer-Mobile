import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, ArcElement, Title, Tooltip, Legend);

export const CHART_COLORS = ['#1456A0', '#2F80C9', '#D98A24', '#4D9272', '#D94B63', '#6B7280', '#AD3549'];

/**
 * Chart.js's default `maintainAspectRatio: true` sizes the canvas from
 * its parent's WIDTH alone (height = width / aspectRatio) and ignores
 * any CSS height set on ancestors — which is what let charts render far
 * taller than their card, or inconsistently sized card-to-card, across
 * the portal. Every chart must opt out of that and instead be sized by
 * an explicitly-heighted wrapper (see the `.chart-box` CSS class).
 * Centralized here so every chart, current and future, gets the fix by
 * construction instead of each page having to remember both lines.
 */
export function chartBaseOptions<T extends object>(options: T): T {
  return { responsive: true, maintainAspectRatio: false, ...options } as T;
}
