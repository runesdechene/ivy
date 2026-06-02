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

export interface CashMovement {
  id: string;
  shop_id: string;
  occurred_on: string;
  amount: number; // signé : > 0 entrée, < 0 sortie
  justification: string;
  created_at: string;
}
