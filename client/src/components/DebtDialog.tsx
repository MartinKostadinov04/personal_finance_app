import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DatePicker } from '@/components/DatePicker';
import { debtsApi } from '@/lib/api';
import { toYMD } from '@/lib/dates';
import type { Debt, DebtContact, DebtDirection } from '@/lib/types';

// Create or edit a debt. When `debt` is provided the dialog is in edit mode.
export function DebtDialog({ open, onOpenChange, debt }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  debt?: Debt | null;
}) {
  const qc = useQueryClient();
  const editing = !!debt;
  const { data: contacts = [] } = useQuery({ queryKey: ['debts', 'contacts'], queryFn: () => debtsApi.getContacts(), enabled: open });

  const [direction, setDirection] = useState<DebtDirection>('owed_to_me');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [incurredOn, setIncurredOn] = useState(() => toYMD(new Date()));
  const [hasDue, setHasDue] = useState(false);
  const [dueDate, setDueDate] = useState(() => toYMD(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (debt) {
      setDirection(debt.direction);
      setName(debt.contact_name);
      setAmount(String(debt.amount));
      setDescription(debt.description ?? '');
      setIncurredOn(debt.incurred_on || toYMD(new Date()));
      setHasDue(!!debt.due_date);
      setDueDate(debt.due_date || toYMD(new Date()));
    } else {
      setDirection('owed_to_me'); setName(''); setAmount(''); setDescription('');
      setIncurredOn(toYMD(new Date())); setHasDue(false); setDueDate(toYMD(new Date()));
    }
    setError('');
  }, [open, debt]);

  const amt = parseFloat(amount);
  const canSave = name.trim().length > 0 && Number.isFinite(amt) && amt > 0 && !saving;

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = {
        counterpartyName: name.trim(),
        direction,
        amount: amt,
        description: description.trim() || undefined,
        incurredOn,
        dueDate: hasDue ? dueDate : null,
      };
      if (editing && debt) await debtsApi.update(debt.id, payload);
      else await debtsApi.create(payload);
      qc.invalidateQueries({ queryKey: ['debts'] });
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save debt');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{editing ? 'Edit debt' : 'Add debt'}</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="flex gap-1.5">
            <Button size="sm" variant={direction === 'owed_to_me' ? 'default' : 'outline'} className="flex-1 h-8 text-xs" onClick={() => setDirection('owed_to_me')}>They owe me</Button>
            <Button size="sm" variant={direction === 'i_owe' ? 'default' : 'outline'} className="flex-1 h-8 text-xs" onClick={() => setDirection('i_owe')}>I owe them</Button>
          </div>

          <div className="space-y-1.5">
            <Label>Person</Label>
            <Input list="debt-contacts" placeholder="e.g. Alex" value={name} onChange={e => setName(e.target.value)} />
            <datalist id="debt-contacts">
              {(contacts as DebtContact[]).map(c => <option key={c.id} value={c.name} />)}
            </datalist>
          </div>

          <div className="space-y-1.5">
            <Label>Amount (€)</Label>
            <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Description <span className="text-zinc-600">(optional)</span></Label>
            <Input placeholder="e.g. Concert tickets" value={description} onChange={e => setDescription(e.target.value)} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label className="shrink-0">Date</Label>
            <DatePicker value={incurredOn} onChange={setIncurredOn} />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch checked={hasDue} onCheckedChange={setHasDue} id="hasDue" />
              <Label htmlFor="hasDue">Due date</Label>
            </div>
            {hasDue && <DatePicker value={dueDate} onChange={setDueDate} />}
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={!canSave}>{saving ? 'Saving…' : editing ? 'Save' : 'Add debt'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
