import Anthropic from '@anthropic-ai/sdk';
import { query } from './db/pg';
import { RawTransaction, CategorizedTransaction, Category, MerchantRule } from './types';

const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });

export async function categorize(
  transactions: RawTransaction[],
  userId: string,
): Promise<CategorizedTransaction[]> {
  const categories = await query<Pick<Category, 'id' | 'name' | 'display_name'>>(
    'SELECT id, name, display_name FROM categories WHERE user_id = $1 AND is_active = 1', [userId],
  );
  const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c.id]));

  const rules = await query<MerchantRule>('SELECT * FROM merchant_rules WHERE user_id = $1', [userId]);

  const results: CategorizedTransaction[] = [];
  const unmatched: Array<{ idx: number; tx: RawTransaction }> = [];

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];

    // Step 1: Transfer check
    if (tx.type === 'transfer') {
      results.push({ ...tx, category_id: null });
      continue;
    }

    // Step 2: Merchant rules lookup. Match against BOTH the raw bank text and the
    // cleaned display description, so a rule whose pattern came from either field
    // matches (and manual entries, which may lack raw text, still match).
    const rawLower = (tx.raw_description ?? '').toLowerCase();
    const cleanLower = (tx.description ?? '').toLowerCase();
    const matchedRule = rules.find(r => {
      const descMatch = r.match_type === 'regex'
        ? (() => { try { const re = new RegExp(r.pattern, 'i'); return re.test(tx.raw_description ?? '') || re.test(tx.description ?? ''); } catch { return false; } })()
        : (rawLower.includes(r.pattern.toLowerCase()) || cleanLower.includes(r.pattern.toLowerCase()));
      if (!descMatch) return false;
      // Optional amount constraint (±0.005 tolerance)
      if (r.match_amount != null) {
        return Math.abs(Math.abs(tx.amount) - Math.abs(r.match_amount)) < 0.005;
      }
      return true;
    });

    if (matchedRule) {
      results.push({
        ...tx,
        category_id: matchedRule.category_id,
        description: matchedRule.description_clean ?? tx.description,
      });
      continue;
    }

    // Queue for AI
    results.push({ ...tx, category_id: null }); // placeholder
    unmatched.push({ idx: i, tx });
  }

  if (unmatched.length === 0) return results;

  // Step 3: AI batch call
  try {
    const categoryNames = categories.map(c => c.name).join(', ');
    const txList = unmatched.map(({ idx, tx }) => ({
      id: idx,
      description: tx.raw_description,
      type: tx.type,
      amount: tx.amount,
    }));

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: `You are a personal finance categorizer. Categorize transactions into one of these categories: ${categoryNames}.
Return ONLY a JSON array with no extra text. Each item: {"id": <number>, "category": "<category_name>", "description_clean": "<clean short merchant name>"}
Rules:
- description_clean should be a clean, short merchant/payee name (max 40 chars)
- If unsure, use "other"
- category must exactly match one of the provided category names`,
      messages: [
        {
          role: 'user',
          content: `Categorize these transactions:\n${JSON.stringify(txList, null, 2)}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const aiResults: Array<{ id: number; category: string; description_clean: string }> = JSON.parse(jsonMatch[0]);

      for (const item of aiResults) {
        const matched = unmatched.find(u => u.idx === item.id);
        if (!matched) continue;
        const { idx } = matched;
        const categoryId = categoryByName.get(item.category.toLowerCase()) ?? null;
        results[idx] = {
          ...results[idx],
          category_id: categoryId,
          description: item.description_clean || results[idx].description,
        };
      }
    }
  } catch (err) {
    console.error('AI categorization failed:', err);
  }

  return results;
}
