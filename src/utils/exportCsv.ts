import type { Transaction } from '../types/transaction'

const csvEscape = (value: string | number | null) => {
  const stringValue = value === null ? '' : String(value)
  return `"${stringValue.replaceAll('"', '""')}"`
}

export const downloadTransactionsCsv = (transactions: Transaction[]) => {
  const headers = ['日期', '类型', '分类', '二级分类', '金额', '备注', '创建时间']
  const rows = transactions.map((item) => [
    item.transaction_date,
    item.type === 'expense' ? '支出' : '收入',
    item.category,
    item.subcategory ?? '',
    item.amount.toFixed(2),
    item.note,
    item.created_at,
  ])

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n')

  const blob = new Blob([`\uFEFF${csv}`], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
