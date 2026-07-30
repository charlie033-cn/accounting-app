import { useState, type FormEvent } from 'react'
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
    requestPasswordReset,
    completePasswordReset,
    cancelPasswordReset,
  } = useAccounting()
  const [resetStage, setResetStage] = useState<'idle' | 'email' | 'code'>('idle')
  const [resetEmail, setResetEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetNewPassword, setResetNewPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [resetError, setResetError] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  const openPasswordReset = () => {
    setResetEmail(email.trim())
    setResetCode('')
    setResetNewPassword('')
    setResetConfirmPassword('')
    setResetError('')
    setResetStage('email')
  }

  const leavePasswordReset = () => {
    cancelPasswordReset()
    setResetStage('idle')
    setResetCode('')
    setResetNewPassword('')
    setResetConfirmPassword('')
    setResetError('')
  }

  const sendResetCode = async () => {
    const normalizedEmail = resetEmail.trim().toLowerCase()
    if (!normalizedEmail) {
      setResetError('请输入注册时使用的邮箱')
      return
    }

    setResetLoading(true)
    setResetError('')
    try {
      await requestPasswordReset(normalizedEmail)
      setResetEmail(normalizedEmail)
      setResetCode('')
      setResetStage('code')
    } catch (err) {
      setResetError(err instanceof Error ? err.message : '验证码发送失败，请稍后重试')
    } finally {
      setResetLoading(false)
    }
  }

  const handleRequestPasswordReset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void sendResetCode()
  }

  const handleCompletePasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setResetError('')

    if (!resetCode.trim()) {
      setResetError('请输入邮箱中的验证码')
      return
    }
    if (resetNewPassword.length < 8 || resetNewPassword.length > 32) {
      setResetError('新密码长度需要为 8～32 位')
      return
    }
    if (resetNewPassword !== resetConfirmPassword) {
      setResetError('两次输入的新密码不一致')
      return
    }

    setResetLoading(true)
    try {
      await completePasswordReset(resetCode, resetNewPassword)
    } catch (err) {
      setResetError(err instanceof Error ? err.message : '密码重置失败，请稍后重试')
    } finally {
      setResetLoading(false)
    }
  }

  if (resetStage === 'email') {
    return (
      <main className="app-shell auth-shell">
        <div className="auth-background-mascot" aria-hidden>
          <img src="/jizhangip.png" alt="" />
        </div>
        <section className="auth-card">
          <div>
            <p className="eyebrow">找回密码</p>
            <h1>获取邮箱验证码</h1>
            <p className="muted">输入注册邮箱，我们会发送用于重置密码的验证码。</p>
          </div>

          <form className="form-grid" onSubmit={handleRequestPasswordReset}>
            <label>
              注册邮箱
              <input
                type="email"
                value={resetEmail}
                onChange={(event) => setResetEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                disabled={resetLoading}
                required
              />
            </label>

            {resetError && <p className="alert error">{resetError}</p>}

            <button className="primary-button" type="submit" disabled={resetLoading}>
              {resetLoading ? '发送中…' : '发送验证码'}
            </button>
            <button className="text-button" type="button" onClick={leavePasswordReset} disabled={resetLoading}>
              返回登录
            </button>
          </form>
        </section>
      </main>
    )
  }

  if (resetStage === 'code') {
    return (
      <main className="app-shell auth-shell">
        <div className="auth-background-mascot" aria-hidden>
          <img src="/jizhangip.png" alt="" />
        </div>
        <section className="auth-card">
          <div>
            <p className="eyebrow">重置密码</p>
            <h1>设置新的登录密码</h1>
            <p className="muted">
              验证码已发送到 <code>{resetEmail}</code>，请查收邮件并完成验证。
            </p>
          </div>

          <form className="form-grid" onSubmit={(event) => void handleCompletePasswordReset(event)}>
            <label>
              邮箱验证码
              <input
                type="text"
                value={resetCode}
                onChange={(event) => setResetCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="输入邮件里的验证码"
                disabled={resetLoading}
                required
              />
            </label>
            <label>
              新密码
              <input
                type="password"
                value={resetNewPassword}
                onChange={(event) => setResetNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={32}
                placeholder="8～32 位，建议使用字母和数字组合"
                disabled={resetLoading}
                required
              />
            </label>
            <label>
              确认新密码
              <input
                type="password"
                value={resetConfirmPassword}
                onChange={(event) => setResetConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                maxLength={32}
                placeholder="再次输入新密码"
                disabled={resetLoading}
                required
              />
            </label>

            {resetError && <p className="alert error">{resetError}</p>}

            <button className="primary-button" type="submit" disabled={resetLoading}>
              {resetLoading ? '重置中…' : '确认重置并登录'}
            </button>
            <button
              className="secondary-button auth-reset-resend"
              type="button"
              onClick={() => void sendResetCode()}
              disabled={resetLoading}
            >
              {resetLoading ? '发送中…' : '重新发送验证码'}
            </button>
            <div className="auth-reset-links">
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  cancelPasswordReset()
                  setResetStage('email')
                  setResetError('')
                }}
                disabled={resetLoading}
              >
                更换邮箱
              </button>
              <button className="text-button" type="button" onClick={leavePasswordReset} disabled={resetLoading}>
                返回登录
              </button>
            </div>
          </form>
        </section>
      </main>
    )
  }

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
            <div className="auth-signin-options">
              <label className="auth-remember-row">
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(event) => setRememberPassword(event.target.checked)}
                />
                <span>记住密码</span>
              </label>
              <button className="text-button auth-forgot-button" type="button" onClick={openPasswordReset}>
                忘记密码？
              </button>
            </div>
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
