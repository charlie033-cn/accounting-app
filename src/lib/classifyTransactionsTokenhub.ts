import { CLASSIFY_TRANSACTIONS_CLOUD_FUNCTION } from '../accounting/constants'
import type { TransactionType } from '../types/transaction'
import { cloudbaseApp } from './cloudbase'

export type ClassificationInput = {
  id: string
  type: TransactionType
  amount: string
  text: string
  categories: string[]
}

type CfResult =
  | { ok: true; items?: Array<{ id?: string; category?: string }> }
  | { ok: false; error: string; raw?: string }

export async function classifyTransactionsWithTokenhub(
  items: ClassificationInput[],
): Promise<Record<string, string>> {
  if (!cloudbaseApp || items.length === 0) {
    return {}
  }

  const { result } = await cloudbaseApp.callFunction({
    name: CLASSIFY_TRANSACTIONS_CLOUD_FUNCTION,
    data: {
      items: items.slice(0, 30),
    },
  })

  let r = result as CfResult | string
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r) as CfResult
    } catch {
      return {}
    }
  }
  if (!r || typeof r !== 'object' || !('ok' in r) || !r.ok) {
    return {}
  }

  const out: Record<string, string> = {}
  for (const item of Array.isArray(r.items) ? r.items : []) {
    if (typeof item.id === 'string' && typeof item.category === 'string') {
      out[item.id] = item.category
    }
  }
  return out
}
