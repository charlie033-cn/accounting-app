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
  TRANSACTION_COLLECTION,
  USER_CATEGORY_LISTS_COLLECTION,
  expenseCategories,
  incomeCategories,
  initialForm,
  todayISO,
  currentMonth,
} from '../accounting/constants'
import { daysInCalendarMonth, formatMoney } from '../accounting/format'
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

function budgetCloudMessage(raw: string): string {
  const t = raw.trim()
  if (
    t.includes('Db or Table not exist') ||
    t.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    t.includes('ResourceNotFound') ||
    t.includes('COLLECTION_NOT_EXIST')
  ) {
    return (
      '云端还没有 budgets 数据库集合。请到云开发控制台 → 数据库 → 添加集合，名称填 budgets；' +
      '安全规则与 transactions 保持一致（仅本人可读写带自己 user_id 的文档），保存后刷新本页。'
    )
  }
  return raw
}

const DEFAULT_EXPENSE_CATEGORIES = [...expenseCategories] as string[]
const DEFAULT_INCOME_CATEGORIES = [...incomeCategories] as string[]
const TRANSACTION_FETCH_LIMIT = 1000

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

function categoryListCloudMessage(raw: string): string {
  const t = raw.trim()
  if (
    t.includes('Db or Table not exist') ||
    t.includes('DATABASE_COLLECTION_NOT_EXIST') ||
    t.includes('ResourceNotFound') ||
    t.includes('COLLECTION_NOT_EXIST')
  ) {
    return (
      '云端还没有 user_category_lists 数据库集合。请到云开发控制台 → 数据库 → 添加集合，名称填 user_category_lists；' +
      '安全规则与 transactions 一致（仅本人可读写带自己 user_id 的文档），保存后刷新本页。'
    )
  }
  return raw
}

type AuthSession = {
  userId: string
  email: string
}

