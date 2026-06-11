import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import '../App.css'

const CHAT_GUIDE_STORAGE_KEY = 'accounting-app:chat-entry-guide-date'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `tab-bar-link${isActive ? ' tab-bar-link-active' : ''}`

function todayKey() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function AppLayout() {
  const location = useLocation()
  const [showChatGuide, setShowChatGuide] = useState(false)
  const meRoutesActive =
    location.pathname === '/me' || location.pathname.startsWith('/me/')

  useEffect(() => {
    if (import.meta.env.DEV) {
      setShowChatGuide(true)
      const timer = window.setTimeout(() => setShowChatGuide(false), 6000)
      return () => window.clearTimeout(timer)
    }

    const today = todayKey()
    try {
      if (window.localStorage.getItem(CHAT_GUIDE_STORAGE_KEY) === today) {
        return
      }
      window.localStorage.setItem(CHAT_GUIDE_STORAGE_KEY, today)
      setShowChatGuide(true)
      const timer = window.setTimeout(() => setShowChatGuide(false), 6000)
      return () => window.clearTimeout(timer)
    } catch {
      setShowChatGuide(true)
      const timer = window.setTimeout(() => setShowChatGuide(false), 6000)
      return () => window.clearTimeout(timer)
    }
  }, [])

  return (
    <div className="app-frame">
      <main className="page-outlet">
        <Outlet />
      </main>
      <nav className="tab-bar" aria-label="主导航">
        <NavLink to="/ledger" className={tabClass} end>
          记账
        </NavLink>
        <NavLink to="/transactions" className={tabClass}>
          账单
        </NavLink>
        <NavLink
          to="/chat"
          className={({ isActive }) =>
            `tab-bar-ip-link${isActive ? ' tab-bar-ip-link-active' : ''}${showChatGuide ? ' tab-bar-ip-link--guided' : ''}`
          }
          onClick={() => setShowChatGuide(false)}
        >
          {showChatGuide && (
            <span className="tab-bar-chat-guide" role="status">
              跟我说说今天花了啥，我来帮你整理账单～
            </span>
          )}
          <span className="tab-bar-ip-avatar" aria-hidden>
            <img src="/jizhangip.png" alt="" />
          </span>
        </NavLink>
        <NavLink to="/more" className={tabClass}>
          更多
        </NavLink>
        <NavLink
          to="/me"
          className={() => `tab-bar-link${meRoutesActive ? ' tab-bar-link-active' : ''}`}
        >
          我的
        </NavLink>
      </nav>
    </div>
  )
}
