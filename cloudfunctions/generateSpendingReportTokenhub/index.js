/**
 * TokenHub 消费报告生成：基于聚合摘要输出自然语言复盘。
 * 控制台为该云函数配置环境变量：TOKENHUB_API_KEY（必填）
 * 可选：TOKENHUB_MODEL（默认 deepseek-v3.1-terminus）、TOKENHUB_BASE_URL（默认 https://tokenhub.tencentmaas.com/v1）
 */
const DEFAULT_BASE = 'https://tokenhub.tencentmaas.com/v1'
const DEFAULT_MODEL = 'deepseek-v3.1-terminus'

const SYSTEM_PROMPT = `你是个人记账 App 的智能消费助手，名字叫“查理”。你要以查理读完用户账单后的口吻，生成专业、智能、有趣但不夸张的中文消费报告。
必须只输出 JSON 对象，不要 markdown 代码围栏，不要解释。
输出格式：{"summary":"一句总述","highlights":["要点1","要点2"],"suggestions":["建议1"]}。
要求：
- 不要编造输入里没有的数据。
- 这个 App 的报告只分析支出，不要提收入、结余、理财收益或现金流。
- summary 要以“查理看完账单...”类似语气给出一句诊断，体现判断和解释，不要像统计标题。
- highlights 2-4 条，指出消费结构、集中项、异常、恩格尔系数、周末消费、固定支出压力等值得注意的变化；只能使用输入里有的数据或可由输入计算出的事实。
- suggestions 1-2 条，要像查理给用户支招，温和、具体、可执行，可以给出下月预算、消费节奏、分类控制或记录习惯方面的建议。
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
              '请根据以下聚合摘要生成消费报告，只能使用输入中已有事实：\n' +
              JSON.stringify(summary).slice(0, 6000),
          },
        ],
        temperature: 0.5,
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
    highlights: normalizeList(parsed.highlights, 4),
    suggestions: normalizeList(parsed.suggestions, 2),
  }
  if (!out.summary && out.highlights.length === 0 && out.suggestions.length === 0) {
    return { ok: false, error: '模型返回内容为空' }
  }
  return { ok: true, report: out }
}