type CloudTransaction = Omit<Transaction, 'id'> & {
  _id: string
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

type CloudRecurringRow = Omit<RecurringTemplate, 'id'> & { _id: string }

const toTransaction = (item: CloudTransaction): Transaction => ({
  id: item._id,
  user_id: item.user_id,
  type: item.type,
  amount: Number(item.amount),
  category: item.category,
  transaction_date: item.transaction_date,
  note: item.note ?? null,
  created_at: item.created_at,
  updated_at: item.updated_at,
  recurring_template_id: item.recurring_template_id ?? null,
  source: item.source ?? null,
})

const toRecurringTemplate = (row: CloudRecurringRow): RecurringTemplate => ({
  id: row._id,
  user_id: row.user_id,
  billing_type: row.billing_type,
  name: row.name,
  amount: Number(row.amount),
  total_amount: row.total_amount == null ? null : Number(row.total_amount),
  category: row.category,
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
  authMode: 'sign-in' | 'sign-up'
  setAuthMode: (m: 'sign-in' | 'sign-up') => void
  email: string
  setEmail: (v: string) => void
  password: string
  setPassword: (v: string) => void
  isVerifyingSignup: boolean
  verificationEmail: string
  verificationCode: string
  setVerificationCode: (v: string) => void
  handleAuth: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleVerifySignup: (event: FormEvent<HTMLFormElement>) => Promise<void>
  cancelVerifyFlow: () => void
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
    day_of_month: number
    start_period: string
    start_date?: string
    duration_months: number
  }) => Promise<void>
  deleteRecurringTemplate: (id: string) => Promise<void>
  setRecurringPaused: (id: string, paused: boolean) => Promise<void>
  expenseCategoryNames: string[]
  incomeCategoryNames: string[]
  saveUserCategoryLists: (payload: { expense: string[]; income: string[] }) => Promise<void>
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
  const [recurringTemplates, setRecurringTemplates] = useState<RecurringTemplate[]>([])
  const [recurringLoading, setRecurringLoading] = useState(false)
  const [expenseCategoryNames, setExpenseCategoryNames] = useState<string[]>(
    () => [...expenseCategories] as string[],
  )
  const [incomeCategoryNames, setIncomeCategoryNames] = useState<string[]>(
    () => [...incomeCategories] as string[],
  )
  const [categoryListsDocId, setCategoryListsDocId] = useState<string | null>(null)
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesSaving, setCategoriesSaving] = useState(false)
  const verifySignupRef = useRef<VerifySignupOtp | null>(null)
  const messageDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const budgetSuccessDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const buildEmptyForm = useCallback((): TransactionFormState => {
    return {
      ...initialForm(),
      category: expenseCategoryNames[0] ?? (expenseCategories[0] as string),
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
      const result = await db
        .collection(TRANSACTION_COLLECTION)
        .where({ user_id: userId })
        .orderBy('transaction_date', 'desc')
        .orderBy('created_at', 'desc')
        .limit(TRANSACTION_FETCH_LIMIT)
        .get()

      setTransactions((result.data as CloudTransaction[]).map(toTransaction))

      const added = await runRecurringGenerationIfDue(db, userId)
      if (added > 0) {
        const again = await db
          .collection(TRANSACTION_COLLECTION)
          .where({ user_id: userId })
          .orderBy('transaction_date', 'desc')
          .orderBy('created_at', 'desc')
          .limit(TRANSACTION_FETCH_LIMIT)
          .get()
        setTransactions((again.data as CloudTransaction[]).map(toTransaction))
      }

      await loadRecurringTemplates(userId)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '账单同步失败')
    } finally {
      setIsLoading(false)
    }
  }, [loadRecurringTemplates])

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
    if (!userId || !db) {
      return
    }

    let cancelled = false

    const loadBudget = async () => {
      setBudgetLoading(true)
      setBudgetError('')
      setBudgetSuccess('')
      try {
        const result = (await db
          .collection(BUDGET_COLLECTION)
          .where({ user_id: userId, period: budgetPeriod })
          .limit(1)
          .get()) as { data?: CloudBudgetDoc[]; code?: string; message?: string }

        if (cancelled) {
          return
        }

        if (result.code) {
          setBudgetDocId(null)
          setBudgetAmount(null)
          setBudgetDraft('')
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
  }, [session?.userId, budgetPeriod])

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
          setIncomeCategoryNames([...DEFAULT_INCOME_CATEGORIES])
          return
        }

        const row = result.data?.[0]
        if (row) {
          setCategoryListsDocId(row._id)
          setExpenseCategoryNames(normalizeUserCategoryNames(row.expense, DEFAULT_EXPENSE_CATEGORIES))
          setIncomeCategoryNames(normalizeUserCategoryNames(row.income, DEFAULT_INCOME_CATEGORIES))
        } else {
          setCategoryListsDocId(null)
          setExpenseCategoryNames([...DEFAULT_EXPENSE_CATEGORIES])
          setIncomeCategoryNames([...DEFAULT_INCOME_CATEGORIES])
        }
      } catch {
        if (!cancelled) {
          setCategoryListsDocId(null)
          setExpenseCategoryNames([...DEFAULT_EXPENSE_CATEGORIES])
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
    return transactions
      .filter((item) => item.type === 'expense' && item.transaction_date.startsWith(budgetPeriod))
      .reduce((sum, item) => sum + item.amount, 0)
  }, [transactions, budgetPeriod])

  const todayExpenseTotal = useMemo(() => {
    if (budgetPeriod !== currentMonth()) {
      return 0
    }
    const day = todayISO()
    return transactions
      .filter((item) => item.type === 'expense' && item.transaction_date === day)
      .reduce((sum, item) => sum + item.amount, 0)
  }, [transactions, budgetPeriod])

  const budgetDays = daysInCalendarMonth(budgetPeriod)
  const dailyBudgetReference =
    budgetAmount != null && budgetAmount > 0 && budgetDays > 0 ? budgetAmount / budgetDays : null
  const todayVsDailyPercent =
    dailyBudgetReference != null && dailyBudgetReference > 0
      ? (todayExpenseTotal / dailyBudgetReference) * 100
      : null
  const monthVsBudgetPercent =
    budgetAmount != null && budgetAmount > 0 ? (monthExpenseTotal / budgetAmount) * 100 : null

  const saveUserCategoryLists = useCallback(
    async (payload: { expense: string[]; income: string[] }) => {
      const db = cloudbaseDb
      const uid = session?.userId
      if (!db || !uid) {
        throw new Error('未登录')
      }

      const expense = normalizeUserCategoryNames(payload.expense, DEFAULT_EXPENSE_CATEGORIES)
      const income = normalizeUserCategoryNames(payload.income, DEFAULT_INCOME_CATEGORIES)
      const now = new Date().toISOString()

      setCategoriesSaving(true)
      try {
        if (categoryListsDocId) {
          await db.collection(USER_CATEGORY_LISTS_COLLECTION).doc(categoryListsDocId).update({
            expense,
            income,
            updated_at: now,
          })
        } else {
          const addRes = (await db.collection(USER_CATEGORY_LISTS_COLLECTION).add({
            user_id: uid,
            expense,
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
        setIncomeCategoryNames(income)
        setMessage('分类已保存')
      } catch (e) {
        throw e instanceof Error ? e : new Error('保存失败')
      } finally {
        setCategoriesSaving(false)
      }
    },
    [session?.userId, categoryListsDocId],
  )

  const restoreDefaultCategoryLists = useCallback(async () => {
    await saveUserCategoryLists({
      expense: [...DEFAULT_EXPENSE_CATEGORIES],
      income: [...DEFAULT_INCOME_CATEGORIES],
    })
    setMessage('已恢复默认分类')
  }, [saveUserCategoryLists])

  useEffect(() => {
    setForm((f) => {
      const list = f.type === 'expense' ? expenseCategoryNames : incomeCategoryNames
      if (list.length === 0) {
        return f
      }
      if (list.includes(f.category)) {
        return f
      }
      return { ...f, category: list[0] }
    })
  }, [expenseCategoryNames, incomeCategoryNames])

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

  const handleSignOut = async () => {
    if (!cloudbaseAuth) {
      return
    }

    await cloudbaseAuth.signOut()
    setSession(null)
    setTransactions([])
    setCategoryListsDocId(null)
    setExpenseCategoryNames([...DEFAULT_EXPENSE_CATEGORIES])
    setIncomeCategoryNames([...DEFAULT_INCOME_CATEGORIES])
    setForm({
      ...initialForm(),
      category: DEFAULT_EXPENSE_CATEGORIES[0],
    })
    setEditingId(null)
    setBudgetDocId(null)
    setBudgetAmount(null)
    setBudgetDraft('')
    setBudgetError('')
    setBudgetSuccess('')
    setMessage('已退出登录')
  }

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
    setForm((current) => ({
      ...current,
      type,
      category:
        (type === 'expense' ? expenseCategoryNames : incomeCategoryNames)[0] ?? current.category,
    }))
  }

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

    setIsLoading(true)
    setError('')
    setMessage('')

    const now = new Date().toISOString()
    const payload = {
      user_id: session.userId,
      type: form.type,
      amount,
      category: form.category,
      transaction_date: form.transaction_date,
      note: form.note.trim() || null,
      updated_at: now,
    }

    try {
      if (editingId) {
        await db.collection(TRANSACTION_COLLECTION).doc(editingId).update(payload)
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
        await db.collection(TRANSACTION_COLLECTION).doc(id).update({
          type: draft.type,
          amount,
          category: draft.category,
          transaction_date: draft.transaction_date,
          note: draft.note.trim() || null,
          updated_at: new Date().toISOString(),
        })
        setMessage('账单已更新')
        await loadTransactions(session.userId)
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : '账单保存失败')
        throw saveError
      } finally {
        setIsLoading(false)
      }
    },
    [loadTransactions, session],
  )

  const beginEditTransaction = useCallback(
    (item: Transaction) => {
      setEditingId(item.id)
      setForm({
        type: item.type,
        amount: String(item.amount),
        category: item.category,
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
      authMode,
      setAuthMode,
      email,
      setEmail,
      password,
      setPassword,
      isVerifyingSignup,
      verificationEmail,
      verificationCode,
      setVerificationCode,
      handleAuth,
      handleVerifySignup,
      cancelVerifyFlow,
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
      deleteRecurringTemplate,
      setRecurringPaused,
      expenseCategoryNames,
      incomeCategoryNames,
      saveUserCategoryLists,
      restoreDefaultCategoryLists,
      categoriesLoading,
      categoriesSaving,
  }

  return <AccountingContext.Provider value={value}>{children}</AccountingContext.Provider>
}
