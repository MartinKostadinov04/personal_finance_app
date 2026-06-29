import { query } from './db/pg';
import { RawTransaction, CategorizedTransaction, MerchantRule } from './types';

// Categorize purely from the user's merchant rules — fully deterministic and
// bank-agnostic. Rules match the transaction's description text (raw + cleaned),
// so they apply identically to every bank, and a new bank needs no wiring here.
// Anything a rule doesn't match is left uncategorized for the user to handle.
export async function categorize(
  transactions: RawTransaction[],
  userId: string,
): Promise<CategorizedTransaction[]> {
  const rules = await query<MerchantRule>('SELECT * FROM merchant_rules WHERE user_id = $1', [userId]);

  return transactions.map((tx): CategorizedTransaction => {
    // Transfers are never categorized.
    if (tx.type === 'transfer') return { ...tx, category_id: null };

    // Match against BOTH the raw bank text and the cleaned display description, so
    // a rule whose pattern came from either field matches (and manual entries,
    // which may lack raw text, still match). Optional amount constraint (±0.005).
    const rawLower = (tx.raw_description ?? '').toLowerCase();
    const cleanLower = (tx.description ?? '').toLowerCase();
    const matchedRule = rules.find(r => {
      const descMatch = r.match_type === 'regex'
        ? (() => { try { const re = new RegExp(r.pattern, 'i'); return re.test(tx.raw_description ?? '') || re.test(tx.description ?? ''); } catch { return false; } })()
        : (rawLower.includes(r.pattern.toLowerCase()) || cleanLower.includes(r.pattern.toLowerCase()));
      if (!descMatch) return false;
      if (r.match_amount != null) {
        return Math.abs(Math.abs(tx.amount) - Math.abs(r.match_amount)) < 0.005;
      }
      return true;
    });

    if (matchedRule) {
      return {
        ...tx,
        category_id: matchedRule.category_id,
        description: matchedRule.description_clean ?? tx.description,
      };
    }

    // No rule matched → leave uncategorized.
    return { ...tx, category_id: null };
  });
}
