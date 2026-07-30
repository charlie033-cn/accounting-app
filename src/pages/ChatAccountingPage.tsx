import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { todayISO } from '../accounting/constants'
import { inferBuiltInCategory } from '../accounting/categoryRules'
import { daysInCalendarMonth } from '../accounting/format'
import { useAccounting } from '../context/AccountingContext'
import {
  chatWithCharlieTokenhub,
  parseChatAccountingTurnWithTokenhub,
} from '../lib/parseVoiceTransactionTokenhub'
import type { Transaction, TransactionFormState } from '../types/transaction'
import {
  monthDateRange,
  recentMonthsDateRange,
  yearDateRange,
} from '../lib/transactionDateRange'
import type { TransactionDateRange } from '../lib/transactionQueries'

type InputMode = 'text' | 'voice'

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
}

type ChatDraft = Omit<TransactionFormState, 'type'> & {
  id: string
  type: 'expense'
}

type SavedChatSession = {
  messages: ChatMessage[]
  drafts: ChatDraft[]
}

type ChatQueryPeriod = {
  label: string
  range: TransactionDateRange | null
  month: string | null
  allHistory: boolean
}

type FocusedTransactionQuery = {
  query: string
  period: {
    label: string
    startDate: string | null
    endDate: string | null
    month: string | null
  }
  filter: {
    category: string | null
    subcategory: string | null
  }
  intents: string[]
  statistics: {
    totalExpense: number
    expenseCount: number
    calendarDays: number | null
    averageDailyExpense: number | null
    activeDays: number
    topCategories: Array<{ category: string; amount: number; count: number }>
    largestExpense: {
      amount: number
      category: string
      subcategory: string | null
      date: string
      note: string | null
    } | null
    monthlyTotals: Array<{ month: string; amount: number; count: number }>
  }
  transactions: Array<{
    amount: number
    category: string
    subcategory: string | null
    date: string
    note: string | null
  }>
  completeness: {
    matchedCount: number
    includedCount: number
    isComplete: boolean
  }
}

const CHAT_ACCOUNTING_STORAGE_KEY = 'accounting-app:chat-accounting-session'

const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'hello',
    role: 'assistant',
    text: '我是小猪查理。今天花了什么，放心丢给我吧，一次说好几笔也行。我会帮你整理好，哪里不对你再吩咐我改。',
  },
]

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

function parseTextDate(text: string) {
  if (/前天/.test(text)) {
    return addDaysISO(-2)
  }
  if (/昨天|昨日/.test(text)) {
    return addDaysISO(-1)
  }
  return todayISO()
}

function cleanNote(text: string) {
  return text
    .replace(/(今天|昨日|昨天|前天)/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(元|块|块钱|人民币)?/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[，。,.、\s]+|[，。,.、\s]+$/g, '')
    .trim()
}

