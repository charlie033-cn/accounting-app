import { inferBuiltInCategory } from '../accounting/categoryRules'
import type { TransactionFormState, TransactionType } from '../types/transaction'

export type BillImportDraft = TransactionFormState & {
  id: string
  selected: boolean
  sourceText: string
  duplicate?: boolean
}

type ParsedTable = {
  headers: string[]
  rows: string[][]
}

const statusSkipWords = ['交易关闭', '已关闭', '失败', '已取消', '取消支付']

function normalizeHeader(value: string) {
  return value.replace(/\s/g, '').replace(/[（）]/g, (m) => (m === '（' ? '(' : ')')).toLowerCase()
}

function parseDelimitedLine(line: string, delimiter: ',' | '\t') {
  if (delimiter === '\t') {
    return line.split('\t').map((cell) => cell.trim().replace(/^"|"$/g, ''))
  }
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current.trim())
  return cells
}

function parseTable(text: string): ParsedTable | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) {
    return null
  }
  const delimiter: ',' | '\t' =
    lines.slice(0, 8).join('\n').split('\t').length > lines.slice(0, 8).join('\n').split(',').length ? '\t' : ','
  const parsed = lines.map((line) => parseDelimitedLine(line, delimiter))
  const headerIndex = parsed.findIndex((row) => {
    const headers = row.map(normalizeHeader)
    const hasDate = headers.some((h) => /交易时间|交易日期|支付时间|创建时间|日期|时间/.test(h))
    const hasAmount = headers.some((h) => /金额|支出|收入|收\/支|收支/.test(h))
    return hasDate && hasAmount
  })
  if (headerIndex < 0) {
    return null
  }
  return {
    headers: parsed[headerIndex],
    rows: parsed.slice(headerIndex + 1).filter((row) => row.some(Boolean)),
  }
}

function findIndex(headers: string[], patterns: RegExp[]) {
  const normalized = headers.map(normalizeHeader)
  return normalized.findIndex((header) => patterns.some((pattern) => pattern.test(header)))
}

function cleanAmount(raw: string) {
  const normalized = raw
    .replace(/[￥¥元,\s]/g, '')
    .replace(/[()（）]/g, '')
    .replace(/^收入$/, '')
    .replace(/^支出$/, '')
  const match = normalized.match(/[+-]?\d+(?:\.\d+)?/)
  if (!match) {
    return NaN
  }
  return Math.abs(Number(match[0]))
}

function parseDate(raw: string) {
  const match = raw.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (!match) {
    return ''
  }
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function inferType(rowText: string, amountRaw: string): TransactionType {
  if (/收入|收款|入账|退款|退回|\+/.test(rowText) || amountRaw.trim().startsWith('+')) {
    return 'income'
  }
  return 'expense'
}

function inferCategory(note: string, type: TransactionType, expenseOptions: string[], incomeOptions: string[]) {
  const options = type === 'income' ? incomeOptions : expenseOptions
  return inferBuiltInCategory(note, type, options)
}

export function parseBillImportText(
  text: string,
  expenseOptions: string[],
  incomeOptions: string[],
): BillImportDraft[] {
  const table = parseTable(text)
  if (!table) {
    throw new Error('未识别到账单表头，请上传微信/支付宝导出的 CSV 或文本账单')
  }

  const dateIndex = findIndex(table.headers, [/交易时间/, /交易日期/, /支付时间/, /创建时间/, /^日期$/, /^时间$/])
  const amountIndex = findIndex(table.headers, [/金额/, /交易金额/, /金额\(元\)/])
  const expenseIndex = findIndex(table.headers, [/支出/])
  const incomeIndex = findIndex(table.headers, [/收入/])
  const typeIndex = findIndex(table.headers, [/收\/支/, /收支/, /交易类型/, /^类型$/])
  const statusIndex = findIndex(table.headers, [/交易状态/, /当前状态/, /^状态$/])
  const noteIndexes = [
    findIndex(table.headers, [/交易对方/, /对方/, /商户/]),
    findIndex(table.headers, [/商品说明/, /商品/, /说明/, /备注/, /摘要/]),
  ].filter((index) => index >= 0)

  const drafts: BillImportDraft[] = []
  const seen = new Set<string>()

  for (const row of table.rows) {
    const rowText = row.join(' ')
    if (statusIndex >= 0 && statusSkipWords.some((word) => row[statusIndex]?.includes(word))) {
      continue
    }
    const date = parseDate(row[dateIndex] ?? rowText)
    const amountRaw =
      amountIndex >= 0
        ? row[amountIndex]
        : incomeIndex >= 0 && cleanAmount(row[incomeIndex] ?? '') > 0
          ? row[incomeIndex]
          : row[expenseIndex] ?? ''
    const amount = cleanAmount(amountRaw)
    if (!date || !Number.isFinite(amount) || amount <= 0) {
      continue
    }
    const explicitType = typeIndex >= 0 ? row[typeIndex] : ''
    const type =
      incomeIndex >= 0 && cleanAmount(row[incomeIndex] ?? '') > 0
        ? 'income'
        : expenseIndex >= 0 && cleanAmount(row[expenseIndex] ?? '') > 0
          ? 'expense'
          : inferType(`${explicitType} ${rowText}`, amountRaw)
    const note = noteIndexes
      .map((index) => row[index])
      .filter(Boolean)
      .join(' · ')
      .trim()
    const category = inferCategory(note || rowText, type, expenseOptions, incomeOptions)
    const key = `${type}|${date}|${amount.toFixed(2)}|${note || rowText}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    drafts.push({
      id: `${Date.now()}-${drafts.length}`,
      selected: true,
      type,
      amount: amount.toFixed(2),
      category,
      subcategory: '',
      transaction_date: date,
      note: note || '账单导入',
      sourceText: rowText,
    })
  }

  if (drafts.length === 0) {
    throw new Error('没有解析到可导入的账单')
  }
  return drafts
}
