import * as xlsx from 'xlsx';
import { RawTransaction } from '../types';

export function parseFibank(buffer: Buffer): RawTransaction[] {
  const wb = xlsx.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' });

  // Find the header row by looking for "Transaction date:"
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some(c => String(c).toLowerCase().includes('transaction date'))) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) return [];

  const header = rows[headerIdx].map(c => String(c).toLowerCase().trim());
  const colDate    = header.findIndex(c => c.includes('transaction date'));
  const colDebit   = header.findIndex(c => c.includes('debit'));
  const colCredit  = header.findIndex(c => c.includes('credit'));
  const colBenef   = header.findIndex(c => c.includes('beneficiary'));
  const colDetails = header.findIndex(c => c.includes('details of payment'));
  const colMore    = header.findIndex(c => c.includes('more'));

  const results: RawTransaction[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === '')) continue;

    const rawDate = String(row[colDate] ?? '').trim();
    if (!rawDate) continue;

    const date = parseFibankDate(rawDate);
    if (!date) continue;

    const debitRaw  = row[colDebit];
    const creditRaw = row[colCredit];
    const debit  = typeof debitRaw  === 'number' ? debitRaw  : parseFloat(String(debitRaw).replace(/[^\d.]/g, ''));
    const credit = typeof creditRaw === 'number' ? creditRaw : parseFloat(String(creditRaw).replace(/[^\d.]/g, ''));

    const hasDebit  = !isNaN(debit)  && debit  > 0;
    const hasCredit = !isNaN(credit) && credit > 0;
    if (!hasDebit && !hasCredit) continue;

    const amount: number = hasDebit ? debit : credit;
    const type: 'expense' | 'income' = hasDebit ? 'expense' : 'income';

    // Build description from beneficiary + details + more
    const beneficiary = String(row[colBenef]   ?? '').trim();
    const details     = String(row[colDetails] ?? '').trim();
    const more        = colMore >= 0 ? String(row[colMore] ?? '').trim() : '';

    // Prefer details, fall back to beneficiary
    let description = details || beneficiary;
    // Strip "Плащане ПОС" prefix from the "more" field when it's the only info
    if (!description && more) description = more.replace(/^Плащане ПОС\s*/i, '').trim();

    const raw_description = [beneficiary, details, more].filter(Boolean).join(' | ');

    // Transfer detection
    const descLower = raw_description.toLowerCase();
    if (descLower.includes('revolut') || descLower.includes('кост')) continue;

    results.push({ date, amount, description, raw_description, type, bank: 'fibank' });
  }

  return results;
}

function parseFibankDate(raw: string): string | null {
  // Format: DD/MM/YYYY
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}
