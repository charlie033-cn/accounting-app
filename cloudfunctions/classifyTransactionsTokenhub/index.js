/**
 * TokenHub 文本分类：为规则未命中的账单草稿补全分类。
 * 控制台为该云函数配置环境变量：TOKENHUB_API_KEY（必填）
 * 可选：TOKENHUB_MODEL（默认 deepseek-v4-flash）、TOKENHUB_BASE_URL（默认 https://tokenhub.tencentmaas.com/v1）
 */
const DEFAULT_BASE = 'https://tokenhub.tencentmaas.com/v1'
const DEFAULT_MODEL = 'deepseek-v4-flash'

const SYSTEM_PROMPT = `你是记账分类助手。根据账单文本，从用户给定分类体系中选择最合适的一级分类和二级分类。
必须只输出 JSON 对象，不要 markdown 代码围栏，不要解释。
输出格式必须为：{"items":[{"id":"原始 id","category":"一级分类名","subcategory":"二级分类名"}]}。
规则：
- category 必须严格来自对应账单传入的 categories 数组。
- 如果传入 categoryTree，subcategory 必须严格来自 categoryTree[category] 数组。
- 无法判断时返回 "其他"（如果 categories 中有其他），否则返回 categories 的第一项。
- 如果无法判断二级分类，返回该 category 下最通用或第一项二级分类。
- 不要新增分类，不要输出置信度或原因。`

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

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const type = raw.type === 'income' ? 'income' : 'expense'
  const text = typeof raw.text === 'string' ? raw.text.trim().slice(0, 500) : ''
  const amount = typeof raw.amount === 'string' || typeof raw.amount === 'number' ? String(raw.amount).slice(0, 40) : ''
  const categories = Array.isArray(raw.categories)
    ? raw.categories.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 30)
    : []
  const categoryTree = {}
  const rawTree = raw.categoryTree && typeof raw.categoryTree === 'object' && !Array.isArray(raw.categoryTree)
    ? raw.categoryTree
    : raw.subcategoryMap && typeof raw.subcategoryMap === 'object' && !Array.isArray(raw.subcategoryMap)
      ? raw.subcategoryMap
      : {}
  for (const category of categories) {
    categoryTree[category] = Array.isArray(rawTree[category])
      ? rawTree[category].filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 30)
      : []
  }
  if (!id || !text || categories.length === 0) {
    return null
  }
  return { id, type, text, amount, categories, categoryTree }
}

function fallbackCategory(categories) {
  return categories.includes('其他') ? '其他' : categories[0]
}

function fallbackSubcategory(categoryTree, category) {
  const options = categoryTree[category] || []
  return options[0] || ''
}

exports.main = async (event) => {
  const apiKey = process.env.TOKENHUB_API_KEY
  if (!apiKey) {
    return { ok: false, error: '云函数未配置 TOKENHUB_API_KEY，请在控制台为该函数添加环境变量。' }
  }

  const items = Array.isArray(event && event.items)
    ? event.items.map(normalizeItem).filter(Boolean).slice(0, 30)
    : []
  if (items.length === 0) {
    return { ok: true, items: [] }
  }

  const model = (process.env.TOKENHUB_MODEL || DEFAULT_MODEL).trim()
  const base = (process.env.TOKENHUB_BASE_URL || DEFAULT_BASE).replace(/\/$/, '')

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
            content:
              '请为以下账单选择分类，只能使用每条账单自己的 categories：\n' +
              JSON.stringify(
                items.map((item) => ({
                  id: item.id,
                  type: item.type,
                  amount: item.amount,
                  text: item.text,
                  categories: item.categories,
                  categoryTree: item.categoryTree,
                })),
              ),
          },
        ],
        temperature: 0.1,
      }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `请求 TokenHub 失败：${msg}` }
  }

  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `TokenHub HTTP ${res.status}：${text.slice(0, 800)}` }
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
    return { ok: false, error: '无法从模型输出中解析 JSON', raw: content.slice(0, 2000) }
  }

  const rawItems = Array.isArray(parsed && parsed.items) ? parsed.items : []
  const byId = new Map(items.map((item) => [item.id, item]))
  const out = rawItems
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const id = typeof item.id === 'string' ? item.id.trim() : ''
      const source = byId.get(id)
      if (!source) {
        return null
      }
      const category = typeof item.category === 'string' ? item.category.trim() : ''
      const safeCategory = source.categories.includes(category) ? category : fallbackCategory(source.categories)
      const subcategory = typeof item.subcategory === 'string' ? item.subcategory.trim() : ''
      return {
        id,
        category: safeCategory,
        subcategory: (source.categoryTree[safeCategory] || []).includes(subcategory)
          ? subcategory
          : fallbackSubcategory(source.categoryTree, safeCategory),
      }
    })
    .filter(Boolean)

  return { ok: true, items: out }
}
