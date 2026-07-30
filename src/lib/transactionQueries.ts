import { TRANSACTION_COLLECTION } from '../accounting/constants'
import type { Transaction } from '../types/transaction'
import type { CloudbaseDatabase } from './cloudbase'

type CloudTransaction = Omit<Transaction, 'id'> & {
  _id: string
}

export type TransactionDateRange = {
  startDate: string
  endDate: string
}

const TRANSACTION_PAGE_SIZE = 500

const toTransaction = (item: CloudTransaction): Transaction => ({
  id: item._id,
  user_id: item.user_id,
  type: item.type,
  amount: Number(item.amount),
  category: item.category,
  subcategory: item.subcategory ?? null,
  transaction_date: item.transaction_date,
  note: item.note ?? null,
  created_at: item.created_at,
  updated_at: item.updated_at,
  recurring_template_id: item.recurring_template_id ?? null,
  source: item.source ?? null,
})

function normalizeRows(rows: CloudTransaction[]): Transaction[] {
  const byId = new Map(rows.map((row) => [row._id, toTransaction(row)]))
  return [...byId.values()].sort((a, b) => {
    const dateOrder = b.transaction_date.localeCompare(a.transaction_date)
    return dateOrder || b.created_at.localeCompare(a.created_at)
  })
}

export async function fetchRecentTransactions(
  db: CloudbaseDatabase,
  userId: string,
  limit: number,
): Promise<Transaction[]> {
  const result = await db
    .collection(TRANSACTION_COLLECTION)
    .where({ user_id: userId })
    .orderBy('transaction_date', 'desc')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .get()

  return normalizeRows(result.data as CloudTransaction[])
}

export async function fetchTransactionsByDateRange(
  db: CloudbaseDatabase,
  userId: string,
  range: TransactionDateRange,
): Promise<Transaction[]> {
  const rows: CloudTransaction[] = []
  let offset = 0

  while (true) {
    const result = await db
      .collection(TRANSACTION_COLLECTION)
      .where({
        user_id: userId,
        transaction_date: db.command.and(
          db.command.gte(range.startDate as never),
          db.command.lt(range.endDate as never),
        ),
      })
      .orderBy('transaction_date', 'desc')
      .orderBy('created_at', 'desc')
      .skip(offset)
      .limit(TRANSACTION_PAGE_SIZE)
      .get()

    const page = result.data as CloudTransaction[]
    rows.push(...page)
    if (page.length < TRANSACTION_PAGE_SIZE) {
      break
    }
    offset += page.length
  }

  return normalizeRows(rows)
}

export async function fetchAllTransactions(
  db: CloudbaseDatabase,
  userId: string,
): Promise<Transaction[]> {
  const rows: CloudTransaction[] = []
  let offset = 0

  while (true) {
    const result = await db
      .collection(TRANSACTION_COLLECTION)
      .where({ user_id: userId })
      .orderBy('transaction_date', 'desc')
      .orderBy('created_at', 'desc')
      .skip(offset)
      .limit(TRANSACTION_PAGE_SIZE)
      .get()

    const page = result.data as CloudTransaction[]
    rows.push(...page)
    if (page.length < TRANSACTION_PAGE_SIZE) {
      break
    }
    offset += page.length
  }

  return normalizeRows(rows)
}
