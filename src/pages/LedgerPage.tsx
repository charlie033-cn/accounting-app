import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { currentMonth, todayISO } from '../accounting/constants'
import { ConfirmActionSheet } from '../components/ConfirmActionSheet'
import { daysInCalendarMonth } from '../accounting/format'
import { useAccounting } from '../context/AccountingContext'
import { parseReceiptFromImageDataUrl, type ReceiptParseDraft } from '../lib/parseReceiptTokenhub'
import type { Transaction } from '../types/transaction'
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
  return options.includes('其他') ? '其他' : (options[0] ?? t)
}

type ReceiptReviewItem = ReceiptParseDraft & {
  id: string
  selected: boolean
}

type BrowserSpeechRecognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } }; resultIndex: number }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition

type SpeechWindow = Window & {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor
}

function addDaysISO(offset: number) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateFromMonthDay(month: number, day: number) {
  const now = new Date()
  const date = new Date(now.getFullYear(), month - 1, day)
  if (Number.isNaN(date.getTime())) {
    return todayISO()
  }
  const year = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

function parseChineseNumber(input: string): number | null {
  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  const unitMap: Record<string, number> = {
    十: 10,
    百: 100,
    千: 1000,
    万: 10000,
  }
  let total = 0
  let section = 0
  let number = 0
  let seen = false

  for (const char of input) {
    if (char in digitMap) {
      number = digitMap[char]
      seen = true
      continue
    }
    const unit = unitMap[char]
    if (!unit) {
      return null
    }
    seen = true
    if (unit === 10000) {
      section = (section + number) * unit
      total += section
      section = 0
    } else {
      section += (number || 1) * unit
    }
    number = 0
  }

  return seen ? total + section + number : null
}

function parseVoiceAmount(text: string) {
  const arabic = text.match(/(\d+(?:\.\d+)?)\s*(?:元|块|块钱|人民币)?/)
  if (arabic) {
    return arabic[1]
  }
  const chinese = text.match(/([零一二两三四五六七八九十百千万]+)\s*(?:元|块|块钱|人民币)/)
  if (!chinese) {
    return ''
  }
  const amount = parseChineseNumber(chinese[1])
  return amount == null ? '' : String(amount)
}

function parseVoiceDate(text: string) {
  if (/前天/.test(text)) {
    return addDaysISO(-2)
  }
  if (/昨天|昨日/.test(text)) {
    return addDaysISO(-1)
  }
  if (/明天|明日/.test(text)) {
    return addDaysISO(1)
  }
  const monthDay = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/)
  if (monthDay) {
    return dateFromMonthDay(Number(monthDay[1]), Number(monthDay[2]))
  }
  const dayOnly = text.match(/(\d{1,2})\s*(?:日|号)/)
  if (dayOnly) {
    const now = new Date()
    return dateFromMonthDay(now.getMonth() + 1, Number(dayOnly[1]))
  }
  return todayISO()
}

function parseVoiceCategory(text: string, options: string[]) {
  const keywordMap: Array<[string, string[]]> = [
    ['餐饮', ['饭', '餐', '午饭', '晚饭', '早餐', '吃', '咖啡', '奶茶', '外卖', '水果']],
    ['交通', ['打车', '出租', '地铁', '公交', '高铁', '火车', '机票', '停车', '加油']],
    ['购物', ['买', '购物', '超市', '衣服', '鞋', '日用品']],
    ['房租', ['房租', '租房', '租金']],
    ['水电', ['水费', '电费', '燃气', '网费', '物业']],
    ['娱乐', ['电影', '游戏', '娱乐', '唱歌', '演出']],
    ['医疗', ['医院', '药', '看病', '体检', '医疗']],
  ]
  const exact = options.find((option) => text.includes(option))
  if (exact) {
    return exact
  }
  const matched = keywordMap.find(([category, keywords]) =>
    options.includes(category) && keywords.some((keyword) => text.includes(keyword)),
  )
  if (matched) {
    return matched[0]
  }
  return options.includes('其他') ? '其他' : (options[0] ?? '')
}

