// Standalone verification for the settlement engine. Run with:
//   npx ts-node src/lib/settlement.verify.ts   (from the server/ directory)
// Exits non-zero on the first failed assertion.

import { computeSettlement, SettlementResult } from './settlement';

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}
const close = (a: number, b: number) => Math.abs(a - b) < 0.005;
function sumBalances(r: SettlementResult): number {
  return Object.values(r.balances).reduce((s, v) => s + v, 0);
}
function netOf(r: SettlementResult, from: number, to: number): number {
  const p = r.netPairs.find((x) => x.from === from && x.to === to);
  return p ? p.amount : 0;
}

// Scenario A — equal split, single payer. 1 pays 90, split 30/30/30.
{
  const r = computeSettlement(
    [{ id: 1 }, { id: 2 }, { id: 3 }],
    [{ id: 1, amount: 90, payers: [{ participantId: 1, amountPaid: 90 }], splits: [
      { participantId: 1, shareAmount: 30 },
      { participantId: 2, shareAmount: 30 },
      { participantId: 3, shareAmount: 30 },
    ] }],
  );
  assert(close(netOf(r, 2, 1), 30), 'A: 2 owes 1 = 30');
  assert(close(netOf(r, 3, 1), 30), 'A: 3 owes 1 = 30');
  assert(close(r.balances[1], 60), 'A: balance 1 = +60');
  assert(close(r.balances[2], -30), 'A: balance 2 = -30');
  assert(close(r.perPersonTotalCost[2], 30), 'A: cost 2 = 30');
  assert(close(sumBalances(r), 0), 'A: Σ balances = 0');
}

// Scenario B — multiple payers. 1 pays 70, 2 pays 30; split 50/50.
{
  const r = computeSettlement(
    [{ id: 1 }, { id: 2 }],
    [{ id: 1, amount: 100, payers: [
      { participantId: 1, amountPaid: 70 },
      { participantId: 2, amountPaid: 30 },
    ], splits: [
      { participantId: 1, shareAmount: 50 },
      { participantId: 2, shareAmount: 50 },
    ] }],
  );
  assert(close(netOf(r, 2, 1), 20), 'B: 2 owes 1 = 20');
  assert(close(r.balances[1], 20), 'B: balance 1 = +20');
  assert(close(r.balances[2], -20), 'B: balance 2 = -20');
  assert(close(sumBalances(r), 0), 'B: Σ balances = 0');
}

// Scenario C — bill-wide merge. 2 (gf) covered by 1 (me). 3 pays 90, split 30 each.
{
  const r = computeSettlement(
    [{ id: 1 }, { id: 2, coveredBy: 1 }, { id: 3 }],
    [{ id: 1, amount: 90, payers: [{ participantId: 3, amountPaid: 90 }], splits: [
      { participantId: 1, shareAmount: 30 },
      { participantId: 2, shareAmount: 30 },
      { participantId: 3, shareAmount: 30 },
    ] }],
  );
  assert(close(netOf(r, 1, 3), 60), 'C: 1 owes 3 = 60 (covers gf)');
  assert(close(r.balances[2], 0), 'C: balance 2 (gf) = 0');
  assert(close(r.perPersonTotalCost[1], 60), 'C: cost 1 = 60');
  assert(close(r.perPersonTotalCost[2], 0), 'C: cost 2 = 0');
  assert(close(r.perPersonTotalCost[3], 30), 'C: cost 3 = 30');
  assert(close(sumBalances(r), 0), 'C: Σ balances = 0');
}

// Scenario D — per-expense override un-covers the bill-wide merge.
// 2 covered by 1 bill-wide, but for THIS expense split.coveredBy = 2 (self).
{
  const r = computeSettlement(
    [{ id: 1 }, { id: 2, coveredBy: 1 }, { id: 3 }],
    [{ id: 1, amount: 90, payers: [{ participantId: 3, amountPaid: 90 }], splits: [
      { participantId: 1, shareAmount: 30 },
      { participantId: 2, shareAmount: 30, coveredBy: 2 },
      { participantId: 3, shareAmount: 30 },
    ] }],
  );
  assert(close(netOf(r, 2, 3), 30), 'D: 2 owes 3 = 30 (un-covered)');
  assert(close(netOf(r, 1, 3), 30), 'D: 1 owes 3 = 30 (own share only)');
  assert(close(r.perPersonTotalCost[2], 30), 'D: cost 2 = 30');
  assert(close(sumBalances(r), 0), 'D: Σ balances = 0');
}

// Scenario E — multi-expense, mixed payers, settles to zero.
{
  const r = computeSettlement(
    [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    [
      { id: 1, amount: 100, payers: [{ participantId: 1, amountPaid: 100 }], splits: [
        { participantId: 1, shareAmount: 25 }, { participantId: 2, shareAmount: 25 },
        { participantId: 3, shareAmount: 25 }, { participantId: 4, shareAmount: 25 },
      ] },
      { id: 2, amount: 60, payers: [{ participantId: 2, amountPaid: 60 }], splits: [
        { participantId: 2, shareAmount: 20 }, { participantId: 3, shareAmount: 20 },
        { participantId: 4, shareAmount: 20 },
      ] },
      { id: 3, amount: 33, payers: [
        { participantId: 3, amountPaid: 20 }, { participantId: 4, amountPaid: 13 },
      ], splits: [
        { participantId: 1, shareAmount: 11 }, { participantId: 2, shareAmount: 11 },
        { participantId: 3, shareAmount: 11 },
      ] },
    ],
  );
  assert(close(sumBalances(r), 0), 'E: Σ balances = 0');
  // Total cost across everyone == total of all expenses (100+60+33 = 193).
  const totalCost = Object.values(r.perPersonTotalCost).reduce((s, v) => s + v, 0);
  assert(close(totalCost, 193), 'E: Σ perPersonTotalCost = 193');
}

console.log(`All ${passed} settlement assertions passed.`);
