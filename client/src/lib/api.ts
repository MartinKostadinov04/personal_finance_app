import type { Category, Month, Transaction, Budget, StableBudget, MonthlySummaryData, ParsedTransaction, Group, Bill, BillDetail, BillParticipant, BillExpense, Settlement, ExpenseInput } from './types';
import { supabase } from './supabase';

// Attach the current Supabase access token so the API can authenticate the user.
async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...auth, ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const monthsApi = {
  getAll: () => apiFetch<Month[]>('/api/months'),
  getOrCreate: (year: number, month: number) => apiFetch<Month>(`/api/months/${year}/${month}`),
  update: (year: number, month: number, data: Partial<Month>) =>
    apiFetch<Month>(`/api/months/${year}/${month}`, { method: 'PUT', body: JSON.stringify(data) }),
  getSummary: (year: number, month: number) =>
    apiFetch<MonthlySummaryData>(`/api/months/${year}/${month}/summary`),
  getAllocation: (year: number, month: number) =>
    apiFetch<{ current: import('./types').AllocationData; previous: import('./types').AllocationData }>(
      `/api/months/${year}/${month}/allocation`
    ),
};

export const transactionsApi = {
  getAll: (params: { monthId?: number; type?: string; categoryId?: number; bank?: string; search?: string; grouped?: boolean }) => {
    const qs = new URLSearchParams();
    if (params.monthId) qs.set('monthId', String(params.monthId));
    if (params.type) qs.set('type', params.type);
    if (params.categoryId) qs.set('categoryId', String(params.categoryId));
    if (params.bank) qs.set('bank', params.bank);
    if (params.search) qs.set('search', params.search);
    if (params.grouped) qs.set('grouped', '1');
    return apiFetch<Transaction[]>(`/api/transactions?${qs.toString()}`);
  },
  create: (data: Omit<Transaction, 'id' | 'created_at' | 'manually_reviewed' | 'category_display_name' | 'category_color' | 'category_name'>) =>
    apiFetch<Transaction>('/api/transactions', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Transaction> & { year?: number; month?: number }) =>
    apiFetch<Transaction>(`/api/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    apiFetch<{ success: boolean }>(`/api/transactions/${id}`, { method: 'DELETE' }),
};

export const categoriesApi = {
  getAll: () => apiFetch<Category[]>('/api/categories'),
  create: (data: Partial<Category>) =>
    apiFetch<Category>('/api/categories', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<Category>) =>
    apiFetch<Category>(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    apiFetch<{ success: boolean; reassigned: number }>(`/api/categories/${id}`, { method: 'DELETE' }),
};

export const budgetsApi = {
  getAll: (monthId: number) => apiFetch<Budget[]>(`/api/budgets?monthId=${monthId}`),
  upsert: (data: { month_id: number; category_id: number; planned: number; is_active?: 0 | 1 | boolean }) =>
    apiFetch<Budget>('/api/budgets', { method: 'PUT', body: JSON.stringify(data) }),
  copyFromPrevious: (month_id: number) =>
    apiFetch<{ copied: number }>('/api/budgets/copy-from-previous', { method: 'POST', body: JSON.stringify({ month_id }) }),
};

export const stableBudgetsApi = {
  getAll: () => apiFetch<StableBudget[]>('/api/stable-budgets'),
  upsert: (data: { category_id: number; planned: number; is_active?: 0 | 1 | boolean }) =>
    apiFetch<StableBudget>('/api/stable-budgets', { method: 'PUT', body: JSON.stringify(data) }),
  delete: (categoryId: number) =>
    apiFetch<{ success: boolean }>(`/api/stable-budgets/${categoryId}`, { method: 'DELETE' }),
};

export const importApi = {
  parse: async (file: File, bank: string): Promise<{ transactions: ParsedTransaction[]; count: number }> => {
    const form = new FormData();
    form.append('file', file);
    form.append('bank', bank);
    const res = await fetch('/api/import/parse', { method: 'POST', body: form, headers: await authHeader() });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  },
  checkDuplicates: (transactions: ParsedTransaction[], year: number, month: number) =>
    apiFetch<{ duplicates: boolean[] }>('/api/import/check-duplicates', {
      method: 'POST',
      body: JSON.stringify({ transactions, year, month }),
    }),
  confirm: (transactions: ParsedTransaction[], year: number, month: number, groups?: ImportGroupAssignment[]) =>
    apiFetch<{ imported: number; skipped: number; groupsCreated?: number }>('/api/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ transactions, year, month, groups }),
    }),
};

// Group memberships staged during import preview; rowIndices reference positions
// in the submitted `transactions` array. Either targets an existing group or creates one.
export interface ImportGroupAssignment {
  existingGroupId?: number;
  newGroup?: { name: string; color: string };
  rowIndices: number[];
}

export type ExportSection = 'transactions' | 'dashboard' | 'analytics';
export type ExportFormat = 'xlsx' | 'pdf';
export type ExportTypeFilter = 'all' | 'expense' | 'income';

export interface ExportOptions {
  format: ExportFormat;
  fromYear: number; fromMonth: number;
  toYear: number;   toMonth: number;
  sections: ExportSection[];
  typeFilter: ExportTypeFilter;
}

export const exportApi = {
  download: async (opts: ExportOptions) => {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `Export failed (${res.status})`);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') ?? '';
    const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? `finance.${opts.format}`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const merchantRulesApi = {
  getAll: () => apiFetch<import('./types').MerchantRule[]>('/api/merchant-rules'),
  create: (data: { pattern: string; category_id: number; description_clean?: string; match_amount?: number | null; match_type?: 'contains' | 'regex' }) =>
    apiFetch<import('./types').MerchantRule>('/api/merchant-rules', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { pattern: string; category_id: number; description_clean?: string; match_amount?: number | null; match_type: 'contains' | 'regex' }) =>
    apiFetch<import('./types').MerchantRule>(`/api/merchant-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    apiFetch<{ success: boolean }>(`/api/merchant-rules/${id}`, { method: 'DELETE' }),
  bulkCategorize: (data: { pattern: string; category_id: number; scope: string; year: number; month: number; match_amount?: number | null; match_type?: 'contains' | 'regex' }) =>
    apiFetch<{ updated: number }>('/api/transactions/bulk-categorize', { method: 'POST', body: JSON.stringify(data) }),
};

export const groupsApi = {
  getAll: (opts?: { since?: string }) =>
    apiFetch<Group[]>(`/api/groups${opts?.since ? `?since=${encodeURIComponent(opts.since)}` : ''}`),
  create: (data: {
    name: string;
    color?: string;
    memberIds?: number[];
    range?: { fromDate: string; toDate: string };
  }) => apiFetch<Group>('/api/groups', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { name?: string; color?: string }) =>
    apiFetch<Group>(`/api/groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: number) =>
    apiFetch<{ success: boolean }>(`/api/groups/${id}`, { method: 'DELETE' }),
  setMembers: (id: number, data: { add?: number[]; remove?: number[] }) =>
    apiFetch<{ success: boolean }>(`/api/groups/${id}/members`, { method: 'POST', body: JSON.stringify(data) }),
};

export interface TrendPoint {
  label: string;
  year: number;
  month: number;
  income: number;
  expenses: number;
  saved: number;
}

export interface DailyPoint { date: string; amount: number; }

export interface TrendRange {
  fromYear?: number;
  fromMonth?: number;
  toYear?: number;
  toMonth?: number;
}

export const analyticsApi = {
  getTrend: (range?: TrendRange) => {
    const qs = new URLSearchParams();
    if (range?.fromYear)  qs.set('fromYear',  String(range.fromYear));
    if (range?.fromMonth) qs.set('fromMonth', String(range.fromMonth));
    if (range?.toYear)    qs.set('toYear',    String(range.toYear));
    if (range?.toMonth)   qs.set('toMonth',   String(range.toMonth));
    const q = qs.toString();
    return apiFetch<TrendPoint[]>(`/api/analytics/trend${q ? `?${q}` : ''}`);
  },
  getDaily: (year: number, month: number) =>
    apiFetch<{ current: DailyPoint[]; previous: DailyPoint[] }>(
      `/api/analytics/daily?year=${year}&month=${month}`
    ),
};

export const billsApi = {
  getAll: () => apiFetch<Bill[]>('/api/bills'),
  get: (id: number) => apiFetch<BillDetail>(`/api/bills/${id}`),
  create: (data: { name: string; myDisplayName: string; others: { display_name: string; email?: string }[] }) =>
    apiFetch<Bill & { participants: BillParticipant[] }>('/api/bills', { method: 'POST', body: JSON.stringify(data) }),
  rename: (id: number, name: string) =>
    apiFetch<Bill>(`/api/bills/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  remove: (id: number) =>
    apiFetch<{ success: boolean }>(`/api/bills/${id}`, { method: 'DELETE' }),
  close: (id: number) => apiFetch<Bill>(`/api/bills/${id}/close`, { method: 'POST' }),
  reopen: (id: number) => apiFetch<Bill>(`/api/bills/${id}/reopen`, { method: 'POST' }),
  addParticipant: (id: number, data: { display_name: string; email?: string }) =>
    apiFetch<BillParticipant>(`/api/bills/${id}/participants`, { method: 'POST', body: JSON.stringify(data) }),
  updateParticipant: (id: number, pid: number, data: { display_name?: string; covered_by_participant_id?: number | null; settled?: boolean }) =>
    apiFetch<BillParticipant>(`/api/bills/${id}/participants/${pid}`, { method: 'PATCH', body: JSON.stringify(data) }),
  removeParticipant: (id: number, pid: number) =>
    apiFetch<{ success: boolean }>(`/api/bills/${id}/participants/${pid}`, { method: 'DELETE' }),
  addExpense: (id: number, data: ExpenseInput) =>
    apiFetch<{ expense: BillExpense; bill: BillDetail }>(`/api/bills/${id}/expenses`, { method: 'POST', body: JSON.stringify(data) }),
  updateExpense: (id: number, eid: number, data: ExpenseInput) =>
    apiFetch<{ bill: BillDetail }>(`/api/bills/${id}/expenses/${eid}`, { method: 'PATCH', body: JSON.stringify(data) }),
  removeExpense: (id: number, eid: number) =>
    apiFetch<{ success: boolean }>(`/api/bills/${id}/expenses/${eid}`, { method: 'DELETE' }),
  settlement: (id: number) => apiFetch<Settlement>(`/api/bills/${id}/settlement`),
  pushToFinance: (id: number, data?: { category_id?: number }) =>
    apiFetch<{ group: Group; transaction: Transaction }>(`/api/bills/${id}/push-to-finance`, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  uploadReceipt: async (id: number, eid: number, file: File): Promise<{ receipt_path: string }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/bills/${id}/expenses/${eid}/receipt`, { method: 'POST', body: form, headers: await authHeader() });
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(e.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  },
  receiptUrl: (id: number, eid: number) => apiFetch<{ url: string }>(`/api/bills/${id}/expenses/${eid}/receipt`),
};
