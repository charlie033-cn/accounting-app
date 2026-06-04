import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { currentMonth, currentYear, todayISO } from '../accounting/constants'
import { daysInCalendarMonth } from '../accounting/format'
import { ConfirmActionSheet } from '../components/ConfirmActionSheet'
import { useAccounting } from '../context/AccountingContext'
import type { Transaction, TransactionFormState } from '../types/transaction'
import { categoryEmoji } from '../utils/categoryEmoji'

type TimeView = 'day' | 'month' | 'year'

type ExpenseChartItem = {
  key: string
  label: string
  fullLabel: string
  amount: number
  count: number
  active: boolean
}

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

function formatPeriodControlLabel(timeView: TimeView, day: string, month: string, year: string) {
  if (timeView === 'day') {
    if (!day || day.length < 10) {
      return '日期'
    }
    return day.slice(5)
  }
  if (timeView === 'month') {
    return month || '月份'
  }
  return year || '年份'
}

function getChartAxisStep(maxValue: number, timeView: TimeView) {
  const rawStep = maxValue / 6
  const steps =
    timeView === 'day'
      ? [10, 20, 50, 100, 200, 500, 1000, 2000, 5000]
      : [100, 200, 500, 1000, 1500, 2000, 3000, 5000, 10000]
  return steps.find((step) => rawStep <= step) ?? steps[steps.length - 1]
}

function formatAxisMoney(value: number) {
  return `¥${Math.round(value).toLocaleString('zh-CN')}`
}

