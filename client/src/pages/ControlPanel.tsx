import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { GripVertical, Plus, Pencil, Trash2, Info } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PageHeader } from '@/components/PageHeader';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CategoryBadge } from '@/components/CategoryBadge';
import { categoriesApi, budgetsApi, stableBudgetsApi, monthsApi, exportApi, merchantRulesApi, transactionsApi } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { useMonth } from '@/contexts/MonthContext';
import type { Category, Budget, StableBudget, MerchantRule, Transaction } from '@/lib/types';

export function ControlPanel() {
  const { year, month, setMonth } = useMonth();
  return (
    <div>
      <PageHeader title="Control Panel" />
      <Tabs defaultValue="categories">
        <TabsList className="mb-6">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="recurring">Recurring</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>
        <TabsContent value="categories"><CategoriesTab /></TabsContent>
        <TabsContent value="budgets"><BudgetsTab year={year} month={month} onMonthChange={setMonth} /></TabsContent>
        <TabsContent value="recurring"><RecurringTab /></TabsContent>
        <TabsContent value="data"><DataTab /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── Categories Tab ─── */

function CategoriesTab() {
  return (
    <div className="grid grid-cols-2 gap-6">
      <CategorySection type="expense" />
      <CategorySection type="income" />
    </div>
  );
}

function CategorySection({ type }: { type: 'expense' | 'income' }) {
  const qc = useQueryClient();
  const { data: allCats = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll });
  const cats = (allCats as Category[]).filter(c => c.type === type).sort((a, b) => a.sort_order - b.sort_order);
  const [items, setItems] = useState<Category[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#71717a');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const displayCats = items.length > 0 ? items : cats;

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = displayCats.findIndex(c => c.id === active.id);
    const newIdx = displayCats.findIndex(c => c.id === over.id);
    const reordered = arrayMove(displayCats, oldIdx, newIdx);
    setItems(reordered);
    await Promise.all(reordered.map((c, i) => categoriesApi.update(c.id, { sort_order: i + 1 })));
    qc.invalidateQueries({ queryKey: ['categories'] });
  };

  const addCategory = async () => {
    if (!newName.trim()) return;
    const slug = newName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    await categoriesApi.create({ name: slug, display_name: newName.trim(), type, color: newColor, sort_order: displayCats.length + 1 });
    qc.invalidateQueries({ queryKey: ['categories'] });
    setNewName(''); setNewColor('#71717a'); setAdding(false);
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-400">{type === 'expense' ? 'Expenses' : 'Income'}</h3>
        <Button size="sm" variant="ghost" className="h-7" onClick={() => setAdding(a => !a)}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      {adding && (
        <div className="flex gap-2 mb-3">
          <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="h-8 w-8 rounded cursor-pointer bg-transparent border-0" />
          <Input placeholder="Display name" value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-sm flex-1" onKeyDown={e => e.key === 'Enter' && addCategory()} />
          <Button size="sm" className="h-8" onClick={addCategory}>Add</Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setAdding(false)}>✕</Button>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={displayCats.map(c => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
            {displayCats.map(cat => (
              <SortableCategoryRow key={cat.id} category={cat} onRefresh={() => { setItems([]); qc.invalidateQueries({ queryKey: ['categories'] }); }} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </Card>
  );
}

function SortableCategoryRow({ category: cat, onRefresh }: { category: Category; onRefresh: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(cat.display_name);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const save = async () => {
    await categoriesApi.update(cat.id, { display_name: name });
    setEditing(false);
    onRefresh();
  };

  const toggleActive = async () => {
    await categoriesApi.update(cat.id, { is_active: cat.is_active ? 0 : 1 });
    onRefresh();
  };

  const changeColor = async (color: string) => {
    await categoriesApi.update(cat.id, { color });
    onRefresh();
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-zinc-800/40 group">
      <span {...attributes} {...listeners} className="cursor-grab text-zinc-600 hover:text-zinc-400 shrink-0">
        <GripVertical className="h-4 w-4" />
      </span>
      <input type="color" value={cat.color} onChange={e => changeColor(e.target.value)} className="h-5 w-5 rounded-full cursor-pointer bg-transparent border-0 shrink-0" />
      {editing ? (
        <Input value={name} onChange={e => setName(e.target.value)} className="h-6 text-xs flex-1" onBlur={save} onKeyDown={e => e.key === 'Enter' && save()} autoFocus />
      ) : (
        <span className="flex-1 text-sm truncate">{cat.display_name}</span>
      )}
      <Switch checked={!!cat.is_active} onCheckedChange={toggleActive} className="shrink-0" />
      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0" onClick={() => setEditing(e => !e)}>
        <Pencil className="h-3 w-3" />
      </Button>
      <DeleteCategoryButton category={cat} onDeleted={onRefresh} />
    </div>
  );
}

function DeleteCategoryButton({ category, onDeleted }: { category: Category; onDeleted: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-rose-500 opacity-0 group-hover:opacity-100 shrink-0"
          onClick={async () => {
            const res = await categoriesApi.delete(category.id) as { error?: string; count?: number; success?: boolean };
            if (res.count) setCount(res.count);
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{category.display_name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {count ? `${count} transaction(s) use this category. Deleting will set them to Uncategorized.` : 'This cannot be undone.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={async () => {
            await categoriesApi.update(category.id, { is_active: 0 });
            onDeleted();
          }}>
            {count ? 'Deactivate' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ─── Budgets Tab ─── */

function BudgetsTab({ year, month, onMonthChange }: { year: number; month: number; onMonthChange: (y: number, m: number) => void }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<'stable' | 'monthly'>('monthly');

  const { data: monthRecord } = useQuery({
    queryKey: ['month', year, month],
    queryFn: () => monthsApi.getOrCreate(year, month),
    enabled: scope === 'monthly',
  });
  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll });
  const monthId = monthRecord?.id ?? 0;
  const { data: monthlyBudgets = [] } = useQuery({
    queryKey: ['budgets', monthId],
    queryFn: () => budgetsApi.getAll(monthId),
    enabled: scope === 'monthly' && !!monthId,
  });
  const { data: stableBudgets = [] } = useQuery({
    queryKey: ['stable-budgets'],
    queryFn: stableBudgetsApi.getAll,
  });

  const allCats = (categories as Category[]).filter(c => c.is_active);
  const expenseCats = allCats.filter(c => c.type === 'expense');
  const incomeCats = allCats.filter(c => c.type === 'income');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['budgets'] });
    qc.invalidateQueries({ queryKey: ['stable-budgets'] });
    qc.invalidateQueries({ queryKey: ['summary'] });
  };

  const copyPrev = async () => {
    await budgetsApi.copyFromPrevious(monthId);
    invalidate();
  };

  const budgetMap = new Map((monthlyBudgets as Budget[]).map(b => [b.category_id, b]));
  const stableMap = new Map((stableBudgets as StableBudget[]).map(b => [b.category_id, b]));

  const getRow = (catId: number): { planned: number; is_active: boolean } => {
    if (scope === 'monthly') {
      const b = budgetMap.get(catId);
      return b ? { planned: b.planned, is_active: !!b.is_active } : { planned: 0, is_active: true };
    }
    const s = stableMap.get(catId);
    return s ? { planned: s.planned, is_active: !!s.is_active } : { planned: 0, is_active: true };
  };

  const save = async (catId: number, planned: number, is_active: boolean) => {
    if (scope === 'monthly') {
      if (!monthId) return;
      await budgetsApi.upsert({ month_id: monthId, category_id: catId, planned, is_active });
    } else {
      await stableBudgetsApi.upsert({ category_id: catId, planned, is_active });
    }
    invalidate();
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-md border border-zinc-800 p-0.5 text-xs">
          <button
            onClick={() => setScope('stable')}
            className={cn('px-3 py-1 rounded transition-colors', scope === 'stable' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')}
          >
            Stable
          </button>
          <button
            onClick={() => setScope('monthly')}
            className={cn('px-3 py-1 rounded transition-colors', scope === 'monthly' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')}
          >
            Monthly
          </button>
        </div>
        {scope === 'monthly' && (
          <div className="flex items-center gap-2">
            <MonthYearPicker value={{ year, month }} onChange={onMonthChange} />
            <Button size="sm" variant="outline" onClick={copyPrev}>Copy from previous month</Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <BudgetTable title="Expenses" categories={expenseCats} getRow={getRow} onSave={save} />
        <BudgetTable title="Income" categories={incomeCats} getRow={getRow} onSave={save} />
      </div>
    </Card>
  );
}

function BudgetTable({ title, categories, getRow, onSave }: {
  title: string;
  categories: Category[];
  getRow: (catId: number) => { planned: number; is_active: boolean };
  onSave: (catId: number, planned: number, is_active: boolean) => void | Promise<void>;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-400 mb-2">{title}</h3>
      <div className="text-xs text-zinc-500 grid grid-cols-[1fr_100px_60px] gap-3 pb-2 border-b border-zinc-800 mb-1 uppercase tracking-wider">
        <span>Category</span>
        <span className="text-right">Planned</span>
        <span className="text-right">Active</span>
      </div>
      <div className="space-y-1">
        {categories.map(cat => {
          const row = getRow(cat.id);
          return <BudgetRow key={cat.id} category={cat} planned={row.planned} isActive={row.is_active} onSave={onSave} />;
        })}
      </div>
    </div>
  );
}

function BudgetRow({ category, planned, isActive, onSave }: {
  category: Category;
  planned: number;
  isActive: boolean;
  onSave: (catId: number, planned: number, is_active: boolean) => void | Promise<void>;
}) {
  const [value, setValue] = useState(String(planned || ''));
  const [active, setActive] = useState(isActive);

  useEffect(() => { setValue(String(planned || '')); }, [planned]);
  useEffect(() => { setActive(isActive); }, [isActive]);

  const savePlanned = () => {
    const p = parseFloat(value) || 0;
    if (p === planned) return;
    onSave(category.id, p, active);
  };

  const toggleActive = (v: boolean) => {
    setActive(v);
    const p = parseFloat(value) || 0;
    onSave(category.id, p, v);
  };

  return (
    <div className="grid grid-cols-[1fr_100px_60px] gap-3 items-center py-1.5 hover:bg-zinc-800/30 rounded px-1 -mx-1">
      <span className="text-sm truncate">{category.display_name}</span>
      <Input
        type="number" step="0.01" min="0"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={savePlanned}
        className="h-7 text-xs font-mono text-right"
        placeholder="0.00"
      />
      <div className="flex justify-end">
        <Switch checked={active} onCheckedChange={toggleActive} />
      </div>
    </div>
  );
}

/* ─── Recurring Tab ─── */

function RecurringTab() {
  const qc = useQueryClient();
  const { year, month } = useMonth();
  const [addOpen, setAddOpen] = useState(false);
  const [editRule, setEditRule] = useState<MerchantRule | null>(null);
  const [search, setSearch] = useState('');
  const { data: rawRules = [] } = useQuery({ queryKey: ['merchant-rules'], queryFn: merchantRulesApi.getAll });

  const rules = (rawRules as MerchantRule[]).filter(r =>
    !search || r.pattern.toLowerCase().includes(search.toLowerCase())
  );

  const deleteMutation = useMutation({
    mutationFn: (id: number) => merchantRulesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['merchant-rules'] }),
  });

  return (
    <>
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-400">Recurring Rules</h3>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </div>

        {/* Search */}
        <Input
          placeholder="Search rules…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 text-sm mb-4"
        />

        {(rawRules as MerchantRule[]).length === 0 ? (
          <p className="text-sm text-zinc-600 py-4 text-center">No rules yet. Add one to auto-categorize repeating transactions.</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-zinc-600 py-4 text-center">No rules match "{search}".</p>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500 pb-2 pr-4">Pattern</th>
                <th className="text-right text-xs font-medium uppercase tracking-wider text-zinc-500 pb-2 pr-4 w-28">Amount</th>
                <th className="text-left text-xs font-medium uppercase tracking-wider text-zinc-500 pb-2 pr-4 w-40">Category</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id} className="hover:bg-zinc-800/40 group">
                  <td className="py-1.5 pr-4 max-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {rule.match_type === 'regex' && (
                        <span className="shrink-0 text-[10px] font-mono px-1 py-0.5 rounded bg-violet-900/40 text-violet-400 border border-violet-800/50">regex</span>
                      )}
                      <span className="truncate font-mono text-zinc-300">{rule.pattern}</span>
                    </div>
                  </td>
                  <td className="py-1.5 pr-4 text-right tabular-nums text-xs text-zinc-500 w-28">
                    {rule.match_amount != null
                      ? formatCurrency(rule.match_amount)
                      : <span className="text-zinc-700">any</span>}
                  </td>
                  <td className="py-1.5 pr-4 w-40">
                    {rule.category_display_name
                      ? <CategoryBadge category={{ display_name: rule.category_display_name, color: rule.category_color ?? '#71717a' }} />
                      : <span className="text-xs text-zinc-600">—</span>}
                  </td>
                  <td className="py-1.5 w-16">
                    <div className="flex gap-0.5">
                      <Button
                        variant="ghost" size="icon"
                        className="h-6 w-7 text-zinc-600 hover:text-zinc-200"
                        onClick={() => setEditRule(rule)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-6 w-7 text-zinc-600 hover:text-rose-400"
                        onClick={() => deleteMutation.mutate(rule.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <AddRuleDialog open={addOpen} onOpenChange={setAddOpen} initialYear={year} initialMonth={month} />
      <EditRuleDialog rule={editRule} onOpenChange={open => { if (!open) setEditRule(null); }} />
    </>
  );
}

const SCOPES = [
  { value: 'month',   label: 'This month' },
  { value: 'before',  label: 'This & before' },
  { value: 'future',  label: 'This & future' },
  { value: 'all',     label: 'All time' },
] as const;

function AddRuleDialog({ open, onOpenChange, initialYear, initialMonth }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialYear: number;
  initialMonth: number;
}) {
  const qc = useQueryClient();
  const [dialogYear, setDialogYear] = useState(initialYear);
  const [dialogMonth, setDialogMonth] = useState(initialMonth);
  const [search, setSearch] = useState('');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [pattern, setPattern] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [scope, setScope] = useState<'month' | 'before' | 'future' | 'all'>('all');
  const [matchMode, setMatchMode] = useState<'description' | 'amount'>('description');
  const [matchType, setMatchType] = useState<'contains' | 'regex'>('contains');
  const [saving, setSaving] = useState(false);

  // Sync year/month from props each time the dialog opens
  useEffect(() => {
    if (open) {
      setDialogYear(initialYear);
      setDialogMonth(initialMonth);
    }
  }, [open, initialYear, initialMonth]);

  const { data: monthRecord } = useQuery({
    queryKey: ['month', dialogYear, dialogMonth],
    queryFn: () => monthsApi.getOrCreate(dialogYear, dialogMonth),
    enabled: open,
  });

  // Use monthId as the single source of truth in both key and fn
  const monthId = monthRecord?.id ?? null;

  const { data: rawTxs, isLoading: txsLoading } = useQuery({
    queryKey: ['rule-dialog-txs', monthId],
    queryFn: () => transactionsApi.getAll({ monthId: monthId! }),
    enabled: open && monthId !== null,
  });
  const allTxs = (rawTxs ?? []) as Transaction[];

  // Categories — always all active, narrowed to tx type once a tx is selected
  const { data: rawCats } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll });
  const allCats = (rawCats ?? []) as Category[];
  const txType = selectedTx?.type as 'expense' | 'income' | undefined;
  const relevantCats = allCats.filter(c => c.is_active !== 0 && (!txType || c.type === txType));

  const filtered = allTxs.filter(tx =>
    !search || tx.description.toLowerCase().includes(search.toLowerCase())
  );

  const selectTx = (tx: Transaction) => {
    setSelectedTx(tx);
    setPattern(tx.description);
    setCategoryId(tx.category_id ? String(tx.category_id) : '');
  };

  const reset = () => {
    setSelectedTx(null);
    setPattern('');
    setCategoryId('');
    setScope('all');
    setMatchMode('description');
    setMatchType('contains');
    setSearch('');
  };

  const handleCreate = async () => {
    if (!pattern.trim() || !categoryId) return;
    setSaving(true);
    const matchAmt = matchMode === 'amount' && selectedTx != null
      ? Math.abs(selectedTx.amount)
      : null;
    try {
      await merchantRulesApi.create({
        pattern: pattern.trim(),
        category_id: parseInt(categoryId),
        description_clean: selectedTx?.description,
        match_amount: matchAmt,
        match_type: matchType,
      });
      await merchantRulesApi.bulkCategorize({
        pattern: pattern.trim(),
        category_id: parseInt(categoryId),
        scope,
        year: dialogYear,
        month: dialogMonth,
        match_amount: matchAmt,
        match_type: matchType,
      });
      qc.invalidateQueries({ queryKey: ['merchant-rules'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      reset();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="w-auto max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>Add Recurring Rule</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Month picker + search */}
          <div className="flex items-center gap-2">
            <MonthYearPicker value={{ year: dialogYear, month: dialogMonth }} onChange={(y, m) => { setDialogYear(y); setDialogMonth(m); setSelectedTx(null); }} />
            <Input placeholder="Search transactions…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-sm flex-1" />
          </div>

          {/* Transaction list */}
          <div className="border border-zinc-800 rounded-md overflow-y-auto max-h-52">
            {txsLoading ? (
              <p className="text-xs text-zinc-600 text-center py-6">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-6">No transactions this month</p>
            ) : (
              filtered.map(tx => (
                <div
                  key={tx.id}
                  onClick={() => selectTx(tx)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 cursor-pointer text-xs border-b border-zinc-800/60 last:border-0',
                    selectedTx?.id === tx.id ? 'bg-zinc-700/60' : 'hover:bg-zinc-800/40'
                  )}
                >
                  <span className="text-zinc-500 tabular-nums shrink-0">{formatDate(tx.date)}</span>
                  <span className="flex-1 truncate">{tx.description}</span>
                  <span className={cn('tabular-nums font-mono shrink-0', tx.type === 'income' ? 'text-emerald-500' : 'text-rose-400')}>
                    {formatCurrency(tx.amount)}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Rule form */}
          <div className="space-y-3 border-t border-zinc-800 pt-4">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Match on</label>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant={matchMode === 'description' ? 'default' : 'outline'}
                  className="flex-1 h-7 text-xs"
                  onClick={() => setMatchMode('description')}
                >
                  Description only
                </Button>
                <Button
                  size="sm"
                  variant={matchMode === 'amount' ? 'default' : 'outline'}
                  className="flex-1 h-7 text-xs"
                  disabled={!selectedTx}
                  onClick={() => setMatchMode('amount')}
                  title={!selectedTx ? 'Select a transaction first' : undefined}
                >
                  Description + Amount
                  {matchMode === 'amount' && selectedTx && (
                    <span className="ml-1.5 opacity-70">({formatCurrency(Math.abs(selectedTx.amount))})</span>
                  )}
                </Button>
              </div>
              {matchMode === 'amount' && !selectedTx && (
                <p className="text-xs text-zinc-600">Select a transaction above to lock in an amount.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-zinc-400">Pattern</label>
                <div className="flex gap-1">
                  {/* Contains button with nested tooltip */}
                  <span className="relative group/contains">
                    <Button
                      size="sm"
                      variant={matchType === 'contains' ? 'default' : 'outline'}
                      className="h-6 pl-2 pr-1.5 text-xs gap-1"
                      onClick={() => setMatchType('contains')}
                    >
                      Contains
                      <Info className="h-3 w-3 opacity-50 group-hover/contains:opacity-100 transition-opacity" />
                    </Button>
                    <div className="pointer-events-none hidden group-hover/contains:flex flex-col gap-1.5 absolute bottom-full left-0 mb-2 z-50 w-60 rounded-md bg-zinc-800 border border-zinc-700 shadow-xl p-3 text-xs text-zinc-300">
                      <p className="font-medium text-zinc-100">Contains</p>
                      <p className="text-zinc-400">Case-insensitive substring — the pattern is found anywhere in the raw description.</p>
                      <div className="border-t border-zinc-700 pt-2 font-mono text-[11px] space-y-1">
                        <div><span className="text-violet-400">LIDL</span> <span className="text-zinc-500">→ "LIDL", "at LIDL ES"</span></div>
                        <div><span className="text-violet-400">EMT Madrid</span> <span className="text-zinc-500">→ exact phrase anywhere</span></div>
                      </div>
                      <span className="absolute top-full left-4 border-4 border-transparent border-t-zinc-700" />
                    </div>
                  </span>

                  {/* Regex button with nested tooltip */}
                  <span className="relative group/regex">
                    <Button
                      size="sm"
                      variant={matchType === 'regex' ? 'default' : 'outline'}
                      className="h-6 pl-2 pr-1.5 text-xs gap-1"
                      onClick={() => setMatchType('regex')}
                    >
                      Regex
                      <Info className="h-3 w-3 opacity-50 group-hover/regex:opacity-100 transition-opacity" />
                    </Button>
                    <div className="pointer-events-none hidden group-hover/regex:flex flex-col gap-1.5 absolute bottom-full right-0 mb-2 z-50 w-72 rounded-md bg-zinc-800 border border-zinc-700 shadow-xl p-3 text-xs text-zinc-300">
                      <p className="font-medium text-zinc-100">Regex</p>
                      <p className="text-zinc-400">Full JavaScript regex, always case-insensitive.</p>
                      <div className="border-t border-zinc-700 pt-2 font-mono text-[11px] space-y-1">
                        <div><span className="text-violet-400">ORANGE\s+ESPAGNE</span> <span className="text-zinc-500">— one or more spaces</span></div>
                        <div><span className="text-violet-400">^UBER</span> <span className="text-zinc-500">— starts with UBER</span></div>
                        <div><span className="text-violet-400">NETFLIX|SPOTIFY</span> <span className="text-zinc-500">— either merchant</span></div>
                        <div><span className="text-violet-400">AMZN\s*MKTP</span> <span className="text-zinc-500">— optional spaces</span></div>
                      </div>
                      <span className="absolute top-full right-4 border-4 border-transparent border-t-zinc-700" />
                    </div>
                  </span>
                </div>
              </div>
              <Input
                value={pattern}
                onChange={e => setPattern(e.target.value)}
                className="text-sm font-mono"
                placeholder={matchType === 'regex' ? 'e.g. ORANGE\\s+ESPAGNE' : 'e.g. LIDL'}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Category</label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Select category…" /></SelectTrigger>
                <SelectContent>
                  {relevantCats.map(c => (
                    <SelectItem key={c.id} value={String(c.id)} className="text-sm">{c.display_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Apply to</label>
              <div className="flex gap-1.5">
                {SCOPES.map(s => (
                  <Button
                    key={s.value}
                    size="sm"
                    variant={scope === s.value ? 'default' : 'outline'}
                    className="flex-1 h-7 text-xs"
                    onClick={() => setScope(s.value)}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
            <Button className="flex-1" onClick={handleCreate} disabled={!pattern.trim() || !categoryId || saving}>
              {saving ? 'Saving…' : 'Create Rule'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Edit Rule Dialog ─── */

function EditRuleDialog({ rule, onOpenChange }: {
  rule: MerchantRule | null;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const open = rule !== null;

  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<'contains' | 'regex'>('contains');
  const [matchMode, setMatchMode] = useState<'description' | 'amount'>('description');
  const [amountInput, setAmountInput] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [scope, setScope] = useState<'month' | 'before' | 'future' | 'all'>('all');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { year, month } = useMonth();

  // Populate fields whenever the rule changes
  useEffect(() => {
    if (rule) {
      setPattern(rule.pattern);
      setMatchType(rule.match_type ?? 'contains');
      setMatchMode(rule.match_amount != null ? 'amount' : 'description');
      setAmountInput(rule.match_amount != null ? String(rule.match_amount) : '');
      setCategoryId(rule.category_id ? String(rule.category_id) : '');
      setScope('all');
      setError('');
    }
  }, [rule]);

  const { data: rawCats } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll });
  const allCats = (rawCats ?? []) as Category[];
  const relevantCats = allCats.filter(c => c.is_active !== 0);

  const handleSave = async () => {
    if (!pattern.trim() || !categoryId) return;
    setSaving(true);
    setError('');
    const matchAmt = matchMode === 'amount' && amountInput !== '' ? parseFloat(amountInput) : null;
    try {
      await merchantRulesApi.update(rule!.id, {
        pattern: pattern.trim(),
        category_id: parseInt(categoryId),
        match_amount: matchAmt,
        match_type: matchType,
      });
      await merchantRulesApi.bulkCategorize({
        pattern: pattern.trim(),
        category_id: parseInt(categoryId),
        scope,
        year,
        month,
        match_amount: matchAmt,
        match_type: matchType,
      });
      qc.invalidateQueries({ queryKey: ['merchant-rules'] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message ?? 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-auto max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>Edit Rule</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Match on: description vs description+amount */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Match on</label>
            <div className="flex gap-1.5">
              <Button size="sm" variant={matchMode === 'description' ? 'default' : 'outline'} className="flex-1 h-7 text-xs" onClick={() => setMatchMode('description')}>
                Description only
              </Button>
              <Button size="sm" variant={matchMode === 'amount' ? 'default' : 'outline'} className="flex-1 h-7 text-xs" onClick={() => setMatchMode('amount')}>
                Description + Amount
              </Button>
            </div>
            {matchMode === 'amount' && (
              <Input
                type="number" step="0.01" min="0"
                placeholder="Amount (absolute, e.g. 29.99)"
                value={amountInput}
                onChange={e => setAmountInput(e.target.value)}
                className="h-8 text-sm font-mono"
              />
            )}
          </div>

          {/* Pattern + match type toggle with tooltips */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs text-zinc-400">Pattern</label>
              <div className="flex gap-1">
                <span className="relative group/contains">
                  <Button size="sm" variant={matchType === 'contains' ? 'default' : 'outline'} className="h-6 pl-2 pr-1.5 text-xs gap-1" onClick={() => setMatchType('contains')}>
                    Contains <Info className="h-3 w-3 opacity-50 group-hover/contains:opacity-100 transition-opacity" />
                  </Button>
                  <div className="pointer-events-none hidden group-hover/contains:flex flex-col gap-1.5 absolute bottom-full left-0 mb-2 z-50 w-60 rounded-md bg-zinc-800 border border-zinc-700 shadow-xl p-3 text-xs text-zinc-300">
                    <p className="font-medium text-zinc-100">Contains</p>
                    <p className="text-zinc-400">Case-insensitive substring anywhere in the description.</p>
                    <div className="border-t border-zinc-700 pt-2 font-mono text-[11px] space-y-1">
                      <div><span className="text-violet-400">LIDL</span> <span className="text-zinc-500">→ "LIDL", "at LIDL ES"</span></div>
                    </div>
                    <span className="absolute top-full left-4 border-4 border-transparent border-t-zinc-700" />
                  </div>
                </span>
                <span className="relative group/regex">
                  <Button size="sm" variant={matchType === 'regex' ? 'default' : 'outline'} className="h-6 pl-2 pr-1.5 text-xs gap-1" onClick={() => setMatchType('regex')}>
                    Regex <Info className="h-3 w-3 opacity-50 group-hover/regex:opacity-100 transition-opacity" />
                  </Button>
                  <div className="pointer-events-none hidden group-hover/regex:flex flex-col gap-1.5 absolute bottom-full right-0 mb-2 z-50 w-72 rounded-md bg-zinc-800 border border-zinc-700 shadow-xl p-3 text-xs text-zinc-300">
                    <p className="font-medium text-zinc-100">Regex</p>
                    <p className="text-zinc-400">Full JavaScript regex, always case-insensitive.</p>
                    <div className="border-t border-zinc-700 pt-2 font-mono text-[11px] space-y-1">
                      <div><span className="text-violet-400">ORANGE\s+ESPAGNE</span> <span className="text-zinc-500">— one or more spaces</span></div>
                      <div><span className="text-violet-400">^UBER</span> <span className="text-zinc-500">— starts with UBER</span></div>
                      <div><span className="text-violet-400">NETFLIX|SPOTIFY</span> <span className="text-zinc-500">— either merchant</span></div>
                    </div>
                    <span className="absolute top-full right-4 border-4 border-transparent border-t-zinc-700" />
                  </div>
                </span>
              </div>
            </div>
            <Input
              value={pattern}
              onChange={e => setPattern(e.target.value)}
              className="text-sm font-mono"
              placeholder={matchType === 'regex' ? 'e.g. ORANGE\\s+ESPAGNE' : 'e.g. LIDL'}
            />
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Category</label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="text-sm"><SelectValue placeholder="Select category…" /></SelectTrigger>
              <SelectContent>
                {relevantCats.map(c => (
                  <SelectItem key={c.id} value={String(c.id)} className="text-sm">{c.display_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Re-apply scope */}
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Re-apply to</label>
            <div className="flex gap-1.5">
              {SCOPES.map(s => (
                <Button key={s.value} size="sm" variant={scope === s.value ? 'default' : 'outline'} className="flex-1 h-7 text-xs" onClick={() => setScope(s.value)}>
                  {s.label}
                </Button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={!pattern.trim() || !categoryId || saving}>
              {saving ? 'Saving…' : 'Save Rule'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Data Tab ─── */

type DataOperation = 'export' | 'delete';

function DataTab() {
  const qc = useQueryClient();
  const { year: ctxYear, month: ctxMonth } = useMonth();
  const todayYear = new Date().getFullYear();
  const todayMonth = new Date().getMonth() + 1;
  const [selYear, setSelYear] = useState(todayYear);
  const [selMonth, setSelMonth] = useState(todayMonth);
  const [operation, setOperation] = useState<DataOperation | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const monthLabel = `${selYear}-${String(selMonth).padStart(2, '0')}`;

  const { data: monthRecord } = useQuery({
    queryKey: ['month', selYear, selMonth],
    queryFn: () => monthsApi.getOrCreate(selYear, selMonth),
    enabled: operation === 'delete',
  });

  // Reset confirm text when month or operation changes
  useEffect(() => { setConfirmText(''); }, [selYear, selMonth, operation]);

  const handleExport = () => {
    exportApi.download(selYear, selMonth);
  };

  const handleDelete = async () => {
    if (confirmText !== monthLabel || !monthRecord) return;
    setDeleting(true);
    try {
      const all = await transactionsApi.getAll({ monthId: monthRecord.id });
      await Promise.all(all.map((t: { id: number }) => transactionsApi.delete(t.id)));
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['allocation'] });
      setConfirmText('');
      setOperation(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5 max-w-xl">
      {/* Month selector */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">Select Month</h3>
          {(selYear !== todayYear || selMonth !== todayMonth) && (
            <button
              onClick={() => { setSelYear(todayYear); setSelMonth(todayMonth); }}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              ↩ This month
            </button>
          )}
        </div>
        <MonthYearPicker value={{ year: selYear, month: selMonth }} onChange={(y, m) => { setSelYear(y); setSelMonth(m); }} />
      </Card>

      {/* Operation picker */}
      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3">Operation</h3>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={operation === 'export' ? 'default' : 'outline'}
            onClick={() => setOperation('export')}
          >
            Export
          </Button>
          <Button
            size="sm"
            variant={operation === 'delete' ? 'destructive' : 'outline'}
            onClick={() => setOperation('delete')}
            className={operation !== 'delete' ? 'border-rose-900 text-rose-400 hover:bg-rose-950 hover:text-rose-300' : ''}
          >
            Delete
          </Button>
        </div>
      </Card>

      {/* Export panel */}
      {operation === 'export' && (
        <Card className="p-4">
          <h3 className="text-sm font-medium mb-1">Export <span className="font-mono text-zinc-300">{monthLabel}</span></h3>
          <p className="text-xs text-zinc-500 mb-3">Downloads an Excel file with all transactions and a summary sheet.</p>
          <Button size="sm" variant="outline" onClick={handleExport}>
            Download {monthLabel}.xlsx
          </Button>
        </Card>
      )}

      {/* Delete panel */}
      {operation === 'delete' && (
        <Card className="p-4 border-rose-900">
          <h3 className="text-sm font-medium text-rose-400 mb-1">Delete all transactions for <span className="font-mono">{monthLabel}</span></h3>
          <p className="text-xs text-zinc-500 mb-3">
            This cannot be undone. Type <span className="font-mono text-zinc-300">{monthLabel}</span> to confirm.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder={monthLabel}
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              className="h-8 text-sm font-mono"
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" disabled={confirmText !== monthLabel || deleting}>
                  {deleting ? 'Deleting…' : 'Delete all'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete all transactions for {monthLabel}?</AlertDialogTitle>
                  <AlertDialogDescription>This cannot be undone. Budgets and recurring rules are not affected.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={handleDelete}>Delete all</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>
      )}
    </div>
  );
}
