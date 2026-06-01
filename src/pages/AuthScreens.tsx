import { type FormEvent } from 'react'
import { useAccounting } from '../context/AccountingContext'

export function AuthScreens() {
  const {
    isVerifyingSignup,
    verificationEmail,
    verificationCode,
    setVerificationCode,
    handleVerifySignup,
    cancelVerifyFlow,
    handleAuth,
    authMode,
    setAuthMode,
    email,
    setEmail,
    password,
    setPassword,
    rememberPassword,
    setRememberPassword,
    error,
    isLoading,
  } = useAccounting()

  if (isVerifyingSignup) {
    return (
      <main className="app-shell auth-shell">
        <div className="auth-background-mascot" aria-hidden>
          <img src="/jizhangip.png" alt="" />
        </div>
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

            <button className="primary-button" type="submit" disabled={isLoading}>
              {isLoading ? '验证中...' : '完成注册'}
            </button>
            <button className="text-button" type="button" onClick={cancelVerifyFlow}>
              返回重新注册
            </button>
          </form>
        </section>
      </main>
    )
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => void handleAuth(e)

  return (
    <main className="app-shell auth-shell">
      <div className="auth-background-mascot" aria-hidden>
        <img src="/jizhangip.png" alt="" />
      </div>
      <section className="auth-card">
        <div>
          <p className="eyebrow">查理小猪轻松记</p>
          <h1 className="auth-tech-title">AI记账更轻松</h1>
        </div>

        <form className="form-grid" onSubmit={onSubmit}>
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
          {authMode === 'sign-in' && (
            <label className="auth-remember-row">
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(event) => setRememberPassword(event.target.checked)}
              />
              <span>记住密码</span>
            </label>
          )}

          {error && <p className="alert error">{error}</p>}

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
