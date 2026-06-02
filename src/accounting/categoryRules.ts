import type { TransactionType } from '../types/transaction'

const CATEGORY_KEYWORDS: Array<{
  type: TransactionType
  category: string
  keywords: string[]
}> = [
  {
    type: 'expense',
    category: '餐饮',
    keywords: [
      '餐',
      '饭',
      '早餐',
      '午饭',
      '晚饭',
      '夜宵',
      '吃',
      '咖啡',
      '奶茶',
      '外卖',
      '水果',
      '超市熟食',
      '美团',
      '大众点评',
      '饿了么',
      '星巴克',
      '瑞幸',
      '库迪',
      '麦当劳',
      '肯德基',
      '必胜客',
      '汉堡王',
      '喜茶',
      '奈雪',
      '蜜雪冰城',
      '霸王茶姬',
      '海底捞',
      '盒马',
      '叮咚买菜',
      '朴朴',
    ],
  },
  {
    type: 'expense',
    category: '交通',
    keywords: [
      '交通',
      '打车',
      '出租',
      '网约车',
      '滴滴',
      '高德打车',
      '曹操出行',
      '地铁',
      '公交',
      '铁路',
      '高铁',
      '火车',
      '动车',
      '机票',
      '航旅',
      '携程机票',
      '停车',
      '停车费',
      '加油',
      '油费',
      '充电',
      '高速',
      '过路费',
    ],
  },
  {
    type: 'expense',
    category: '购物',
    keywords: [
      '买',
      '购物',
      '淘宝',
      '天猫',
      '京东',
      '拼多多',
      '抖音商城',
      '小红书',
      '唯品会',
      '得物',
      '亚马逊',
      '山姆',
      'Costco',
      '沃尔玛',
      '永辉',
      '便利店',
      '罗森',
      '全家',
      '711',
      '日用品',
      '衣服',
      '鞋',
      '数码',
      'Apple',
      '苹果',
      '小米',
      '华为',
    ],
  },
  {
    type: 'expense',
    category: '居住',
    keywords: ['房租', '租金', '租房', '公寓', '自如', '贝壳租房', '链家'],
  },
  {
    type: 'expense',
    category: '居住',
    keywords: ['水费', '电费', '燃气', '天然气', '网费', '宽带', '物业', '供暖', '取暖'],
  },
  {
    type: 'expense',
    category: '娱乐休闲',
    keywords: [
      '电影',
      '影院',
      '游戏',
      'Steam',
      '任天堂',
      'PlayStation',
      'Xbox',
      '娱乐',
      '唱歌',
      'KTV',
      '演出',
      '音乐',
      '视频会员',
      '腾讯视频',
      '爱奇艺',
      '优酷',
      'B站',
      '哔哩哔哩',
      '网易云音乐',
      'QQ音乐',
      'Spotify',
      '洗浴',
      '按摩',
      '足疗',
      'spa',
      'SPA',
      '推拿',
    ],
  },
  {
    type: 'expense',
    category: '医疗健康',
    keywords: ['医院', '药', '药房', '药店', '看病', '门诊', '体检', '医疗', '医保', '牙科', '口腔'],
  },
  {
    type: 'expense',
    category: '娱乐休闲',
    keywords: ['旅游', '旅行', '酒店', '民宿', '携程', '飞猪', '去哪儿', '同程', '景区', '门票', '机酒'],
  },
  {
    type: 'expense',
    category: '人情社交',
    keywords: ['红包', '份子', '礼金', '礼物', '转账给', '亲友', '结婚', '生日'],
  },
  {
    type: 'expense',
    category: '居住',
    keywords: ['家居', '家具', '宜家', 'IKEA', '装修', '家装', '五金', '灯具', '窗帘', '床垫'],
  },
  {
    type: 'expense',
    category: '生活服务',
    keywords: ['话费', '流量', '快递', '物流', '洗衣', '理发', '美容', '家政', '证件'],
  },
  {
    type: 'expense',
    category: '教育成长',
    keywords: ['课程', '培训', '书籍', '资料', '考试', '认证', '学习', '教育'],
  },
  {
    type: 'expense',
    category: '金融保险',
    keywords: ['保险', '手续费', '利息', '贷款', '还款', '投资支出'],
  },
  {
    type: 'expense',
    category: '家庭',
    keywords: ['育儿', '儿童', '老人', '赡养', '家庭共同'],
  },
  {
    type: 'income',
    category: '工资',
    keywords: ['工资', '薪资', '薪水', '工资发放', '代发工资', '奖金', '绩效'],
  },
  {
    type: 'income',
    category: '副业',
    keywords: ['副业', '稿费', '佣金', '兼职', '咨询费', '劳务费', '服务费'],
  },
  {
    type: 'income',
    category: '投资',
    keywords: ['理财', '基金', '股票', '分红', '股息', '利息', '收益', '赎回'],
  },
  {
    type: 'income',
    category: '报销',
    keywords: ['报销', ' reimbursement ', '费用报销', '退票', '退款', '退回'],
  },
]

function normalizeText(text: string) {
  return text.trim().toLowerCase()
}

export function inferBuiltInCategory(text: string, type: TransactionType, options: string[]) {
  const normalized = normalizeText(text)
  const exact = options.find((option) => normalized.includes(normalizeText(option)))
  if (exact) {
    return exact
  }
  const matched = CATEGORY_KEYWORDS.find((rule) => {
    if (rule.type !== type || !options.includes(rule.category)) {
      return false
    }
    return rule.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))
  })
  if (matched) {
    return matched.category
  }
  return options.includes('其他') ? '其他' : (options[0] ?? '')
}
