import type { Transaction } from '../types/transaction'

export type SpendingReportCategory = {
  category: string
  amount: number
  count: number
  percent: number
}

export type SpendingReportSummary = {
  periodLabel: string
  transactionCount: number
  expenseCount: number
  incomeCount: number
  totalExpense: number
  totalIncome: number
  balance: number
  averageDailyExpense: number
  maxExpense: Transaction | null
  topExpenseDay: { date: string; amount: number } | null
  topCategories: SpendingReportCategory[]
  localHighlights: string[]
  localSuggestions: string[]
}

function money(amount: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(amount)
}

function uniqueDayCount(rows: Transaction[]) {
  const days = new Set(rows.map((row) => row.transaction_date))
  return Math.max(1, days.size)
}

export function buildSpendingReportSummary(
  rows: Transaction[],
  periodLabel: string,
): SpendingReportSummary {
  const expenses = rows.filter((row) => row.type === 'expense')
  const incomes = rows.filter((row) => row.type === 'income')
  const totalExpense = expenses.reduce((sum, row) => sum + row.amount, 0)
  const totalIncome = incomes.reduce((sum, row) => sum + row.amount, 0)
  const categoryMap = new Map<string, { amount: number; count: number }>()
  const dayMap = new Map<string, number>()

  for (const row of expenses) {
    const category = categoryMap.get(row.category) ?? { amount: 0, count: 0 }
    category.amount += row.amount
    category.count += 1
    categoryMap.set(row.category, category)
    dayMap.set(row.transaction_date, (dayMap.get(row.transaction_date) ?? 0) + row.amount)
  }

  const topCategories = Array.from(categoryMap.entries())
    .map(([category, value]) => ({
      category,
      amount: value.amount,
      count: value.count,
      percent: totalExpense > 0 ? (value.amount / totalExpense) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)

  const maxExpense = expenses
    .slice()
    .sort((a, b) => b.amount - a.amount)[0] ?? null
  const topExpenseDayEntry = Array.from(dayMap.entries()).sort((a, b) => b[1] - a[1])[0]
  const topExpenseDay = topExpenseDayEntry
    ? { date: topExpenseDayEntry[0], amount: topExpenseDayEntry[1] }
    : null
  const averageDailyExpense = totalExpense / uniqueDayCount(expenses)

  const localHighlights: string[] = []
  if (totalExpense > 0) {
    localHighlights.push(`${periodLabel}支出 ${money(totalExpense)}，共 ${expenses.length} 笔。`)
  }
  if (topCategories[0]) {
    localHighlights.push(
      `${topCategories[0].category}占比最高，占 ${topCategories[0].percent.toFixed(0)}%。`,
    )
  }
  if (maxExpense) {
    localHighlights.push(
      `最大单笔为 ${maxExpense.note || maxExpense.category}，${money(maxExpense.amount)}。`,
    )
  }
  if (topExpenseDay) {
    localHighlights.push(`${topExpenseDay.date} 支出最高，合计 ${money(topExpenseDay.amount)}。`)
  }

  const localSuggestions: string[] = []
  if (topCategories[0] && topCategories[0].percent >= 40) {
    localSuggestions.push(`关注${topCategories[0].category}支出，占比已超过 40%。`)
  }
  if (averageDailyExpense > 0) {
    localSuggestions.push(`当前日均支出约 ${money(averageDailyExpense)}，可作为后续预算参考。`)
  }
  if (localSuggestions.length === 0 && totalExpense > 0) {
    localSuggestions.push('本期消费结构较分散，可继续保持记录习惯。')
  }

  return {
    periodLabel,
    transactionCount: rows.length,
    expenseCount: expenses.length,
    incomeCount: incomes.length,
    totalExpense,
    totalIncome,
    balance: totalIncome - totalExpense,
    averageDailyExpense,
    maxExpense,
    topExpenseDay,
    topCategories,
    localHighlights,
    localSuggestions,
  }
}

export function spendingReportPayload(summary: SpendingReportSummary) {
  return {
    periodLabel: summary.periodLabel,
    transactionCount: summary.transactionCount,
    expenseCount: summary.expenseCount,
    incomeCount: summary.incomeCount,
    totalExpense: summary.totalExpense,
    totalIncome: summary.totalIncome,
    balance: summary.balance,
    averageDailyExpense: summary.averageDailyExpense,
    maxExpense: summary.maxExpense
      ? {
          amount: summary.maxExpense.amount,
          category: summary.maxExpense.category,
          date: summary.maxExpense.transaction_date,
          note: summary.maxExpense.note,
        }
      : null,
    topExpenseDay: summary.topExpenseDay,
    topCategories: summary.topCategories,
  }
}
