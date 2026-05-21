export const formatMoney = (amount: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(amount)

/** 自然月天数，用于「月总预算 ÷ 天数」的日均参考 */
export const daysInCalendarMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) {
    return 30
  }
  return new Date(y, m, 0).getDate()
}
