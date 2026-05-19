import { useState, useMemo, useRef, memo } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  useReactTable, getCoreRowModel, getPaginationRowModel, getSortedRowModel,
  createColumnHelper, flexRender, type SortingState, type PaginationState,
} from '@tanstack/react-table';
import { Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { CategoryBadge } from './CategoryBadge';
import { BankBadge } from './BankBadge';
import { DatePicker } from './DatePicker';
import { transactionsApi, categoriesApi } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import type { Transaction, Category } from '@/lib/types';

// Stable module-level references — calling these inside the component body
// creates new function instances every render, which causes useReactTable to
// think its config changed and triggers internal state updates → infinite loop.
const _getCoreRowModel = getCoreRowModel();
const _getPaginationRowModel = getPaginationRowModel();
const _getSortedRowModel = getSortedRowModel();

const col = createColumnHelper<Transaction>();

interface TransactionTableProps {
  monthId: number;
  type: 'expense' | 'income';
  search?: string;
  categoryFilter?: string;
}

export const TransactionTable = memo(function TransactionTable({ monthId, type, search, categoryFilter }: TransactionTableProps) {
  const qc = useQueryClient();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 });
  const [editTx, setEditTx] = useState<Transaction | null>(null);

  const { data: rawTransactions, isLoading } = useQuery({
    queryKey: ['transactions', { monthId, type, search, categoryFilter }],
    queryFn: () => transactionsApi.getAll({ monthId, type, search, categoryId: categoryFilter ? parseInt(categoryFilter) : undefined }),
    enabled: !!monthId,
  });
  // Stable reference: avoids passing a new [] to useReactTable on every render
  // when data is undefined (loading), which would trigger internal table re-computation.
  const transactions = useMemo(() => rawTransactions ?? [], [rawTransactions]);

  const { data: rawCategories } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll });
  const categories = useMemo(() => rawCategories ?? [], [rawCategories]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => transactionsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['allocation'] });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, categoryId }: { id: number; categoryId: number | null }) =>
      transactionsApi.update(id, { category_id: categoryId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });

  // Stable refs so columns memo doesn't re-create on every mutation object reference change
  const deleteMutateRef = useRef(deleteMutation.mutate);
  deleteMutateRef.current = deleteMutation.mutate;
  const updateCategoryRef = useRef(updateCategoryMutation.mutate);
  updateCategoryRef.current = updateCategoryMutation.mutate;

  const columns = useMemo(() => [
    col.accessor('date', {
      header: 'Date',
      cell: i => <span className="text-zinc-400 text-xs tabular-nums">{formatDate(i.getValue())}</span>,
      size: 70,
    }),
    col.accessor('description', {
      header: 'Description',
      cell: i => <span className="text-sm line-clamp-2 leading-snug">{i.getValue()}</span>,
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
      size: 90,
    }),
    col.accessor('category_id', {
      header: 'Category',
      cell: i => {
        const tx = i.row.original;
        const txCats = categories.filter(c => c.type === type && c.is_active);
        return (
          <Select
            value={tx.category_id ? String(tx.category_id) : 'none'}
            onValueChange={v =>
              updateCategoryRef.current({ id: tx.id, categoryId: v === 'none' ? null : parseInt(v) })
            }
          >
            <SelectTrigger className="h-7 text-xs border-0 bg-transparent px-2 shadow-none hover:bg-zinc-700/50 focus:ring-0 w-full">
              <SelectValue>
                {tx.category_display_name
                  ? <CategoryBadge category={{ display_name: tx.category_display_name, color: tx.category_color ?? '#71717a' }} />
                  : <span className="text-zinc-600">Uncategorized</span>
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="text-xs text-zinc-500">Uncategorized</SelectItem>
              {txCats.map(c => (
                <SelectItem key={c.id} value={String(c.id)} className="text-xs">{c.display_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
      size: 160,
    }),
    col.accessor('bank', {
      header: 'Bank',
      cell: i => <BankBadge bank={i.getValue()} />,
      size: 90,
    }),
    col.display({
      id: 'actions',
      cell: i => (
        <div className="flex gap-1 justify-end">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditTx(i.row.original)}>
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
                <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => deleteMutateRef.current(i.row.original.id)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ),
      size: 70,
    }),
  ], [type, categories]);

  const table = useReactTable({
    data: transactions,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
    getCoreRowModel: _getCoreRowModel,
    getPaginationRowModel: _getPaginationRowModel,
    getSortedRowModel: _getSortedRowModel,
  });

  const total = transactions.filter(t => t.type === type).reduce((s, t) => s + t.amount, 0);

  if (isLoading) return <div className="text-zinc-500 text-sm py-4">Loading…</div>;

  return (
    <div>
      <div className="border border-zinc-800 rounded-md overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-zinc-800/50">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(h => (
                  <th
                    key={h.id}
                    className="px-3 py-2 text-left text-xs text-zinc-400 font-medium cursor-pointer select-none"
                    style={{ width: h.getSize() }}
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
              <tr><td colSpan={6} className="px-3 py-8 text-center text-zinc-600 text-sm">No transactions</td></tr>
            ) : (
              table.getRowModel().rows.map(row => (
                <tr key={row.id} className="hover:bg-zinc-800/30">
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} className="px-3 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t border-zinc-800 bg-zinc-800/20">
            <tr>
              <td colSpan={2} className="px-3 py-2 text-xs text-zinc-500">{transactions.length} transactions</td>
              <td className={cn('px-3 py-2 font-mono tabular-nums text-sm text-right font-medium',
                type === 'income' ? 'text-emerald-500' : 'text-rose-400'
              )}>
                {formatCurrency(total)}
              </td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

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
