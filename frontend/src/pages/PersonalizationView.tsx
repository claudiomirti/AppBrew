const triggers = [
  { type: 'Cold Weather Offer', city: 'London', fired: 34200, redeemed: 4788, revenue: 22743, temp: '3°C', product: 'Hazelnut Flat White' },
  { type: 'Cold Weather Offer', city: 'Manchester', fired: 12400, redeemed: 1736, revenue: 8246, temp: '4°C', product: 'Caramel Latte' },
  { type: 'Win-Back 30d', city: 'London', fired: 5800, redeemed: 1218, revenue: 5786, temp: '-', product: 'Free Drink Voucher' },
  { type: 'Win-Back 30d', city: 'Manchester', fired: 2100, redeemed: 441, revenue: 2095, temp: '-', product: 'Free Drink Voucher' },
  { type: 'Tier Nudge (Silver→Gold)', city: 'London', fired: 2100, redeemed: 630, revenue: 2993, temp: '-', product: 'Double Stars Weekend' },
]

function formatCurrency(val: number) {
  return `£${val.toLocaleString()}`
}

export default function PersonalizationView() {
  const totalFired = triggers.reduce((s, t) => s + t.fired, 0)
  const totalRedeemed = triggers.reduce((s, t) => s + t.redeemed, 0)
  const totalRevenue = triggers.reduce((s, t) => s + t.revenue, 0)
  const redemptionRate = ((totalRedeemed / totalFired) * 100).toFixed(1)

  return (
    <div>
      <h1 className="page-title">Personalization Triggers</h1>
      <p style={{ color: '#888', marginBottom: 24 }}>
        Real-time personalization powered by weather, loyalty tier, and engagement signals.
      </p>

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="label">Triggers Fired</div>
          <div className="value">{totalFired.toLocaleString()}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Redemptions</div>
          <div className="value positive">{totalRedeemed.toLocaleString()}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Redemption Rate</div>
          <div className="value">{redemptionRate}%</div>
        </div>
        <div className="kpi-card">
          <div className="label">Revenue Generated</div>
          <div className="value positive">{formatCurrency(totalRevenue)}</div>
        </div>
      </div>

      <div className="chart-card full-width" style={{ marginBottom: 24 }}>
        <h3>🌡️ Active Personalization Scenario</h3>
        <p style={{ color: '#aaa', margin: '12px 0', lineHeight: 1.6 }}>
          It's <strong style={{ color: '#4ecdc4' }}>3°C in London</strong> today. The system automatically pushed a 
          <strong style={{ color: '#ffd93d' }}> warm Hazelnut Flat White</strong> offer to 34,200 opted-in loyalty members.
          Plus: "We haven't seen you in 30 days — free drink on us" win-back and Silver→Gold tier nudge.
        </p>
      </div>

      {triggers.map((t, i) => (
        <div className="trigger-card" key={i}>
          <div>
            <div className="trigger-type">
              {t.type === 'Cold Weather Offer' ? '❄️' : t.type.includes('Win-Back') ? '🔄' : '⭐'} {t.type}
            </div>
            <div className="trigger-city">{t.city} {t.temp !== '-' ? `• ${t.temp}` : ''} • {t.product}</div>
          </div>
          <div className="trigger-stats">
            <div className="fired">{t.fired.toLocaleString()} sent</div>
            <div className="redeemed">{t.redeemed.toLocaleString()} redeemed • {formatCurrency(t.revenue)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
