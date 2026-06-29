import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { DatePicker } from '@/components/DatePicker';
import { toYMD } from '@/lib/dates';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { groupsApi, monthsApi, transactionsApi } from '@/lib/api';
import { useMonth } from '@/contexts/MonthContext';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import type { Transaction, Group } from '@/lib/types';

const GROUP_KEYS = [['transactions'], ['summary'], ['allocation'], ['groups']] as const;
function useGroupInvalidate() {
  const qc = useQueryClient();
  return () => GROUP_KEYS.forEach(k => qc.invalidateQueries({ queryKey: k as unknown as string[] }));
}

/* ── Shared transaction multi-picker (one month at a time, selection persists across months) ── */
function TransactionPicker({ year, month, onMonthChange, selected, onToggle }: {
  year: number; month: number;
  onMonthChange: (y: number, m: number) => void;
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  const [search, setSearch] = useState('');
  const { data: monthRecord } = useQuery({
    queryKey: ['month', year, month],
    queryFn: () => monthsApi.getOrCreate(year, month),
  });
  const monthId = monthRecord?.id ?? 0;
  // While searching, look across ALL months so a description from any month is
  // findable; with an empty box, browse the selected month.
  const searching = search.trim().length > 0;
  const { data: rawTxs, isLoading } = useQuery({
    queryKey: ['transactions', { monthId, search, searching }],
    queryFn: () => transactionsApi.getAll(searching ? { search } : { monthId }),
    enabled: searching || !!monthId,
  });
  // Only expense/income that aren't already in a group (existing members are
  // listed separately, above the picker).
  const txs = ((rawTxs ?? []) as Transaction[]).filter(t =>
    t.type !== 'transfer' && t.group_id == null
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <MonthYearPicker value={{ year, month }} onChange={onMonthChange} />
        <Input placeholder="Search transactions…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-sm flex-1" />
      </div>
      <div className="border border-zinc-800 rounded-md overflow-y-auto max-h-72">
        {isLoading ? (
          <p className="text-xs text-zinc-600 text-center py-6">Loading…</p>
        ) : txs.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center py-6">{searching ? 'No matching transactions' : 'No transactions this month'}</p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {txs.map(tx => {
                const checked = selected.has(tx.id);
                return (
                  <tr
                    key={tx.id}
                    onClick={() => onToggle(tx.id)}
                    className={cn(
                      'cursor-pointer border-b border-zinc-800/60 last:border-0',
                      checked ? 'bg-zinc-700/60' : 'hover:bg-zinc-800/40'
                    )}
                  >
                    <td className="pl-3 py-2 w-0">
                      <input type="checkbox" readOnly checked={checked} className="accent-emerald-500 block" />
                    </td>
                    <td className="px-3 py-2 w-0 whitespace-nowrap text-zinc-500 tabular-nums">
                      {formatDate(tx.date)}
                    </td>
                    <td className="py-2 w-full max-w-0">
                      <span className="truncate block" title={tx.description}>{tx.description}</span>
                    </td>
                    <td className="px-3 py-2 w-0 whitespace-nowrap tabular-nums font-mono text-right">
                      <span className={cn(tx.type === 'income' ? 'text-emerald-500' : 'text-rose-400')}>
                        {tx.type === 'income' ? '+' : '−'}{formatCurrency(tx.amount)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ── Create group dialog ── */
export function GroupDialog({ open, onOpenChange, year, month }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  year: number;
  month: number;
}) {
  const invalidate = useGroupInvalidate();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#8b5cf6');
  const [mode, setMode] = useState<'individual' | 'range'>('individual');
  const [pickYear, setPickYear] = useState(year);
  const [pickMonth, setPickMonth] = useState(month);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fromDate, setFromDate] = useState(() => `${year}-${String(month).padStart(2, '0')}-01`);
  const [toDate, setToDate] = useState(() => toYMD(new Date(year, month, 0)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(''); setColor('#8b5cf6'); setMode('individual');
      setPickYear(year); setPickMonth(month);
      setSelected(new Set());
      setFromDate(`${year}-${String(month).padStart(2, '0')}-01`);
      setToDate(toYMD(new Date(year, month, 0)));
      setError('');
    }
  }, [open, year, month]);

  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const canSave = name.trim().length > 0 && !saving &&
    (mode === 'range' || selected.size > 0);

  const handleCreate = async () => {
    setSaving(true); setError('');
    try {
      await groupsApi.create({
        name: name.trim(),
        color,
        ...(mode === 'individual'
          ? { memberIds: [...selected] }
          : { range: { fromDate, toDate } }),
      });
      invalidate();
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto slim-scrollbar">
        <DialogHeader><DialogTitle>New Group</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="flex items-center gap-2">
            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-9 rounded cursor-pointer bg-transparent border-0 shrink-0" />
            <Input placeholder="Group name (e.g. Vacation 2026)" value={name} onChange={e => setName(e.target.value)} className="flex-1" />
          </div>

          <div className="flex gap-1.5">
            <Button size="sm" variant={mode === 'individual' ? 'default' : 'outline'} className="flex-1 h-7 text-xs" onClick={() => setMode('individual')}>Pick transactions</Button>
            <Button size="sm" variant={mode === 'range' ? 'default' : 'outline'} className="flex-1 h-7 text-xs" onClick={() => setMode('range')}>By date range</Button>
          </div>

          {mode === 'individual' ? (
            <>
              <TransactionPicker
                year={pickYear} month={pickMonth}
                onMonthChange={(y, m) => { setPickYear(y); setPickMonth(m); }}
                selected={selected} onToggle={toggle}
              />
              <p className="text-xs text-zinc-500">{selected.size} selected (switch months to add more — selection is kept)</p>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-zinc-500 uppercase tracking-wider">From</span>
                  <DatePicker value={fromDate} onChange={setFromDate} />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-zinc-500 uppercase tracking-wider">To</span>
                  <DatePicker value={toDate} onChange={setToDate} />
                </div>
              </div>
              <p className="text-xs text-zinc-500">All expense & income transactions in this date range will be added to the group.</p>
            </div>
          )}

          {error && <p className="text-xs text-rose-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" onClick={handleCreate} disabled={!canSave}>{saving ? 'Creating…' : 'Create Group'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Manage groups dialog ── */
export function ManageGroupsDialog({ open, onOpenChange, year, month }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  year: number;
  month: number;
}) {
  const invalidate = useGroupInvalidate();
  const { data: groups = [] } = useQuery({ queryKey: ['groups'], queryFn: () => groupsApi.getAll(), enabled: open });
  const [editId, setEditId] = useState<number | null>(null);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) setEditId(null); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto slim-scrollbar">
        <DialogHeader><DialogTitle>Manage Groups</DialogTitle></DialogHeader>
        <div className="space-y-2 mt-2">
          {(groups as Group[]).length === 0 ? (
            <p className="text-sm text-zinc-600 text-center py-8">No groups yet.</p>
          ) : (groups as Group[]).map(g => (
            <GroupRow
              key={g.id} group={g}
              expanded={editId === g.id}
              onToggleExpand={() => setEditId(editId === g.id ? null : g.id)}
              onChanged={invalidate}
              year={year} month={month}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GroupRow({ group, expanded, onToggleExpand, onChanged, year, month }: {
  group: Group;
  expanded: boolean;
  onToggleExpand: () => void;
  onChanged: () => void;
  year: number; month: number;
}) {
  const [name, setName] = useState(group.name);
  const [color, setColor] = useState(group.color);

  useEffect(() => { setName(group.name); setColor(group.color); }, [group.name, group.color]);

  const saveMeta = async () => {
    if (name.trim() !== group.name || color !== group.color) {
      await groupsApi.update(group.id, { name: name.trim(), color });
      onChanged();
    }
  };

  return (
    <div className="border border-zinc-800 rounded-md">
      <div className="flex items-center gap-2 px-3 py-2">
        <input type="color" value={color} onChange={e => setColor(e.target.value)} onBlur={saveMeta} className="h-6 w-6 rounded cursor-pointer bg-transparent border-0 shrink-0" />
        <Input value={name} onChange={e => setName(e.target.value)} onBlur={saveMeta} onKeyDown={e => e.key === 'Enter' && saveMeta()} className="h-7 text-sm flex-1" />
        <span className="text-xs text-zinc-500 shrink-0">{group.member_count ?? 0} items</span>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onToggleExpand}>{expanded ? 'Close' : 'Edit'}</Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-400 shrink-0"><Trash2 className="h-3.5 w-3.5" /></Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{group.name}"?</AlertDialogTitle>
              <AlertDialogDescription>Members will be ungrouped and restored to their original categories. Transactions are not deleted.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={async () => { await groupsApi.delete(group.id); onChanged(); }}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {expanded && (
        <div className="border-t border-zinc-800">
          <GroupMembersEditor group={group} year={year} month={month} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

/* ── Reusable member editor: list + remove + add-from-month picker ── */
export function GroupMembersEditor({ group, year, month, onChanged }: {
  group: Group;
  year: number; month: number;
  onChanged: () => void;
}) {
  const [pickYear, setPickYear] = useState(year);
  const [pickMonth, setPickMonth] = useState(month);
  const [adding, setAdding] = useState<Set<number>>(new Set());

  const { data: rawMembers = [] } = useQuery({
    queryKey: ['transactions', { grouped: true, of: group.id }],
    queryFn: () => transactionsApi.getAll({ grouped: true }),
  });
  const members = (rawMembers as Transaction[]).filter(t => t.group_id === group.id);

  const removeMember = async (id: number) => { await groupsApi.setMembers(group.id, { remove: [id] }); onChanged(); };
  const addSelected = async () => {
    if (adding.size === 0) return;
    await groupsApi.setMembers(group.id, { add: [...adding] });
    setAdding(new Set());
    onChanged();
  };
  const toggleAdd = (id: number) => setAdding(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="p-3 space-y-3">
      <div>
        <p className="text-xs text-zinc-400 mb-1.5">Members</p>
        {members.length === 0 ? (
          <p className="text-xs text-zinc-600">No members.</p>
        ) : (
          <div className="space-y-0.5 max-h-40 overflow-y-auto slim-scrollbar">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-2 text-xs py-0.5">
                <span className="text-zinc-500 tabular-nums shrink-0">{formatDate(m.date)}</span>
                <span className="flex-1 truncate" title={m.description}>{m.description}</span>
                <span className={cn('font-mono tabular-nums shrink-0', m.type === 'income' ? 'text-emerald-500' : 'text-rose-400')}>{m.type === 'income' ? '+' : '−'}{formatCurrency(m.amount)}</span>
                <button onClick={() => removeMember(m.id)} className="text-zinc-600 hover:text-rose-400 shrink-0" title="Remove from group"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs text-zinc-400 mb-1.5">Add transactions</p>
        <TransactionPicker
          year={pickYear} month={pickMonth}
          onMonthChange={(y, m) => { setPickYear(y); setPickMonth(m); }}
          selected={adding} onToggle={toggleAdd}
        />
        <Button size="sm" className="h-7 text-xs mt-2" onClick={addSelected} disabled={adding.size === 0}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add {adding.size > 0 ? adding.size : ''} to group
        </Button>
      </div>
    </div>
  );
}

/* ── Edit a single group (name/color + membership), opened from the table ── */
export function EditGroupDialog({ groupId, onOpenChange }: {
  groupId: number | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { year, month } = useMonth();
  const invalidate = useGroupInvalidate();
  const { data: groups = [] } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.getAll(),
    enabled: groupId != null,
  });
  const group = (groups as Group[]).find(g => g.id === groupId) ?? null;

  const [name, setName] = useState('');
  const [color, setColor] = useState('#71717a');
  useEffect(() => { if (group) { setName(group.name); setColor(group.color); } }, [group?.id, group?.name, group?.color]);

  const saveMeta = async () => {
    if (!group) return;
    if (name.trim() && (name.trim() !== group.name || color !== group.color)) {
      await groupsApi.update(group.id, { name: name.trim(), color });
      invalidate();
    }
  };

  return (
    <Dialog open={groupId != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto slim-scrollbar">
        <DialogHeader><DialogTitle>Edit Group</DialogTitle></DialogHeader>
        {group ? (
          <div className="space-y-3 mt-2">
            <div className="flex items-center gap-2">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} onBlur={saveMeta} className="h-9 w-9 rounded cursor-pointer bg-transparent border-0 shrink-0" />
              <Input value={name} onChange={e => setName(e.target.value)} onBlur={saveMeta} onKeyDown={e => e.key === 'Enter' && saveMeta()} className="flex-1" />
            </div>
            <div className="border border-zinc-800 rounded-md">
              <GroupMembersEditor group={group} year={year} month={month} onChanged={invalidate} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-600 text-center py-8">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
