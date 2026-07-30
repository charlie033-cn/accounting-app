import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { formatMoney } from '../accounting/format'
import { useAccounting } from '../context/AccountingContext'
import { recentMonthsDateRange } from '../lib/transactionDateRange'
import type { Transaction } from '../types/transaction'

type PlanKey = 'deposit' | 'wealth' | 'fund' | 'custom'

type CalculatorInputs = {
  targetIncomeInput: string
  principalInput: string
  monthlySavingInput: string
  planKey: PlanKey
  customRateInput: string
}

const LIE_FLAT_CALCULATOR_STORAGE_KEY = 'accounting-app:lie-flat-calculator-inputs'

const EMPTY_CALCULATOR_INPUTS: CalculatorInputs = {
  targetIncomeInput: '',
  principalInput: '',
  monthlySavingInput: '',
  planKey: 'wealth',
  customRateInput: '',
}

const PLANS: Record<PlanKey, { name: string; rate: number; description: string }> = {
  deposit: {
    name: '存款利息',
    rate: 0.02,
    description: '偏保守，收益假设更低，但波动也更小。',
  },
  wealth: {
    name: '稳健理财',
    rate: 0.035,
    description: '按低波动理财做情景估算。',
  },
  fund: {
    name: '基金定投',
    rate: 0.06,
    description: '长期收益假设更高，也意味着波动更明显。',
  },
  custom: {
    name: '自定义收益',
    rate: 0.04,
    description: '自己输入预期年化收益率。',
  },
}

const RETURN_REFERENCES = [
  { name: '存款利息', range: '1.3% - 2.2%', note: '适合作为保守假设' },
  { name: '稳健理财', range: '2.5% - 4.0%', note: '波动较低，但不等于无风险' },
  { name: '基金长期假设', range: '4.0% - 8.0%', note: '更看重长期，短期波动明显' },
]

const clampNumber = (value: number, min = 0, max = Number.POSITIVE_INFINITY) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))

function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === 'string' && value in PLANS
}

function readSavedCalculatorInputs() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(LIE_FLAT_CALCULATOR_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<CalculatorInputs>
    if (!isPlanKey(parsed.planKey)) {
      return null
    }

    return {
      targetIncomeInput: String(parsed.targetIncomeInput ?? ''),
      principalInput: String(parsed.principalInput ?? ''),
      monthlySavingInput: String(parsed.monthlySavingInput ?? ''),
      planKey: parsed.planKey,
      customRateInput: String(parsed.customRateInput ?? ''),
    } satisfies CalculatorInputs
  } catch {
    return null
  }
}

function saveCalculatorInputs(inputs: CalculatorInputs) {
  try {
    window.localStorage.setItem(LIE_FLAT_CALCULATOR_STORAGE_KEY, JSON.stringify(inputs))
  } catch {
    // Storage can be unavailable in private browsing; calculation should still work.
  }
}

function parseMoney(value: string) {
  return clampNumber(Number(value.replace(/,/g, '')))
}

function formatYears(months: number | null) {
  if (months == null) {
    return '暂无法达成'
  }
  if (months <= 0) {
    return '现在就够'
  }
  const years = Math.floor(months / 12)
  const rest = Math.ceil(months % 12)
  if (years <= 0) {
    return `${Math.max(1, rest)} 个月`
  }
  return rest > 0 ? `${years} 年 ${rest} 个月` : `${years} 年`
}

function futureValue(principal: number, monthlySaving: number, annualRate: number, months: number) {
  const monthlyRate = annualRate / 12
  if (monthlyRate <= 0) {
    return principal + monthlySaving * months
  }
  return (
    principal * (1 + monthlyRate) ** months +
    monthlySaving * (((1 + monthlyRate) ** months - 1) / monthlyRate)
  )
}

function monthsToTarget(
  principal: number,
  monthlySaving: number,
  targetPrincipal: number,
  annualRate: number,
) {
  if (principal >= targetPrincipal) {
    return 0
  }
  if (monthlySaving <= 0 && annualRate <= 0) {
    return null
  }
  for (let month = 1; month <= 12 * 80; month += 1) {
    if (futureValue(principal, monthlySaving, annualRate, month) >= targetPrincipal) {
      return month
    }
  }
  return null
}

function recentMonthKeys(count: number) {
  const now = new Date()
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
}

