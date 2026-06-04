import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import {
  STORED_VALUE_CARD_COLLECTION,
  STORED_VALUE_CARD_RECORD_COLLECTION,
  TRANSACTION_COLLECTION,
  todayISO,
} from '../accounting/constants'
import { ConfirmActionSheet } from '../components/ConfirmActionSheet'
import { useAccounting } from '../context/AccountingContext'
import { cloudbaseDb } from '../lib/cloudbase'
import type { StoredValueCard, StoredValueCardRecord } from '../types/storedValueCard'

type CloudStoredValueCard = Omit<StoredValueCard, 'id'> & { _id: string }
type CloudStoredValueCardRecord = Omit<StoredValueCardRecord, 'id'> & { _id: string }
type CloudStoredValueTransaction = {
  _id: string
  user_id: string
  type: 'expense' | 'income'
  amount: number
  transaction_date: string
  note?: string | null
  source?: string | null
}

const moneyCents = (value: number) => Math.round(Number(value || 0) * 100)

const toCard = (row: CloudStoredValueCard): StoredValueCard => ({
  id: row._id,
  user_id: row.user_id,
  name: row.name,
  merchant: row.merchant,
  category: row.category,
  subcategory: row.subcategory ?? null,
  balance: Number(row.balance || 0),
  total_recharged: Number(row.total_recharged || 0),
  total_spent: Number(row.total_spent || 0),
  low_balance_threshold: row.low_balance_threshold == null ? null : Number(row.low_balance_threshold),
  expire_date: row.expire_date ?? null,
  status: row.status === 'archived' ? 'archived' : 'active',
  note: row.note ?? null,
  linked_transaction_id: row.linked_transaction_id ?? null,
  created_at: row.created_at,
  updated_at: row.updated_at,
})

const toRecord = (row: CloudStoredValueCardRecord): StoredValueCardRecord => ({
  id: row._id,
  user_id: row.user_id,
  card_id: row.card_id,
  type: row.type,
  amount: Number(row.amount || 0),
  balance_after: Number(row.balance_after || 0),
  transaction_date: row.transaction_date,
  note: row.note ?? null,
  linked_transaction_id: row.linked_transaction_id ?? null,
  created_at: row.created_at,
})

function storedValueCloudMessage(raw: string) {
  if (
    raw.includes('Db or Table not exist') ||
    raw.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    raw.includes('ResourceNotFound') ||
    raw.includes('COLLECTION_NOT_EXIST')
  ) {
    return '云端还没有储值卡数据库集合。请先创建 stored_value_cards 和 stored_value_card_records 两个集合后刷新。'
  }
  return raw
}

