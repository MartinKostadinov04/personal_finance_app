// Standalone verification for the debt-ledger math. Run with:
//   npx ts-node src/lib/debts.verify.ts   (from the server/ directory)
// Exits non-zero on the first failed assertion.

import { outstanding, isSettled, summarize, contactNet, ContactDebtLike } from './debts';

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  passed++;
}
const close = (a: number, b: number) => Math.abs(a - b) < 0.005;

// outstanding — partial, full, and over-payment (floored at 0).
assert(close(outstanding(100, 40), 60), 'outstanding 100−40 = 60');
assert(close(outstanding(100, 100), 0), 'outstanding 100−100 = 0');
assert(close(outstanding(100, 120), 0), 'outstanding floors at 0');
assert(close(outstanding(50, 0), 50), 'outstanding with no payments = full');

// isSettled — epsilon threshold.
assert(isSettled(0), 'isSettled 0');
assert(isSettled(0.004), 'isSettled within half a cent');
assert(!isSettled(0.01), 'not settled at 1 cent');

// summarize — receivables vs payables, settled excluded.
{
  const t = summarize([
    { direction: 'owed_to_me', amount: 100, paid: 40 }, // +60
    { direction: 'owed_to_me', amount: 30, paid: 30 },  // settled → 0
    { direction: 'i_owe', amount: 200, paid: 50 },      // −150
  ]);
  assert(close(t.owedToMe, 60), 'summary owedToMe = 60');
  assert(close(t.iOwe, 150), 'summary iOwe = 150');
  assert(close(t.net, -90), 'summary net = −90 (you owe more)');
}

// contactNet — per-person net, openCount, settled excluded, sorted by |net|.
{
  const debts: ContactDebtLike[] = [
    { contact_id: 1, contact_name: 'Alex', direction: 'owed_to_me', amount: 50, paid: 20 }, // +30
    { contact_id: 1, contact_name: 'Alex', direction: 'owed_to_me', amount: 10, paid: 0 },  // +10
    { contact_id: 1, contact_name: 'Alex', direction: 'i_owe', amount: 5, paid: 0 },         // −5  → net +35
    { contact_id: 2, contact_name: 'Mom', direction: 'i_owe', amount: 200, paid: 0 },        // −200
    { contact_id: 3, contact_name: 'Sam', direction: 'owed_to_me', amount: 40, paid: 40 },   // settled
  ];
  const rows = contactNet(debts);
  const alex = rows.find((r) => r.contactId === 1)!;
  const mom = rows.find((r) => r.contactId === 2)!;
  const sam = rows.find((r) => r.contactId === 3)!;
  assert(close(alex.net, 35), 'Alex net = +35');
  assert(alex.openCount === 3, 'Alex openCount = 3');
  assert(close(mom.net, -200), 'Mom net = −200');
  assert(close(sam.net, 0) && sam.openCount === 0, 'Sam fully settled → net 0, openCount 0');
  // Sorted by |net| desc: Mom (200) before Alex (35) before Sam (0).
  assert(rows[0].contactId === 2 && rows[1].contactId === 1 && rows[2].contactId === 3, 'sorted by |net| desc');
}

console.log(`All ${passed} debt assertions passed.`);
