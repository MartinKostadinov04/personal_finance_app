// Debt-ledger math — pure functions, no DB dependency (mirrors lib/settlement.ts).
//
// A "debt" is money owed in one direction between the user and a named contact:
//   - 'owed_to_me' : the contact owes the user   (a receivable)
//   - 'i_owe'      : the user owes the contact    (a payable)
//
// The outstanding balance is the original amount minus all repayments. It is
// always computed here, never stored, so it can never drift from the payments
// that are the single source of truth.

export type DebtDirection = 'owed_to_me' | 'i_owe';

const EPS = 0.005; // half a cent — treat smaller magnitudes as zero
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Outstanding balance of a debt = amount − Σ payments, floored at 0. */
export function outstanding(amount: number, paid: number): number {
  return round2(Math.max(0, amount - paid));
}

/** A debt is settled once its outstanding balance is within half a cent of zero. */
export function isSettled(outstandingAmount: number): boolean {
  return outstandingAmount <= EPS;
}

export interface DebtLike {
  direction: DebtDirection;
  amount: number;
  paid: number; // Σ payments
}

export interface DebtTotals {
  owedToMe: number; // Σ outstanding of receivables
  iOwe: number;     // Σ outstanding of payables
  net: number;      // owedToMe − iOwe  (+ ⇒ others owe you; − ⇒ you owe)
}

/** Overall totals across a set of debts. Only outstanding amounts count. */
export function summarize(debts: DebtLike[]): DebtTotals {
  let owedToMe = 0;
  let iOwe = 0;
  for (const d of debts) {
    const out = outstanding(d.amount, d.paid);
    if (out <= EPS) continue;
    if (d.direction === 'owed_to_me') owedToMe += out;
    else iOwe += out;
  }
  owedToMe = round2(owedToMe);
  iOwe = round2(iOwe);
  return { owedToMe, iOwe, net: round2(owedToMe - iOwe) };
}

export interface ContactDebtLike extends DebtLike {
  contact_id: number;
  contact_name: string;
}

export interface ContactNet {
  contactId: number;
  name: string;
  owedToMe: number;
  iOwe: number;
  net: number;       // + ⇒ they owe you; − ⇒ you owe them
  openCount: number; // debts with an outstanding balance
}

/**
 * Per-contact net position, for the "by person" view. A contact's net is the
 * sum of outstanding receivables minus outstanding payables. Sorted by the
 * magnitude of the net (largest first), then by name.
 */
export function contactNet(debts: ContactDebtLike[]): ContactNet[] {
  const byContact = new Map<number, ContactNet>();
  for (const d of debts) {
    let c = byContact.get(d.contact_id);
    if (!c) {
      c = { contactId: d.contact_id, name: d.contact_name, owedToMe: 0, iOwe: 0, net: 0, openCount: 0 };
      byContact.set(d.contact_id, c);
    }
    const out = outstanding(d.amount, d.paid);
    if (out <= EPS) continue;
    if (d.direction === 'owed_to_me') c.owedToMe += out;
    else c.iOwe += out;
    c.openCount++;
  }
  const list = [...byContact.values()].map((c) => ({
    ...c,
    owedToMe: round2(c.owedToMe),
    iOwe: round2(c.iOwe),
    net: round2(c.owedToMe - c.iOwe),
  }));
  list.sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.name.localeCompare(b.name));
  return list;
}
