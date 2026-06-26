import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { billsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export function BillDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const defaultMe = (user?.email ?? '').split('@')[0] || 'Me';

  const [name, setName] = useState('');
  const [myName, setMyName] = useState(defaultMe);
  const [others, setOthers] = useState<{ display_name: string; email: string }[]>([{ display_name: '', email: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName('');
      setMyName(defaultMe);
      setOthers([{ display_name: '', email: '' }]);
      setError('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOther = (i: number, patch: Partial<{ display_name: string; email: string }>) =>
    setOthers(prev => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const addOther = () => setOthers(prev => [...prev, { display_name: '', email: '' }]);
  const removeOther = (i: number) => setOthers(prev => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const validOthers = others.filter(o => o.display_name.trim());
  const canSave = !!name.trim() && !!myName.trim() && validOthers.length >= 1 && !saving;

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      const bill = await billsApi.create({
        name: name.trim(),
        myDisplayName: myName.trim(),
        others: validOthers.map(o => ({ display_name: o.display_name.trim(), email: o.email.trim() || undefined })),
      });
      qc.invalidateQueries({ queryKey: ['bills'] });
      onOpenChange(false);
      navigate(`/bills/${bill.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create bill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>New Bill</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Bill name</label>
            <Input placeholder="e.g. Athens Trip 2026" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-zinc-400">Your name in this bill</label>
            <Input value={myName} onChange={e => setMyName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">People (at least 1 other — guests can have an email)</label>
            {others.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input placeholder="Name" value={o.display_name} onChange={e => setOther(i, { display_name: e.target.value })} className="flex-1" />
                <Input placeholder="Email (optional)" value={o.email} onChange={e => setOther(i, { email: e.target.value })} className="flex-1" />
                <button
                  onClick={() => removeOther(i)}
                  disabled={others.length === 1}
                  className="text-zinc-600 hover:text-rose-400 shrink-0 disabled:opacity-30"
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addOther}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add person
            </Button>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={handleCreate} disabled={!canSave}>{saving ? 'Creating…' : 'Create Bill'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
