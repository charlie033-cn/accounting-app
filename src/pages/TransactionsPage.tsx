import { useMemo, useRef, useState, type PointerEvent } from 'react'
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
  amount: number
  active: boolean
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

  const expenseChartItems = useMemo<ExpenseChartItem[]>(() => {
    const categoryOk = (category: string) =>
      selectedCategory === 'all' || category === selectedCategory
    const subcategoryOk = (subcategory?: string | null) =>
      selectedSubcategory === 'all' || subcategory === selectedSubcategory
    const expenseRows = transactions.filter(
      (item) => item.type === 'expense' && categoryOk(item.category) && subcategoryOk(item.subcategory),
    )

    if (timeView === 'year') {
      const year = filterYear.length === 4 ? filterYear : currentYear()
      return Array.from({ length: 12 }, (_, index) => {
        const month = String(index + 1).padStart(2, '0')
        const period = `${year}-${month}`
        const amount = expenseRows
          .filter((item) => item.transaction_date.startsWith(period))
          .reduce((sum, item) => sum + item.amount, 0)
        return {
          key: period,
          label: `${index + 1}月`,
          amount,
          active: currentMonth() === period,
        }
      })
    }

    const period = chartPeriod.length === 7 ? chartPeriod : currentMonth()
    const days = daysInCalendarMonth(period)
    return Array.from({ length: days }, (_, index) => {
      const day = String(index + 1).padStart(2, '0')
      const date = `${period}-${day}`
      const amount = expenseRows
        .filter((item) => item.transaction_date === date)
        .reduce((sum, item) => sum + item.amount, 0)
      return {
        key: date,
        label: String(index + 1),
        amount,
        active: timeView === 'day' ? filterDay === date : todayISO() === date,
      }
    })
  }, [transactions, timeView, filterYear, chartPeriod, selectedCategory, selectedSubcategory, filterDay])

  const chartMaxExpense = useMemo(
    () => Math.max(...expenseChartItems.map((item) => item.amount), 0),
    [expenseChartItems],
  )

  const chartTotalExpense = useMemo(
    () => expenseChartItems.reduce((sum, item) => sum + item.amount, 0),
    [expenseChartItems],
  )

  const chartSummaryExpense = useMemo(() => {
    if (timeView !== 'day') {
      return chartTotalExpense
    }
    return expenseChartItems.find((item) => item.key === filterDay)?.amount ?? 0
  }, [timeView, chartTotalExpense, expenseChartItems, filterDay])

  const filteredTransactions = useMemo(() => {
    return transactions.filter((item) => {
      const dateOk =
        timeView === 'day'
          ? item.transaction_date === filterDay
          : timeView === 'month'
            ? item.transaction_date.startsWith(filterMonth)
            : filterYear.length === 4 && item.transaction_date.startsWith(filterYear)
      const matchCategory = selectedCategory === 'all' || item.category === selectedCategory
      const matchSubcategory = selectedSubcategory === 'all' || item.subcategory === selectedSubcategory
      return dateOk && matchCategory && matchSubcategory
    })
  }, [transactions, timeView, filterDay, filterMonth, filterYear, selectedCategory, selectedSubcategory])

  const rangeLabel =
    timeView === 'day'
      ? filterDay
      : timeView === 'month'
        ? filterMonth
        : filterYear.length === 4
          ? `${filterYear} 年`
          : '选择年份'

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

      <section className="panel ledger-list">
        <div className="panel-header">
          <div>
            <p className="eyebrow">账单明细</p>
            <h2>{rangeLabel}</h2>
          </div>
          <Link className="secondary-button transactions-report-link" to="/transactions/report">
            <span className="transactions-report-icon" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            报表
          </Link>
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

        <div className="transactions-filters">
          <div className="transactions-time-filter-row">
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
          <div className="transactions-category-filter-row">
            <label aria-label="分类">
              <select
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

        <section className="transactions-chart" aria-label="支出柱状图">
          <div className="transactions-chart-summary" aria-label="当前筛选范围内合计">
            <span>总支出</span>
            <strong className="expense">-{formatMoney(chartSummaryExpense)}</strong>
          </div>
          <div
            className={`transactions-bar-chart ${
              timeView === 'year' ? 'transactions-bar-chart--year' : ''
            }`}
            style={{
              gridTemplateColumns: `repeat(${expenseChartItems.length}, var(--transactions-bar-width))`,
            }}
          >
            {expenseChartItems.map((item, index) => {
              const height =
                item.amount > 0 && chartMaxExpense > 0
                  ? Math.max(8, (item.amount / chartMaxExpense) * 100)
                  : 0
              const showAxisLabel =
                timeView === 'year' ||
                index === 0 ||
                (index + 1) % 5 === 0 ||
                index === expenseChartItems.length - 1 ||
                item.active
              return (
                <div className="transactions-bar-item" key={item.key}>
                  <div className="transactions-bar-track" title={`${item.label} ${formatMoney(item.amount)}`}>
                    <span
                      className={`transactions-bar-fill${item.active ? ' active' : ''}`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <span className={`transactions-bar-label${item.active ? ' active' : ''}`}>
                    {showAxisLabel ? item.label : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        <p className="muted filter-hint">
          筛选作用于当前「{timeView === 'day' ? '日' : timeView === 'month' ? '月' : '年'}」范围内的流水。
        </p>

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
