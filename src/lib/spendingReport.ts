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
  totalExpense: number
  averageDailyExpense: number
  maxExpense: Transaction | null
  topExpenseDay: { date: string; amount: number } | null
  topCategories: SpendingReportCategory[]
  localHighlights: string[]
  localSuggestions: string[]
  charlieDiagnosis: string
  charlieFindings: string[]
  charlieProfile: {
    title: string
    description: string
    metrics: string[]
  }
  charlieStrategies: string[]
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

function isCategory(row: Transaction, keywords: string[]) {
  const text = `${row.category} ${row.subcategory ?? ''} ${row.note ?? ''}`
  return keywords.some((keyword) => text.includes(keyword))
}

function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00`).getDay()
  return day === 0 || day === 6
}

export function buildSpendingReportSummary(
  rows: Transaction[],
  periodLabel: string,
): SpendingReportSummary {
  const expenses = rows.filter((row) => row.type === 'expense')
  const totalExpense = expenses.reduce((sum, row) => sum + row.amount, 0)
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
  const foodExpense = expenses
    .filter((row) => isCategory(row, ['餐', '饭', '外卖', '咖啡', '奶茶', '甜品', '水果', '零食']))
    .reduce((sum, row) => sum + row.amount, 0)
  const fixedExpense = expenses
    .filter(
      (row) =>
        row.source === 'recurring' ||
        Boolean(row.recurring_template_id) ||
        isCategory(row, ['房租', '租房', '房贷', '贷款', '分期', '会员', '订阅', '保险', '水电', '燃气', '话费', '宽带']),
    )
    .reduce((sum, row) => sum + row.amount, 0)
  const weekendExpense = expenses
    .filter((row) => isWeekend(row.transaction_date))
    .reduce((sum, row) => sum + row.amount, 0)
  const weekdayExpense = totalExpense - weekendExpense
  const flexibleExpense = expenses
    .filter((row) => isCategory(row, ['购物', '娱乐', '旅游', '旅行', '美妆', '服饰', '游戏', '电影', '酒', '礼物']))
    .reduce((sum, row) => sum + row.amount, 0)
  const engelPercent = totalExpense > 0 ? (foodExpense / totalExpense) * 100 : 0
  const fixedPercent = totalExpense > 0 ? (fixedExpense / totalExpense) * 100 : 0
  const flexiblePercent = totalExpense > 0 ? (flexibleExpense / totalExpense) * 100 : 0
  const weekendPercent = totalExpense > 0 ? (weekendExpense / totalExpense) * 100 : 0

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

  const leadingCategory = topCategories[0]
  const charlieDiagnosis = leadingCategory
    ? `查理看完账单，发现这个月主要花在${leadingCategory.category}，整体消费节奏${leadingCategory.percent >= 45 ? '有点集中' : '还算分散'}。`
    : `查理看完账单，发现${periodLabel}支出记录还不多，可以先保持记账习惯。`

  const charlieFindings: string[] = []
  if (leadingCategory) {
    charlieFindings.push(
      `${leadingCategory.category}是本月最大支出项，占 ${leadingCategory.percent.toFixed(0)}%，查理会优先盯住这个分类。`,
    )
  }
  if (engelPercent > 0) {
    charlieFindings.push(
      `本月恩格尔系数约 ${engelPercent.toFixed(0)}%，也就是每花 100 元，大约 ${engelPercent.toFixed(0)} 元花在吃喝上。`,
    )
  }
  if (weekendExpense > 0) {
    const weekendText =
      weekendExpense > weekdayExpense
        ? '周末消费比工作日更活跃'
        : `周末消费占 ${weekendPercent.toFixed(0)}%，还没有明显“周末放飞”`
    charlieFindings.push(`${weekendText}，查理会把它作为消费节奏参考。`)
  }
  if (maxExpense) {
    charlieFindings.push(
      `最大单笔是「${maxExpense.note || maxExpense.category}」${money(maxExpense.amount)}，它对本月总支出影响比较明显。`,
    )
  }

  const profileTitle =
    fixedPercent >= 45
      ? '固定支出压力型'
      : engelPercent >= 40
        ? '美食驱动型'
        : weekendPercent >= 38
          ? '周末活跃型'
          : flexiblePercent >= 35
            ? '体验消费型'
            : '均衡记录型'
  const profileDescription =
    profileTitle === '固定支出压力型'
      ? '这个月基础和周期性开销占比较高，真正能灵活调整的空间会小一些。'
      : profileTitle === '美食驱动型'
        ? '吃喝相关支出存在感很强，生活幸福感在线，但也最适合做轻量控制。'
        : profileTitle === '周末活跃型'
          ? '消费更容易集中在周末，适合提前给周末设置一个小预算。'
          : profileTitle === '体验消费型'
            ? '钱更多花在购物、娱乐或出行上，属于体验感比较强的月份。'
            : '本月支出没有明显偏科，结构相对平衡。'

  const charlieStrategies: string[] = []
  if (leadingCategory) {
    charlieStrategies.push(
      `下月先从${leadingCategory.category}开始控，目标不是不花，而是把它压到总支出的 ${Math.max(25, Math.round(leadingCategory.percent - 8))}% 左右。`,
    )
  }
  if (averageDailyExpense > 0) {
    charlieStrategies.push(`查理建议先把每日可花金额参考设在 ${money(averageDailyExpense)} 附近，再根据预算动态调整。`)
  }
  if (weekendExpense > weekdayExpense) {
    charlieStrategies.push('如果想稳住预算，可以给周末单独设一个上限，效果会比每天平均控制更明显。')
  }

  return {
    periodLabel,
    transactionCount: rows.length,
    expenseCount: expenses.length,
    totalExpense,
    averageDailyExpense,
    maxExpense,
    topExpenseDay,
    topCategories,
    localHighlights,
    localSuggestions,
    charlieDiagnosis,
    charlieFindings: charlieFindings.slice(0, 4),
    charlieProfile: {
      title: profileTitle,
      description: profileDescription,
      metrics: [
        `恩格尔系数 ${engelPercent.toFixed(0)}%`,
        `固定支出 ${fixedPercent.toFixed(0)}%`,
        `周末消费 ${weekendPercent.toFixed(0)}%`,
      ],
    },
    charlieStrategies: charlieStrategies.slice(0, 3),
  }
}

export function spendingReportPayload(summary: SpendingReportSummary) {
  return {
    periodLabel: summary.periodLabel,
    transactionCount: summary.transactionCount,
    expenseCount: summary.expenseCount,
    totalExpense: summary.totalExpense,
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
    charlieProfile: summary.charlieProfile,
  }
}
