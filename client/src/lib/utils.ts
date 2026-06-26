import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return `${amount < 0 ? '-' : ''}€${Math.abs(amount).toFixed(2)}`;
}

// Curated palette for auto-assigned group colors (e.g. when a bill is pushed to
// the finance app as a new group). Pleasant, distinct hues that read well on the
// zinc-950 dark background.
export const GROUP_COLOR_PALETTE = [
  '#a78bfa', // violet
  '#f472b6', // pink
  '#38bdf8', // sky
  '#34d399', // emerald
  '#fbbf24', // amber
  '#f87171', // red
  '#22d3ee', // cyan
  '#c084fc', // purple
  '#4ade80', // green
  '#fb923c', // orange
] as const;

export function getRandomGroupColor(): string {
  return GROUP_COLOR_PALETTE[Math.floor(Math.random() * GROUP_COLOR_PALETTE.length)];
}

// Date helpers live in lib/dates.ts — re-exported here for back-compat.
export { formatDate, formatMonthYear, getMonthShort, MONTH_SHORT as MONTH_NAMES_SHORT } from './dates';

import { MONTH_SHORT } from './dates';
export function getMonthNames(): string[] {
  return MONTH_SHORT;
}
