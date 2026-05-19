import { cn, formatCurrency } from '@/lib/utils';
import type { CategoryTotal } from '@/lib/types';

interface SummaryPanelProps {
  type: 'expense' | 'income';
  current: CategoryTotal[];
  previous: CategoryTotal[];
}

export function SummaryPanel({ type, current, previous }: SummaryPanelProps) {
  const filtered = current.filter(c => c.type === type || !c.type);
  const prevMap = new Map(previous.map(p => [p.category_id, p.total]));

  const totalActual = filtered.reduce((s, c) => s + c.total, 0);
  const totalPrev = filtered.reduce((s, c) => s + (prevMap.get(c.category_id) ?? 0), 0);
  const totalDiff = totalActual - totalPrev;

  return (
    <div className="text-sm">
      <div className="grid grid-cols-4 gap-2 text-xs text-zinc-400 uppercase tracking-wider pb-2 border-b border-zinc-800 mb-1">
        <span className="col-span-1">Category</span>
        <span className="text-right font-mono">Previous</span>
        <span className="text-right font-mono">Actual</span>
        <span className="text-right font-mono">Diff</span>
      </div>

      {filtered.map(cat => {
        const prev = prevMap.get(cat.category_id) ?? 0;
        const diff = cat.total - prev;
        const isPositive = type === 'expense' ? diff < 0 : diff > 0;
        return (
          <div key={cat.category_id} className="grid grid-cols-4 gap-2 py-1 hover:bg-zinc-800/40 rounded px-1 -mx-1">
            <span className="col-span-1 text-zinc-300 truncate">{cat.display_name}</span>
            <span className="text-right font-mono tabular-nums text-zinc-400 text-xs">{formatCurrency(prev)}</span>
            <span className="text-right font-mono tabular-nums text-xs">{formatCurrency(cat.total)}</span>
            <span className={cn('text-right font-mono tabular-nums text-xs',
              diff === 0 ? 'text-zinc-400' : isPositive ? 'text-emerald-500' : 'text-rose-500'
            )}>
              {diff > 0 ? '+' : ''}{formatCurrency(diff)}
            </span>
          </div>
        );
      })}

      {/* Totals row — pinned to the bottom with a top border */}
      <div className="grid grid-cols-4 gap-2 py-1.5 border-t border-zinc-700 mt-1 font-medium text-xs">
        <span className="col-span-1 text-zinc-300">Total</span>
        <span className="text-right font-mono tabular-nums text-zinc-300">{formatCurrency(totalPrev)}</span>
        <span className="text-right font-mono tabular-nums text-zinc-300">{formatCurrency(totalActual)}</span>
        <span className={cn('text-right font-mono tabular-nums',
          type === 'expense'
            ? (totalDiff > 0 ? 'text-rose-500' : totalDiff < 0 ? 'text-emerald-500' : 'text-zinc-400')
            : (totalDiff > 0 ? 'text-emerald-500' : totalDiff < 0 ? 'text-rose-500' : 'text-zinc-400')
        )}>
          {totalDiff > 0 ? '+' : ''}{formatCurrency(totalDiff)}
        </span>
      </div>
    </div>
  );
}
