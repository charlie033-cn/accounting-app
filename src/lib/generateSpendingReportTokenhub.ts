import { GENERATE_SPENDING_REPORT_CLOUD_FUNCTION } from '../accounting/constants'
import type { MonthlyReportAiContext } from './monthlyReportAnalysis'
import type { SpendingReportSummary } from './spendingReport'
import { spendingReportPayload } from './spendingReport'
import { cloudbaseApp } from './cloudbase'

export type GeneratedSpendingInsight = {
  title: string
  analysis: string
  evidence: string[]
}

export type GeneratedSpendingAction = {
  action: string
  target: string
  reason: string
}

export type GeneratedSpendingReport = {
  summary: string
  highlights: string[]
  suggestions: string[]
  narrative?: string
  comparisons?: string[]
  insights?: GeneratedSpendingInsight[]
  actions?: GeneratedSpendingAction[]
}

type CfResult =
  | { ok: true; report?: GeneratedSpendingReport }
  | { ok: false; error: string; raw?: string }

export async function generateSpendingReportWithTokenhub(
  summary: SpendingReportSummary,
  analysisContext?: MonthlyReportAiContext,
): Promise<GeneratedSpendingReport | null> {
  if (!cloudbaseApp || summary.totalExpense <= 0) {
    return null
  }

  const { result } = await cloudbaseApp.callFunction({
    name: GENERATE_SPENDING_REPORT_CLOUD_FUNCTION,
    data: {
      summary: analysisContext ?? spendingReportPayload(summary),
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
    narrative: r.report.narrative || '',
    comparisons: Array.isArray(r.report.comparisons) ? r.report.comparisons.filter(Boolean) : [],
    insights: Array.isArray(r.report.insights)
      ? r.report.insights.filter(
          (item) => item && typeof item.title === 'string' && typeof item.analysis === 'string',
        )
      : [],
    actions: Array.isArray(r.report.actions)
      ? r.report.actions.filter(
          (item) => item && typeof item.action === 'string' && typeof item.reason === 'string',
        )
      : [],
  }
}
