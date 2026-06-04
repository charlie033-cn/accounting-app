/**
 * TokenHub 多模态识别小票 → 记账草稿（OpenAI 兼容 chat/completions）
 * 控制台为该云函数配置环境变量：TOKENHUB_API_KEY（必填）
 * 可选：TOKENHUB_MODEL（默认 youtu-vita）、TOKENHUB_BASE_URL（默认 https://tokenhub.tencentmaas.com/v1）
 */
const DEFAULT_BASE = 'https://tokenhub.tencentmaas.com/v1'
const DEFAULT_MODEL = 'youtu-vita'

const SYSTEM_PROMPT = `你是小票与账单图片识别助手。根据用户提供的图片，提取一笔或多笔记账记录。
必须只输出一个 JSON 对象，不要 markdown 代码围栏，不要解释文字。
输出格式必须为：{"drafts":[...]}。
drafts 数组内每一项字段要求：
- type：字符串，只能是 "expense"（支出）或 "income"（收入）
- amount：数字，人民币金额，正数
- transaction_date：字符串，格式 YYYY-MM-DD；日期必须结合用户消息里的当前日期上下文推断
- category：字符串，必须来自用户消息给出的 categories
- subcategory：字符串，必须来自用户消息给出的 categoryTree[category]
- note：字符串，商户名或简短说明，可为空字符串
如果图片是账单列表、转账明细、外卖/购物清单等包含多笔独立记录，请拆成多笔；如果只是一张小票总额，输出一笔。
日期规则：
- 图片中出现“昨天”，必须输出用户消息给出的昨天日期。
- 图片中出现“今天”，必须输出用户消息给出的当前日期。
- 图片只有月日、没有年份时，默认使用当前日期所在年份；不要臆测成历史年份。
- 图片完全没有日期时，使用当前日期。`

function parseJsonFromModelContent(text) {
  let s = String(text).trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) {
    s = fence[1].trim()
  }
  try {
    return JSON.parse(s)
  } catch {
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(s.slice(start, end + 1))
    }
    throw new Error('JSON parse failed')
  }
}

function normalizeType(v) {
  if (v === 'income' || v === '收入') {
    return 'income'
  }
  if (v === 'expense' || v === '支出') {
    return 'expense'
  }
  return 'expense'
}

function fallbackCategory(categories) {
  return categories.includes('其他支出') ? '其他支出' : (categories[0] || '其他支出')
}

function fallbackSubcategory(categoryTree, category) {
  const options = categoryTree[category] || []
  return options[0] || ''
}

function normalizeDraft(obj, fallbackDate, categories, categoryTree) {
  const amount = Number(obj.amount)
  const type = normalizeType(obj.type)
  const dateStr = typeof obj.transaction_date === 'string' ? obj.transaction_date.trim() : ''
  const transaction_date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
    ? dateStr
    : fallbackDate
  const rawCategory = typeof obj.category === 'string' ? obj.category.trim() : ''
  const category = categories.includes(rawCategory) ? rawCategory : fallbackCategory(categories)
  const rawSubcategory = typeof obj.subcategory === 'string' ? obj.subcategory.trim() : ''
  const subcategory = (categoryTree[category] || []).includes(rawSubcategory)
    ? rawSubcategory
    : fallbackSubcategory(categoryTree, category)
  const note = typeof obj.note === 'string' ? obj.note.trim() : ''
  return {
    type,
    amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
    category,
    subcategory,
    transaction_date,
    note,
  }
}

function normalizeDrafts(parsed, fallbackDate, categories, categoryTree) {
  const rawDrafts = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed && parsed.drafts)
      ? parsed.drafts
      : Array.isArray(parsed && parsed.items)
        ? parsed.items
        : Array.isArray(parsed && parsed.records)
          ? parsed.records
          : Array.isArray(parsed && parsed.transactions)
            ? parsed.transactions
            : [parsed]

  return rawDrafts
    .filter((item) => item && typeof item === 'object')
    .map((item) => normalizeDraft(item, fallbackDate, categories, categoryTree))
    .filter((item) => item.amount > 0)
    .slice(0, 20)
}

