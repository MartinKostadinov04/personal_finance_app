import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { toYMD, parseYMD, formatDisplayDate, MONTH_NAMES } from '@/lib/dates';

const DAY_NAMES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
}

export function DatePicker({ value, onChange }: DatePickerProps) {
  const [open, setOpen] = useState(false);

  const current = parseYMD(value);
  const [viewYear, setViewYear] = useState(current.getFullYear());
  const [viewMonth, setViewMonth] = useState(current.getMonth()); // 0-indexed

  const prevDay = () => {
    const d = parseYMD(value);
    d.setDate(d.getDate() - 1);
    onChange(toYMD(d));
  };

  const nextDay = () => {
    const d = parseYMD(value);
    d.setDate(d.getDate() + 1);
    onChange(toYMD(d));
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  const selectDay = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    onChange(toYMD(d));
    setOpen(false);
  };

  // Build calendar grid
  const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
  const startOffset = (firstDow + 6) % 7; // shift so Mon=0
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null);

  const today = toYMD(new Date());
  const selDay = current.getFullYear() === viewYear && current.getMonth() === viewMonth
    ? current.getDate() : null;

  // Sync view when popover opens
  const handleOpenChange = (o: boolean) => {
    if (o) {
      const d = parseYMD(value);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
    setOpen(o);
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={prevDay} className="h-7 w-7">
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="h-7 px-3 text-sm font-medium min-w-[130px] font-mono">
            {formatDisplayDate(value)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="center">
          {/* Month / year navigation */}
          <div className="flex items-center justify-between mb-3">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={prevMonth}>
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{MONTH_NAMES[viewMonth]}</span>
              <div className="flex items-center gap-0.5">
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setViewYear(y => y - 1)}>
                  <ChevronLeft className="h-2.5 w-2.5" />
                </Button>
                <span className="text-xs text-zinc-400 w-10 text-center">{viewYear}</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setViewYear(y => y + 1)}>
                  <ChevronRight className="h-2.5 w-2.5" />
                </Button>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={nextMonth}>
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_NAMES.map(d => (
              <span key={d} className="text-center text-[10px] text-zinc-500 font-medium py-0.5">{d}</span>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <span key={i} />;
              const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = day === selDay;
              const isToday = iso === today;
              return (
                <button
                  key={i}
                  onClick={() => selectDay(day)}
                  className={cn(
                    'h-7 w-full rounded text-xs transition-colors',
                    isSelected
                      ? 'bg-zinc-100 text-zinc-900 font-semibold'
                      : isToday
                      ? 'text-emerald-400 font-medium hover:bg-zinc-800'
                      : 'text-zinc-300 hover:bg-zinc-800'
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <Button variant="ghost" size="icon" onClick={nextDay} className="h-7 w-7">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
