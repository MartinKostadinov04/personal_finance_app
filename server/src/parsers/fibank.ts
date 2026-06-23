import * as cheerio from 'cheerio';
import * as xlsx from 'xlsx';
import { RawTransaction } from '../types';

export function parseFibank(buffer: Buffer): RawTransaction[] {
  const content = buffer.toString('utf-8');

  // Fibank exports a .xls that is actually HTML
  if (content.trimStart().startsWith('<')) {
    return parseFibankHtml(content);
  }

  return parseFibankXlsx(buffer);
}

// ─── HTML parser (actual Fibank export format) ───────────────────────────────

function parseFibankHtml(html: string): RawTransaction[] {
  const $ = cheerio.load(html);
  const results: RawTransaction[] = [];

  // Each transaction is a <tr> with ≥5 direct <td> children where td[0] is a date.
  // The structure per row:
  //   td[0]: transaction date  "DD.MM.YYYY"
  //   td[1]: nested tables: "Референция:..." and "Описание:..."
  //   td[2]: valeur date (ignored)
  //   td[3]: debit  "X.XX EUR\n..."
  //   td[4]: credit "X.XX EUR\n..." (0.00 when it's a debit)
  //   td[5]: running balance (ignored)
  $('tr').each(function () {
    const tds = $(this).children('td');
    if (tds.length < 5) return;

    const dateRaw = $(tds[0]).text().trim();
    const date = parseFibankDate(dateRaw);
    if (!date) return;

    // Extract description from td[1]: prefer "Описание:..." text
    const basisTd = $(tds[1]);
    let description = '';
    basisTd.find('td').each(function () {
      const text = $(this).text().trim();
      if (text.startsWith('Описание:')) {
        description = text.replace(/^Описание:\s*/i, '').trim();
      }
    });
    // Fall back to label text (used for summary rows like "Натрупани обороти")
    if (!description) {
      description = basisTd.find('label').text().trim() || basisTd.text().replace(/Референция:\S+/gi, '').trim();
    }

    if (!description) return;

    // Skip summary / balance rows
    const descLower = description.toLowerCase();
    if (descLower.includes('натрупани') || descLower.includes('салдо')) return;

    // Parse EUR amounts from td[3] (debit) and td[4] (credit)
    const debit  = parseEurAmount($(tds[3]).text());
    const credit = parseEurAmount($(tds[4]).text());

    const hasDebit  = !isNaN(debit)  && debit  > 0;
    const hasCredit = !isNaN(credit) && credit > 0;

    if (!hasDebit && !hasCredit) return;
    if (hasDebit && hasCredit) return; // shouldn't happen

    const amount = hasDebit ? debit : credit;
    const type: 'expense' | 'income' = hasDebit ? 'expense' : 'income';

    // Normalise whitespace (HTML line breaks become \n inside cheerio .text())
    const normalized = description.replace(/\s+/g, ' ').trim();
    // Strip uninformative "Плащане ПОС" prefix
    const cleanDesc = normalized.replace(/^плащане пос\s*/i, '').trim() || normalized;

    // Transfer detection
    if (descLower.includes('revolut') || descLower.includes('костадинов')) return;

    results.push({
      date,
      amount,
      description: cleanDesc,
      raw_description: normalized,
      type,
      bank: 'fibank',
    });
  });

  return results;
}

function parseEurAmount(text: string): number {
  // Text: "9.80 EUR\n19.17 BGN" — take the EUR figure
  const match = text.match(/([\d,]+\.?\d*)\s*EUR/i);
  if (!match) return NaN;
  return parseFloat(match[1].replace(/,/g, ''));
}

function parseFibankDate(raw: string): string | null {
  // "DD.MM.YYYY" or "D.M.YYYY"
  const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

// ─── XLSX fallback parser ─────────────────────────────────────────────────────

function parseFibankXlsx(buffer: Buffer): RawTransaction[] {
  const wb = xlsx.read(buffer, { type: 'buffer' });

  let ws: typeof wb.Sheets[string] | null = null;
  let headerIdx = -1;

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' });
    for (let i = 0; i < rows.length; i++) {
      const h = rows[i].map(c => String(c).toLowerCase().trim());
      if (
        (h.includes('дата') || h.some(c => c.includes('transaction date'))) &&
        (h.includes('дебит') || h.some(c => c.includes('debit')))
      ) {
        ws = sheet;
        headerIdx = i;
        break;
      }
    }
    if (ws) break;
  }

  if (!ws || headerIdx === -1) return [];

  const rows = xlsx.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, defval: '' });
  const header = rows[headerIdx].map(c => String(c).toLowerCase().trim());
  const colDate   = header.findIndex(c => c === 'дата' || c.includes('transaction date'));
  const colBasis  = header.findIndex(c => c === 'основание' || c.includes('details'));
  const colDebit  = header.findIndex(c => c === 'дебит' || c.includes('debit'));
  const colCredit = header.findIndex(c => c === 'кредит' || c.includes('credit'));

  const results: RawTransaction[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => c === '')) continue;

    const rawDate = String(row[colDate] ?? '').trim();
    if (!rawDate) continue;
    const date = parseFibankDate(rawDate);
    if (!date) continue;

    const debit  = parseFloat(String(row[colDebit]  ?? '').replace(/[^\d.]/g, ''));
    const credit = parseFloat(String(row[colCredit] ?? '').replace(/[^\d.]/g, ''));
    const hasDebit  = !isNaN(debit)  && debit  > 0;
    const hasCredit = !isNaN(credit) && credit > 0;
    if ((!hasDebit && !hasCredit) || (hasDebit && hasCredit)) continue;

    const description = String(row[colBasis] ?? '').trim();
    const descLower = description.toLowerCase();
    if (!description || descLower.includes('салдо') || descLower.includes('обороти')) continue;
    if (descLower.includes('revolut') || descLower.includes('костадинов')) continue;

    results.push({
      date,
      amount: hasDebit ? debit : credit,
      description,
      raw_description: description,
      type: hasDebit ? 'expense' : 'income',
      bank: 'fibank',
    });
  }

  return results;
}
