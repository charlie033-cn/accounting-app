import { inferBuiltInCategory } from './categoryRules'
import type { Transaction } from '../types/transaction'

export type CategoryMigrationSuggestion = {
  id: string
  fromCategory: string
  fromSubcategory: string | null
  toCategory: string
  toSubcategory: string
  reason: string
}

const LEGACY_CATEGORY_MAP: Record<string, { category: string; subcategory: string }> = {
  房租: { category: '居住', subcategory: '房租房贷' },
  水电: { category: '居住', subcategory: '水电燃气' },
  娱乐: { category: '娱乐休闲', subcategory: '游戏娱乐' },
  医疗: { category: '医疗健康', subcategory: '门诊急诊' },
  旅游: { category: '娱乐休闲', subcategory: '旅行度假' },
  人情: { category: '人情社交', subcategory: '红包礼金' },
  '家居/家具': { category: '居住', subcategory: '家具家装' },
  其他: { category: '其他支出', subcategory: '无法归类' },
}

const SUBCATEGORY_RULES: Array<{
  category: string
  subcategory: string
  keywords: string[]
}> = [
  { category: '餐饮', subcategory: '咖啡饮品', keywords: ['咖啡', '奶茶', '瑞幸', '星巴克', '库迪', '喜茶', '饮品'] },
  { category: '餐饮', subcategory: '快餐简餐', keywords: ['外卖', '美团', '饿了么', '肯德基', '麦当劳', '汉堡', '简餐'] },
  { category: '餐饮', subcategory: '零食水果', keywords: ['零食', '水果', '饮料'] },
  { category: '餐饮', subcategory: '生鲜食材', keywords: ['买菜', '生鲜', '盒马', '叮咚', '菜场', '食材'] },
  { category: '餐饮', subcategory: '聚餐宴请', keywords: ['聚餐', '宴请', '请客'] },
  { category: '餐饮', subcategory: '酒水夜宵', keywords: ['酒', '夜宵', '烧烤'] },
  { category: '餐饮', subcategory: '正餐', keywords: ['早餐', '午餐', '晚餐', '午饭', '晚饭', '吃饭'] },
  { category: '购物', subcategory: '服饰鞋包', keywords: ['衣服', '服饰', '鞋', '包'] },
  { category: '购物', subcategory: '数码电器', keywords: ['数码', '电器', '苹果', 'Apple', '小米', '华为'] },
  { category: '购物', subcategory: '美妆个护', keywords: ['美妆', '护肤', '个护', '化妆'] },
  { category: '购物', subcategory: '家居用品', keywords: ['家居', '家具', '宜家', 'IKEA'] },
  { category: '购物', subcategory: '宠物用品', keywords: ['宠物', '猫', '狗'] },
  { category: '购物', subcategory: '日用百货', keywords: ['淘宝', '京东', '拼多多', '超市', '便利店', '日用'] },
  { category: '居住', subcategory: '房租房贷', keywords: ['房租', '租金', '房贷'] },
  { category: '居住', subcategory: '物业管理', keywords: ['物业'] },
  { category: '居住', subcategory: '水电燃气', keywords: ['水费', '电费', '燃气', '天然气'] },
  { category: '居住', subcategory: '宽带通讯', keywords: ['宽带', '网费'] },
  { category: '居住', subcategory: '维修清洁', keywords: ['维修', '清洁', '保洁'] },
  { category: '居住', subcategory: '家具家装', keywords: ['装修', '家装', '家具'] },
  { category: '交通', subcategory: '公共交通', keywords: ['地铁', '公交', '公共交通'] },
  { category: '交通', subcategory: '打车租车', keywords: ['打车', '滴滴', '出租', '租车'] },
  { category: '交通', subcategory: '加油充电', keywords: ['加油', '油费', '充电'] },
  { category: '交通', subcategory: '停车过路', keywords: ['停车', '高速', '过路'] },
  { category: '交通', subcategory: '车辆保养', keywords: ['保养', '洗车', '修车'] },
  { category: '交通', subcategory: '长途交通', keywords: ['高铁', '火车', '机票', '飞机', '长途'] },
  { category: '生活服务', subcategory: '话费流量', keywords: ['话费', '流量', '手机'] },
  { category: '生活服务', subcategory: '快递物流', keywords: ['快递', '物流'] },
  { category: '生活服务', subcategory: '洗衣护理', keywords: ['洗衣', '护理'] },
  { category: '生活服务', subcategory: '理发美容', keywords: ['理发', '美容'] },
  { category: '生活服务', subcategory: '家政服务', keywords: ['家政'] },
  { category: '生活服务', subcategory: '证件手续', keywords: ['证件', '手续'] },
  { category: '娱乐休闲', subcategory: '影视演出', keywords: ['电影', '演出', '影院'] },
  { category: '娱乐休闲', subcategory: '游戏娱乐', keywords: ['游戏', 'Steam', '任天堂', '娱乐'] },
  { category: '娱乐休闲', subcategory: '运动健身', keywords: ['运动', '健身'] },
  { category: '娱乐休闲', subcategory: '旅行度假', keywords: ['旅游', '旅行', '酒店', '门票', '景区'] },
  { category: '娱乐休闲', subcategory: '书影音', keywords: ['书', '音乐', '视频会员', '会员'] },
  { category: '娱乐休闲', subcategory: '洗浴按摩', keywords: ['洗浴', '按摩', '足疗', 'SPA', 'spa', '推拿'] },
  { category: '医疗健康', subcategory: '药品', keywords: ['药', '药房', '药店'] },
  { category: '医疗健康', subcategory: '门诊急诊', keywords: ['医院', '门诊', '急诊', '看病'] },
  { category: '医疗健康', subcategory: '体检', keywords: ['体检'] },
  { category: '医疗健康', subcategory: '牙科', keywords: ['牙', '口腔'] },
  { category: '人情社交', subcategory: '红包礼金', keywords: ['红包', '礼金', '份子'] },
  { category: '人情社交', subcategory: '礼物', keywords: ['礼物'] },
  { category: '人情社交', subcategory: '请客', keywords: ['请客'] },
  { category: '家庭', subcategory: '育儿用品', keywords: ['育儿', '婴儿', '宝宝', '奶粉', '尿不湿'] },
  { category: '家庭', subcategory: '儿童服务', keywords: ['儿童', '托育', '早教', '兴趣班', '校外'] },
  { category: '家庭', subcategory: '老人赡养', keywords: ['老人', '父母', '赡养', '孝敬'] },
  { category: '家庭', subcategory: '家庭共同支出', keywords: ['家庭共同', '家用', '全家', '共同支出'] },
]

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()))
}