function fallbackDraftsFromText(text: string, categories: string[], subcategoryMap: Record<string, string[]>) {
  const parts = text
    .split(/[，。；;、\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
  const sourceParts = parts.length > 0 ? parts : [text.trim()]

  return sourceParts.flatMap((part) => {
    const amount = part.match(/(\d+(?:\.\d+)?)\s*(?:元|块|块钱|人民币)?/)
    if (!amount) {
      return []
    }
    const category = inferBuiltInCategory(part, 'expense', categories) || categories[0] || '其他支出'
    return [{
      type: 'expense' as const,
      amount: amount[1],
      category,
      subcategory: subcategoryMap[category]?.[0] ?? '',
      transaction_date: parseTextDate(part),
      note: cleanNote(part) || part,
    }]
  })
}

function chineseOrdinalIndex(text: string) {
  const arabic = text.match(/第\s*(\d+)\s*笔/)
  if (arabic) {
    return Number(arabic[1]) - 1
  }
  const map: Record<string, number> = {
    一: 0,
    二: 1,
    两: 1,
    三: 2,
    四: 3,
    五: 4,
    六: 5,
    七: 6,
    八: 7,
    九: 8,
    十: 9,
  }
  const chinese = text.match(/第\s*([一二两三四五六七八九十])\s*笔/)
  return chinese ? map[chinese[1]] : null
}

function fallbackUpdateDraftsFromContext(
  text: string,
  drafts: ChatDraft[],
  categories: string[],
  subcategoryMap: Record<string, string[]>,
): { drafts: ChatDraft[]; reply: string } | null {
  if (drafts.length === 0) {
    return null
  }

  const category = categories.find((item) => text.includes(item))
  const subcategoryMatch = Object.entries(subcategoryMap).flatMap(([parentCategory, subcategories]) =>
    subcategories.map((subcategory) => ({ parentCategory, subcategory })),
  ).find((item) => text.includes(item.subcategory))
  const nextCategory = category ?? subcategoryMatch?.parentCategory
  const nextSubcategory = subcategoryMatch?.subcategory ?? (nextCategory ? subcategoryMap[nextCategory]?.[0] : undefined)
  if (!nextCategory) {
    return null
  }

  const shouldUpdateAll = /全部|所有|都/.test(text)
  const ordinalIndex = chineseOrdinalIndex(text)
  const noteIndex = drafts.findIndex((draft) => draft.note && text.includes(draft.note))
  const targetIndex = ordinalIndex != null
    ? ordinalIndex
    : noteIndex >= 0
      ? noteIndex
      : drafts.length === 1
        ? 0
        : drafts.length - 1

  const nextDrafts = drafts.map((draft, index) => {
    if (!shouldUpdateAll && index !== targetIndex) {
      return draft
    }
    return {
      ...draft,
      category: nextCategory,
      subcategory: nextSubcategory ?? '',
    }
  })

  return {
    drafts: nextDrafts,
    reply: shouldUpdateAll
      ? `收到，小猪查理已经把这几笔都改成「${nextSubcategory || nextCategory}」啦。`
      : `收到，这笔我已经改成「${nextSubcategory || nextCategory}」啦。`,
  }
}

async function ensureMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach((track) => track.stop())
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function monthKeyFromOffset(offset: number) {
  const date = new Date()
  date.setMonth(date.getMonth() + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function chatQuerySources(text: string, messages: ChatMessage[]) {
  return [
    text,
    ...messages
      .filter((message) => message.role === 'user')
      .slice(-5)
      .reverse()
      .map((message) => message.text),
  ]
}

function inferChatQueryPeriod(text: string, messages: ChatMessage[]): ChatQueryPeriod {
  const sources = chatQuerySources(text, messages)
  const currentYear = new Date().getFullYear()
  const currentMonthValue = new Date().getMonth() + 1

  if (/(全部|所有|历史|最早|更早).*(账单|记录|消费|支出)|从开始到现在/.test(text)) {
    return { label: '全部历史', range: null, month: null, allHistory: true }
  }

  for (const source of sources) {
    const explicitMonth = source.match(/(?:(20\d{2})\s*[年/-]\s*)?(1[0-2]|0?[1-9])\s*月(?!个)/)
    if (explicitMonth) {
      const monthValue = Number(explicitMonth[2])
      const yearValue = explicitMonth[1]
        ? Number(explicitMonth[1])
        : monthValue > currentMonthValue
          ? currentYear - 1
          : currentYear
      const month = `${yearValue}-${String(monthValue).padStart(2, '0')}`
      return { label: `${yearValue}年${monthValue}月`, range: monthDateRange(month), month, allHistory: false }
    }

    const explicitYear = source.match(/(20\d{2})\s*年/)
    if (explicitYear) {
      const year = explicitYear[1]
      return { label: `${year}年`, range: yearDateRange(year), month: null, allHistory: false }
    }
    if (/(去年|上一年)/.test(source)) {
      const year = String(currentYear - 1)
      return { label: `${year}年`, range: yearDateRange(year), month: null, allHistory: false }
    }
    if (/(今年|本年度)/.test(source)) {
      const year = String(currentYear)
      return { label: `${year}年`, range: yearDateRange(year), month: null, allHistory: false }
    }
    if (/(上个月|上月)/.test(source)) {
      const month = monthKeyFromOffset(-1)
      return { label: '上个月', range: monthDateRange(month), month, allHistory: false }
    }
    if (/(这个月|本月|当月)/.test(source)) {
      const month = monthKeyFromOffset(0)
      return { label: '本月', range: monthDateRange(month), month, allHistory: false }
    }
    if (/(近|最近)\s*(半|6|六)\s*(年|个月)|半年/.test(source)) {
      return { label: '近六个月', range: recentMonthsDateRange(6), month: null, allHistory: false }
    }
    if (/(近|最近)\s*(3|三)\s*个月/.test(source)) {
      return { label: '近三个月', range: recentMonthsDateRange(3), month: null, allHistory: false }
    }
  }

  return { label: '近六个月', range: recentMonthsDateRange(6), month: null, allHistory: false }
}

function looksLikeLedgerQuestion(
  text: string,
  messages: ChatMessage[],
  categories: string[],
  subcategoryMap: Record<string, string[]>,
) {
  const ledgerPattern = /(消费|支出|账单|花了|花费|总额|日均|平均|几笔|哪几笔|第\s*[一二两三四五六七八九十\d]+\s*笔|明细|记录|分类|趋势|环比|最高|最大单笔|最贵|预算|上月|本月|这个月|今年|去年)/
  if (ledgerPattern.test(text)) {
    return true
  }
  const labels = [...categories, ...Object.values(subcategoryMap).flat()]
  if (labels.some((label) => label && text.includes(label))) {
    return true
  }
  if (!/(翻翻|查查|继续|还有|全部|都列|列出来|具体|哪一笔|第\s*[一二两三四五六七八九十\d]+\s*笔|那几笔|更早|详细|^(那|它|这个|那个).*(呢|多少|哪些|怎么样))/u.test(text)) {
    return false
  }
  return messages
    .filter((message) => message.role === 'user')
    .slice(-3)
    .some((message) => ledgerPattern.test(message.text))
}

function inferFocusedIntents(text: string, messages: ChatMessage[]) {
  const sources = chatQuerySources(text, messages)
  const current = text
  const combined = sources.join(' ')
  const intents: string[] = []
  if (/(翻翻|查查|明细|哪几笔|第\s*[一二两三四五六七八九十\d]+\s*笔|都列|列出来|全部|具体|记录)/.test(current)) intents.push('list')
  if (/(日均|平均每天|每天平均)/.test(combined)) intents.push('average')
  if (/(总额|一共|总共|花了多少|消费多少|支出多少)/.test(combined)) intents.push('total')
  if (/(几笔|笔数|多少笔)/.test(combined)) intents.push('count')
  if (/(最高|最大单笔|最贵|高消费)/.test(combined)) intents.push('largest')
  if (/(趋势|走势|变化|环比|对比|比较)/.test(combined)) intents.push('trend')
  return intents.length > 0 ? [...new Set(intents)] : ['summary']
}

function inferFocusedCategory(
  text: string,
  messages: ChatMessage[],
  rows: Transaction[],
  categories: string[],
  subcategoryMap: Record<string, string[]>,
) {
  const sources = chatQuerySources(text, messages)
  const knownCategories = Array.from(new Set([...categories, ...rows.map((row) => row.category)]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const knownSubcategories = Array.from(new Set([
    ...Object.values(subcategoryMap).flat(),
    ...rows.map((row) => row.subcategory?.trim()).filter((item): item is string => Boolean(item)),
  ])).sort((a, b) => b.length - a.length)

  for (const source of sources) {
    const category = knownCategories.find((item) => source.includes(item))
    if (category) {
      return { category, subcategory: null }
    }
    const subcategory = knownSubcategories.find((item) => source.includes(item))
    if (subcategory) {
      const parentCategory = Object.entries(subcategoryMap)
        .find(([, values]) => values.includes(subcategory))?.[0] ?? null
      return { category: parentCategory, subcategory }
    }
  }
  return { category: null, subcategory: null }
}

function summarizeExpenseRows(rows: Transaction[]) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  const categoryTotals = new Map<string, number>()
  for (const row of rows) {
    categoryTotals.set(row.category, (categoryTotals.get(row.category) ?? 0) + row.amount)
  }
  const topCategories = [...categoryTotals.entries()]
    .map(([category, amount]) => ({ category, amount: Number(amount.toFixed(2)) }))
    .sort((a, b) => b.amount - a.amount)
  const largest = [...rows].sort((a, b) => b.amount - a.amount)[0]
  return {
    total: Number(total.toFixed(2)),
    count: rows.length,
    categoryTotals: topCategories,
    topCategories: topCategories.slice(0, 6),
    largestExpense: largest
      ? {
          amount: largest.amount,
          category: largest.category,
          subcategory: largest.subcategory,
          date: largest.transaction_date,
          note: largest.note,
        }
      : null,
  }
}

function summarizeMonthExpenseRows(rows: Transaction[], month: string) {
  const summary = summarizeExpenseRows(rows)
  const calendarDays = daysInCalendarMonth(month)
  return {
    ...summary,
    calendarDays,
    averageDailyExpense: Number((summary.total / calendarDays).toFixed(2)),
    categoryStats: summary.categoryTotals.map((item) => {
      const categoryRows = rows.filter((row) => row.category === item.category)
      return {
        category: item.category,
        amount: item.amount,
        count: categoryRows.length,
        averageDailyExpense: Number((item.amount / calendarDays).toFixed(2)),
      }
    }),
  }
}

function buildFocusedTransactionQuery(input: {
  text: string
  messages: ChatMessage[]
  rows: Transaction[]
  period: ChatQueryPeriod
  categories: string[]
  subcategoryMap: Record<string, string[]>
}): FocusedTransactionQuery {
  const expenseRows = input.rows.filter((row) => row.type === 'expense')
  const filter = inferFocusedCategory(
    input.text,
    input.messages,
    expenseRows,
    input.categories,
    input.subcategoryMap,
  )
  const matchedRows = expenseRows
    .filter((row) => {
      if (filter.subcategory) {
        return row.subcategory === filter.subcategory
      }
      if (filter.category) {
        return row.category === filter.category
      }
      return true
    })
    .sort((a, b) => {
      const dateOrder = b.transaction_date.localeCompare(a.transaction_date)
      return dateOrder || b.created_at.localeCompare(a.created_at)
    })
  const totalExpense = matchedRows.reduce((sum, row) => sum + row.amount, 0)
  const categoryMap = new Map<string, { amount: number; count: number }>()
  const monthlyMap = new Map<string, { amount: number; count: number }>()
  for (const row of matchedRows) {
    const category = categoryMap.get(row.category) ?? { amount: 0, count: 0 }
    category.amount += row.amount
    category.count += 1
    categoryMap.set(row.category, category)

    const month = row.transaction_date.slice(0, 7)
    const monthly = monthlyMap.get(month) ?? { amount: 0, count: 0 }
    monthly.amount += row.amount
    monthly.count += 1
    monthlyMap.set(month, monthly)
  }
  const calendarDays = input.period.month ? daysInCalendarMonth(input.period.month) : null
  const includedRows = matchedRows.slice(0, 80)
  const largest = [...matchedRows].sort((a, b) => b.amount - a.amount)[0]

  return {
    query: input.text,
    period: {
      label: input.period.label,
      startDate: input.period.range?.startDate ?? null,
      endDate: input.period.range?.endDate ?? null,
      month: input.period.month,
    },
    filter,
    intents: inferFocusedIntents(input.text, input.messages),
    statistics: {
      totalExpense: Number(totalExpense.toFixed(2)),
      expenseCount: matchedRows.length,
      calendarDays,
      averageDailyExpense: calendarDays
        ? Number((totalExpense / calendarDays).toFixed(2))
        : null,
      activeDays: new Set(matchedRows.map((row) => row.transaction_date)).size,
      topCategories: Array.from(categoryMap.entries())
        .map(([category, value]) => ({
          category,
          amount: Number(value.amount.toFixed(2)),
          count: value.count,
        }))
        .sort((a, b) => b.amount - a.amount),
      largestExpense: largest
        ? {
            amount: largest.amount,
            category: largest.category,
            subcategory: largest.subcategory ?? null,
            date: largest.transaction_date,
            note: largest.note,
          }
        : null,
      monthlyTotals: Array.from(monthlyMap.entries())
        .map(([month, value]) => ({
          month,
          amount: Number(value.amount.toFixed(2)),
          count: value.count,
        }))
        .sort((a, b) => a.month.localeCompare(b.month)),
    },
    transactions: includedRows.map((row) => ({
      amount: row.amount,
      category: row.category,
            subcategory: row.subcategory ?? null,
      date: row.transaction_date,
      note: row.note,
    })),
    completeness: {
      matchedCount: matchedRows.length,
      includedCount: includedRows.length,
      isComplete: includedRows.length === matchedRows.length,
    },
  }
}

function buildTransactionInsightContext(transactions: Transaction[]) {
  const expenseRows = transactions
    .filter((row) => row.type === 'expense')
    .sort((a, b) => {
      const dateOrder = b.transaction_date.localeCompare(a.transaction_date)
      return dateOrder || b.created_at.localeCompare(a.created_at)
    })
  const recentSixMonthKeys = Array.from({ length: 6 }, (_, index) => monthKeyFromOffset(-index)).reverse()
  const monthlyExpenseTotals = recentSixMonthKeys.map((month) => {
    const rows = expenseRows.filter((row) => row.transaction_date.startsWith(month))
    return {
      month,
      ...summarizeMonthExpenseRows(rows, month),
    }
  })
  const currentMonth = monthKeyFromOffset(0)
  const lastMonth = monthKeyFromOffset(-1)
  const lastSixMonthRows = expenseRows.filter((row) => recentSixMonthKeys.some((month) => row.transaction_date.startsWith(month)))

  return {
    generatedAt: new Date().toISOString(),
    currentDate: todayISO(),
    availableExpenseCount: expenseRows.length,
    currentMonth: {
      month: currentMonth,
      ...summarizeMonthExpenseRows(
        expenseRows.filter((row) => row.transaction_date.startsWith(currentMonth)),
        currentMonth,
      ),
    },
    lastMonth: {
      month: lastMonth,
      ...summarizeMonthExpenseRows(
        expenseRows.filter((row) => row.transaction_date.startsWith(lastMonth)),
        lastMonth,
      ),
    },
    recentSixMonths: monthlyExpenseTotals,
    recentTransactions: expenseRows.slice(0, 40).map((row) => ({
      amount: row.amount,
      category: row.category,
      subcategory: row.subcategory ?? null,
      date: row.transaction_date,
      note: row.note,
    })),
    highExpenseCandidates: lastSixMonthRows
      .filter((row) => row.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20)
      .map((row) => ({
        amount: row.amount,
        category: row.category,
        subcategory: row.subcategory,
        date: row.transaction_date,
        note: row.note,
      })),
    lastSixMonthsSummary: summarizeExpenseRows(lastSixMonthRows),
  }
}

function formatAmount(value: number) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function answerFocusedQueryLocally(focus: FocusedTransactionQuery) {
  const { statistics, intents, transactions, completeness } = focus
  const label = focus.filter.subcategory ?? focus.filter.category ?? '支出'
  if (statistics.expenseCount === 0) {
    return `${focus.period.label}没有找到「${label}」相关支出记录。`
  }

  if (intents.includes('list')) {
    const visibleRows = transactions.slice(0, 15)
    const details = visibleRows
      .map((row, index) => {
        const name = row.note || row.subcategory || row.category
        return `${index + 1}. ${row.date}「${name}」${formatAmount(row.amount)}`
      })
      .join('\n')
    const remaining = statistics.expenseCount - visibleRows.length
    const tail = remaining > 0
      ? `\n另外还有 ${remaining} 笔，本次先列出金额时间范围内最近的 ${visibleRows.length} 笔。`
      : ''
    return `${focus.period.label}「${label}」共 ${statistics.expenseCount} 笔，合计 ${formatAmount(statistics.totalExpense)}：\n${details}${tail}`
  }

  if (intents.includes('average') && statistics.averageDailyExpense !== null) {
    return `${focus.period.label}「${label}」共消费 ${formatAmount(statistics.totalExpense)}，${statistics.expenseCount} 笔。按 ${statistics.calendarDays} 个自然日计算，日均约 ${formatAmount(statistics.averageDailyExpense)}。`
  }

  if (intents.includes('largest') && statistics.largestExpense) {
    const row = statistics.largestExpense
    return `${focus.period.label}「${label}」最高的一笔是 ${formatAmount(row.amount)}，发生在 ${row.date}，记录为「${row.note || row.subcategory || row.category}」。`
  }

  if (intents.includes('trend') && statistics.monthlyTotals.length > 0) {
    const details = statistics.monthlyTotals
      .map((item) => `${item.month} ${formatAmount(item.amount)}（${item.count} 笔）`)
      .join('、')
    return `${focus.period.label}「${label}」的月度情况是：${details}。`
  }

  const completenessText = completeness.isComplete ? '' : `，当前明细上下文包含其中 ${completeness.includedCount} 笔`
  return `${focus.period.label}「${label}」共消费 ${formatAmount(statistics.totalExpense)}，合计 ${statistics.expenseCount} 笔${completenessText}。`
}

function answerTransactionInsightLocally(text: string, transactions: Transaction[]) {
  const expenseRows = transactions.filter((row) => row.type === 'expense')
  const currentMonth = monthKeyFromOffset(0)
  const lastMonth = monthKeyFromOffset(-1)

  if (/(这个月|本月|当月)/.test(text) && /(日均|平均每天|每天平均)/.test(text)) {
    const monthRows = expenseRows.filter((row) => row.transaction_date.startsWith(currentMonth))
    const categoryNames = Array.from(new Set(monthRows.map((row) => row.category)))
      .sort((a, b) => b.length - a.length)
    const subcategoryNames = Array.from(
      new Set(monthRows.map((row) => row.subcategory?.trim()).filter((item): item is string => Boolean(item))),
    ).sort((a, b) => b.length - a.length)
    const category = categoryNames.find((item) => text.includes(item))
    const subcategory = category ? null : subcategoryNames.find((item) => text.includes(item))
    const matchedRows = category
      ? monthRows.filter((row) => row.category === category)
      : subcategory
        ? monthRows.filter((row) => row.subcategory === subcategory)
        : []
    const label = category ?? subcategory
    if (label) {
      const total = matchedRows.reduce((sum, row) => sum + row.amount, 0)
      const calendarDays = daysInCalendarMonth(currentMonth)
      return `这个月「${label}」消费合计 ${formatAmount(total)}，共 ${matchedRows.length} 笔。按本月 ${calendarDays} 个自然日计算，日均约 ${formatAmount(total / calendarDays)}。`
    }
  }

  if (/(这个月|本月|当月).*(最高|最大|最贵|高消费)|最高.*(这个月|本月|当月)/.test(text)) {
    const rows = expenseRows.filter((row) => row.transaction_date.startsWith(currentMonth))
    const largest = [...rows].sort((a, b) => b.amount - a.amount)[0]
    if (!largest) {
      return `小猪查理翻了一下，这个月还没有支出记录，所以暂时没有“最高的一笔”。`
    }
    const label = largest.note || largest.subcategory || largest.category
    return `这个月目前最高的一笔是 ${formatAmount(largest.amount)}，${largest.transaction_date} 的「${label}」，分类是 ${largest.subcategory ? `${largest.category} / ${largest.subcategory}` : largest.category}。小猪查理已经帮你揪出来啦。`
  }

  if (/(上个月|上月).*(总额|一共|总共|花了多少|消费多少)/.test(text)) {
    const rows = expenseRows.filter((row) => row.transaction_date.startsWith(lastMonth))
    const summary = summarizeExpenseRows(rows)
    if (summary.count === 0) {
      return `小猪查理看了下，上个月还没有支出记录，所以总额暂时是 ${formatAmount(0)}。`
    }
    const top = summary.topCategories[0]
    return `上个月你一共花了 ${formatAmount(summary.total)}，共 ${summary.count} 笔。花得最多的是「${top.category}」${formatAmount(top.amount)}。`
  }

  if (/(半年|6\s*个月|六个月).*(趋势|分析|走势|变化)/.test(text)) {
    const months = Array.from({ length: 6 }, (_, index) => monthKeyFromOffset(index - 5))
    const monthly = months.map((month) => {
      const rows = expenseRows.filter((row) => row.transaction_date.startsWith(month))
      return {
        month,
        total: rows.reduce((sum, row) => sum + row.amount, 0),
        count: rows.length,
      }
    })
    const active = monthly.filter((item) => item.count > 0)
    if (active.length === 0) {
      return '小猪查理看了看，近半年还没有足够的支出记录，先多记几笔，我再帮你看趋势。'
    }
    const highest = [...active].sort((a, b) => b.total - a.total)[0]
    const lowest = [...active].sort((a, b) => a.total - b.total)[0]
    const average = active.reduce((sum, item) => sum + item.total, 0) / active.length
    const direction = active.length >= 2
      ? active[active.length - 1].total > active[0].total
        ? '整体有上升趋势'
        : active[active.length - 1].total < active[0].total
          ? '整体有下降趋势'
          : '整体比较平稳'
      : '数据还比较少'
    return `近半年有记录的月份里，月均支出约 ${formatAmount(average)}，${direction}。最高是 ${highest.month}：${formatAmount(highest.total)}；最低是 ${lowest.month}：${formatAmount(lowest.total)}。小猪查理建议你重点看看最高那个月发生了什么。`
  }

  return null
}

function looksLikeAccountingIntent(text: string, drafts: ChatDraft[], categories: string[]) {
  if (/(值不值|该不该|要不要|能买吗|推荐|比较|怎么选|多少合适|给我.*计划|帮我.*分析)/.test(text) && !/(记账|记一笔|新增账单|添加账单)/.test(text)) {
    return false
  }
  if (drafts.length > 0 && /(刚才|这笔|那笔|第\s*[一二两三四五六七八九十\d]+\s*笔|改|删|删除|取消|换成|金额|日期|备注)/.test(text)) {
    return true
  }
  if (/(记账|记一笔|新增|添加|花了|买了|吃了|喝了|消费了|支出了|付款|打车|报销)/.test(text)) {
    return true
  }
  if (/\d+(?:\.\d+)?\s*(?:元|块|块钱|人民币)?/.test(text) && categories.some((item) => text.includes(item))) {
    return true
  }
  if (/(早餐|午饭|午餐|晚饭|晚餐|夜宵|奶茶|咖啡|打车|地铁|公交|停车|加油|买菜|外卖|电影|房租|水电|话费)\D{0,10}\d+(?:\.\d+)?/.test(text)) {
    return true
  }
  return false
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') {
    return false
  }
  const item = value as Partial<ChatMessage>
  return (
    typeof item.id === 'string' &&
    (item.role === 'assistant' || item.role === 'user') &&
    typeof item.text === 'string'
  )
}

function isChatDraft(value: unknown): value is ChatDraft {
  if (!value || typeof value !== 'object') {
    return false
  }
  const item = value as Partial<ChatDraft>
  return (
    typeof item.id === 'string' &&
    item.type === 'expense' &&
    typeof item.amount === 'string' &&
    typeof item.category === 'string' &&
    typeof item.subcategory === 'string' &&
    typeof item.transaction_date === 'string' &&
    typeof item.note === 'string'
  )
}

function readSavedChatSession(): SavedChatSession {
  if (typeof window === 'undefined') {
    return { messages: INITIAL_CHAT_MESSAGES, drafts: [] }
  }

  try {
    const raw = window.localStorage.getItem(CHAT_ACCOUNTING_STORAGE_KEY)
    if (!raw) {
      return { messages: INITIAL_CHAT_MESSAGES, drafts: [] }
    }
    const parsed = JSON.parse(raw) as Partial<SavedChatSession>
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter(isChatMessage)
      : []
    const drafts = Array.isArray(parsed.drafts)
      ? parsed.drafts.filter(isChatDraft)
      : []
    return {
      messages: messages.length > 0 ? messages : INITIAL_CHAT_MESSAGES,
      drafts,
    }
  } catch {
    return { messages: INITIAL_CHAT_MESSAGES, drafts: [] }
  }
}

function saveChatSession(session: SavedChatSession) {
  try {
    window.localStorage.setItem(CHAT_ACCOUNTING_STORAGE_KEY, JSON.stringify(session))
  } catch {
    // Local storage may be unavailable; the chat should still work.
  }
}

export function ChatAccountingPage() {
  const {
    transactions,
    categoryOptions,
    subcategoryOptions,
    saveTransactionsFromDrafts,
    formatMoney,
    isLoading,
    setMessage,
    loadTransactionsByDateRange,
    loadAllTransactions,
  } = useAccounting()
  const [savedSession] = useState(() => readSavedChatSession())
  const [inputMode, setInputMode] = useState<InputMode>('text')
  const [textInput, setTextInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>(savedSession.messages)
  const [drafts, setDrafts] = useState<ChatDraft[]>(savedSession.drafts)
  const [isParsing, setIsParsing] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceStopping, setVoiceStopping] = useState(false)
  const [chatError, setChatError] = useState('')
  const [insightTransactions, setInsightTransactions] = useState<Transaction[]>(transactions)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const transcriptRef = useRef('')
  const shouldApplyVoiceRef = useRef(false)
  const latestMessageRef = useRef<HTMLElement | null>(null)

  const expenseOptions = categoryOptions('expense')
  const subcategoryMap = useMemo(
    () => Object.fromEntries(expenseOptions.map((category) => [category, subcategoryOptions(category)])),
    [expenseOptions, subcategoryOptions],
  )
  const baseTransactionContext = useMemo(
    () => buildTransactionInsightContext(insightTransactions),
    [insightTransactions],
  )

  useEffect(() => {
    let cancelled = false
    const loadInsightTransactions = async () => {
      try {
        const rows = await loadTransactionsByDateRange(recentMonthsDateRange(6))
        if (!cancelled) {
          setInsightTransactions(rows)
        }
      } catch {
        if (!cancelled) {
          setInsightTransactions(transactions)
        }
      }
    }
    void loadInsightTransactions()
    return () => {
      cancelled = true
    }
  }, [loadTransactionsByDateRange, transactions])

  useEffect(() => {
    return () => recognitionRef.current?.abort()
  }, [])

  useEffect(() => {
    saveChatSession({ messages, drafts })
  }, [drafts, messages])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      latestMessageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isParsing, messages.length])

  useEffect(() => {
    if (!chatError) {
      return
    }
    const timer = window.setTimeout(() => setChatError(''), 3000)
    return () => window.clearTimeout(timer)
  }, [chatError])

  const addMessage = (role: ChatMessage['role'], text: string) => {
    setMessages((items) => [...items, { id: makeId(role), role, text }])
  }

  const parseExpenseText = async (rawText: string) => {
    const text = rawText.trim()
    if (!text) {
      return
    }
    addMessage('user', text)
    setIsParsing(true)
    setChatError('')
    try {
      const recentMessages = messages.slice(-20).map((message) => ({
        role: message.role,
        text: message.text,
      }))
      let focusedQuery: FocusedTransactionQuery | null = null
      let transactionContext: unknown = baseTransactionContext
      if (looksLikeLedgerQuestion(text, messages, expenseOptions, subcategoryMap)) {
        const period = inferChatQueryPeriod(text, messages)
        let queryRows: Transaction[]
        try {
          queryRows = period.allHistory
            ? await loadAllTransactions()
            : await loadTransactionsByDateRange(period.range as TransactionDateRange)
        } catch {
          queryRows = period.range
            ? insightTransactions.filter(
                (row) =>
                  row.transaction_date >= period.range!.startDate &&
                  row.transaction_date < period.range!.endDate,
              )
            : insightTransactions
        }
        focusedQuery = buildFocusedTransactionQuery({
          text,
          messages,
          rows: queryRows,
          period,
          categories: expenseOptions,
          subcategoryMap,
        })
        transactionContext = {
          generatedAt: baseTransactionContext.generatedAt,
          currentDate: baseTransactionContext.currentDate,
          currentMonth: baseTransactionContext.currentMonth,
          lastMonth: baseTransactionContext.lastMonth,
          recentSixMonths: baseTransactionContext.recentSixMonths,
          focusedQuery,
        }
      }
      const accountingIntent = looksLikeAccountingIntent(text, drafts, expenseOptions)
      if (accountingIntent) {
        const chatResult = await parseChatAccountingTurnWithTokenhub({
          text,
          categories: expenseOptions,
          subcategoryMap,
          currentDrafts: drafts,
          recentMessages,
          transactionContext,
        })
        if (chatResult) {
          setDrafts(
            chatResult.drafts.map((draft) => ({
              ...draft,
              id: draft.id || makeId('draft'),
              subcategory: draft.subcategory || '',
            })),
          )
          addMessage('assistant', chatResult.reply)
          return
        }
      }

      const conversation = await chatWithCharlieTokenhub({
        text,
        categories: expenseOptions,
        subcategoryMap,
        currentDrafts: drafts,
        recentMessages,
        transactionContext,
      })
      if (conversation) {
        addMessage('assistant', conversation.reply)
        return
      }

      const retryConversation = await chatWithCharlieTokenhub({
        text,
        categories: expenseOptions,
        subcategoryMap,
        currentDrafts: drafts,
        recentMessages: recentMessages.slice(-6),
        transactionContext: focusedQuery ? { focusedQuery } : undefined,
      })
      if (retryConversation) {
        addMessage('assistant', retryConversation.reply)
        return
      }

      if (focusedQuery) {
        addMessage('assistant', answerFocusedQueryLocally(focusedQuery))
        return
      }

      const localInsightReply = answerTransactionInsightLocally(text, insightTransactions)
      if (localInsightReply) {
        addMessage('assistant', localInsightReply)
        return
      }

      const contextualUpdate = fallbackUpdateDraftsFromContext(text, drafts, expenseOptions, subcategoryMap)
      if (contextualUpdate) {
        setDrafts(contextualUpdate.drafts)
        addMessage('assistant', contextualUpdate.reply)
        return
      }

      const parsed = fallbackDraftsFromText(text, expenseOptions, subcategoryMap)
      if (parsed.length === 0) {
        addMessage(
          'assistant',
          drafts.length > 0
            ? '小猪查理有点没对上号，你想改哪一笔呀？可以说“把麦当劳改成正餐”或“第二笔改成交通”。'
            : '我刚刚没能完整处理这句话。你可以换个说法再发一次，我会直接回答，不让你重新解释一大段。',
        )
        return
      }
      const nextDrafts = parsed.map((draft) => ({
        ...draft,
        id: makeId('draft'),
        subcategory: draft.subcategory || '',
      }))
      setDrafts((items) => [...items, ...nextDrafts])
      addMessage('assistant', `小猪查理先帮你整理出 ${nextDrafts.length} 笔，看看对不对。不对的话，直接告诉我怎么改就行。`)
    } catch (parseError) {
      addMessage('assistant', '刚才小猪查理有点走神了，可以换个说法再发一次，我继续陪你聊。')
      setChatError(parseError instanceof Error ? parseError.message : 'AI 整理失败')
    } finally {
      setIsParsing(false)
    }
  }

  const submitText = () => {
    const text = textInput.trim()
    if (!text || isParsing) {
      return
    }
    setTextInput('')
    void parseExpenseText(text)
  }

  const startVoice = async () => {
    const SpeechRecognition =
      (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setChatError('当前浏览器暂不支持语音输入，可以先切换到文字输入')
      return
    }
    try {
      await ensureMicrophonePermission()
    } catch {
      setChatError('请允许麦克风权限后再试')
      return
    }

    recognitionRef.current?.abort()
    transcriptRef.current = ''
    shouldApplyVoiceRef.current = false
    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    recognition.lang = 'zh-CN'
    recognition.interimResults = false
    recognition.continuous = true
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition) {
        return
      }
      const result = event.results[event.resultIndex]?.[0]?.transcript?.trim()
      if (result) {
        transcriptRef.current = `${transcriptRef.current} ${result}`.trim()
      }
    }
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition || event.error === 'aborted') {
        return
      }
      setChatError(event.error === 'not-allowed' ? '请允许麦克风权限后再试' : '语音识别失败，请再试一次')
      setVoiceListening(false)
      setVoiceStopping(false)
    }
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) {
        return
      }
      const shouldApply = shouldApplyVoiceRef.current
      const transcript = transcriptRef.current.trim()
      recognitionRef.current = null
      shouldApplyVoiceRef.current = false
      setVoiceListening(false)
      setVoiceStopping(false)
      if (!shouldApply) {
        return
      }
      if (!transcript) {
        setChatError('没有听清楚，请再试一次')
        return
      }
      void parseExpenseText(transcript)
    }
    setChatError('')
    setVoiceListening(true)
    setVoiceStopping(false)
    try {
      recognition.start()
    } catch {
      setVoiceListening(false)
      setChatError('语音识别启动失败，请稍后再试')
    }
  }

  const stopVoice = () => {
    shouldApplyVoiceRef.current = true
    setVoiceStopping(true)
    try {
      recognitionRef.current?.stop()
    } catch {
      setVoiceListening(false)
      setVoiceStopping(false)
      setChatError('语音识别结束失败，请再试一次')
    }
  }

  const cancelVoice = () => {
    shouldApplyVoiceRef.current = false
    transcriptRef.current = ''
    setVoiceListening(false)
    setVoiceStopping(false)
    recognitionRef.current?.abort()
  }

  const updateDraft = (id: string, patch: Partial<ChatDraft>) => {
    setDrafts((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const deleteDraft = (id: string) => {
    setDrafts((items) => items.filter((item) => item.id !== id))
  }

  const confirmDrafts = async () => {
    if (drafts.length === 0) {
      setChatError('还没有可以保存的账单')
      return
    }
    await saveTransactionsFromDrafts(drafts.map(({ id, ...draft }) => {
      void id
      return draft
    }))
    addMessage('assistant', `好嘞，${drafts.length} 笔已经记好，小猪查理收工一小会儿。`)
    setDrafts([])
    setMessage(`已保存 ${drafts.length} 笔账单`)
  }

  return (
    <main className="chat-accounting-shell">
      <section className="chat-accounting-page" aria-label="和查理记账">
        <header className="chat-accounting-header">
          <Link className="chat-accounting-back" to="/ledger" aria-label="返回首页">
            <span aria-hidden>←</span>
          </Link>
          <div className="chat-accounting-title">
            <img className="chat-title-ip-head" src="/chat-pig-head.png" alt="" />
            <h1>小猪查理</h1>
          </div>
        </header>

      <div className="chat-accounting-messages" aria-live="polite">
        {messages.map((message, index) => (
          <article
            key={message.id}
            ref={!isParsing && index === messages.length - 1 ? latestMessageRef : undefined}
            className={`chat-message chat-message--${message.role}`}
          >
            <p>{message.text}</p>
          </article>
        ))}
        {isParsing && (
          <article ref={latestMessageRef} className="chat-message chat-message--assistant">
            <p>小猪查理正在整理…</p>
          </article>
        )}
      </div>

      {drafts.length > 0 && (
        <section className="chat-draft-panel" aria-label="待确认账单">
          <div className="chat-draft-panel-head">
            <div>
              <h2>待确认支出</h2>
              <p className="muted small">可以直接改金额、分类、日期或备注。</p>
            </div>
            <button className="primary-button" type="button" onClick={confirmDrafts} disabled={isLoading || isParsing}>
              保存这 {drafts.length} 笔
            </button>
          </div>
          <div className="chat-draft-list">
            {drafts.map((draft) => {
              const subcategories = subcategoryOptions(draft.category)
              return (
                <article className="chat-draft-card" key={draft.id}>
                  <div className="chat-draft-amount-row">
                    <label>
                      金额
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        value={draft.amount}
                        onChange={(event) => updateDraft(draft.id, { amount: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="chat-draft-category-row">
                    <label>
                      分类
                      <select
                        value={draft.category}
                        onChange={(event) => {
                          const category = event.target.value
                          updateDraft(draft.id, {
                            category,
                            subcategory: subcategoryOptions(category)[0] ?? '',
                          })
                        }}
                      >
                        {expenseOptions.map((category) => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      子类
                      <select
                        value={draft.subcategory}
                        onChange={(event) => updateDraft(draft.id, { subcategory: event.target.value })}
                      >
                        <option value="">不选</option>
                        {subcategories.map((subcategory) => (
                          <option key={subcategory} value={subcategory}>{subcategory}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="chat-draft-meta-row">
                    <label>
                      日期
                      <input
                        type="date"
                        value={draft.transaction_date}
                        onChange={(event) => updateDraft(draft.id, { transaction_date: event.target.value })}
                      />
                    </label>
                    <label>
                      备注
                      <input
                        value={draft.note}
                        onChange={(event) => updateDraft(draft.id, { note: event.target.value })}
                        placeholder="消费内容"
                      />
                    </label>
                  </div>
                  <div className="chat-draft-footer">
                    <span>{formatMoney(Number(draft.amount) || 0)} · {draft.transaction_date}</span>
                    <button className="secondary-button" type="button" onClick={() => deleteDraft(draft.id)}>
                      删除
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {chatError && <p className="chat-accounting-error" role="alert">{chatError}</p>}

      <footer className="chat-composer">
        <button
          className="chat-mode-toggle"
          type="button"
          onClick={() => setInputMode(inputMode === 'text' ? 'voice' : 'text')}
          aria-label={inputMode === 'text' ? '切换到语音输入' : '切换到手写输入'}
        >
          {inputMode === 'text' ? (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
              <path d="M18 10.5a6 6 0 0 1-12 0" />
              <path d="M12 16.5V21" />
              <path d="M9 21h6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M4 7.5h16v9H4z" />
              <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 13.5h8" />
            </svg>
          )}
        </button>

        {inputMode === 'text' ? (
          <>
            <textarea
              value={textInput}
              onChange={(event) => setTextInput(event.target.value)}
              placeholder="说说今天花了什么"
              rows={1}
            />
            <button className="chat-send-button" type="button" onClick={submitText} disabled={!textInput.trim() || isParsing}>
              发送
            </button>
          </>
        ) : (
          <>
            <button
              className={`chat-voice-button${voiceListening ? ' recording' : ''}`}
              type="button"
              onClick={voiceListening ? stopVoice : startVoice}
              disabled={voiceStopping || isParsing}
            >
              {voiceStopping ? '识别中...' : voiceListening ? '点击结束并整理' : '点击说话'}
            </button>
            {voiceListening && (
              <button className="chat-send-button chat-send-button--secondary" type="button" onClick={cancelVoice}>
                取消
              </button>
            )}
          </>
        )}
      </footer>
      </section>
    </main>
  )
}
