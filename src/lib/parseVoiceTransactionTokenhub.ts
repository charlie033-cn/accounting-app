import { PARSE_VOICE_TRANSACTION_CLOUD_FUNCTION } from '../accounting/constants'
import { cloudbaseApp } from './cloudbase'

export type VoiceTransactionDraft = {
  type: 'expense'
  amount: string
  category: string
  subcategory?: string
  transaction_date: string
  note: string
}

type CfResult =
  | { ok: true; draft?: VoiceTransactionDraft; drafts?: VoiceTransactionDraft[] }
  | { ok: false; error: string; raw?: string }

function localDateISO(offsetDays = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeCategoryTree(categories: string[], subcategoryMap?: Record<string, string[]>) {
  return Object.fromEntries(
    categories.map((category) => [
      category,
      Array.isArray(subcategoryMap?.[category])
        ? subcategoryMap[category].map((item) => item.trim()).filter(Boolean)
        : [],
    ]),
  )
}

function normalizeDraft(
  raw: VoiceTransactionDraft,
  categories: string[],
  categoryTree: Record<string, string[]>,
): VoiceTransactionDraft | null {
  const amount = String(raw.amount ?? '').trim()
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return null
  }
  const date = String(raw.transaction_date ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null
  }
  const category = categories.includes(raw.category) ? raw.category : categories[0] || '其他'
  const subcategoryOptions = categoryTree[category] ?? []
  const subcategory =
    typeof raw.subcategory === 'string' && subcategoryOptions.includes(raw.subcategory.trim())
      ? raw.subcategory.trim()
      : (subcategoryOptions[0] ?? '')
  return {
    type: 'expense',
    amount,
    category,
    subcategory,
    transaction_date: date,
    note: String(raw.note ?? '').trim(),
  }
}

export async function parseVoiceTransactionsWithTokenhub(input: {
  text: string
  categories: string[]
  subcategoryMap?: Record<string, string[]>
}): Promise<VoiceTransactionDraft[]> {
  if (!cloudbaseApp) {
    return []
  }
  const text = input.text.trim()
  const categories = input.categories.map((item) => item.trim()).filter(Boolean)
  if (!text || categories.length === 0) {
    return []
  }
  const categoryTree = normalizeCategoryTree(categories, input.subcategoryMap)

  const { result } = await cloudbaseApp.callFunction({
    name: PARSE_VOICE_TRANSACTION_CLOUD_FUNCTION,
    data: {
      text,
      categories,
      categoryTree,
      currentDate: localDateISO(),
      yesterdayDate: localDateISO(-1),
      tomorrowDate: localDateISO(1),
    },
  })

  let r = result as CfResult | string
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r) as CfResult
    } catch {
      return []
    }
  }
  if (!r || typeof r !== 'object' || !('ok' in r) || !r.ok) {
    return []
  }
  const rawDrafts = Array.isArray(r.drafts) ? r.drafts : r.draft ? [r.draft] : []
  return rawDrafts
    .map((draft) => normalizeDraft(draft, categories, categoryTree))
    .filter((draft): draft is VoiceTransactionDraft => Boolean(draft))
    .slice(0, 10)
}
