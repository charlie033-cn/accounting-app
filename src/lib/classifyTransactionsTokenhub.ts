import { CLASSIFY_TRANSACTIONS_CLOUD_FUNCTION } from '../accounting/constants'
import type { TransactionType } from '../types/transaction'
import { cloudbaseApp } from './cloudbase'

export type ClassificationInput = {
  id: string
  type: TransactionType
  amount: string
  text: string
  categories: string[]
  subcategoryMap?: Record<string, string[]>
}

export type ClassificationResult = {
  category: string
  subcategory?: string
}

type CfResult =
  | { ok: true; items?: Array<{ id?: string; category?: string; subcategory?: string }> }
  | { ok: false; error: string; raw?: string }

export async function classifyTransactionsWithTokenhub(
  items: ClassificationInput[],
): Promise<Record<string, ClassificationResult>> {
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

  const out: Record<string, ClassificationResult> = {}
  const byId = new Map(items.map((item) => [item.id, item]))
  for (const item of Array.isArray(r.items) ? r.items : []) {
    if (typeof item.id !== 'string' || typeof item.category !== 'string') {
      continue
    }
    const source = byId.get(item.id)
    if (!source || !source.categories.includes(item.category)) {
      continue
    }
    const subcategoryOptions = source.subcategoryMap?.[item.category] ?? []
    const subcategory =
      typeof item.subcategory === 'string' && subcategoryOptions.includes(item.subcategory)
        ? item.subcategory
        : subcategoryOptions[0]
    out[item.id] = {
      category: item.category,
      subcategory,
    }
  }
  return out
}
