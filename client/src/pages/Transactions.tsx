import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload, Plus, FolderPlus, FolderCog, Ungroup, Group as GroupIcon } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { TransactionTable } from '@/components/TransactionTable';
import { AddTransactionDialog } from '@/components/AddTransactionDialog';
import { ImportDialog } from '@/components/ImportDialog';
import { GroupDialog, ManageGroupsDialog } from '@/components/GroupDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TransactionFilter, type TxFilter, emptyFilter } from '@/components/TransactionFilter';
import { monthsApi, categoriesApi } from '@/lib/api';
import { useMonth } from '@/contexts/MonthContext';
import type { Category } from '@/lib/types';

export function Transactions() {
  const { year, month, setMonth } = useMonth();
  const [addOpen, setAddOpen] = useState<'expense' | 'income' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [expenseSearch, setExpenseSearch] = useState('');
  const [incomeSearch, setIncomeSearch] = useState('');
  const [expenseFilter, setExpenseFilter] = useState<TxFilter>(emptyFilter);
  const [incomeFilter, setIncomeFilter] = useState<TxFilter>(emptyFilter);
  const [expenseBounds, setExpenseBounds] = useState({ min: 0, max: 5000 });
  const [incomeBounds, setIncomeBounds] = useState({ min: 0, max: 5000 });
  const [expandGroups, setExpandGroups] = useState(false);

  const { data: monthRecord } = useQuery({
    queryKey: ['month', year, month],
    queryFn: () => monthsApi.getOrCreate(year, month),
  });

  const { data: categories = [] } = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.getAll });
  const expenseCats = (categories as Category[]).filter(c => c.type === 'expense' && c.is_active);
  const incomeCats = (categories as Category[]).filter(c => c.type === 'income' && c.is_active);

  const monthId = monthRecord?.id ?? 0;

  return (
    <div>
      <PageHeader title="Transactions">
        <MonthYearPicker value={{ year, month }} onChange={setMonth} />
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4 mr-1.5" /> Import
        </Button>
        <Button size="sm" variant="outline" onClick={() => setGroupOpen(true)}>
          <FolderPlus className="h-4 w-4 mr-1.5" /> New group
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setManageOpen(true)}>
          <FolderCog className="h-4 w-4 mr-1.5" /> Manage
        </Button>
        <Button
          size="sm"
          variant={expandGroups ? 'secondary' : 'ghost'}
          onClick={() => setExpandGroups(v => !v)}
          title={expandGroups ? 'Collapse each group back into one net row' : 'Show every grouped transaction as its own row'}
        >
          {expandGroups ? <GroupIcon className="h-4 w-4 mr-1.5" /> : <Ungroup className="h-4 w-4 mr-1.5" />}
          {expandGroups ? 'Collapse groups' : 'Expand groups'}
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Expenses */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Input
              placeholder="Search date, category, amount, bank…"
              value={expenseSearch}
              onChange={e => setExpenseSearch(e.target.value)}
              className="h-8 text-sm w-full md:flex-1 md:min-w-[150px]"
            />
            <TransactionFilter categories={expenseCats} bounds={expenseBounds} value={expenseFilter} onChange={setExpenseFilter} />
            <Button size="sm" className="h-8 shrink-0" onClick={() => setAddOpen('expense')}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          <TransactionTable monthId={monthId} type="expense" search={expenseSearch} filter={expenseFilter} expandGroups={expandGroups} onAmountBounds={setExpenseBounds} />
        </div>

        {/* Income */}
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Input
              placeholder="Search date, category, amount, bank…"
              value={incomeSearch}
              onChange={e => setIncomeSearch(e.target.value)}
              className="h-8 text-sm w-full md:flex-1 md:min-w-[150px]"
            />
            <TransactionFilter categories={incomeCats} bounds={incomeBounds} value={incomeFilter} onChange={setIncomeFilter} />
            <Button size="sm" className="h-8 shrink-0" onClick={() => setAddOpen('income')}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          <TransactionTable monthId={monthId} type="income" search={incomeSearch} filter={incomeFilter} expandGroups={expandGroups} onAmountBounds={setIncomeBounds} />
        </div>
      </div>

      {addOpen && (
        <AddTransactionDialog
          open={!!addOpen}
          onOpenChange={open => !open && setAddOpen(null)}
          type={addOpen}
          monthId={monthId}
        />
      )}
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} year={year} month={month} />
      <GroupDialog open={groupOpen} onOpenChange={setGroupOpen} year={year} month={month} />
      <ManageGroupsDialog open={manageOpen} onOpenChange={setManageOpen} year={year} month={month} />
    </div>
  );
}
