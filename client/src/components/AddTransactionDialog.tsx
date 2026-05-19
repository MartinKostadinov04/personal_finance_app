import { useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/DatePicker';
import { transactionsApi, categoriesApi } from '@/lib/api';
import { toYMD } from '@/lib/dates';
import type { Category } from '@/lib/types';

interface AddTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'expense' | 'income';
  monthId: number;
}

export function AddTransactionDialog({ open, onOpenChange, type, monthId }: AddTransactionDialogProps) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: toYMD(new Date()),
    description: '',
    amount: '',
    category_id: '',
    bank: 'revolut' as string,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.getAll,
  });

  const filtered = (categories as Category[]).filter(c => c.type === type && c.is_active);

  const reset = () => setForm({ date: toYMD(new Date()), description: '', amount: '', category_id: '', bank: 'revolut' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.amount || !form.description) return;
    setSaving(true);
    try {
      await transactionsApi.create({
        month_id: monthId,
        date: form.date,
        amount: parseFloat(form.amount),
        description: form.description,
        raw_description: null,
        type,
        category_id: form.category_id ? parseInt(form.category_id) : null,
        bank: form.bank as 'revolut' | 'santander' | 'fibank' | 'manual',
      });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['allocation'] });
      reset();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {type === 'expense' ? 'Expense' : 'Income'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <DatePicker value={form.date} onChange={v => setForm(f => ({ ...f, date: v }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Amount (€)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="font-mono"
                required
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Input placeholder="Merchant / description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category_id} onValueChange={v => setForm(f => ({ ...f, category_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {filtered.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.display_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Bank</Label>
              <Select value={form.bank} onValueChange={v => setForm(f => ({ ...f, bank: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="revolut">Revolut</SelectItem>
                  <SelectItem value="santander">Santander</SelectItem>
                  <SelectItem value="fibank">Fibank</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
