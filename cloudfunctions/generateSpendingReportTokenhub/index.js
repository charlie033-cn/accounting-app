/**
 * TokenHub 消费报告生成：基于聚合摘要输出自然语言复盘。
 * 控制台为该云函数配置环境变量：TOKENHUB_API_KEY（必填）
 * 可选：TOKENHUB_MODEL（默认 deepseek-v4-flash）、TOKENHUB_BASE_URL（默认 https://tokenhub.tencentmaas.com/v1）
 */
const DEFAULT_BASE = 'https://tokenhub.tencentmaas.com/v1'
const DEFAULT_MODEL = 'deepseek-v4-flash'

const SYSTEM_PROMPT = `你是个人记账 App 的智能消费分析师，名字叫“查理”。你要以用户所选月份为唯一统计主体，生成有证据、有上下文、有个性的中文消费月报；历史月份只能作为对比参考。
必须只输出 JSON 对象，不要 markdown 代码围栏，不要解释。
输出格式：
{
  "summary":"一句最重要的诊断",
  "narrative":"2-4句连贯分析",
  "comparisons":["与过去月份相比的变化"],
  "insights":[{"title":"发现标题","analysis":"解释这个发现为什么重要","evidence":["账单或数字依据"]}],
  "actions":[{"action":"下月具体行动","target":"可量化目标","reason":"为什么适合用户"}],
  "highlights":["兼容旧版的简短要点"],
  "suggestions":["兼容旧版的简短建议"]
}。
要求：
- 不要编造输入里没有的数据。
- 这个 App 的报告只分析支出，不要提收入、结余、理财收益或现金流。
- reportScope.reportMonth 是本报告唯一的统计月份。
- 所有“本月消费笔数”“本月总支出”“本月日均支出”“本月分类占比”“本月最大单笔”等统计，必须且只能取自 selectedMonth.summary，禁止将 comparisonReference 中任何历史月份的金额或笔数累加进来。
- selectedMonth.activity、selectedMonth.representativeExpenses 和 selectedMonth.repeatedPatterns 也只属于所选月份，可用于解释本月消费特征。
- comparisonReference.previousMonths 和 comparisonReference.comparison 只能用于单独的环比或趋势表达。提到历史数据时必须明确写成“相比上月”“相比近三个月”等，不能把它表述为本月统计。
- 生成前先检查：summary、narrative、insights、highlights 中出现的本月金额和笔数，应与 selectedMonth.summary 一致。
- summary 不要复述总支出，要直接指出这个月最值得关注的消费特征，并解释主要原因。
- narrative 要区分一次性大额、周期支出和日常习惯；如果移除某笔大额支出会改变结论，要明确说明。
- comparisons 1-3 条。只有输入包含 previousMonths 时才能做环比或趋势判断；没有历史数据时不要硬做比较。
- insights 2-4 条，每条必须包含判断、解释和 evidence。优先发现不容易从分类占比直接看出的关系，例如大额单笔对结构的影响、类别变化来源、重复消费模式、消费集中日期和周期支出压力。
- actions 1-3 条，必须贴合前面的发现，给出金额、比例、次数或执行方式之一；不要泛泛地说“减少消费”或“合理规划”。
- highlights 和 suggestions 用于兼容旧版页面，分别浓缩 insights 和 actions 的核心内容。
- 不要把预先计算的画像名称当作结论本身，要结合明细重新判断它是否合理。
- 不要每个月都使用相同句式，不要机械罗列所有数字，不要为了显得聪明而制造焦虑。
- 文案适合普通用户阅读，避免投资建议、道德评判和制造焦虑。`

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

function normalizeText(v, max = 160) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function isExpenseOnlyText(v) {
  return !/(收入|结余|现金流|理财收益|工资)/.test(v)
}

function normalizeList(v, maxItems) {
  return Array.isArray(v)
    ? v.map((item) => normalizeText(item, 120)).filter(Boolean).filter(isExpenseOnlyText).slice(0, maxItems)
    : []
}

function normalizeInsights(v) {
  if (!Array.isArray(v)) return []
  return v
    .map((item) => ({
      title: normalizeText(item && item.title, 40),
      analysis: normalizeText(item && item.analysis, 260),
      evidence: normalizeList(item && item.evidence, 3),
    }))
    .filter((item) => item.title && item.analysis && isExpenseOnlyText(item.analysis))
    .slice(0, 4)
}

function normalizeActions(v) {
  if (!Array.isArray(v)) return []
  return v
    .map((item) => ({
      action: normalizeText(item && item.action, 80),
      target: normalizeText(item && item.target, 80),
      reason: normalizeText(item && item.reason, 180),
    }))
    .filter((item) => item.action && item.reason && isExpenseOnlyText(item.reason))
    .slice(0, 3)
}

exports.main = async (event) => {
  const apiKey = process.env.TOKENHUB_API_KEY
  if (!apiKey) {
    return { ok: false, error: '云函数未配置 TOKENHUB_API_KEY，请在控制台为该函数添加环境变量。' }
  }

  const summary = event && typeof event.summary === 'object' && event.summary ? event.summary : null
  if (!summary) {
    return { ok: false, error: '缺少 summary 参数' }
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
              '请根据以下账单分析上下文生成所选月份的消费月报。selectedMonth 是唯一的本月统计数据源；comparisonReference 只能用于明确标注的历史对比，绝不能并入本月金额或笔数。只能使用输入中已有事实，并优先解释数字背后的原因：\n' +
              JSON.stringify(summary).slice(0, 14000),
          },
        ],
        temperature: 0.72,
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

  const out = {
    summary: isExpenseOnlyText(normalizeText(parsed.summary, 160)) ? normalizeText(parsed.summary, 160) : '',
    narrative: isExpenseOnlyText(normalizeText(parsed.narrative, 560))
      ? normalizeText(parsed.narrative, 560)
      : '',
    comparisons: normalizeList(parsed.comparisons, 3),
    insights: normalizeInsights(parsed.insights),
    actions: normalizeActions(parsed.actions),
    highlights: normalizeList(parsed.highlights, 4),
    suggestions: normalizeList(parsed.suggestions, 2),
  }
  if (
    !out.summary &&
    !out.narrative &&
    out.insights.length === 0 &&
    out.highlights.length === 0 &&
    out.suggestions.length === 0
  ) {
    return { ok: false, error: '模型返回内容为空' }
  }
  return { ok: true, report: out }
}
