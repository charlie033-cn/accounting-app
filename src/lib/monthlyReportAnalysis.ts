import { daysInCalendarMonth } from '../accounting/format'
import type { Transaction } from '../types/transaction'
import { buildSpendingReportSummary, spendingReportPayload } from './spendingReport'
import type { TransactionDateRange } from './transactionQueries'

export type MonthlyReportAiContext = {
  reportScope: {
    reportMonth: string
    primaryStatisticsRule: string
    historicalDataRule: string
  }
  selectedMonth: {
    summary: ReturnType<typeof spendingReportPayload>
    periodProgress: {
      isCurrentMonth: boolean
      elapsedDays: number
      totalDays: number
      comparisonBasis: string
    }
    activity: {
      activeDays: number
      noExpenseDays: number
      recurringExpense: number
      recurringCount: number
      topExpenseDays: Array<{ date: string; amount: number; count: number }>
    }
    representativeExpenses: Array<{
      date: string
      amount: number
      category: string
      subcategory: string
      note: string
      recurring: boolean
    }>
    repeatedPatterns: Array<{
      label: string
      count: number
      totalAmount: number
    }>
  }
  comparisonReference: {
    previousMonths: Array<{
      month: string
      totalExpense: number
      expenseCount: number
      averageDailyExpense: number
      topCategories: Array<{
        category: string
        amount: number
        percent: number
      }>
    }>
    comparison: {
      previousMonthChangePercent: number | null
      recentAverageChangePercent: number | null
      categoryChanges: Array<{
        category: string
        currentAmount: number
        previousAmount: number
        changeAmount: number
      }>
    }
  }
}

function monthParts(month: string) {
  const [year, value] = month.split('-').map(Number)
  return { year, value }
}

