import type { CloudbaseDatabase } from '../lib/cloudbase'
import { RECURRING_COLLECTION, TRANSACTION_COLLECTION } from '../accounting/constants'
import { todayISO, currentMonth } from '../accounting/constants'
import type { RecurringTemplate } from '../types/recurring'
import {
  effectiveBillingDateISO,
  isTemplateActiveInPeriod,
  recurringAmountForPeriod,
} from './recurringSchedule'

type CloudRecurring = Omit<RecurringTemplate, 'id'> & { _id: string }

const toTemplate = (row: CloudRecurring): RecurringTemplate => ({
  id: row._id,
  user_id: row.user_id,
  billing_type: row.billing_type,
  name: row.name,
  amount: Number(row.amount),
  total_amount: row.total_amount == null ? null : Number(row.total_amount),
  category: row.category,
  day_of_month: Number(row.day_of_month),
  start_period: row.start_period,
  start_date: row.start_date ?? null,
  duration_months: Number(row.duration_months),
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
})

/**
 * 打开应用或同步账单后：若今日为某模板的「对齐后记账日」，则自动插入一笔支出（幂等）。
 */
export async function runRecurringGenerationIfDue(
  db: CloudbaseDatabase,
  userId: string,
): Promise<number> {
  const thisMonth = currentMonth()
  const today = todayISO()

  const templatesRes = (await db
    .collection(RECURRING_COLLECTION)
    .where({ user_id: userId })
    .get()) as { data?: CloudRecurring[]; code?: string }

  if (templatesRes.code || !Array.isArray(templatesRes.data)) {
    return 0
  }

  const templates = templatesRes.data.map(toTemplate)
  let added = 0

  for (const template of templates) {
    if (!isTemplateActiveInPeriod(template, thisMonth)) {
      continue
    }

    const effective = effectiveBillingDateISO(thisMonth, template.day_of_month)
    if (effective !== today) {
      continue
    }

    const dup = (await db
      .collection(TRANSACTION_COLLECTION)
      .where({
        user_id: userId,
        recurring_template_id: template.id,
        transaction_date: today,
      })
      .limit(1)
      .get()) as { data?: unknown[]; code?: string }

    const dupList = Array.isArray(dup.data) ? dup.data : []
    if (dup.code || dupList.length > 0) {
      continue
    }

    const now = new Date().toISOString()
    await db.collection(TRANSACTION_COLLECTION).add({
      user_id: userId,
      type: 'expense',
      amount: recurringAmountForPeriod(template, thisMonth),
      category: template.category,
      transaction_date: today,
      note: `周期记账 · ${template.name}`,
      source: 'recurring',
      recurring_template_id: template.id,
      created_at: now,
      updated_at: now,
    })
    added += 1
  }

  return added
}
