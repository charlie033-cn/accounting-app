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

function isExpenseOnlyReportText(text: string) {
  return !/(收入|结余|现金流|理财收益|工资)/.test(text)
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
  const diagnosis =
    report?.summary && isExpenseOnlyReportText(report.summary)
      ? report.summary
      : summary.charlieDiagnosis
  const reportFindings = report?.highlights.filter(isExpenseOnlyReportText) ?? []
  const reportStrategies = report?.suggestions.filter(isExpenseOnlyReportText) ?? []
  const findings = reportFindings.length ? reportFindings : summary.charlieFindings
  const strategies = reportStrategies.length ? reportStrategies : summary.charlieStrategies

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

          {summary.totalExpense <= 0 ? (
            <div className="empty-state monthly-report-empty">
              <h3>本月暂无消费数据</h3>
              <p>添加或导入账单后，查理就能帮你看看这个月钱花哪了。</p>
            </div>
          ) : (
            <div className="monthly-report-ai-card">
              {loadingReportKey === reportKey ? (
                <p className="monthly-report-loading">查理正在读你的账单，马上给出消费诊断…</p>
              ) : (
                <>
                  <div className="monthly-report-ai-head">
                    <div className="monthly-report-ai-title-row">
                      <span className="monthly-report-ai-badge">{formatMonthEntrance(month)} · 查理的观察</span>
                    </div>
                    <strong>{diagnosis}</strong>
                  </div>
                  {fallback && !report && (
                    <p className="monthly-report-fallback">查理暂时无法联网分析，已先根据本地账单给出判断。</p>
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

            <section className="panel monthly-report-section">
              <div className="panel-header monthly-report-section-head">
                <div>
                  <p className="eyebrow">查理发现这几件事</p>
                  <h2>智能洞察</h2>
                </div>
              </div>
              <ul className="monthly-report-highlights">
                {findings.slice(0, 4).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section className="panel monthly-report-section">
              <div className="panel-header monthly-report-section-head">
                <div>
                  <p className="eyebrow">你的本月消费画像</p>
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

            <section className="panel monthly-report-section">
              <div className="panel-header monthly-report-section-head">
                <div>
                  <p className="eyebrow">钱主要花在哪</p>
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
                  <p className="eyebrow">查理重点关注</p>
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

            {strategies.length > 0 && (
              <section className="panel monthly-report-section">
                <div className="panel-header monthly-report-section-head">
                  <div>
                    <p className="eyebrow">查理给你的下月建议</p>
                    <h2>下月策略</h2>
                  </div>
                </div>
                <div className="monthly-report-suggestions">
                  {strategies.slice(0, 3).map((item) => (
                    <p className="monthly-report-suggestion" key={item}>
                      {item}
                    </p>
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
