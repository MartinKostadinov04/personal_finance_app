import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { BillDialog } from '@/components/BillDialog';
import { billsApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import type { Bill } from '@/lib/types';

export function Bills() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { data: bills = [], isLoading } = useQuery({ queryKey: ['bills'], queryFn: () => billsApi.getAll() });

  const list = bills as Bill[];
  const open = list.filter(b => b.status === 'open');
  const closed = list.filter(b => b.status === 'closed');

  return (
    <div>
      <PageHeader title="Bill Splitting">
        <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> New bill</Button>
      </PageHeader>

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : list.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No bills yet. Start one to split expenses with friends.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <BillGrid title="Open" bills={open} />
          <BillGrid title="Closed" bills={closed} />
        </div>
      )}

      <BillDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function BillGrid({ title, bills }: { title: string; bills: Bill[] }) {
  if (bills.length === 0) return null;
  return (
    <div>
      <h2 className="text-xs uppercase tracking-widest text-zinc-600 mb-2">{title}</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {bills.map(b => (
          <Link
            key={b.id}
            to={`/bills/${b.id}`}
            className="block rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-700"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-white truncate">{b.name}</span>
              {b.status === 'closed' && (
                <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">Closed</span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-sm text-zinc-500">
              <span>{b.participant_count ?? 0} people</span>
              <span className="font-mono tabular-nums">{formatCurrency(b.total_amount ?? 0)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
