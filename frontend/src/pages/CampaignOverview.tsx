import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtTooltip = (val: any) => formatCurrency(Number(val))

const campaignData = [
  { campaign: 'Winter Warmth', Meta: 3740000, Google: 2016000, Amazon: 714000 },
  { campaign: 'Loyalty Boost', Meta: 1850000, Google: 1420000, Amazon: 520000 },
  { campaign: 'Summer Chill', Meta: 2100000, Google: 1680000, Amazon: 890000 },
  { campaign: 'Win-Back 30d', Meta: 920000, Google: 640000, Amazon: 310000 },
]

const publisherSpend = [
  { name: 'Meta', value: 2520000 },
  { name: 'Google', value: 1890000 },
  { name: 'Amazon', value: 980000 },
  { name: 'Programmatic', value: 380000 },
]

const COLORS = ['#4ecdc4', '#45b7aa', '#ff6b6b', '#ffd93d']

const tableData = [
  { campaign: 'Winter Warmth', publisher: 'Meta', region: 'London', impressions: 142000, clicks: 8520, conversions: 1247, spend: 890000, revenue: 3740000 },
  { campaign: 'Winter Warmth', publisher: 'Google', region: 'London', impressions: 98000, clicks: 4410, conversions: 612, spend: 720000, revenue: 2016000 },
  { campaign: 'Loyalty Boost', publisher: 'Meta', region: 'Los Angeles', impressions: 185000, clicks: 9250, conversions: 1480, spend: 650000, revenue: 1850000 },
  { campaign: 'Summer Chill', publisher: 'Google', region: 'San Francisco', impressions: 120000, clicks: 6000, conversions: 840, spend: 540000, revenue: 1680000 },
  { campaign: 'Win-Back 30d', publisher: 'Meta', region: 'New York', impressions: 75000, clicks: 3750, conversions: 525, spend: 320000, revenue: 920000 },
]

function formatCurrency(val: number) {
  if (val >= 1000000) return `£${(val / 1000000).toFixed(1)}M`
  if (val >= 1000) return `£${(val / 1000).toFixed(0)}K`
  return `£${val}`
}

export default function CampaignOverview() {
  const totalRevenue = 20225000
  const totalSpend = 5770000
  const totalConversions = 16295
  const roas = (totalRevenue / totalSpend).toFixed(1)

  return (
    <div>
      <h1 className="page-title">Campaign Overview</h1>
      
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="label">Total Revenue</div>
          <div className="value">{formatCurrency(totalRevenue)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Total Spend</div>
          <div className="value">{formatCurrency(totalSpend)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Conversions</div>
          <div className="value">{totalConversions.toLocaleString()}</div>
        </div>
        <div className="kpi-card">
          <div className="label">ROAS</div>
          <div className="value positive">{roas}x</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3>Revenue by Campaign & Publisher</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={campaignData}>
              <XAxis dataKey="campaign" tick={{ fill: '#888', fontSize: 12 }} />
              <YAxis tick={{ fill: '#888', fontSize: 12 }} tickFormatter={formatCurrency} />
              <Tooltip formatter={fmtTooltip} />
              <Legend />
              <Bar dataKey="Meta" fill="#4ecdc4" />
              <Bar dataKey="Google" fill="#45b7aa" />
              <Bar dataKey="Amazon" fill="#ffd93d" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Spend by Publisher</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={publisherSpend} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                {publisherSpend.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={fmtTooltip} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card full-width">
          <h3>Campaign Performance Detail</h3>
          <table>
            <thead>
              <tr>
                <th>Campaign</th><th>Publisher</th><th>Region</th>
                <th>Impressions</th><th>Clicks</th><th>Conversions</th>
                <th>Spend</th><th>Revenue</th><th>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {tableData.map((r, i) => (
                <tr key={i}>
                  <td>{r.campaign}</td><td>{r.publisher}</td><td>{r.region}</td>
                  <td>{r.impressions.toLocaleString()}</td>
                  <td>{r.clicks.toLocaleString()}</td>
                  <td>{r.conversions.toLocaleString()}</td>
                  <td>{formatCurrency(r.spend)}</td>
                  <td>{formatCurrency(r.revenue)}</td>
                  <td style={{ color: '#51cf66' }}>{(r.revenue / r.spend).toFixed(1)}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
