import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { currentMonth } from '../accounting/constants'
import { useAccounting } from '../context/AccountingContext'
import {
  generateSpendingReportWithTokenhub,
  type GeneratedSpendingReport,
} from '../lib/generateSpendingReportTokenhub'
import {
  buildMonthlyReportFingerprint,
  loadMonthlyReportCache,
  saveMonthlyReportCache,
} from '../lib/monthlyReportCache'
import { buildSpendingReportSummary } from '../lib/spendingReport'

function formatMonthEntrance(month: string) {
  const [year, value] = month.split('-')
  return year && value ? `${year}.${value}` : month
}

export function MonthlyReportPage() {
  const { transactions, formatMoney, session } = useAccounting()
  const [month, setMonth] = useState(currentMonth)
  const [reports, setReports] = useState<Record<string, GeneratedSpendingReport>>({})
  const [fallbackReports, setFallbackReports] = useState<Record<string, boolean>>({})
  const [loadingReportKey, setLoadingReportKey] = useState('')

  const monthRows = useMemo(
    () => transactions.filter((item) => item.transaction_date.startsWith(month)),
    [transactions, month],
  )
  const expenseRows = useMemo(
    () =>
      monthRows
        .filter((item) => item.type === 'expense')
        .sort((a, b) => b.amount - a.amount),
    [monthRows],
  )
  const summary = useMemo(() => buildSpendingReportSummary(monthRows, month), [monthRows, month])
  const fingerprint = useMemo(() => buildMonthlyReportFingerprint(monthRows), [monthRows])
  const reportKey = `${month}:${fingerprint}`
  const report = reports[reportKey] ?? null
  const fallback = Boolean(fallbackReports[reportKey])
  const highlights = report?.highlights.length ? report.highlights : summary.localHighlights
  const suggestions = report?.suggestions.length ? report.suggestions : summary.localSuggestions

  const generateReport = useCallback(async () => {
    if (summary.totalExpense <= 0 || loadingReportKey) {
      return
    }
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

      const next = await generateSpendingReportWithTokenhub(summary)
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
    } finally {
      setLoadingReportKey('')
    }
  }, [fingerprint, loadingReportKey, month, reportKey, session?.userId, summary])

  useEffect(() => {
    if (
      summary.totalExpense <= 0 ||
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
    reportKey,
    reports,
    summary.totalExpense,
  ])

  return (
    <main className="sub-page-shell monthly-report-shell">
      <div className="sub-page sub-page--standalone monthly-report-page">
        <header className="sub-page-nav">
          <Link className="sub-page-icon-back" to="/more" aria-label="返回更多">
            <span aria-hidden>←</span>
          </Link>
          <h1 className="sub-page-title">我的月度消费报告</h1>
        </header>

        <section className="panel monthly-report-hero">
          <div className="monthly-report-hero-head">
            <div>
              <p className="eyebrow">AI 消费报告</p>
              <h2>{month} 月度消费报告</h2>
            </div>
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

          {summary.totalExpense <= 0 ? (
            <div className="empty-state monthly-report-empty">
              <h3>本月暂无消费数据</h3>
              <p>添加或导入账单后，就可以生成月度消费报告。</p>
            </div>
          ) : (
            <div className="monthly-report-ai-card">
              {loadingReportKey === reportKey ? (
                <p className="monthly-report-loading">正在结合 AI 能力分析本月账单…</p>
              ) : (
                <>
                  <div className="monthly-report-ai-head">
                    <strong>{report?.summary || '本月消费复盘'}</strong>
                  </div>
                  {fallback && !report && (
                    <p className="monthly-report-fallback">暂时无法生成完整 AI 报告，已先展示本地统计结论。</p>
                  )}
                  <ul className="monthly-report-highlights">
                    {highlights.slice(0, 4).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {suggestions.length > 0 && (
                    <div className="monthly-report-suggestions">
                      {suggestions.slice(0, 2).map((item) => (
                        <p className="monthly-report-suggestion" key={item}>
                          {item}
                        </p>
                      ))}
                    </div>
                  )}
                </>
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
                <span>总收入</span>
                <strong>{formatMoney(summary.totalIncome)}</strong>
              </article>
              <article>
                <span>结余</span>
                <strong>{formatMoney(summary.balance)}</strong>
              </article>
              <article>
                <span>日均支出</span>
                <strong>{formatMoney(summary.averageDailyExpense)}</strong>
              </article>
            </section>

            <section className="panel monthly-report-section">
              <div className="panel-header monthly-report-section-head">
                <div>
                  <p className="eyebrow">消费结构</p>
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
                  <p className="eyebrow">重点支出</p>
                  <h2>本月大额消费</h2>
                </div>
              </div>
              <div className="monthly-report-expense-list">
                {expenseRows.slice(0, 5).map((item) => (
                  <article className="monthly-report-expense-item" key={item.id}>
                    <div>
                      <strong>{item.note || item.category}</strong>
                      <span>{item.transaction_date} · {item.category}</span>
                    </div>
                    <em>{formatMoney(item.amount)}</em>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
