import { Link } from 'react-router-dom'
import { currentMonth } from '../accounting/constants'
import { useAccounting } from '../context/AccountingContext'

export function BudgetPage() {
  const {
    budgetPeriod,
    setBudgetPeriod,
    budgetDraft,
    setBudgetDraft,
    budgetLoading,
    budgetSaving,
    budgetError,
    setBudgetError,
    setBudgetSuccess,
    handleSaveBudget,
    budgetAmount,
    dailyBudgetReference,
    todayVsDailyPercent,
    monthVsBudgetPercent,
    monthExpenseTotal,
    todayExpenseTotal,
    budgetDays,
    formatMoney,
  } = useAccounting()

  const budgetRemaining =
    budgetAmount != null && budgetAmount > 0 ? budgetAmount - monthExpenseTotal : null
  const budgetDraftRaw = budgetDraft.trim()
  const budgetDraftNumber = Number(budgetDraftRaw)
  const savedBudgetAmount = budgetAmount ?? 0
  const isBudgetAmountEdited =
    budgetDraftRaw === ''
      ? savedBudgetAmount !== 0
      : !Number.isFinite(budgetDraftNumber) ||
        Math.round(budgetDraftNumber * 100) !== Math.round(savedBudgetAmount * 100)

  return (
    <main className="sub-page-shell">
      <div className="sub-page sub-page--standalone">
        <header className="sub-page-nav">
          <Link className="sub-page-icon-back" to="/me" aria-label="返回我的">
            <span aria-hidden>←</span>
          </Link>
          <h1 className="sub-page-title">预算管理</h1>
        </header>

        <section className="panel budget-panel budget-settings-panel" aria-label="预算设置">
          <div className="panel-header budget-panel-header">
            <div>
              <h2>预算设置</h2>
            </div>
          </div>
          <p className="muted budget-hint">
            按所选月份统计支出；填 0 表示不设本月预算。
          </p>
          <form className="budget-edit-form" onSubmit={handleSaveBudget}>
            <div className="form-row-2 budget-month-cap-row">
              <label className="budget-input-label">
                预算月份
                <input
                  type="month"
                  value={budgetPeriod}
                  onChange={(event) => {
                    setBudgetPeriod(event.target.value)
                    setBudgetError('')
                    setBudgetSuccess('')
                  }}
                />
              </label>
              <label className="budget-input-label">
                支出上限（元）
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={budgetDraft}
                  onChange={(event) => {
                    setBudgetDraft(event.target.value)
                    setBudgetError('')
                    setBudgetSuccess('')
                  }}
                  placeholder="0 表示不设"
                />
              </label>
            </div>
            <button
              type="submit"
              className={`${
                isBudgetAmountEdited ? 'primary-button' : 'secondary-button'
              } budget-save-btn budget-save-btn--full`}
              disabled={budgetSaving || budgetLoading}
            >
              {budgetSaving ? '保存中…' : '保存预算'}
            </button>
          </form>
          {budgetError && <p className="alert error budget-status">{budgetError}</p>}
          {budgetLoading && <p className="muted budget-status">加载预算…</p>}
          {!budgetLoading && budgetAmount === 0 && (
            <p className="muted budget-status">该月未设预算；输入大于 0 的金额并保存即可启用。</p>
          )}
        </section>

        {!budgetLoading && budgetAmount != null && budgetAmount > 0 && dailyBudgetReference != null && (
          <>
            <section className="panel budget-panel budget-overview-panel" aria-label="预算概览与进度">
              <div className="budget-hero">
                <p className="budget-hero-label">本月预算余额</p>
                <p
                  className={`budget-hero-value${budgetRemaining != null && budgetRemaining < 0 ? ' over' : ''}`}
                  title="月度支出上限减去该月全部支出后的剩余额度"
                >
                  {budgetRemaining != null ? formatMoney(budgetRemaining) : formatMoney(0)}
                </p>
              </div>

              <div className="budget-summary-grid" aria-label="预算摘要">
                <div className="budget-summary-item">
                  <span>预算上限</span>
                  <strong>{formatMoney(budgetAmount)}</strong>
                </div>
                <div className="budget-summary-item">
                  <span>本月已支出</span>
                  <strong>{formatMoney(monthExpenseTotal)}</strong>
                </div>
                <div className="budget-summary-item">
                  <span>日均参考</span>
                  <strong>{formatMoney(dailyBudgetReference)}</strong>
                </div>
                <div className="budget-summary-item">
                  <span>预算天数</span>
                  <strong>{budgetDays} 天</strong>
                </div>
              </div>

              <div className="budget-progress-stack">
                {budgetPeriod === currentMonth() && todayVsDailyPercent != null && (
                  <div className="budget-meter-block">
                    <div className="budget-line">
                      <span>今日支出 · 占日均</span>
                      <strong className={todayVsDailyPercent > 100 ? 'over' : undefined}>
                        {formatMoney(todayExpenseTotal)} · {todayVsDailyPercent.toFixed(0)}%
                      </strong>
                    </div>
                    <div
                      className="meter"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(Math.min(100, todayVsDailyPercent))}
                      aria-label="今日支出占日均比例"
                    >
                      <div
                        className={`meter-fill today ${todayVsDailyPercent > 100 ? 'over' : ''}`}
                        style={{ width: `${Math.min(100, todayVsDailyPercent)}%` }}
                      />
                    </div>
                  </div>
                )}

                {budgetPeriod !== currentMonth() && (
                  <p className="muted budget-aside">非当前月不显示「今日」相对进度。</p>
                )}

                {monthVsBudgetPercent != null && (
                  <div className="budget-meter-block">
                    <div className="budget-line">
                      <span>本月支出累计 · 占预算</span>
                      <strong className={monthVsBudgetPercent > 100 ? 'over' : undefined}>
                        {formatMoney(monthExpenseTotal)} · {monthVsBudgetPercent.toFixed(0)}%
                      </strong>
                    </div>
                    <div
                      className="meter"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(Math.min(100, monthVsBudgetPercent))}
                      aria-label="本月支出占月度预算比例"
                    >
                      <div
                        className={`meter-fill month ${monthVsBudgetPercent > 100 ? 'over' : ''}`}
                        style={{ width: `${Math.min(100, monthVsBudgetPercent)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
