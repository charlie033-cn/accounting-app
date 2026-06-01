/**
 * TokenHub 语音文本记账：将浏览器语音识别后的中文文本解析为支出账单草稿。
 * 控制台为该云函数配置环境变量：TOKENHUB_API_KEY（必填）
 * 可选：TOKENHUB_MODEL（默认 deepseek-v3.1-terminus）、TOKENHUB_BASE_URL（默认 https://tokenhub.tencentmaas.com/v1）
 */
const DEFAULT_BASE = 'https://tokenhub.tencentmaas.com/v1'
const DEFAULT_MODEL = 'deepseek-v3.1-terminus'

const SYSTEM_PROMPT = `你是记账 App 的语音记账解析助手。把用户口语化中文记账文本解析成一条或多条支出账单草稿。
必须只输出 JSON 对象，不要 markdown 代码围栏，不要解释。
输出格式必须为：{"drafts":[{"type":"expense","amount":"28","category":"餐饮","transaction_date":"YYYY-MM-DD","note":"午饭"}]}。
规则：
- 这个 App 只记录支出，type 必须是 "expense"。
- 如果用户一句话里包含多笔独立消费（例如“早餐10，午饭28，咖啡19”），必须拆成多条 drafts。
- 如果用户说的是合计/均摊/个人部分（例如“10个人吃了800，记我个人部分”），只输出用户应该记录的个人金额，不要输出总额。
- amount 必须是正数，字符串格式，不要包含币种符号。
- transaction_date 必须是 YYYY-MM-DD；结合输入里的 currentDate/yesterdayDate/tomorrowDate 解析“今天/昨天/明天/前天/几月几号”等。
- category 必须严格来自用户传入的 categories 数组；无法判断时返回 "其他"（如果存在），否则返回 categories 第一项。
- note 要简短自然，去掉金额、日期和明显的记账口令，比如“记一笔”“花了”“消费”等。
- 不要编造用户没说的具体商家、用途或日期。`

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

function normalizeDate(value, fallback) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? value.trim()
    : fallback
}

function fallbackCategory(categories) {
  return categories.includes('其他') ? '其他' : categories[0]
}

function normalizeDraft(raw, categories, currentDate) {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const amount = typeof raw.amount === 'string' || typeof raw.amount === 'number'
    ? String(raw.amount).replace(/[￥¥元,\s]/g, '').trim()
    : ''
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return null
  }
  const category = typeof raw.category === 'string' && categories.includes(raw.category.trim())
    ? raw.category.trim()
    : fallbackCategory(categories)
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 80) : ''
  return {
    type: 'expense',
    amount,
    category,
    transaction_date: normalizeDate(raw.transaction_date, currentDate),
    note,
  }
}

function normalizeDrafts(parsed, categories, currentDate) {
  const rawDrafts = Array.isArray(parsed && parsed.drafts)
    ? parsed.drafts
    : Array.isArray(parsed && parsed.items)
      ? parsed.items
      : parsed && parsed.draft
        ? [parsed.draft]
        : []

  return rawDrafts
    .map((item) => normalizeDraft(item, categories, currentDate))
    .filter(Boolean)
    .slice(0, 10)
}

exports.main = async (event) => {
  const apiKey = process.env.TOKENHUB_API_KEY
  if (!apiKey) {
    return { ok: false, error: '云函数未配置 TOKENHUB_API_KEY，请在控制台为该函数添加环境变量。' }
  }

  const text = typeof event?.text === 'string' ? event.text.trim().slice(0, 500) : ''
  const categories = Array.isArray(event?.categories)
    ? event.categories.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 30)
    : []
  const currentDate = normalizeDate(event?.currentDate, new Date().toISOString().slice(0, 10))
  const yesterdayDate = normalizeDate(event?.yesterdayDate, currentDate)
  const tomorrowDate = normalizeDate(event?.tomorrowDate, currentDate)

  if (!text) {
    return { ok: false, error: '缺少语音文本' }
  }
  if (categories.length === 0) {
    return { ok: false, error: '缺少分类列表' }
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
              '请解析这条语音记账文本，只能使用给定 categories：\n' +
              JSON.stringify({
                text,
                categories,
                currentDate,
                yesterdayDate,
                tomorrowDate,
              }),
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
    const body = await res.text()
    return { ok: false, error: `TokenHub HTTP ${res.status}：${body.slice(0, 800)}` }
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

  const drafts = normalizeDrafts(parsed, categories, currentDate)
  if (drafts.length === 0) {
    return { ok: false, error: '模型未识别出有效账单', raw: content.slice(0, 2000) }
  }

  return { ok: true, draft: drafts[0], drafts }
}