function inferSubcategory(
  text: string,
  category: string,
  subcategoryMap: Record<string, string[]>,
) {
  const normalized = text.toLowerCase()
  const options = subcategoryMap[category] ?? []
  const matched = SUBCATEGORY_RULES.find(
    (rule) =>
      rule.category === category &&
      options.includes(rule.subcategory) &&
      includesAny(normalized, rule.keywords),
  )
  return matched?.subcategory ?? options[0] ?? '无法归类'
}

export function buildHistoricalCategoryMigrationPreview(
  transactions: Transaction[],
  expenseCategories: string[],
  subcategoryMap: Record<string, string[]>,
): CategoryMigrationSuggestion[] {
  return transactions
    .map((item): CategoryMigrationSuggestion | null => {
      if (item.type !== 'expense') {
        return null
      }
      const text = `${item.category} ${item.subcategory ?? ''} ${item.note ?? ''}`.trim()
      const legacy = LEGACY_CATEGORY_MAP[item.category]
      const toCategory = legacy?.category ?? (
        expenseCategories.includes(item.category)
          ? item.category
          : inferBuiltInCategory(text, 'expense', expenseCategories)
      )
      if (!toCategory || !expenseCategories.includes(toCategory)) {
        return null
      }
      const toCategoryOptions = subcategoryMap[toCategory] ?? []
      const hasValidCurrentSubcategory = (
        item.category === toCategory &&
        Boolean(item.subcategory) &&
        toCategoryOptions.includes(item.subcategory ?? '')
      )
      const toSubcategory = hasValidCurrentSubcategory
        ? (item.subcategory ?? '')
        : (legacy?.subcategory ?? inferSubcategory(text, toCategory, subcategoryMap))
      if (item.category === toCategory && item.subcategory === toSubcategory) {
        return null
      }
      return {
        id: item.id,
        fromCategory: item.category,
        fromSubcategory: item.subcategory ?? null,
        toCategory,
        toSubcategory,
        reason: legacy ? '旧分类映射' : '按备注和关键词匹配',
      }
    })
    .filter((item): item is CategoryMigrationSuggestion => Boolean(item))
}