function cleanVoiceNote(text: string) {
  return text
    .replace(/[，。,.]/g, ' ')
    .replace(/(今天|昨日|昨天|前天|明天|明日)/g, ' ')
    .replace(/\d{1,2}\s*月\s*\d{1,2}\s*(日|号)?/g, ' ')
    .replace(/\d{1,2}\s*(日|号)/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(元|块|块钱|人民币)?/g, ' ')
    .replace(/[零一二两三四五六七八九十百千万]+\s*(元|块|块钱|人民币)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function LedgerPage() {
  const {
    form,
    setForm,
    editingId,
    cancelEdit,
    handleSubmit,
    saveTransactionsFromDrafts,
    beginEditTransaction,
    handleDeleteTransaction,
    categoryOptions,
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
  const voiceRecognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const voiceTranscriptRef = useRef('')
  const voiceShouldApplyRef = useRef(false)
  const [receiptParsing, setReceiptParsing] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceStopping, setVoiceStopping] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [receiptDrafts, setReceiptDrafts] = useState<ReceiptReviewItem[]>([])
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null)
  const [swipedTransactionId, setSwipedTransactionId] = useState<string | null>(null)

  const cm = currentMonth()
  const day = todayISO()

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

  /**
   * 与「更多」一致：预算月份为当前月且上限大于 0 时展示。
   * 当日剩余 = 本月预算÷当月天数 − 今日支出（与「更多」日均参考同一口径）。
   */
  const ledgerBudgetStrip = useMemo(() => {
    if (budgetPeriod !== cm) {
      return null
    }
    if (budgetAmount == null || budgetAmount <= 0) {
      return null
    }
    const days = daysInCalendarMonth(cm)
    if (days <= 0) {
      return null
    }
    const daily = budgetAmount / days
    const todayVsDailyPercent =
      daily > 0 ? (todayExpenseTotal / daily) * 100 : null
    const monthVsBudgetPercent =
      budgetAmount > 0 ? (stats.expense / budgetAmount) * 100 : null
    return {
      monthRem: budgetAmount - stats.expense,
      dayRem: daily - todayExpenseTotal,
      cap: budgetAmount,
      daily,
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

  useEffect(() => {
    if (editingId || form.amount || form.note || form.transaction_date === day) {
      return
    }
    setForm((current) => ({
      ...current,
      transaction_date: day,
    }))
  }, [day, editingId, form.amount, form.note, form.transaction_date, setForm])

  useEffect(() => {
    return () => {
      voiceRecognitionRef.current?.abort()
    }
  }, [])

  const openReceiptPicker = () => {
    setReceiptError('')
    receiptFileRef.current?.click()
  }

  const applyVoiceText = (text: string) => {
    const expenseOptions = categoryOptions('expense')
    const amount = parseVoiceAmount(text)
    if (!amount) {
      setReceiptError('没有识别到金额，可以说“午饭 28 元”')
      return
    }
    setForm({
      type: 'expense',
      amount,
      category: parseVoiceCategory(text, expenseOptions),
      transaction_date: parseVoiceDate(text),
      note: cleanVoiceNote(text),
    })
    setReceiptError('')
    setError('')
    setMessage('语音已填入，请核对后保存')
  }

  const resetVoiceDraftForm = () => {
    const expenseOptions = categoryOptions('expense')
    setForm({
      type: 'expense',
      amount: '',
      category: expenseOptions[0] ?? '其他',
      transaction_date: todayISO(),
      note: '',
    })
  }

  const startVoiceAccounting = () => {
    const SpeechRecognition =
      (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setReceiptError('当前浏览器暂不支持语音记账，请用手机系统浏览器或 Chrome 试试')
      return
    }

    voiceRecognitionRef.current?.abort()
    voiceTranscriptRef.current = ''
    voiceShouldApplyRef.current = false
    resetVoiceDraftForm()
    const recognition = new SpeechRecognition()
    voiceRecognitionRef.current = recognition
    recognition.lang = 'zh-CN'
    recognition.interimResults = false
    recognition.continuous = true
    recognition.onresult = (event) => {
      if (voiceRecognitionRef.current !== recognition) {
        return
      }
      const result = event.results[event.resultIndex]?.[0]?.transcript?.trim()
      if (result) {
        voiceTranscriptRef.current = `${voiceTranscriptRef.current} ${result}`.trim()
      }
    }
    recognition.onerror = (event) => {
      if (voiceRecognitionRef.current !== recognition) {
        return
      }
      if (event.error === 'aborted') {
        return
      }
      const message =
        event.error === 'not-allowed'
          ? '请允许麦克风权限后再试'
          : '语音识别失败，请再试一次'
      setReceiptError(message)
      setVoiceListening(false)
      setVoiceStopping(false)
    }
    recognition.onend = () => {
      if (voiceRecognitionRef.current !== recognition) {
        return
      }
      const shouldApply = voiceShouldApplyRef.current
      const transcript = voiceTranscriptRef.current.trim()
      voiceShouldApplyRef.current = false
      voiceRecognitionRef.current = null
      setVoiceListening(false)
      setVoiceStopping(false)
      if (!shouldApply) {
        return
      }
      if (!transcript) {
        setReceiptError('没有听清楚，请再试一次')
        return
      }
      applyVoiceText(transcript)
    }
    setReceiptError('')
    setVoiceListening(true)
    setVoiceStopping(false)
    try {
      recognition.start()
    } catch {
      setVoiceListening(false)
      setVoiceStopping(false)
      setReceiptError('语音识别启动失败，请稍后再试')
    }
  }

  const stopVoiceAccounting = () => {
    voiceShouldApplyRef.current = true
    setVoiceStopping(true)
    try {
      voiceRecognitionRef.current?.stop()
    } catch {
      setVoiceListening(false)
      setVoiceStopping(false)
      setReceiptError('语音识别结束失败，请再试一次')
    }
  }

  const cancelVoiceAccounting = () => {
    voiceShouldApplyRef.current = false
    voiceTranscriptRef.current = ''
    setVoiceListening(false)
    setVoiceStopping(false)
    voiceRecognitionRef.current?.abort()
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

    setReceiptParsing(true)
    setReceiptError('')
    setReceiptDrafts([])
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const drafts = await parseReceiptFromImageDataUrl(dataUrl)
      const normalized = drafts.map((draft, index) => ({
        ...draft,
        id: `${Date.now()}-${index}`,
        selected: true,
        type: 'expense' as const,
        category: pickCategory(draft.category, categoryOptions('expense')),
      }))

      if (normalized.length === 1) {
        const draft = normalized[0]
        setForm({
          type: 'expense',
          amount: draft.amount,
          category: draft.category,
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
      setReceiptError(err instanceof Error ? err.message : '识别失败')
    } finally {
      setReceiptParsing(false)
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
                title="（本月预算÷当月天数）− 今日支出"
              >
                {formatMoney(ledgerBudgetStrip.dayRem)}
              </p>
              <p className="muted small ledger-budget-strip-meta">
                日均 {formatMoney(ledgerBudgetStrip.daily)}
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
                上限 {formatMoney(ledgerBudgetStrip.cap)}
              </p>
            </div>
            {(ledgerBudgetStrip.todayVsDailyPercent != null ||
              ledgerBudgetStrip.monthVsBudgetPercent != null) && (
              <div className="ledger-budget-strip-meters">
                <div className="ledger-budget-strip-meter-col">
                  {ledgerBudgetStrip.todayVsDailyPercent != null && (
                    <>
                      <div className="ledger-budget-meter-line">
                        <span>已支出</span>
                        <strong
                          className={
                            ledgerBudgetStrip.todayVsDailyPercent > 100 ? 'over' : undefined
                          }
                        >
                          {formatMoney(todayExpenseTotal)} ·{' '}
                          {ledgerBudgetStrip.todayVsDailyPercent.toFixed(0)}%
                        </strong>
                      </div>
                      <div
                        className="meter"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(
                          Math.min(100, ledgerBudgetStrip.todayVsDailyPercent),
                        )}
                        aria-label="今日已支出相对日均比例"
                      >
                        <div
                          className={`meter-fill today ${
                            ledgerBudgetStrip.todayVsDailyPercent > 100 ? 'over' : ''
                          }`}
                          style={{
                            width: `${Math.min(100, ledgerBudgetStrip.todayVsDailyPercent)}%`,
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
                        <span>已支出</span>
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
              className="secondary-button ledger-receipt-scan-btn ledger-voice-btn"
              onClick={startVoiceAccounting}
              disabled={isLoading || receiptParsing || voiceListening}
            >
              <span className="ledger-voice-icon" aria-hidden>
                声
              </span>
              {voiceListening ? '聆听中…' : '语音记账'}
            </button>
            <button
              type="button"
              className="secondary-button ledger-receipt-scan-btn"
              onClick={openReceiptPicker}
              disabled={isLoading || receiptParsing || voiceListening}
            >
              <img
                className="ledger-receipt-scan-icon"
                src="/receipt-scan-icon.svg"
                alt=""
                aria-hidden
              />
              {receiptParsing ? '识别中…' : '识图记账'}
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
              required
            />
          </span>
        </label>

        <div className="form-row-2 ledger-category-date-row">
          <label>
            <span className="sr-only">分类</span>
            <select
              value={form.category}
              onChange={(event) => setForm({ ...form, type: 'expense', category: event.target.value })}
            >
              {categoryOptions('expense').map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">日期</span>
            <input
              type="date"
              value={form.transaction_date}
              onChange={(event) => setForm({ ...form, type: 'expense', transaction_date: event.target.value })}
              required
            />
          </label>
        </div>

        <label className="ledger-note-field">
          <span className="sr-only">备注</span>
          <textarea
            className="ledger-compact-note"
            value={form.note}
            onChange={(event) => setForm({ ...form, type: 'expense', note: event.target.value })}
            placeholder="选填，如：晚餐、打车"
            rows={1}
          />
        </label>

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
                          updateReceiptDraft(draft.id, { category: event.target.value })
                        }
                      >
                        {categoryOptions('expense').map((category) => (
                          <option key={category} value={category}>
                            {category}
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

      {voiceListening && createPortal(
        <div className="ledger-receipt-sheet-layer" role="presentation">
          <div className="ledger-receipt-sheet-backdrop" aria-hidden />
          <section
            className="ledger-receipt-sheet ledger-voice-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ledger-voice-sheet-title"
          >
            <div className="ledger-voice-recording">
              <span className="ledger-voice-recording-dot" aria-hidden />
              <h3 id="ledger-voice-sheet-title">正在收音</h3>
              <p>说完后点击结束收音，我会自动识别并填入表单。</p>
              <p className="muted small">例如：昨天午饭 28 元</p>
            </div>
            <div className="ledger-receipt-sheet-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={cancelVoiceAccounting}
                disabled={voiceStopping}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={stopVoiceAccounting}
                disabled={voiceStopping}
              >
                {voiceStopping ? '识别中...' : '结束收音'}
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
                  beginEditTransaction(item)
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
            <strong className="transaction-item-category">{item.category}</strong>
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
