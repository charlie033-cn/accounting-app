/** CloudBase `budgets` 集合文档（字段名与控制台一致） */
export type CloudBudgetDoc = {
  _id: string
  user_id: string
  period: string
  monthly_amount: number
  created_at?: string
  updated_at?: string
}
