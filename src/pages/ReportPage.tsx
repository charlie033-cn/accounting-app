import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { currentMonth, currentYear, todayISO } from '../accounting/constants'
import { useAccounting } from '../context/AccountingContext'
import type { CSSProperties } from 'react'
import type { Transaction } from '../types/transaction'
import { categoryEmoji } from '../utils/categoryEmoji'
import { buildSpendingReportSummary } from '../lib/spendingReport'
import {
  generateSpendingReportWithTokenhub,
  type GeneratedSpendingReport,
} from '../lib/generateSpendingReportTokenhub'

type TimeView = 'day' | 'month' | 'year'

type CategoryReportItem = {
  category: string
  amount: number
  count: number
  percent: number
  color: string
  rows: Transaction[]
}

const REPORT_FALLBACK_COLORS = [
  '#008ed9',
  '#40c9e4',
  '#e85d75',
  '#e8892e',
  '#e35d6a',
  '#62b765',
  '#4b8130',
  '#78a800',
  '#ff9943',
  '#3568c2',
  '#88a7fc',
  '#029dd0',
  '#7ad1e8',
  '#d8b400',
  '#d66fa3',
]

const REPORT_CATEGORY_COLORS: Record<string, string> = {
  餐饮: '#ff9943',
  交通: '#029dd0',
  购物: '#e85d75',
  房租: '#3568c2',
  水电: '#40c9e4',
  娱乐: '#f27f6d',
  医疗: '#008ed9',
  旅游: '#62b765',
  人情: '#e35d6a',
  '家居/家具': '#78a800',
  其他: '#88a7fc',
}

const PIE_RADIUS = 78
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS

function fallbackReportColor(category: string) {
  const hash = Array.from(category).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return REPORT_FALLBACK_COLORS[hash % REPORT_FALLBACK_COLORS.length]
}

function reportCategoryColor(category: string) {
  return REPORT_CATEGORY_COLORS[category] ?? fallbackReportColor(category)
}

function dateMatchesPeriod(date: string, timeView: TimeView, day: string, month: string, year: string): boolean {
  if (timeView === 'day') {
    return date === day
  }
  if (timeView === 'month') {
    return date.startsWith(month)
  }
  return year.length === 4 && date.startsWith(year)
}

