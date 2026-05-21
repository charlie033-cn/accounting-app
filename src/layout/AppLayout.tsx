import { NavLink, Outlet, useLocation } from 'react-router-dom'
import '../App.css'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `tab-bar-link${isActive ? ' tab-bar-link-active' : ''}`

export function AppLayout() {
  const location = useLocation()
  const meRoutesActive =
    location.pathname === '/me' || location.pathname.startsWith('/me/')

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
