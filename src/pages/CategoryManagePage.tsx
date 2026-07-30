import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccounting } from '../context/AccountingContext'
import type { RecurringTemplate } from '../types/recurring'
import type { Transaction } from '../types/transaction'

function countCategoryUsage(
  name: string,
  transactions: Transaction[],
  recurringTemplates: RecurringTemplate[],
): number {
  const fromTx = transactions.filter((t) => t.category === name && t.type === 'expense').length
  const fromRecurring = recurringTemplates.filter((r) => r.category === name).length
  return fromTx + fromRecurring
}

function validateExpenseList(expense: string[]): string | null {
  const trimmed = expense.map((s) => s.trim()).filter(Boolean)
  if (trimmed.length === 0) {
    return '支出分类至少保留 1 个分类'
  }
  const seen = new Set<string>()
  for (const s of trimmed) {
    if (seen.has(s)) {
      return `支出分类中存在重复名称：「${s}」`
    }
    seen.add(s)
  }
  return null
}

type CategoryManagePageProps = {
  embedded?: boolean
  onClose?: () => void
}

export function CategoryManagePage({ embedded = false, onClose }: CategoryManagePageProps = {}) {
  const navigate = useNavigate()
  const {
    expenseCategoryNames,
    expenseSubcategoryMap,
    incomeCategoryNames,
    transactions,
    recurringTemplates,
    saveUserCategoryLists,
    restoreDefaultCategoryLists,
    categoriesSaving,
    loadAllTransactions,
  } = useAccounting()

  const [draftExpense, setDraftExpense] = useState<string[]>([])
  const [newName, setNewName] = useState('')
  const [draftSubcategories, setDraftSubcategories] = useState<Record<string, string[]>>({})
  const [newSubcategoryName, setNewSubcategoryName] = useState('')
  const [error, setError] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [swipedIndex, setSwipedIndex] = useState<number | null>(null)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [usageTransactions, setUsageTransactions] = useState<Transaction[]>(transactions)
  const draggingIndexRef = useRef<number | null>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  const normalizedDraftExpense = useMemo(
    () => draftExpense.map((s) => s.trim()).filter(Boolean),
    [draftExpense],
  )

  const hasUnsavedChanges = useMemo(() => {
    if (editingIndex != null || isAdding || newName.trim() || newSubcategoryName.trim()) {
      return true
    }
    if (normalizedDraftExpense.length !== expenseCategoryNames.length) {
      return true
    }
    if (normalizedDraftExpense.some((name, index) => name !== expenseCategoryNames[index])) {
      return true
    }
    return JSON.stringify(draftSubcategories) !== JSON.stringify(expenseSubcategoryMap)
  }, [draftSubcategories, editingIndex, expenseCategoryNames, expenseSubcategoryMap, isAdding, newName, newSubcategoryName, normalizedDraftExpense])

  useEffect(() => {
    setDraftExpense([...expenseCategoryNames])
    setDraftSubcategories({ ...expenseSubcategoryMap })
    setNewName('')
    setNewSubcategoryName('')
    setError('')
    setEditingIndex(null)
    setIsAdding(false)
    setSwipedIndex(null)
    setExpandedIndex(null)
    setDraggingIndex(null)
    draggingIndexRef.current = null
  }, [expenseCategoryNames, expenseSubcategoryMap])

  useEffect(() => {
    let cancelled = false
    const loadUsageTransactions = async () => {
      try {
        const rows = await loadAllTransactions()
        if (!cancelled) {
          setUsageTransactions(rows)
        }
      } catch {
        if (!cancelled) {
          setUsageTransactions(transactions)
        }
      }
    }
    void loadUsageTransactions()
    return () => {
      cancelled = true
    }
  }, [loadAllTransactions, transactions])

  const updateAt = useCallback((index: number, value: string) => {
    setDraftExpense((prev) => {
      const next = [...prev]
      const oldName = next[index]
      next[index] = value
      setDraftSubcategories((current) => {
        if (!oldName || oldName === value) {
          return current
        }
        const nextMap = { ...current, [value]: current[oldName] ?? [] }
        delete nextMap[oldName]
        return nextMap
      })
      return next
    })
  }, [])

  const removeAt = useCallback(
    (index: number) => {
      setDraftExpense((prev) => {
        if (prev.length <= 1) {
          return prev
        }
        const name = prev[index]?.trim() ?? ''
        const usage = name ? countCategoryUsage(name, usageTransactions, recurringTemplates) : 0
        if (usage > 0) {
          const ok = window.confirm(
            `「${name}」在 ${usage} 条账单或周期规则中出现过。删除后仍可查看历史记录，但新记账无法再选此类别。确定删除？`,
          )
          if (!ok) {
            return prev
          }
        }
        setDraftSubcategories((current) => {
          const next = { ...current }
          delete next[name]
          return next
        })
        return prev.filter((_, i) => i !== index)
      })
      setEditingIndex((current) => {
        if (current == null) {
          return current
        }
        if (current === index) {
          return null
        }
        return current > index ? current - 1 : current
      })
      setExpandedIndex((current) => {
        if (current == null) {
          return current
        }
        if (current === index) {
          return null
        }
        return current > index ? current - 1 : current
      })
      setSwipedIndex(null)
    },
    [draftExpense.length, usageTransactions, recurringTemplates],
  )

  const addName = useCallback(() => {
    const t = newName.trim()
    if (!t) {
      setError('请输入分类名称')
      return
    }
    if (draftExpense.some((x) => x.trim() === t)) {
      setError('已存在同名分类')
      return
    }
    setDraftExpense((prev) => [t, ...prev])
    setDraftSubcategories((prev) => ({ ...prev, [t]: ['无法归类'] }))
    setExpandedIndex(0)
    setError('')
    setNewName('')
    setIsAdding(false)
  }, [draftExpense, newName])

  const finishEdit = useCallback(
    (index: number) => {
      const name = draftExpense[index]?.trim() ?? ''
      if (!name) {
        setError('分类名称不能为空')
        return
      }
      if (draftExpense.some((item, itemIndex) => itemIndex !== index && item.trim() === name)) {
        setError('已存在同名分类')
        return
      }
      setDraftExpense((prev) => {
        const next = [...prev]
        next[index] = name
        return next
      })
      setError('')
      setEditingIndex(null)
    },
    [draftExpense],
  )

  const moveTo = useCallback((fromIndex: number, targetIndex: number) => {
    setDraftExpense((prev) => {
      if (
        fromIndex === targetIndex ||
        fromIndex < 0 ||
        targetIndex < 0 ||
        fromIndex >= prev.length ||
        targetIndex >= prev.length
      ) {
        return prev
      }
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      next.splice(targetIndex, 0, item)
      return next
    })
    setEditingIndex((current) => {
      if (current === fromIndex) {
        return targetIndex
      }
      if (current == null) {
        return current
      }
      if (fromIndex < targetIndex && current > fromIndex && current <= targetIndex) {
        return current - 1
      }
      if (fromIndex > targetIndex && current >= targetIndex && current < fromIndex) {
        return current + 1
      }
      return current
    })
    setExpandedIndex((current) => {
      if (current === fromIndex) {
        return targetIndex
      }
      if (current == null) {
        return current
      }
      if (fromIndex < targetIndex && current > fromIndex && current <= targetIndex) {
        return current - 1
      }
      if (fromIndex > targetIndex && current >= targetIndex && current < fromIndex) {
        return current + 1
      }
      return current
    })
    setSwipedIndex(null)
  }, [])

  const handleDragStart = useCallback((index: number) => {
    draggingIndexRef.current = index
    setDraggingIndex(index)
    setEditingIndex(null)
    setExpandedIndex(null)
    setSwipedIndex(null)
    document.body.classList.add('category-dragging')
  }, [])

  const handleDragMove = useCallback(
    (clientY: number) => {
      const fromIndex = draggingIndexRef.current
      if (fromIndex == null) {
        return
      }

      const targetIndex = rowRefs.current.findIndex((row) => {
        if (!row) {
          return false
        }
        const rect = row.getBoundingClientRect()
        return clientY < rect.top + rect.height / 2
      })
      const nextIndex = targetIndex === -1 ? draftExpense.length - 1 : targetIndex

      if (nextIndex !== fromIndex) {
        moveTo(fromIndex, nextIndex)
        draggingIndexRef.current = nextIndex
        setDraggingIndex(nextIndex)
      }
    },
    [draftExpense.length, moveTo],
  )

  const handleDragEnd = useCallback(() => {
    draggingIndexRef.current = null
    setDraggingIndex(null)
    document.body.classList.remove('category-dragging')
  }, [])

  useEffect(() => {
    return () => {
      document.body.classList.remove('category-dragging')
    }
  }, [])

  const exitPage = useCallback(() => {
    if (onClose) {
      onClose()
    } else {
      navigate('/me')
    }
  }, [navigate, onClose])

  const goBack = useCallback(() => {
    if (
      hasUnsavedChanges &&
      !window.confirm('当前分类改动还没有保存，确定离开吗？')
    ) {
      return
    }
    exitPage()
  }, [exitPage, hasUnsavedChanges])

  const handleSave = async () => {
    const expense = normalizedDraftExpense
    const income = incomeCategoryNames
    const err = validateExpenseList(expense)
    if (err) {
      setError(err)
      return
    }
    for (const category of expense) {
      const names = (draftSubcategories[category] ?? []).map((s) => s.trim()).filter(Boolean)
      if (names.length === 0) {
        setError(`「${category}」至少保留 1 个二级分类`)
        return
      }
      if (new Set(names).size !== names.length) {
        setError(`「${category}」下存在重复二级分类`)
        return
      }
    }
    setError('')
    try {
      await saveUserCategoryLists({ expense, income, expenseSubcategories: draftSubcategories })
      exitPage()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  const addSubcategory = useCallback((category: string) => {
    const name = newSubcategoryName.trim()
    const normalizedCategory = category.trim()
    const subcategories = normalizedCategory ? (draftSubcategories[normalizedCategory] ?? []) : []
    if (!normalizedCategory || !name) {
      setError('请输入二级分类名称')
      return
    }
    if (subcategories.some((item) => item.trim() === name)) {
      setError('已存在同名二级分类')
      return
    }
    setDraftSubcategories((current) => ({
      ...current,
      [normalizedCategory]: [...subcategories, name],
    }))
    setNewSubcategoryName('')
    setError('')
  }, [draftSubcategories, newSubcategoryName])

  const updateSubcategory = useCallback((category: string, index: number, value: string) => {
    if (!category) return
    setDraftSubcategories((current) => {
      const next = [...(current[category] ?? [])]
      next[index] = value
      return { ...current, [category]: next }
    })
  }, [])

  const removeSubcategory = useCallback((category: string, index: number) => {
    const subcategories = draftSubcategories[category] ?? []
    if (!category || subcategories.length <= 1) return
    setDraftSubcategories((current) => ({
      ...current,
      [category]: subcategories.filter((_, i) => i !== index),
    }))
  }, [draftSubcategories])

  const handleRestore = async () => {
    if (!window.confirm('将支出分类恢复为系统默认并同步到云端？')) {
      return
    }
    setError('')
    try {
      await restoreDefaultCategoryLists()
      exitPage()
    } catch (e) {
      setError(e instanceof Error ? e.message : '恢复失败')
    }
  }

  const content = (
    <div
      className={`sub-page category-manage-page${
        embedded ? ' category-manage-page--sheet' : ' sub-page--standalone category-manage-page--standalone'
      }`}
    >
      {!embedded && (
        <header className="sub-page-nav">
          <button type="button" className="sub-page-icon-back" onClick={goBack} aria-label="返回我的">
            <span aria-hidden>←</span>
          </button>
          <h1 className="sub-page-title">分类管理</h1>
        </header>
      )}

      <div className="category-manage-scroll">
        <p className="muted small category-manager-hint">删除已使用的分类前会提示确认；历史账单中的名称不会自动改写。</p>

        {isAdding ? (
          <div className="category-manager-add">
            <input
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setError('')
              }}
              placeholder="新分类名称"
              className="category-manager-input"
              maxLength={32}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addName()
                }
              }}
            />
            <div className="category-manager-add-actions">
              <button type="button" className="text-button" onClick={() => setIsAdding(false)}>
                取消
              </button>
              <button type="button" className="secondary-button" onClick={addName}>
                添加
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="secondary-button category-manager-add-trigger" onClick={() => setIsAdding(true)}>
            添加分类
          </button>
        )}

        <ul className="category-manager-list">
          {draftExpense.map((name, index) => {
            const isEditing = editingIndex === index
            const isExpanded = expandedIndex === index
            const categoryName = name.trim()
            const subcategories = draftSubcategories[categoryName] ?? []

            return (
              <li key={`expense-${index}`} className="category-manager-item">
                <CategoryManagerRow
                  index={index}
                  name={name}
                  isEditing={isEditing}
                  canDelete={draftExpense.length > 1}
                  isDragging={draggingIndex === index}
                  open={swipedIndex === index}
                  isExpanded={isExpanded}
                  rowRef={(node) => {
                    rowRefs.current[index] = node
                  }}
                  onOpen={() => {
                    setEditingIndex(null)
                    setSwipedIndex(index)
                  }}
                  onClose={() => setSwipedIndex((current) => (current === index ? null : current))}
                  onEdit={() => {
                    setSwipedIndex(null)
                    setEditingIndex(index)
                  }}
                  onDelete={() => removeAt(index)}
                  onToggleExpand={() => {
                    setSwipedIndex(null)
                    setEditingIndex(null)
                    setExpandedIndex((current) => (current === index ? null : index))
                    setNewSubcategoryName('')
                  }}
                  onDragStart={() => handleDragStart(index)}
                  onDragMove={handleDragMove}
                  onDragEnd={handleDragEnd}
                  onUpdate={(value) => updateAt(index, value)}
                  onFinishEdit={() => finishEdit(index)}
                />
                {isExpanded && categoryName && (
                  <section className="category-subcategory-panel category-subcategory-panel--inline">
                    <div className="category-subcategory-head">
                      <p className="eyebrow">二级分类</p>
                      <h3>{categoryName}</h3>
                    </div>
                    <div className="category-manager-add category-subcategory-add">
                      <input
                        type="text"
                        value={newSubcategoryName}
                        onChange={(e) => {
                          setNewSubcategoryName(e.target.value)
                          setError('')
                        }}
                        placeholder="新增二级分类"
                        className="category-manager-input"
                        maxLength={32}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => addSubcategory(categoryName)}
                      >
                        添加
                      </button>
                    </div>
                    <ul className="category-subcategory-list">
                      {subcategories.map((subcategory, subIndex) => (
                        <li className="category-subcategory-row" key={`${categoryName}-${subIndex}`}>
                          <input
                            type="text"
                            value={subcategory}
                            className="category-manager-input"
                            onChange={(e) => updateSubcategory(categoryName, subIndex, e.target.value)}
                            maxLength={32}
                          />
                          <button
                            type="button"
                            className="text-button"
                            disabled={subcategories.length <= 1}
                            onClick={() => removeSubcategory(categoryName, subIndex)}
                          >
                            删除
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </li>
            )
          })}
        </ul>

        {error && <p className="alert error category-manager-error">{error}</p>}

        <button type="button" className="text-button category-restore-btn" onClick={() => void handleRestore()} disabled={categoriesSaving}>
          恢复默认分类
        </button>
      </div>

      <footer className="category-manage-footer ledger-receipt-sheet-actions">
        <button type="button" className="secondary-button" onClick={goBack} disabled={categoriesSaving}>
          取消
        </button>
        <button type="button" className="primary-button" onClick={() => void handleSave()} disabled={categoriesSaving}>
          {categoriesSaving ? '保存中…' : '保存'}
        </button>
      </footer>
    </div>
  )

  return embedded ? content : <main className="sub-page-shell">{content}</main>
}

function CategoryManagerRow({
  index,
  name,
  isEditing,
  canDelete,
  isDragging,
  open,
  isExpanded,
  rowRef,
  onOpen,
  onClose,
  onEdit,
  onDelete,
  onToggleExpand,
  onDragStart,
  onDragMove,
  onDragEnd,
  onUpdate,
  onFinishEdit,
}: {
  index: number
  name: string
  isEditing: boolean
  canDelete: boolean
  isDragging: boolean
  open: boolean
  isExpanded: boolean
  rowRef: (node: HTMLDivElement | null) => void
  onOpen: () => void
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleExpand: () => void
  onDragStart: () => void
  onDragMove: (clientY: number) => void
  onDragEnd: () => void
  onUpdate: (value: string) => void
  onFinishEdit: () => void
}) {
  const startXRef = useRef(0)
  const startYRef = useRef(0)

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    startXRef.current = event.clientX
    startYRef.current = event.clientY
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (isEditing) {
      return
    }
    const dx = event.clientX - startXRef.current
    const dy = event.clientY - startYRef.current
    if (Math.abs(dx) < 16 || Math.abs(dx) < Math.abs(dy)) {
      return
    }
    if (dx < -36 && canDelete) {
      onOpen()
    } else if (dx > 36) {
      onClose()
    }
  }

  const handleDragPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    onDragStart()
  }

  const handleDragPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onDragMove(event.clientY)
  }

  const handleDragPointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    onDragEnd()
  }

  return (
    <div
      ref={rowRef}
      className={`transaction-swipe-row category-manager-swipe-row${open ? ' open' : ''}${
        isDragging ? ' dragging' : ''
      }`}
    >
      <button
        type="button"
        className="transaction-swipe-delete category-manager-swipe-delete"
        disabled={!canDelete}
        onClick={onDelete}
        aria-label={`删除分类 ${name}`}
      >
        删除
      </button>
      <div
        className={`category-manager-row transaction-swipe-card${
          isEditing ? ' category-manager-row--editing' : ''
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        {isEditing ? (
          <>
            <input
              type="text"
              value={name}
              onChange={(e) => onUpdate(e.target.value)}
              className="category-manager-input"
              maxLength={32}
              aria-label={`支出分类 ${index + 1}`}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onFinishEdit()
                }
              }}
            />
            <button type="button" className="text-button" onClick={onFinishEdit}>
              完成
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="category-manager-drag-handle"
              onPointerDown={handleDragPointerDown}
              onPointerMove={handleDragPointerMove}
              onPointerUp={handleDragPointerEnd}
              onPointerCancel={handleDragPointerEnd}
              aria-label={`拖拽排序 ${name}`}
            >
              <span aria-hidden />
            </button>
            <div className="category-manager-info">
              <strong>{name}</strong>
            </div>
            <div className="category-manager-actions">
              <button type="button" className="text-button" onClick={onEdit}>
                编辑
              </button>
              <button type="button" className="text-button" onClick={onToggleExpand}>
                {isExpanded ? '收起' : '展开'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
