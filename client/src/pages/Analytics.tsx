import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
  AreaChart, Area,
  BarChart, Bar,
} from 'recharts';
import { PageHeader } from '@/components/PageHeader';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { useMonth } from '@/contexts/MonthContext';
import { monthsApi, analyticsApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

// ── Shared tooltip style ──────────────────────────────────────────────────────
const TT_STYLE = {
  backgroundColor: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: '6px',
  fontSize: '12px',
  color: '#e4e4e7',
};

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={TT_STYLE} className="px-3 py-2 space-y-1">
      <p className="text-zinc-400 text-xs mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="text-xs">
          {p.name}: {formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">{title}</h2>
      {children}
    </div>
  );
}

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-lg p-4 ${className}`}>
      <p className="text-xs text-zinc-400 font-medium mb-4">{title}</p>
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export function Analytics() {
  const { year, month, setMonth } = useMonth();

  // Period picker state — defaults to last 12 months
  const _now = new Date();
  const _todayYear  = _now.getFullYear();
  const _todayMonth = _now.getMonth() + 1;
  const _fromMonth  = _todayMonth === 1 ? 12 : _todayMonth - 1;
  const _fromYear   = _todayMonth === 1 ? _todayYear - 1 : _todayYear - 1;
  const [periodFrom, setPeriodFrom] = useState({ year: _fromYear, month: _fromMonth });
  const [periodTo,   setPeriodTo]   = useState({ year: _todayYear, month: _todayMonth });

  const handleFromChange = (y: number, m: number) => {
    setPeriodFrom({ year: y, month: m });
    // clamp: if new from > to, pull to up to match
    if (y > periodTo.year || (y === periodTo.year && m > periodTo.month))
      setPeriodTo({ year: y, month: m });
  };

  const handleToChange = (y: number, m: number) => {
    setPeriodTo({ year: y, month: m });
    // clamp: if new to < from, push from down to match
    if (y < periodFrom.year || (y === periodFrom.year && m < periodFrom.month))
      setPeriodFrom({ year: y, month: m });
  };

  const { data: trend = [] } = useQuery({
    queryKey: ['analytics', 'trend', periodFrom.year, periodFrom.month, periodTo.year, periodTo.month],
    queryFn: () => analyticsApi.getTrend({
      fromYear: periodFrom.year, fromMonth: periodFrom.month,
      toYear:   periodTo.year,   toMonth:   periodTo.month,
    }),
  });

  const { data: summary } = useQuery({
    queryKey: ['summary', year, month],
    queryFn: () => monthsApi.getSummary(year, month),
  });

  const { data: daily } = useQuery({
    queryKey: ['analytics', 'daily', year, month],
    queryFn: () => analyticsApi.getDaily(year, month),
  });

  // Donut: expense categories with spend this month
  const donutData = useMemo(() => {
    if (!summary?.byCategory) return [];
    return summary.byCategory
      .filter(bc => bc.type === 'expense' && bc.total > 0)
      .map(bc => ({ name: bc.display_name, value: bc.total, color: bc.color }));
  }, [summary]);

  // Budget vs Actual: all expense categories with any planned or actual spend
  const budgetData = useMemo(() => {
    if (!summary?.byCategory) return [];
    const budgetMap = new Map((summary.budgets ?? []).map(b => [b.category_id, b.planned]));
    return summary.byCategory
      .filter(bc => bc.type === 'expense' && (bc.total > 0 || (budgetMap.get(bc.category_id) ?? 0) > 0))
      .map(bc => {
        const planned = budgetMap.get(bc.category_id) ?? 0;
        return {
          name: bc.display_name,
          actual: bc.total,
          planned,
          color: bc.color,
          over: bc.total > planned && planned > 0,
        };
      })
      .sort((a, b) => b.actual - a.actual);
  }, [summary]);

  // Daily cumulative spend — current month vs previous
  const cumulativeData = useMemo(() => {
    const curRaw  = daily?.current  ?? [];
    const prevRaw = daily?.previous ?? [];

    const toMap = (arr: { date: string; amount: number }[]) =>
      new Map(arr.map(d => [parseInt(d.date.slice(-2)), d.amount]));

    const curMap  = toMap(curRaw);
    const prevMap = toMap(prevRaw);

    const lastCur  = curRaw.length  ? Math.max(...curRaw.map(d => parseInt(d.date.slice(-2))))  : 0;
    const lastPrev = prevRaw.length ? Math.max(...prevRaw.map(d => parseInt(d.date.slice(-2)))) : 0;
    const maxDay   = Math.max(lastCur, lastPrev);

    if (maxDay === 0) return [];

    let curSum = 0, prevSum = 0;
    return Array.from({ length: maxDay }, (_, i) => {
      const day = i + 1;
      curSum  += curMap.get(day)  ?? 0;
      prevSum += prevMap.get(day) ?? 0;
      return {
        day,
        current:  lastCur  > 0 ? curSum  : undefined,
        previous: lastPrev > 0 ? prevSum : undefined,
      };
    });
  }, [daily]);

  const hasTrend   = trend.length > 0;
  const hasDonut   = donutData.length > 0;
  const hasBudget  = budgetData.length > 0;
  const hasCumul   = cumulativeData.length > 0;

  const budgetChartHeight = Math.max(200, budgetData.length * 36);

  return (
    <div className="space-y-10">
      <PageHeader title="Analytics" />

      {/* ── PERIOD ─────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Period</h2>
          <div className="flex items-center gap-2">
            <MonthYearPicker value={periodFrom} onChange={handleFromChange} />
            <span className="text-zinc-600 text-xs">→</span>
            <MonthYearPicker value={periodTo} onChange={handleToChange} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <ChartCard title="Total expenses by month">
            {!hasTrend ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#27272a" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => `€${v}`} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip content={<MoneyTooltip />} cursor={{ stroke: '#52525b' }} />
                  <Line
                    type="monotone"
                    dataKey="expenses"
                    name="Expenses"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    dot={{ fill: '#f43f5e', r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 5, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Income vs Expenses per month">
            {!hasTrend ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={trend} barCategoryGap="30%" barGap={3} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#27272a" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => `€${v}`} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                  <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#27272a' }} />
                  <Bar dataKey="income"   name="Income"   fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#f43f5e" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>
      </div>

      {/* ── THIS MONTH ─────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Monthly</h2>
          <MonthYearPicker value={{ year, month }} onChange={setMonth} />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">

          {/* Donut */}
          <ChartCard title="Expenses by category">
            {!hasDonut ? (
              <Empty />
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {donutData.map((d, i) => (
                        <Cell key={i} fill={d.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0];
                        return (
                          <div style={TT_STYLE} className="px-3 py-2">
                            <p style={{ color: d.payload.color }} className="text-xs font-medium">{d.payload.name}</p>
                            <p className="text-xs text-zinc-300">{formatCurrency(d.value as number)}</p>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="flex-1 space-y-1.5 min-w-0">
                  {donutData.map((d, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="truncate text-zinc-300 flex-1">{d.name}</span>
                      <span className="text-zinc-400 tabular-nums shrink-0">{formatCurrency(d.value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ChartCard>

          {/* Daily cumulative */}
          <ChartCard title="Cumulative spending — this month vs last">
            {!hasCumul ? (
              <Empty />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={cumulativeData}>
                  <defs>
                    <linearGradient id="curGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="prevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#71717a" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#71717a" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#27272a" vertical={false} />
                  <XAxis dataKey="day" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={v => `€${v}`} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={56} />
                  <Tooltip content={<MoneyTooltip />} cursor={{ stroke: '#52525b' }} />
                  <Area type="monotone" dataKey="previous" name="Prev month" stroke="#71717a" strokeWidth={1.5} strokeDasharray="4 3" fill="url(#prevGrad)" connectNulls dot={false} />
                  <Area type="monotone" dataKey="current"  name="This month" stroke="#f43f5e" strokeWidth={2}   fill="url(#curGrad)"  connectNulls dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Budget vs Actual — full width */}
        <ChartCard title="Budget vs Actual">
          {!hasBudget ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={budgetChartHeight}>
              <BarChart data={budgetData} layout="vertical" barCategoryGap="25%" barGap={3}>
                <XAxis type="number" tickFormatter={v => `€${v}`} tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: '#a1a1aa', fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip content={<MoneyTooltip />} cursor={{ fill: '#27272a' }} />
                <Bar dataKey="planned" name="Planned" fill="#3f3f46" radius={[0, 3, 3, 0]} />
                <Bar dataKey="actual"  name="Actual"  radius={[0, 3, 3, 0]}>
                  {budgetData.map((d, i) => (
                    <Cell key={i} fill={d.over ? '#f43f5e' : d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">
      No data yet
    </div>
  );
}
