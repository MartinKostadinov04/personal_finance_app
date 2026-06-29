import { useRef, useState, useMemo } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { Upload, FileText, X, Users } from 'lucide-react';
import { CategoryPicker } from '@/components/CategoryPicker';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { importApi, categoriesApi, groupsApi, type ImportGroupAssignment } from '@/lib/api';
import { toYMD } from '@/lib/dates';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import type { ParsedTransaction, Category, Group } from '@/lib/types';

// A group staged in the preview before import. `rows` holds ORIGINAL preview indices.
type StagedGroup =
  | { kind: 'new'; name: string; color: string; rows: Set<number> }
  | { kind: 'existing'; groupId: number; name: string; color: string; rows: Set<number> };

// Active group-building session (selection mode), before it's committed to stagedGroups.
type GroupDraft =
  | { kind: 'new'; name: string; color: string; rows: Set<number> }
  | { kind: 'existing'; groupId: number; name: string; color: string; rows: Set<number> };

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
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Grouping (staged in the preview, applied at import).
  const [stagedGroups, setStagedGroups] = useState<StagedGroup[]>([]);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [lastIdx, setLastIdx] = useState<number | null>(null);

  // Display-only sort — never reorders `preview` itself (all state is keyed by original index).
  type SortKey = 'date' | 'description' | 'amount' | 'category';
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll, staleTime: 0 });

  // Existing groups used in the ~2 months leading up to the import target month.
  const since = useMemo(() => toYMD(new Date(year, month - 1 - 2, 1)), [year, month]);
  const { data: recentGroups = [] } = useQuery({
    queryKey: ['groups', { since }],
    queryFn: () => groupsApi.getAll({ since }),
    enabled: open,
  });

  // origIdx → color for rows already placed in a staged group (shown as a dot).
  const rowGroupColor = useMemo(() => {
    const m = new Map<number, string>();
    stagedGroups.forEach(g => g.rows.forEach(r => m.set(r, g.color)));
    return m;
  }, [stagedGroups]);

  const resetAll = () => {
    setPreview(null);
    setFiles({});
    setError(null);
    setEditedCategories({});
    setRemovedRows(new Set());
    setDuplicateRows(new Set());
    setZeroRows(new Set());
    setExpandedRows(new Set());
    setStagedGroups([]);
    setGroupDraft(null);
    setGroupMenuOpen(false);
    setLastIdx(null);
    setSort(null);
  };

  // ── Grouping helpers ──────────────────────────────────────────────
  const startNewGroup = () => {
    setGroupMenuOpen(false);
    setGroupDraft({ kind: 'new', name: '', color: '#8b5cf6', rows: new Set() });
    setLastIdx(null);
  };
  const startExistingGroup = (g: Group) => {
    setGroupMenuOpen(false);
    setGroupDraft({ kind: 'existing', groupId: g.id, name: g.name, color: g.color, rows: new Set() });
    setLastIdx(null);
  };
  const cancelGroupDraft = () => { setGroupDraft(null); setLastIdx(null); };

  // Toggle a preview row in the active draft; shift-click selects the range from the last click.
  const toggleDraftRow = (idx: number, shiftKey: boolean) => {
    setGroupDraft(draft => {
      if (!draft) return draft;
      const rows = new Set(draft.rows);
      if (shiftKey && lastIdx !== null) {
        const [lo, hi] = lastIdx < idx ? [lastIdx, idx] : [idx, lastIdx];
        for (let i = lo; i <= hi; i++) if (!removedRows.has(i)) rows.add(i);
      } else {
        rows.has(idx) ? rows.delete(idx) : rows.add(idx);
      }
      return { ...draft, rows };
    });
    setLastIdx(idx);
  };

  const commitGroupDraft = () => {
    if (!groupDraft || groupDraft.rows.size === 0) { cancelGroupDraft(); return; }
    if (groupDraft.kind === 'new' && !groupDraft.name.trim()) return;
    const staged: StagedGroup = groupDraft.kind === 'new'
      ? { kind: 'new', name: groupDraft.name.trim(), color: groupDraft.color, rows: new Set(groupDraft.rows) }
      : { kind: 'existing', groupId: groupDraft.groupId, name: groupDraft.name, color: groupDraft.color, rows: new Set(groupDraft.rows) };
    // A row belongs to at most one group: drop these rows from any prior staged group, prune empties.
    setStagedGroups(prev => [
      ...prev
        .map(sg => ({ ...sg, rows: new Set([...sg.rows].filter(r => !staged.rows.has(r))) }))
        .filter(sg => sg.rows.size > 0),
      staged,
    ]);
    setGroupDraft(null);
    setLastIdx(null);
  };

  const removeStagedGroup = (gi: number) =>
    setStagedGroups(prev => prev.filter((_, i) => i !== gi));

  // Re-open a committed staged group to keep editing its rows: pull it back into
  // the active draft and drop it from the staged list (commitGroupDraft re-adds it).
  const editStagedGroup = (gi: number) => {
    if (groupDraft) return; // finish the current draft first
    setStagedGroups(prev => {
      const g = prev[gi];
      if (g) setGroupDraft({ ...g, rows: new Set(g.rows) });
      return prev.filter((_, i) => i !== gi);
    });
    setLastIdx(null);
  };

  const toggleExpand = (i: number) =>
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const parseMutation = useMutation({
    mutationFn: ({ file, bank }: { file: File; bank: Bank }) => importApi.parse(file, bank),
    onSuccess: async data => {
      setPreview(data.transactions);
      setEditedCategories({});
      setDuplicateRows(new Set());
      setError(null);
      const zeroSet = new Set(data.transactions.map((tx, i) => tx.amount === 0 ? i : -1).filter(i => i !== -1));
      setZeroRows(zeroSet);
      try {
        const { duplicates } = await importApi.checkDuplicates(data.transactions, year, month);
        const dupSet = new Set(duplicates.map((isDup, i) => isDup ? i : -1).filter(i => i !== -1));
        setDuplicateRows(dupSet);
        setRemovedRows(new Set([...dupSet, ...zeroSet]));
      } catch {
        setRemovedRows(new Set(zeroSet));
      }
    },
    onError: (err: Error) => setError(`Parse failed: ${err.message}`),
  });

  const confirmMutation = useMutation({
    mutationFn: ({ transactions, groups }: { transactions: ParsedTransaction[]; groups: ImportGroupAssignment[] }) =>
      importApi.confirm(transactions, year, month, groups),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['allocation'] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      resetAll();
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
    // Build the final (non-skipped) rows, and a map from original preview index → its
    // position in that final array, so staged group memberships line up after skipping.
    const finalTxs: ParsedTransaction[] = [];
    const indexMap = new Map<number, number>();
    preview.forEach((tx, i) => {
      if (removedRows.has(i)) return;
      indexMap.set(i, finalTxs.length);
      finalTxs.push({ ...tx, category_id: i in editedCategories ? editedCategories[i] : tx.category_id });
    });

    const groups: ImportGroupAssignment[] = [];
    for (const g of stagedGroups) {
      const rowIndices = [...g.rows]
        .map(orig => indexMap.get(orig))
        .filter((v): v is number => v != null);
      if (rowIndices.length === 0) continue;
      groups.push(g.kind === 'existing'
        ? { existingGroupId: g.groupId, rowIndices }
        : { newGroup: { name: g.name, color: g.color }, rowIndices });
    }

    confirmMutation.mutate({ transactions: finalTxs, groups });
  };

  const toggleRemove = (i: number) =>
    setRemovedRows(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  const allCats = (categories as Category[]).filter(c => c.is_active);

  // Display-order array of original preview indices. Sorting is purely presentational —
  // all state (removedRows, editedCategories, groupDraft, etc.) remains keyed by original index.
  const order = useMemo(() => {
    if (!preview) return [] as number[];
    const indices = preview.map((_, i) => i);
    if (!sort) return indices;
    return [...indices].sort((a, b) => {
      const ta = preview[a], tb = preview[b];
      let cmp = 0;
      if (sort.key === 'date') {
        cmp = ta.date < tb.date ? -1 : ta.date > tb.date ? 1 : 0;
      } else if (sort.key === 'description') {
        cmp = (ta.description ?? '').localeCompare(tb.description ?? '');
      } else if (sort.key === 'amount') {
        cmp = ta.amount - tb.amount;
      } else if (sort.key === 'category') {
        const catName = (i: number) => {
          const id = i in editedCategories ? editedCategories[i] : preview[i].category_id;
          return allCats.find(c => c.id === id)?.display_name ?? '';
        };
        cmp = catName(a).localeCompare(catName(b));
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [preview, sort, editedCategories, allCats]);

  const toggleSort = (key: SortKey) =>
    setSort(prev => !prev || prev.key !== key ? { key, dir: 'asc' } : prev.dir === 'asc' ? { key, dir: 'desc' } : null);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) resetAll(); onOpenChange(v); }}>
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
                  <div className="flex items-center gap-2">
                    <Popover open={groupMenuOpen} onOpenChange={setGroupMenuOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" disabled={!!groupDraft}>
                          <Users className="w-3.5 h-3.5 mr-1.5" /> Group
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-60 p-1" align="end">
                        <button
                          onClick={startNewGroup}
                          className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-zinc-800 text-zinc-200"
                        >
                          + New group
                        </button>
                        <div className="border-t border-zinc-800 my-1" />
                        <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">Existing · last 2 months</p>
                        {recentGroups.length === 0 ? (
                          <p className="px-2 py-1.5 text-xs text-zinc-600">None used recently</p>
                        ) : (
                          <div className="max-h-44 overflow-y-auto">
                            {recentGroups.map(g => (
                              <button
                                key={g.id}
                                onClick={() => startExistingGroup(g)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded hover:bg-zinc-800 text-zinc-200"
                              >
                                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                                <span className="truncate">{g.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </PopoverContent>
                    </Popover>
                    <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>← Back</Button>
                  </div>
                </div>

                {groupDraft && (
                  <div className="flex items-center gap-2 mb-3 p-2 rounded-md border border-violet-700/50 bg-violet-900/10">
                    {groupDraft.kind === 'new' ? (
                      <>
                        <input
                          type="color"
                          value={groupDraft.color}
                          onChange={e => setGroupDraft(d => d && { ...d, color: e.target.value })}
                          className="h-7 w-7 rounded cursor-pointer bg-transparent border-0 shrink-0"
                        />
                        <Input
                          autoFocus
                          placeholder="Group name…"
                          value={groupDraft.name}
                          onChange={e => setGroupDraft(d => d && { ...d, name: e.target.value })}
                          onKeyDown={e => e.key === 'Enter' && commitGroupDraft()}
                          className="h-7 text-sm flex-1"
                        />
                      </>
                    ) : (
                      <span className="flex items-center gap-2 flex-1 text-sm text-zinc-200 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: groupDraft.color }} />
                        <span className="truncate">{groupDraft.name}</span>
                      </span>
                    )}
                    <span className="text-xs text-zinc-400 shrink-0">{groupDraft.rows.size} selected</span>
                    <Button
                      size="sm" className="h-7 text-xs shrink-0"
                      onClick={commitGroupDraft}
                      disabled={groupDraft.rows.size === 0 || (groupDraft.kind === 'new' && !groupDraft.name.trim())}
                    >
                      Done
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs shrink-0" onClick={cancelGroupDraft}>Cancel</Button>
                  </div>
                )}

                {stagedGroups.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {stagedGroups.map((g, gi) => (
                      <span
                        key={gi}
                        className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border"
                        style={{ borderColor: g.color, color: g.color }}
                      >
                        <span className="w-2 h-2 rounded-full" style={{ background: g.color }} />
                        <button
                          onClick={() => editStagedGroup(gi)}
                          disabled={!!groupDraft}
                          className="hover:underline disabled:no-underline disabled:opacity-60 disabled:cursor-default"
                          title="Edit this group — add or remove transactions"
                        >
                          {g.name} ({g.rows.size})
                        </button>
                        <button onClick={() => removeStagedGroup(gi)} className="hover:text-rose-400" title="Remove group">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="border border-zinc-800 rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-800">
                      <tr>
                        {groupDraft && <th className="w-8" />}
                        <th className="text-left px-3 py-2 text-xs text-zinc-400 font-medium cursor-pointer select-none hover:text-zinc-200" onClick={() => toggleSort('date')}>
                          Date{sort?.key === 'date' ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </th>
                        <th className="text-left px-3 py-2 text-xs text-zinc-400 font-medium cursor-pointer select-none hover:text-zinc-200" onClick={() => toggleSort('description')}>
                          Description{sort?.key === 'description' ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </th>
                        <th className="text-right px-3 py-2 text-xs text-zinc-400 font-medium cursor-pointer select-none hover:text-zinc-200" onClick={() => toggleSort('amount')}>
                          Amount{sort?.key === 'amount' ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </th>
                        <th className="text-left px-3 py-2 text-xs text-zinc-400 font-medium cursor-pointer select-none hover:text-zinc-200" onClick={() => toggleSort('category')}>
                          Category{sort?.key === 'category' ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                        </th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {order.slice(0, 100).map(i => {
                        const tx = preview[i];
                        const removed = removedRows.has(i);
                        const catId = i in editedCategories ? editedCategories[i] : tx.category_id;
                        const txCats = allCats.filter(c => c.type === tx.type || tx.type === 'transfer');
                        const catsForPicker = txCats.length > 0 ? txCats : allCats;
                        const draftChecked = groupDraft?.rows.has(i) ?? false;
                        const dotColor = draftChecked ? groupDraft!.color : rowGroupColor.get(i);
                        return (
                          <tr key={i} className={cn('hover:bg-zinc-800/40', removed && 'opacity-30', draftChecked && 'bg-violet-900/15')}>
                            {groupDraft && (
                              <td className="px-2 py-1.5 text-center">
                                {!removed && (
                                  <input
                                    type="checkbox" readOnly checked={draftChecked}
                                    onClick={e => toggleDraftRow(i, e.shiftKey)}
                                    className="accent-violet-500 cursor-pointer"
                                  />
                                )}
                              </td>
                            )}
                            <td className="px-3 py-1.5 text-zinc-400 text-xs">{formatDate(tx.date)}</td>
                            <td
                              className="px-3 py-1.5 max-w-[200px] cursor-pointer"
                              onClick={() => !removed && toggleExpand(i)}
                              title={expandedRows.has(i) ? undefined : tx.description}
                            >
                              <span className={cn('block text-xs', expandedRows.has(i) ? 'break-words' : 'truncate')}>
                                {dotColor && (
                                  <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle shrink-0" style={{ background: dotColor }} />
                                )}
                                {tx.description}
                              </span>
                              {(duplicateRows.has(i) || zeroRows.has(i)) && (
                                <div className="flex gap-1 mt-0.5">
                                  {duplicateRows.has(i) && (
                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-800/50">duplicate</span>
                                  )}
                                  {zeroRows.has(i) && (
                                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400 border border-zinc-600/50">zero</span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className={cn('px-3 py-1.5 font-mono tabular-nums text-right text-xs',
                              tx.type === 'income' ? 'text-emerald-500' : 'text-rose-400'
                            )}>
                              {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                            </td>
                            <td className="px-3 py-1.5">
                              <CategoryPicker
                                categories={catsForPicker}
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
                  <Button variant="ghost" onClick={() => { resetAll(); onOpenChange(false); }}>Cancel</Button>
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

