/**
 * TokenHub 语音文本记账：将浏览器语音识别后的中文文本解析为支出账单草稿。
 * 控制台为该云函数配置环境变量：TOKENHUB_API_KEY（必填）
 * 可选：TOKENHUB_MODEL（默认 deepseek-v4-flash）、TOKENHUB_BASE_URL（默认 https://tokenhub.tencentmaas.com/v1）
 */
const DEFAULT_BASE = 'https://tokenhub.tencentmaas.com/v1'
const DEFAULT_MODEL = 'deepseek-v4-flash'

const SYSTEM_PROMPT = `你是记账 App 的语音记账解析助手。把用户口语化中文记账文本解析成一条或多条支出账单草稿。
必须只输出 JSON 对象，不要 markdown 代码围栏，不要解释。
输出格式必须为：{"drafts":[{"type":"expense","amount":"28","category":"餐饮","subcategory":"正餐","transaction_date":"YYYY-MM-DD","note":"午饭"}]}。
规则：
- 这个 App 只记录支出，type 必须是 "expense"。
- 如果用户一句话里包含多笔独立消费（例如“早餐10，午饭28，咖啡19”），必须拆成多条 drafts。
- 如果用户说的是合计/均摊/个人部分（例如“10个人吃了800，记我个人部分”），只输出用户应该记录的个人金额，不要输出总额。
- amount 必须是正数，字符串格式，不要包含币种符号。
- transaction_date 必须是 YYYY-MM-DD；结合输入里的 currentDate/yesterdayDate/tomorrowDate 解析“今天/昨天/明天/前天/几月几号”等。
- category 必须严格来自用户传入的 categories 数组；无法判断时返回 "其他"（如果存在），否则返回 categories 第一项。
- 如果传入 categoryTree，subcategory 必须严格来自 categoryTree[category] 数组；无法判断时返回该 category 下最通用或第一项二级分类。
- note 要简短自然，去掉金额、日期和明显的记账口令，比如“记一笔”“花了”“消费”等。
- 不要编造用户没说的具体商家、用途或日期。`

const CHAT_SYSTEM_PROMPT = `你叫“小猪查理”，是记账 App 里的会话式 AI 生活伙伴，不要自称记账助手。你会看到用户本轮输入、最近对话、当前待确认支出草稿 currentDrafts、真实账本摘要 transactionContext、可用 categories 和 categoryTree。
必须只输出 JSON 对象，不要 markdown 代码围栏，不要解释。
输出格式必须为：{"reply":"收到，小猪查理把这笔改好啦。","drafts":[{"id":"draft-1","type":"expense","amount":"28","category":"餐饮","subcategory":"正餐","transaction_date":"YYYY-MM-DD","note":"午饭"}]}。
reply 规则：
- reply 要像“小猪查理”在和用户聊天，轻松、自然、有一点点可爱和幽默，但不要啰嗦。
- 不要使用“记账助手”“草稿”“草稿箱”“JSON”“字段”“对象”等内部或技术概念。
- 可以说“这笔”“这几笔”“小猪查理帮你整理好了”“我改好啦”“你看下对不对”。
- 如果需要追问，也要口语化，例如“小猪查理有点没对上号，你是想改麦当劳那笔吗？”。
- 用户可以和你聊更广泛的日常话题，包括生活安排、学习计划、情绪陪伴、亲子沟通、做饭、旅行、购物选择、效率方法、常识问答、轻松闲聊、写作灵感等；只要安全合适，就像真正的 AI 生活助手一样自然回答。
- 用户聊消费、预算、账单复盘、金融常识、理财习惯、省钱建议、消费决策等相关话题时，可以更深入地聊，但不要给具体投资收益承诺或高风险投资建议。
- 用户问“最近的一笔高消费是什么”“上个月账单总额是多少”“分析半年消费趋势”“哪个分类花最多”等和真实账本数据相关的问题时，必须基于 transactionContext 里的真实数据回答；不要编造 transactionContext 中没有的数据。
- 做账本分析时，回答要给出关键数字、时间范围和简单结论；如果数据不足，要明确说“小猪查理这边数据还不够”，并建议用户继续记几笔。
- 回答账本分析问题时通常不要新增或修改 drafts，除非用户同时表达了新增/修改账单意图。
- 用户聊一般日常闲聊时，不要急着拉回记账；可以正常回答 1-3 个自然段，必要时追问一句继续聊。
- 只有当话题明显不安全、违法、成人、医疗诊断、投资荐股、攻击他人等高风险内容时，才温和拒绝或给安全建议。
- 如果用户只是闲聊且没有新增/修改/删除账单意图，drafts 原样返回，reply 给出自然回应；不要为了记账而强行收束。
- 可以在很自然的时机轻轻提醒你也能帮忙记账，但不要每次回复都提醒。
核心任务：
- 如果用户新增消费，就在 currentDrafts 基础上追加新草稿。
- 如果用户说“刚才那笔/里面的/它/第二笔/咖啡那笔/分类应该是交通/金额改成 35/日期改昨天/删掉打车”，必须结合 currentDrafts 和最近对话理解是在修改已有草稿，而不是要求用户补一条新支出。
- 如果用户要求修改分类，category 必须严格来自 categories；subcategory 必须严格来自 categoryTree[category]。
- 如果用户说“都改成某分类”，应用到所有相关草稿；如果指代不明确但 currentDrafts 只有一条，就改这一条。
- 如果用户删除草稿，从 drafts 中移除对应项。
- 返回 drafts 必须是修改后的完整待确认草稿列表，不只是本轮变化。
- 保留已有草稿 id；新增草稿可以不填 id。
- 这个 App 只记录支出，type 必须是 "expense"。
- amount 必须是正数字符串，不要包含币种符号。
- transaction_date 必须是 YYYY-MM-DD；结合 currentDate/yesterdayDate/tomorrowDate 解析相对日期。
- note 简短自然，去掉金额、日期和明显的记账口令。
- 如果无法理解用户想改哪一笔，drafts 原样返回，并在 reply 里追问用户。`

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

