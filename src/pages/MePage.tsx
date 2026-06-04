import { useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { useAccounting } from '../context/AccountingContext'
import { parseBillImportText, type BillImportDraft } from '../lib/billImport'
import { classifyTransactionsWithTokenhub } from '../lib/classifyTransactionsTokenhub'

async function readBillFileText(file: File) {
  const buffer = await file.arrayBuffer()
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (!utf8.includes('�')) {
    return utf8
  }
  try {
    return new TextDecoder('gb18030').decode(buffer)
  } catch {
    return utf8
  }
}

export function MePage() {
  const {
    session,
    handleSignOut,
    transactions,
    categoryOptions,
    subcategoryOptions,
    saveTransactionsFromDrafts,
    formatMoney,
    isLoading,
    setMessage,
  } = useAccounting()
  const importFileRef = useRef<HTMLInputElement>(null)
  const [importDrafts, setImportDrafts] = useState<BillImportDraft[]>([])
  const [importError, setImportError] = useState('')
  const [importLoading, setImportLoading] = useState(false)

  if (!session) {
    return null
  }

  const accountName = session.email || 'User'
  const avatarLetter = accountName.trim().charAt(0).toUpperCase()
  const avatarHue = Array.from(accountName).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  ) % 360
  const selectedImportCount = importDrafts.filter((item) => item.selected).length
  const duplicateImportCount = importDrafts.filter((item) => item.duplicate).length
  const expenseSubcategoryMap = () => {
    const categories = categoryOptions('expense')
    return Object.fromEntries(categories.map((category) => [category, subcategoryOptions(category)]))
  }

  const markDuplicates = (drafts: BillImportDraft[]) => {
    const existingKeys = new Set(
      transactions.map((item) => `${item.type}|${item.transaction_date}|${Number(item.amount).toFixed(2)}|${item.category}`),
    )
    return drafts.map((draft) => {
      const duplicate = existingKeys.has(`${draft.type}|${draft.transaction_date}|${Number(draft.amount).toFixed(2)}|${draft.category}`)
      return {
        ...draft,
        duplicate,
        selected: duplicate ? false : draft.selected,
      }
    })
  }

  const refineImportCategories = async (drafts: BillImportDraft[]) => {
    const subcategoryMap = expenseSubcategoryMap()
    const candidates = drafts
      .filter((draft) => draft.category === '其他')
      .slice(0, 30)
      .map((draft) => ({
        id: draft.id,
        type: draft.type,
        amount: draft.amount,
        text: `${draft.note} ${draft.sourceText}`.trim(),
        categories: categoryOptions(draft.type),
        subcategoryMap: draft.type === 'expense' ? subcategoryMap : undefined,
      }))
      .filter((item) => item.categories.length > 0)
    if (candidates.length === 0) {
      return drafts
    }
    try {
      const classified = await classifyTransactionsWithTokenhub(candidates)
      return drafts.map((draft) => {
        const result = classified[draft.id]
        return result && categoryOptions(draft.type).includes(result.category)
          ? {
              ...draft,
              category: result.category,
              subcategory:
                draft.type === 'expense'
                  ? (result.subcategory && subcategoryOptions(result.category).includes(result.subcategory)
                      ? result.subcategory
                      : (subcategoryOptions(result.category)[0] ?? ''))
                  : '',
            }
          : draft
      })
    } catch {
      return drafts
    }
  }

  const onImportFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }
    if (!/\.(csv|txt)$/i.test(file.name) && !/text|csv/.test(file.type)) {
      setImportError('请上传 CSV 或 TXT 格式的账单文件')
      return
    }
    setImportLoading(true)
    setImportError('')
    try {
      const text = await readBillFileText(file)
      const drafts = parseBillImportText(text, categoryOptions('expense'), categoryOptions('income'))
      const withSubcategories = drafts.map((draft) => ({
        ...draft,
        subcategory: draft.type === 'expense' ? (subcategoryOptions(draft.category)[0] ?? '') : '',
      }))
      const refined = await refineImportCategories(withSubcategories)
      setImportDrafts(markDuplicates(refined))
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '账单解析失败')
    } finally {
      setImportLoading(false)
    }
  }

  const saveImportDrafts = async () => {
    const selected = importDrafts.filter((item) => item.selected && !item.duplicate)
    if (selected.length === 0) {
      setImportError('请选择至少一笔非重复账单')
      return
    }
    setImportError('')
    await saveTransactionsFromDrafts(
      selected.map((item) => ({
        type: item.type,
        amount: item.amount,
        category: item.category,
        subcategory: item.subcategory,
        transaction_date: item.transaction_date,
        note: item.note,
      })),
    )
    setMessage(`已导入 ${selected.length} 笔账单`)
    setImportDrafts([])
  }

  return (
    <div className="tab-page me-tab-page me-page">
      <header className="tab-page-header me-tab-header">
        <h1 className="app-title">我的</h1>
      </header>

      <section className="panel me-panel">
        <div className="me-profile">
          <div
            className="me-avatar"
            style={{ backgroundColor: `hsl(${avatarHue} 72% 45%)` }}
            aria-hidden
          >
            {avatarLetter}
          </div>
          <div className="me-profile-copy">
            <p className="me-email">{session.email}</p>
            <p className="muted me-blurb">数据与账号同步在云端，退出仅清除本机登录状态。</p>
          </div>
        </div>
      </section>

      <section className="panel me-panel me-import-panel">
        <input
          ref={importFileRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          hidden
          aria-hidden
          onChange={(e) => void onImportFileChange(e)}
        />
        <button
          type="button"
          className="me-panel-btn me-panel-btn--secondary"
          onClick={() => importFileRef.current?.click()}
          disabled={importLoading || isLoading}
        >
          {importLoading ? '解析中…' : '账单导入'}
        </button>
        <p className="muted me-import-hint">上传微信 / 支付宝 CSV，确认后批量入账。</p>
        {importError && importDrafts.length === 0 && <p className="alert error me-import-error">{importError}</p>}
      </section>

      <section className="panel me-panel">
        <div className="me-button-stack">
          <Link className="me-panel-btn me-panel-btn--secondary" to="/me/budget">
            预算管理
          </Link>
          <Link className="me-panel-btn me-panel-btn--secondary" to="/me/categories">
            分类管理
          </Link>
        </div>
      </section>

      <button
        type="button"
        className="me-panel-btn me-panel-btn--primary me-signout-btn"
        onClick={() => void handleSignOut()}
      >
        退出登录
      </button>

      {importDrafts.length > 0 && createPortal(
        <div className="ledger-receipt-sheet-layer" role="presentation">
          <button
            type="button"
            className="ledger-receipt-sheet-backdrop"
            aria-label="关闭账单导入"
            onClick={() => setImportDrafts([])}
            disabled={isLoading}
          />
          <section
            className="ledger-receipt-sheet me-import-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="me-import-title"
          >
            <div className="ledger-receipt-review-head">
              <h3 id="me-import-title">确认导入账单</h3>
              <button
                type="button"
                className="ledger-receipt-sheet-close"
                aria-label="关闭账单导入"
                onClick={() => setImportDrafts([])}
                disabled={isLoading}
              >
                ×
              </button>
            </div>

            <p className="muted small me-import-summary">
              识别到 {importDrafts.length} 笔，已选 {selectedImportCount} 笔
              {duplicateImportCount > 0 ? `，跳过 ${duplicateImportCount} 笔疑似重复` : ''}
            </p>
            {importError && <p className="alert error me-import-error">{importError}</p>}

            <div className="ledger-receipt-review-list">
              <ul className="me-import-list">
                {importDrafts.map((draft) => (
                  <li key={draft.id} className={draft.duplicate ? 'me-import-item is-duplicate' : 'me-import-item'}>
                    <label className="me-import-check">
                      <input
                        type="checkbox"
                        checked={draft.selected}
                        disabled={draft.duplicate}
                        onChange={(event) =>
                          setImportDrafts((prev) =>
                            prev.map((item) =>
                              item.id === draft.id ? { ...item, selected: event.target.checked } : item,
                            ),
                          )
                        }
                      />
                      <span>
                        <strong>{draft.type === 'income' ? '+' : '-'}{formatMoney(Number(draft.amount))}</strong>
                        <em>{draft.subcategory ? `${draft.category} / ${draft.subcategory}` : draft.category}</em>
                      </span>
                    </label>
                    <p className="me-import-note">{draft.note}</p>
                    <p className="muted small">
                      {draft.transaction_date}{draft.duplicate ? ' · 疑似重复，已跳过' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>

            <div className="ledger-receipt-sheet-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setImportDrafts([])}
                disabled={isLoading}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void saveImportDrafts()}
                disabled={isLoading || selectedImportCount === 0}
              >
                {isLoading ? '导入中…' : `导入 ${selectedImportCount} 笔`}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  )
}
