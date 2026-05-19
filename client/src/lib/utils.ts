import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return `€${Math.abs(amount).toFixed(2)}`;
}

// Date helpers live in lib/dates.ts — re-exported here for back-compat.
export { formatDate, formatMonthYear, getMonthShort, MONTH_SHORT as MONTH_NAMES_SHORT } from './dates';

import { MONTH_SHORT } from './dates';
export function getMonthNames(): string[] {
  return MONTH_SHORT;
}