export function ReportPage() {
  const { transactions, formatMoney } = useAccounting()
  const [searchParams] = useSearchParams()
  const [timeView, setTimeView] = useState<TimeView>('month')
  const [filterDay, setFilterDay] = useState(todayISO)
  const [filterMonth, setFilterMonth] = useState(currentMonth)
  const [filterYear, setFilterYear] = useState(currentYear)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [detailCategory, setDetailCategory] = useState<string | null>(null)
  const [generatedReports, setGeneratedReports] = useState<Record<string, GeneratedSpendingReport>>({})
  const [reportFallbackKeys, setReportFallbackKeys] = useState<Record<string, boolean>>({})
  const [reportLoadingKey, setReportLoadingKey] = useState('')

  const periodLabel =
    timeView === 'day'
      ? filterDay
      : timeView === 'month'
        ? filterMonth
        : filterYear.length === 4
          ? `${filterYear} 年`
          : '选择年份'

  const categoryStats = useMemo<CategoryReportItem[]>(() => {
    const rows = transactions.filter(
      (item) =>
        item.type === 'expense' &&
        dateMatchesPeriod(item.transaction_date, timeView, filterDay, filterMonth, filterYear),
    )
    const total = rows.reduce((sum, item) => sum + item.amount, 0)
    const categoryMap = new Map<string, { amount: number; count: number; rows: Transaction[] }>()

    rows.forEach((item) => {
      const current = categoryMap.get(item.category) ?? { amount: 0, count: 0, rows: [] }
      current.amount += item.amount
      current.count += 1
      current.rows.push(item)
      categoryMap.set(item.category, current)
    })

    return Array.from(categoryMap.entries())
      .map(([category, value]) => ({
        category,
        amount: value.amount,
        count: value.count,
        rows: value.rows.sort((a, b) => (a.transaction_date < b.transaction_date ? 1 : -1)),
        percent: total > 0 ? (value.amount / total) * 100 : 0,
        color: reportCategoryColor(category),
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [transactions, timeView, filterDay, filterMonth, filterYear])

  const periodRows = useMemo(
    () =>
      transactions.filter((item) =>
        dateMatchesPeriod(item.transaction_date, timeView, filterDay, filterMonth, filterYear),
      ),
    [transactions, timeView, filterDay, filterMonth, filterYear],
  )

  const spendingSummary = useMemo(
    () => buildSpendingReportSummary(periodRows, periodLabel),
    [periodRows, periodLabel],
  )
  const reportKey = `${timeView}:${filterDay}:${filterMonth}:${filterYear}`
  const generatedReport = generatedReports[reportKey] ?? null
  const reportFallback = Boolean(reportFallbackKeys[reportKey])
  const autoReportRequested = searchParams.get('aiReport') === '1'
  const reportHighlights = generatedReport?.highlights.length
    ? generatedReport.highlights
    : spendingSummary.localHighlights
  const reportSuggestion = generatedReport?.suggestions[0] ?? spendingSummary.localSuggestions[0]

  const handleGenerateReport = useCallback(async () => {
    if (spendingSummary.totalExpense <= 0 || reportLoadingKey) {
      return
    }
    setReportLoadingKey(reportKey)
    try {
      const report = await generateSpendingReportWithTokenhub(spendingSummary)
      if (report) {
        setGeneratedReports((prev) => ({ ...prev, [reportKey]: report }))
        setReportFallbackKeys((prev) => ({ ...prev, [reportKey]: false }))
      } else {
        setReportFallbackKeys((prev) => ({ ...prev, [reportKey]: true }))
      }
    } finally {
      setReportLoadingKey('')
    }
  }, [reportKey, reportLoadingKey, spendingSummary])

  useEffect(() => {
    if (!autoReportRequested || generatedReport || reportFallback || reportLoadingKey) {
      return
    }
    if (spendingSummary.totalExpense <= 0) {
      return
    }
    void handleGenerateReport()
  }, [
    autoReportRequested,
    generatedReport,
    handleGenerateReport,
    reportFallback,
    reportLoadingKey,
    spendingSummary.totalExpense,
  ])

  const totalExpense = useMemo(
    () => categoryStats.reduce((sum, item) => sum + item.amount, 0),
    [categoryStats],
  )
  const totalCount = useMemo(
    () => categoryStats.reduce((sum, item) => sum + item.count, 0),
    [categoryStats],
  )
  const selectedItem = selectedCategory
    ? categoryStats.find((item) => item.category === selectedCategory) ?? null
    : null
  const selectedPieLabel = useMemo(() => {
    if (!selectedItem) {
      return null
    }

    let percentOffset = 0
    for (const item of categoryStats) {
      const middlePercent = percentOffset + item.percent / 2
      percentOffset += item.percent

      if (item.category !== selectedItem.category) {
        continue
      }

      const angle = (middlePercent / 100) * 360 - 90
      const radians = (angle * Math.PI) / 180
      const x = Math.min(88, Math.max(12, 50 + Math.cos(radians) * 45))
      const y = Math.min(88, Math.max(12, 50 + Math.sin(radians) * 45))

      return {
        item,
        style: {
          '--report-label-x': `${x}%`,
          '--report-label-y': `${y}%`,
          '--report-label-color': item.color,
        } as CSSProperties,
      }
    }

    return null
  }, [categoryStats, selectedItem])
  const detailItem = detailCategory
    ? categoryStats.find((item) => item.category === detailCategory) ?? null
    : null

  useEffect(() => {
    if (!selectedCategory) {
      return
    }
    if (!categoryStats.some((item) => item.category === selectedCategory)) {
      setSelectedCategory(null)
    }
  }, [categoryStats, selectedCategory])

  useEffect(() => {
    if (!detailCategory) {
      return
    }
    if (!categoryStats.some((item) => item.category === detailCategory)) {
      setDetailCategory(null)
    }
  }, [categoryStats, detailCategory])

  return (
    <main className="sub-page-shell">
      <div className="sub-page sub-page--standalone report-page">
        <header className="sub-page-nav">
          <Link className="sub-page-icon-back" to="/transactions" aria-label="返回账单">
            <span aria-hidden>←</span>
          </Link>
          <h1 className="sub-page-title">报表</h1>
        </header>

        <section className="panel report-panel">
          <div className="panel-header report-panel-header">
            <div>
              <p className="eyebrow">消费报表</p>
              <h2>{periodLabel}</h2>
            </div>
          </div>

          <div className="time-view-tabs segmented time-view-segmented">
            <button
              type="button"
              className={timeView === 'day' ? 'active' : ''}
              onClick={() => setTimeView('day')}
            >
              按日
            </button>
            <button
              type="button"
              className={timeView === 'month' ? 'active' : ''}
              onClick={() => setTimeView('month')}
            >
              按月
            </button>
            <button
              type="button"
              className={timeView === 'year' ? 'active' : ''}
              onClick={() => setTimeView('year')}
            >
              按年
            </button>
          </div>

          <div className="report-filters">
            {timeView === 'day' && (
              <label aria-label="日期">
                <input
                  type="date"
                  value={filterDay}
                  onChange={(event) => setFilterDay(event.target.value)}
                />
              </label>
            )}
            {timeView === 'month' && (
              <label aria-label="月份">
                <input
                  type="month"
                  value={filterMonth}
                  onChange={(event) => setFilterMonth(event.target.value)}
                />
              </label>
            )}
            {timeView === 'year' && (
              <label aria-label="年份">
                <input
                  type="number"
                  inputMode="numeric"
                  min={2000}
                  max={2100}
                  value={filterYear}
                  onChange={(event) => setFilterYear(event.target.value.slice(0, 4))}
                />
              </label>
            )}
          </div>

          {(generatedReport || reportFallback || reportLoadingKey === reportKey) && (
            <section className="report-insight-card" aria-label={`${periodLabel} 消费报告`}>
              <div className="report-insight-head">
                <div>
                  <p className="eyebrow">AI 消费报告</p>
                  <h3>{reportLoadingKey === reportKey ? '正在生成报告' : '智能复盘本期消费'}</h3>
                </div>
              </div>
              {reportLoadingKey === reportKey ? (
                <p className="muted report-insight-empty">正在结合 AI 能力分析当前周期账单…</p>
              ) : (
                <>
                  {reportFallback && !generatedReport && (
                    <p className="report-insight-summary">
                      暂时无法生成完整 AI 报告，已先基于本地统计展示消费概览。
                    </p>
                  )}
                  {generatedReport?.summary && (
                    <p className="report-insight-summary">{generatedReport.summary}</p>
                  )}
                  <ul className="report-insight-list">
                    {reportHighlights.slice(0, 4).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {reportSuggestion && <div className="report-insight-suggestion">{reportSuggestion}</div>}
                </>
              )}
            </section>
          )}

          <section className="report-chart-card" aria-label={`${periodLabel} 分类支出占比`}>
            <div className="report-pie-wrap">
              <div className="report-pie">
                <svg className="report-pie-svg" viewBox="0 0 200 200" role="img" aria-label="分类支出占比饼图">
                  <circle className="report-pie-track" cx="100" cy="100" r={PIE_RADIUS} />
                  {(() => {
                    let offset = 0
                    return categoryStats.map((item) => {
                      const dash = (item.percent / 100) * PIE_CIRCUMFERENCE
                      const strokeDashoffset = -offset
                      offset += dash
                      return (
                        <circle
                          key={item.category}
                          className={`report-pie-segment${
                            selectedCategory === item.category ? ' active' : ''
                          }`}
                          cx="100"
                          cy="100"
                          r={PIE_RADIUS}
                          stroke={item.color}
                          strokeDasharray={`${dash} ${PIE_CIRCUMFERENCE - dash}`}
                          strokeDashoffset={strokeDashoffset}
                          onClick={() => setSelectedCategory(item.category)}
                          role="button"
                          tabIndex={0}
                          aria-label={`${item.category} ${item.percent.toFixed(0)}%`}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedCategory(item.category)
                            }
                          }}
                        />
                      )
                    })
                  })()}
                </svg>
                <div className="report-pie-center">
                  <span>总支出</span>
                  <strong>{formatMoney(totalExpense)}</strong>
                </div>
                {selectedPieLabel ? (
                  <div className="report-pie-floating-label" style={selectedPieLabel.style}>
                    <span>{selectedPieLabel.item.category}</span>
                    <strong>{selectedPieLabel.item.percent.toFixed(0)}%</strong>
                    <em>{formatMoney(selectedPieLabel.item.amount)}</em>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="report-chart-summary">
              <span>{periodLabel}</span>
              <strong>{totalCount} 笔支出</strong>
            </div>
          </section>

          {categoryStats.length === 0 ? (
            <div className="empty-state">
              <h3>暂无报表数据</h3>
              <p>当前周期没有支出记录。</p>
            </div>
          ) : (
            <ul className="report-category-list" aria-label="分类支出统计">
              {categoryStats.map((item) => (
                <li
                  className={`report-category-item${
                    selectedCategory === item.category ? ' active' : ''
                  }`}
                  key={item.category}
                  onClick={() => {
                    setSelectedCategory(item.category)
                    setDetailCategory(item.category)
                  }}
                >
                  <span className="report-category-emoji" aria-hidden>
                    {categoryEmoji(item.category, 'expense')}
                  </span>
                  <div className="report-category-main">
                    <div className="report-category-head">
                      <strong>{item.category}</strong>
                      <span>{item.percent.toFixed(0)}%</span>
                    </div>
                    <div className="report-category-track" aria-hidden>
                      <span
                        className="report-category-fill"
                        style={{
                          width: `${Math.max(4, item.percent)}%`,
                          background: item.color,
                        }}
                      />
                    </div>
                  </div>
                  <div className="report-category-side">
                    <strong>{formatMoney(item.amount)}</strong>
                    <span>{item.count} 笔</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {detailItem && createPortal(
        <div className="ledger-receipt-sheet-layer" role="presentation">
          <button
            type="button"
            className="ledger-receipt-sheet-backdrop"
            aria-label="关闭分类支出明细"
            onClick={() => setDetailCategory(null)}
          />
          <section
            className="ledger-receipt-sheet report-detail-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="report-detail-title"
          >
            <div className="ledger-receipt-review-head">
              <h3 id="report-detail-title">{detailItem.category}</h3>
              <button
                type="button"
                className="ledger-receipt-sheet-close"
                aria-label="关闭分类支出明细"
                onClick={() => setDetailCategory(null)}
              >
                ×
              </button>
            </div>

            <div className="ledger-receipt-review-list">
              <div className="report-category-details">
                {detailItem.rows.map((row) => (
                  <article className="transaction-item report-detail-transaction-item" key={row.id}>
                    <div className="transaction-item-main">
                      <span className="transaction-item-emoji" aria-hidden>
                        {categoryEmoji(row.category, row.type)}
                      </span>
                      <div className="transaction-item-meta">
                        <strong className="transaction-item-category">{row.category}</strong>
                        <span className="transaction-item-date">{row.transaction_date}</span>
                      </div>
                      <p className={`transaction-item-amount ${row.type}`}>
                        {row.type === 'expense' ? '-' : '+'}
                        {formatMoney(row.amount)}
                      </p>
                      {row.note ? <p className="transaction-item-note">{row.note}</p> : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </main>
  )
}
