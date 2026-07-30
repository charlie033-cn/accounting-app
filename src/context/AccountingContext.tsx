/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BUDGET_COLLECTION,
  RECURRING_COLLECTION,
  STORED_VALUE_CARD_COLLECTION,
  STORED_VALUE_CARD_RECORD_COLLECTION,
  TRANSACTION_COLLECTION,
  USER_CATEGORY_LISTS_COLLECTION,
  defaultExpenseSubcategories,
  expenseCategories,
  incomeCategories,
  initialForm,
  todayISO,
  currentMonth,
} from '../accounting/constants'
import { formatMoney } from '../accounting/format'
import { dynamicDailyBudget, remainingBudgetDays } from '../accounting/budgetMath'
import {
  buildHistoricalCategoryMigrationPreview,
  type CategoryMigrationSuggestion,
} from '../accounting/categoryMigration'
import type { CloudBudgetDoc } from '../types/budget'
import type { CloudUserCategoryListDoc } from '../types/categories'
import type { RecurringBillingType, RecurringTemplate } from '../types/recurring'
import type {
  Transaction,
  TransactionFormState,
  TransactionType,
} from '../types/transaction'
import { cloudbaseAuth, cloudbaseDb, isCloudBaseConfigured } from '../lib/cloudbase'
import { runRecurringGenerationIfDue } from '../lib/runRecurringGeneration'
import { effectiveBillingDateISO, splitRecurringAmount } from '../lib/recurringSchedule'
import {
  fetchAllTransactions,
  fetchRecentTransactions,
  fetchTransactionsByDateRange,
  type TransactionDateRange,
} from '../lib/transactionQueries'
import { monthDateRange } from '../lib/transactionDateRange'

function budgetCloudMessage(raw: string): string {
  const t = raw.trim()
  if (
    t.includes('Db or Table not exist') ||
    t.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    t.includes('ResourceNotFound') ||
    t.includes('COLLECTION_NOT_EXIST')
  ) {
    return '预算数据服务暂未完成配置，请联系管理员处理。'
  }
  return raw
}

const DEFAULT_EXPENSE_CATEGORIES = [...expenseCategories] as string[]
const DEFAULT_INCOME_CATEGORIES = [...incomeCategories] as string[]
const DEFAULT_EXPENSE_SUBCATEGORIES = { ...defaultExpenseSubcategories }
const RECENT_TRANSACTION_FETCH_LIMIT = 200

function normalizeUserCategoryNames(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) {
    return [...fallback]
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue
    }
    const t = item.trim()
    if (!t || seen.has(t)) {
      continue
    }
    seen.add(t)
    out.push(t)
  }
  return out.length > 0 ? out : [...fallback]
}

function normalizeExpenseSubcategoryMap(
  raw: unknown,
  expense: string[],
): Record<string, string[]> {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const out: Record<string, string[]> = {}
  for (const category of expense) {
    out[category] = normalizeUserCategoryNames(
      source[category],
      DEFAULT_EXPENSE_SUBCATEGORIES[category] ?? ['无法归类'],
    )
  }
  return out
}

function categoryListCloudMessage(raw: string): string {
  const t = raw.trim()
  if (
    t.includes('Db or Table not exist') ||
    t.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    t.includes('ResourceNotFound') ||
    t.includes('COLLECTION_NOT_EXIST')
  ) {
    return '分类数据服务暂未完成配置，请联系管理员处理。'
  }
  return raw
}

type AuthSession = {
  userId: string
  email: string
}

const REMEMBERED_AUTH_STORAGE_KEY = 'accounting-app:remembered-auth'

type RememberedAuth = {
  email: string
  password: string
}

type VerifySignupOtp = (params: {
  email: string
  token: string
  type: 'signup'
}) => Promise<{
  data: {
    user?: unknown
  }
  error: {
    message: string
  } | null
}>

type ResetPasswordUpdate = (params: {
  nonce: string
  password: string
}) => Promise<{
  data: {
    user?: unknown
  }
  error: {
    code?: string
    status?: string
    category?: string
    message: string
  } | null
}>

type CloudRecurringRow = Omit<RecurringTemplate, 'id'> & { _id: string }

type CloudStoredValueCardRecord = {
  _id: string
  user_id: string
  card_id: string
  type: 'recharge' | 'spend' | 'adjust'
  amount: number
  balance_after: number
  transaction_date: string
  note?: string | null
  linked_transaction_id?: string | null
  created_at: string
}

type CloudStoredValueCardRow = {
  _id: string
  user_id: string
  name: string
  merchant?: string | null
  linked_transaction_id?: string | null
}

const toRecurringTemplate = (row: CloudRecurringRow): RecurringTemplate => ({
  id: row._id,
  user_id: row.user_id,
  billing_type: row.billing_type,
  name: row.name,
  amount: Number(row.amount),
  total_amount: row.total_amount == null ? null : Number(row.total_amount),
  category: row.category,
  subcategory: row.subcategory ?? null,
  day_of_month: Number(row.day_of_month),
  start_period: row.start_period,
  start_date: row.start_date ?? null,
  duration_months: Number(row.duration_months),
  status: row.status === 'paused' ? 'paused' : 'active',
  created_at: row.created_at,
  updated_at: row.updated_at,
})

