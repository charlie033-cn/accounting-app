/** CloudBase `user_category_lists` 文档：每用户一条 */
export type CloudUserCategoryListDoc = {
  _id: string
  user_id: string
  expense: string[]
  income: string[]
  created_at?: string
  updated_at?: string
}
