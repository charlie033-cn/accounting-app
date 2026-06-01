import { MONTHLY_AI_REPORT_COLLECTION } from '../accounting/constants'
import type { Transaction } from '../types/transaction'
import { cloudbaseDb } from './cloudbase'
import type { GeneratedSpendingReport } from './generateSpendingReportTokenhub'

export const MONTHLY_REPORT_VERSION = '2026-05-charlie-expense-report-v4'

type MonthlyReportCacheDoc = {
  _id: string
  user_id: string
  month: string
  report_version: string
  fingerprint: string
  report: GeneratedSpendingReport
  created_at: string
  updated_at: string
}

function hashString(input: string) {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function buildMonthlyReportFingerprint(rows: Transaction[]) {
  const stableRows = rows
    .map((row) => ({
      id: row.id,
      type: row.type,
      amount: Number(row.amount || 0),
      category: row.category,
      subcategory: row.subcategory ?? '',
      date: row.transaction_date,
      note: row.note ?? '',
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return hashString(JSON.stringify(stableRows))
}

export async function loadMonthlyReportCache(input: {
  userId: string
  month: string
  fingerprint: string
}): Promise<GeneratedSpendingReport | null> {
  if (!cloudbaseDb) {
    return null
  }

  try {
    const result = (await cloudbaseDb
      .collection(MONTHLY_AI_REPORT_COLLECTION)
      .where({
        user_id: input.userId,
        month: input.month,
        report_version: MONTHLY_REPORT_VERSION,
      })
      .limit(1)
      .get()) as { data?: MonthlyReportCacheDoc[] }
    const doc = result.data?.[0]
    if (!doc || doc.fingerprint !== input.fingerprint || !doc.report) {
      return null
    }
    return doc.report
  } catch {
    return null
  }
}

export async function saveMonthlyReportCache(input: {
  userId: string
  month: string
  fingerprint: string
  report: GeneratedSpendingReport
}) {
  if (!cloudbaseDb) {
    return
  }

  try {
    const now = new Date().toISOString()
    const result = (await cloudbaseDb
      .collection(MONTHLY_AI_REPORT_COLLECTION)
      .where({
        user_id: input.userId,
        month: input.month,
        report_version: MONTHLY_REPORT_VERSION,
      })
      .limit(1)
      .get()) as { data?: MonthlyReportCacheDoc[] }
    const existing = result.data?.[0]
    const payload = {
      user_id: input.userId,
      month: input.month,
      report_version: MONTHLY_REPORT_VERSION,
      fingerprint: input.fingerprint,
      report: input.report,
      updated_at: now,
    }

    if (existing?._id) {
      await cloudbaseDb.collection(MONTHLY_AI_REPORT_COLLECTION).doc(existing._id).update(payload)
    } else {
      await cloudbaseDb.collection(MONTHLY_AI_REPORT_COLLECTION).add({
        ...payload,
        created_at: now,
      })
    }
  } catch {
    // Cache failure should not block report generation.
  }
}
