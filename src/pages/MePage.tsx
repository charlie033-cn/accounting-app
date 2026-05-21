import { Link } from 'react-router-dom'
import { useAccounting } from '../context/AccountingContext'

export function MePage() {
  const { session, handleSignOut } = useAccounting()

  if (!session) {
    return null
  }

  const accountName = session.email || 'User'
  const avatarLetter = accountName.trim().charAt(0).toUpperCase()
  const avatarHue = Array.from(accountName).reduce(
    (sum, char) => sum + char.charCodeAt(0),
    0,
  ) % 360

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
    </div>
  )
}
