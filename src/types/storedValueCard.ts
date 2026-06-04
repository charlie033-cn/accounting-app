export type StoredValueCardStatus = 'active' | 'archived'

export type StoredValueCard = {
  id: string
  user_id: string
  name: string
  merchant: string
  category: string
  subcategory?: string | null
  balance: number
  total_recharged: number
  total_spent: number
  low_balance_threshold?: number | null
  expire_date?: string | null
  status: StoredValueCardStatus
  note?: string | null
  linked_transaction_id?: string | null
  created_at: string
  updated_at: string
}

export type StoredValueCardRecordType = 'recharge' | 'spend' | 'adjust'

export type StoredValueCardRecord = {
  id: string
  user_id: string
  card_id: string
  type: StoredValueCardRecordType
  amount: number
  balance_after: number
  transaction_date: string
  note?: string | null
  linked_transaction_id?: string | null
  created_at: string
}