function validDateOrToday(v) {
  const t = typeof v === 'string' ? v.trim() : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : new Date().toISOString().slice(0, 10)
}

exports.main = async (event) => {
  const apiKey = process.env.TOKENHUB_API_KEY
  if (!apiKey) {
    return { ok: false, error: '云函数未配置 TOKENHUB_API_KEY，请在控制台为该函数添加环境变量。' }
  }

  const imageDataUrl = event && typeof event.imageDataUrl === 'string' ? event.imageDataUrl.trim() : ''
  const imageUrl = event && typeof event.imageUrl === 'string' ? event.imageUrl.trim() : ''
  const url = imageDataUrl || imageUrl
  if (!url) {
    return { ok: false, error: '请传入 imageDataUrl（推荐 data:image/...;base64,...）或 imageUrl（https 可访问链接）。' }
  }
  if (url.length > 6_000_000) {
    return { ok: false, error: '图片数据过大，请压缩或换用较小图片（建议 2MB 以内）。' }
  }

  const model = (process.env.TOKENHUB_MODEL || DEFAULT_MODEL).trim()
  const base = (process.env.TOKENHUB_BASE_URL || DEFAULT_BASE).replace(/\/$/, '')
  const currentDate = validDateOrToday(event && event.currentDate)
  const yesterdayDate = validDateOrToday(event && event.yesterdayDate)
  const categories = Array.isArray(event?.categories)
    ? event.categories.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 30)
    : []
  const rawTree = event?.categoryTree && typeof event.categoryTree === 'object' && !Array.isArray(event.categoryTree)
    ? event.categoryTree
    : {}
  const categoryTree = {}
  for (const category of categories) {
    categoryTree[category] = Array.isArray(rawTree[category])
      ? rawTree[category].filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 30)
      : []
  }
  if (categories.length === 0) {
    return { ok: false, error: '缺少分类列表' }
  }

  let res
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `请根据这张图片输出记账 JSON，若有多笔独立账单请放入 drafts 数组。` +
                  `当前日期是 ${currentDate}，昨天是 ${yesterdayDate}。` +
                  `只能使用这些一级分类和二级分类：${JSON.stringify({ categories, categoryTree })}。` +
                  `如果图片显示“昨天”，transaction_date 必须是 ${yesterdayDate}；` +
                  `如果只显示月日没有年份，请使用 ${currentDate.slice(0, 4)} 年。`,
              },
              { type: 'image_url', image_url: { url } },
            ],
          },
        ],
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `请求 TokenHub 失败：${msg}` }
  }

  if (!res.ok) {
    const text = await res.text()
    return {
      ok: false,
      error: `TokenHub HTTP ${res.status}：${text.slice(0, 800)}`,
    }
  }

  let data
  try {
    data = await res.json()
  } catch {
    return { ok: false, error: 'TokenHub 返回非 JSON 响应' }
  }

  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: '模型未返回文本内容', raw: JSON.stringify(data).slice(0, 1500) }
  }

  let parsed
  try {
    parsed = parseJsonFromModelContent(content)
  } catch {
    return {
      ok: false,
      error: '无法从模型输出中解析 JSON，请重试或换更清晰的图片。',
      raw: content.slice(0, 2000),
    }
  }

  const drafts = normalizeDrafts(parsed, currentDate, categories, categoryTree)
  if (drafts.length === 0) {
    return { ok: false, error: '未识别到可保存的账单金额，请换更清晰的图片。' }
  }
  const out = drafts.map((draft) => ({
    type: draft.type,
    amount: String(draft.amount),
    category: draft.category,
    subcategory: draft.subcategory,
    transaction_date: draft.transaction_date,
    note: draft.note,
  }))
  return {
    ok: true,
    draft: out[0],
    drafts: out,
  }
}
