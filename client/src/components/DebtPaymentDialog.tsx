import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DatePicker } from '@/components/DatePicker';
import { debtsApi, categoriesApi } from '@/lib/api';
import { toYMD } from '@/lib/dates';
import { formatCurrency, cn } from '@/lib/utils';
import type { Debt, Category } from '@/lib/types';

const BANKS = [['revolut', 'Revolut'], ['santander', 'Santander'], ['fibank', 'Fibank'], ['manual', 'Manual']] as const;

// Record a repayment against a debt, optionally also posting it as a real
// income/expense so finance balances stay accurate.
export function DebtPaymentDialog({ open, onOpenChange, debt }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  debt: Debt | null;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(() => toYMD(new Date()));
  const [note, setNote] = useState('');
  const [record, setRecord] = useState(false);
  const [bank, setBank] = useState('manual');
  const [categoryId, setCategoryId] = useState('none');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const txType: 'income' | 'expense' = debt?.direction === 'owed_to_me' ? 'income' : 'expense';
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: () => categoriesApi.getAll(), enabled: open && record });
  const cats = (categories as Category[]).filter(c => c.type === txType && c.is_active);

  useEffect(() => {
    if (open && debt) {
      setAmount(debt.outstanding > 0 ? String(debt.outstanding) : '');
      setPaidOn(toYMD(new Date()));
      setNote(''); setRecord(false); setBank('manual'); setCategoryId('none'); setError('');
    }
  }, [open, debt]);

  if (!debt) return null;

  const amt = parseFloat(amount);
  const overpay = Number.isFinite(amt) && amt > debt.outstanding + 0.005;
  const canSave = Number.isFinite(amt) && amt > 0 && !overpay && !saving;

  const save = async () => {
    setSaving(true); setError('');
    try {
      await debtsApi.addPayment(debt.id, {
        amount: amt,
        paidOn,
        note: note.trim() || undefined,
        recordTransaction: record ? { bank, category_id: categoryId === 'none' ? null : Number(categoryId) } : null,
      });
      qc.invalidateQueries({ queryKey: ['debts'] });
      if (record) ['transactions', 'summary', 'allocation'].forEach(k => qc.invalidateQueries({ queryKey: [k] }));
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Record payment — {debt.contact_name}</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <p className="text-xs text-zinc-500">Outstanding: <span className="font-mono text-zinc-300">{formatCurrency(debt.outstanding)}</span></p>

          <div className="space-y-1.5">
            <Label>Amount (€)</Label>
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
            {overpay && <p className="text-xs text-rose-400">Exceeds the outstanding balance.</p>}
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label className="shrink-0">Date</Label>
            <DatePicker value={paidOn} onChange={setPaidOn} />
          </div>

          <div className="space-y-1.5">
            <Label>Note <span className="text-zinc-600">(optional)</span></Label>
            <Input value={note} onChange={e => setNote(e.target.value)} />
          </div>

          <div className="rounded-md border border-zinc-800 p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Switch checked={record} onCheckedChange={setRecord} id="record-tx" />
              <Label htmlFor="record-tx">Also record as a transaction</Label>
            </div>
            {record && (
              <>
                <p className="text-xs text-zinc-500">
                  Creates an <span className={txType === 'income' ? 'text-emerald-400' : 'text-rose-400'}>{txType}</span> of {formatCurrency(Number.isFinite(amt) ? amt : 0)} so your balances stay accurate.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Account</Label>
                    <Select value={bank} onValueChange={setBank}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {BANKS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Select value={categoryId} onValueChange={setCategoryId}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {cats.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.display_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}
          </div>

          {error && <p className={cn('text-xs', 'text-rose-400')}>{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Record payment'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
