import { query, withTx } from './pg';

const EXPENSE_CATEGORIES = [
  { name: 'groceries', display_name: 'Groceries', color: '#22c55e', sort_order: 1 },
  { name: 'restaurants', display_name: 'Restaurants, snacks', color: '#f97316', sort_order: 2 },
  { name: 'home_products', display_name: 'Home products', color: '#06b6d4', sort_order: 3 },
  { name: 'rent', display_name: 'Rent', color: '#8b5cf6', sort_order: 4 },
  { name: 'water_heating', display_name: 'Water, heating, cooling', color: '#3b82f6', sort_order: 5 },
  { name: 'electricity', display_name: 'Electricity', color: '#eab308', sort_order: 6 },
  { name: 'phone_internet', display_name: 'Phone & Internet', color: '#14b8a6', sort_order: 7 },
  { name: 'subscriptions', display_name: 'Subscriptions', color: '#a855f7', sort_order: 8 },
  { name: 'misc_purchases', display_name: 'Misc. Purchases', color: '#6b7280', sort_order: 9 },
  { name: 'transportation', display_name: 'Transportation', color: '#f59e0b', sort_order: 10 },
  { name: 'other', display_name: 'Other', color: '#71717a', sort_order: 11 },
];

const INCOME_CATEGORIES = [
  { name: 'vigalex', display_name: 'Vigalex', color: '#10b981', sort_order: 1 },
  { name: 'allowance_f', display_name: 'Allowance (f)', color: '#34d399', sort_order: 2 },
  { name: 'allowance_m', display_name: 'Allowance (m)', color: '#6ee7b7', sort_order: 3 },
  { name: 'extra', display_name: 'Extra', color: '#a7f3d0', sort_order: 4 },
];

/** Seed the default category set for a user. No-op if they already have any. */
export async function seedCategories(userId: string): Promise<void> {
  const rows = await query<{ c: number }>('SELECT COUNT(*)::int AS c FROM categories WHERE user_id = $1', [userId]);
  if (rows[0].c > 0) return;

  await withTx(async (client) => {
    const insert = (name: string, display: string, type: string, color: string, sort: number) =>
      client.query(
        `INSERT INTO categories (user_id, name, display_name, type, color, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, name) DO NOTHING`,
        [userId, name, display, type, color, sort],
      );
    for (const cat of EXPENSE_CATEGORIES) await insert(cat.name, cat.display_name, 'expense', cat.color, cat.sort_order);
    for (const cat of INCOME_CATEGORIES) await insert(cat.name, cat.display_name, 'income', cat.color, cat.sort_order);
  });
}
