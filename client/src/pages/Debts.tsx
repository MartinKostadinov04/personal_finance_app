import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, HandCoins, Pencil, Trash2, Check, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { DebtDialog } from '@/components/DebtDialog';
import { DebtPaymentDialog } from '@/components/DebtPaymentDialog';
import { debtsApi } from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import { formatDisplayDate, toYMD } from '@/lib/dates';
import type { Debt, ContactNet, DebtSummary } from '@/lib/types';

function netLabel(net: number): { text: string; cls: string } {
  if (Math.abs(net) < 0.005) return { text: 'Settled up', cls: 'text-zinc-500' };
  if (net > 0) return { text: `owes you ${formatCurrency(net)}`, cls: 'text-emerald-400' };
  return { text: `you owe ${formatCurrency(-net)}`, cls: 'text-rose-400' };
}

type RowActions = {
  onPay: (d: Debt) => void;
  onEdit: (d: Debt) => void;
  onSettle: (d: Debt) => void;
  onDelete: (d: Debt) => void;
};

export function Debts() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['debts'] });

  const [addOpen, setAddOpen] = useState(false);
  const [editDebt, setEditDebt] = useState<Debt | null>(null);
  const [payDebt, setPayDebt] = useState<Debt | null>(null);
  const [sheetContact, setSheetContact] = useState<ContactNet | null>(null);

  const { data: summary } = useQuery({ queryKey: ['debts', 'summary'], queryFn: () => debtsApi.getSummary() });

  const settle = async (d: Debt) => { await debtsApi.settle(d.id, { note: 'Settled' }); invalidate(); };
  const del = async (d: Debt) => { await debtsApi.remove(d.id); invalidate(); };
  const actions: RowActions = { onPay: setPayDebt, onEdit: setEditDebt, onSettle: settle, onDelete: del };

  return (
    <div>
      <PageHeader title="Debts">
        <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Add debt</Button>
      </PageHeader>

      <SummaryCards summary={summary} />

      <Tabs defaultValue="people" className="mt-6">
        <TabsList>
          <TabsTrigger value="people">By person</TabsTrigger>
          <TabsTrigger value="all">All debts</TabsTrigger>
        </TabsList>
        <TabsContent value="people">
          <ByPerson summary={summary} onOpen={setSheetContact} />
        </TabsContent>
        <TabsContent value="all">
          <AllDebts actions={actions} />
        </TabsContent>
      </Tabs>

      <DebtDialog open={addOpen} onOpenChange={setAddOpen} />
      <DebtDialog open={!!editDebt} onOpenChange={v => !v && setEditDebt(null)} debt={editDebt} />
      <DebtPaymentDialog open={!!payDebt} onOpenChange={v => !v && setPayDebt(null)} debt={payDebt} />
      <ContactSheet contact={sheetContact} onOpenChange={v => !v && setSheetContact(null)} actions={actions} />
    </div>
  );
}

function SummaryCards({ summary }: { summary?: DebtSummary }) {
  const owed = summary?.owedToMe ?? 0;
  const owe = summary?.iOwe ?? 0;
  const net = summary?.net ?? 0;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <MiniCard label="Owed to you" value={owed} cls="text-emerald-400" />
      <MiniCard label="You owe" value={owe} cls="text-rose-400" />
      <MiniCard label="Net position" value={net} cls={net >= 0 ? 'text-emerald-400' : 'text-rose-400'} signed />
    </div>
  );
}

function MiniCard({ label, value, cls, signed }: { label: string; value: number; cls: string; signed?: boolean }) {
  return (
    <Card className="p-4">
      <CardContent className="p-0">
        <p className="text-xs font-medium uppercase tracking-widest text-zinc-400 mb-1">{label}</p>
        <p className={cn('font-mono text-2xl tabular-nums', cls)}>{signed && value > 0 ? '+' : ''}{formatCurrency(value)}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 text-zinc-500">
      <HandCoins className="h-10 w-10 mx-auto mb-3 opacity-40" />
      <p className="text-sm">No debts yet. Add one to track who owes you and whom you owe.</p>
    </div>
  );
}

