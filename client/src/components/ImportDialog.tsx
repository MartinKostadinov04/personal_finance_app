import { useRef, useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { Upload, FileText, X, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { importApi, categoriesApi } from '@/lib/api';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import type { ParsedTransaction, Category } from '@/lib/types';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: number;
  month: number;
}

type Bank = 'revolut' | 'santander' | 'fibank';

export function ImportDialog({ open, onOpenChange, year, month }: ImportDialogProps) {
  const qc = useQueryClient();
  const [activeBank, setActiveBank] = useState<Bank>('revolut');
  const [files, setFiles] = useState<Partial<Record<Bank, File>>>({});
  const [preview, setPreview] = useState<ParsedTransaction[] | null>(null);
  const [editedCategories, setEditedCategories] = useState<Record<number, number | null>>({});
  const [removedRows, setRemovedRows] = useState<Set<number>>(new Set());
  const [duplicateRows, setDuplicateRows] = useState<Set<number>>(new Set());
  const [zeroRows, setZeroRows] = useState<Set<number>>(new Set());
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll });

  const parseMutation = useMutation({
    mutationFn: ({ file, bank }: { file: File; bank: Bank }) => importApi.parse(file, bank),
    onSuccess: async data => {
      setPreview(data.transactions);
      setEditedCategories({});
      setDuplicateRows(new Set());
      setError(null);
      // Pre-remove zero-amount rows
      const zeroSet = new Set(data.transactions.map((tx, i) => tx.amount === 0 ? i : -1).filter(i => i !== -1));
      setZeroRows(zeroSet);
      // Check for duplicates against the target month and auto-skip them
      try {
        const { duplicates } = await importApi.checkDuplicates(data.transactions, year, month);
        const dupSet = new Set(duplicates.map((isDup, i) => isDup ? i : -1).filter(i => i !== -1));
        setDuplicateRows(dupSet);
        setRemovedRows(new Set([...dupSet, ...zeroSet])); // pre-remove duplicates + zeros
      } catch {
        // Non-fatal: fall back to just zeros
        setRemovedRows(new Set(zeroSet));
      }
    },
    onError: (err: Error) => setError(`Parse failed: ${err.message}`),
  });

  const confirmMutation = useMutation({
    mutationFn: (txs: ParsedTransaction[]) => importApi.confirm(txs, year, month),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['allocation'] });
      setImportResult(result);
      setPreview(null);
      setFiles({});
      setError(null);
      onOpenChange(false);
    },
    onError: (err: Error) => setError(`Import failed: ${err.message}`),
  });

  const handleFileChange = (bank: Bank, file: File | undefined) => {
    if (file) setFiles(f => ({ ...f, [bank]: file }));
  };

  const handleParse = () => {
    const file = files[activeBank];
    if (!file) return;
    parseMutation.mutate({ file, bank: activeBank });
  };

  const handleConfirm = () => {
    if (!preview) return;
    const finalTxs = preview
      .map((tx, i) => ({ ...tx, category_id: i in editedCategories ? editedCategories[i] : tx.category_id }))
      .filter((_, i) => !removedRows.has(i));
    confirmMutation.mutate(finalTxs);
  };

  const toggleRemove = (i: number) =>
    setRemovedRows(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const allCats = (categories as Category[]).filter(c => c.is_active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Transactions</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="flex-1 overflow-auto">
            <Tabs value={activeBank} onValueChange={v => setActiveBank(v as Bank)}>
              <TabsList className="mb-4">
                <TabsTrigger value="revolut">Revolut</TabsTrigger>
                <TabsTrigger value="santander">Santander</TabsTrigger>
                <TabsTrigger value="fibank">Fibank</TabsTrigger>
              </TabsList>
              {(['revolut', 'santander', 'fibank'] as Bank[]).map(bank => (
                <TabsContent key={bank} value={bank}>
                  <FileDropZone
                    bank={bank}
                    file={files[bank]}
                    onFileChange={f => handleFileChange(bank, f)}
                  />
                </TabsContent>
              ))}
            </Tabs>
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-zinc-400">
                {preview.length} parsed
                {duplicateRows.size > 0 && <span className="text-amber-500"> · {duplicateRows.size} duplicate{duplicateRows.size !== 1 ? 's' : ''} skipped</span>}
                {zeroRows.size > 0 && <span className="text-zinc-500"> · {zeroRows.size} zero-value skipped</span>}
                {removedRows.size - duplicateRows.size - zeroRows.size > 0 && ` · ${removedRows.size - duplicateRows.size - zeroRows.size} manually skipped`}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>← Back</Button>
            </div>
            <div className="border border-zinc-800 rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-800">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs text-zinc-400 font-medium">Date</th>
                    <th className="text-left px-3 py-2 text-xs text-zinc-400 font-medium">Description</th>
                    <th className="text-right px-3 py-2 text-xs text-zinc-400 font-medium">Amount</th>
                    <th className="text-left px-3 py-2 text-xs text-zinc-400 font-medium">Category</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {preview.slice(0, 100).map((tx, i) => {
                    const removed = removedRows.has(i);
                    const catId = i in editedCategories ? editedCategories[i] : tx.category_id;
                    const txCats = allCats.filter(c => c.type === tx.type);
                    return (
                      <tr key={i} className={cn('hover:bg-zinc-800/40', removed && 'opacity-30')}>
                        <td className="px-3 py-1.5 text-zinc-400 text-xs">{formatDate(tx.date)}</td>
                        <td className="px-3 py-1.5 max-w-[200px]">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate">{tx.description}</span>
                            {duplicateRows.has(i) && (
                              <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/50">duplicate</span>
                            )}
                            {zeroRows.has(i) && (
                              <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400 border border-zinc-600/50">zero</span>
                            )}
                          </div>
                        </td>
                        <td className={cn('px-3 py-1.5 font-mono tabular-nums text-right text-xs',
                          tx.type === 'income' ? 'text-emerald-500' : 'text-rose-400'
                        )}>
                          {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                        </td>
                        <td className="px-3 py-1.5">
                          <CategoryPicker
                            categories={txCats}
                            value={catId ?? null}
                            onChange={v => setEditedCategories(ec => ({ ...ec, [i]: v }))}
                            disabled={removed}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <button
                            onClick={() => toggleRemove(i)}
                            className={cn(
                              'w-5 h-5 rounded-full flex items-center justify-center text-xs transition-colors',
                              removed
                                ? 'bg-zinc-600 text-zinc-300 hover:bg-zinc-500'
                                : 'text-zinc-500 hover:bg-rose-500/20 hover:text-rose-400'
                            )}
                            title={removed ? 'Restore' : 'Skip this transaction'}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {preview.length > 100 && (
                <p className="text-xs text-zinc-500 px-3 py-2">…and {preview.length - 100} more</p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="mt-4 pt-4 border-t border-zinc-800 flex-col items-stretch gap-2">
          {error && (
            <p className="text-xs text-rose-400 text-right">{error}</p>
          )}
          {!preview ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                onClick={handleParse}
                disabled={!files[activeBank] || parseMutation.isPending}
              >
                {parseMutation.isPending ? 'Parsing…' : 'Parse & Preview'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)}>Back</Button>
              <Button onClick={handleConfirm} disabled={confirmMutation.isPending || preview.length - removedRows.size === 0}>
                {confirmMutation.isPending
                  ? 'Importing…'
                  : preview.length - removedRows.size === 0
                  ? 'Nothing to import'
                  : `Import ${preview.length - removedRows.size} transaction${preview.length - removedRows.size !== 1 ? 's' : ''}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FileDropZone({ bank, file, onFileChange }: { bank: Bank; file?: File; onFileChange: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const accept = bank === 'revolut' ? '.csv' : bank === 'santander' ? '.xlsx,.xls' : '.xls';

  return (
    <div
      className="border-2 border-dashed border-zinc-700 rounded-lg p-8 text-center cursor-pointer hover:border-zinc-500 transition-colors"
      onClick={() => inputRef.current?.click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFileChange(f); }}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFileChange(f); }} />
      {file ? (
        <div className="flex items-center justify-center gap-2 text-emerald-400">
          <FileText className="h-5 w-5" />
          <span className="text-sm font-medium">{file.name}</span>
        </div>
      ) : (
        <div className="text-zinc-500">
          <Upload className="h-8 w-8 mx-auto mb-2" />
          <p className="text-sm">Drop your {bank.charAt(0).toUpperCase() + bank.slice(1)} file here or click to browse</p>
          <p className="text-xs mt-1">{accept}</p>
        </div>
      )}
    </div>
  );
}

function CategoryPicker({ categories, value, onChange, disabled }: {
  categories: Category[];
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = categories.find(c => c.id === value) ?? null;

  return (
    <Popover open={open && !disabled} onOpenChange={v => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <button
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
      <PopoverContent className="w-48 p-1" align="start">
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
