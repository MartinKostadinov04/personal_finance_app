import { useState } from 'react';
import { Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import type { Category } from '@/lib/types';

export interface TxFilter {
  categoryIds: number[];        // empty = all categories
  banks: string[];              // empty = all banks
  amountMin: number | null;     // null = no lower bound
  amountMax: number | null;     // null = no upper bound
  dateFrom: string;             // '' = no start
  dateTo: string;               // '' = no end
  groupsOnly: boolean;
}

export const emptyFilter: TxFilter = {
  categoryIds: [], banks: [], amountMin: null, amountMax: null, dateFrom: '', dateTo: '', groupsOnly: false,
};

export function activeFilterCount(f: TxFilter): number {
  return (f.categoryIds.length ? 1 : 0)
    + (f.banks.length ? 1 : 0)
    + (f.amountMin != null || f.amountMax != null ? 1 : 0)
    + (f.dateFrom || f.dateTo ? 1 : 0)
    + (f.groupsOnly ? 1 : 0);
}

const BANKS = [
  { value: 'revolut', label: 'Revolut' },
  { value: 'santander', label: 'Santander' },
  { value: 'fibank', label: 'Fibank' },
  { value: 'manual', label: 'Manual' },
];

export function TransactionFilter({ categories, bounds, value, onChange }: {
  categories: Category[];
  bounds: { min: number; max: number };
  value: TxFilter;
  onChange: (f: TxFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const count = activeFilterCount(value);

  const toggleCat = (id: number) => onChange({
    ...value,
    categoryIds: value.categoryIds.includes(id) ? value.categoryIds.filter(x => x !== id) : [...value.categoryIds, id],
  });
  const toggleBank = (b: string) => onChange({
    ...value,
    banks: value.banks.includes(b) ? value.banks.filter(x => x !== b) : [...value.banks, b],
  });

  // Guard against a degenerate range (single value / no data) so the slider works.
  const sliderMax = Math.max(bounds.max, bounds.min + 1);
  const lo = value.amountMin ?? bounds.min;
  const hi = value.amountMax ?? sliderMax;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Filter className="h-3.5 w-3.5" /> Filter
          {count > 0 && <span className="ml-0.5 rounded-full bg-zinc-200 text-zinc-900 px-1.5 text-[10px] font-medium">{count}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-3 max-h-[70vh] overflow-y-auto slim-scrollbar">
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={value.groupsOnly} onChange={e => onChange({ ...value, groupsOnly: e.target.checked })} className="accent-emerald-500" />
          Groups only
        </label>

        <div className="space-y-1.5">
          <p className="text-xs text-zinc-400">Amount (€)</p>
          <Slider
            min={bounds.min} max={sliderMax} step={1}
            value={[Math.min(lo, sliderMax), Math.min(hi, sliderMax)]}
            onValueChange={([a, b]) => onChange({
              ...value,
              amountMin: a <= bounds.min ? null : a,
              amountMax: b >= sliderMax ? null : b,
            })}
          />
          <div className="flex items-center gap-2">
            <Input type="number" value={lo} onChange={e => onChange({ ...value, amountMin: e.target.value === '' ? null : Number(e.target.value) })} className="h-7 text-xs font-mono" />
            <span className="text-zinc-600 text-xs">–</span>
            <Input type="number" value={hi} onChange={e => onChange({ ...value, amountMax: e.target.value === '' ? null : Number(e.target.value) })} className="h-7 text-xs font-mono" />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-zinc-400">Date</p>
          <div className="flex items-center gap-2">
            <Input type="date" value={value.dateFrom} onChange={e => onChange({ ...value, dateFrom: e.target.value })} className="h-7 text-xs" />
            <span className="text-zinc-600 text-xs">–</span>
            <Input type="date" value={value.dateTo} onChange={e => onChange({ ...value, dateTo: e.target.value })} className="h-7 text-xs" />
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-zinc-400">Bank</p>
          <div className="grid grid-cols-2 gap-1">
            {BANKS.map(b => (
              <label key={b.value} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={value.banks.includes(b.value)} onChange={() => toggleBank(b.value)} className="accent-emerald-500" />
                {b.label}
              </label>
            ))}
          </div>
        </div>

        {!value.groupsOnly && (
          <div className="space-y-1">
            <p className="text-xs text-zinc-400">Category</p>
            <div className="max-h-40 overflow-y-auto slim-scrollbar space-y-0.5 pr-1">
              {categories.map(c => (
                <label key={c.id} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={value.categoryIds.includes(c.id)} onChange={() => toggleCat(c.id)} className="accent-emerald-500" />
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color ?? '#71717a' }} />
                  <span className="truncate">{c.display_name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-between pt-2 border-t border-zinc-800">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange(emptyFilter)} disabled={count === 0}>Reset</Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
