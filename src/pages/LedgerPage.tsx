import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { currentMonth, todayISO } from '../accounting/constants'
import { inferBuiltInCategory } from '../accounting/categoryRules'
import { ConfirmActionSheet } from '../components/ConfirmActionSheet'
import { dynamicDailyBudget } from '../accounting/budgetMath'
import { useAccounting } from '../context/AccountingContext'
import { parseReceiptFromImageDataUrl, type ReceiptParseDraft } from '../lib/parseReceiptTokenhub'
import type { Transaction, TransactionFormState } from '../types/transaction'
import { categoryEmoji } from '../utils/categoryEmoji'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('读取图片失败'))
      }
    }
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function pickCategory(raw: string, options: string[]): string {
  const t = raw.trim()
  if (options.includes(t)) {
    return t
  }
  const fuzzy = options.find((o) => o.includes(t) || t.includes(o))
  if (fuzzy) {
    return fuzzy
  }
  return inferBuiltInCategory(t, 'expense', options) || (options[0] ?? t)
}

type ReceiptReviewItem = ReceiptParseDraft & {
  id: string
  selected: boolean
}

export function LedgerPage() {
  const {
    form,
    setForm,
    editingId,
    cancelEdit,
    handleSubmit,
    saveTransactionsFromDrafts,
    updateTransaction,
    handleDeleteTransaction,
    categoryOptions,
    subcategoryOptions,
    formatMoney,
    isLoading,
    error,
    setError,
    setMessage,
    transactions,
    budgetAmount,
    budgetPeriod,
    budgetLoading,
  } = useAccounting()

  const receiptFileRef = useRef<HTMLInputElement>(null)
  const receiptParseRunRef = useRef(0)
  const [receiptParsing, setReceiptParsing] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [receiptDrafts, setReceiptDrafts] = useState<ReceiptReviewItem[]>([])
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
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
  const [swipedTransactionId, setSwipedTransactionId] = useState<string | null>(null)

  const cm = currentMonth()
  const day = todayISO()
  const autoTransactionDateRef = useRef(day)

  const stats = useMemo(() => {
    const monthRows = transactions.filter((item) => item.transaction_date.startsWith(cm))
    const income = monthRows
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + item.amount, 0)
    const expense = monthRows
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + item.amount, 0)
    return { income, expense, balance: income - expense }
  }, [transactions, cm])

  const todayExpenseTotal = useMemo(() => {
    return transactions
      .filter((item) => item.type === 'expense' && item.transaction_date === day)
      .reduce((sum, item) => sum + item.amount, 0)
  }, [transactions, day])

  const ledgerBudgetStrip = useMemo(() => {
    if (budgetPeriod !== cm) {
      return null
    }
    if (budgetAmount == null || budgetAmount <= 0) {
      return null
    }
    const daily = dynamicDailyBudget(cm, budgetAmount, stats.expense)
    if (daily == null) {
      return null
    }
    const todayVsDailyPercent =
      daily > 0 ? (todayExpenseTotal / daily) * 100 : todayExpenseTotal > 0 ? 100 : 0
    const monthVsBudgetPercent =
      budgetAmount > 0 ? (stats.expense / budgetAmount) * 100 : null
    const dayOver = daily <= 0 || todayExpenseTotal > daily
    const dayMeterPercent = dayOver && daily <= 0 ? 100 : Math.min(100, todayVsDailyPercent)
    return {
      monthRem: budgetAmount - stats.expense,
      dayRem: daily - todayExpenseTotal,
      cap: budgetAmount,
      daily,
      dayOver,
      dayMeterPercent,
      todayVsDailyPercent,
      monthVsBudgetPercent,
    }
  }, [budgetPeriod, cm, budgetAmount, stats.expense, todayExpenseTotal])

  const todayRows = useMemo(() => {
    return transactions
      .filter((item) => item.transaction_date === day)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  }, [transactions, day])
  const selectedReceiptDraftCount = receiptDrafts.filter((item) => item.selected).length
  const expenseOptions = categoryOptions('expense')
  const formSubcategoryOptions = subcategoryOptions(form.category)
  const expenseSubcategoryMap = useMemo(
    () => Object.fromEntries(expenseOptions.map((category) => [category, subcategoryOptions(category)])),
    [expenseOptions, subcategoryOptions],
  )

  useEffect(() => {
    if (editingId || form.amount || form.note) {
      return
    }
    setForm((current) => {
      if (current.transaction_date === day) {
        autoTransactionDateRef.current = day
        return current
      }
      if (current.transaction_date !== autoTransactionDateRef.current) {
        return current
      }
      autoTransactionDateRef.current = day
      return {
        ...current,
        transaction_date: day,
      }
    })
  }, [day, editingId, form.amount, form.note, setForm])

  const openReceiptPicker = () => {
    setReceiptError('')
    receiptFileRef.current?.click()
  }

  const cancelReceiptParsing = () => {
    receiptParseRunRef.current += 1
    setReceiptParsing(false)
    setReceiptError('')
    setMessage('已取消识图记账')
  }

  const updateReceiptDraft = (id: string, patch: Partial<ReceiptReviewItem>) => {
    setReceiptDrafts((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )
  }

  const saveReceiptDrafts = async () => {
    const selected = receiptDrafts.filter((item) => item.selected)
    if (selected.length === 0) {
      setReceiptError('请至少选择一笔识别结果')
      return
    }
    setReceiptError('')
    try {
      await saveTransactionsFromDrafts(
        selected.map((item) => ({
          type: 'expense',
          amount: item.amount,
          category: item.category,
          subcategory: item.subcategory || '',
          transaction_date: item.transaction_date,
          note: item.note,
        })),
      )
      setReceiptDrafts([])
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : '保存识别结果失败')
    }
  }

  const onReceiptFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      setReceiptError('请选择图片文件')
      return
    }
    if (file.size > 2.5 * 1024 * 1024) {
      setReceiptError('图片请小于约 2.5MB，可先截图压缩后再试')
      return
    }

    const runId = receiptParseRunRef.current + 1
    receiptParseRunRef.current = runId
    setReceiptParsing(true)
    setReceiptError('')
    setReceiptDrafts([])
    try {
      const dataUrl = await readFileAsDataUrl(file)
      if (receiptParseRunRef.current !== runId) {
        return
      }
      const drafts = await parseReceiptFromImageDataUrl({
        imageDataUrl: dataUrl,
        categories: expenseOptions,
        subcategoryMap: expenseSubcategoryMap,
      })
      if (receiptParseRunRef.current !== runId) {
        return
      }
      const normalized = drafts.map((draft, index) => {
        const category = inferBuiltInCategory(`${draft.category} ${draft.note}`, 'expense', categoryOptions('expense')) || pickCategory(draft.category, categoryOptions('expense'))
        const subcategories = subcategoryOptions(category)
        const subcategory =
          draft.subcategory && subcategories.includes(draft.subcategory)
            ? draft.subcategory
            : (subcategories[0] ?? '')
        return {
          ...draft,
          id: `${Date.now()}-${index}`,
          selected: true,
          type: 'expense' as const,
          category,
          subcategory,
        }
      })

      if (normalized.length === 1) {
        const draft = normalized[0]
        setForm({
          type: 'expense',
          amount: draft.amount,
          category: draft.category,
          subcategory: draft.subcategory || '',
          transaction_date: draft.transaction_date,
          note: draft.note,
        })
        setMessage('已填入，请核对后保存')
      } else {
        setReceiptDrafts(normalized)
        setMessage(`识别到 ${normalized.length} 笔账单，请核对后保存`)
      }
      setError('')
    } catch (err) {
      if (receiptParseRunRef.current !== runId) {
        return
      }
      setReceiptError(err instanceof Error ? err.message : '识别失败')
    } finally {
      if (receiptParseRunRef.current === runId) {
        setReceiptParsing(false)
      }
    }
  }

  return (
    <div className="tab-page ledger-tab-page">
      <header className="tab-page-header ledger-tab-header">
        <h1 className="app-title">记账</h1>
      </header>

      {budgetLoading && (
        <p className="muted ledger-budget-loading" aria-live="polite">
          加载预算…
        </p>
      )}

      {!budgetLoading && ledgerBudgetStrip != null && (
        <section className="ledger-budget-strip" aria-label="预算剩余">
          <div className="ledger-budget-strip-layout">
            <div className="ledger-budget-strip-col">
              <p className="ledger-budget-strip-label">当日剩余预算</p>
              <p
                className={`ledger-budget-strip-value${ledgerBudgetStrip.dayRem < 0 ? ' over' : ''}`}
                title="（本月剩余预算÷本月剩余天数）− 今日支出"
              >
                {formatMoney(ledgerBudgetStrip.dayRem)}
              </p>
              <p className="muted small ledger-budget-strip-meta">
                今日支出 {formatMoney(todayExpenseTotal)} / 可用 {formatMoney(ledgerBudgetStrip.daily)}
              </p>
            </div>
            <div className="ledger-budget-strip-col">
              <p className="ledger-budget-strip-label">当月剩余预算</p>
              <p
                className={`ledger-budget-strip-value${ledgerBudgetStrip.monthRem < 0 ? ' over' : ''}`}
                title="月度上限减去本月全部支出"
              >
                {formatMoney(ledgerBudgetStrip.monthRem)}
              </p>
              <p className="muted small ledger-budget-strip-meta">
                本月支出 {formatMoney(stats.expense)} / 上限 {formatMoney(ledgerBudgetStrip.cap)}
              </p>
            </div>
            {(ledgerBudgetStrip.todayVsDailyPercent != null ||
              ledgerBudgetStrip.monthVsBudgetPercent != null) && (
              <div className="ledger-budget-strip-meters">
                <div className="ledger-budget-strip-meter-col">
                  {ledgerBudgetStrip.todayVsDailyPercent != null && (
                    <>
                      <div className="ledger-budget-meter-line">
                        <span>日支出</span>
                        <strong
                          className={
                            ledgerBudgetStrip.dayOver ? 'over' : undefined
                          }
                        >
                          {formatMoney(todayExpenseTotal)} ·{' '}
                          {ledgerBudgetStrip.daily <= 0
                            ? '已超日可用'
                            : `${ledgerBudgetStrip.todayVsDailyPercent.toFixed(0)}%`}
                        </strong>
                      </div>
                      <div
                        className="meter"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(ledgerBudgetStrip.dayMeterPercent)}
                        aria-label="今日已支出相对日均比例"
                      >
                        <div
                          className={`meter-fill today ${
                            ledgerBudgetStrip.dayOver ? 'over' : ''
                          }`}
                          style={{
                            width: `${ledgerBudgetStrip.dayMeterPercent}%`,
                            background: ledgerBudgetStrip.dayOver
                              ? 'linear-gradient(90deg, #dc2626, #f97316)'
                              : undefined,
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
                <div className="ledger-budget-strip-meter-col">
                  {ledgerBudgetStrip.monthVsBudgetPercent != null && (
                    <>
                      <div className="ledger-budget-meter-line">
                        <span>月支出</span>
                        <strong
                          className={
                            ledgerBudgetStrip.monthVsBudgetPercent > 100 ? 'over' : undefined
                          }
                        >
                          {formatMoney(stats.expense)} ·{' '}
                          {ledgerBudgetStrip.monthVsBudgetPercent.toFixed(0)}%
                        </strong>
                      </div>
                      <div
                        className="meter"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(
                          Math.min(100, ledgerBudgetStrip.monthVsBudgetPercent),
                        )}
                        aria-label="本月已支出占预算比例"
                      >
                        <div
                          className={`meter-fill month ${
                            ledgerBudgetStrip.monthVsBudgetPercent > 100 ? 'over' : ''
                          }`}
                          style={{
                            width: `${Math.min(100, ledgerBudgetStrip.monthVsBudgetPercent)}%`,
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <form id="ledger-form" className="panel form-grid ledger-form" onSubmit={handleSubmit} aria-label="记一笔支出">
        <div className="panel-header ledger-form-header">
          <div>
            <p className="eyebrow">{editingId ? '编辑账单' : '记一笔'}</p>
            <h2>{editingId ? '更新支出记录' : '新增支出记录'}</h2>
          </div>
          <div className="ledger-form-header-actions">
            <input
              ref={receiptFileRef}
              type="file"
              accept="image/*"
              hidden
              aria-hidden
              onChange={(e) => void onReceiptFileChange(e)}
            />
            {editingId && (
              <button type="button" className="text-button" onClick={cancelEdit}>
                取消编辑
              </button>
            )}
            <button
              type="button"
              className="secondary-button ledger-receipt-scan-btn"
              onClick={openReceiptPicker}
              disabled={isLoading || receiptParsing}
            >
              <img
                className="ledger-receipt-scan-icon"
                src="/receipt-scan-icon.svg"
                alt=""
                aria-hidden
              />
              识图记账
            </button>
          </div>
        </div>

        {receiptError && receiptDrafts.length === 0 && (
          <p className="alert error ledger-receipt-error">{receiptError}</p>
        )}

        <label className="ledger-amount-field">
          <span className="sr-only">金额</span>
          <span className="money-input-wrap">
            <span className="money-input-prefix" aria-hidden>
              ¥
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(event) => setForm({ ...form, type: 'expense', amount: event.target.value })}
              placeholder="0.00"
            />
          </span>
        </label>

        <div className="form-row-2 ledger-category-row">
          <label>
            <span className="sr-only">分类</span>
            <select
              value={form.category}
              onChange={(event) => {
                const category = event.target.value
                setForm({ ...form, type: 'expense', category, subcategory: '' })
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
            <span className="sr-only">二级分类</span>
            <span className="select-placeholder-wrap">
              <span
                className={`select-display-text${!form.subcategory ? ' placeholder' : ''}`}
                style={{ color: form.subcategory ? undefined : '#9ca3af' }}
              >
                {form.subcategory || '二级类别（可选）'}
              </span>
              <span className="select-display-arrow" aria-hidden>
                ⌄
              </span>
              <select
                className="select-native-overlay"
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0,
                  width: '100%',
                  height: '100%',
                }}
                value={form.subcategory}
                onChange={(event) => setForm({ ...form, type: 'expense', subcategory: event.target.value })}
              >
                <option value="">无</option>
                {formSubcategoryOptions.map((subcategory) => (
                  <option key={subcategory} value={subcategory}>
                    {subcategory}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>

        <div className="form-row-2 ledger-date-note-row">
          <label>
            <span className="sr-only">日期</span>
            <input
              type="date"
              value={form.transaction_date}
              onChange={(event) => setForm({ ...form, type: 'expense', transaction_date: event.target.value })}
            />
          </label>
          <label className="ledger-note-field">
            <span className="sr-only">备注</span>
            <input
              className="ledger-compact-note"
              type="text"
              value={form.note}
              onChange={(event) => setForm({ ...form, type: 'expense', note: event.target.value })}
              placeholder="备注"
            />
          </label>
        </div>

        {error && <p className="alert error">{error}</p>}

        <button className="primary-button" type="submit" disabled={isLoading}>
          {isLoading ? '保存中...' : editingId ? '保存修改' : '添加支出'}
        </button>
      </form>

      {receiptDrafts.length > 1 && createPortal(
        <div className="ledger-receipt-sheet-layer" role="presentation">
          <button
            type="button"
            className="ledger-receipt-sheet-backdrop"
            aria-label="关闭识别结果"
            onClick={() => setReceiptDrafts([])}
            disabled={isLoading}
          />
          <section
            className="ledger-receipt-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ledger-receipt-sheet-title"
          >
            <div className="ledger-receipt-review-head">
              <h3 id="ledger-receipt-sheet-title">识别到 {receiptDrafts.length} 笔订单</h3>
              <button
                type="button"
                className="ledger-receipt-sheet-close"
                aria-label="关闭识别结果"
                onClick={() => setReceiptDrafts([])}
                disabled={isLoading}
              >
                ×
              </button>
            </div>

            {receiptError && <p className="alert error ledger-receipt-error">{receiptError}</p>}

            <div className="ledger-receipt-review-list">
              {receiptDrafts.map((draft, index) => (
                <article className="ledger-receipt-review-item" key={draft.id}>
                  <label className="ledger-receipt-review-check">
                    <input
                      type="checkbox"
                      checked={draft.selected}
                      onChange={(event) =>
                        updateReceiptDraft(draft.id, { selected: event.target.checked })
                      }
                    />
                    第 {index + 1} 笔
                  </label>
                  <div className="form-row-2 ledger-receipt-review-row">
                    <label>
                      金额
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={draft.amount}
                        onChange={(event) =>
                          updateReceiptDraft(draft.id, { amount: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      分类
                      <select
                        value={draft.category}
                        onChange={(event) =>
                          updateReceiptDraft(draft.id, {
                            category: event.target.value,
                            subcategory: '',
                          })
                        }
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
                        value={draft.subcategory ?? ''}
                        onChange={(event) =>
                          updateReceiptDraft(draft.id, { subcategory: event.target.value })
                        }
                      >
                        <option value="">无</option>
                        {subcategoryOptions(draft.category).map((subcategory) => (
                          <option key={subcategory} value={subcategory}>
                            {subcategory}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="form-row-2 ledger-receipt-review-row">
                    <label>
                      日期
                      <input
                        type="date"
                        value={draft.transaction_date}
                        onChange={(event) =>
                          updateReceiptDraft(draft.id, { transaction_date: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    备注
                    <input
                      type="text"
                      value={draft.note}
                      onChange={(event) =>
                        updateReceiptDraft(draft.id, { note: event.target.value })
                      }
                      placeholder="选填"
                    />
                  </label>
                </article>
              ))}
            </div>

            <div className="ledger-receipt-sheet-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setReceiptDrafts([])}
                disabled={isLoading}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void saveReceiptDrafts()}
                disabled={isLoading || selectedReceiptDraftCount === 0}
              >
                {isLoading ? '保存中...' : `保存选中的 ${selectedReceiptDraftCount} 笔`}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}

      {receiptParsing && createPortal(
        <div className="ledger-receipt-sheet-layer" role="presentation">
          <div className="ledger-receipt-sheet-backdrop" aria-hidden />
          <section
            className="ledger-receipt-sheet ledger-receipt-parsing-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ledger-receipt-parsing-title"
          >
            <div className="ledger-receipt-parsing">
              <span className="ledger-receipt-parsing-spinner" aria-hidden />
              <h3 id="ledger-receipt-parsing-title">正在识别图片</h3>
              <p className="muted small">识别完成后请核对信息</p>
            </div>
            <div className="ledger-receipt-sheet-actions ledger-receipt-parsing-actions">
              <button type="button" className="secondary-button" onClick={cancelReceiptParsing}>
                取消识别
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}

      <section className="panel ledger-list">
        <div className="panel-header">
          <div>
            <p className="eyebrow">今日账单</p>
            <h2>{day}</h2>
          </div>
        </div>
        <div className="transaction-list">
          {todayRows.length === 0 ? (
            <div className="empty-state">
              <h3>今天还没有记录</h3>
              <p>在上方记一笔，或到「账单」查看历史。</p>
            </div>
          ) : (
            todayRows.map((item) => (
              <TransactionRow
                key={item.id}
                item={item}
                formatMoney={formatMoney}
                open={swipedTransactionId === item.id}
                onOpen={() => setSwipedTransactionId(item.id)}
                onClose={() =>
                  setSwipedTransactionId((current) => (current === item.id ? null : current))
                }
                onEdit={() => {
                  setSwipedTransactionId(null)
                  setEditError('')
                  setEditingItem(item)
                  setEditDraft({
                    type: item.type,
                    amount: String(item.amount),
                    category: item.category,
                    subcategory: item.subcategory ?? '',
                    transaction_date: item.transaction_date,
                    note: item.note ?? '',
                  })
                }}
                onDelete={() => {
                  setSwipedTransactionId(null)
                  setDeleteTarget(item)
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
            aria-labelledby="ledger-today-edit-title"
          >
            <div className="ledger-receipt-review-head">
              <h3 id="ledger-today-edit-title">编辑账单</h3>
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
                        subcategory: '',
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
                    <option value="">无</option>
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
        open={deleteTarget != null}
        title="删除账单"
        description="确定删除这笔账单吗？"
        confirmText="删除"
        busy={isLoading}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) {
            return
          }
          void handleDeleteTransaction(deleteTarget.id).then(() => setDeleteTarget(null))
        }}
      />
    </div>
  )
}

function TransactionRow({
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