function formatDeltaMonths(base: number | null, next: number | null) {
  if (base == null || next == null) {
    return '需要重新评估'
  }
  const delta = base - next
  if (delta > 0) {
    return `预计提前 ${formatYears(delta)}`
  }
  if (delta < 0) {
    return `预计延后 ${formatYears(Math.abs(delta))}`
  }
  return '时间基本不变'
}

export function LieFlatCalculatorPage() {
  const { transactions, loadTransactionsByDateRange } = useAccounting()
  const [spendingTransactions, setSpendingTransactions] = useState<Transaction[]>(transactions)
  const [savedInputs] = useState<CalculatorInputs | null>(() => readSavedCalculatorInputs())
  const initialInputs = savedInputs ?? EMPTY_CALCULATOR_INPUTS
  const [sheetOpen, setSheetOpen] = useState(false)
  const [hasCalculated, setHasCalculated] = useState(() => savedInputs != null)
  const [resultVersion, setResultVersion] = useState(0)
  const [displayProgress, setDisplayProgress] = useState(0)
  const [displayMonths, setDisplayMonths] = useState<number | null>(0)
  const [targetIncomeInput, setTargetIncomeInput] = useState(initialInputs.targetIncomeInput)
  const [principalInput, setPrincipalInput] = useState(initialInputs.principalInput)
  const [monthlySavingInput, setMonthlySavingInput] = useState(initialInputs.monthlySavingInput)
  const [planKey, setPlanKey] = useState<PlanKey>(initialInputs.planKey)
  const [customRateInput, setCustomRateInput] = useState(initialInputs.customRateInput)
  const [submittedInputs, setSubmittedInputs] = useState<CalculatorInputs>(initialInputs)

  const result = useMemo(() => {
    const targetIncome = parseMoney(submittedInputs.targetIncomeInput)
    const principal = parseMoney(submittedInputs.principalInput)
    const monthlySaving = parseMoney(submittedInputs.monthlySavingInput)
    const annualRate =
      submittedInputs.planKey === 'custom'
        ? clampNumber(Number(submittedInputs.customRateInput), 0, 30) / 100
        : PLANS[submittedInputs.planKey].rate
    const targetPrincipal = annualRate > 0 ? (targetIncome * 12) / annualRate : targetIncome * 12 * 50
    const passiveIncome = (principal * annualRate) / 12
    const gap = Math.max(0, targetPrincipal - principal)
    const progress = targetPrincipal > 0 ? Math.min(100, (principal / targetPrincipal) * 100) : 100
    const months = monthsToTarget(principal, monthlySaving, targetPrincipal, annualRate)
    const projectedPrincipal = months == null
      ? futureValue(principal, monthlySaving, annualRate, 12 * 20)
      : futureValue(principal, monthlySaving, annualRate, months)
    const projectedPassiveIncome = (projectedPrincipal * annualRate) / 12
    const futureSaving = months == null ? monthlySaving * 12 * 20 : monthlySaving * months
    const investmentGain = Math.max(0, projectedPrincipal - principal - futureSaving)
    const breakdownTotal = Math.max(1, principal + futureSaving + investmentGain)
    const breakdown = {
      principal,
      futureSaving,
      investmentGain,
      principalPercent: (principal / breakdownTotal) * 100,
      futureSavingPercent: (futureSaving / breakdownTotal) * 100,
      investmentGainPercent: (investmentGain / breakdownTotal) * 100,
    }
    const moreSavingMonths = monthsToTarget(
      principal,
      monthlySaving + 500,
      targetPrincipal,
      annualRate,
    )
    const lowerTargetIncome = Math.max(0, targetIncome - 500)
    const lowerTargetPrincipal =
      annualRate > 0 ? (lowerTargetIncome * 12) / annualRate : lowerTargetIncome * 12 * 50
    const lowerTargetMonths = monthsToTarget(principal, monthlySaving, lowerTargetPrincipal, annualRate)
    const higherRate = Math.min(0.3, annualRate + 0.01)
    const higherRateTargetPrincipal =
      higherRate > 0 ? (targetIncome * 12) / higherRate : targetIncome * 12 * 50
    const higherRateMonths = monthsToTarget(principal, monthlySaving, higherRateTargetPrincipal, higherRate)
    const strategyScenarios = [
      {
        title: '每月多存 500',
        value: formatDeltaMonths(months, moreSavingMonths),
        description: '适合从日常消费里挪一点预算出来。',
      },
      {
        title: '目标月收入少 500',
        value: formatDeltaMonths(months, lowerTargetMonths),
        description: '先做半躺平目标，会更容易启动。',
      },
      {
        title: '收益假设 +1%',
        value: formatDeltaMonths(months, higherRateMonths),
        description: '收益假设越高，波动和不确定性也越高。',
      },
    ]

    return {
      targetIncome,
      principal,
      monthlySaving,
      annualRate,
      targetPrincipal,
      passiveIncome,
      gap,
      progress,
      months,
      projectedPrincipal,
      projectedPassiveIncome,
      breakdown,
      strategyScenarios,
    }
  }, [submittedInputs])

  const plan = PLANS[submittedInputs.planKey]

  useEffect(() => {
    let cancelled = false
    const loadSpendingTransactions = async () => {
      try {
        const rows = await loadTransactionsByDateRange(recentMonthsDateRange(6))
        if (!cancelled) {
          setSpendingTransactions(rows)
        }
      } catch {
        if (!cancelled) {
          setSpendingTransactions(transactions)
        }
      }
    }
    void loadSpendingTransactions()
    return () => {
      cancelled = true
    }
  }, [loadTransactionsByDateRange, transactions])

  const spendingReference = useMemo(() => {
    const monthSet = new Set(recentMonthKeys(6))
    const totals = new Map<string, number>()
    for (const transaction of spendingTransactions) {
      if (transaction.type !== 'expense') {
        continue
      }
      const month = transaction.transaction_date.slice(0, 7)
      if (!monthSet.has(month)) {
        continue
      }
      totals.set(month, (totals.get(month) ?? 0) + transaction.amount)
    }
    const activeTotals = [...totals.values()].filter((amount) => amount > 0)
    const averageMonthlyExpense =
      activeTotals.length > 0
        ? activeTotals.reduce((sum, amount) => sum + amount, 0) / activeTotals.length
        : 0
    const targetPrincipal =
      result.annualRate > 0 ? (averageMonthlyExpense * 12) / result.annualRate : averageMonthlyExpense * 12 * 50
    const months = activeTotals.length > 0
      ? monthsToTarget(result.principal, result.monthlySaving, targetPrincipal, result.annualRate)
      : null
    return {
      monthCount: activeTotals.length,
      averageMonthlyExpense,
      targetPrincipal,
      months,
    }
  }, [result.annualRate, result.monthlySaving, result.principal, spendingTransactions])
  const ringStyle = {
    background: `conic-gradient(var(--primary) ${displayProgress * 3.6}deg, rgba(22, 119, 255, 0.12) 0deg)`,
  }

  useEffect(() => {
    if (!sheetOpen) {
      return
    }

    const scrollY = window.scrollY
    const { body } = document
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'

    return () => {
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.left = previous.left
      body.style.right = previous.right
      body.style.width = previous.width
      body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [sheetOpen])

  useEffect(() => {
    const target = result.progress
    const duration = 720
    let frame = 0
    let startedAt = 0

    const tick = (time: number) => {
      if (!startedAt) {
        startedAt = time
      }
      const progress = Math.min(1, (time - startedAt) / duration)
      const eased = 1 - (1 - progress) ** 3
      setDisplayProgress(target * eased)
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [result.progress, resultVersion])

  useEffect(() => {
    if (result.months == null) {
      const frame = window.requestAnimationFrame(() => setDisplayMonths(null))
      return () => window.cancelAnimationFrame(frame)
    }

    const target = result.months
    const duration = 720
    let frame = 0
    let startedAt = 0

    const tick = (time: number) => {
      if (!startedAt) {
        startedAt = time
      }
      const progress = Math.min(1, (time - startedAt) / duration)
      const eased = 1 - (1 - progress) ** 3
      setDisplayMonths(Math.round(target * eased))
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      }
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [result.months, resultVersion])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextInputs = {
      targetIncomeInput,
      principalInput,
      monthlySavingInput,
      planKey,
      customRateInput,
    }
    setSubmittedInputs(nextInputs)
    saveCalculatorInputs(nextInputs)
    setHasCalculated(true)
    setResultVersion((version) => version + 1)
    setSheetOpen(false)
  }

  return (
    <main className="sub-page-shell lie-flat-shell">
      <div className={`sub-page sub-page--standalone lie-flat-page${hasCalculated ? '' : ' lie-flat-page--empty'}`}>
        <header className="sub-page-nav">
          <Link className="sub-page-icon-back" to="/more" aria-label="返回更多">
            <span aria-hidden>←</span>
          </Link>
          <h1 className="sub-page-title">躺平计算器</h1>
        </header>

        <section className="lie-flat-hero">
          <img className="lie-flat-hero-ip" src="/lie-flat-ip.png" alt="查理躺平计算助手" />
          <p className="lie-flat-hero-copy">输入目标收入、存款和每月可存，看看距离躺平还差多久。</p>
          <button type="button" className="primary-button lie-flat-start-button" onClick={() => setSheetOpen(true)}>
            {hasCalculated ? '重新计算' : '开始计算'}
          </button>
        </section>

        {hasCalculated && (
          <>
        <section className="lie-flat-result-card" aria-label="躺平进度">
          <div className="lie-flat-progress-ring lie-flat-result-animate" style={ringStyle} key={`ring-${resultVersion}`}>
            <div className="lie-flat-progress-ring-inner">
              <strong>{displayProgress.toFixed(0)}%</strong>
              <span>躺平进度</span>
            </div>
          </div>
          <div className="lie-flat-result-copy lie-flat-result-animate" key={`copy-${resultVersion}`}>
            <p className="lie-flat-result-label">预计还要工作</p>
            <h2>{formatYears(displayMonths)}</h2>
            <p>{plan.name} · {(result.annualRate * 100).toFixed(1)}% 年化估算</p>
            <p>躺平本金 {formatMoney(result.targetPrincipal)}</p>
          </div>
        </section>

        <section className="lie-flat-metrics" aria-label="计算结果">
          <article className="lie-flat-result-animate" key={`gap-${resultVersion}`}>
            <span>距离躺平还差</span>
            <strong>{formatMoney(result.gap)}</strong>
          </article>
          <article className="lie-flat-result-animate" key={`passive-${resultVersion}`}>
            <span>当前被动月收入</span>
            <strong>{formatMoney(result.passiveIncome)}</strong>
          </article>
        </section>

        <section className="panel lie-flat-breakdown-card" aria-label="躺平缺口拆解">
          <div className="budget-panel-title">
            <h2>躺平缺口怎么补上</h2>
            <p className="muted small">剩下的钱，主要看继续存和收益补。</p>
          </div>
          <div className="lie-flat-breakdown-bar" aria-hidden>
            <span
              className="lie-flat-breakdown-segment lie-flat-breakdown-segment--principal"
              style={{ width: `${Math.max(4, result.breakdown.principalPercent)}%` }}
            />
            <span
              className="lie-flat-breakdown-segment lie-flat-breakdown-segment--saving"
              style={{ width: `${Math.max(4, result.breakdown.futureSavingPercent)}%` }}
            />
            <span
              className="lie-flat-breakdown-segment lie-flat-breakdown-segment--gain"
              style={{ width: `${Math.max(4, result.breakdown.investmentGainPercent)}%` }}
            />
          </div>
          <div className="lie-flat-breakdown-list">
            <article>
              <i className="lie-flat-breakdown-dot lie-flat-breakdown-dot--principal" aria-hidden />
              <span>现在已有</span>
              <strong>{formatMoney(result.breakdown.principal)}</strong>
            </article>
            <article>
              <i className="lie-flat-breakdown-dot lie-flat-breakdown-dot--saving" aria-hidden />
              <span>未来还要存</span>
              <strong>{formatMoney(result.breakdown.futureSaving)}</strong>
            </article>
            <article>
              <i className="lie-flat-breakdown-dot lie-flat-breakdown-dot--gain" aria-hidden />
              <span>收益帮你补</span>
              <strong>{formatMoney(result.breakdown.investmentGain)}</strong>
            </article>
          </div>
        </section>

        <section className="panel lie-flat-spending-card" aria-label="保持当前消费习惯">
          <div className="budget-panel-title">
            <h2>保持当前消费习惯</h2>
            <p className="muted small">按近 6 个月有支出记录的月份估算。</p>
          </div>
          {spendingReference.monthCount > 0 ? (
            <>
              <div className="lie-flat-spending-main">
                <span>预计还要工作</span>
                <strong>{formatYears(spendingReference.months)}</strong>
              </div>
              <div className="lie-flat-spending-grid">
                <article>
                  <span>平均月支出</span>
                  <strong>{formatMoney(spendingReference.averageMonthlyExpense)}</strong>
                </article>
                <article>
                  <span>需攒到躺平本金</span>
                  <strong>{formatMoney(spendingReference.targetPrincipal)}</strong>
                </article>
              </div>
            </>
          ) : (
            <p className="muted small">近 6 个月还没有支出数据，暂时无法生成消费习惯参考。</p>
          )}
        </section>

        <section className="panel lie-flat-ai-card" aria-label="躺平解读">
          <h2>查理的躺平观察</h2>
          <p>
            {result.months == null
              ? '当前月存和收益假设还无法推到目标，可以先降低目标月收入，或增加每月可存金额。'
              : result.months <= 12 * 10
                ? '这个目标有机会在 10 年内完成，关键是保持稳定月存，别让计划中途断档。'
                : '目标不是不能实现，但当前节奏偏慢。优先提高每月可存金额，比盲目追高收益更稳。'}
          </p>
          <div className="lie-flat-strategy-grid" aria-label="策略模拟">
            {result.strategyScenarios.map((scenario) => (
              <article key={scenario.title}>
                <span>{scenario.title}</span>
                <strong>{scenario.value}</strong>
                <em>{scenario.description}</em>
              </article>
            ))}
          </div>
          <div className="lie-flat-return-reference" aria-label="收益参考区间">
            <h3>收益参考区间</h3>
            {RETURN_REFERENCES.map((item) => (
              <article key={item.name}>
                <span>{item.name}</span>
                <strong>{item.range}</strong>
                <em>{item.note}</em>
              </article>
            ))}
          </div>
          <ul>
            <li>躺平本金指：按当前收益率，能产生目标月收入所需要攒到的钱。</li>
            <li>公式按复利估算：当前存款和后续每月存入都会继续产生收益。</li>
            <li>{plan.description}</li>
            <li>这个计算是情景估算，不构成投资建议。</li>
          </ul>
        </section>
          </>
        )}
      </div>

      {sheetOpen && createPortal(
        <div className="ledger-receipt-sheet-layer lie-flat-sheet-layer" role="presentation">
          <button
            type="button"
            className="ledger-receipt-sheet-backdrop"
            aria-label="关闭躺平计算器输入"
            onClick={() => setSheetOpen(false)}
          />
          <section
            className="ledger-receipt-sheet lie-flat-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lie-flat-sheet-title"
          >
            <div className="ledger-receipt-review-head">
              <h3 id="lie-flat-sheet-title">开始计算</h3>
              <button
                type="button"
                className="ledger-receipt-sheet-close"
                aria-label="关闭躺平计算器输入"
                onClick={() => setSheetOpen(false)}
              >
                ×
              </button>
            </div>
            <form className="form-grid lie-flat-sheet-form" onSubmit={handleSubmit}>
              <div className="lie-flat-sheet-scroll">
                <label>
                  期望躺平后月收入
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    required
                    value={targetIncomeInput}
                    onChange={(event) => setTargetIncomeInput(event.target.value)}
                    placeholder="例如 5000"
                  />
                </label>
                <label>
                  当前存款
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    required
                    value={principalInput}
                    onChange={(event) => setPrincipalInput(event.target.value)}
                    placeholder="例如 100000"
                  />
                </label>
                <label>
                  当前每月可存
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    required
                    value={monthlySavingInput}
                    onChange={(event) => setMonthlySavingInput(event.target.value)}
                    placeholder="例如 3000"
                  />
                </label>
                <div className="lie-flat-plan-grid" aria-label="投资收益类型">
                  {(Object.keys(PLANS) as PlanKey[]).map((key) => (
                    <button
                      type="button"
                      key={key}
                      className={`lie-flat-plan-option${planKey === key ? ' active' : ''}`}
                      onClick={() => setPlanKey(key)}
                    >
                      <strong>{PLANS[key].name}</strong>
                      <span>{key === 'custom' ? '自定义' : `${(PLANS[key].rate * 100).toFixed(1)}% 年化`}</span>
                    </button>
                  ))}
                </div>
                {planKey === 'custom' && (
                  <label>
                    预期年化收益率（%）
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      max="30"
                      step="0.1"
                      required
                      value={customRateInput}
                      onChange={(event) => setCustomRateInput(event.target.value)}
                    />
                  </label>
                )}
              </div>
              <div className="ledger-receipt-sheet-actions">
                <button type="button" className="secondary-button" onClick={() => setSheetOpen(false)}>
                  取消
                </button>
                <button className="primary-button" type="submit">
                  查看结果
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}
    </main>
  )
}
