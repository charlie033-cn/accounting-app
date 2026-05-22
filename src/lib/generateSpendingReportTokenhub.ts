import { GENERATE_SPENDING_REPORT_CLOUD_FUNCTION } from '../accounting/constants'
import type { SpendingReportSummary } from './spendingReport'
import { spendingReportPayload } from './spendingReport'
import { cloudbaseApp } from './cloudbase'

export type GeneratedSpendingReport = {
  summary: string
  highlights: string[]
  suggestions: string[]
}

type CfResult =
  | { ok: true; report?: GeneratedSpendingReport }
  | { ok: false; error: string; raw?: string }

export async function generateSpendingReportWithTokenhub(
  summary: SpendingReportSummary,
): Promise<GeneratedSpendingReport | null> {
  if (!cloudbaseApp || summary.totalExpense <= 0) {
    return null
  }

  const { result } = await cloudbaseApp.callFunction({
    name: GENERATE_SPENDING_REPORT_CLOUD_FUNCTION,
    data: {
      summary: spendingReportPayload(summary),
    },
  })

  let r = result as CfResult | string
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r) as CfResult
    } catch {
      return null
    }
  }
  if (!r || typeof r !== 'object' || !('ok' in r) || !r.ok || !r.report) {
    return null
  }
  return {
    summary: r.report.summary || '',
    highlights: Array.isArray(r.report.highlights) ? r.report.highlights.filter(Boolean) : [],
    suggestions: Array.isArray(r.report.suggestions) ? r.report.suggestions.filter(Boolean) : [],
  }
}
