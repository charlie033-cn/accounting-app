export type RecurringTemplateStatus = 'active' | 'paused'

export type RecurringTemplate = {
  id: string
  user_id: string
  name: string
  /** 每期入账金额；旧数据只有该字段 */
  amount: number
  /** 用户输入的整个周期总金额；新数据用它按期数拆分 */
  total_amount?: number | null
  category: string
  day_of_month: number
  start_period: string
  start_date?: string | null
  duration_months: number
  status: RecurringTemplateStatus
  created_at: string
  updated_at: string
}
