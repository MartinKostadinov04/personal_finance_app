import { one } from './pg';

// Ownership guards for client-supplied foreign keys. Write endpoints accept
// month_id / category_id from the request body; these confirm the referenced
// row belongs to the caller before we attach data to it, so a crafted request
// can't pollute or overwrite another tenant's rows.

/** True if the month belongs to the user. */
export async function userOwnsMonth(userId: string, monthId: number): Promise<boolean> {
  return !!(await one('SELECT 1 FROM months WHERE id = $1 AND user_id = $2', [monthId, userId]));
}

/** True if the category belongs to the user. */
export async function userOwnsCategory(userId: string, categoryId: number): Promise<boolean> {
  return !!(await one('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [categoryId, userId]));
}

/** True if the debt belongs to the user. */
export async function userOwnsDebt(userId: string, debtId: number): Promise<boolean> {
  return !!(await one('SELECT 1 FROM debts WHERE id = $1 AND user_id = $2', [debtId, userId]));
}
