import { useState, useMemo, useRef, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel,
  createColumnHelper, flexRender, type SortingState, type PaginationState, type RowData,
} from '@tanstack/react-table';
import { Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { CategoryBadge } from './CategoryBadge';
import { BankBadge } from './BankBadge';
import { DatePicker } from './DatePicker';
import { transactionsApi, categoriesApi } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { formatDisplayDate } from '@/lib/dates';
import type { Transaction, Category } from '@/lib/types';

// Per-column styling hook: columns set meta.className to control their <th>/<td>.
// 'w-0 whitespace-nowrap' makes a column shrink-to-fit its widest cell
// (Excel-style autofit); columns without it share the remaining width.
declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string;
  }
}

// Stable module-level references — calling these inside the component body
// creates new function instances every render, which causes useReactTable to
// think its config changed and triggers internal state updates → infinite loop.
const _getCoreRowModel = getCoreRowModel();
const _getPaginationRowModel = getPaginationRowModel();
const _getSortedRowModel = getSortedRowModel();

const col = createColumnHelper<Transaction>();

// Loose client-side match mirroring the server's unified search — used to decide
// whether a collapsed group row should surface while a search is active.
function txMatches(t: Transaction, term: string): boolean {
  const hay = [
    t.description, t.raw_description, t.category_display_name, t.category_name,
    t.bank, t.amount?.toFixed(2), t.date, formatDate(t.date),
  ];
  return hay.some(h => h != null && String(h).toLowerCase().includes(term));
}

interface TransactionTableProps {
  monthId: number;
  type: 'expense' | 'income';
  search?: string;
  categoryFilter?: string;
}

