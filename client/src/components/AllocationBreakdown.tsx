import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Trash2, Plus, Info, Check, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { categoriesApi } from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import type { CategoryTotal, Category, AllocationRowConfig, AllocationFormulaEntry } from '@/lib/types';

const STORAGE_KEY = 'allocation_config';

const DEFAULT_LIVING   = ['groceries', 'home_products', 'rent', 'water_heating', 'electricity', 'phone_internet', 'subscriptions'];
const DEFAULT_EXTRA    = ['transportation', 'restaurants', 'misc_purchases', 'other'];
const DEFAULT_ALLOWANCE = ['allowance_f'];

function loadConfig(): AllocationRowConfig[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    // Migrate old rows that lack formula field
    return parsed.map((r: AllocationRowConfig) => ({ ...r, formula: r.formula ?? [] }));
  } catch { return null; }
}

function saveConfig(rows: AllocationRowConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

// Resolve a stored config against the CURRENT categories. Prefer category names
// (stable across data migrations / re-seeds); fall back to ids for legacy configs,
// dropping any that no longer exist.
function hydrate(rows: AllocationRowConfig[], categories: Category[]): AllocationRowConfig[] {
  const byName = new Map(categories.map(c => [c.name, c.id]));
  const validIds = new Set(categories.map(c => c.id));
  return rows.map(r => {
    const fromNames = r.categoryNames && r.categoryNames.length
      ? r.categoryNames.map(n => byName.get(n)).filter((x): x is number => x !== undefined)
      : null;
    const categoryIds = fromNames ?? (r.categoryIds ?? []).filter(id => validIds.has(id));
    return { ...r, categoryIds, formula: r.formula ?? [] };
  });
}

// Persist category names alongside ids so the config survives id changes.
function dehydrate(rows: AllocationRowConfig[], categories: Category[]): AllocationRowConfig[] {
  const byId = new Map(categories.map(c => [c.id, c.name]));
  return rows.map(r => ({ ...r, categoryNames: r.categoryIds.map(id => byId.get(id)).filter((x): x is string => x !== undefined) }));
}

function buildDefault(categories: Category[]): AllocationRowConfig[] {
  const byName = new Map(categories.map(c => [c.name, c.id]));
  const ids = (names: string[]) => names.map(n => byName.get(n)).filter((id): id is number => id !== undefined);
  const living = { id: '1', label: 'Living costs',  categoryIds: ids(DEFAULT_LIVING),    isDifference: false, formula: [] };
  const extra  = { id: '2', label: 'Extra costs',   categoryIds: ids(DEFAULT_EXTRA),     isDifference: false, formula: [] };
  const allow  = { id: '3', label: 'Allowance (f)', categoryIds: ids(DEFAULT_ALLOWANCE), isDifference: false, formula: [] };
  const diff   = { id: '4', label: 'Difference',    categoryIds: [],                     isDifference: true,
    formula: [{ rowId: '3', sign: '+' as const }, { rowId: '1', sign: '-' as const }] };
  return [living, extra, allow, diff];
}

interface AllocationBreakdownProps {
  currentByCategory: CategoryTotal[];
}

export function AllocationBreakdown({ currentByCategory }: AllocationBreakdownProps) {
  const [rows, setRows] = useState<AllocationRowConfig[]>([]);
  const [editMode, setEditMode] = useState(false);
  const seeded = useRef(false);

  const { data: rawCategories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll });
  const allCategories = rawCategories as Category[];
  const activeCategories = allCategories.filter(c => c.is_active);

  useEffect(() => {
    if (seeded.current || allCategories.length === 0) return;
    seeded.current = true;
    const stored = loadConfig();
    if (stored !== null) {
      const hydrated = hydrate(stored, allCategories);
      // If the stored config still resolves to real categories, use it.
      const anyMapped = hydrated.some(r => !r.isDifference && r.categoryIds.length > 0);
      if (anyMapped) { setRows(hydrated); saveConfig(dehydrate(hydrated, allCategories)); return; }
      // Otherwise it's stale (e.g. ids changed in a data migration) — rebuild defaults.
    }
    const d = buildDefault(allCategories);
    setRows(d);
    saveConfig(dehydrate(d, allCategories));
  }, [allCategories]);

  const updateRows = (next: AllocationRowConfig[]) => { setRows(next); saveConfig(dehydrate(next, allCategories)); };

  // Compute a regular row's value from byCategory
  // Income categories contribute positively, expense categories negatively
  const computeRegular = (row: AllocationRowConfig, byCategory: CategoryTotal[]): number => {
    const idSet = new Set(row.categoryIds);
    const catTypeMap = new Map(allCategories.map(c => [c.id, c.type]));
    return byCategory
      .filter(c => idSet.has(c.category_id))
      .reduce((s, c) => {
        const type = catTypeMap.get(c.category_id);
        return s + (type === 'expense' ? -c.total : c.total);
      }, 0);
  };

  // Compute all row values (regular only) into a map, then resolve difference rows
  const computeAll = (byCategory: CategoryTotal[]): Map<string, number> => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (!row.isDifference) map.set(row.id, computeRegular(row, byCategory));
    }
    for (const row of rows) {
      if (row.isDifference) {
        const val = (row.formula ?? []).reduce((s, e) => {
          const ref = map.get(e.rowId) ?? 0;
          return e.sign === '+' ? s + ref : s - ref;
        }, 0);
        map.set(row.id, val);
      }
    }
    return map;
  };

  const addRow = () => updateRows([...rows, { id: Date.now().toString(), label: '', categoryIds: [], isDifference: false, formula: [] }]);

  const addDifferenceRow = () => updateRows([...rows, { id: Date.now().toString(), label: 'Difference', categoryIds: [], isDifference: true, formula: [] }]);

  const deleteRow = (id: string) => {
    // Also remove references in formula rows
    updateRows(rows
      .filter(r => r.id !== id)
      .map(r => r.isDifference ? { ...r, formula: r.formula.filter(e => e.rowId !== id) } : r)
    );
  };

  const updateRow = (id: string, patch: Partial<AllocationRowConfig>) =>
    updateRows(rows.map(r => r.id === id ? { ...r, ...patch } : r));

  const hasDifferenceRow = false;
  const regularRows = rows.filter(r => !r.isDifference);

  const curMap  = computeAll(currentByCategory);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Allocation Breakdown</h2>
          <span className="relative group/info">
            <Info className="w-3.5 h-3.5 text-zinc-600 hover:text-zinc-400 cursor-default transition-colors" />
            <div className="absolute left-0 bottom-full mb-2 w-64 z-50 hidden group-hover/info:block pointer-events-none">
              <div className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-md px-3 py-2 shadow-lg leading-relaxed">
                Group your categories into named rows. Each regular row sums its assigned categories. A difference row lets you combine other rows with + and − to compute a custom result.
              </div>
              <span className="absolute left-2 top-full border-4 border-transparent border-t-zinc-700" />
            </div>
          </span>
        </div>
        <button onClick={() => setEditMode(e => !e)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
          {editMode
            ? <span className="text-xs text-zinc-400 font-medium">Done</span>
            : <Pencil className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* View mode */}
      {!editMode && (
        rows.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-zinc-500 mb-2">No rows configured</p>
            <button onClick={() => setEditMode(true)} className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors underline underline-offset-2">Configure →</button>
          </div>
        ) : (
          <div className="text-sm">
            <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400 uppercase tracking-wider pb-2 border-b border-zinc-800 mb-1">
              <span className="col-span-2">Row</span>
              <span className="text-right font-mono">Actual</span>
            </div>
            {rows.map(row => {
              const cur  = curMap.get(row.id) ?? 0;
              const isNeg = cur < 0;
              return (
                <div key={row.id} className={cn(
                  'grid grid-cols-3 gap-2 py-1.5 px-2 -mx-2 rounded',
                  row.isDifference && (cur < 0 ? 'bg-rose-500/10' : cur > 0 ? 'bg-emerald-500/10' : '')
                )}>
                  <span className={cn('col-span-2 font-medium truncate', row.isDifference && (cur < 0 ? 'text-rose-400' : cur > 0 ? 'text-emerald-400' : 'text-zinc-300'))}>
                    {row.label || <span className="text-zinc-600 italic">unnamed</span>}
                  </span>
                  <span className={cn('text-right font-mono tabular-nums text-xs',
                    row.isDifference ? (isNeg ? 'text-rose-400' : 'text-emerald-400') : 'text-zinc-200'
                  )}>
                    {row.isDifference && cur > 0 ? '+' : ''}{isNeg ? '-' : ''}{formatCurrency(Math.abs(cur))}
                  </span>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Edit mode */}
      {editMode && (
        <div className="space-y-2">
          {rows.length === 0 && <p className="text-xs text-zinc-500 py-2">No rows yet. Add one below.</p>}
          {rows.map(row => (
            <div key={row.id} className="flex items-center gap-2">
              <Input
                value={row.label}
                onChange={e => updateRow(row.id, { label: e.target.value })}
                placeholder={row.isDifference ? 'Difference label' : 'Row label'}
                className="h-7 text-xs shrink-0 w-36"
              />
              {row.isDifference ? (
                <FormulaBuilder
                  formula={row.formula ?? []}
                  availableRows={regularRows}
                  onChange={formula => updateRow(row.id, { formula })}
                />
              ) : (
                <CategoryMultiPicker
                  categories={activeCategories}
                  selected={row.categoryIds}
                  onChange={ids => updateRow(row.id, { categoryIds: ids })}
                />
              )}
              <button onClick={() => deleteRow(row.id)} className="shrink-0 text-zinc-600 hover:text-rose-400 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="flex gap-2 pt-2 border-t border-zinc-800">
            <AddRowButton
              label="Add data"
              tooltip="Sums transaction totals from the categories you assign. Use this to group spending or income into a single number."
              onClick={addRow}
            />
            <AddRowButton
              label="Calculation row"
              tooltip="Combines other rows in this breakdown using + and − to produce a derived result, like income minus living costs."
              onClick={addDifferenceRow}
              disabled={hasDifferenceRow}
              muted
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Formula builder for difference rows ── */
function FormulaBuilder({ formula, availableRows, onChange }: {
  formula: AllocationFormulaEntry[];
  availableRows: AllocationRowConfig[];
  onChange: (f: AllocationFormulaEntry[]) => void;
}) {
  const usedIds = new Set(formula.map(e => e.rowId));
  const unused = availableRows.filter(r => !usedIds.has(r.id));

  const toggleSign = (rowId: string) =>
    onChange(formula.map(e => e.rowId === rowId ? { ...e, sign: e.sign === '+' ? '-' : '+' } : e));

  const remove = (rowId: string) => onChange(formula.filter(e => e.rowId !== rowId));

  const add = (rowId: string) => onChange([...formula, { rowId, sign: '+' }]);

  return (
    <div className="flex-1 flex items-center gap-1 flex-wrap min-w-0">
      {formula.length === 0 && <span className="text-xs text-zinc-600 italic">pick rows below…</span>}
      {formula.map((entry, idx) => {
        const row = availableRows.find(r => r.id === entry.rowId);
        if (!row) return null;
        return (
          <span key={entry.rowId} className="flex items-center gap-0.5">
            {idx > 0 || entry.sign === '-' ? (
              <button
                onClick={() => toggleSign(entry.rowId)}
                className={cn(
                  'text-xs font-mono font-bold px-1 rounded transition-colors',
                  entry.sign === '+' ? 'text-emerald-400 hover:text-emerald-300' : 'text-rose-400 hover:text-rose-300'
                )}
              >
                {entry.sign}
              </button>
            ) : null}
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 flex items-center gap-1">
              {row.label || <span className="italic text-zinc-500">unnamed</span>}
              <button onClick={() => remove(entry.rowId)} className="text-zinc-600 hover:text-zinc-300">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          </span>
        );
      })}
      {unused.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="text-xs text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded border border-dashed border-zinc-700 hover:border-zinc-500 transition-colors">
              + row
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" align="start">
            {unused.map(r => (
              <button key={r.id} onClick={() => add(r.id)}
                className="w-full text-left px-2 py-1 text-xs rounded hover:bg-zinc-800 text-zinc-300 transition-colors">
                {r.label || <span className="italic text-zinc-500">unnamed</span>}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/* ── Add row button with click-to-show info ── */
function AddRowButton({ label, tooltip, onClick, disabled, muted }: {
  label: string;
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!show) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [show]);

  return (
    <span ref={ref} className="relative inline-flex items-center">
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'inline-flex items-center gap-1 h-7 px-3 rounded-l border text-xs transition-colors',
          muted
            ? 'border-zinc-600 bg-transparent hover:bg-zinc-800 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed'
            : 'border-zinc-600 bg-transparent hover:bg-zinc-800 text-zinc-200'
        )}
      >
        <Plus className="w-3 h-3" /> {label}
      </button>
      <button
        onClick={e => { e.stopPropagation(); setShow(s => !s); }}
        className={cn(
          'inline-flex items-center justify-center h-7 w-6 rounded-r border-t border-r border-b text-xs transition-colors',
          'border-zinc-600 text-zinc-600 hover:text-zinc-400'
        )}
      >
        <Info className="w-3 h-3" />
      </button>
      {show && (
        <div className="absolute left-0 bottom-full mb-2 w-56 z-50 pointer-events-none">
          <div className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-md px-3 py-2 shadow-lg leading-relaxed">
            {tooltip}
          </div>
          <span className="absolute left-4 top-full border-4 border-transparent border-t-zinc-700" />
        </div>
      )}
    </span>
  );
}

/* ── Category multi-picker ── */
function CategoryMultiPicker({ categories, selected, onChange }: {
  categories: Category[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(selected);

  const toggle = (id: number) => {
    onChange(selectedSet.has(id) ? selected.filter(i => i !== id) : [...selected, id]);
  };

  const label = () => {
    if (selected.length === 0) return <span className="text-zinc-500">Pick categories…</span>;
    const first = categories.find(c => c.id === selected[0]);
    return (
      <span className="flex items-center gap-1.5 truncate">
        {first && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: first.color ?? '#71717a' }} />}
        <span className="truncate" style={{ color: first?.color ?? '#a1a1aa' }}>{first?.display_name ?? '—'}</span>
        {selected.length > 1 && <span className="text-zinc-400 shrink-0">+{selected.length - 1}</span>}
      </span>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex-1 flex items-center h-7 px-2 rounded border border-zinc-700 bg-zinc-900 hover:border-zinc-500 text-xs transition-colors min-w-0">
          <span className="truncate">{label()}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1 max-h-60 overflow-y-auto" align="start">
        {categories.map(c => (
          <button key={c.id} onClick={() => toggle(c.id)}
            className="flex items-center gap-2 w-full px-2 py-1 rounded text-xs hover:bg-zinc-800 transition-colors">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color ?? '#71717a' }} />
            <span className="flex-1 text-left" style={{ color: c.color ?? '#a1a1aa' }}>{c.display_name}</span>
            {selectedSet.has(c.id) && <Check className="w-3 h-3 text-zinc-300 shrink-0" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
