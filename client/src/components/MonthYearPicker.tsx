import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn, formatMonthYear, getMonthNames } from '@/lib/utils';
import { useState } from 'react';

interface MonthYearPickerProps {
  value: { year: number; month: number };
  onChange: (year: number, month: number) => void;
  label?: string;
}

export function MonthYearPicker({ value, onChange, label }: MonthYearPickerProps) {
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(value.year);
  const monthShort = getMonthNames();

  const selectMonth = (m: number) => {
    onChange(pickerYear, m);
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-0.5">
      {label && <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>}
      <Popover open={open} onOpenChange={v => { if (v) setPickerYear(value.year); setOpen(v); }}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-8 px-3 text-sm font-medium min-w-[130px] justify-center">
            {formatMonthYear(value.year, value.month)}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3">
          <div className="flex items-center justify-between mb-3">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPickerYear(y => y - 1)}>
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <span className="text-sm font-medium">{pickerYear}</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPickerYear(y => y + 1)}>
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {monthShort.map((name, i) => {
              const m = i + 1;
              const isSelected = pickerYear === value.year && m === value.month;
              return (
                <Button
                  key={m}
                  variant="ghost"
                  size="sm"
                  onClick={() => selectMonth(m)}
                  className={cn('h-7 text-xs', isSelected && 'bg-zinc-700 text-white')}
                >
                  {name}
                </Button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
