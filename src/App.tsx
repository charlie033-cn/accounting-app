import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'
import {
  cloudbaseAuth,
  cloudbaseDb,
  isCloudBaseConfigured,
} from './lib/cloudbase'
import type {
  Transaction,
  TransactionFormState,
  TransactionType,
} from './types/transaction'
import { downloadTransactionsCsv } from './utils/exportCsv'

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

const TRANSACTION_COLLECTION = 'transactions'

const expenseCategories = ['餐饮', '交通', '购物', '房租', '水电', '娱乐', '医疗', '甜品店筹备', '其他']
const incomeCategories = ['工资', '副业', '投资', '报销', '其他']

const today = () => new Date().toISOString().slice(0, 10)
const currentMonth = () => new Date().toISOString().slice(0, 7)

const initialForm: TransactionFormState = {
  type: 'expense',
  amount: '',
  category: '餐饮',
  transaction_date: today(),
  note: '',
}

const formatMoney = (amount: number) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(amount)

const categoryOptions = (type: TransactionType) =>
  type === 'expense' ? expenseCategories : incomeCategories

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
})

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

function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isVerifyingSignup, setIsVerifyingSignup] = useState(false)
  const [verificationEmail, setVerificationEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [form, setForm] = useState<TransactionFormState>(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth())
  const [selectedType, setSelectedType] = useState<'all' | TransactionType>('all')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const verifySignupRef = useRef<VerifySignupOtp | null>(null)

  const loadTransactions = useCallback(async (userId: string) => {
    if (!cloudbaseDb) {
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const result = await cloudbaseDb
        .collection(TRANSACTION_COLLECTION)
        .where({ user_id: userId })
        .orderBy('transaction_date', 'desc')
        .orderBy('created_at', 'desc')
        .get()

      setTransactions((result.data as CloudTransaction[]).map(toTransaction))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '账单同步失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

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
      }
    })

    return () => listener.data.subscription.unsubscribe()
  }, [loadTransactions])

  const filteredTransactions = useMemo(() => {
    return transactions.filter((item) => {
      const matchMonth = item.transaction_date.startsWith(selectedMonth)
      const matchType = selectedType === 'all' || item.type === selectedType
      const matchCategory = selectedCategory === 'all' || item.category === selectedCategory
      return matchMonth && matchType && matchCategory
    })
  }, [selectedCategory, selectedMonth, selectedType, transactions])

  const stats = useMemo(() => {
    const income = filteredTransactions
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + item.amount, 0)
    const expense = filteredTransactions
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + item.amount, 0)

    return {
      income,
      expense,
      balance: income - expense,
    }
  }, [filteredTransactions])

  const availableCategories = useMemo(() => {
    const categories = new Set(transactions.map((item) => item.category))
    return Array.from(categories).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }, [transactions])

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

  const handleSignOut = async () => {
    if (!cloudbaseAuth) {
      return
    }

    await cloudbaseAuth.signOut()
    setSession(null)
    setTransactions([])
    setForm(initialForm)
    setEditingId(null)
    setMessage('已退出登录')
  }

  const handleTypeChange = (type: TransactionType) => {
    setForm((current) => ({
      ...current,
      type,
      category: categoryOptions(type)[0],
    }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!cloudbaseDb || !session) {
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
        await cloudbaseDb.collection(TRANSACTION_COLLECTION).doc(editingId).update(payload)
      } else {
        await cloudbaseDb.collection(TRANSACTION_COLLECTION).add({
          ...payload,
          created_at: now,
        })
      }

      setMessage(editingId ? '账单已更新' : '账单已保存')
      setForm(initialForm)
      setEditingId(null)
      await loadTransactions(session.userId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '账单保存失败')
    } finally {
      setIsLoading(false)
    }
  }

  const handleEdit = (item: Transaction) => {
    setEditingId(item.id)
    setForm({
      type: item.type,
      amount: String(item.amount),
      category: item.category,
      transaction_date: item.transaction_date,
      note: item.note ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (id: string) => {
    if (!cloudbaseDb || !session || !window.confirm('确定删除这笔账单吗？')) {
      return
    }

    setIsLoading(true)
    setError('')

    try {
      await cloudbaseDb.collection(TRANSACTION_COLLECTION).doc(id).remove()
      setMessage('账单已删除')
      await loadTransactions(session.userId)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '账单删除失败')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isCloudBaseConfigured) {
    return (
      <main className="app-shell setup-shell">
        <section className="panel setup-panel">
          <p className="eyebrow">记账 Web App</p>
          <h1>先连接 CloudBase</h1>
          <p>
            在项目根目录创建 <code>.env.local</code>，填写
            <code>VITE_TCB_ENV_ID</code> 后重启开发服务。
          </p>
          <p className="muted">当前腾讯云环境 ID：未配置。</p>
        </section>
      </main>
    )
  }

  if (!session) {
    if (isVerifyingSignup) {
      return (
        <main className="app-shell auth-shell">
          <section className="auth-card">
            <div>
              <p className="eyebrow">邮箱验证</p>
              <h1>输入验证码完成注册</h1>
              <p className="muted">
                验证码已发送到 <code>{verificationEmail}</code>。完成验证后，再使用邮箱和密码登录。
              </p>
            </div>

            <form className="form-grid" onSubmit={handleVerifySignup}>
              <label>
                邮箱验证码
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  inputMode="numeric"
                  placeholder="输入邮件里的验证码"
                  required
                />
              </label>

              {error && <p className="alert error">{error}</p>}
              {message && <p className="alert success">{message}</p>}

              <button className="primary-button" type="submit" disabled={isLoading}>
                {isLoading ? '验证中...' : '完成注册'}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  verifySignupRef.current = null
                  setIsVerifyingSignup(false)
                  setVerificationCode('')
                  setMessage('')
                  setError('')
                }}
              >
                返回重新注册
              </button>
            </form>
          </section>
        </main>
      )
    }

    return (
      <main className="app-shell auth-shell">
        <section className="auth-card">
          <div>
            <p className="eyebrow">云记账</p>
            <h1>把每天的收支记清楚</h1>
            <p className="muted">注册或登录后，账单会按账号保存到腾讯云，同一个账号在手机和电脑会自动同步。</p>
          </div>

          <form className="form-grid" onSubmit={handleAuth}>
            <label>
              邮箱
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </label>
            <label>
              密码
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                placeholder="8-32 位，建议包含字母和数字"
                required
              />
            </label>

            {error && <p className="alert error">{error}</p>}
            {message && <p className="alert success">{message}</p>}

            <button className="primary-button" type="submit" disabled={isLoading}>
              {isLoading ? '处理中...' : authMode === 'sign-in' ? '登录' : '注册'}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => setAuthMode(authMode === 'sign-in' ? 'sign-up' : 'sign-in')}
            >
              {authMode === 'sign-in' ? '还没有账号？去注册' : '已有账号？去登录'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">腾讯云同步记账</p>
          <h1>我的账本</h1>
        </div>
        <div className="account-box">
          <span>{session.email}</span>
          <button type="button" className="secondary-button" onClick={handleSignOut}>
            退出
          </button>
        </div>
      </header>

      <section className="summary-grid">
        <article className="summary-card">
          <span>本月收入</span>
          <strong>{formatMoney(stats.income)}</strong>
        </article>
        <article className="summary-card">
          <span>本月支出</span>
          <strong>{formatMoney(stats.expense)}</strong>
        </article>
        <article className="summary-card highlight">
          <span>结余</span>
          <strong>{formatMoney(stats.balance)}</strong>
        </article>
      </section>

      <section className="content-grid">
        <form className="panel form-grid" onSubmit={handleSubmit}>
          <div className="panel-header">
            <div>
              <p className="eyebrow">{editingId ? '编辑账单' : '记一笔'}</p>
              <h2>{editingId ? '更新收支记录' : '新增收支记录'}</h2>
            </div>
            {editingId && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setEditingId(null)
                  setForm(initialForm)
                }}
              >
                取消编辑
              </button>
            )}
          </div>

          <div className="segmented">
            <button
              type="button"
              className={form.type === 'expense' ? 'active' : ''}
              onClick={() => handleTypeChange('expense')}
            >
              支出
            </button>
            <button
              type="button"
              className={form.type === 'income' ? 'active' : ''}
              onClick={() => handleTypeChange('income')}
            >
              收入
            </button>
          </div>

          <label>
            金额
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              placeholder="0.00"
              required
            />
          </label>

          <label>
            分类
            <select
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            >
              {categoryOptions(form.type).map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label>
            日期
            <input
              type="date"
              value={form.transaction_date}
              onChange={(event) => setForm({ ...form, transaction_date: event.target.value })}
              required
            />
          </label>

          <label>
            备注
            <textarea
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              placeholder="例如：晚餐、甜品店设备定金"
              rows={3}
            />
          </label>

          {error && <p className="alert error">{error}</p>}
          {message && <p className="alert success">{message}</p>}

          <button className="primary-button" type="submit" disabled={isLoading}>
            {isLoading ? '保存中...' : editingId ? '保存修改' : '添加账单'}
          </button>
        </form>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">账单明细</p>
              <h2>{selectedMonth} 记录</h2>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => downloadTransactionsCsv(filteredTransactions)}
              disabled={filteredTransactions.length === 0}
            >
              导出 CSV
            </button>
          </div>

          <div className="filters">
            <label>
              月份
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => setSelectedMonth(event.target.value)}
              />
            </label>
            <label>
              类型
              <select
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value as 'all' | TransactionType)}
              >
                <option value="all">全部</option>
                <option value="expense">支出</option>
                <option value="income">收入</option>
              </select>
            </label>
            <label>
              分类
              <select
                value={selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
              >
                <option value="all">全部</option>
                {availableCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isLoading && <p className="muted">同步中...</p>}

          <div className="transaction-list">
            {filteredTransactions.length === 0 ? (
              <div className="empty-state">
                <h3>这个筛选条件下还没有账单</h3>
                <p>先新增一笔收入或支出，统计会自动更新。</p>
              </div>
            ) : (
              filteredTransactions.map((item) => (
                <article className="transaction-item" key={item.id}>
                  <div>
                    <div className="transaction-title">
                      <span className={`type-dot ${item.type}`} />
                      <strong>{item.category}</strong>
                      <span>{item.transaction_date}</span>
                    </div>
                    {item.note && <p>{item.note}</p>}
                  </div>
                  <div className="transaction-actions">
                    <strong className={item.type}>
                      {item.type === 'expense' ? '-' : '+'}
                      {formatMoney(item.amount)}
                    </strong>
                    <div>
                      <button type="button" className="text-button" onClick={() => handleEdit(item)}>
                        编辑
                      </button>
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => void handleDelete(item.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  )
}

export default App
