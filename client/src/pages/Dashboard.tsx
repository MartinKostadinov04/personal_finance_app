import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { StatCard } from '@/components/StatCard';
import { BudgetBar } from '@/components/BudgetBar';
import { SummaryPanel } from '@/components/SummaryPanel';
import { AllocationBreakdown } from '@/components/AllocationBreakdown';
import { Card, CardContent } from '@/components/ui/card';
import { monthsApi } from '@/lib/api';
import { useMonth } from '@/contexts/MonthContext';
import type { CategoryTotal } from '@/lib/types';

export function Dashboard() {
  const { year, month, setMonth } = useMonth();

  const { data: summary, isLoading } = useQuery({
    queryKey: ['summary', year, month],
    queryFn: () => monthsApi.getSummary(year, month),
  });

  const { data: prevSummary } = useQuery({
    queryKey: ['summary', month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1],
    queryFn: () => {
      const py = month === 1 ? year - 1 : year;
      const pm = month === 1 ? 12 : month - 1;
      return monthsApi.getSummary(py, pm);
    },
  });

  const isEmpty = !isLoading && summary && summary.income === 0 && summary.expenses === 0;

  const expenseCategories: CategoryTotal[] = (summary?.byCategory ?? []).filter((c: CategoryTotal) => c.type === 'expense' || !c.type);
  const incomeCategories: CategoryTotal[] = (summary?.byCategory ?? []).filter((c: CategoryTotal) => c.type === 'income');
  const prevExpense: CategoryTotal[] = (prevSummary?.byCategory ?? []);
  const prevIncome: CategoryTotal[] = (prevSummary?.byCategory ?? []);

  const totalExpensePlanned = (summary?.budgets ?? []).filter((b: { category_type?: string }) => b.category_type === 'expense').reduce((s: number, b: { planned: number }) => s + b.planned, 0);
  const totalIncomePlanned = (summary?.budgets ?? []).filter((b: { category_type?: string }) => b.category_type === 'income').reduce((s: number, b: { planned: number }) => s + b.planned, 0);

  return (
    <div>
      <PageHeader title="Dashboard">
        <MonthYearPicker value={{ year, month }} onChange={setMonth} />
      </PageHeader>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Start Balance" value={summary?.start_balance ?? 0} />
        <StatCard label="End Balance" value={summary?.end_balance ?? 0} />
        <StatCard label="Saved This Month" value={summary?.saved ?? 0} diff={summary?.saved} />
      </div>

      {isEmpty ? (
        <Card className="py-16">
          <CardContent className="text-center text-zinc-500 p-0">
            <p className="text-lg font-medium mb-1">No transactions yet</p>
            <p className="text-sm">Import your first month from the Transactions page</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-6 mb-6">
            <Card className="p-4 space-y-4">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Expenses</h2>
              <BudgetBar label="Budget" planned={totalExpensePlanned} actual={summary?.expenses ?? 0} />
              <SummaryPanel type="expense" current={expenseCategories} previous={prevExpense} />
            </Card>
            <Card className="p-4 space-y-4">
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Income</h2>
              <BudgetBar label="Budget" planned={totalIncomePlanned} actual={summary?.income ?? 0} />
              <SummaryPanel type="income" current={incomeCategories} previous={prevIncome} />
            </Card>
          </div>

          <Card className="p-4">
            <AllocationBreakdown
              currentByCategory={summary?.byCategory ?? []}
              prevByCategory={prevSummary?.byCategory ?? []}
            />
          </Card>
        </>
      )}
    </div>
  );
}
