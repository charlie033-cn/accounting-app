import { Link } from 'react-router-dom'

const MORE_FEATURES = [
  {
    title: '周期记账',
    description: '管理房租、会员、分期等周期账单',
    to: '/more/recurring',
    icon: 'recurring',
    tone: 'blue',
  },
  {
    title: '储值卡管理',
    description: '管理理发卡、洗车卡、按摩卡等预付余额',
    to: '/more/stored-value-cards',
    icon: 'card',
    tone: 'green',
  },
]

function MoreFeatureIcon({ type }: { type: string }) {
  if (type === 'card') {
    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden>
        <rect x="3.5" y="5.5" width="17" height="13" rx="3" />
        <path d="M3.8 9.2h16.4" />
        <path d="M7.2 14.6h4.2" />
        <path d="M15.2 14.6h1.8" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" focusable="false" aria-hidden>
      <rect x="5" y="5.5" width="14" height="14" rx="3" />
      <path d="M8.2 9.2h7.6" />
      <path d="M8.2 13h4.4" />
      <path d="M14.8 15.6a2.8 2.8 0 0 0 2.2-2.7" />
      <path d="M16.9 15.6h-2.1v-2.1" />
    </svg>
  )
}

export function MorePage() {
  return (
    <div className="tab-page more-tab-page">
      <header className="tab-page-header more-tab-header">
        <h1 className="app-title">更多功能</h1>
      </header>
      <div className="more-feature-list">
        {MORE_FEATURES.map((feature) => (
          <Link key={feature.to} className="more-feature-link" to={feature.to}>
            <i className={`more-feature-icon more-feature-icon--${feature.tone}`} aria-hidden>
              <MoreFeatureIcon type={feature.icon} />
            </i>
            <span>
              <strong>{feature.title}</strong>
              <em>{feature.description}</em>
            </span>
            <b>›</b>
          </Link>
        ))}
      </div>
    </div>
  )
}
