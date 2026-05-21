import type { TransactionType } from '../types/transaction'

/** 默认支出 / 收入分类及常见自定义名的 emoji（未知名称按类型回退） */
const EXPENSE_EMOJI: Record<string, string> = {
  餐饮: '🍽️',
  交通: '🚗',
  购物: '🛍️',
  房租: '🏠',
  水电: '💡',
  娱乐: '🎮',
  医疗: '🏥',
  旅游: '✈️',
  人情: '🧧',
  '家居/家具': '🛋️',
  其他: '📋',
  日用: '🧴',
  通讯: '📱',
  教育: '📚',
  宠物: '🐾',
  旅行: '✈️',
  运动: '⚽',
}

const INCOME_EMOJI: Record<string, string> = {
  工资: '💵',
  副业: '💼',
  投资: '📈',
  报销: '🧾',
  其他: '📋',
  奖金: '🎁',
  理财: '💹',
  红包: '🧧',
}

function normalize(name: string): string {
  return name.trim()
}

/**
 * 根据分类名（及收支类型）返回展示用 emoji。
 */
export function categoryEmoji(category: string, type: TransactionType): string {
  const key = normalize(category)
  if (!key) {
    return type === 'income' ? '💰' : '💳'
  }
  const table = type === 'income' ? INCOME_EMOJI : EXPENSE_EMOJI
  if (table[key]) {
    return table[key]
  }
  if (type === 'income' && EXPENSE_EMOJI[key]) {
    return EXPENSE_EMOJI[key]
  }
  if (type === 'expense' && INCOME_EMOJI[key]) {
    return INCOME_EMOJI[key]
  }
  if (key.includes('交通') || key.includes('车') || key.includes('油') || key.includes('停车')) {
    return '🚗'
  }
  if (key.includes('餐') || key.includes('食') || key.includes('饮')) {
    return '🍽️'
  }
  if (key.includes('房') || key.includes('租')) {
    return '🏠'
  }
  if (key.includes('医') || key.includes('药')) {
    return '🏥'
  }
  if (key.includes('工资') || key.includes('薪')) {
    return '💵'
  }
  return type === 'income' ? '💰' : '💳'
}
