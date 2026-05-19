export interface Category {
  id: number;
  name: string;
  display_name: string;
  type: 'expense' | 'income';
  color: string;
  is_active: number;
  sort_order: number;
  created_at: string;
}

export interface Month {
  id: number;
  year: number;
  month: number;
  status: 'active' | 'closed';
  start_balance: number;
  end_balance: number;
  created_at: string;
}

export interface Transaction {
  id: number;
  month_id: number;
  date: string;
  amount: number;
  description: string;
  raw_description: string | null;
  type: 'expense' | 'income' | 'transfer';
  category_id: number | null;
  category_display_name?: string;
  category_color?: string;
  category_name?: string;
  bank: 'revolut' | 'santander' | 'fibank' | 'manual';
  manually_reviewed: number;
  created_at: string;
}

export interface Budget {
  id: number;
  month_id: number | null;
  category_id: number;
  planned: number;
  is_active: number;
  display_name?: string;
  category_name?: string;
  category_type?: 'expense' | 'income';
  color?: string;
}

export interface StableBudget {
  id: number;
  category_id: number;
  planned: number;
  is_active: number;
  display_name?: string;
  category_name?: string;
  category_type?: 'expense' | 'income';
  color?: string;
}

export interface CategoryTotal {
  category_id: number;
  category_name: string;
  display_name: string;
  total: number;
  type: 'expense' | 'income';
  color: string;
}

export interface AllocationData {
  living_costs: number;
  extra_costs: number;
  necessary_allowance: number;
  allowance_f: number;
  difference: number;
}

export interface MonthlySummaryData {
  income: number;
  expenses: number;
  saved: number;
  start_balance: number;
  end_balance: number;
  byCategory: CategoryTotal[];
  budgets: Budget[];
}

export interface MerchantRule {
  id: number;
  pattern: string;
  match_type: 'contains' | 'regex';
  category_id: number | null;
  description_clean: string | null;
  match_amount: number | null;
  category_display_name?: string;
  category_color?: string;
  category_type?: 'expense' | 'income';
  created_at: string;
}

export interface AllocationFormulaEntry {
  rowId: string;
  sign: '+' | '-';
}

export interface AllocationRowConfig {
  id: string;
  label: string;
  categoryIds: number[];
  isDifference: boolean;
  formula: AllocationFormulaEntry[]; // only used when isDifference: true
}

export interface ParsedTransaction {
  date: string;
  amount: number;
  description: string;
  raw_description: string;
  type: 'expense' | 'income' | 'transfer';
  bank: 'revolut' | 'santander' | 'fibank' | 'manual';
  category_id: number | null;
}
