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
  /** 周期记账模板 id，手动记账通常为空 */
  recurring_template_id?: string | null
  /** manual | recurring */
  source?: string | null
}

export type TransactionFormState = {
  type: TransactionType
  amount: string
  category: string
  transaction_date: string
  note: string
}
