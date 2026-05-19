// Single source of truth for date formatting / parsing.
// All client code should import from here — no ad-hoc Date arithmetic in components.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Convert a Date into a YYYY-MM-DD string in local time. */
export function toYMD(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parse a YYYY-MM-DD string as a local-time Date. */
export function parseYMD(str: string): Date {
  return new Date(str + 'T00:00:00');
}

/** Display a YYYY-MM-DD string as "DD Mon YYYY" (e.g. "04 Apr 2026"). */
export function formatDisplayDate(str: string): string {
  const d = parseYMD(str);
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/** Compact "DD/MM/YY" format, used in transaction tables. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year.slice(2)}`;
}

export function formatMonthYear(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function getMonthShort(month: number): string {
  return MONTH_SHORT[month - 1];
}

/** Extract { year, month } (month is 1-indexed) from a YYYY-MM-DD string. */
export function ymdToYearMonth(str: string): { year: number; month: number } {
  const d = parseYMD(str);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
