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

export const CHART_COLORS = ['#6C5CA6', '#4C7EA8', '#C98A3B', '#4A8C6F', '#C4485B', '#B79CED', '#9C2F41'];