function fallbackSubcategory(categoryTree, category) {
  const options = categoryTree[category] || []
  return options[0] || ''
}

function normalizeDraft(raw, categories, categoryTree, currentDate) {
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
  const rawSubcategory = typeof raw.subcategory === 'string' ? raw.subcategory.trim() : ''
  const subcategory = (categoryTree[category] || []).includes(rawSubcategory)
    ? rawSubcategory
    : fallbackSubcategory(categoryTree, category)
  const note = typeof raw.note === 'string' ? raw.note.trim().slice(0, 80) : ''
  return {
    id: typeof raw.id === 'string' ? raw.id.trim().slice(0, 80) : undefined,
    type: 'expense',
    amount,
    category,
    subcategory,
    transaction_date: normalizeDate(raw.transaction_date, currentDate),
    note,
  }
}

function normalizeDrafts(parsed, categories, categoryTree, currentDate) {
  const rawDrafts = Array.isArray(parsed && parsed.drafts)
    ? parsed.drafts
    : Array.isArray(parsed && parsed.items)
      ? parsed.items
      : parsed && parsed.draft
        ? [parsed.draft]
        : []

  return rawDrafts
    .map((item) => normalizeDraft(item, categories, categoryTree, currentDate))
    .filter(Boolean)
    .slice(0, 10)
}

function normalizeTransactionContext(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  try {
    const serialized = JSON.stringify(raw)
    if (serialized.length > 14000) {
      return null
    }
    return JSON.parse(serialized)
  } catch {
    return null
  }
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
  const rawTree = event?.categoryTree && typeof event.categoryTree === 'object' && !Array.isArray(event.categoryTree)
    ? event.categoryTree
    : {}
  const categoryTree = {}
  for (const category of categories) {
    categoryTree[category] = Array.isArray(rawTree[category])
      ? rawTree[category].filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 30)
      : []
  }
  const currentDate = normalizeDate(event?.currentDate, new Date().toISOString().slice(0, 10))
  const yesterdayDate = normalizeDate(event?.yesterdayDate, currentDate)
  const tomorrowDate = normalizeDate(event?.tomorrowDate, currentDate)
  const mode = event?.mode === 'chat-accounting' ? 'chat-accounting' : 'voice-parse'
  const currentDrafts = Array.isArray(event?.currentDrafts)
    ? event.currentDrafts
      .map((item) => normalizeDraft(item, categories, categoryTree, currentDate))
      .filter(Boolean)
      .slice(0, 20)
    : []
  const recentMessages = Array.isArray(event?.recentMessages)
    ? event.recentMessages
      .filter((item) =>
        item &&
        typeof item === 'object' &&
        (item.role === 'assistant' || item.role === 'user') &&
        typeof item.text === 'string'
      )
      .map((item) => ({
        role: item.role,
        text: item.text.trim().slice(0, 240),
      }))
      .filter((item) => item.text)
      .slice(-8)
    : []
  const transactionContext = normalizeTransactionContext(event?.transactionContext)

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
          { role: 'system', content: mode === 'chat-accounting' ? CHAT_SYSTEM_PROMPT : SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              (mode === 'chat-accounting'
                ? '请结合上下文理解用户本轮输入，更新完整待确认草稿列表：\n'
                : '请解析这条语音记账文本，只能使用给定 categories 和 categoryTree：\n') +
              JSON.stringify({
                text,
                categories,
                categoryTree,
                currentDate,
                yesterdayDate,
                tomorrowDate,
                currentDrafts,
                recentMessages,
                transactionContext,
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

  const drafts = normalizeDrafts(parsed, categories, categoryTree, currentDate)
  if (mode !== 'chat-accounting' && drafts.length === 0) {
    return { ok: false, error: '模型未识别出有效账单', raw: content.slice(0, 2000) }
  }

  return {
    ok: true,
    draft: drafts[0],
    drafts,
    reply: typeof parsed?.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim().slice(0, 240)
      : undefined,
  }
}