function periodAfterMonths(startPeriod: string, offset: number): string {
  const [year, month] = startPeriod.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) {
    return startPeriod
  }
  const date = new Date(year, month - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function sortStoredValueCardRecords(a: CloudStoredValueCardRecord, b: CloudStoredValueCardRecord): number {
  const dateOrder = a.transaction_date.localeCompare(b.transaction_date)
  if (dateOrder !== 0) {
    return dateOrder
  }
  return a.created_at.localeCompare(b.created_at)
}

function moneyCents(value: number): number {
  return Math.round(Number(value || 0) * 100)
}

function isLegacyStoredValueCardTransaction(transaction: Transaction): boolean {
  return (
    transaction.type === 'expense' &&
    (transaction.source === 'stored_value_card' || (transaction.note ?? '').includes('储值卡'))
  )
}

async function findLegacyStoredValueCardRecordForTransaction(
  db: NonNullable<typeof cloudbaseDb>,
  userId: string,
  transaction: Transaction,
): Promise<CloudStoredValueCardRecord | null> {
  if (!isLegacyStoredValueCardTransaction(transaction)) {
    return null
  }

  const result = (await db
    .collection(STORED_VALUE_CARD_RECORD_COLLECTION)
    .where({
      user_id: userId,
      type: 'recharge',
      transaction_date: transaction.transaction_date,
    })
    .get()) as { data?: CloudStoredValueCardRecord[] }

  const candidates = (result.data ?? []).filter(
    (record) =>
      !record.linked_transaction_id &&
      moneyCents(record.amount) === moneyCents(transaction.amount),
  )

  if (candidates.length <= 1) {
    return candidates[0] ?? null
  }

  const cardsResult = (await db
    .collection(STORED_VALUE_CARD_COLLECTION)
    .where({ user_id: userId })
    .get()) as { data?: CloudStoredValueCardRow[] }
  const cardsById = new Map((cardsResult.data ?? []).map((card) => [card._id, card]))
  const note = transaction.note ?? ''
  const matched = candidates.filter((record) => {
    const card = cardsById.get(record.card_id)
    if (!card) {
      return false
    }
    return Boolean((card.name && note.includes(card.name)) || (card.merchant && note.includes(card.merchant)))
  })

  return matched.length === 1 ? matched[0] : null
}

async function recalculateStoredValueCardBalance(
  db: NonNullable<typeof cloudbaseDb>,
  userId: string,
  cardId: string,
) {
  const result = (await db
    .collection(STORED_VALUE_CARD_RECORD_COLLECTION)
    .where({ user_id: userId, card_id: cardId })
    .get()) as { data?: CloudStoredValueCardRecord[] }

  const records = [...(result.data ?? [])].sort(sortStoredValueCardRecords)
  let balance = 0
  let totalRecharged = 0
  let totalSpent = 0

  for (const record of records) {
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

async function syncStoredValueCardRecordFromTransaction(
  db: NonNullable<typeof cloudbaseDb>,
  userId: string,
  transactionId: string,
  payload: {
    type: TransactionType
    amount: number
    transaction_date: string
    note: string | null
  } | null,
  legacyTransaction?: Transaction | null,
) {
  const result = (await db
    .collection(STORED_VALUE_CARD_RECORD_COLLECTION)
    .where({ user_id: userId, linked_transaction_id: transactionId })
    .get()) as { data?: CloudStoredValueCardRecord[] }
  let record = result.data?.[0] ?? null
  if (!record && legacyTransaction) {
    record = await findLegacyStoredValueCardRecordForTransaction(db, userId, legacyTransaction)
    if (record) {
      await db.collection(STORED_VALUE_CARD_RECORD_COLLECTION).doc(record._id).update({
        linked_transaction_id: transactionId,
      })
    }
  }
  if (!record) {
    return
  }

  if (!payload || payload.type !== 'expense') {
    await db.collection(STORED_VALUE_CARD_RECORD_COLLECTION).doc(record._id).remove()
    await recalculateStoredValueCardBalance(db, userId, record.card_id)
    return
  }

  await db.collection(STORED_VALUE_CARD_RECORD_COLLECTION).doc(record._id).update({
    amount: payload.amount,
    transaction_date: payload.transaction_date,
    note: payload.note,
  })
  await recalculateStoredValueCardBalance(db, userId, record.card_id)
}

const getSessionFromLoginState = (loginState: unknown): AuthSession | null => {
  const state = loginState as {
    user?: {
      uid?: string
      email?: string
      emailVerified?: string
      user_metadata?: {
        uid?: string
        email?: string
      }
    }
  } | null

  const user = state?.user
  const userId = user?.uid ?? user?.user_metadata?.uid
  if (!userId) {
    return null
  }

  return {
    userId,
    email: user?.email ?? user?.user_metadata?.email ?? '已登录用户',
  }
}

const loadRememberedAuth = (): RememberedAuth | null => {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.localStorage.getItem(REMEMBERED_AUTH_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<RememberedAuth>
    if (typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
      return null
    }

    return {
      email: parsed.email,
      password: parsed.password,
    }
  } catch {
    return null
  }
}

const saveRememberedAuth = (next: RememberedAuth) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(REMEMBERED_AUTH_STORAGE_KEY, JSON.stringify(next))
}

const clearRememberedAuth = () => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(REMEMBERED_AUTH_STORAGE_KEY)
}

function passwordChangeErrorMessage(error: unknown) {
  const value = error as {
    code?: string
    status?: string
    message?: string
    category?: string
  } | null
  const text = [value?.code, value?.status, value?.category, value?.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (text.includes('password_too_weak') || text.includes('weak password')) {
    return '新密码强度不足，请使用 8～32 位，并建议组合字母和数字'
  }
  if (
    text.includes('invalid_password') ||
    text.includes('wrong_password') ||
    text.includes('invalid_credentials') ||
    text.includes('invalid_username_or_password')
  ) {
    return '当前密码不正确，请重新输入'
  }
  if (text.includes('same_password') || text.includes('same password')) {
    return '新密码不能与当前密码相同'
  }
  if (text.includes('resource_exhausted') || text.includes('too many')) {
    return '操作过于频繁，请稍后再试'
  }
  if (text.includes('timeout') || text.includes('network') || text.includes('unavailable')) {
    return '网络连接异常，请稍后重试'
  }
  return '密码修改失败，请检查输入后重试'
}

function passwordResetErrorMessage(error: unknown) {
  const value = error as {
    code?: string
    status?: string
    message?: string
    category?: string
  } | null
  const text = [value?.code, value?.status, value?.category, value?.message]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (
    text.includes('invalid_verification_code') ||
    text.includes('invalid code') ||
    (text.includes('verification') && text.includes('expired'))
  ) {
    return '验证码不正确或已过期，请重新输入'
  }
  if (text.includes('password_too_weak') || text.includes('weak password')) {
    return '新密码强度不足，请使用 8～32 位，并建议组合字母和数字'
  }
  if (text.includes('resource_exhausted') || text.includes('too many')) {
    return '操作过于频繁，请稍后再试'
  }
  if (text.includes('timeout') || text.includes('network') || text.includes('unavailable')) {
    return '网络连接异常，请稍后重试'
  }
  return '操作未完成，请检查邮箱或验证码后重试'
}

export type AccountingContextType = {
  isCloudBaseConfigured: boolean
  session: AuthSession | null
  transactions: Transaction[]
  isLoading: boolean
  error: string
  message: string
  setError: (v: string) => void
  setMessage: (v: string) => void
  loadTransactions: (userId: string) => Promise<void>
  loadTransactionsByDateRange: (range: TransactionDateRange) => Promise<Transaction[]>
  loadAllTransactions: () => Promise<Transaction[]>
  form: TransactionFormState
  setForm: React.Dispatch<React.SetStateAction<TransactionFormState>>
  editingId: string | null
  cancelEdit: () => void
  handleTypeChange: (type: TransactionType) => void
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  saveTransactionsFromDrafts: (drafts: TransactionFormState[]) => Promise<void>
  updateTransaction: (id: string, draft: TransactionFormState) => Promise<void>
  handleDeleteTransaction: (id: string) => Promise<void>
  beginEditTransaction: (item: Transaction) => void
  categoryOptions: (type: TransactionType) => string[]
  formatMoney: (n: number) => string
  handleSignOut: () => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
  authMode: 'sign-in' | 'sign-up'
  setAuthMode: (m: 'sign-in' | 'sign-up') => void
  email: string
  setEmail: (v: string) => void
  password: string
  setPassword: (v: string) => void
  rememberPassword: boolean
  setRememberPassword: (v: boolean) => void
  isVerifyingSignup: boolean
  verificationEmail: string
  verificationCode: string
  setVerificationCode: (v: string) => void
  handleAuth: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleVerifySignup: (event: FormEvent<HTMLFormElement>) => Promise<void>
  cancelVerifyFlow: () => void
  requestPasswordReset: (email: string) => Promise<void>
  completePasswordReset: (code: string, newPassword: string) => Promise<void>
  cancelPasswordReset: () => void
  budgetPeriod: string
  setBudgetPeriod: (v: string) => void
  budgetDocId: string | null
  budgetAmount: number | null
  budgetDraft: string
  setBudgetDraft: (v: string) => void
  budgetLoading: boolean
  budgetSaving: boolean
  budgetError: string
  budgetSuccess: string
  setBudgetError: (v: string) => void
  setBudgetSuccess: (v: string) => void
  handleSaveBudget: (event: FormEvent<HTMLFormElement>) => Promise<void>
  budgetDays: number
  dailyBudgetReference: number | null
  todayVsDailyPercent: number | null
  monthVsBudgetPercent: number | null
  monthExpenseTotal: number
  todayExpenseTotal: number
  recurringTemplates: RecurringTemplate[]
  recurringLoading: boolean
  loadRecurringTemplates: (userId: string) => Promise<void>
  createRecurringTemplate: (input: {
    billing_type: RecurringBillingType
    name: string
    amount: number
    total_amount?: number | null
    category: string
    subcategory?: string | null
    day_of_month: number
    start_period: string
    start_date?: string
    duration_months: number
  }) => Promise<void>
  updateRecurringTemplate: (id: string, input: {
    billing_type: RecurringBillingType
    name: string
    amount: number
    total_amount?: number | null
    category: string
    subcategory?: string | null
    day_of_month: number
    start_period: string
    start_date?: string
    duration_months: number
  }) => Promise<void>
  deleteRecurringTemplate: (id: string) => Promise<void>
  setRecurringPaused: (id: string, paused: boolean) => Promise<void>
  expenseCategoryNames: string[]
  expenseSubcategoryMap: Record<string, string[]>
  incomeCategoryNames: string[]
  subcategoryOptions: (category: string) => string[]
  categoryMigrationPreview: CategoryMigrationSuggestion[]
  migrateHistoricalCategories: () => Promise<number>
  saveUserCategoryLists: (payload: {
    expense: string[]
    income: string[]
    expenseSubcategories?: Record<string, string[]>
  }) => Promise<void>
  restoreDefaultCategoryLists: () => Promise<void>
  categoriesLoading: boolean
  categoriesSaving: boolean
}

/**
 * @eslint react-refresh/only-export-components — hook与 Provider 同文件便于维护
 */
const AccountingContext = createContext<AccountingContextType | null>(null)

export function useAccounting() {
  const ctx = useContext(AccountingContext)
  if (!ctx) {
    throw new Error('useAccounting 必须在 AccountingProvider 内使用')
  }
  return ctx
}

export function AccountingProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberPassword, setRememberPassword] = useState(false)
  const [isVerifyingSignup, setIsVerifyingSignup] = useState(false)
  const [verificationEmail, setVerificationEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [form, setForm] = useState<TransactionFormState>(() => initialForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [budgetPeriod, setBudgetPeriod] = useState(currentMonth())
  const [budgetDocId, setBudgetDocId] = useState<string | null>(null)
  const [budgetAmount, setBudgetAmount] = useState<number | null>(null)
  const [budgetDraft, setBudgetDraft] = useState('')
  const [budgetLoading, setBudgetLoading] = useState(false)
  const [budgetSaving, setBudgetSaving] = useState(false)
  const [budgetError, setBudgetError] = useState('')
  const [budgetSuccess, setBudgetSuccess] = useState('')
  const [budgetTransactions, setBudgetTransactions] = useState<Transaction[]>([])
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTemplate[]>([])
  const [recurringLoading, setRecurringLoading] = useState(false)
  const [expenseCategoryNames, setExpenseCategoryNames] = useState<string[]>(
    () => [...expenseCategories] as string[],
  )
  const [expenseSubcategoryMap, setExpenseSubcategoryMap] = useState<Record<string, string[]>>(
    () => normalizeExpenseSubcategoryMap(DEFAULT_EXPENSE_SUBCATEGORIES, DEFAULT_EXPENSE_CATEGORIES),
  )
  const [incomeCategoryNames, setIncomeCategoryNames] = useState<string[]>(
    () => [...incomeCategories] as string[],
  )
  const [categoryListsDocId, setCategoryListsDocId] = useState<string | null>(null)
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesSaving, setCategoriesSaving] = useState(false)
  const verifySignupRef = useRef<VerifySignupOtp | null>(null)
  const passwordResetUpdateRef = useRef<ResetPasswordUpdate | null>(null)
  const passwordResetEmailRef = useRef('')
  const messageDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const budgetSuccessDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const remembered = loadRememberedAuth()
    if (!remembered) {
      return
    }

    setEmail(remembered.email)
    setPassword(remembered.password)
    setRememberPassword(true)
  }, [])

  useEffect(() => {
    if (messageDismissTimerRef.current) {
      clearTimeout(messageDismissTimerRef.current)
      messageDismissTimerRef.current = null
    }
    if (!message.trim()) {
      return
    }
    messageDismissTimerRef.current = setTimeout(() => {
      messageDismissTimerRef.current = null
      setMessage('')
    }, 3000)
    return () => {
      if (messageDismissTimerRef.current) {
        clearTimeout(messageDismissTimerRef.current)
        messageDismissTimerRef.current = null
      }
    }
  }, [message])

  useEffect(() => {
    if (budgetSuccessDismissTimerRef.current) {
      clearTimeout(budgetSuccessDismissTimerRef.current)
      budgetSuccessDismissTimerRef.current = null
    }
    if (!budgetSuccess.trim()) {
      return
    }
    budgetSuccessDismissTimerRef.current = setTimeout(() => {
      budgetSuccessDismissTimerRef.current = null
      setBudgetSuccess('')
    }, 3000)
    return () => {
      if (budgetSuccessDismissTimerRef.current) {
        clearTimeout(budgetSuccessDismissTimerRef.current)
        budgetSuccessDismissTimerRef.current = null
      }
    }
  }, [budgetSuccess])

  const loadRecurringTemplates = useCallback(async (userId: string) => {
    const db = cloudbaseDb
    if (!db || !userId) {
      return
    }
    setRecurringLoading(true)
    try {
      const res = await db.collection(RECURRING_COLLECTION).where({ user_id: userId }).get()
      setRecurringTemplates((res.data as CloudRecurringRow[]).map(toRecurringTemplate))
    } catch {
      setRecurringTemplates([])
    } finally {
      setRecurringLoading(false)
    }
  }, [])

  const categoryOptions = useCallback(
    (type: TransactionType) => (type === 'expense' ? expenseCategoryNames : incomeCategoryNames),
    [expenseCategoryNames, incomeCategoryNames],
  )

  const subcategoryOptions = useCallback(
    (category: string) => expenseSubcategoryMap[category] ?? [],
    [expenseSubcategoryMap],
  )

  const buildEmptyForm = useCallback((): TransactionFormState => {
    return {
      ...initialForm(),
      category: expenseCategoryNames[0] ?? (expenseCategories[0] as string),
      subcategory: '',
    }
  }, [expenseCategoryNames])

  const loadTransactions = useCallback(async (userId: string) => {
    const db = cloudbaseDb
    if (!db) {
      return
    }

    setIsLoading(true)
    setError('')

    try {
      setTransactions(await fetchRecentTransactions(db, userId, RECENT_TRANSACTION_FETCH_LIMIT))

      const added = await runRecurringGenerationIfDue(db, userId)
      if (added > 0) {
        setTransactions(await fetchRecentTransactions(db, userId, RECENT_TRANSACTION_FETCH_LIMIT))
      }

      await loadRecurringTemplates(userId)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '账单同步失败')
    } finally {
      setIsLoading(false)
    }
  }, [loadRecurringTemplates])

  const loadTransactionsByDateRange = useCallback(
    async (range: TransactionDateRange) => {
      const db = cloudbaseDb
      const userId = session?.userId
      if (!db || !userId) {
        return []
      }
      return fetchTransactionsByDateRange(db, userId, range)
    },
    [session?.userId],
  )

  const loadAllTransactions = useCallback(async () => {
    const db = cloudbaseDb
    const userId = session?.userId
    if (!db || !userId) {
      return []
    }
    return fetchAllTransactions(db, userId)
  }, [session?.userId])

  useEffect(() => {
    if (!cloudbaseAuth) {
      return
    }

    const auth = cloudbaseAuth
    const restore = async () => {
      try {
        const loginState = await auth.getLoginState()
        const nextSession = getSessionFromLoginState(loginState)
        if (nextSession) {
          setSession(nextSession)
          await loadTransactions(nextSession.userId)
        }
      } catch {
        setSession(null)
      }
    }

    void restore()

    const listener = auth.onAuthStateChange((_event, nextLoginState) => {
      const nextSession = getSessionFromLoginState(nextLoginState)
      setSession(nextSession)
      if (nextSession) {
        void loadTransactions(nextSession.userId)
      } else {
        setTransactions([])
        setBudgetDocId(null)
        setBudgetAmount(null)
        setBudgetDraft('')
        setBudgetTransactions([])
        setBudgetError('')
        setBudgetSuccess('')
        setRecurringTemplates([])
        setCategoryListsDocId(null)
        setExpenseCategoryNames([...DEFAULT_EXPENSE_CATEGORIES])
        setIncomeCategoryNames([...DEFAULT_INCOME_CATEGORIES])
      }
    })

    return () => listener.data.subscription.unsubscribe()
  }, [loadTransactions])

  useEffect(() => {
    const userId = session?.userId
    const db = cloudbaseDb
    if (!userId || !db || !/^\d{4}-\d{2}$/.test(budgetPeriod)) {
      return
    }

    let cancelled = false

    const loadBudget = async () => {
      setBudgetLoading(true)
      setBudgetError('')
      setBudgetSuccess('')
      try {
        const [result, periodTransactions] = await Promise.all([
          db
            .collection(BUDGET_COLLECTION)
            .where({ user_id: userId, period: budgetPeriod })
            .limit(1)
            .get() as Promise<{ data?: CloudBudgetDoc[]; code?: string; message?: string }>,
          fetchTransactionsByDateRange(db, userId, monthDateRange(budgetPeriod)),
        ])

        if (cancelled) {
          return
        }

        setBudgetTransactions(periodTransactions)

        if (result.code) {
          setBudgetDocId(null)
          setBudgetAmount(null)
          setBudgetDraft('')
          setBudgetTransactions([])
          setBudgetError(budgetCloudMessage(result.message || '预算加载失败'))
          return
        }

        const row = result.data?.[0]
        if (row) {
          setBudgetDocId(row._id)
          const amount = Number(row.monthly_amount)
          if (Number.isFinite(amount) && amount >= 0) {
            setBudgetAmount(amount)
            setBudgetDraft(String(amount))
          } else {
            setBudgetAmount(null)
            setBudgetDraft('')
          }
        } else {
          setBudgetDocId(null)
          setBudgetAmount(null)
          setBudgetDraft('')
        }
      } catch (err) {
        if (!cancelled) {
          setBudgetDocId(null)
          setBudgetAmount(null)
          setBudgetDraft('')
          setBudgetTransactions([])
          const raw = err instanceof Error ? err.message : '预算加载失败'
          setBudgetError(budgetCloudMessage(raw))
        }
      } finally {
        if (!cancelled) {
          setBudgetLoading(false)
        }
      }
    }

    void loadBudget()
    return () => {
      cancelled = true
    }
  }, [session?.userId, budgetPeriod, transactions])

  useEffect(() => {
    const userId = session?.userId
    const db = cloudbaseDb
    if (!userId || !db) {
      return
    }

    let cancelled = false

    const loadCategoryLists = async () => {
      setCategoriesLoading(true)
      try {
        const result = (await db
          .collection(USER_CATEGORY_LISTS_COLLECTION)
          .where({ user_id: userId })
          .limit(1)
          .get()) as { data?: CloudUserCategoryListDoc[]; code?: string; message?: string }

        if (cancelled) {
          return
        }

        if (result.code) {
          setCategoryListsDocId(null)
          setExpenseCategoryNames([...DEFAULT_EXPENSE_CATEGORIES])
          setExpenseSubcategoryMap(normalizeExpenseSubcategoryMap(DEFAULT_EXPENSE_SUBCATEGORIES, DEFAULT_EXPENSE_CATEGORIES))
          setIncomeCategoryNames([...DEFAULT_INCOME_CATEGORIES])
          return
        }

        const row = result.data?.[0]
        if (row) {
          setCategoryListsDocId(row._id)
          const expense = normalizeUserCategoryNames(row.expense, DEFAULT_EXPENSE_CATEGORIES)
          setExpenseCategoryNames(expense)
          setExpenseSubcategoryMap(normalizeExpenseSubcategoryMap(row.expense_subcategories, expense))
          setIncomeCategoryNames(normalizeUserCategoryNames(row.income, DEFAULT_INCOME_CATEGORIES))
        } else {
          setCategoryListsDocId(null)
          setExpenseCategoryNames([...DEFAULT_EXPENSE_CATEGORIES])
          setExpenseSubcategoryMap(normalizeExpenseSubcategoryMap(DEFAULT_EXPENSE_SUBCATEGORIES, DEFAULT_EXPENSE_CATEGORIES))
          setIncomeCategoryNames([...DEFAULT_INCOME_CATEGORIES])
        }
      } catch {
        if (!cancelled) {
          setCategoryListsDocId(null)
          setExpenseCategoryNames([...DEFAULT_EXPENSE_CATEGORIES])
          setExpenseSubcategoryMap(normalizeExpenseSubcategoryMap(DEFAULT_EXPENSE_SUBCATEGORIES, DEFAULT_EXPENSE_CATEGORIES))
          setIncomeCategoryNames([...DEFAULT_INCOME_CATEGORIES])
        }
      } finally {
        if (!cancelled) {
          setCategoriesLoading(false)
        }
      }
    }

    void loadCategoryLists()
    return () => {
      cancelled = true
    }
  }, [session?.userId])

  const monthExpenseTotal = useMemo(() => {
    if (!/^\d{4}-\d{2}$/.test(budgetPeriod)) {
      return 0
    }
    return budgetTransactions
      .filter((item) => item.type === 'expense' && item.transaction_date.startsWith(budgetPeriod))
      .reduce((sum, item) => sum + item.amount, 0)
  }, [budgetTransactions, budgetPeriod])

  const todayExpenseTotal = useMemo(() => {
    if (budgetPeriod !== currentMonth()) {
      return 0
    }
    const day = todayISO()
    return budgetTransactions
      .filter((item) => item.type === 'expense' && item.transaction_date === day)
      .reduce((sum, item) => sum + item.amount, 0)
  }, [budgetTransactions, budgetPeriod])

  const budgetDays = remainingBudgetDays(budgetPeriod)
  const dailyBudgetReference = dynamicDailyBudget(budgetPeriod, budgetAmount, monthExpenseTotal)
  const todayVsDailyPercent =
    dailyBudgetReference != null && dailyBudgetReference > 0
      ? (todayExpenseTotal / dailyBudgetReference) * 100
      : null
  const monthVsBudgetPercent =
    budgetAmount != null && budgetAmount > 0 ? (monthExpenseTotal / budgetAmount) * 100 : null

  const categoryMigrationPreview = useMemo(
    () =>
      buildHistoricalCategoryMigrationPreview(
        transactions,
        expenseCategoryNames,
        expenseSubcategoryMap,
      ),
    [expenseCategoryNames, expenseSubcategoryMap, transactions],
  )

  const saveUserCategoryLists = useCallback(
    async (payload: {
      expense: string[]
      income: string[]
      expenseSubcategories?: Record<string, string[]>
    }) => {
      const db = cloudbaseDb
      const uid = session?.userId
      if (!db || !uid) {
        throw new Error('未登录')
      }

      const expense = normalizeUserCategoryNames(payload.expense, DEFAULT_EXPENSE_CATEGORIES)
      const income = normalizeUserCategoryNames(payload.income, DEFAULT_INCOME_CATEGORIES)
      const expenseSubcategories = normalizeExpenseSubcategoryMap(
        payload.expenseSubcategories ?? expenseSubcategoryMap,
        expense,
      )
      const now = new Date().toISOString()

      setCategoriesSaving(true)
      try {
        if (categoryListsDocId) {
          await db.collection(USER_CATEGORY_LISTS_COLLECTION).doc(categoryListsDocId).update({
            expense,
            expense_subcategories: expenseSubcategories,
            income,
            updated_at: now,
          })
        } else {
          const addRes = (await db.collection(USER_CATEGORY_LISTS_COLLECTION).add({
            user_id: uid,
            expense,
            expense_subcategories: expenseSubcategories,
            income,
            created_at: now,
            updated_at: now,
          })) as { id?: string; code?: string; message?: string }

          if (addRes.code) {
            throw new Error(categoryListCloudMessage(addRes.message || '保存失败'))
          }
          if (addRes.id) {
            setCategoryListsDocId(addRes.id)
          }
        }
        setExpenseCategoryNames(expense)
        setExpenseSubcategoryMap(expenseSubcategories)
        setIncomeCategoryNames(income)
        setMessage('分类已保存')
      } catch (e) {
        throw e instanceof Error ? e : new Error('保存失败')
      } finally {
        setCategoriesSaving(false)
      }
    },
    [session?.userId, categoryListsDocId, expenseSubcategoryMap],
  )

  const restoreDefaultCategoryLists = useCallback(async () => {
    await saveUserCategoryLists({
      expense: [...DEFAULT_EXPENSE_CATEGORIES],
      income: [...DEFAULT_INCOME_CATEGORIES],
      expenseSubcategories: DEFAULT_EXPENSE_SUBCATEGORIES,
    })
    setMessage('已恢复默认分类')
  }, [saveUserCategoryLists])

  useEffect(() => {
    setForm((f) => {
      const list = f.type === 'expense' ? expenseCategoryNames : incomeCategoryNames
      if (list.length === 0) {
        return f
      }
      const category = list.includes(f.category) ? f.category : list[0]
      if (f.type !== 'expense') {
        return category === f.category ? f : { ...f, category, subcategory: '' }
      }
      const subcategories = subcategoryOptions(category)
      const subcategory = !f.subcategory || subcategories.includes(f.subcategory) ? f.subcategory : ''
      if (category === f.category && subcategory === f.subcategory) {
        return f
      }
      return { ...f, category, subcategory }
    })
  }, [expenseCategoryNames, incomeCategoryNames, subcategoryOptions])

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!cloudbaseAuth) {
      return
    }

    setIsLoading(true)
    setMessage('')
    setError('')

    try {
      if (authMode === 'sign-up') {
        const result = await cloudbaseAuth.signUp({
          email,
          password,
        })

        if (result.error) {
          throw new Error(result.error.message)
        }

        if (!result.data.verifyOtp) {
          throw new Error('验证码回调未返回，请重新注册')
        }

        verifySignupRef.current = result.data.verifyOtp as VerifySignupOtp
        setIsVerifyingSignup(true)
        setVerificationEmail(email)
        setVerificationCode('')
        setMessage('验证码已发送，请输入邮箱中的验证码完成注册')
      } else {
        const result = await cloudbaseAuth.signInWithPassword({
          email,
          password,
        })

        if (result.error) {
          throw new Error(result.error.message)
        }

        const nextSession = getSessionFromLoginState({ user: result.data.user })
        if (!nextSession) {
          throw new Error('登录成功但未获取到用户信息')
        }

        if (rememberPassword) {
          saveRememberedAuth({ email, password })
        } else {
          clearRememberedAuth()
        }

        setSession(nextSession)
        setMessage('登录成功')
        await loadTransactions(nextSession.userId)
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : '认证失败')
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifySignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!verifySignupRef.current) {
      setError('验证码流程已失效，请重新注册')
      return
    }

    setIsLoading(true)
    setMessage('')
    setError('')

    try {
      const result = await verifySignupRef.current({
        email: verificationEmail,
        token: verificationCode.trim(),
        type: 'signup',
      })

      if (result.error) {
        throw new Error(result.error.message)
      }

      verifySignupRef.current = null
      setIsVerifyingSignup(false)
      setVerificationCode('')
      setAuthMode('sign-in')
      setMessage('注册验证成功，请用邮箱和密码登录')
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : '验证码验证失败')
    } finally {
      setIsLoading(false)
    }
  }

  const cancelVerifyFlow = useCallback(() => {
    verifySignupRef.current = null
    setIsVerifyingSignup(false)
    setVerificationCode('')
    setMessage('')
    setError('')
  }, [])

  const requestPasswordReset = useCallback(async (emailAddress: string) => {
    if (!cloudbaseAuth) {
      throw new Error('账号服务暂不可用，请稍后重试')
    }

    const normalizedEmail = emailAddress.trim().toLowerCase()
    const result = await cloudbaseAuth.resetPasswordForEmail(normalizedEmail)
    if (result.error) {
      throw new Error(passwordResetErrorMessage(result.error))
    }
    if (!result.data.updateUser) {
      throw new Error('验证码发送失败，请稍后重试')
    }

    passwordResetUpdateRef.current = result.data.updateUser as ResetPasswordUpdate
    passwordResetEmailRef.current = normalizedEmail
  }, [])

  const completePasswordReset = useCallback(async (code: string, newPassword: string) => {
    const updatePassword = passwordResetUpdateRef.current
    if (!updatePassword) {
      throw new Error('本次验证码流程已失效，请重新获取验证码')
    }

    const result = await updatePassword({
      nonce: code.trim(),
      password: newPassword,
    })
    if (result.error) {
      throw new Error(passwordResetErrorMessage(result.error))
    }

    const nextSession = getSessionFromLoginState({ user: result.data.user })
    if (!nextSession) {
      throw new Error('密码已重置，请返回登录页使用新密码登录')
    }

    passwordResetUpdateRef.current = null
    clearRememberedAuth()
    setEmail(passwordResetEmailRef.current)
    setPassword('')
    setRememberPassword(false)
    setSession(nextSession)
    setMessage('密码已重置并登录')
    await loadTransactions(nextSession.userId)
  }, [loadTransactions])

  const cancelPasswordReset = useCallback(() => {
    passwordResetUpdateRef.current = null
    passwordResetEmailRef.current = ''
  }, [])

  const handleSignOut = async () => {
    if (!cloudbaseAuth) {
      return
    }

    await cloudbaseAuth.signOut()
    setSession(null)
    setTransactions([])
    setCategoryListsDocId(null)
    setExpenseCategoryNames([...DEFAULT_EXPENSE_CATEGORIES])
      setExpenseSubcategoryMap(normalizeExpenseSubcategoryMap(DEFAULT_EXPENSE_SUBCATEGORIES, DEFAULT_EXPENSE_CATEGORIES))
    setIncomeCategoryNames([...DEFAULT_INCOME_CATEGORIES])
    setForm({
      ...initialForm(),
      category: DEFAULT_EXPENSE_CATEGORIES[0],
      subcategory: '',
    })
    setEditingId(null)
    setBudgetDocId(null)
    setBudgetAmount(null)
    setBudgetDraft('')
    setBudgetTransactions([])
    setBudgetError('')
    setBudgetSuccess('')
    setMessage('已退出登录')
  }

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    if (!cloudbaseAuth || !session) {
      throw new Error('当前登录状态已失效，请重新登录')
    }

    const result = await cloudbaseAuth.resetPasswordForOld({
      old_password: oldPassword,
      new_password: newPassword,
    })

    if (result.error) {
      throw new Error(passwordChangeErrorMessage(result.error))
    }

    clearRememberedAuth()
    setRememberPassword(false)
    setPassword('')
    setMessage('密码修改成功，本机记住的旧密码已清除')
  }, [session])

  const handleSaveBudget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const db = cloudbaseDb
    if (!db || !session) {
      return
    }

    const raw = budgetDraft.trim()
    if (!raw) {
      setBudgetError('请输入金额：0 表示当月不设预算')
      return
    }

    const num = Number(raw)
    if (!Number.isFinite(num) || num < 0) {
      setBudgetError('请输入 ≥ 0 的数字，0 表示当月不设预算')
      return
    }

    setBudgetSaving(true)
    setBudgetError('')
    setBudgetSuccess('')

    const now = new Date().toISOString()

    try {
      if (budgetDocId) {
        await db.collection(BUDGET_COLLECTION).doc(budgetDocId).update({
          monthly_amount: num,
          updated_at: now,
        })
      } else {
        const addRes = (await db.collection(BUDGET_COLLECTION).add({
          user_id: session.userId,
          period: budgetPeriod,
          monthly_amount: num,
          created_at: now,
          updated_at: now,
        })) as { id?: string; code?: string; message?: string }

        if (addRes.code) {
          throw new Error(addRes.message || '预算保存失败')
        }
        if (addRes.id) {
          setBudgetDocId(addRes.id)
        } else {
          const again = (await db
            .collection(BUDGET_COLLECTION)
            .where({ user_id: session.userId, period: budgetPeriod })
            .limit(1)
            .get()) as { data?: CloudBudgetDoc[]; code?: string; message?: string }

          if (again.code) {
            throw new Error(again.message || '预算保存失败')
          }
          const row = again.data?.[0]
          if (row?._id) {
            setBudgetDocId(row._id)
          }
        }
      }

      setBudgetAmount(num)
      setBudgetDraft(String(num))
      setBudgetSuccess('预算已保存')
    } catch (saveBudgetError) {
      const raw =
        saveBudgetError instanceof Error ? saveBudgetError.message : '预算保存失败'
      setBudgetError(budgetCloudMessage(raw))
    } finally {
      setBudgetSaving(false)
    }
  }

  const handleTypeChange = (type: TransactionType) => {
    const category = (type === 'expense' ? expenseCategoryNames : incomeCategoryNames)[0]
    setForm((current) => ({
      ...current,
      type,
      category: category ?? current.category,
      subcategory: '',
    }))
  }

  const migrateHistoricalCategories = useCallback(async () => {
    const db = cloudbaseDb
    const uid = session?.userId
    if (!db || !uid || categoryMigrationPreview.length === 0) {
      return 0
    }
    setIsLoading(true)
    setError('')
    setMessage('')
    const now = new Date().toISOString()
    try {
      for (const item of categoryMigrationPreview) {
        await db.collection(TRANSACTION_COLLECTION).doc(item.id).update({
          category: item.toCategory,
          subcategory: item.toSubcategory,
          migrated_category_from: item.fromCategory,
          migrated_subcategory_from: item.fromSubcategory,
          migrated_category_at: now,
          updated_at: now,
        })
      }
      await loadTransactions(uid)
      setMessage(`已整理 ${categoryMigrationPreview.length} 笔历史账单分类`)
      return categoryMigrationPreview.length
    } catch (e) {
      setError(e instanceof Error ? e.message : '历史分类整理失败')
      throw e
    } finally {
      setIsLoading(false)
    }
  }, [categoryMigrationPreview, loadTransactions, session?.userId])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setForm(buildEmptyForm())
  }, [buildEmptyForm])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const db = cloudbaseDb
    if (!db || !session) {
      return
    }

    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('请输入大于 0 的金额')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.transaction_date)) {
      setError('请选择日期')
      return
    }

    setIsLoading(true)
    setError('')
    setMessage('')

    const now = new Date().toISOString()
    const payload = {
      user_id: session.userId,
      type: form.type,
      amount,
      category: form.category,
      subcategory: form.type === 'expense' ? form.subcategory || null : null,
      transaction_date: form.transaction_date,
      note: form.note.trim() || null,
      updated_at: now,
    }

    try {
      if (editingId) {
        const previousTransaction = transactions.find((item) => item.id === editingId) ?? null
        await db.collection(TRANSACTION_COLLECTION).doc(editingId).update(payload)
        await syncStoredValueCardRecordFromTransaction(db, session.userId, editingId, {
          type: payload.type,
          amount: payload.amount,
          transaction_date: payload.transaction_date,
          note: payload.note,
        }, previousTransaction)
      } else {
        await db.collection(TRANSACTION_COLLECTION).add({
          ...payload,
          created_at: now,
        })
      }

      setMessage(editingId ? '账单已更新' : '账单已保存')
      setForm(buildEmptyForm())
      setEditingId(null)
      await loadTransactions(session.userId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '账单保存失败')
    } finally {
      setIsLoading(false)
    }
  }

  const saveTransactionsFromDrafts = useCallback(
    async (drafts: TransactionFormState[]) => {
      const db = cloudbaseDb
      if (!db || !session) {
        return
      }
      if (drafts.length === 0) {
        setError('请选择要保存的识别结果')
        return
      }

      const rows = drafts.map((draft, index) => {
        const amount = Number(draft.amount)
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error(`第 ${index + 1} 笔金额需大于 0`)
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.transaction_date)) {
          throw new Error(`第 ${index + 1} 笔日期格式不正确`)
        }
        return {
          type: draft.type,
          amount,
          category: draft.category,
          subcategory: draft.type === 'expense' ? draft.subcategory || null : null,
          transaction_date: draft.transaction_date,
          note: draft.note.trim() || null,
        }
      })

      setIsLoading(true)
      setError('')
      setMessage('')

      const now = new Date().toISOString()
      try {
        for (const row of rows) {
          await db.collection(TRANSACTION_COLLECTION).add({
            user_id: session.userId,
            ...row,
            created_at: now,
            updated_at: now,
          })
        }
        setMessage(`已保存 ${rows.length} 笔账单`)
        setForm(buildEmptyForm())
        setEditingId(null)
        await loadTransactions(session.userId)
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '账单保存失败')
        throw saveError
      } finally {
        setIsLoading(false)
      }
    },
    [buildEmptyForm, loadTransactions, session],
  )

  const updateTransaction = useCallback(
    async (id: string, draft: TransactionFormState) => {
      const db = cloudbaseDb
      if (!db || !session) {
        return
      }

      const amount = Number(draft.amount)
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('请输入大于 0 的金额')
        throw new Error('请输入大于 0 的金额')
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.transaction_date)) {
        setError('日期格式不正确')
        throw new Error('日期格式不正确')
      }

      setIsLoading(true)
      setError('')
      setMessage('')

      try {
        const previousTransaction = transactions.find((item) => item.id === id) ?? null
        await db.collection(TRANSACTION_COLLECTION).doc(id).update({
          type: draft.type,
          amount,
          category: draft.category,
          subcategory: draft.type === 'expense' ? draft.subcategory || null : null,
          transaction_date: draft.transaction_date,
          note: draft.note.trim() || null,
          updated_at: new Date().toISOString(),
        })
        await syncStoredValueCardRecordFromTransaction(db, session.userId, id, {
          type: draft.type,
          amount,
          transaction_date: draft.transaction_date,
          note: draft.note.trim() || null,
        }, previousTransaction)
        setMessage('账单已更新')
        await loadTransactions(session.userId)
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '账单保存失败')
        throw saveError
      } finally {
        setIsLoading(false)
      }
    },
    [loadTransactions, session, transactions],
  )

  const beginEditTransaction = useCallback(
    (item: Transaction) => {
      setEditingId(item.id)
      setForm({
        type: item.type,
        amount: String(item.amount),
        category: item.category,
        subcategory: item.subcategory ?? '',
        transaction_date: item.transaction_date,
        note: item.note ?? '',
      })
      navigate('/ledger')
      requestAnimationFrame(() => {
        document.getElementById('ledger-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    },
    [navigate],
  )

  const handleDeleteTransaction = async (id: string) => {
    const db = cloudbaseDb
    if (!db || !session) {
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const previousTransaction = transactions.find((item) => item.id === id) ?? null
      await syncStoredValueCardRecordFromTransaction(db, session.userId, id, null, previousTransaction)
      await db.collection(TRANSACTION_COLLECTION).doc(id).remove()
      setMessage('账单已删除')
      await loadTransactions(session.userId)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '账单删除失败')
    } finally {
      setIsLoading(false)
    }
  }

  const createRecurringTemplate = useCallback(
    async (input: {
      billing_type: RecurringBillingType
      name: string
      amount: number
      total_amount?: number | null
      category: string
      subcategory?: string | null
      day_of_month: number
      start_period: string
      start_date?: string
      duration_months: number
    }) => {
      const db = cloudbaseDb
      if (!db || !session) {
        throw new Error('未登录')
      }
      const now = new Date().toISOString()
      const months = Math.max(1, Math.floor(input.duration_months))
      const isInstallment = input.billing_type === 'installment'
      const totalAmount = isInstallment ? Number(input.total_amount ?? input.amount) : null
      const firstAmount = isInstallment ? splitRecurringAmount(totalAmount ?? 0, months, 0) : input.amount
      try {
        const addRes = (await db.collection(RECURRING_COLLECTION).add({
          user_id: session.userId,
          billing_type: input.billing_type,
          name: input.name.trim(),
          amount: firstAmount,
          total_amount: totalAmount,
          category: input.category,
          subcategory: input.subcategory ?? null,
          day_of_month: input.day_of_month,
          start_period: input.start_period,
          start_date: input.start_date ?? null,
          duration_months: months,
          status: 'active',
          created_at: now,
          updated_at: now,
        })) as { id?: string; code?: string; message?: string }

        if (addRes.code) {
          throw new Error(addRes.message || '创建失败')
        }

        const templateId = addRes.id
        if (templateId) {
          for (let index = 0; index < months; index += 1) {
            const period = periodAfterMonths(input.start_period, index)
            const transactionDate = effectiveBillingDateISO(period, input.day_of_month)
            await db.collection(TRANSACTION_COLLECTION).add({
              user_id: session.userId,
              type: 'expense',
              amount: isInstallment ? splitRecurringAmount(totalAmount ?? 0, months, index) : input.amount,
              category: input.category,
              subcategory: input.subcategory ?? null,
              transaction_date: transactionDate,
              note: `${isInstallment ? '分期自动记账' : '固定周期记账'} · ${input.name.trim()} · 第 ${index + 1}/${months} 期`,
              source: 'recurring',
              recurring_template_id: templateId,
              created_at: now,
              updated_at: now,
            })
          }
        }

        await loadRecurringTemplates(session.userId)
        await loadTransactions(session.userId)
      } catch (e) {
        throw e instanceof Error ? e : new Error('创建失败')
      }
    },
    [session, loadRecurringTemplates, loadTransactions],
  )

  const updateRecurringTemplate = useCallback(
    async (
      id: string,
      input: {
        billing_type: RecurringBillingType
        name: string
        amount: number
        total_amount?: number | null
        category: string
        subcategory?: string | null
        day_of_month: number
        start_period: string
        start_date?: string
        duration_months: number
      },
    ) => {
      const db = cloudbaseDb
      if (!db || !session) {
        throw new Error('未登录')
      }
      const now = new Date().toISOString()
      const months = Math.max(1, Math.floor(input.duration_months))
      const isInstallment = input.billing_type === 'installment'
      const totalAmount = isInstallment ? Number(input.total_amount ?? input.amount) : null
      const firstAmount = isInstallment ? splitRecurringAmount(totalAmount ?? 0, months, 0) : input.amount
      try {
        const related = (await db
          .collection(TRANSACTION_COLLECTION)
          .where({
            user_id: session.userId,
            recurring_template_id: id,
          })
          .get()) as { data?: Array<{ _id?: string }>; code?: string }

        if (related.code) {
          throw new Error('查询相关账单失败')
        }

        for (const row of related.data ?? []) {
          if (row._id) {
            await db.collection(TRANSACTION_COLLECTION).doc(row._id).remove()
          }
        }

        await db.collection(RECURRING_COLLECTION).doc(id).update({
          billing_type: input.billing_type,
          name: input.name.trim(),
          amount: firstAmount,
          total_amount: totalAmount,
          category: input.category,
          subcategory: input.subcategory ?? null,
          day_of_month: input.day_of_month,
          start_period: input.start_period,
          start_date: input.start_date ?? null,
          duration_months: months,
          updated_at: now,
        })

        for (let index = 0; index < months; index += 1) {
          const period = periodAfterMonths(input.start_period, index)
          const transactionDate = effectiveBillingDateISO(period, input.day_of_month)
          await db.collection(TRANSACTION_COLLECTION).add({
            user_id: session.userId,
            type: 'expense',
            amount: isInstallment ? splitRecurringAmount(totalAmount ?? 0, months, index) : input.amount,
            category: input.category,
            subcategory: input.subcategory ?? null,
            transaction_date: transactionDate,
            note: `${isInstallment ? '分期自动记账' : '固定周期记账'} · ${input.name.trim()} · 第 ${index + 1}/${months} 期`,
            source: 'recurring',
            recurring_template_id: id,
            created_at: now,
            updated_at: now,
          })
        }

        await loadRecurringTemplates(session.userId)
        await loadTransactions(session.userId)
      } catch (e) {
        throw e instanceof Error ? e : new Error('保存失败')
      }
    },
    [session, loadRecurringTemplates, loadTransactions],
  )

  const deleteRecurringTemplate = useCallback(
    async (id: string) => {
      const db = cloudbaseDb
      const uid = session?.userId
      if (
        !db ||
        !uid ||
        !window.confirm(
          '确定删除该周期账单吗？\n\n相关的已生成账单也会一起删除。',
        )
      ) {
        return
      }
      const related = (await db
        .collection(TRANSACTION_COLLECTION)
        .where({
          user_id: uid,
          recurring_template_id: id,
        })
        .get()) as { data?: Array<{ _id?: string }>; code?: string }

      if (related.code) {
        throw new Error('查询相关账单失败')
      }

      for (const row of related.data ?? []) {
        if (row._id) {
          await db.collection(TRANSACTION_COLLECTION).doc(row._id).remove()
        }
      }

      await db.collection(RECURRING_COLLECTION).doc(id).remove()
      await loadRecurringTemplates(uid)
      await loadTransactions(uid)
    },
    [loadRecurringTemplates, loadTransactions, session?.userId],
  )

  const setRecurringPaused = useCallback(
    async (id: string, paused: boolean) => {
      const db = cloudbaseDb
      const uid = session?.userId
      if (!db || !uid) {
        return
      }
      const now = new Date().toISOString()
      await db.collection(RECURRING_COLLECTION).doc(id).update({
        status: paused ? 'paused' : 'active',
        updated_at: now,
      })
      await loadRecurringTemplates(uid)
    },
    [loadRecurringTemplates, session?.userId],
  )

  const value: AccountingContextType = {
      isCloudBaseConfigured,
      session,
      transactions,
      isLoading,
      error,
      message,
      setError,
      setMessage,
      loadTransactions,
      loadTransactionsByDateRange,
      loadAllTransactions,
      form,
      setForm,
      editingId,
      cancelEdit,
      handleTypeChange,
      handleSubmit,
      saveTransactionsFromDrafts,
      updateTransaction,
      handleDeleteTransaction,
      beginEditTransaction,
      categoryOptions,
      formatMoney,
      handleSignOut,
      changePassword,
      authMode,
      setAuthMode,
      email,
      setEmail,
      password,
      setPassword,
      rememberPassword,
      setRememberPassword,
      isVerifyingSignup,
      verificationEmail,
      verificationCode,
      setVerificationCode,
      handleAuth,
      handleVerifySignup,
      cancelVerifyFlow,
      requestPasswordReset,
      completePasswordReset,
      cancelPasswordReset,
      budgetPeriod,
      setBudgetPeriod,
      budgetDocId,
      budgetAmount,
      budgetDraft,
      setBudgetDraft,
      budgetLoading,
      budgetSaving,
      budgetError,
      budgetSuccess,
      setBudgetError,
      setBudgetSuccess,
      handleSaveBudget,
      budgetDays,
      dailyBudgetReference,
      todayVsDailyPercent,
      monthVsBudgetPercent,
      monthExpenseTotal,
      todayExpenseTotal,
      recurringTemplates,
      recurringLoading,
      loadRecurringTemplates,
      createRecurringTemplate,
      updateRecurringTemplate,
      deleteRecurringTemplate,
      setRecurringPaused,
      expenseCategoryNames,
      expenseSubcategoryMap,
      incomeCategoryNames,
      subcategoryOptions,
      categoryMigrationPreview,
      migrateHistoricalCategories,
      saveUserCategoryLists,
      restoreDefaultCategoryLists,
      categoriesLoading,
      categoriesSaving,
  }

  return <AccountingContext.Provider value={value}>{children}</AccountingContext.Provider>
}
