import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { PERSONAL_ASSET_COLLECTION, todayISO } from '../accounting/constants'
import { ConfirmActionSheet } from '../components/ConfirmActionSheet'
import { useAccounting } from '../context/AccountingContext'
import { cloudbaseDb } from '../lib/cloudbase'
import type { PersonalAsset, PersonalAssetStatus, PersonalAssetType } from '../types/personalAsset'

type CloudPersonalAsset = Omit<PersonalAsset, 'id'> & { _id: string }

const ASSET_TYPES: PersonalAssetType[] = [
  '房子',
  '车子',
  '手机',
  '电脑',
  '家电',
  '家具',
  '数码',
  '奢侈品',
  '其他',
]

const ASSET_EMOJI: Record<PersonalAssetType, string> = {
  房子: '🏠',
  车子: '🚗',
  手机: '📱',
  电脑: '💻',
  家电: '🔌',
  家具: '🪑',
  数码: '🎧',
  奢侈品: '👜',
  其他: '📦',
}

const ASSET_STATUS_LABEL: Record<PersonalAssetStatus, string> = {
  serving: '服役中',
  retired: '已退役',
  sold: '已卖出',
}

function assetCloudMessage(raw: string) {
  if (
    raw.includes('Db or Table not exist') ||
    raw.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    raw.includes('ResourceNotFound') ||
    raw.includes('COLLECTION_NOT_EXIST')
  ) {
    return '云端还没有我的家当数据库集合。请先创建 personal_assets 集合后刷新。'
  }
  return raw
}

