import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtTooltip = (val: any) => formatCurrency(Number(val))

interface Publisher {
  name: string
  currentBudget: number
  performance: number // 0-1 scale
  roas: number
}

const initialPublishers: Publisher[] = [
  { name: 'Meta', currentBudget: 2520000, performance: 0.82, roas: 4.2 },
  { name: 'Google', currentBudget: 1890000, performance: 0.58, roas: 2.8 },
  { name: 'Amazon', currentBudget: 980000, performance: 0.71, roas: 3.4 },
  { name: 'Programmatic', currentBudget: 380000, performance: 0.35, roas: 1.6 },
]

function formatCurrency(val: number) {
  if (val >= 1000000) return `£${(val / 1000000).toFixed(2)}M`
  if (val >= 1000) return `£${(val / 1000).toFixed(0)}K`
  return `£${val}`
}

export default function BudgetSimulator() {
  const [publishers, setPublishers] = useState(initialPublishers)
  const [optimized, setOptimized] = useState(false)
  const totalBudget = publishers.reduce((s, p) => s + p.currentBudget, 0)

  const handleSlider = (index: number, value: number) => {
    const updated = [...publishers]
    updated[index] = { ...updated[index], currentBudget: value }
    setPublishers(updated)
    setOptimized(false)
  }

  const runOptimization = () => {
    // Simulate AI agent reallocation: shift budget to higher performers
    const totalPool = publishers.reduce((s, p) => s + p.currentBudget, 0)
    const totalPerf = publishers.reduce((s, p) => s + p.performance, 0)
    const optimizedPubs = publishers.map(p => ({
      ...p,
      currentBudget: Math.round((p.performance / totalPerf) * totalPool),
      roas: p.roas * (1 + (p.performance - 0.5) * 0.4) // boost high performers
    }))
    setPublishers(optimizedPubs)
    setOptimized(true)
  }

  const chartData = publishers.map(p => ({
    name: p.name,
    budget: p.currentBudget,
    roas: p.roas,
    color: p.performance > 0.7 ? '#51cf66' : p.performance > 0.5 ? '#ffd93d' : '#ff6b6b'
  }))

  return (
    <div>
      <h1 className="page-title">Budget Optimizer</h1>
      <p style={{ color: '#888', marginBottom: 24 }}>
        AI agent identifies under/over-performing publishers and recommends reallocation.
      </p>

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="label">Total Budget</div>
          <div className="value">{formatCurrency(totalBudget)}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Avg ROAS</div>
          <div className="value positive">{(publishers.reduce((s, p) => s + p.roas, 0) / publishers.length).toFixed(1)}x</div>
        </div>
        <div className="kpi-card">
          <div className="label">Top Performer</div>
          <div className="value">{publishers.reduce((best, p) => p.roas > best.roas ? p : best).name}</div>
        </div>
        <div className="kpi-card">
          <div className="label">Status</div>
          <div className={`value ${optimized ? 'positive' : ''}`}>{optimized ? '✓ Optimized' : 'Manual'}</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3>Budget Allocation by Publisher</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fill: '#888', fontSize: 12 }} />
              <YAxis tick={{ fill: '#888', fontSize: 12 }} tickFormatter={formatCurrency} />
              <Tooltip formatter={fmtTooltip} />
              <Bar dataKey="budget">
                {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Adjust Budget (or let AI optimize)</h3>
          {publishers.map((p, i) => (
            <div className="slider-group" key={p.name}>
              <label>{p.name} — ROAS: {p.roas.toFixed(1)}x {p.performance > 0.7 ? '🟢' : p.performance > 0.5 ? '🟡' : '🔴'}</label>
              <input
                type="range"
                min={100000}
                max={4000000}
                step={50000}
                value={p.currentBudget}
                onChange={e => handleSlider(i, Number(e.target.value))}
              />
              <div className="slider-value">{formatCurrency(p.currentBudget)}</div>
            </div>
          ))}
          <button className="btn" onClick={runOptimization}>
            🤖 Run AI Optimization Agent
          </button>
        </div>
      </div>

      {optimized && (
        <div className="chart-card full-width" style={{ marginTop: 16, borderColor: '#51cf66' }}>
          <h3 style={{ color: '#51cf66' }}>✓ Agent Recommendation Applied</h3>
          <p style={{ color: '#aaa', fontSize: '0.9rem', marginTop: 8 }}>
            Budget shifted from underperformers (Programmatic, Google) to top performers (Meta, Amazon). 
            Projected ROAS improvement: <strong style={{ color: '#51cf66' }}>+18%</strong>. 
            Estimated additional revenue: <strong style={{ color: '#4ecdc4' }}>£1.2M</strong>.
          </p>
        </div>
      )}
    </div>
  )
}