export function StoredValueCardsPage() {
  const {
    session,
    formatMoney,
    categoryOptions,
    subcategoryOptions,
    loadTransactions,
    setMessage,
  } = useAccounting()
  const db = cloudbaseDb
  const expenseOptions = categoryOptions('expense')
  const [cards, setCards] = useState<StoredValueCard[]>([])
  const [records, setRecords] = useState<StoredValueCardRecord[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [cardSheetOpen, setCardSheetOpen] = useState(false)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [recordSheetType, setRecordSheetType] = useState<'spend' | 'recharge' | null>(null)
  const [detailCardId, setDetailCardId] = useState<string | null>(null)
  const [disableCardTarget, setDisableCardTarget] = useState<StoredValueCard | null>(null)
  const [deleteCardTarget, setDeleteCardTarget] = useState<StoredValueCard | null>(null)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [deleteRecordTarget, setDeleteRecordTarget] = useState<StoredValueCardRecord | null>(null)
  const [swipedRecordId, setSwipedRecordId] = useState<string | null>(null)

  const [cardName, setCardName] = useState('')
  const [merchant, setMerchant] = useState('')
  const [category, setCategory] = useState(() => expenseOptions[0] ?? '')
  const [subcategory, setSubcategory] = useState('')
  const [initialAmount, setInitialAmount] = useState('')
  const [expireDate, setExpireDate] = useState('')
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState('100')
  const [cardNote, setCardNote] = useState('')
  const [syncInitialTransaction, setSyncInitialTransaction] = useState(true)

  const [recordAmount, setRecordAmount] = useState('')
  const [recordDate, setRecordDate] = useState(todayISO())
  const [recordNote, setRecordNote] = useState('')
  const [syncRechargeTransaction, setSyncRechargeTransaction] = useState(true)

  const selectedCard = cards.find((item) => item.id === selectedCardId) ?? cards[0] ?? null
  const detailCard = detailCardId ? cards.find((item) => item.id === detailCardId) ?? null : null
  const editingCard = editingCardId ? cards.find((item) => item.id === editingCardId) ?? null : null
  const editingRecord = editingRecordId ? records.find((item) => item.id === editingRecordId) ?? null : null
  const effectiveCategory = expenseOptions.includes(category) ? category : (expenseOptions[0] ?? '')
  const subcategoryOptionsForCard = subcategoryOptions(effectiveCategory)
  const effectiveSubcategory = subcategoryOptionsForCard.includes(subcategory) ? subcategory : ''

  const detailCardRecords = useMemo(() => {
    if (!detailCard) {
      return []
    }
    return records.filter((record) => record.card_id === detailCard.id)
  }, [records, detailCard])

  const resetCardForm = () => {
    setEditingCardId(null)
    setCardName('')
    setMerchant('')
    setCategory(expenseOptions[0] ?? '')
    setInitialAmount('')
    setExpireDate('')
    setLowBalanceThreshold('100')
    setCardNote('')
    setSubcategory('')
    setSyncInitialTransaction(true)
    setCardSheetOpen(false)
  }

  const openCreateCardSheet = () => {
    resetCardForm()
    setCardSheetOpen(true)
  }

  const beginEditCard = (card: StoredValueCard) => {
    setEditingCardId(card.id)
    setCardName(card.name)
    setMerchant(card.merchant)
    setCategory(card.category)
    setSubcategory(card.subcategory ?? '')
    setExpireDate(card.expire_date ?? '')
    setLowBalanceThreshold(card.low_balance_threshold == null ? '' : String(card.low_balance_threshold))
    setCardNote(card.note ?? '')
    setError('')
    setCardSheetOpen(true)
  }

  const loadStoredValueCards = async () => {
    if (!db || !session) {
      return
    }
    setLoading(true)
    setError('')
    try {
      const [cardResult, recordResult] = await Promise.all([
        db
          .collection(STORED_VALUE_CARD_COLLECTION)
          .where({ user_id: session.userId })
          .orderBy('updated_at', 'desc')
          .get(),
        db
          .collection(STORED_VALUE_CARD_RECORD_COLLECTION)
          .where({ user_id: session.userId })
          .orderBy('transaction_date', 'desc')
          .orderBy('created_at', 'desc')
          .get(),
      ])
      const nextCards = (cardResult.data as CloudStoredValueCard[]).map(toCard)
      setCards(nextCards)
      setRecords((recordResult.data as CloudStoredValueCardRecord[]).map(toRecord))
      setSelectedCardId((current) => current ?? nextCards[0]?.id ?? null)
    } catch (err) {
      const raw = err instanceof Error ? err.message : '储值卡加载失败'
      setError(storedValueCloudMessage(raw))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStoredValueCards()
    }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId])

  useEffect(() => {
    const sheetOpen =
      cardSheetOpen ||
      recordSheetType != null ||
      detailCardId != null ||
      disableCardTarget != null ||
      deleteCardTarget != null ||
      deleteRecordTarget != null
    if (!sheetOpen) {
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
  }, [cardSheetOpen, recordSheetType, detailCardId, disableCardTarget, deleteCardTarget, deleteRecordTarget])

  const recalculateCardBalance = async (cardId: string) => {
    if (!db || !session) {
      return
    }
    const result = (await db
      .collection(STORED_VALUE_CARD_RECORD_COLLECTION)
      .where({ user_id: session.userId, card_id: cardId })
      .get()) as { data?: CloudStoredValueCardRecord[] }
    const nextRecords = [...(result.data ?? [])].sort((a, b) => {
      const dateOrder = a.transaction_date.localeCompare(b.transaction_date)
      return dateOrder !== 0 ? dateOrder : a.created_at.localeCompare(b.created_at)
    })
    let balance = 0
    let totalRecharged = 0
    let totalSpent = 0
    for (const record of nextRecords) {
      const amount = Number(record.amount || 0)
      if (record.type === 'spend') {
        balance -= amount
        totalSpent += amount
      } else if (record.type === 'recharge') {
        balance += amount
        totalRecharged += amount
      } else {
        balance = amount
      }
      await db.collection(STORED_VALUE_CARD_RECORD_COLLECTION).doc(record._id).update({
        balance_after: balance,
      })
    }
    await db.collection(STORED_VALUE_CARD_COLLECTION).doc(cardId).update({
      balance,
      total_recharged: totalRecharged,
      total_spent: totalSpent,
      updated_at: new Date().toISOString(),
    })
  }

  const createLinkedTransaction = async (input: {
    amount: number
    date: string
    category: string
    subcategory: string
    note: string
  }) => {
    if (!db || !session) {
      return null
    }
    const now = new Date().toISOString()
    const result = (await db.collection(TRANSACTION_COLLECTION).add({
      user_id: session.userId,
      type: 'expense',
      amount: input.amount,
      category: input.category,
      subcategory: input.subcategory || null,
      transaction_date: input.date,
      note: input.note || null,
      source: 'stored_value_card',
      created_at: now,
      updated_at: now,
    })) as { id?: string }
    await loadTransactions(session.userId)
    return result.id ?? null
  }

  const resetRecordForm = () => {
    setRecordAmount('')
    setRecordDate(todayISO())
    setRecordNote('')
    setEditingRecordId(null)
    setRecordSheetType(null)
  }

  const beginEditRecord = (card: StoredValueCard, record: StoredValueCardRecord) => {
    if (record.type !== 'spend' && record.type !== 'recharge') {
      return
    }
    setSelectedCardId(card.id)
    setRecordSheetType(record.type)
    setEditingRecordId(record.id)
    setRecordAmount(String(record.amount))
    setRecordDate(record.transaction_date)
    setRecordNote(record.note ?? '')
    setError('')
  }

  const handleCreateCard = async (event: FormEvent) => {
    event.preventDefault()
    if (!db || !session) {
      return
    }
    const amount = Number(initialAmount)
    const threshold = lowBalanceThreshold.trim() ? Number(lowBalanceThreshold) : null
    if (!cardName.trim()) {
      setError('请填写卡片名称')
      return
    }
    if (!editingCard && (!Number.isFinite(amount) || amount <= 0)) {
      setError('请输入大于 0 的初始充值金额')
      return
    }
    if (threshold != null && (!Number.isFinite(threshold) || threshold < 0)) {
      setError('低余额提醒金额需大于等于 0')
      return
    }
    setSaving(true)
    setError('')
    try {
      const now = new Date().toISOString()
      if (editingCard) {
        await db.collection(STORED_VALUE_CARD_COLLECTION).doc(editingCard.id).update({
          name: cardName.trim(),
          merchant: merchant.trim(),
          category: effectiveCategory,
          subcategory: effectiveSubcategory || null,
          low_balance_threshold: threshold,
          expire_date: expireDate || null,
          note: cardNote.trim() || null,
          updated_at: now,
        })
        setSelectedCardId(editingCard.id)
        setMessage('储值卡信息已更新')
        resetCardForm()
        await loadStoredValueCards()
        return
      }
      const linkedTransactionId = syncInitialTransaction
        ? await createLinkedTransaction({
            amount,
            date: todayISO(),
            category: effectiveCategory,
            subcategory: effectiveSubcategory,
            note: `${merchant.trim() || cardName.trim()} 储值卡充值`,
          })
        : null
      const cardResult = (await db.collection(STORED_VALUE_CARD_COLLECTION).add({
        user_id: session.userId,
        name: cardName.trim(),
        merchant: merchant.trim(),
        category: effectiveCategory,
        subcategory: effectiveSubcategory || null,
        balance: amount,
        total_recharged: amount,
        total_spent: 0,
        low_balance_threshold: threshold,
        expire_date: expireDate || null,
        status: 'active',
        note: cardNote.trim() || null,
        linked_transaction_id: linkedTransactionId,
        created_at: now,
        updated_at: now,
      })) as { id?: string }
      const cardId = cardResult.id
      if (cardId) {
        await db.collection(STORED_VALUE_CARD_RECORD_COLLECTION).add({
          user_id: session.userId,
          card_id: cardId,
          type: 'recharge',
          amount,
          balance_after: amount,
          transaction_date: todayISO(),
          note: '初始充值',
          linked_transaction_id: linkedTransactionId,
          created_at: now,
        })
      }
      setSelectedCardId(cardId ?? null)
      resetCardForm()
      setMessage('储值卡已创建')
      await loadStoredValueCards()
    } catch (err) {
      const raw = err instanceof Error ? err.message : '储值卡保存失败'
      setError(storedValueCloudMessage(raw))
    } finally {
      setSaving(false)
    }
  }

  const handleCardRecord = async (type: 'spend' | 'recharge') => {
    if (!db || !session || !selectedCard) {
      return
    }
    const amount = Number(recordAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('请输入大于 0 的金额')
      return
    }
    const editableSpendAmount = editingRecord?.type === 'spend' ? editingRecord.amount : 0
    if (type === 'spend' && amount > selectedCard.balance + editableSpendAmount) {
      setError('扣款金额不能超过当前余额')
      return
    }
    setSaving(true)
    setError('')
    try {
      const now = new Date().toISOString()
      if (editingRecord) {
        await db.collection(STORED_VALUE_CARD_RECORD_COLLECTION).doc(editingRecord.id).update({
          amount,
          transaction_date: recordDate,
          note: recordNote.trim() || null,
        })
        if (editingRecord.type === 'recharge' && editingRecord.linked_transaction_id) {
          await db.collection(TRANSACTION_COLLECTION).doc(editingRecord.linked_transaction_id).update({
            amount,
            transaction_date: recordDate,
            note: recordNote.trim() || null,
            updated_at: now,
          })
          await loadTransactions(session.userId)
        }
        await recalculateCardBalance(editingRecord.card_id)
        resetRecordForm()
        setMessage(editingRecord.type === 'spend' ? '扣款流水已更新' : '充值流水已更新')
        await loadStoredValueCards()
        return
      }

      const balanceAfter = type === 'spend' ? selectedCard.balance - amount : selectedCard.balance + amount
      const linkedTransactionId =
        type === 'recharge' && syncRechargeTransaction
          ? await createLinkedTransaction({
              amount,
              date: recordDate,
              category: selectedCard.category,
              subcategory: selectedCard.subcategory ?? '',
              note: `${selectedCard.merchant || selectedCard.name} 储值卡充值`,
            })
          : null
      await db.collection(STORED_VALUE_CARD_COLLECTION).doc(selectedCard.id).update({
        balance: balanceAfter,
        total_recharged:
          type === 'recharge' ? selectedCard.total_recharged + amount : selectedCard.total_recharged,
        total_spent: type === 'spend' ? selectedCard.total_spent + amount : selectedCard.total_spent,
        updated_at: now,
      })
      await db.collection(STORED_VALUE_CARD_RECORD_COLLECTION).add({
        user_id: session.userId,
        card_id: selectedCard.id,
        type,
        amount,
        balance_after: balanceAfter,
        transaction_date: recordDate,
        note: recordNote.trim() || null,
        linked_transaction_id: linkedTransactionId,
        created_at: now,
      })
      await recalculateCardBalance(selectedCard.id)
      resetRecordForm()
      setMessage(type === 'spend' ? '扣款已记录' : '充值已记录')
      await loadStoredValueCards()
    } catch (err) {
      const raw = err instanceof Error ? err.message : '流水保存失败'
      setError(storedValueCloudMessage(raw))
    } finally {
      setSaving(false)
    }
  }

  const archiveCard = async (card = selectedCard) => {
    if (!db || !card) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await db.collection(STORED_VALUE_CARD_COLLECTION).doc(card.id).update({
        status: 'archived',
        updated_at: new Date().toISOString(),
      })
      setDisableCardTarget(null)
      setMessage('储值卡已停用')
      await loadStoredValueCards()
    } catch (err) {
      setError(err instanceof Error ? err.message : '停用失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteRecord = async (record: StoredValueCardRecord) => {
    if (!db || !session) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await db.collection(STORED_VALUE_CARD_RECORD_COLLECTION).doc(record.id).remove()
      if (record.linked_transaction_id) {
        await db.collection(TRANSACTION_COLLECTION).doc(record.linked_transaction_id).remove()
        const card = cards.find((item) => item.id === record.card_id)
        if (card?.linked_transaction_id === record.linked_transaction_id) {
          await db.collection(STORED_VALUE_CARD_COLLECTION).doc(record.card_id).update({
            linked_transaction_id: null,
            updated_at: new Date().toISOString(),
          })
        }
        await loadTransactions(session.userId)
      }
      await recalculateCardBalance(record.card_id)
      setDeleteRecordTarget(null)
      setMessage(record.type === 'spend' ? '扣款流水已删除' : '充值流水已删除')
      await loadStoredValueCards()
    } catch (err) {
      setError(err instanceof Error ? err.message : '流水删除失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteCard = async (card: StoredValueCard) => {
    if (!db || !session || card.status !== 'archived') {
      return
    }
    setSaving(true)
    setError('')
    try {
      const related = (await db
        .collection(STORED_VALUE_CARD_RECORD_COLLECTION)
        .where({ user_id: session.userId, card_id: card.id })
        .get()) as {
          data?: Array<{
            _id?: string
            type?: string
            amount?: number
            transaction_date?: string
            linked_transaction_id?: string | null
          }>
        }
      const linkedTransactionIds = new Set(
        [card.linked_transaction_id, ...(related.data ?? []).map((row) => row.linked_transaction_id)].filter(
          (id): id is string => Boolean(id),
        ),
      )
      for (const row of related.data ?? []) {
        if (row.linked_transaction_id || row.type !== 'recharge' || !row.transaction_date) {
          continue
        }
        const legacyTransactions = (await db
          .collection(TRANSACTION_COLLECTION)
          .where({
            user_id: session.userId,
            type: 'expense',
            transaction_date: row.transaction_date,
          })
          .get()) as { data?: CloudStoredValueTransaction[] }
        for (const transaction of legacyTransactions.data ?? []) {
          const note = transaction.note ?? ''
          const matchesAmount = moneyCents(transaction.amount) === moneyCents(Number(row.amount || 0))
          const matchesStoredValueSource =
            transaction.source === 'stored_value_card' ||
            (note.includes('储值卡') &&
              Boolean((card.name && note.includes(card.name)) || (card.merchant && note.includes(card.merchant))))
          if (matchesAmount && matchesStoredValueSource) {
            linkedTransactionIds.add(transaction._id)
          }
        }
      }
      for (const row of related.data ?? []) {
        if (row._id) {
          await db.collection(STORED_VALUE_CARD_RECORD_COLLECTION).doc(row._id).remove()
        }
      }
      for (const transactionId of linkedTransactionIds) {
        await db.collection(TRANSACTION_COLLECTION).doc(transactionId).remove()
      }
      await db.collection(STORED_VALUE_CARD_COLLECTION).doc(card.id).remove()
      setDetailCardId(null)
      setDeleteCardTarget(null)
      setSelectedCardId((current) => (current === card.id ? null : current))
      setMessage('储值卡已删除')
      await loadStoredValueCards()
      await loadTransactions(session.userId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="sub-page-shell stored-card-shell">
      <div className="sub-page sub-page--standalone stored-card-page">
        <header className="sub-page-nav">
          <Link className="sub-page-icon-back" to="/more" aria-label="返回更多">
            <span aria-hidden>←</span>
          </Link>
          <h1 className="sub-page-title">储值卡管理</h1>
        </header>

      <section className="stored-card-panel stored-card-panel--flat">
        {cards.length === 0 ? (
          <div className="empty-state">
            <h3>还没有储值卡</h3>
            <p>新增一张理发卡、洗车卡或按摩卡，后续扣款就能持续追踪余额。</p>
          </div>
        ) : (
          <div className="stored-card-layout">
            <div className="stored-card-list stored-card-list--cards" aria-label="储值卡列表">
              {cards.map((card) => (
                <article
                  key={card.id}
                  className={`stored-value-card${selectedCard?.id === card.id ? ' active' : ''}${card.status === 'archived' ? ' archived' : ''}`}
                  onClick={() => setSelectedCardId(card.id)}
                >
                  <button type="button" className="stored-value-card-main" onClick={() => setSelectedCardId(card.id)}>
                    <span>
                      <strong>{card.name}</strong>
                      <em>{card.category}{card.subcategory ? ` / ${card.subcategory}` : ''}</em>
                    </span>
                    <b>{formatMoney(card.balance)}</b>
                  </button>
                  {card.merchant ? <p>{card.merchant}</p> : null}
                  <button
                    type="button"
                    className="stored-value-card-detail-btn"
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelectedCardId(card.id)
                      setDetailCardId(card.id)
                    }}
                  >
                    查看明细
                  </button>
                  <div className="stored-value-card-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={card.status !== 'active'}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedCardId(card.id)
                        setRecordSheetType('recharge')
                      }}
                    >
                      记录储值
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={card.status !== 'active'}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelectedCardId(card.id)
                        setRecordSheetType('spend')
                      }}
                    >
                      记录扣款
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="stored-card-bottom-action">
        <button type="button" className="primary-button" onClick={openCreateCardSheet}>
          新增储值卡
        </button>
      </div>

      {cardSheetOpen && createPortal(
        <div className="ledger-receipt-sheet-layer stored-card-card-sheet-layer" role="presentation">
          <button type="button" className="ledger-receipt-sheet-backdrop" aria-label="关闭储值卡信息" onClick={resetCardForm} disabled={saving} />
          <section className="ledger-receipt-sheet stored-card-sheet" role="dialog" aria-modal="true" aria-labelledby="stored-card-create-title">
            <div className="ledger-receipt-review-head">
              <h3 id="stored-card-create-title">{editingCard ? '编辑卡片信息' : '新增储值卡'}</h3>
              <button type="button" className="ledger-receipt-sheet-close" aria-label="关闭储值卡信息" onClick={resetCardForm} disabled={saving}>×</button>
            </div>
            <form className="form-grid stored-card-sheet-form" onSubmit={handleCreateCard}>
              <div className="stored-card-sheet-scroll">
                <div className="form-row-2">
                  <label>
                    卡片名称
                    <input value={cardName} onChange={(event) => setCardName(event.target.value)} placeholder="例如：理发卡" />
                  </label>
                  <label>
                    商家
                    <input value={merchant} onChange={(event) => setMerchant(event.target.value)} placeholder="例如：XX 理发店" />
                  </label>
                </div>
                {!editingCard && (
                  <label className="ledger-amount-field">
                    <span className="recurring-amount-label">初始充值金额</span>
                    <span className="money-input-wrap">
                      <span className="money-input-prefix" aria-hidden>¥</span>
                      <input type="number" inputMode="decimal" min="0" step="0.01" value={initialAmount} onChange={(event) => setInitialAmount(event.target.value)} placeholder="1000.00" />
                    </span>
                  </label>
                )}
                <div className="form-row-2">
                  <label>
                    一级分类
                    <select value={effectiveCategory} onChange={(event) => setCategory(event.target.value)}>
                      {expenseOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label>
                    二级分类
                    <select value={effectiveSubcategory} onChange={(event) => setSubcategory(event.target.value)}>
                      <option value="">无</option>
                      {subcategoryOptionsForCard.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                </div>
                <div className="form-row-2">
                  <label>
                    到期日
                    <input type="date" value={expireDate} onChange={(event) => setExpireDate(event.target.value)} />
                  </label>
                  <label>
                    低余额提醒
                    <input type="number" inputMode="decimal" min="0" step="0.01" value={lowBalanceThreshold} onChange={(event) => setLowBalanceThreshold(event.target.value)} />
                  </label>
                </div>
                <label className="stored-card-note-label">
                  备注
                  <textarea value={cardNote} onChange={(event) => setCardNote(event.target.value)} placeholder="选填，例如办卡权益、次数说明" rows={2} />
                </label>
                {!editingCard && (
                  <label className="stored-card-check">
                    <input type="checkbox" checked={syncInitialTransaction} onChange={(event) => setSyncInitialTransaction(event.target.checked)} />
                    <span className="stored-card-check-text">
                      <strong>记录一笔账单支出</strong>
                      <em>保存卡片时同步计入本月支出</em>
                    </span>
                    <span className="stored-card-check-switch" aria-hidden />
                  </label>
                )}
                {error && <p className="alert error">{error}</p>}
              </div>
              <div className="ledger-receipt-sheet-actions">
                <button type="button" className="secondary-button" onClick={resetCardForm} disabled={saving}>取消</button>
                <button className="primary-button" type="submit" disabled={saving || loading}>{saving ? '保存中…' : editingCard ? '保存修改' : '保存卡片'}</button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}

      {recordSheetType && selectedCard && createPortal(
        <div className="ledger-receipt-sheet-layer stored-card-record-sheet-layer" role="presentation">
          <button type="button" className="ledger-receipt-sheet-backdrop" aria-label="关闭储值卡流水记录" onClick={resetRecordForm} disabled={saving} />
          <section className="ledger-receipt-sheet stored-card-sheet" role="dialog" aria-modal="true" aria-labelledby="stored-card-record-title">
            <div className="ledger-receipt-review-head">
              <h3 id="stored-card-record-title">
                {editingRecord
                  ? recordSheetType === 'spend' ? '编辑扣款' : '编辑充值'
                  : recordSheetType === 'spend' ? '记录扣款' : '记录充值'}
              </h3>
              <button type="button" className="ledger-receipt-sheet-close" aria-label="关闭储值卡流水记录" onClick={resetRecordForm} disabled={saving}>×</button>
            </div>
            <div className="stored-card-balance-card stored-card-balance-card--sheet">
              <span>{selectedCard.name}</span>
              <strong>{formatMoney(selectedCard.balance)}</strong>
              <p>{selectedCard.category}{selectedCard.subcategory ? ` / ${selectedCard.subcategory}` : ''}</p>
            </div>
            <div className="form-grid stored-card-sheet-form">
              <div className="form-row-2">
                <label>
                  金额
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={recordAmount} onChange={(event) => setRecordAmount(event.target.value)} placeholder="0.00" />
                </label>
                <label>
                  日期
                  <input type="date" value={recordDate} onChange={(event) => setRecordDate(event.target.value)} />
                </label>
              </div>
              <label>
                说明
                <input value={recordNote} onChange={(event) => setRecordNote(event.target.value)} placeholder={recordSheetType === 'spend' ? '例如：剪发' : '例如：追加充值'} />
              </label>
              {recordSheetType === 'recharge' && !editingRecord && (
                <label className="stored-card-check">
                  <input type="checkbox" checked={syncRechargeTransaction} onChange={(event) => setSyncRechargeTransaction(event.target.checked)} />
                  <span className="stored-card-check-text">
                    <strong>记录一笔账单支出</strong>
                    <em>本次储值同步计入账单</em>
                  </span>
                  <span className="stored-card-check-switch" aria-hidden />
                </label>
              )}
              {error && <p className="alert error">{error}</p>}
              <div className="ledger-receipt-sheet-actions">
                <button type="button" className="secondary-button" onClick={resetRecordForm} disabled={saving}>取消</button>
                <button className="primary-button" type="button" disabled={saving} onClick={() => void handleCardRecord(recordSheetType)}>
                  {saving ? '保存中…' : editingRecord ? '保存修改' : recordSheetType === 'spend' ? '保存扣款' : '保存充值'}
                </button>
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )}

      {detailCard && createPortal(
        <div className="ledger-receipt-sheet-layer" role="presentation">
          <button
            type="button"
            className="ledger-receipt-sheet-backdrop"
            aria-label="关闭储值卡明细"
            onClick={() => setDetailCardId(null)}
            disabled={saving}
          />
          <section className="ledger-receipt-sheet stored-card-sheet" role="dialog" aria-modal="true" aria-labelledby="stored-card-detail-title">
            <div className="ledger-receipt-review-head">
              <h3 id="stored-card-detail-title">{detailCard.name}</h3>
              <button type="button" className="ledger-receipt-sheet-close" aria-label="关闭储值卡明细" onClick={() => setDetailCardId(null)} disabled={saving}>×</button>
            </div>
            <div className="stored-card-balance-card stored-card-balance-card--sheet">
              <span>{detailCard.status === 'archived' ? '已停用' : '当前余额'}</span>
              <strong>{formatMoney(detailCard.balance)}</strong>
              <p>{detailCard.category}{detailCard.subcategory ? ` / ${detailCard.subcategory}` : ''}</p>
              <p>累计充值 {formatMoney(detailCard.total_recharged)} · 已消费 {formatMoney(detailCard.total_spent)}</p>
              {detailCard.expire_date ? <p>到期日：{detailCard.expire_date}</p> : null}
              {detailCard.note ? <p>备注：{detailCard.note}</p> : null}
              <div className="stored-card-detail-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => beginEditCard(detailCard)}
                >
                  编辑
                </button>
                {detailCard.status === 'active' ? (
                  <button
                    className="secondary-button danger"
                    type="button"
                    disabled={saving}
                    onClick={() => setDisableCardTarget(detailCard)}
                  >
                    停用
                  </button>
                ) : (
                  <button
                    className="secondary-button danger"
                    type="button"
                    disabled={saving}
                    onClick={() => setDeleteCardTarget(detailCard)}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
            <div className="stored-card-records stored-card-records--sheet">
              <div className="stored-card-records-head">
                <h3>流水明细</h3>
              </div>
              {detailCardRecords.length === 0 ? (
                <p className="muted small">暂无流水。</p>
              ) : (
                detailCardRecords.map((record) => (
                  <StoredCardRecordRow
                    key={record.id}
                    record={record}
                    formatMoney={formatMoney}
                    open={swipedRecordId === record.id}
                    disabled={saving}
                    onOpen={() => setSwipedRecordId(record.id)}
                    onClose={() => setSwipedRecordId((current) => (current === record.id ? null : current))}
                    onEdit={() => {
                      setSwipedRecordId(null)
                      beginEditRecord(detailCard, record)
                    }}
                    onDelete={() => {
                      setSwipedRecordId(null)
                      setDeleteRecordTarget(record)
                    }}
                  />
                ))
              )}
            </div>
          </section>
        </div>,
        document.body,
      )}
      <ConfirmActionSheet
        open={disableCardTarget != null}
        title="停用储值卡"
        description={`停用「${disableCardTarget?.name ?? ''}」后，这张卡将作废，不能再记录扣款或储值，历史流水仍会保留。`}
        confirmText="停用"
        busy={saving}
        onCancel={() => setDisableCardTarget(null)}
        onConfirm={() => {
          if (disableCardTarget) {
            void archiveCard(disableCardTarget)
          }
        }}
      />
      <ConfirmActionSheet
        open={deleteCardTarget != null}
        title="删除储值卡"
        description={`删除「${deleteCardTarget?.name ?? ''}」后，卡片、流水和关联账单支出都会清除，且无法恢复。`}
        confirmText="删除此卡"
        busy={saving}
        onCancel={() => setDeleteCardTarget(null)}
        onConfirm={() => {
          if (deleteCardTarget) {
            void deleteCard(deleteCardTarget)
          }
        }}
      />
      <ConfirmActionSheet
        open={deleteRecordTarget != null}
        title="删除流水"
        description={
          deleteRecordTarget?.linked_transaction_id
            ? '删除后，这条储值卡流水和关联账单支出都会清除，且无法恢复。'
            : '删除后，这条储值卡流水会被清除，并重新计算卡片余额。'
        }
        confirmText="删除流水"
        busy={saving}
        onCancel={() => setDeleteRecordTarget(null)}
        onConfirm={() => {
          if (deleteRecordTarget) {
            void deleteRecord(deleteRecordTarget)
          }
        }}
      />
      </div>
    </main>
  )
}

function StoredCardRecordRow({
  record,
  formatMoney,
  open,
  disabled,
  onOpen,
  onClose,
  onEdit,
  onDelete,
}: {
  record: StoredValueCardRecord
  formatMoney: (n: number) => string
  open: boolean
  disabled: boolean
  onOpen: () => void
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const movedRef = useRef(false)
  const editable = record.type !== 'adjust'

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    startXRef.current = event.clientX
    startYRef.current = event.clientY
    movedRef.current = false
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!editable || disabled) {
      return
    }
    const dx = event.clientX - startXRef.current
    const dy = event.clientY - startYRef.current
    if (Math.abs(dx) < 16 || Math.abs(dx) < Math.abs(dy)) {
      return
    }
    movedRef.current = true
    if (dx < -36) {
      onOpen()
    } else if (dx > 36) {
      onClose()
    }
  }

  const handleClick = () => {
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    if (!editable || disabled) {
      return
    }
    if (open) {
      onClose()
      return
    }
    onEdit()
  }

  return (
    <div className={`stored-card-record-swipe transaction-swipe-row${open ? ' open' : ''}`}>
      {editable && (
        <button
          type="button"
          className="transaction-swipe-delete"
          disabled={disabled}
          onClick={onDelete}
          aria-label={`删除${record.type === 'spend' ? '扣款' : '充值'}流水`}
        >
          删除
        </button>
      )}
      <article
        className="stored-card-record transaction-swipe-card"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
      >
        <div>
          <strong>{record.type === 'spend' ? '扣款' : record.type === 'recharge' ? '充值' : '调整'}</strong>
          <span>{record.transaction_date}{record.note ? ` · ${record.note}` : ''}</span>
        </div>
        <p className={record.type === 'spend' ? 'expense' : 'income'}>
          {record.type === 'spend' ? '-' : '+'}{formatMoney(record.amount)}
          <span>余额 {formatMoney(record.balance_after)}</span>
        </p>
      </article>
    </div>
  )
}
