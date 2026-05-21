import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { todayISO } from '../accounting/constants'
import { useAccounting } from '../context/AccountingContext'

function recurringStartDate(template: { start_date?: string | null; start_period: string; day_of_month: number }): string {
  if (template.start_date && /^\d{4}-\d{2}-\d{2}$/.test(template.start_date)) {
    return template.start_date
  }
  return `${template.start_period}-${String(template.day_of_month).padStart(2, '0')}`
}

function recurringTotalAmount(template: { amount: number; total_amount?: number | null; duration_months: number }): number {
  const total = Number(template.total_amount)
  return Number.isFinite(total) && total > 0 ? total : template.amount * template.duration_months
}

export function MorePage() {
  const {
    formatMoney,
    recurringTemplates,
    recurringLoading,
    createRecurringTemplate,
    deleteRecurringTemplate,
    setRecurringPaused,
    categoryOptions,
  } = useAccounting()

  const expenseOpts = categoryOptions('expense')
  const [rCategory, setRCategory] = useState(() => expenseOpts[0] ?? '')

  useEffect(() => {
    if (expenseOpts.length === 0) {
      return
    }
    if (!expenseOpts.includes(rCategory)) {
      setRCategory(expenseOpts[0])
    }
  }, [expenseOpts, rCategory])

  const [rName, setRName] = useState('')
  const [rAmount, setRAmount] = useState('')
  const [rStartDate, setRStartDate] = useState(todayISO())
  const [rMonths, setRMonths] = useState(12)
  const [rSaving, setRSaving] = useState(false)
  const [rErr, setRErr] = useState('')
  const [showRecurringSheet, setShowRecurringSheet] = useState(false)

  useEffect(() => {
    if (recurringTemplates.length === 0) {
      setShowRecurringSheet(false)
    }
  }, [recurringTemplates.length])

  const handleRecurringSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setRErr('')
    const amount = Number(rAmount)
    if (!rName.trim()) {
      setRErr('请填写名称')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setRErr('请输入大于 0 的总金额')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rStartDate)) {
      setRErr('请选择开始日期')
      return
    }
    if (!Number.isFinite(rMonths) || rMonths < 1 || rMonths > 600) {
      setRErr('持续月数需在 1–600 之间')
      return
    }
    setRSaving(true)
    const [, , day] = rStartDate.split('-').map(Number)
    try {
      await createRecurringTemplate({
        name: rName.trim(),
        amount,
        category: rCategory,
        day_of_month: day,
        start_period: rStartDate.slice(0, 7),
        start_date: rStartDate,
        duration_months: Math.floor(rMonths),
      })
      setRName('')
      setRAmount('')
      setRStartDate(todayISO())
      setRMonths(12)
    } catch (err) {
      setRErr(err instanceof Error ? err.message : '保存失败')
    } finally {
      setRSaving(false)
    }
  }

  return (
    <div className="tab-page">
      <section className="panel recurring-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">周期记账</p>
            <h2>房贷 / 车贷 / 分期</h2>
          </div>
        </div>
        <form className="form-grid recurring-form" onSubmit={handleRecurringSubmit}>
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
                value={rAmount}
                onChange={(e) => setRAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </span>
          </label>
          <div className="form-row-2 recurring-name-category-row">
            <label>
              名称
              <input value={rName} onChange={(e) => setRName(e.target.value)} placeholder="例如：房贷" required />
            </label>
            <label>
              分类
              <select value={rCategory} onChange={(e) => setRCategory(e.target.value)}>
                {expenseOpts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row-2 recurring-start-row">
            <label>
              开始日期
              <input type="date" value={rStartDate} onChange={(e) => setRStartDate(e.target.value)} required />
            </label>
            <label>
              记账周期（月）
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                value={rMonths}
                onChange={(e) => setRMonths(Number(e.target.value))}
              />
            </label>
          </div>
          {rErr && <p className="alert error">{rErr}</p>}
          <button className="primary-button" type="submit" disabled={rSaving || recurringLoading}>
            {rSaving ? '保存中…' : '添加周期账单'}
          </button>
          {!recurringLoading && recurringTemplates.length > 0 && (
            <button
              type="button"
              className="secondary-button recurring-view-all-btn"
              onClick={() => setShowRecurringSheet(true)}
            >
              查看全部周期账单
            </button>
          )}
        </form>

        {recurringLoading ? (
          <p className="muted">加载规则…</p>
        ) : recurringTemplates.length === 0 ? (
          <p className="muted budget-hint budget-hint--after-form">暂无周期账单</p>
        ) : null}
      </section>

      {showRecurringSheet && recurringTemplates.length > 0 && createPortal(
        <div className="ledger-receipt-sheet-layer" role="presentation">
          <button
            type="button"
            className="ledger-receipt-sheet-backdrop"
            aria-label="关闭周期账单列表"
            onClick={() => setShowRecurringSheet(false)}
          />
          <section
            className="ledger-receipt-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recurring-sheet-title"
          >
            <div className="ledger-receipt-review-head">
              <h3 id="recurring-sheet-title">全部周期账单</h3>
              <button
                type="button"
                className="ledger-receipt-sheet-close"
                aria-label="关闭周期账单列表"
                onClick={() => setShowRecurringSheet(false)}
              >
                ×
              </button>
            </div>

            <div className="ledger-receipt-review-list">
              <ul className="recurring-list recurring-list--sheet">
                {recurringTemplates.map((t) => (
                  <li key={t.id} className="recurring-item">
                    <div>
                      <strong>{t.name}</strong>
                      <span className="muted">
                        {' '}
                        · 每月 {t.day_of_month} 号对齐 · 总额 {formatMoney(recurringTotalAmount(t))} · {t.category}
                      </span>
                      <p className="muted small">
                        {recurringStartDate(t)} 起 · 共 {t.duration_months} 期 · 每期约 {formatMoney(t.amount)} · {t.status === 'active' ? '启用' : '暂停'}
                      </p>
                    </div>
                    <div className="recurring-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void setRecurringPaused(t.id, t.status === 'active')}
                      >
                        {t.status === 'active' ? '暂停' : '启用'}
                      </button>
                      <button type="button" className="text-button danger" onClick={() => void deleteRecurringTemplate(t.id)}>
                        删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>,
        document.body,
        )}
    </div>
  )
}