export function TransactionsPage() {
  const {
    transactions,
    formatMoney,
    updateTransaction,
    handleDeleteTransaction,
    categoryOptions,
    subcategoryOptions,
    isLoading,
  } = useAccounting()

  const [timeView, setTimeView] = useState<TimeView>('month')
  const [filterDay, setFilterDay] = useState(todayISO)
  const [filterMonth, setFilterMonth] = useState(currentMonth)
  const [filterYear, setFilterYear] = useState(currentYear)
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedSubcategory, setSelectedSubcategory] = useState('all')
  const [selectedTrendKey, setSelectedTrendKey] = useState<string | null>(null)
  const [trendChartScrollLeft, setTrendChartScrollLeft] = useState(0)
  const [selectedReportCategory, setSelectedReportCategory] = useState<string | null>(null)
  const [detailCategory, setDetailCategory] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [swipedId, setSwipedId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<Transaction | null>(null)
  const [editDraft, setEditDraft] = useState<TransactionFormState>({
    type: 'expense',
    amount: '',
    category: '',
    subcategory: '',
    transaction_date: todayISO(),
    note: '',
  })
  const [editError, setEditError] = useState('')

  const chartPeriod = timeView === 'year' ? filterYear : timeView === 'day' ? filterDay.slice(0, 7) : filterMonth

  const expenseOptions = categoryOptions('expense')
  const availableCategories = useMemo(() => {
    return expenseOptions
  }, [expenseOptions])

  const availableSubcategories = useMemo(() => {
    if (selectedCategory === 'all') {
      return []
    }
    return subcategoryOptions(selectedCategory)
  }, [selectedCategory, subcategoryOptions])

  const firstSubcategory = (category: string) => subcategoryOptions(category)[0] ?? ''

  const periodLabel =
    timeView === 'day'
      ? filterDay
      : timeView === 'month'
        ? filterMonth
        : filterYear.length === 4
          ? `${filterYear} 年`
          : '选择年份'
  const periodControlLabel = formatPeriodControlLabel(timeView, filterDay, filterMonth, filterYear)

  const periodExpenseRows = useMemo(() => {
    return transactions.filter((item) => {
      if (item.type !== 'expense') {
        return false
      }
      if (timeView === 'day') {
        return item.transaction_date === filterDay
      }
      if (timeView === 'month') {
        return item.transaction_date.startsWith(filterMonth)
      }
      return filterYear.length === 4 && item.transaction_date.startsWith(filterYear)
    })
  }, [transactions, timeView, filterDay, filterMonth, filterYear])

  const filteredPeriodExpenseRows = useMemo(() => {
    return periodExpenseRows.filter((item) => {
      const matchCategory = selectedCategory === 'all' || item.category === selectedCategory
      const matchSubcategory = selectedSubcategory === 'all' || item.subcategory === selectedSubcategory
      return matchCategory && matchSubcategory
    })
  }, [periodExpenseRows, selectedCategory, selectedSubcategory])

  const expenseChartItems = useMemo<ExpenseChartItem[]>(() => {
    const expenseRows = filteredPeriodExpenseRows

    if (timeView === 'year') {
      const year = filterYear.length === 4 ? filterYear : currentYear()
      return Array.from({ length: 12 }, (_, index) => {
        const month = String(index + 1).padStart(2, '0')
        const period = `${year}-${month}`
        const periodRows = expenseRows.filter((item) => item.transaction_date.startsWith(period))
        const amount = periodRows.reduce((sum, item) => sum + item.amount, 0)
        return {
          key: period,
          label: `${index + 1}月`,
          fullLabel: `${year}年${index + 1}月`,
          amount,
          count: periodRows.length,
          active: currentMonth() === period,
        }
      })
    }

    const period = chartPeriod.length === 7 ? chartPeriod : currentMonth()
    const days = daysInCalendarMonth(period)
    return Array.from({ length: days }, (_, index) => {
      const day = String(index + 1).padStart(2, '0')
      const date = `${period}-${day}`
      const dayRows = expenseRows.filter((item) => item.transaction_date === date)
      const amount = dayRows.reduce((sum, item) => sum + item.amount, 0)
      const displayDay = index + 1
      return {
        key: date,
        label: String(displayDay),
        fullLabel: `${period.slice(5, 7)}月${index + 1}日`,
        amount,
        count: dayRows.length,
        active: todayISO() === date,
      }
    })
  }, [filteredPeriodExpenseRows, timeView, filterYear, chartPeriod, filterDay])

  const chartMaxExpense = useMemo(
    () => Math.max(...expenseChartItems.map((item) => item.amount), 0),
    [expenseChartItems],
  )

  const chartTotalExpense = useMemo(
    () => expenseChartItems.reduce((sum, item) => sum + item.amount, 0),
    [expenseChartItems],
  )

  const chartYAxisTicks = useMemo(() => {
    const step = getChartAxisStep(chartMaxExpense, timeView)
    const maxTick = Math.max(step, Math.ceil(chartMaxExpense / step) * step)
    return Array.from({ length: maxTick / step + 1 }, (_, index) => maxTick - index * step)
  }, [chartMaxExpense, timeView])

  const chartAxisMaxExpense = chartYAxisTicks[0] ?? 100

  useEffect(() => {
    if (expenseChartItems.length === 0) {
      setSelectedTrendKey(null)
      return
    }
    if (selectedTrendKey && expenseChartItems.some((item) => item.key === selectedTrendKey)) {
      return
    }
    const activeItem = expenseChartItems.find((item) => item.active) ?? expenseChartItems[expenseChartItems.length - 1]
    setSelectedTrendKey(activeItem.key)
  }, [expenseChartItems, selectedTrendKey])

  const selectedTrendIndex = useMemo(
    () => expenseChartItems.findIndex((item) => item.key === selectedTrendKey),
    [expenseChartItems, selectedTrendKey],
  )

  const selectedTrendItem = selectedTrendIndex >= 0 ? expenseChartItems[selectedTrendIndex] : null
  const trendChartAxisWidth = 50
  const trendBarWidth = timeView === 'year' ? 24 : 10
  const trendBarGap = timeView === 'year' ? 10 : 2
  const selectedTrendX =
    selectedTrendIndex >= 0
      ? trendChartAxisWidth +
        selectedTrendIndex * (trendBarWidth + trendBarGap) +
        trendBarWidth / 2 -
        trendChartScrollLeft
      : 0

  const categoryStats = useMemo<CategoryReportItem[]>(() => {
    const total = filteredPeriodExpenseRows.reduce((sum, item) => sum + item.amount, 0)
    const categoryMap = new Map<string, { amount: number; count: number; rows: Transaction[] }>()
    filteredPeriodExpenseRows.forEach((item) => {
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
        percent: total > 0 ? (value.amount / total) * 100 : 0,
        color: reportCategoryColor(category),
        rows: value.rows.sort((a, b) => (a.transaction_date < b.transaction_date ? 1 : -1)),
      }))
      .sort((a, b) => b.amount - a.amount)
  }, [filteredPeriodExpenseRows])

  const totalExpense = useMemo(
    () => categoryStats.reduce((sum, item) => sum + item.amount, 0),
    [categoryStats],
  )
  const totalCount = useMemo(
    () => categoryStats.reduce((sum, item) => sum + item.count, 0),
    [categoryStats],
  )

  const filteredTransactions = filteredPeriodExpenseRows
  const selectedReportItem = selectedReportCategory
    ? categoryStats.find((item) => item.category === selectedReportCategory) ?? null
    : null
  const selectedPieLabel = useMemo(() => {
    if (!selectedReportItem) {
      return null
    }
    let percentOffset = 0
    for (const item of categoryStats) {
      const middlePercent = percentOffset + item.percent / 2
      percentOffset += item.percent
      if (item.category !== selectedReportItem.category) {
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
  }, [categoryStats, selectedReportItem])
  const detailItem = detailCategory
    ? categoryStats.find((item) => item.category === detailCategory) ?? null
    : null

  useEffect(() => {
    if (!selectedReportCategory) {
      return
    }
    if (!categoryStats.some((item) => item.category === selectedReportCategory)) {
      setSelectedReportCategory(null)
    }
  }, [categoryStats, selectedReportCategory])

  useEffect(() => {
    if (!detailCategory) {
      return
    }
    if (!categoryStats.some((item) => item.category === detailCategory)) {
      setDetailCategory(null)
    }
  }, [categoryStats, detailCategory])

  return (
    <div className="tab-page transactions-tab-page">
      <header className="tab-page-header transactions-tab-header">
        <h1 className="app-title">账单</h1>
      </header>

      <section className="panel more-report-panel transactions-report-entry-panel">
        <Link className="more-report-card" to="/transactions/monthly-report">
          <div className="more-report-card-content">
            <p className="eyebrow">查理轻松记</p>
            <h2>我的消费洞察</h2>
            <span className="more-report-card-button">查看月度报告</span>
          </div>
          <img className="more-report-card-ip" src="/baogaoip.png" alt="我的消费洞察助手" />
        </Link>
      </section>

      <section className="transactions-global-filters">
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

        <div className="transactions-filters">
          <div className="transactions-filter-inline-row">
            <label className="transactions-date-filter" aria-label={timeView === 'day' ? '日期' : timeView === 'month' ? '月份' : '年份'}>
              <span className="transactions-date-filter-text">{periodControlLabel}</span>
              <span className="transactions-date-filter-arrow" aria-hidden>▾</span>
              {timeView === 'day' && (
                <input
                  className="transactions-date-filter-input"
                  type="date"
                  value={filterDay}
                  onChange={(event) => setFilterDay(event.target.value)}
                />
              )}
              {timeView === 'month' && (
                <input
                  className="transactions-date-filter-input"
                  type="month"
                  value={filterMonth}
                  onChange={(event) => setFilterMonth(event.target.value)}
                />
              )}
              {timeView === 'year' && (
                <input
                  className="transactions-date-filter-input"
                  type="number"
                  inputMode="numeric"
                  min={2000}
                  max={2100}
                  value={filterYear}
                  onChange={(event) => setFilterYear(event.target.value.slice(0, 4))}
                />
              )}
            </label>
            <label aria-label="分类">
              <select
                className="transactions-compact-select"
                value={selectedCategory}
                onChange={(event) => {
                  setSelectedCategory(event.target.value)
                  setSelectedSubcategory('all')
                }}
              >
                <option value="all">全部</option>
                {availableCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label aria-label="二级分类">
              <select
                className="transactions-compact-select"
                value={selectedSubcategory}
                onChange={(event) => setSelectedSubcategory(event.target.value)}
                disabled={selectedCategory === 'all'}
              >
                <option value="all">全部二级</option>
                {availableSubcategories.map((subcategory) => (
                  <option key={subcategory} value={subcategory}>
                    {subcategory}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="panel transactions-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">消费趋势</p>
            <h2>{periodLabel}</h2>
          </div>
        </div>

        <section className="transactions-chart" aria-label="支出柱状图">
          <div className="transactions-chart-summary" aria-label="当前筛选范围内合计">
            <span>总支出</span>
            <strong className="expense">-{formatMoney(chartTotalExpense)}</strong>
          </div>
          <div className="transactions-bar-chart-wrap">
            <div className="transactions-bar-y-axis" aria-hidden>
              {chartYAxisTicks.map((value, index) => (
                <span key={`${index}-${value}`}>{formatAxisMoney(value)}</span>
              ))}
            </div>
            <div className="transactions-bar-chart-grid" aria-hidden>
              {chartYAxisTicks.map((value) => (
                <span key={value} />
              ))}
            </div>
            {selectedTrendItem ? (
              <>
                <span
                  className="transactions-bar-connector"
                  style={{
                    '--transactions-trend-bar-x': `${selectedTrendX}px`,
                  } as CSSProperties}
                  aria-hidden
                />
                <div
                  className="transactions-bar-floating-label"
                  style={{
                    '--transactions-trend-label-x': `${selectedTrendX}px`,
                  } as CSSProperties}
                  aria-live="polite"
                >
                  <span>{selectedTrendItem.fullLabel}支出</span>
                  <strong>-{formatMoney(selectedTrendItem.amount)}</strong>
                </div>
              </>
            ) : null}
          <div
            className={`transactions-bar-chart ${
              timeView === 'year' ? 'transactions-bar-chart--year' : ''
            }`}
            style={{
              gridTemplateColumns: `repeat(${expenseChartItems.length}, var(--transactions-bar-width))`,
            }}
            onScroll={(event) => setTrendChartScrollLeft(event.currentTarget.scrollLeft)}
          >
            {expenseChartItems.map((item, index) => {
              const height =
                item.amount > 0 && chartMaxExpense > 0
                  ? Math.max(8, (item.amount / chartAxisMaxExpense) * 100)
                  : 0
              const isSelected = item.key === selectedTrendKey
              const showAxisLabel =
                timeView === 'year' ||
                index === 0 ||
                (index + 1) % 5 === 0 ||
                index === expenseChartItems.length - 1 ||
                item.active
              return (
                <div className="transactions-bar-item" key={item.key}>
                  <button
                    type="button"
                    className={`transactions-bar-track${isSelected ? ' selected' : ''}`}
                    title={`${item.fullLabel} ${formatMoney(item.amount)}`}
                    aria-label={`${item.fullLabel}，${item.count} 笔，支出 ${formatMoney(item.amount)}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedTrendKey(item.key)}
                    onFocus={() => setSelectedTrendKey(item.key)}
                  >
                    <span
                      className={`transactions-bar-fill${isSelected ? ' selected' : item.active ? ' active' : ''}`}
                      style={{ height: `${height}%` }}
                    />
                  </button>
                  <span className={`transactions-bar-label${item.active ? ' active' : ''}`}>
                    {showAxisLabel ? item.label : ''}
                  </span>
                </div>
              )
            })}
          </div>
          </div>
        </section>

      </section>

      <section className="panel transactions-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">支出分类</p>
            <h2>{periodLabel}</h2>
          </div>
        </div>
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
                          selectedReportCategory === item.category ? ' active' : ''
                        }`}
                        cx="100"
                        cy="100"
                        r={PIE_RADIUS}
                        stroke={item.color}
                        strokeDasharray={`${dash} ${PIE_CIRCUMFERENCE - dash}`}
                        strokeDashoffset={strokeDashoffset}
                        onClick={() => setSelectedReportCategory(item.category)}
                        role="button"
                        tabIndex={0}
                        aria-label={`${item.category} ${item.percent.toFixed(0)}%`}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelectedReportCategory(item.category)
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
            <h3>暂无分类数据</h3>
            <p>当前周期没有支出记录。</p>
          </div>
        ) : (
          <ul className="report-category-list" aria-label="分类支出统计">
            {categoryStats.map((item) => (
              <li
                className={`report-category-item${
                  selectedReportCategory === item.category ? ' active' : ''
                }`}
                key={item.category}
                onClick={() => {
                  setSelectedReportCategory(item.category)
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

      <section className="panel ledger-list transactions-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">消费明细</p>
            <h2>{periodLabel}</h2>
          </div>
        </div>
        {isLoading && <p className="muted">同步中...</p>}
        <div className="transaction-list">
          {filteredTransactions.length === 0 ? (
            <div className="empty-state">
              <h3>没有符合条件的账单</h3>
              <p>调整时间或筛选，或到「记账」新增一笔。</p>
            </div>
          ) : (
            filteredTransactions.map((item) => (
              <SwipeTransactionCard
                key={item.id}
                item={item}
                formatMoney={formatMoney}
                open={swipedId === item.id}
                onOpen={() => setSwipedId(item.id)}
                onClose={() => setSwipedId((current) => (current === item.id ? null : current))}
                onEdit={() => {
                  setSwipedId(null)
                  setEditError('')
                  setEditingItem(item)
                  setEditDraft({
                    type: 'expense',
                    amount: String(item.amount),
                    category: item.category,
                    subcategory: item.subcategory ?? '',
                    transaction_date: item.transaction_date,
                    note: item.note ?? '',
                  })
                }}
                onDelete={() => {
                  setSwipedId(null)
                  setDeleteId(item.id)
                }}
              />
            ))
          )}
        </div>
      </section>
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
            aria-labelledby="transactions-report-detail-title"
          >
            <div className="ledger-receipt-review-head">
              <h3 id="transactions-report-detail-title">{detailItem.category}</h3>
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
                        <strong className="transaction-item-category">
                          {row.subcategory ? `${row.category} / ${row.subcategory}` : row.category}
                        </strong>
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
      {editingItem && createPortal(
        <div className="ledger-receipt-sheet-layer" role="presentation">
          <button
            type="button"
            className="ledger-receipt-sheet-backdrop"
            aria-label="关闭编辑账单"
            onClick={() => setEditingItem(null)}
            disabled={isLoading}
          />
          <section
            className="ledger-receipt-sheet transaction-edit-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-edit-title"
          >
            <div className="ledger-receipt-review-head">
              <h3 id="transaction-edit-title">编辑账单</h3>
              <button
                type="button"
                className="ledger-receipt-sheet-close"
                aria-label="关闭编辑账单"
                onClick={() => setEditingItem(null)}
                disabled={isLoading}
              >
                ×
              </button>
            </div>
            <div className="form-grid transaction-edit-form">
              <label>
                金额
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={editDraft.amount}
                  onChange={(event) =>
                    setEditDraft((current) => ({ ...current, amount: event.target.value }))
                  }
                  placeholder="0.00"
                />
              </label>
              <div className="form-row-2">
                <label>
                  分类
                  <select
                    value={editDraft.category}
                    onChange={(event) => {
                      const category = event.target.value
                      setEditDraft((current) => ({
                        ...current,
                        category,
                        subcategory: firstSubcategory(category),
                      }))
                    }}
                  >
                    {expenseOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  二级分类
                  <select
                    value={editDraft.subcategory}
                    onChange={(event) =>
                      setEditDraft((current) => ({ ...current, subcategory: event.target.value }))
                    }
                  >
                    {subcategoryOptions(editDraft.category).map((subcategory) => (
                      <option key={subcategory} value={subcategory}>
                        {subcategory}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  日期
                  <input
                    type="date"
                    value={editDraft.transaction_date}
                    onChange={(event) =>
                      setEditDraft((current) => ({
                        ...current,
                        transaction_date: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <label>
                备注
                <textarea
                  className="ledger-compact-note"
                  value={editDraft.note}
                  onChange={(event) =>
                    setEditDraft((current) => ({ ...current, note: event.target.value }))
                  }
                  placeholder="选填"
                  rows={1}
                />
              </label>
              {editError && <p className="alert error transaction-edit-error">{editError}</p>}
            </div>
            <div className="ledger-receipt-sheet-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditingItem(null)}
                disabled={isLoading}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void updateTransaction(editingItem.id, editDraft)
                    .then(() => {
                      setEditError('')
                      setEditingItem(null)
                    })
                    .catch((err) => {
                      setEditError(err instanceof Error ? err.message : '保存失败')
                    })
                }}
                disabled={isLoading}
              >
                {isLoading ? '保存中...' : '保存'}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
      <ConfirmActionSheet
        open={deleteId != null}
        title="删除账单"
        description="确定删除这笔账单吗？"
        confirmText="删除"
        busy={isLoading}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          if (!deleteId) {
            return
          }
          void handleDeleteTransaction(deleteId).then(() => setDeleteId(null))
        }}
      />
    </div>
  )
}

function SwipeTransactionCard({
  item,
  formatMoney,
  open,
  onOpen,
  onClose,
  onEdit,
  onDelete,
}: {
  item: Transaction
  formatMoney: (n: number) => string
  open: boolean
  onOpen: () => void
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const movedRef = useRef(false)

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    startXRef.current = event.clientX
    startYRef.current = event.clientY
    movedRef.current = false
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const dx = event.clientX - startXRef.current
    const dy = event.clientY - startYRef.current
    if (Math.abs(dx) < 16 || Math.abs(dx) < Math.abs(dy)) {
      return
    }
    movedRef.current = true
    if (dx < -36) {
      onOpen()
    } else if (dx > 36) {
      onClose()
    }
  }

  const handleClick = () => {
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    if (open) {
      onClose()
      return
    }
    onEdit()
  }

  return (
    <div className={`transaction-swipe-row${open ? ' open' : ''}`}>
      <button
        type="button"
        className="transaction-swipe-delete"
        onClick={onDelete}
        aria-label={`删除 ${item.category} 账单`}
      >
        删除
      </button>
      <article
        className="transaction-item transaction-swipe-card"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
      >
        <div className="transaction-item-main">
          <span className="transaction-item-emoji" aria-hidden>
            {categoryEmoji(item.category, item.type)}
          </span>
          <div className="transaction-item-meta">
            <strong className="transaction-item-category">
              {item.subcategory ? `${item.category} / ${item.subcategory}` : item.category}
            </strong>
            <span className="transaction-item-date">{item.transaction_date}</span>
          </div>
          <p className={`transaction-item-amount ${item.type}`}>
            {item.type === 'expense' ? '-' : '+'}
            {formatMoney(item.amount)}
          </p>
          {item.note ? <p className="transaction-item-note">{item.note}</p> : null}
        </div>
      </article>
    </div>
  )
}
