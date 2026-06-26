import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { billsApi } from '@/lib/api';
import { toYMD } from '@/lib/dates';
import { cn, formatCurrency } from '@/lib/utils';
import type { BillParticipant, BillExpense, ExpenseInput } from '@/lib/types';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const selectClass = 'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-white outline-none focus:border-emerald-600';

export function ExpenseDialog({ open, onOpenChange, billId, participants, expense, myParticipantId }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  billId: number;
  participants: BillParticipant[];
  expense?: BillExpense | null;
  myParticipantId?: number;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => toYMD(new Date()));
  const [inSplit, setInSplit] = useState<Set<number>>(new Set());
  const [customSplit, setCustomSplit] = useState(false);
  const [shares, setShares] = useState<Record<number, string>>({});
  const [multiPay, setMultiPay] = useState(false);
  const [singlePayer, setSinglePayer] = useState<number | null>(null);
  const [payAmounts, setPayAmounts] = useState<Record<number, string>>({});
  const [covered, setCovered] = useState<Record<number, number | ''>>({});
  const [advanced, setAdvanced] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (expense) {
      setName(expense.name);
      setAmount(String(expense.amount));
      setDate(expense.spent_at.slice(0, 10));
      const splits = expense.splits ?? [];
      setInSplit(new Set(splits.map(s => s.participant_id)));
      setShares(Object.fromEntries(splits.map(s => [s.participant_id, String(s.share_amount)])));
      setCustomSplit(true);
      const cov: Record<number, number | ''> = {};
      splits.forEach(s => { if (s.covered_by_participant_id) cov[s.participant_id] = s.covered_by_participant_id; });
      setCovered(cov);
      const payers = expense.payers ?? [];
      if (payers.length <= 1) { setMultiPay(false); setSinglePayer(payers[0]?.participant_id ?? null); }
      else { setMultiPay(true); setPayAmounts(Object.fromEntries(payers.map(p => [p.participant_id, String(p.amount_paid)]))); }
    } else {
      setName('');
      setAmount('');
      setDate(toYMD(new Date()));
      setInSplit(new Set(participants.map(p => p.id)));
      setShares({});
      setCustomSplit(false);
      setMultiPay(false);
      setSinglePayer(myParticipantId ?? participants[0]?.id ?? null);
      setPayAmounts({});
      setCovered({});
    }
    setAdvanced(false);
    setFile(null);
    setError('');
  }, [open, expense]); // eslint-disable-line react-hooks/exhaustive-deps

  const amt = parseFloat(amount) || 0;
  const participantsIn = participants.filter(p => inSplit.has(p.id));

  const equalShares = (): Record<number, number> => {
    const n = participantsIn.length;
    if (n === 0 || amt <= 0) return {};
    const base = Math.floor((amt / n) * 100) / 100;
    const out: Record<number, number> = {};
    participantsIn.forEach(p => (out[p.id] = base));
    const rem = round2(amt - base * n);
    if (participantsIn[0]) out[participantsIn[0].id] = round2(base + rem);
    return out;
  };
  const effShares = (): Record<number, number> => {
    if (!customSplit) return equalShares();
    const out: Record<number, number> = {};
    participantsIn.forEach(p => (out[p.id] = parseFloat(shares[p.id] ?? '') || 0));
    return out;
  };
  const es = effShares();
  const sharesSum = round2(Object.values(es).reduce((a, b) => a + b, 0));

  const payerEntries = (): { participant_id: number; amount_paid: number }[] => {
    if (!multiPay) return singlePayer != null && amt > 0 ? [{ participant_id: singlePayer, amount_paid: round2(amt) }] : [];
    return Object.entries(payAmounts)
      .map(([pid, v]) => ({ participant_id: Number(pid), amount_paid: parseFloat(v) || 0 }))
      .filter(p => p.amount_paid > 0);
  };
  const paySum = round2(payerEntries().reduce((a, b) => a + b.amount_paid, 0));

  const toggleIn = (id: number) => setInSplit(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const splitsValid = Math.abs(sharesSum - amt) < 0.01 && amt > 0 && participantsIn.length > 0;
  const payValid = Math.abs(paySum - amt) < 0.01 && amt > 0;
  const canSave = !!name.trim() && amt > 0 && splitsValid && payValid && !saving;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const input: ExpenseInput = {
        name: name.trim(),
        amount: round2(amt),
        spent_at: date,
        payers: payerEntries(),
        splits: participantsIn.map(p => ({
          participant_id: p.id,
          share_amount: round2(es[p.id] ?? 0),
          covered_by_participant_id: covered[p.id] ? Number(covered[p.id]) : null,
        })),
      };
      let expenseId = expense?.id;
      if (expense) await billsApi.updateExpense(billId, expense.id, input);
      else { const r = await billsApi.addExpense(billId, input); expenseId = r.expense.id; }
      if (file && expenseId) await billsApi.uploadReceipt(billId, expenseId, file);
      qc.invalidateQueries({ queryKey: ['bill', billId] });
      qc.invalidateQueries({ queryKey: ['settlement', billId] });
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{expense ? 'Edit expense' : 'New expense'}</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="flex gap-2">
            <Input placeholder="What was it? (e.g. Dinner)" value={name} onChange={e => setName(e.target.value)} className="flex-1" />
            <Input type="number" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="w-28 text-right font-mono" />
          </div>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-44" />

          {/* Who splits it */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-zinc-400">Split between</span>
              <div className="flex gap-1.5">
                <Button size="sm" variant={!customSplit ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => setCustomSplit(false)}>Equally</Button>
                <Button size="sm" variant={customSplit ? 'default' : 'outline'} className="h-6 px-2 text-[11px]" onClick={() => { setShares(Object.fromEntries(participantsIn.map(p => [p.id, String(es[p.id] ?? 0)]))); setCustomSplit(true); }}>Custom</Button>
              </div>
            </div>
            <div className="space-y-1 rounded-md border border-zinc-800 p-2">
              {participants.map(p => {
                const checked = inSplit.has(p.id);
                return (
                  <div key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={checked} onChange={() => toggleIn(p.id)} className="accent-emerald-500" />
                    <span className={cn('flex-1 truncate', !checked && 'text-zinc-600')}>{p.display_name}</span>
                    {checked && (customSplit ? (
                      <input
                        type="number" step="0.01"
                        value={shares[p.id] ?? ''}
                        onChange={e => setShares(s => ({ ...s, [p.id]: e.target.value }))}
                        className="w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-right font-mono text-xs outline-none focus:border-emerald-600"
                      />
                    ) : (
                      <span className="w-24 text-right font-mono text-xs text-zinc-400">{formatCurrency(es[p.id] ?? 0)}</span>
                    ))}
                  </div>
                );
              })}
            </div>
            <p className={cn('mt-1 text-xs', Math.abs(sharesSum - amt) < 0.01 ? 'text-zinc-500' : 'text-amber-400')}>
              Shares total {formatCurrency(sharesSum)} of {formatCurrency(amt)}
            </p>
          </div>

          {/* Who paid */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-zinc-400">Paid by</span>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => setMultiPay(m => !m)}>
                {multiPay ? 'Single payer' : 'Multiple payers'}
              </Button>
            </div>
            {!multiPay ? (
              <select className={cn(selectClass, 'w-full')} value={singlePayer ?? ''} onChange={e => setSinglePayer(Number(e.target.value))}>
                {participants.map(p => <option key={p.id} value={p.id}>{p.display_name} — pays {formatCurrency(amt)}</option>)}
              </select>
            ) : (
              <div className="space-y-1 rounded-md border border-zinc-800 p-2">
                {participants.map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{p.display_name}</span>
                    <input
                      type="number" step="0.01" placeholder="0.00"
                      value={payAmounts[p.id] ?? ''}
                      onChange={e => setPayAmounts(a => ({ ...a, [p.id]: e.target.value }))}
                      className="w-24 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-right font-mono text-xs outline-none focus:border-emerald-600"
                    />
                  </div>
                ))}
                <p className={cn('text-xs', Math.abs(paySum - amt) < 0.01 ? 'text-zinc-500' : 'text-amber-400')}>
                  Paid total {formatCurrency(paySum)} of {formatCurrency(amt)}
                </p>
              </div>
            )}
          </div>

          {/* Advanced: per-person merge (covered by) */}
          <div>
            <button className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setAdvanced(a => !a)}>
              {advanced ? '▾' : '▸'} Cover someone’s share (e.g. you pay for a partner)
            </button>
            {advanced && (
              <div className="mt-1.5 space-y-1 rounded-md border border-zinc-800 p-2">
                {participantsIn.map(p => (
                  <div key={p.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{p.display_name}’s share paid by</span>
                    <select
                      className={selectClass}
                      value={covered[p.id] ?? ''}
                      onChange={e => setCovered(c => ({ ...c, [p.id]: e.target.value ? Number(e.target.value) : '' }))}
                    >
                      <option value="">— themselves —</option>
                      {participants.filter(o => o.id !== p.id).map(o => <option key={o.id} value={o.id}>{o.display_name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Receipt */}
          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Receipt (optional)</label>
            <input
              type="file" accept="image/*" capture="environment"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200"
            />
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={!canSave}>{saving ? 'Saving…' : expense ? 'Save changes' : 'Add expense'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
