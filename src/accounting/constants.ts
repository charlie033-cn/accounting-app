import type { TransactionFormState } from '../types/transaction'

/** 云函数名：TokenHub 识别小票 → 记账草稿（见 cloudfunctions/parseReceiptTokenhub） */
export const PARSE_RECEIPT_CLOUD_FUNCTION = 'parseReceiptTokenhub'
/** 云函数名：TokenHub 文本分类 → 为导入账单兜底分类 */
export const CLASSIFY_TRANSACTIONS_CLOUD_FUNCTION = 'classifyTransactionsTokenhub'
/** 云函数名：TokenHub 消费报告 → 基于聚合摘要生成自然语言复盘 */
export const GENERATE_SPENDING_REPORT_CLOUD_FUNCTION = 'generateSpendingReportTokenhub'

export const TRANSACTION_COLLECTION = 'transactions'
export const BUDGET_COLLECTION = 'budgets'
export const RECURRING_COLLECTION = 'recurring_templates'
export const MONTHLY_AI_REPORT_COLLECTION = 'monthly_ai_reports'
/** 每用户一条：自定义收支分类名称列表（与代码内默认合并逻辑见 AccountingContext） */
export const USER_CATEGORY_LISTS_COLLECTION = 'user_category_lists'

export const expenseCategories = [
  '餐饮',
  '交通',
  '购物',
  '房租',
  '水电',
  '娱乐',
  '医疗',
  '旅游',
  '人情',
  '家居/家具',
  '其他',
] as const

export const incomeCategories = ['工资', '副业', '投资', '报销', '其他'] as const

function localDateParts(date = new Date()) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return { year, month, day }
}

export const todayISO = () => {
  const { year, month, day } = localDateParts()
  return `${year}-${month}-${day}`
}

export const currentMonth = () => {
  const { year, month } = localDateParts()
  return `${year}-${month}`
}

export const currentYear = () => localDateParts().year

export const initialForm = (): TransactionFormState => ({
  type: 'expense',
  amount: '',
  category: expenseCategories[0],
  transaction_date: todayISO(),
  note: '',
})
