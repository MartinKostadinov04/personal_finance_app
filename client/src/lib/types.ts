export interface Category {
  id: number;
  name: string;
  display_name: string;
  type: 'expense' | 'income';
  color: string;
  is_active: number;
  sort_order: number;
  created_at: string;
  tx_count?: number;
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
  group_id?: number | null;
  group_name?: string | null;
  group_color?: string | null;
  bank: 'revolut' | 'santander' | 'fibank' | 'manual';
  manually_reviewed: number;
  created_at: string;
}

export interface Group {
  id: number;
  name: string;
  color: string;
  created_at: string;
  member_count?: number;
  last_used?: string | null;
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
  // Stable persistence: category names survive id changes (migrations/re-seeds),
  // whereas categoryIds do not. Hydrated back into categoryIds on load.
  categoryNames?: string[];
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

/* ─── Bill Splitting ─── */

export interface BillParticipant {
  id: number;
  bill_id: number;
  user_id: string | null;
  email: string | null;
  display_name: string;
  role: 'owner' | 'member';
  status: 'active' | 'invited' | 'pending';
  covered_by_participant_id: number | null;
  settled: boolean;
  settled_at: string | null;
  created_at: string;
}

export interface ExpensePayer { id: number; expense_id: number; participant_id: number; amount_paid: number; }
export interface ExpenseSplit { id: number; expense_id: number; participant_id: number; share_amount: number; covered_by_participant_id: number | null; }

export interface BillExpense {
  id: number;
  bill_id: number;
  name: string;
  amount: number;
  spent_at: string;
  receipt_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  payers?: ExpensePayer[];
  splits?: ExpenseSplit[];
}

export interface Bill {
  id: number;
  name: string;
  status: 'open' | 'closed';
  currency: string;
  created_by: string;
  created_at: string;
  closed_at: string | null;
  participant_count?: number;
  total_amount?: number;
  participants?: BillParticipant[];
}

export interface BillDetail {
  bill: Bill;
  participants: BillParticipant[];
  expenses: BillExpense[];
}

export interface NetPair { from: number; to: number; amount: number; }

export interface Settlement {
  matrix: Record<number, Record<number, number>>;
  netPairs: NetPair[];
  balances: Record<number, number>;
  perPersonTotalCost: Record<number, number>;
  participants: BillParticipant[];
}

export interface ExpenseInput {
  name: string;
  amount: number;
  spent_at?: string;
  receipt_path?: string | null;
  payers: { participant_id: number; amount_paid: number }[];
  splits: { participant_id: number; share_amount: number; covered_by_participant_id?: number | null }[];
}
