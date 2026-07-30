import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { currentMonth } from '../accounting/constants'
import { useAccounting } from '../context/AccountingContext'
import {
  generateSpendingReportWithTokenhub,
  type GeneratedSpendingAction,
  type GeneratedSpendingInsight,
  type GeneratedSpendingReport,
} from '../lib/generateSpendingReportTokenhub'
import {
  buildMonthlyReportAiContext,
  monthlyReportHistoryDateRange,
} from '../lib/monthlyReportAnalysis'
import {
  buildMonthlyReportFingerprint,
  loadMonthlyReportCache,
  saveMonthlyReportCache,
} from '../lib/monthlyReportCache'
import { buildSpendingReportSummary } from '../lib/spendingReport'
import type { Transaction } from '../types/transaction'

function formatMonthEntrance(month: string) {
  const [year, value] = month.split('-')
  return year && value ? `${year}.${value}` : month
}

function isExpenseOnlyReportText(text: string) {
  return !/(收入|结余|现金流|理财收益|工资)/.test(text)
}

function formatChange(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return ''
  }
  return `${value >= 0 ? '增加' : '减少'} ${Math.abs(value).toFixed(0)}%`
}

export function MonthlyReportPage() {
  const { transactions, formatMoney, session, loadTransactionsByDateRange } = useAccounting()
  const [month, setMonth] = useState(currentMonth)
  const [reports, setReports] = useState<Record<string, GeneratedSpendingReport>>({})
  const [fallbackReports, setFallbackReports] = useState<Record<string, boolean>>({})
  const [loadingReportKey, setLoadingReportKey] = useState('')
  const [analysisTransactions, setAnalysisTransactions] = useState<Transaction[]>([])
  const [monthLoading, setMonthLoading] = useState(false)
  const [monthError, setMonthError] = useState('')

  const monthRows = useMemo(
    () => analysisTransactions.filter((item) => item.transaction_date.startsWith(`${month}-`)),
    [analysisTransactions, month],
  )
  const expenseRows = useMemo(
    () =>
      monthRows
        .filter((item) => item.type === 'expense')
        .sort((a, b) => b.amount - a.amount),
    [monthRows],
  )
  const summary = useMemo(() => buildSpendingReportSummary(monthRows, month), [monthRows, month])
  const analysisContext = useMemo(
    () => buildMonthlyReportAiContext(analysisTransactions, month),
    [analysisTransactions, month],
  )
  const fingerprint = useMemo(
    () => buildMonthlyReportFingerprint(analysisTransactions),
    [analysisTransactions],
  )
  const reportKey = `${month}:${fingerprint}`
  const report = reports[reportKey] ?? null
  const fallback = Boolean(fallbackReports[reportKey])
  const diagnosis =
    report?.summary && isExpenseOnlyReportText(report.summary)
      ? report.summary
      : ''
  const reportFindings = report?.highlights.filter(isExpenseOnlyReportText) ?? []
  const reportStrategies = report?.suggestions.filter(isExpenseOnlyReportText) ?? []
  const findings = reportFindings.length ? reportFindings : summary.charlieFindings
  const strategies = reportStrategies.length ? reportStrategies : summary.charlieStrategies
  const narrative = report?.narrative && isExpenseOnlyReportText(report.narrative)
    ? report.narrative
    : ''
  const comparisons = (report?.comparisons ?? []).filter(isExpenseOnlyReportText)
  const generatedInsights = (report?.insights ?? []).filter(
    (item) => isExpenseOnlyReportText(item.title) && isExpenseOnlyReportText(item.analysis),
  )
  const generatedActions = (report?.actions ?? []).filter(
    (item) => isExpenseOnlyReportText(item.action) && isExpenseOnlyReportText(item.reason),
  )

  const localComparisons = useMemo(() => {
    const result: string[] = []
    const previous = analysisContext.comparisonReference.previousMonths[0]
    const previousChange = formatChange(
      analysisContext.comparisonReference.comparison.previousMonthChangePercent,
    )
    const basis = analysisContext.selectedMonth.periodProgress.isCurrentMonth
      ? `截至 ${analysisContext.selectedMonth.periodProgress.elapsedDays} 日，`
      : ''
    if (previous && previous.totalExpense > 0 && previousChange) {
      result.push(`${basis}比 ${previous.month} 同期支出${previousChange}。`)
    }
    const averageChange = formatChange(
      analysisContext.comparisonReference.comparison.recentAverageChangePercent,
    )
    if (
      averageChange &&
      analysisContext.comparisonReference.previousMonths.some((item) => item.totalExpense > 0)
    ) {
      result.push(`${basis}相比近三个月有记录月份的同期平均水平${averageChange}。`)
    }
    const categoryChange = analysisContext.comparisonReference.comparison.categoryChanges[0]
    if (categoryChange && Math.abs(categoryChange.changeAmount) > 0) {
      result.push(
        `${categoryChange.category}是同期变化最明显的分类，金额${categoryChange.changeAmount >= 0 ? '增加' : '减少'} ${formatMoney(Math.abs(categoryChange.changeAmount))}。`,
      )
    }
    return result
  }, [analysisContext, formatMoney])

  const localInsightCards = useMemo<GeneratedSpendingInsight[]>(() => {
    const result: GeneratedSpendingInsight[] = []
    if (summary.maxExpense && summary.totalExpense > 0) {
      const impact = (summary.maxExpense.amount / summary.totalExpense) * 100
      result.push({
        title: impact >= 25 ? '一笔大额支出改变了本月结构' : '最大单笔值得单独看',
        analysis:
          impact >= 25
            ? `最大单笔占本月支出的 ${impact.toFixed(0)}%，分类占比很大程度上受到这笔账单影响，不能直接当成日常消费习惯。`
            : `最大单笔占本月支出的 ${impact.toFixed(0)}%，对整体结构有影响，但没有主导整个月。`,
        evidence: [
          `${summary.maxExpense.transaction_date} · ${summary.maxExpense.note || summary.maxExpense.category} · ${formatMoney(summary.maxExpense.amount)}`,
        ],
      })
    }
    const categoryChange = analysisContext.comparisonReference.comparison.categoryChanges[0]
    if (categoryChange && Math.abs(categoryChange.changeAmount) > 0) {
      result.push({
        title: `${categoryChange.category}变化最明显`,
        analysis: `与上月同期相比，这个分类${categoryChange.changeAmount >= 0 ? '多花' : '少花'}了 ${formatMoney(Math.abs(categoryChange.changeAmount))}，是本月结构变化的主要来源之一。`,
        evidence: [
          `本月 ${formatMoney(categoryChange.currentAmount)} · 上月 ${formatMoney(categoryChange.previousAmount)}`,
        ],
      })
    }
    if (analysisContext.selectedMonth.activity.recurringCount > 0) {
      result.push({
        title: '周期支出占用了固定空间',
        analysis: `本月有 ${analysisContext.selectedMonth.activity.recurringCount} 笔周期支出，适合与日常可调整消费分开判断。`,
        evidence: [
          `周期支出合计 ${formatMoney(analysisContext.selectedMonth.activity.recurringExpense)}`,
        ],
      })
    }
    return result.slice(0, 4)
  }, [analysisContext, formatMoney, summary.maxExpense, summary.totalExpense])

  const localActions = useMemo<GeneratedSpendingAction[]>(
    () => strategies.slice(0, 3).map((item) => ({
      action: item,
      target: '',
      reason: '',
    })),
    [strategies],
  )
  const comparisonItems = report
    ? comparisons.length
      ? comparisons
      : localComparisons
    : []
  const insightCards = report
    ? generatedInsights.length
      ? generatedInsights
      : localInsightCards
    : []
  const actionCards = report
    ? generatedActions.length
      ? generatedActions
      : localActions
    : []

  useEffect(() => {
    let cancelled = false

    const loadMonthRows = async () => {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        setAnalysisTransactions([])
        return
      }
      setMonthLoading(true)
      setMonthError('')
      try {
        const rows = await loadTransactionsByDateRange(monthlyReportHistoryDateRange(month))
        if (!cancelled) {
          setAnalysisTransactions(rows)
        }
      } catch (error) {
        if (!cancelled) {
          setAnalysisTransactions([])
          setMonthError(error instanceof Error ? error.message : '月度账单加载失败')
        }
      } finally {
        if (!cancelled) {
          setMonthLoading(false)
        }
      }
    }

    void loadMonthRows()
    return () => {
      cancelled = true
    }
  }, [loadTransactionsByDateRange, month, transactions])

  const generateReport = useCallback(async () => {
    if (summary.totalExpense <= 0 || loadingReportKey) {
      return
    }
    setFallbackReports((prev) => ({ ...prev, [reportKey]: false }))
    setLoadingReportKey(reportKey)
    try {
      if (session?.userId) {
        const cached = await loadMonthlyReportCache({
          userId: session.userId,
          month,
          fingerprint,
        })
        if (cached) {
          setReports((prev) => ({ ...prev, [reportKey]: cached }))
          setFallbackReports((prev) => ({ ...prev, [reportKey]: false }))
          return
        }
      }

      const next = await generateSpendingReportWithTokenhub(summary, analysisContext)
      if (next) {
        setReports((prev) => ({ ...prev, [reportKey]: next }))
        setFallbackReports((prev) => ({ ...prev, [reportKey]: false }))
        if (session?.userId) {
          void saveMonthlyReportCache({
            userId: session.userId,
            month,
            fingerprint,
            report: next,
          })
        }
      } else {
        setFallbackReports((prev) => ({ ...prev, [reportKey]: true }))
      }
    } catch {
      setFallbackReports((prev) => ({ ...prev, [reportKey]: true }))
    } finally {
      setLoadingReportKey('')
    }
  }, [analysisContext, fingerprint, loadingReportKey, month, reportKey, session?.userId, summary])

  useEffect(() => {
    if (
      summary.totalExpense <= 0 ||
      monthLoading ||
      reports[reportKey] ||
      fallbackReports[reportKey] ||
      loadingReportKey
    ) {
      return
    }
    void generateReport()
  }, [
    fallbackReports,
    generateReport,
    loadingReportKey,
    monthLoading,
    reportKey,
    reports,
    summary.totalExpense,
  ])

  return (
    <main className="sub-page-shell monthly-report-shell">
      <div className="sub-page sub-page--standalone monthly-report-page">
        <header className="sub-page-nav">
          <Link className="sub-page-icon-back" to="/transactions" aria-label="返回账单">
            <span aria-hidden>←</span>
          </Link>
          <h1 className="sub-page-title">我的消费洞察</h1>
        </header>

        <section className="panel monthly-report-hero">
          <img className="monthly-report-hero-ip" src="/baogaoip-report-fullbody-transparent.png" alt="查理" />
          <div className="monthly-report-hero-head">
            <span className="sr-only">本月诊断</span>
            <label className="monthly-report-month-entry">
              <span>{formatMonthEntrance(month)}</span>
              <input
                type="month"
                value={month}
                aria-label="选择报告月份"
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
          </div>

          {monthError ? (
            <p className="alert error">{monthError}</p>
          ) : monthLoading ? (
            <p className="monthly-report-loading">正在读取所选月份账单，并准备历史趋势对比…</p>
          ) : summary.totalExpense <= 0 ? (
            <div className="empty-state monthly-report-empty">
              <h3>本月暂无消费数据</h3>
              <p>添加或导入账单后，查理就能帮你看看这个月钱花哪了。</p>
            </div>
          ) : (
            <div className="monthly-report-ai-card">
              {!report && !fallback ? (
                <div className="monthly-report-ai-pending">
                  <strong>查理正在分析所选月份账单</strong>
                  <p className="monthly-report-loading">历史数据仅用于对比，通常需要 10～30 秒。</p>
                </div>
              ) : report ? (
                <div className="monthly-report-ai-head">
                  <div className="monthly-report-ai-title-row">
                    <span className="monthly-report-ai-badge">{formatMonthEntrance(month)} · 查理的观察</span>
                  </div>
                  {diagnosis && <strong>{diagnosis}</strong>}
                  {narrative && <p className="monthly-report-narrative">{narrative}</p>}
                </div>
              ) : (
                <div className="monthly-report-ai-failed">
                  <strong>AI 分析暂时没有生成成功</strong>
                  <p className="monthly-report-fallback">账单数据不会受影响，你可以稍后重新生成。</p>
                  <button type="button" className="secondary-button" onClick={() => void generateReport()}>
                    重新生成
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {summary.totalExpense > 0 && (
          <>
            <section className="monthly-report-metrics">
              <article>
                <span>总支出</span>
                <strong>{formatMoney(summary.totalExpense)}</strong>
              </article>
              <article>
                <span>支出笔数</span>
                <strong>{summary.expenseCount} 笔</strong>
              </article>
              <article>
                <span>最高支出日</span>
                <strong>{summary.topExpenseDay ? summary.topExpenseDay.date.slice(5) : '-'}</strong>
              </article>
              <article>
                <span>日均支出</span>
                <strong>{formatMoney(summary.averageDailyExpense)}</strong>
              </article>
            </section>

            {report && (
              <section className="panel monthly-report-section">
                <div className="panel-header monthly-report-section-head">
                  <div>
                    <h2>查理的判断依据</h2>
                  </div>
                </div>
                {insightCards.length ? (
                  <div className="monthly-report-insight-grid">
                    {insightCards.map((item) => (
                      <article className="monthly-report-insight-card" key={`${item.title}:${item.analysis}`}>
                        <h3>{item.title}</h3>
                        <p>{item.analysis}</p>
                        {item.evidence?.length > 0 && (
                          <ul>
                            {item.evidence.slice(0, 3).map((evidence) => (
                              <li key={evidence}>{evidence}</li>
                            ))}
                          </ul>
                        )}
                      </article>
                    ))}
                  </div>
                ) : (
                  <ul className="monthly-report-highlights">
                    {findings.slice(0, 4).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {comparisonItems.length > 0 && (
              <section className="panel monthly-report-section monthly-report-comparison-section">
                <div className="panel-header monthly-report-section-head">
                  <div>
                    <h2>这次有什么不同</h2>
                  </div>
                </div>
                <div className="monthly-report-comparisons">
                  {comparisonItems.slice(0, 3).map((item) => (
                    <p key={item}>{item}</p>
                  ))}
                </div>
              </section>
            )}

            {fallback && !report && (
              <section className="panel monthly-report-section">
                <div className="panel-header monthly-report-section-head">
                  <div>
                    <h2>{summary.charlieProfile.title}</h2>
                  </div>
                </div>
                <p className="monthly-report-profile-desc">{summary.charlieProfile.description}</p>
                <div className="monthly-report-profile-metrics">
                  {summary.charlieProfile.metrics.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </section>
            )}

            <section className="panel monthly-report-section">
              <div className="panel-header monthly-report-section-head">
                <div>
                  <h2>分类占比</h2>
                </div>
              </div>
              <div className="monthly-report-table">
                {summary.topCategories.map((item) => (
                  <div className="monthly-report-row" key={item.category}>
                    <div>
                      <strong>{item.category}</strong>
                      <span>{item.count} 笔 · {item.percent.toFixed(0)}%</span>
                    </div>
                    <div className="monthly-report-row-bar" aria-hidden>
                      <span style={{ width: `${Math.max(4, item.percent)}%` }} />
                    </div>
                    <em>{formatMoney(item.amount)}</em>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel monthly-report-section">
              <div className="panel-header monthly-report-section-head">
                <div>
                  <h2>本月大额消费</h2>
                </div>
              </div>
              <div className="monthly-report-expense-list">
                {expenseRows.slice(0, 5).map((item) => (
                  <article className="monthly-report-expense-item" key={item.id}>
                    <div>
                      <strong>{item.note || item.category}</strong>
                      <span>{item.transaction_date} · {item.subcategory ? `${item.category} / ${item.subcategory}` : item.category}</span>
                    </div>
                    <em>{formatMoney(item.amount)}</em>
                  </article>
                ))}
              </div>
            </section>

            {actionCards.length > 0 && (
              <section className="panel monthly-report-section">
                <div className="panel-header monthly-report-section-head">
                  <div>
                    <h2>下月行动计划</h2>
                  </div>
                </div>
                <div className="monthly-report-action-list">
                  {actionCards.slice(0, 3).map((item) => (
                    <article className="monthly-report-action" key={`${item.action}:${item.target}`}>
                      <strong>
                        {item.action}
                        {item.target ? ` · ${item.target}` : ''}
                      </strong>
                      {item.reason && <p>{item.reason}</p>}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
