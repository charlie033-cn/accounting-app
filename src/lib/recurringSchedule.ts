/**
 * 账期日对齐：实际记账日 = min(设定日号, 当月最后一天)
 * 返回该月内的 `YYYY-MM-DD`
 */
export function effectiveBillingDateISO(periodYYYYMM: string, dayOfMonth: number): string {
  const [y, m] = periodYYYYMM.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) {
    return periodYYYYMM + '-01'
  }
  const last = new Date(y, m, 0).getDate()
  const d = Math.min(Math.max(1, Math.floor(dayOfMonth)), last)
  const mm = String(m).padStart(2, '0')
  const dd = String(d).padStart(2, '0')
  return `${y}-${mm}-${dd}`
}

/** start_period 与 current_period 均为 YYYY-MM，返回从起始月到当前月的 0-based 月数差 */
export function monthIndexFromStart(startPeriod: string, currentPeriod: string): number {
  const [sy, sm] = startPeriod.split('-').map(Number)
  const [cy, cm] = currentPeriod.split('-').map(Number)
  if (!sy || !sm || !cy || !cm) {
    return -1
  }
  return (cy - sy) * 12 + (cm - sm)
}

export function splitRecurringAmount(totalAmount: number, durationMonths: number, index: number): number {
  if (!Number.isFinite(totalAmount) || !Number.isFinite(durationMonths) || durationMonths <= 0) {
    return 0
  }
  const totalCents = Math.round(totalAmount * 100)
  const months = Math.max(1, Math.floor(durationMonths))
  const normalizedIndex = Math.max(0, Math.floor(index))
  const baseCents = Math.floor(totalCents / months)
  const remainder = totalCents % months
  return (baseCents + (normalizedIndex < remainder ? 1 : 0)) / 100
}

export function recurringAmountForPeriod(
  template: {
    amount: number
    total_amount?: number | null
    start_period: string
    duration_months: number
  },
  periodYYYYMM: string,
): number {
  const total = Number(template.total_amount)
  if (!Number.isFinite(total) || total <= 0) {
    return Number(template.amount)
  }
  const idx = monthIndexFromStart(template.start_period, periodYYYYMM)
  return splitRecurringAmount(total, template.duration_months, idx)
}

/** 当前月是否仍在本模板持续范围内，且已到达或超过开始月 */
export function isTemplateActiveInPeriod(
  template: { start_period: string; duration_months: number; status: string },
  periodYYYYMM: string,
): boolean {
  if (template.status !== 'active') {
    return false
  }
  const idx = monthIndexFromStart(template.start_period, periodYYYYMM)
  return idx >= 0 && idx < template.duration_months
}
