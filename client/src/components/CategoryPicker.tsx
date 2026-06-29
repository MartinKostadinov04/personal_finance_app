import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Category } from '@/lib/types';

// Compact inline category selector (color dot + name). Used in the import preview
// and for inline category editing in the main transactions table.
export function CategoryPicker({ categories, value, onChange, disabled }: {
  categories: Category[];
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = categories.find(c => c.id === value) ?? null;

  // Close the popover when the trigger button scrolls out of the visible area.
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (!entry.isIntersecting) setOpen(false); },
      { threshold: 0.01 }
    );
    observer.observe(triggerRef.current);
    return () => observer.disconnect();
  }, [open]);

  return (
    <Popover open={open && !disabled} onOpenChange={v => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          disabled={disabled}
          className={cn(
            'flex items-center gap-1.5 h-6 px-2 rounded border text-xs w-full min-w-[140px] transition-colors',
            'border-zinc-700 bg-zinc-900 hover:border-zinc-500',
            disabled && 'opacity-40 cursor-not-allowed'
          )}
        >
          {selected ? (
            <>
              <span className="shrink-0 w-2 h-2 rounded-full" style={{ backgroundColor: selected.color ?? '#71717a' }} />
              <span className="truncate flex-1 text-left" style={{ color: selected.color ?? '#a1a1aa' }}>{selected.display_name}</span>
            </>
          ) : (
            <span className="flex-1 text-left text-zinc-500">Uncategorized</span>
          )}
          <ChevronDown className="shrink-0 w-3 h-3 text-zinc-500 ml-auto" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1 max-h-60 overflow-y-auto slim-scrollbar" align="start">
        <button
          onClick={() => { onChange(null); setOpen(false); }}
          className={cn(
            'flex items-center gap-2 w-full px-2 py-1 rounded text-xs text-zinc-400 hover:bg-zinc-800 transition-colors',
            value === null && 'bg-zinc-800'
          )}
        >
          <span className="w-2 h-2 rounded-full bg-zinc-600 shrink-0" />
          Uncategorized
        </button>
        {categories.map(c => (
          <button
            key={c.id}
            onClick={() => { onChange(c.id); setOpen(false); }}
            className={cn(
              'flex items-center gap-2 w-full px-2 py-1 rounded text-xs hover:bg-zinc-800 transition-colors',
              value === c.id && 'bg-zinc-800'
            )}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color ?? '#71717a' }} />
            <span style={{ color: c.color ?? '#a1a1aa' }}>{c.display_name}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