function ByPerson({ summary, onOpen }: { summary?: DebtSummary; onOpen: (c: ContactNet) => void }) {
  const contacts = summary?.byContact ?? [];
  if (contacts.length === 0) return <EmptyState />;
  return (
    <div className="space-y-2">
      {contacts.map(c => {
        const lbl = netLabel(c.net);
        return (
          <button
            key={c.contactId}
            onClick={() => onOpen(c)}
            className="w-full flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-left transition-colors hover:border-zinc-700"
          >
            <div className="min-w-0">
              <p className="font-medium text-white truncate">{c.name}</p>
              <p className="text-xs text-zinc-600">{c.openCount} open {c.openCount === 1 ? 'debt' : 'debts'}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className={cn('text-sm font-medium', lbl.cls)}>{lbl.text}</span>
              <ChevronRight className="h-4 w-4 text-zinc-600" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Seg<T extends string>({ options, value, onChange }: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-zinc-800 p-0.5">
      {options.map(([v, l]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cn('px-2.5 py-1 text-xs rounded transition-colors', value === v ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white')}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function AllDebts({ actions }: { actions: RowActions }) {
  const [direction, setDirection] = useState<'all' | 'owed_to_me' | 'i_owe'>('all');
  const [status, setStatus] = useState<'open' | 'settled' | 'all'>('open');
  const { data: debts = [], isLoading } = useQuery({
    queryKey: ['debts', 'list', direction, status],
    queryFn: () => debtsApi.getAll({
      direction: direction === 'all' ? undefined : direction,
      status: status === 'all' ? undefined : status,
    }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Seg options={[['all', 'All'], ['owed_to_me', 'They owe me'], ['i_owe', 'I owe']] as const} value={direction} onChange={setDirection} />
        <Seg options={[['open', 'Open'], ['settled', 'Settled'], ['all', 'All']] as const} value={status} onChange={setStatus} />
      </div>
      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : debts.length === 0 ? (
        <p className="text-sm text-zinc-600 py-8 text-center">No debts match these filters.</p>
      ) : (
        <div className="space-y-2">{debts.map(d => <DebtRow key={d.id} debt={d} actions={actions} />)}</div>
      )}
    </div>
  );
}

function ContactSheet({ contact, onOpenChange, actions }: {
  contact: ContactNet | null;
  onOpenChange: (v: boolean) => void;
  actions: RowActions;
}) {
  const { data: debts = [] } = useQuery({
    queryKey: ['debts', 'contact', contact?.contactId],
    queryFn: () => debtsApi.getAll({ contactId: contact!.contactId }),
    enabled: !!contact,
  });

  // Derive the net live from the fetched debts so the header stays in sync after a
  // payment/settle; fall back to the summary value until the list loads.
  const net = debts.length
    ? debts.reduce((s, d) => s + (d.direction === 'owed_to_me' ? d.outstanding : -d.outstanding), 0)
    : (contact?.net ?? 0);

  return (
    <Sheet open={!!contact} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto w-full sm:max-w-md">
        {contact && (
          <>
            <SheetHeader>
              <SheetTitle>{contact.name}</SheetTitle>
              <p className={cn('text-sm font-medium', netLabel(net).cls)}>{netLabel(net).text}</p>
            </SheetHeader>
            <div className="mt-4 space-y-2">
              {debts.length === 0
                ? <p className="text-sm text-zinc-600">No debts.</p>
                : debts.map(d => <DebtRow key={d.id} debt={d} actions={actions} />)}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DebtRow({ debt, actions }: { debt: Debt; actions: RowActions }) {
  const isReceivable = debt.direction === 'owed_to_me';
  const pct = debt.amount > 0 ? Math.min(100, Math.round((debt.paid / debt.amount) * 100)) : 0;
  const overdue = debt.status === 'open' && !!debt.due_date && debt.due_date < toYMD(new Date());

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 rounded-full shrink-0', isReceivable ? 'bg-emerald-500' : 'bg-rose-500')} />
            <span className="font-medium text-white truncate">{debt.contact_name}</span>
            {debt.status === 'settled' && (
              <span className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">Settled</span>
            )}
          </div>
          {debt.description && <p className="ml-4 mt-0.5 truncate text-xs text-zinc-500">{debt.description}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('font-mono font-medium tabular-nums', isReceivable ? 'text-emerald-400' : 'text-rose-400')}>{formatCurrency(debt.outstanding)}</p>
          {debt.status === 'open' && debt.paid > 0 && <p className="text-[11px] text-zinc-600">of {formatCurrency(debt.amount)}</p>}
        </div>
      </div>

      {debt.status === 'open' && debt.paid > 0 && (
        <div className="ml-4 mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div className={cn('h-full', isReceivable ? 'bg-emerald-500' : 'bg-rose-500')} style={{ width: `${pct}%` }} />
        </div>
      )}

      <div className="ml-4 mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-zinc-600">
          {overdue
            ? <span className="text-rose-400">Overdue · {formatDisplayDate(debt.due_date!)}</span>
            : debt.due_date
              ? `Due ${formatDisplayDate(debt.due_date)}`
              : formatDisplayDate(debt.incurred_on)}
        </span>
        <div className="flex items-center gap-1">
          {debt.status === 'open' && <Button size="sm" className="h-7 text-xs" onClick={() => actions.onPay(debt)}>Pay</Button>}
          <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => actions.onEdit(debt)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          {debt.status === 'open' && (
            <Confirm
              trigger={<Button size="icon" variant="ghost" className="h-7 w-7" title="Mark settled"><Check className="h-3.5 w-3.5" /></Button>}
              title={`Mark settled with ${debt.contact_name}?`}
              desc="Clears the remaining balance by recording it as paid. You can undo this by deleting the settle payment."
              action="Mark settled"
              onConfirm={() => actions.onSettle(debt)}
            />
          )}
          <Confirm
            trigger={<Button size="icon" variant="ghost" className="h-7 w-7" title="Delete"><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button>}
            title="Delete this debt?"
            desc="The debt and its payment history are removed. Any linked transactions are not deleted."
            action="Delete"
            danger
            onConfirm={() => actions.onDelete(debt)}
          />
        </div>
      </div>
    </div>
  );
}

function Confirm({ trigger, title, desc, action, danger, onConfirm }: {
  trigger: React.ReactNode;
  title: string;
  desc: string;
  action: string;
  danger?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{desc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className={danger ? 'bg-rose-600 hover:bg-rose-700' : undefined} onClick={onConfirm}>{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
