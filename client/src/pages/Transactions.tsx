import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Upload, Plus, FolderPlus, FolderCog } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { TransactionTable } from '@/components/TransactionTable';
import { AddTransactionDialog } from '@/components/AddTransactionDialog';
import { ImportDialog } from '@/components/ImportDialog';
import { GroupDialog, ManageGroupsDialog } from '@/components/GroupDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  const [expenseCatFilter, setExpenseCatFilter] = useState('all');
  const [incomeCatFilter, setIncomeCatFilter] = useState('all');

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
      </PageHeader>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Expenses */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Input
              placeholder="Search date, category, amount, bank…"
              value={expenseSearch}
              onChange={e => setExpenseSearch(e.target.value)}
              className="h-8 text-sm"
            />
            <Select value={expenseCatFilter} onValueChange={setExpenseCatFilter}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All categories</SelectItem>
                <SelectItem value="groups" className="text-xs">Groups only</SelectItem>
                {expenseCats.map(c => <SelectItem key={c.id} value={String(c.id)} className="text-xs">{c.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 shrink-0" onClick={() => setAddOpen('expense')}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          <TransactionTable monthId={monthId} type="expense" search={expenseSearch} categoryFilter={expenseCatFilter === 'all' ? '' : expenseCatFilter} />
        </div>

        {/* Income */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Input
              placeholder="Search date, category, amount, bank…"
              value={incomeSearch}
              onChange={e => setIncomeSearch(e.target.value)}
              className="h-8 text-sm"
            />
            <Select value={incomeCatFilter} onValueChange={setIncomeCatFilter}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All categories</SelectItem>
                <SelectItem value="groups" className="text-xs">Groups only</SelectItem>
                {incomeCats.map(c => <SelectItem key={c.id} value={String(c.id)} className="text-xs">{c.display_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 shrink-0" onClick={() => setAddOpen('income')}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          <TransactionTable monthId={monthId} type="income" search={incomeSearch} categoryFilter={incomeCatFilter === 'all' ? '' : incomeCatFilter} />
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
