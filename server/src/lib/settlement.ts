// Bill-splitting settlement engine — pure functions, no DB dependency.
//
// Given a bill's participants and expenses (each with one or more payers and a
// per-participant split), this computes:
//   - matrix[debtor][creditor]  gross "who owes whom" before netting
//   - netPairs                  pairwise-netted directed debts (the simplified view)
//   - balances[p]               > 0 => others owe p; < 0 => p owes others
//   - perPersonTotalCost[p]     what the bill cost p personally (Σ of their effective shares)
//
// Merges ("I pay for my girlfriend"): a participant's share can be redirected to
// another participant ("the coverer"). Two layers, resolved as follows:
//   1. Per-expense override (split.coveredBy): when set, it is the FINAL effective
//      debtor for that share — no further chaining. Set it to the participant's own
//      id to un-merge them for a single expense, overriding the bill-wide link.
//   2. Bill-wide link (participant.coveredBy): when no per-expense override exists,
//      the share follows the bill-wide chain (a -> coveredBy -> ...) with a cycle guard.

export interface SettlementParticipant {
  id: number;
  /** Bill-wide merge: this participant's shares are paid by `coveredBy`. */
  coveredBy?: number | null;
}

export interface ExpensePayer {
  participantId: number;
  amountPaid: number;
}

export interface ExpenseSplit {
  participantId: number;
  shareAmount: number;
  /** Per-expense override of the effective debtor (see module docs). */
  coveredBy?: number | null;
}

export interface SettlementExpense {
  id: number;
  amount: number;
  payers: ExpensePayer[];
  splits: ExpenseSplit[];
}

export interface NetPair {
  from: number; // owes
  to: number; // is owed
  amount: number;
}

export interface SettlementResult {
  matrix: Record<number, Record<number, number>>;
  netPairs: NetPair[];
  balances: Record<number, number>;
  perPersonTotalCost: Record<number, number>;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const EPS = 0.005; // half a cent — treat smaller magnitudes as zero

/**
 * Resolve the effective debtor for a single split.
 * - If the split has a per-expense override, that is final.
 * - Otherwise follow the bill-wide coveredBy chain, guarding against cycles.
 */
function resolveEffectiveDebtor(
  participantId: number,
  splitCoveredBy: number | null | undefined,
  billWideCoveredBy: Map<number, number | null>,
): number {
  if (splitCoveredBy !== null && splitCoveredBy !== undefined) {
    return splitCoveredBy;
  }
  let current = participantId;
  const visited = new Set<number>([current]);
  while (true) {
    const next = billWideCoveredBy.get(current);
    if (next === null || next === undefined) break;
    if (visited.has(next)) break; // cycle — stop here
    visited.add(next);
    current = next;
  }
  return current;
}

export function computeSettlement(
  participants: SettlementParticipant[],
  expenses: SettlementExpense[],
): SettlementResult {
  const ids = participants.map((p) => p.id);
  const billWideCoveredBy = new Map<number, number | null>();
  for (const p of participants) billWideCoveredBy.set(p.id, p.coveredBy ?? null);

  // Accumulators, initialised for every known participant so the output is dense.
  const matrix: Record<number, Record<number, number>> = {};
  const paidBy: Record<number, number> = {};
  const owedEffective: Record<number, number> = {};
  for (const id of ids) {
    matrix[id] = {};
    paidBy[id] = 0;
    owedEffective[id] = 0;
  }
  const addDebt = (debtor: number, creditor: number, amount: number) => {
    if (debtor === creditor || amount === 0) return;
    if (!matrix[debtor]) matrix[debtor] = {};
    matrix[debtor][creditor] = (matrix[debtor][creditor] ?? 0) + amount;
  };

  for (const exp of expenses) {
    const totalPaid = exp.payers.reduce((s, p) => s + p.amountPaid, 0);
    for (const payer of exp.payers) {
      paidBy[payer.participantId] = (paidBy[payer.participantId] ?? 0) + payer.amountPaid;
    }

    for (const split of exp.splits) {
      const debtor = resolveEffectiveDebtor(split.participantId, split.coveredBy, billWideCoveredBy);
      owedEffective[debtor] = (owedEffective[debtor] ?? 0) + split.shareAmount;

      // Distribute this share across the people who funded the expense,
      // proportionally to how much each paid. (Self-portions cancel.)
      if (totalPaid > 0) {
        for (const payer of exp.payers) {
          const portion = split.shareAmount * (payer.amountPaid / totalPaid);
          addDebt(debtor, payer.participantId, portion);
        }
      }
    }
  }

  // Balances and per-person cost.
  const balances: Record<number, number> = {};
  const perPersonTotalCost: Record<number, number> = {};
  for (const id of ids) {
    balances[id] = round2((paidBy[id] ?? 0) - (owedEffective[id] ?? 0));
    perPersonTotalCost[id] = round2(owedEffective[id] ?? 0);
  }

  // Pairwise netting: for each unordered pair keep only the positive direction.
  const netPairs: NetPair[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const net = (matrix[a]?.[b] ?? 0) - (matrix[b]?.[a] ?? 0);
      if (net > EPS) netPairs.push({ from: a, to: b, amount: round2(net) });
      else if (net < -EPS) netPairs.push({ from: b, to: a, amount: round2(-net) });
    }
  }

  // Round the gross matrix for display.
  const roundedMatrix: Record<number, Record<number, number>> = {};
  for (const d of Object.keys(matrix)) {
    const dn = Number(d);
    roundedMatrix[dn] = {};
    for (const c of Object.keys(matrix[dn])) {
      const v = round2(matrix[dn][Number(c)]);
      if (Math.abs(v) > EPS) roundedMatrix[dn][Number(c)] = v;
    }
  }

  return { matrix: roundedMatrix, netPairs, balances, perPersonTotalCost };
}
