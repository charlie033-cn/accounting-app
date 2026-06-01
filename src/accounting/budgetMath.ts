import { currentMonth, todayISO } from './constants'
import { daysInCalendarMonth } from './format'

export function remainingBudgetDays(period: string): number {
  const days = daysInCalendarMonth(period)
  if (days <= 0) {
    return 0
  }

  if (period !== currentMonth()) {
    return days
  }

  const dayOfMonth = Number(todayISO().slice(8, 10))
  if (!Number.isFinite(dayOfMonth)) {
    return days
  }

  return Math.max(1, days - dayOfMonth + 1)
}

export function dynamicDailyBudget(period: string, budgetAmount: number | null, monthExpenseTotal: number): number | null {
  if (budgetAmount == null || budgetAmount <= 0) {
    return null
  }

  const days = remainingBudgetDays(period)
  if (days <= 0) {
    return null
  }

  return (budgetAmount - monthExpenseTotal) / days
}
