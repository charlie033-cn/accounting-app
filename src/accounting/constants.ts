import type { TransactionFormState } from '../types/transaction'

/** 云函数名：TokenHub 识别小票 → 记账草稿（见 cloudfunctions/parseReceiptTokenhub） */
export const PARSE_RECEIPT_CLOUD_FUNCTION = 'parseReceiptTokenhub'
/** 云函数名：TokenHub 文本分类 → 为导入账单兜底分类 */
export const CLASSIFY_TRANSACTIONS_CLOUD_FUNCTION = 'classifyTransactionsTokenhub'
/** 云函数名：TokenHub 语音文本记账 → 结构化记账草稿 */
export const PARSE_VOICE_TRANSACTION_CLOUD_FUNCTION = 'parseVoiceTransactionTokenhub'
/** 云函数名：TokenHub 消费报告 → 基于聚合摘要生成自然语言复盘 */
export const GENERATE_SPENDING_REPORT_CLOUD_FUNCTION = 'generateSpendingReportTokenhub'

export const TRANSACTION_COLLECTION = 'transactions'
export const BUDGET_COLLECTION = 'budgets'
export const RECURRING_COLLECTION = 'recurring_templates'
export const MONTHLY_AI_REPORT_COLLECTION = 'monthly_ai_reports'
export const STORED_VALUE_CARD_COLLECTION = 'stored_value_cards'
export const STORED_VALUE_CARD_RECORD_COLLECTION = 'stored_value_card_records'
export const PERSONAL_ASSET_COLLECTION = 'personal_assets'
/** 每用户一条：自定义收支分类名称列表（与代码内默认合并逻辑见 AccountingContext） */
export const USER_CATEGORY_LISTS_COLLECTION = 'user_category_lists'

export const expenseCategories = [
  '餐饮',
  '购物',
  '居住',
  '交通',
  '生活服务',
  '娱乐休闲',
  '医疗健康',
  '教育成长',
  '人情社交',
  '金融保险',
  '家庭',
  '其他支出',
] as const

export const defaultExpenseSubcategories: Record<string, string[]> = {
  餐饮: ['正餐', '快餐简餐', '咖啡饮品', '零食水果', '生鲜食材', '聚餐宴请', '酒水夜宵'],
  购物: ['日用百货', '服饰鞋包', '数码电器', '美妆个护', '家居用品', '宠物用品'],
  居住: ['房租房贷', '物业管理', '水电燃气', '宽带通讯', '维修清洁', '家具家装'],
  交通: ['公共交通', '打车租车', '加油充电', '停车过路', '车辆保养', '车辆贷款', '长途交通'],
  生活服务: ['话费流量', '快递物流', '洗衣护理', '理发美容', '家政服务', '证件手续'],
  娱乐休闲: ['影视演出', '游戏娱乐', '运动健身', '旅行度假', '书影音', '洗浴按摩', '兴趣爱好'],
  医疗健康: ['药品', '门诊急诊', '体检', '牙科', '心理咨询', '保健护理'],
  教育成长: ['课程培训', '书籍资料', '考试认证', '学习工具', '儿童教育'],
  人情社交: ['红包礼金', '礼物', '请客', '公益捐赠', '探亲慰问'],
  金融保险: ['保险', '手续费', '利息支出', '贷款还款', '投资支出'],
  家庭: ['育儿用品', '儿童服务', '老人赡养', '家庭共同支出'],
  其他支出: ['罚款赔偿', '丢失损坏', '无法归类'],
}

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
  subcategory: '',
  transaction_date: todayISO(),
  note: '',
})
