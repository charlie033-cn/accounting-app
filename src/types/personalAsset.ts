export type PersonalAssetType =
  | '房子'
  | '车子'
  | '手机'
  | '电脑'
  | '家电'
  | '家具'
  | '数码'
  | '奢侈品'
  | '其他'

export type PersonalAssetStatus = 'serving' | 'retired' | 'sold'

export type PersonalAsset = {
  id: string
  user_id: string
  name: string
  type: PersonalAssetType
  status: PersonalAssetStatus
  amount: number
  purchase_date: string
  note?: string | null
  created_at: string
  updated_at: string
}
