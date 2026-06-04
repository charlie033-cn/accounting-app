import { type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { AccountingProvider, useAccounting } from './context/AccountingContext'
import { AppLayout } from './layout/AppLayout'
import { AuthScreens } from './pages/AuthScreens'
import { BudgetPage } from './pages/BudgetPage'
import { LedgerPage } from './pages/LedgerPage'
import { CategoryManagePage } from './pages/CategoryManagePage'
import { MePage } from './pages/MePage'
import { MorePage } from './pages/MorePage'
import { MonthlyReportPage } from './pages/MonthlyReportPage'
import { RecurringPage } from './pages/RecurringPage'
import { ReportPage } from './pages/ReportPage'
import { StoredValueCardsPage } from './pages/StoredValueCardsPage'
import { TransactionsPage } from './pages/TransactionsPage'

function SetupShell() {
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

function SuccessToast() {
  const { message, budgetSuccess } = useAccounting()
  const text = budgetSuccess || message

  if (!text) {
    return null
  }

  return (
    <div className="app-toast" role="status" aria-live="polite">
      {text}
    </div>
  )
}

function AppRoutes() {
  const { isCloudBaseConfigured, session } = useAccounting()

  let content: ReactNode

  if (!isCloudBaseConfigured) {
    content = <SetupShell />
  } else if (!session) {
    content = <AuthScreens />
  } else {
    content = (
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/ledger" replace />} />
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="more" element={<MorePage />} />
          <Route path="me" element={<MePage />} />
        </Route>
        <Route path="more/recurring" element={<RecurringPage />} />
        <Route path="more/stored-value-cards" element={<StoredValueCardsPage />} />
        <Route path="me/budget" element={<BudgetPage />} />
        <Route path="me/categories" element={<CategoryManagePage />} />
        <Route path="more/monthly-report" element={<Navigate to="/transactions/monthly-report" replace />} />
        <Route path="transactions/monthly-report" element={<MonthlyReportPage />} />
        <Route path="transactions/report" element={<ReportPage />} />
        <Route path="*" element={<Navigate to="/ledger" replace />} />
      </Routes>
    )
  }

  return (
    <>
      <SuccessToast />
      {content}
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AccountingProvider>
        <AppRoutes />
      </AccountingProvider>
    </HashRouter>
  )
}
