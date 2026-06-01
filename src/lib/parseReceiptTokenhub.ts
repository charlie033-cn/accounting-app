import { PARSE_RECEIPT_CLOUD_FUNCTION } from '../accounting/constants'
import { cloudbaseApp } from './cloudbase'

export type ReceiptParseDraft = {
  type: 'income' | 'expense'
  amount: string
  category: string
  subcategory?: string
  transaction_date: string
  note: string
}

type CfResult =
  | { ok: true; draft?: ReceiptParseDraft; drafts?: ReceiptParseDraft[] }
  | { ok: false; error: string; raw?: string }

function localDateISO(offsetDays = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 调用云函数，将本地图片 Data URL 发给 TokenHub 多模态模型解析。
 * 需在 CloudBase 部署 `parseReceiptTokenhub` 并配置 TOKENHUB_API_KEY。
 */
export async function parseReceiptFromImageDataUrl(
  imageDataUrl: string,
): Promise<ReceiptParseDraft[]> {
  if (!cloudbaseApp) {
    throw new Error('CloudBase 环境未配置')
  }
  const trimmed = imageDataUrl.trim()
  if (!trimmed.startsWith('data:image/')) {
    throw new Error('请使用相机或相册选择的图片（data:image/... 格式）')
  }

  const { result } = await cloudbaseApp.callFunction({
    name: PARSE_RECEIPT_CLOUD_FUNCTION,
    data: {
      imageDataUrl: trimmed,
      currentDate: localDateISO(),
      yesterdayDate: localDateISO(-1),
    },
  })

  let r = result as CfResult | string
  if (typeof r === 'string') {
    try {
      r = JSON.parse(r) as CfResult
    } catch {
      throw new Error('云函数返回格式异常')
    }
  }
  if (!r || typeof r !== 'object') {
    throw new Error('云函数返回异常，请确认已部署 parseReceiptTokenhub')
  }
  if (!('ok' in r) || !r.ok) {
    const err = 'error' in r && typeof r.error === 'string' ? r.error : '识别失败'
    throw new Error(err)
  }
  const drafts = Array.isArray(r.drafts) ? r.drafts : r.draft ? [r.draft] : []
  if (drafts.length === 0) {
    throw new Error('未识别到可保存的账单')
  }
  return drafts
}
