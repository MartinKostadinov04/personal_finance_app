import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, Check, Receipt, Lock, Unlock, Send, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExpenseDialog } from '@/components/ExpenseDialog';
import { billsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn, formatCurrency } from '@/lib/utils';
import { formatDate } from '@/lib/dates';
import type { BillExpense, NetPair } from '@/lib/types';

export function BillDetail() {
  const { id } = useParams();
  const billId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: detail, isLoading } = useQuery({ queryKey: ['bill', billId], queryFn: () => billsApi.get(billId) });
  const { data: settlement } = useQuery({ queryKey: ['settlement', billId], queryFn: () => billsApi.settlement(billId) });

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editing, setEditing] = useState<BillExpense | null>(null);
  const [newPerson, setNewPerson] = useState('');
  const [pushMsg, setPushMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bill', billId] });
    qc.invalidateQueries({ queryKey: ['settlement', billId] });
    qc.invalidateQueries({ queryKey: ['bills'] });
    qc.invalidateQueries({ queryKey: ['transactions'] });
    qc.invalidateQueries({ queryKey: ['groups'] });
  };

  if (isLoading || !detail) return <p className="text-sm text-zinc-500">Loading…</p>;

  const { bill, participants, expenses } = detail;
  const me = participants.find(p => p.user_id === user?.id);
  const nameOf = (pid: number) => participants.find(p => p.id === pid)?.display_name ?? '?';
  const closed = bill.status === 'closed';

  const openAdd = () => { setEditing(null); setExpenseOpen(true); };
  const openEdit = (e: BillExpense) => { setEditing(e); setExpenseOpen(true); };

  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); invalidate(); } finally { setBusy(false); } };

  const deleteExpense = (e: BillExpense) => {
    if (!confirm(`Delete expense "${e.name}"?`)) return;
    run(() => billsApi.removeExpense(billId, e.id));
  };
  const deleteBill = () => {
    if (!confirm(`Delete the whole bill "${bill.name}"? This cannot be undone.`)) return;
    run(() => billsApi.remove(billId)).then(() => navigate('/bills'));
  };
  const toggleClose = () => run(() => (closed ? billsApi.reopen(billId) : billsApi.close(billId)));
  const markPaid = (pid: number, settled: boolean) => run(() => billsApi.updateParticipant(billId, pid, { settled }));
  const setCovered = (pid: number, covered_by_participant_id: number | null) =>
    run(() => billsApi.updateParticipant(billId, pid, { covered_by_participant_id }));
  const addPerson = () => {
    if (!newPerson.trim()) return;
    run(() => billsApi.addParticipant(billId, { display_name: newPerson.trim() })).then(() => setNewPerson(''));
  };
  const pushToFinance = async () => {
    setBusy(true); setPushMsg('');
    try {
      const r = await billsApi.pushToFinance(billId);
      setPushMsg(`Added ${formatCurrency(r.transaction.amount)} to your finances under group “${r.group.name}”.`);
      invalidate();
    } catch (e) {
      setPushMsg(e instanceof Error ? e.message : 'Push failed');
    } finally { setBusy(false); }
  };

  const owerGroups = new Map<number, NetPair[]>();
  (settlement?.netPairs ?? []).forEach(np => {
    const arr = owerGroups.get(np.from) ?? [];
    arr.push(np);
    owerGroups.set(np.from, arr);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link to="/bills" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300">
          <ArrowLeft className="h-4 w-4" /> Bills
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{bill.name}</h1>
            {closed && <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">Closed</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!closed && <Button onClick={openAdd}><Plus className="h-4 w-4 mr-1.5" /> Add expense</Button>}
            <Button variant="outline" onClick={toggleClose} disabled={busy}>
              {closed ? <><Unlock className="h-4 w-4 mr-1.5" /> Reopen</> : <><Lock className="h-4 w-4 mr-1.5" /> Close bill</>}
            </Button>
            {bill.created_by === user?.id && (
              <Button variant="ghost" size="icon" className="text-rose-500 hover:text-rose-400" onClick={deleteBill} disabled={busy} title="Delete bill">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Expenses */}
        <div>
          <h2 className="mb-2 text-xs uppercase tracking-widest text-zinc-600">Expenses</h2>
          {expenses.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-800 py-10 text-center text-sm text-zinc-600">No expenses yet.</p>
          ) : (
            <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
              {expenses.map(e => (
                <div key={e.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white">{e.name}</p>
                    <p className="text-xs text-zinc-500">{formatDate(e.spent_at.slice(0, 10))} · paid by {(e.payers ?? []).map(p => nameOf(p.participant_id)).join(', ') || '—'}</p>
                  </div>
                  {e.receipt_path && (
                    <button title="View receipt" className="text-zinc-500 hover:text-zinc-300" onClick={async () => { const { url } = await billsApi.receiptUrl(billId, e.id); window.open(url, '_blank'); }}>
                      <Receipt className="h-4 w-4" />
                    </button>
                  )}
                  <span className="font-mono text-sm tabular-nums">{formatCurrency(e.amount)}</span>
                  {!closed && (
                    <>
                      <button className="text-zinc-500 hover:text-zinc-200" onClick={() => openEdit(e)} title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                      <button className="text-zinc-500 hover:text-rose-400" onClick={() => deleteExpense(e)} title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                    </>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-zinc-500">Total</span>
                <span className="font-mono font-medium tabular-nums">{formatCurrency(expenses.reduce((s, e) => s + e.amount, 0))}</span>
              </div>
            </div>
          )}

          {/* People */}
          <h2 className="mb-2 mt-6 text-xs uppercase tracking-widest text-zinc-600">People</h2>
          <div className="space-y-1 rounded-lg border border-zinc-800 p-2">
            {participants.map(p => {
              const bal = settlement?.balances[p.id] ?? 0;
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-2 px-1 py-1.5 text-sm">
                  <span className={cn('flex-1 truncate', p.settled && 'text-zinc-500 line-through')}>
                    {p.display_name}{p.role === 'owner' && <span className="ml-1 text-[10px] text-zinc-600">(you)</span>}
                  </span>
                  <span className={cn('w-24 text-right font-mono text-xs tabular-nums', bal > 0.005 ? 'text-emerald-500' : bal < -0.005 ? 'text-rose-400' : 'text-zinc-500')}>
                    {bal > 0.005 ? `+${formatCurrency(bal)}` : bal < -0.005 ? `−${formatCurrency(Math.abs(bal))}` : '—'}
                  </span>
                  <select
                    className="rounded-md border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-300 outline-none"
                    value={p.covered_by_participant_id ?? ''}
                    onChange={e => setCovered(p.id, e.target.value ? Number(e.target.value) : null)}
                    title="Covered by"
                  >
                    <option value="">pays own</option>
                    {participants.filter(o => o.id !== p.id).map(o => <option key={o.id} value={o.id}>↳ {o.display_name} pays</option>)}
                  </select>
                  <button
                    onClick={() => markPaid(p.id, !p.settled)}
                    className={cn('rounded px-2 py-1 text-[11px]', p.settled ? 'bg-emerald-600/20 text-emerald-400' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}
                    title="Mark settled"
                  >
                    {p.settled ? <><Check className="mr-0.5 inline h-3 w-3" />Paid</> : 'Mark paid'}
                  </button>
                </div>
              );
            })}
            <div className="flex items-center gap-2 px-1 pt-1">
              <Input placeholder="Add a person…" value={newPerson} onChange={e => setNewPerson(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPerson()} className="h-7 flex-1 text-sm" />
              <Button size="sm" variant="outline" className="h-7" onClick={addPerson} disabled={!newPerson.trim()}><UserPlus className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </div>

        {/* Settlement */}
        <div>
          <h2 className="mb-2 text-xs uppercase tracking-widest text-zinc-600">Who owes whom</h2>
          <div className="rounded-lg border border-zinc-800 p-3">
            {(settlement?.netPairs.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-600">All settled up — nobody owes anything.</p>
            ) : (
              <div className="space-y-3">
                {participants.filter(p => owerGroups.has(p.id)).map(p => (
                  <div key={p.id}>
                    <p className="text-xs font-medium text-zinc-300">{p.display_name} owes</p>
                    <div className="mt-1 space-y-0.5">
                      {(owerGroups.get(p.id) ?? []).map(np => (
                        <div key={np.to} className="flex items-center justify-between text-sm">
                          <span className="text-zinc-400">→ {nameOf(np.to)}</span>
                          <span className="font-mono tabular-nums text-rose-400">{formatCurrency(np.amount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-person cost + push to finance */}
          {me && (
            <div className="mt-4 rounded-lg border border-zinc-800 p-3">
              <p className="text-xs text-zinc-400">Your total cost on this bill</p>
              <p className="mt-0.5 font-mono text-lg">{formatCurrency(settlement?.perPersonTotalCost[me.id] ?? 0)}</p>
              <Button className="mt-2 w-full" variant="outline" onClick={pushToFinance} disabled={busy}>
                <Send className="h-4 w-4 mr-1.5" /> Send my total to my transactions
              </Button>
              {pushMsg && <p className="mt-2 text-xs text-emerald-400">{pushMsg}</p>}
            </div>
          )}
        </div>
      </div>

      <ExpenseDialog
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
        billId={billId}
        participants={participants}
        expense={editing}
        myParticipantId={me?.id}
      />
    </div>
  );
}