export function shiftMonth(month: string, offset: number) {
  const { year, value } = monthParts(month)
  const date = new Date(year, value - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function monthlyReportHistoryDateRange(
  month: string,
  previousMonthCount = 3,
): TransactionDateRange {
  const startMonth = shiftMonth(month, -Math.max(0, previousMonthCount))
  const endMonth = shiftMonth(month, 1)
  return {
    startDate: `${startMonth}-01`,
    endDate: `${endMonth}-01`,
  }
}

function expenseRows(rows: Transaction[], month: string) {
  return rows.filter(
    (row) => row.type === 'expense' && row.transaction_date.startsWith(`${month}-`),
  )
}

function localMonth(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function rowsThroughDay(rows: Transaction[], day: number) {
  return rows.filter((row) => Number(row.transaction_date.slice(8, 10)) <= day)
}

function categoryAmounts(rows: Transaction[]) {
  const totals = new Map<string, number>()
  for (const row of rows) {
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.amount)
  }
  return totals
}

function percentChange(current: number, baseline: number) {
  if (baseline <= 0) {
    return null
  }
  return ((current - baseline) / baseline) * 100
}

function normalizedPatternLabel(row: Transaction) {
  const note = row.note?.trim().replace(/\s+/g, ' ')
  if (note && note.length >= 2) {
    return note.slice(0, 48)
  }
  return row.subcategory?.trim() || row.category
}

export function buildMonthlyReportAiContext(
  rows: Transaction[],
  month: string,
): MonthlyReportAiContext {
  const today = new Date()
  const isCurrentMonth = month === localMonth(today)
  const totalDays = daysInCalendarMonth(month)
  const elapsedDays = isCurrentMonth ? Math.min(today.getDate(), totalDays) : totalDays
  const currentRows = rowsThroughDay(expenseRows(rows, month), elapsedDays)
  const currentSummary = buildSpendingReportSummary(currentRows, month)
  const previousMonths = [1, 2, 3].map((offset) => {
    const value = shiftMonth(month, -offset)
    const comparisonDay = Math.min(elapsedDays, daysInCalendarMonth(value))
    const periodRows = rowsThroughDay(expenseRows(rows, value), comparisonDay)
    const summary = buildSpendingReportSummary(periodRows, value)
    return {
      month: value,
      totalExpense: summary.totalExpense,
      expenseCount: summary.expenseCount,
      averageDailyExpense: summary.averageDailyExpense,
      topCategories: summary.topCategories.slice(0, 3).map((item) => ({
        category: item.category,
        amount: item.amount,
        percent: item.percent,
      })),
    }
  })

  const previousMonthValue = shiftMonth(month, -1)
  const previousMonthRows = rowsThroughDay(
    expenseRows(rows, previousMonthValue),
    Math.min(elapsedDays, daysInCalendarMonth(previousMonthValue)),
  )
  const previousCategoryAmounts = categoryAmounts(previousMonthRows)
  const currentCategoryAmounts = categoryAmounts(currentRows)
  const categoryNames = new Set([
    ...currentCategoryAmounts.keys(),
    ...previousCategoryAmounts.keys(),
  ])
  const categoryChanges = Array.from(categoryNames)
    .map((category) => {
      const currentAmount = currentCategoryAmounts.get(category) ?? 0
      const previousAmount = previousCategoryAmounts.get(category) ?? 0
      return {
        category,
        currentAmount,
        previousAmount,
        changeAmount: currentAmount - previousAmount,
      }
    })
    .sort((a, b) => Math.abs(b.changeAmount) - Math.abs(a.changeAmount))
    .slice(0, 5)

  const recentTotals = previousMonths.map((item) => item.totalExpense).filter((value) => value > 0)
  const recentAverage = recentTotals.length
    ? recentTotals.reduce((sum, value) => sum + value, 0) / recentTotals.length
    : 0

  const dayMap = new Map<string, { amount: number; count: number }>()
  const patternMap = new Map<string, { count: number; totalAmount: number }>()
  let recurringExpense = 0
  let recurringCount = 0
  for (const row of currentRows) {
    const day = dayMap.get(row.transaction_date) ?? { amount: 0, count: 0 }
    day.amount += row.amount
    day.count += 1
    dayMap.set(row.transaction_date, day)

    const label = normalizedPatternLabel(row)
    const pattern = patternMap.get(label) ?? { count: 0, totalAmount: 0 }
    pattern.count += 1
    pattern.totalAmount += row.amount
    patternMap.set(label, pattern)

    if (row.source === 'recurring' || row.recurring_template_id) {
      recurringExpense += row.amount
      recurringCount += 1
    }
  }

  const representativeExpenses = currentRows
    .slice()
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12)
    .map((row) => ({
      date: row.transaction_date,
      amount: row.amount,
      category: row.category,
      subcategory: row.subcategory?.trim() || '',
      note: row.note?.trim().slice(0, 80) || '',
      recurring: row.source === 'recurring' || Boolean(row.recurring_template_id),
    }))

  const repeatedPatterns = Array.from(patternMap.entries())
    .filter(([, value]) => value.count >= 2)
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 8)

  return {
    reportScope: {
      reportMonth: month,
      primaryStatisticsRule: `所有“本月”笔数、金额、日均、分类占比和账单明细只统计 ${month}`,
      historicalDataRule: '历史月份只允许用于环比和趋势对比，不得并入所选月份统计',
    },
    selectedMonth: {
      summary: spendingReportPayload(currentSummary),
      periodProgress: {
        isCurrentMonth,
        elapsedDays,
        totalDays,
        comparisonBasis: isCurrentMonth
          ? `当前月截至第 ${elapsedDays} 天，与历史月份同期比较`
          : '完整自然月比较',
      },
      activity: {
        activeDays: dayMap.size,
        noExpenseDays: Math.max(0, elapsedDays - dayMap.size),
        recurringExpense,
        recurringCount,
        topExpenseDays: Array.from(dayMap.entries())
          .map(([date, value]) => ({ date, ...value }))
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5),
      },
      representativeExpenses,
      repeatedPatterns,
    },
    comparisonReference: {
      previousMonths,
      comparison: {
        previousMonthChangePercent: percentChange(
          currentSummary.totalExpense,
          previousMonths[0]?.totalExpense ?? 0,
        ),
        recentAverageChangePercent: percentChange(currentSummary.totalExpense, recentAverage),
        categoryChanges,
      },
    },
  }
}