function toAsset(row: CloudPersonalAsset): PersonalAsset {
  return {
    id: row._id,
    user_id: row.user_id,
    name: row.name,
    type: ASSET_TYPES.includes(row.type) ? row.type : '其他',
    status: row.status === 'retired' || row.status === 'sold' ? row.status : 'serving',
    amount: Number(row.amount || 0),
    purchase_date: row.purchase_date,
    note: row.note ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function daysSince(date: string) {
  const start = new Date(`${date}T00:00:00`)
  const end = new Date(`${todayISO()}T00:00:00`)
  const diff = end.getTime() - start.getTime()
  if (!Number.isFinite(diff)) {
    return 1
  }
  return Math.max(1, Math.floor(diff / 86_400_000) + 1)
}

function formatAssetDate(date: string) {
  if (!date || date.length < 10) {
    return date || '-'
  }
  return date.replace(/-/g, '.')
}

function dateFromPurchaseDay(purchaseDate: string, day: number) {
  const start = new Date(`${purchaseDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) {
    return todayISO()
  }
  start.setDate(start.getDate() + Math.max(1, day) - 1)
  const year = String(start.getFullYear())
  const month = String(start.getMonth() + 1).padStart(2, '0')
  const value = String(start.getDate()).padStart(2, '0')
  return `${year}-${month}-${value}`
}

function buildDailyCostCurve(amount: number, usedDays: number) {
  const safeDays = Math.max(1, usedDays)
  const chartWidth = Math.max(320, Math.ceil((safeDays / 365) * 320))
  const maxCost = amount
  const minCost = amount / safeDays
  const range = Math.max(1, maxCost - minCost)
  const points = Array.from({ length: safeDays }, (_, index) => {
    const day = index + 1
    const cost = amount / day
    const x = safeDays === 1 ? 0 : (index / (safeDays - 1)) * chartWidth
    const y = 12 + (1 - (cost - minCost) / range) * 108
    return { x, y, day, cost }
  })
  return { chartWidth, points }
}

export function PersonalAssetsPage() {
  const { session, formatMoney, setMessage } = useAccounting()
  const db = cloudbaseDb
  const chartScrollRef = useRef<HTMLDivElement>(null)
  const [assets, setAssets] = useState<PersonalAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null)
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PersonalAsset | null>(null)
  const [selectedCurveDay, setSelectedCurveDay] = useState<number | null>(null)
  const [assetName, setAssetName] = useState('')
  const [assetType, setAssetType] = useState<PersonalAssetType>('手机')
  const [assetStatus, setAssetStatus] = useState<PersonalAssetStatus>('serving')
  const [assetAmount, setAssetAmount] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(todayISO())
  const [assetNote, setAssetNote] = useState('')

  const assetRows = useMemo(() => {
    return assets.map((asset) => {
      const usedDays = daysSince(asset.purchase_date)
      return {
        ...asset,
        usedDays,
        dailyCost: asset.amount / usedDays,
      }
    })
  }, [assets])

  const overview = useMemo(() => {
    const totalAmount = assetRows.reduce((sum, asset) => sum + asset.amount, 0)
    const totalDailyCost = assetRows.reduce((sum, asset) => sum + asset.dailyCost, 0)
    const servingCount = assetRows.filter((asset) => asset.status === 'serving').length
    const retiredCount = assetRows.filter((asset) => asset.status === 'retired').length
    const soldCount = assetRows.filter((asset) => asset.status === 'sold').length
    return {
      totalAmount,
      totalDailyCost,
      servingCount,
      retiredCount,
      soldCount,
    }
  }, [assetRows])

  const detailAsset = detailAssetId ? assetRows.find((asset) => asset.id === detailAssetId) ?? null : null
  const editingAsset = editingAssetId ? assets.find((asset) => asset.id === editingAssetId) ?? null : null
  const detailCurve = detailAsset
    ? buildDailyCostCurve(detailAsset.amount, detailAsset.usedDays)
    : { chartWidth: 320, points: [] }
  const detailCurvePath = detailCurve.points.map((point) => `${point.x},${point.y}`).join(' ')
  const selectedCurvePoint =
    detailAsset && detailCurve.points.length > 0
      ? (detailCurve.points.find((point) => point.day === (selectedCurveDay ?? detailAsset.usedDays)) ??
        detailCurve.points[detailCurve.points.length - 1])
      : null
  const selectedCurveDate =
    detailAsset && selectedCurvePoint
      ? dateFromPurchaseDay(detailAsset.purchase_date, selectedCurvePoint.day)
      : todayISO()

  const resetForm = () => {
    setEditingAssetId(null)
    setAssetName('')
    setAssetType('手机')
    setAssetStatus('serving')
    setAssetAmount('')
    setPurchaseDate(todayISO())
    setAssetNote('')
    setError('')
    setSheetOpen(false)
  }

  const openCreateSheet = () => {
    resetForm()
    setSheetOpen(true)
  }

  const beginEditAsset = (asset: PersonalAsset) => {
    setEditingAssetId(asset.id)
    setAssetName(asset.name)
    setAssetType(asset.type)
    setAssetStatus(asset.status)
    setAssetAmount(String(asset.amount))
    setPurchaseDate(asset.purchase_date)
    setAssetNote(asset.note ?? '')
    setError('')
    setSheetOpen(true)
  }

  const loadAssets = async () => {
    if (!db || !session) {
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await db
        .collection(PERSONAL_ASSET_COLLECTION)
        .where({ user_id: session.userId })
        .orderBy('created_at', 'desc')
        .get()
      setAssets((result.data as CloudPersonalAsset[]).map(toAsset))
    } catch (err) {
      const raw = err instanceof Error ? err.message : '我的家当加载失败'
      setError(assetCloudMessage(raw))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAssets()
    }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId])

  useEffect(() => {
    if (!sheetOpen && !detailAssetId && !deleteTarget) {
      return
    }

    const scrollY = window.scrollY
    const { body } = document
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    }

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'

    return () => {
      body.style.position = previous.position
      body.style.top = previous.top
      body.style.left = previous.left
      body.style.right = previous.right
      body.style.width = previous.width
      body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [sheetOpen, detailAssetId, deleteTarget])

  useEffect(() => {
    if (!detailAsset) {
      return
    }
    const usedDays = detailAsset.usedDays
    const timer = window.setTimeout(() => {
      setSelectedCurveDay(usedDays)
      const chart = chartScrollRef.current
      if (chart) {
        chart.scrollLeft = chart.scrollWidth - chart.clientWidth
      }
    }, 0)
    return () => window.clearTimeout(timer)
  }, [detailAsset])

  const selectCurvePoint = (event: PointerEvent<HTMLDivElement>) => {
    if (!detailAsset) {
      return
    }
    const chart = chartScrollRef.current
    if (!chart) {
      return
    }
    const rect = chart.getBoundingClientRect()
    const x = event.clientX - rect.left + chart.scrollLeft
    const ratio = detailCurve.chartWidth > 0 ? Math.max(0, Math.min(1, x / detailCurve.chartWidth)) : 1
    const nextDay = Math.max(1, Math.min(detailAsset.usedDays, Math.round(1 + ratio * (detailAsset.usedDays - 1))))
    setSelectedCurveDay(nextDay)
  }

  const handleSaveAsset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!db || !session) {
      return
    }
    const name = assetName.trim()
    const amount = Number(assetAmount)
    if (!name) {
      setError('请填写资产名称')
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('请填写有效的购买金额')
      return
    }
    if (!purchaseDate) {
      setError('请选择购买日期')
      return
    }

    setSaving(true)
    setError('')
    try {
      const now = new Date().toISOString()
      const payload = {
        user_id: session.userId,
        name,
        type: assetType,
        status: assetStatus,
        amount,
        purchase_date: purchaseDate,
        note: assetNote.trim() || null,
        updated_at: now,
      }
      if (editingAsset) {
        await db.collection(PERSONAL_ASSET_COLLECTION).doc(editingAsset.id).update(payload)
      } else {
        await db.collection(PERSONAL_ASSET_COLLECTION).add({
          ...payload,
          created_at: now,
        })
      }
      resetForm()
      setMessage(editingAsset ? '已更新资产信息' : '已添加到我的家当')
      await loadAssets()
    } catch (err) {
      const raw = err instanceof Error ? err.message : '资产保存失败'
      setError(assetCloudMessage(raw))
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAsset = async () => {
    if (!db || !session || !deleteTarget) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await db.collection(PERSONAL_ASSET_COLLECTION).doc(deleteTarget.id).remove()
      setMessage('已删除资产')
      setDeleteTarget(null)
      setDetailAssetId(null)
      await loadAssets()
    } catch (err) {
      const raw = err instanceof Error ? err.message : '资产删除失败'
      setError(assetCloudMessage(raw))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="sub-page-shell personal-assets-shell">
      <div className="sub-page sub-page--standalone personal-assets-page">
        <header className="sub-page-nav">
          <Link className="sub-page-icon-back" to="/more" aria-label="返回更多">
            <span aria-hidden>←</span>
          </Link>
          <h1 className="sub-page-title">我的家当</h1>
        </header>

        <section className="personal-assets-overview" aria-label="资产总览">
          <div>
            <span>我的资产总值</span>
            <strong>{formatMoney(overview.totalAmount)}</strong>
          </div>
          <div className="personal-assets-overview-grid">
            <article>
              <span>综合日均成本</span>
              <strong>{formatMoney(overview.totalDailyCost)} / 天</strong>
            </article>
          </div>
          <div className="personal-assets-status-grid">
            <article>
              <span>服役中</span>
              <strong>{overview.servingCount} 件</strong>
            </article>
            <article>
              <span>已退役</span>
              <strong>{overview.retiredCount} 件</strong>
            </article>
            <article>
              <span>已卖出</span>
              <strong>{overview.soldCount} 件</strong>
            </article>
          </div>
        </section>

        {error && !sheetOpen && <p className="alert error">{error}</p>}
        {loading && <p className="muted personal-assets-loading">加载我的家当…</p>}

        {!loading && assetRows.length === 0 && !error ? (
          <section className="empty-state personal-assets-empty">
            <h3>记录你的第一件资产</h3>
            <p>房子、车子、手机、电脑都可以记录，看看它们用到今天每天摊下来多少钱。</p>
          </section>
        ) : (
          <section className="personal-assets-list" aria-label="资产列表">
            {assetRows.map((asset) => (
              <button
                type="button"
                className="personal-asset-card"
                key={asset.id}
                onClick={() => setDetailAssetId(asset.id)}
              >
                <div className="personal-asset-icon" aria-hidden>
                  {ASSET_EMOJI[asset.type]}
                </div>
                <div className="personal-asset-main">
                  <div className="personal-asset-head">
                    <div>
                      <h2>{asset.name}</h2>
                      <p>
                        {asset.type} · {ASSET_STATUS_LABEL[asset.status]} · 购买于 {formatAssetDate(asset.purchase_date)}
                      </p>
                    </div>
                    <strong>{formatMoney(asset.dailyCost)} / 天</strong>
                  </div>
                  <div className="personal-asset-meta">
                    <span>购买金额 {formatMoney(asset.amount)}</span>
                    <span>已使用 {asset.usedDays} 天</span>
                  </div>
                  {asset.note ? <p className="personal-asset-note">{asset.note}</p> : null}
                </div>
              </button>
            ))}
          </section>
        )}

        <button
          type="button"
          className="personal-assets-add-fab"
          aria-label="新增资产"
          onClick={() => {
            setError('')
            openCreateSheet()
          }}
        >
          <span aria-hidden>+</span>
        </button>
      </div>

      {detailAsset && createPortal(
        <div className="ledger-receipt-sheet-layer personal-assets-detail-layer" role="presentation">
          <button
            type="button"
            className="ledger-receipt-sheet-backdrop"
            aria-label="关闭资产详情"
            onClick={() => setDetailAssetId(null)}
            disabled={saving}
          />
          <section
            className="ledger-receipt-sheet personal-assets-sheet personal-assets-detail-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="personal-assets-detail-title"
          >
            <div className="personal-asset-detail-topbar">
              <button
                type="button"
                className="personal-asset-detail-close"
                aria-label="关闭资产详情"
                onClick={() => setDetailAssetId(null)}
                disabled={saving}
              >
                ×
              </button>
              <button
                type="button"
                className="secondary-button personal-asset-detail-edit"
                onClick={() => beginEditAsset(detailAsset)}
                disabled={saving}
              >
                编辑
              </button>
            </div>
            <div className="personal-asset-detail-hero">
              <div className="personal-asset-detail-icon" aria-hidden>
                {ASSET_EMOJI[detailAsset.type]}
              </div>
              <span>{ASSET_STATUS_LABEL[detailAsset.status]}</span>
              <h3 id="personal-assets-detail-title">{detailAsset.name}</h3>
              <strong>{formatMoney(detailAsset.dailyCost)} / 天</strong>
              <p>
                总价 · {formatMoney(detailAsset.amount)} 已使用 {detailAsset.usedDays} 天
              </p>
            </div>

            <section className="personal-asset-detail-card" aria-label="日均成本曲线">
              <h4>日均成本</h4>
              <div className="personal-asset-cost-chart">
                <div
                  className="personal-asset-chart-scroll"
                  ref={chartScrollRef}
                  onPointerUp={selectCurvePoint}
                  role="presentation"
                >
                  <svg
                    viewBox={`0 0 ${detailCurve.chartWidth} 140`}
                    style={{ width: `${detailCurve.chartWidth}px` }}
                    role="img"
                    aria-label="资产日均成本曲线"
                  >
                  <path
                    d={`M0 24H${detailCurve.chartWidth}M0 64H${detailCurve.chartWidth}M0 104H${detailCurve.chartWidth}`}
                    className="personal-asset-chart-grid"
                  />
                  <polyline className="personal-asset-chart-line" points={detailCurvePath} />
                  {selectedCurvePoint ? (
                    <circle
                      className="personal-asset-chart-dot"
                      cx={selectedCurvePoint.x}
                      cy={selectedCurvePoint.y}
                      r="5"
                    />
                  ) : null}
                  </svg>
                </div>
                <div className="personal-asset-chart-current">
                  <strong>{selectedCurvePoint ? formatMoney(selectedCurvePoint.cost) : formatMoney(detailAsset.dailyCost)}</strong>
                  <span>{formatAssetDate(selectedCurveDate)}</span>
                </div>
                <div className="personal-asset-chart-axis">
                  <span>{formatAssetDate(detailAsset.purchase_date)}</span>
                  <span>今天</span>
                </div>
              </div>
            </section>

            <section className="personal-asset-detail-card personal-asset-detail-meta" aria-label="资产信息">
              <p>
                <span>价格</span>
                <strong>{formatMoney(detailAsset.amount)}</strong>
              </p>
              <p>
                <span>类别</span>
                <strong>{detailAsset.type}</strong>
              </p>
              <p>
                <span>购买日期</span>
                <strong>{detailAsset.purchase_date}</strong>
              </p>
              {detailAsset.note ? (
                <p>
                  <span>备注</span>
                  <strong>{detailAsset.note}</strong>
                </p>
              ) : null}
            </section>

            <button
              type="button"
              className="personal-asset-delete-button"
              onClick={() => setDeleteTarget(detailAsset)}
              disabled={saving}
            >
              删除
            </button>
          </section>
        </div>,
        document.body,
      )}

      {sheetOpen && createPortal(
        <div className="ledger-receipt-sheet-layer personal-assets-sheet-layer" role="presentation">
          <button
            type="button"
            className="ledger-receipt-sheet-backdrop"
            aria-label="关闭新增资产"
            onClick={resetForm}
            disabled={saving}
          />
          <section
            className="ledger-receipt-sheet personal-assets-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="personal-assets-create-title"
          >
            <div className="ledger-receipt-review-head">
              <h3 id="personal-assets-create-title">{editingAsset ? '编辑资产' : '新增资产'}</h3>
              <button
                type="button"
                className="ledger-receipt-sheet-close"
                aria-label="关闭新增资产"
                onClick={resetForm}
                disabled={saving}
              >
                ×
              </button>
            </div>
            <form className="form-grid personal-assets-sheet-form" onSubmit={handleSaveAsset}>
              <div className="personal-assets-sheet-scroll">
                <label>
                  资产名称
                  <input
                    value={assetName}
                    onChange={(event) => setAssetName(event.target.value)}
                    placeholder="例如 iPhone 16 Pro"
                  />
                </label>
                <label>
                  资产类型
                  <select
                    value={assetType}
                    onChange={(event) => setAssetType(event.target.value as PersonalAssetType)}
                  >
                    {ASSET_TYPES.map((type) => (
                      <option value={type} key={type}>
                        {ASSET_EMOJI[type]} {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  资产状态
                  <select
                    value={assetStatus}
                    onChange={(event) => setAssetStatus(event.target.value as PersonalAssetStatus)}
                  >
                    <option value="serving">服役中</option>
                    <option value="retired">已退役</option>
                    <option value="sold">已卖出</option>
                  </select>
                </label>
                <label>
                  购买金额
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={assetAmount}
                    onChange={(event) => setAssetAmount(event.target.value)}
                    placeholder="0.00"
                  />
                </label>
                <label>
                  购买日期
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(event) => setPurchaseDate(event.target.value)}
                  />
                </label>
                <label>
                  备注
                  <textarea
                    value={assetNote}
                    onChange={(event) => setAssetNote(event.target.value)}
                    placeholder="选填，可以记录型号、用途或购买渠道"
                  />
                </label>
                {error && <p className="alert error">{error}</p>}
              </div>
              <div className="ledger-receipt-sheet-actions">
                <button type="button" className="secondary-button" onClick={resetForm} disabled={saving}>
                  取消
                </button>
                <button className="primary-button" type="submit" disabled={saving || loading}>
                  {saving ? '保存中…' : editingAsset ? '保存修改' : '保存资产'}
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}
      <ConfirmActionSheet
        open={deleteTarget != null}
        title="删除资产"
        description="删除后，这条资产和它的日均成本记录都会被移除。"
        confirmText="删除"
        busy={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteAsset()}
      />
    </main>
  )
}
