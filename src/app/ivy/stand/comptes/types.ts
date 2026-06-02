export type ExpenseStatus = 'engage' | 'soumis' | 'rembourse';

export interface Expense {
  id: string;
  shop_id: string;
  location_id: string | null;
  study_zone_id: string | null;
  spent_on: string;
  description: string;
  amount: number;
  receipt_path: string | null;
  status: ExpenseStatus;
  created_at: string;
}

export interface CashSession {
  id: string;
  shop_id: string;
  location_id: string | null;
  study_zone_id: string | null;
  opening_float: number;
  opened_on: string;
  total_outflows: number;
  balance: number;
}

export interface CashOutflow {
  id: string;
  session_id: string;
  spent_on: string;
  description: string;
  amount: number;
}