export const TransactionTable = memo(function TransactionTable({ monthId, type, search, categoryFilter }: TransactionTableProps) {
  const qc = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [detail, setDetail] = useState<{ tx: Transaction; x: number; y: number } | null>(null);

  // 'groups' is a sentinel filter (show only group rows); a numeric value filters
  // individual rows by real category id.
  const catId = categoryFilter && categoryFilter !== 'groups' ? parseInt(categoryFilter) : undefined;
  const { data: rawTransactions, isLoading } = useQuery({
    queryKey: ['transactions', { monthId, type, search, categoryFilter }],
    queryFn: () => transactionsApi.getAll({ monthId, type, search, categoryId: catId }),
    enabled: !!monthId,
  });
  // Stable reference: avoids passing a new [] to useReactTable on every render
  // when data is undefined (loading), which would trigger internal table re-computation.
  const transactions = useMemo(() => rawTransactions ?? [], [rawTransactions]);

  const { data: rawCategories } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll });
  const categories = useMemo(() => rawCategories ?? [], [rawCategories]);

  // All grouped transactions this month, BOTH types — needed to compute each
  // group's net and decide which table (expense/income) its collapsed row lands in.
  const { data: rawGroupedMembers } = useQuery({
    queryKey: ['transactions', { monthId, grouped: true }],
    queryFn: () => transactionsApi.getAll({ monthId, grouped: true }),
    enabled: !!monthId,
  });
  const groupedMembers = useMemo(() => rawGroupedMembers ?? [], [rawGroupedMembers]);

  // Collapse: drop grouped members from the individual rows, then append one
  // synthetic row per group whose month-net places it in THIS table (net spend →
  // expense table; net positive → income table).
  const tableData = useMemo(() => {
    // 'groups' → only group rows; a specific category → only its individual rows
    // (no group rows, since a group has no single category); else → both.
    const onlyGroups = categoryFilter === 'groups';
    const showGroups = !categoryFilter || onlyGroups;
    const ungrouped = onlyGroups ? [] : transactions.filter(t => t.group_id == null);

    const byGroup = new Map<number, { name: string; color: string; exp: number; inc: number; lastDate: string; bill_id: number | null; tx_id: number | null; memberCount: number }>();
    for (const m of groupedMembers) {
      if (m.group_id == null) continue;
      let g = byGroup.get(m.group_id);
      if (!g) {
        g = { name: m.group_name ?? 'group', color: m.group_color ?? '#71717a', exp: 0, inc: 0, lastDate: m.date, bill_id: null, tx_id: null, memberCount: 0 };
        byGroup.set(m.group_id, g);
      }
      g.memberCount++;
      if (m.type === 'income') g.inc += m.amount; else g.exp += m.amount;
      if (m.date > g.lastDate) g.lastDate = m.date;
      if (m.bill_id != null && g.bill_id == null) { g.bill_id = m.bill_id; g.tx_id = m.id; }
      else if (g.memberCount === 1) g.tx_id = m.id;  // single-member group: track real id for delete
    }

    const term = (search ?? '').trim().toLowerCase();
    const groupRows: Transaction[] = [];
    for (const [gid, g] of showGroups ? byGroup : []) {
      const net = g.inc - g.exp;
      const placement: 'expense' | 'income' = net >= 0 ? 'income' : 'expense';
      if (placement !== type) continue;
      if (term) {
        const members = groupedMembers.filter(m => m.group_id === gid);
        if (!g.name.toLowerCase().includes(term) && !members.some(m => txMatches(m, term))) continue;
      }
      groupRows.push({
        id: g.tx_id ?? -gid,
        month_id: monthId,
        date: g.lastDate,
        amount: Math.abs(net),
        description: g.name,
        raw_description: null,
        type,
        category_id: null,
        category_display_name: `group:${g.name}`,
        category_color: g.color,
        group_id: gid,
        group_name: g.name,
        group_color: g.color,
        bill_id: g.bill_id,
        bank: 'manual',
        manually_reviewed: 1,
        created_at: '',
      });
    }
    return [...ungrouped, ...groupRows];
  }, [transactions, groupedMembers, type, search, monthId, categoryFilter]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => transactionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['allocation'] });
    },
  });

  // Stable ref so columns memo doesn't re-create on every mutation object reference change
  const deleteMutateRef = useRef(deleteMutation.mutate);
  deleteMutateRef.current = deleteMutation.mutate;

  const navigate = useNavigate();

  const columns = useMemo(() => [
    col.accessor('date', {
      header: 'Date',
      cell: i => <span className="text-zinc-400 text-xs tabular-nums">{formatDate(i.getValue())}</span>,
      meta: { className: 'w-0 whitespace-nowrap' },
    }),
    col.accessor('category_id', {
      header: 'Category',
      // Read-only badge — category is changed via the edit sheet (pencil).
      cell: i => {
        const tx = i.row.original;
        return tx.category_display_name
          ? <CategoryBadge category={{ display_name: tx.category_display_name, color: tx.category_color ?? '#71717a' }} />
          : <span className="text-xs text-zinc-600">Uncategorized</span>;
      },
      meta: { className: 'w-0 whitespace-nowrap' },
    }),
    col.accessor('description', {
      header: 'Description',
      // w-full claims all leftover width, max-w-0 caps it so truncate works;
      // full text lives in the row bubble and the native title tooltip.
      cell: i => <span className="text-sm truncate block" title={i.getValue()}>{i.getValue()}</span>,
      meta: { className: 'w-full max-w-0' },
    }),
    col.accessor('amount', {
      header: 'Amount',
      cell: i => (
        <span className={cn('font-mono tabular-nums text-sm text-right block',
          type === 'income' ? 'text-emerald-500' : 'text-rose-400'
        )}>
          {formatCurrency(i.getValue())}
        </span>
      ),
      meta: { className: 'w-0 whitespace-nowrap text-right' },
    }),
    col.display({
      id: 'actions',
      cell: i => {
        const tx = i.row.original;

        if (tx.bill_id != null) {
          return (
            <div className="flex gap-1 justify-end">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigate(`/bills/${tx.bill_id}`)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
                    <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => deleteMutateRef.current(tx.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          );
        }

        if (tx.group_id != null) {
          // Single-member group (e.g. bill was deleted, transaction orphaned): show delete only.
          // Multi-member groups use a synthetic negative id and have no single tx to target.
          if (tx.id > 0) {
            return (
              <div className="flex gap-1 justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-400">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => deleteMutateRef.current(tx.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            );
          }
          return null;
        }

        return (
          <div className="flex gap-1 justify-end">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditTx(tx)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => deleteMutateRef.current(tx.id)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        );
      },
      meta: { className: 'w-0 whitespace-nowrap' },
    }),
  ], [type, navigate]);

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
    getCoreRowModel: _getCoreRowModel,
    getPaginationRowModel: _getPaginationRowModel,
    getSortedRowModel: _getSortedRowModel,
  });

  // Footer reflects the displayed rows, so grouped rows contribute their NET.
  // For a mixed group this intentionally differs from the Dashboard's gross
  // expense/income totals (flagged with a note below).
  const total = tableData.reduce((s, t) => s + t.amount, 0);
  const hasGroupRow = tableData.some(t => t.group_id != null);

  if (isLoading) return <div className="text-zinc-500 text-sm py-4">Loading…</div>;

  return (
    <div>
      <div className="border border-zinc-800 rounded-md overflow-x-auto">
        {/* Phone: fixed min-width so columns keep proper room and the card scrolls
            horizontally; md+ autofits to the container. */}
        <table className="w-full min-w-[600px] md:min-w-0 text-sm">
          <thead className="bg-zinc-800/50">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(h => (
                  <th
                    key={h.id}
                    className={cn(
                      'px-3 py-2 text-left text-xs text-zinc-400 font-medium cursor-pointer select-none',
                      h.column.columnDef.meta?.className
                    )}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {h.column.getIsSorted() === 'asc' ? ' ↑' : h.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {table.getRowModel().rows.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-zinc-600 text-sm">No transactions</td></tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr
                  key={row.id}
                  className="hover:bg-zinc-800/30 cursor-pointer"
                  onClick={e => {
                    // Ignore clicks on the category select, action buttons, etc.
                    if ((e.target as HTMLElement).closest('button, [role="combobox"], input, a')) return;
                    setDetail({ tx: row.original, x: e.clientX, y: e.clientY });
                  }}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className={cn('px-3 py-2', cell.column.columnDef.meta?.className)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t border-zinc-800 bg-zinc-800/20">
            <tr>
              <td colSpan={3} className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
                {tableData.length} rows{hasGroupRow && <span className="text-zinc-600"> · net of groups</span>}
              </td>
              <td className={cn('px-3 py-2 font-mono tabular-nums text-sm text-right font-medium whitespace-nowrap',
                type === 'income' ? 'text-emerald-500' : 'text-rose-400'
              )}>
                {formatCurrency(total)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {detail && (
        <Popover open onOpenChange={open => { if (!open) setDetail(null); }}>
          <PopoverAnchor asChild>
            <span style={{ position: 'fixed', left: detail.x, top: detail.y }} />
          </PopoverAnchor>
          <PopoverContent side="top" align="start" className={cn('p-3 space-y-2', detail.tx.group_id != null ? 'w-96' : 'w-80')}>
            {detail.tx.group_id != null ? (
              <GroupBubble group={detail.tx} members={groupedMembers.filter(m => m.group_id === detail.tx.group_id)} />
            ) : (
              <>
                <p className="text-sm text-zinc-100 break-words leading-snug">{detail.tx.description}</p>
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 min-w-0">
                    <BankBadge bank={detail.tx.bank} />
                    <span className="text-xs text-zinc-500 tabular-nums shrink-0">{formatDisplayDate(detail.tx.date)}</span>
                  </span>
                  <span className={cn('font-mono tabular-nums text-sm font-medium shrink-0',
                    detail.tx.type === 'income' ? 'text-emerald-500' : 'text-rose-400'
                  )}>
                    {formatCurrency(detail.tx.amount)}
                  </span>
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
      )}

      {table.getPageCount() > 1 && (
        <div className="flex items-center justify-between mt-2 text-xs text-zinc-400">
          <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {editTx && (
        <EditSheet
          tx={editTx}
          categories={categories}
          onClose={() => setEditTx(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['transactions'] });
            qc.invalidateQueries({ queryKey: ['summary'] });
            qc.invalidateQueries({ queryKey: ['allocation'] });
            setEditTx(null);
          }}
        />
      )}
    </div>
  );
});

function GroupBubble({ group, members }: { group: Transaction; members: Transaction[] }) {
  const exp = members.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0);
  const inc = members.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0);
  const net = inc - exp;
  const sorted = [...members].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: group.group_color ?? '#71717a' }} />
        <p className="text-sm font-medium text-zinc-100 truncate">group:{group.group_name}</p>
        <span className="text-xs text-zinc-500 shrink-0 ml-auto">{members.length} item{members.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="max-h-60 overflow-y-auto -mx-1 px-1 divide-y divide-zinc-800/60">
        {sorted.map(m => (
          <div key={m.id} className="flex items-center gap-2 py-1">
            <span className="text-xs text-zinc-500 tabular-nums shrink-0">{formatDate(m.date)}</span>
            <span className="text-xs text-zinc-300 truncate flex-1" title={m.description}>{m.description}</span>
            <span className={cn('font-mono tabular-nums text-xs shrink-0',
              m.type === 'income' ? 'text-emerald-500' : 'text-rose-400'
            )}>
              {m.type === 'income' ? '+' : '−'}{formatCurrency(m.amount)}
            </span>
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-700 pt-2 space-y-0.5 text-xs">
        <div className="flex justify-between"><span className="text-zinc-500">Expenses</span><span className="font-mono tabular-nums text-rose-400">{formatCurrency(exp)}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Income</span><span className="font-mono tabular-nums text-emerald-500">{formatCurrency(inc)}</span></div>
        <div className="flex justify-between font-medium">
          <span className="text-zinc-300">Net</span>
          <span className={cn('font-mono tabular-nums', net >= 0 ? 'text-emerald-500' : 'text-rose-400')}>
            {net >= 0 ? '+' : '−'}{formatCurrency(net)}
          </span>
        </div>
      </div>
    </div>
  );
}

function EditSheet({ tx, categories, onClose, onSaved }: { tx: Transaction; categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ date: tx.date, description: tx.description, amount: String(tx.amount), category_id: String(tx.category_id ?? ''), bank: tx.bank });
  const [saving, setSaving] = useState(false);
  const relevant = categories.filter(c => c.type === tx.type && c.is_active);

  const save = async () => {
    setSaving(true);
    try {
      const d = new Date(form.date + 'T00:00:00');
      await transactionsApi.update(tx.id, {
        date: form.date,
        description: form.description,
        amount: parseFloat(form.amount),
        category_id: form.category_id ? parseInt(form.category_id) : null,
        bank: form.bank as Transaction['bank'],
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Sheet open onOpenChange={open => !open && onClose()}>
      <SheetContent>
        <SheetHeader><SheetTitle>Edit Transaction</SheetTitle></SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Date</label>
            <DatePicker value={form.date} onChange={date => setForm(f => ({ ...f, date }))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Description</label>
            <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Amount (€)</label>
            <Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Category</label>
            <Select value={form.category_id} onValueChange={v => setForm(f => ({ ...f, category_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {relevant.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Bank</label>
            <Select value={form.bank} onValueChange={v => setForm(f => ({ ...f, bank: v as Transaction['bank'] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="revolut">Revolut</SelectItem>
                <SelectItem value="santander">Santander</SelectItem>
                <SelectItem value="fibank">Fibank</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>

<div className="flex gap-2 pt-2">
            <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
