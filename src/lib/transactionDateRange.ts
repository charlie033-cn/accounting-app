import type { TransactionDateRange } from './transactionQueries'

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function dayDateRange(day: string): TransactionDateRange {
  const next = new Date(`${day}T00:00:00`)
  next.setDate(next.getDate() + 1)
  return { startDate: day, endDate: formatLocalDate(next) }
}

export function monthDateRange(month: string): TransactionDateRange {
  const [year, value] = month.split('-').map(Number)
  const next = new Date(year, value, 1)
  return {
    startDate: `${year}-${String(value).padStart(2, '0')}-01`,
    endDate: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`,
  }
}

export function yearDateRange(year: string): TransactionDateRange {
  const value = Number(year)
  return {
    startDate: `${value}-01-01`,
    endDate: `${value + 1}-01-01`,
  }
}

export function recentMonthsDateRange(monthCount: number): TransactionDateRange {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - Math.max(0, monthCount - 1), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
  }
}
