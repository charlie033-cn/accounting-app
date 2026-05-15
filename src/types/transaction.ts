export type TransactionType = 'expense' | 'income'

export type Transaction = {
  id: string
  user_id: string
  type: TransactionType
  amount: number
  category: string
  transaction_date: string
  note: string | null
  created_at: string
  updated_at: string
}

export type TransactionFormState = {
  type: TransactionType
  amount: string
  category: string
  transaction_date: string
  note: string
}
