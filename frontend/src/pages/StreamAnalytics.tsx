import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer,
  Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import {
  CAMPAIGNS, HOT_PRODUCT_IDS, INTERVAL_SECONDS, PUBLISHER_CTR, PUBLISHER_ROAS,
  cityFromStore, generateBatch, productName, seedBatches, type Batch,
} from '../lib/streamSimulator'
import {
  COLD_TRIGGER_C, SignInRequiredError, fetchInfo, fetchWindow, getLastQuery, signIn, signOut,
  windowQuery,
  type EventhouseInfo, type StreamWindow,
} from '../lib/eventhouse'

/** Batches of history kept in memory (~5 minutes at the notebook's 5s cadence). */
const WINDOW_BATCHES = 60
const SEED_BATCHES = 36

/** Trailing minutes of Eventhouse activity pulled on every poll. */
const WINDOW_MINUTES = 5
const POLL_MS = INTERVAL_SECONDS * 1000

/** Beyond this the newest event is stale, i.e. the notebook is no longer publishing. */
const LIVE_LAG_MS = 60_000

type Source = 'live' | 'sim'

const EMPTY_WINDOW: StreamWindow = {
  pos: [], impressions: [], weather: [], roi: [], anchor: Date.now(), minutes: WINDOW_MINUTES,
}

/** Flatten simulator batches into the same shape the Eventhouse client returns. */
function batchesToWindow(batches: Batch[]): StreamWindow {
  return {
    pos: batches.flatMap(b => b.pos),
    impressions: batches.flatMap(b => b.impressions),
    weather: batches.flatMap(b => b.weather),
    roi: batches.flatMap(b => b.roi),
    anchor: batches.length ? batches[batches.length - 1].time : Date.now(),
    minutes: (batches.length * INTERVAL_SECONDS) / 60,
  }
}

const PUBLISHER_COLORS: Record<string, string> = {
  Meta: '#4ecdc4', Google: '#45b7aa', Amazon: '#ffd93d', Direct: '#ff6b6b',
}

const CITY_COLORS = ['#4ecdc4', '#45b7aa', '#ffd93d', '#ff6b6b', '#a78bfa', '#60a5fa']

function money(val: number) {
  if (Math.abs(val) >= 1_000_000) return `£${(val / 1_000_000).toFixed(1)}M`
  if (Math.abs(val) >= 1_000) return `£${(val / 1_000).toFixed(1)}K`
  return `£${val.toFixed(2)}`
}

function moneyShort(val: number) {
  if (Math.abs(val) >= 1_000) return `£${(val / 1_000).toFixed(0)}K`
  return `£${Math.round(val)}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tooltipMoney = (val: any) => money(Number(val))

const tooltipStyle = {
  contentStyle: { background: '#16213e', border: '1px solid #2a2a4a', borderRadius: 8 },
  labelStyle: { color: '#ccc' },
  // Recharts falls back to black for item text when a series carries no colour, which is
  // unreadable on the dark card. Force a light foreground instead.
  itemStyle: { color: '#e8e8f0' },
}

interface MetricNoteProps { children: React.ReactNode }
function MetricNote({ children }: MetricNoteProps) {
  return <p className="chart-note">{children}</p>
}

interface KqlProps { query: string }
function Kql({ query }: KqlProps) {
  return (
    <details className="kql-details">
      <summary>Equivalent KQL against the Eventhouse</summary>
      <pre>{query.trim()}</pre>
    </details>
  )
}

export default function StreamAnalytics() {
  const [source, setSource] = useState<Source>('live')
  const [running, setRunning] = useState(true)
  const [windowData, setWindowData] = useState<StreamWindow | null>(null)
  const [info, setInfo] = useState<EventhouseInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [signInMessage, setSignInMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(0)
  const simBatches = useRef<Batch[]>([])
  const nextIndex = useRef(SEED_BATCHES + 1)
  const infoSynced = useRef(false)

  const refreshInfo = useCallback(() => {
    fetchInfo().then(setInfo).catch(err => setInfo({
      cluster: '—', database: '—', connected: false, transport: 'direct',
      error: (err as Error).message,
    }))
  }, [])

  // Connection banner: which cluster/database, over which transport, and as whom.
  useEffect(() => { refreshInfo() }, [refreshInfo])

  // Live source: re-read the trailing window from the Eventhouse on the notebook's cadence.
  useEffect(() => {
    if (source !== 'live') return
    let cancelled = false

    const tick = async () => {
      try {
        const next = await fetchWindow(WINDOW_MINUTES)
        if (cancelled) return
        setWindowData(next)
        setError(null)
        setNeedsSignIn(false)
        setLastRefresh(Date.now())
        // Silent SSO may have signed us in after the banner was first rendered.
        if (!infoSynced.current) { infoSynced.current = true; refreshInfo() }
      } catch (err) {
        if (cancelled) return
        // A deployed build needs an interactive sign-in before it can query.
        if (err instanceof SignInRequiredError) {
          setNeedsSignIn(true)
          setSignInMessage(err.message)
          setError(null)
        } else {
          setError((err as Error).message)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void tick()
    if (!running) return () => { cancelled = true }
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [source, running, refreshInfo])

  // Simulated source: the in-browser mirror of the notebook, for demos without Fabric.
  useEffect(() => {
    if (source !== 'sim') return
    if (simBatches.current.length === 0) {
      simBatches.current = seedBatches(SEED_BATCHES)
      nextIndex.current = SEED_BATCHES + 1
    }
    setWindowData(batchesToWindow(simBatches.current))
    setError(null)
    setLoading(false)

    if (!running) return
    const id = setInterval(() => {
      simBatches.current = [
        ...simBatches.current,
        generateBatch(nextIndex.current++, Date.now()),
      ].slice(-WINDOW_BATCHES)
      setWindowData(batchesToWindow(simBatches.current))
      setLastRefresh(Date.now())
    }, POLL_MS)
    return () => clearInterval(id)
  }, [source, running])

  const reset = useCallback(() => {
    if (source === 'sim') {
      simBatches.current = seedBatches(SEED_BATCHES)
      nextIndex.current = SEED_BATCHES + 1
      setWindowData(batchesToWindow(simBatches.current))
    } else {
      setLoading(true)
      fetchWindow(WINDOW_MINUTES)
        .then(w => { setWindowData(w); setError(null); setNeedsSignIn(false); setLastRefresh(Date.now()) })
        .catch(err => {
          if (err instanceof SignInRequiredError) setNeedsSignIn(true)
          else setError((err as Error).message)
        })
        .finally(() => setLoading(false))
    }
  }, [source])

  const handleSignIn = useCallback(async () => {
    try {
      await signIn()
      setNeedsSignIn(false)
      refreshInfo()
      reset()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [refreshInfo, reset])

  const handleSignOut = useCallback(async () => {
    await signOut()
    setNeedsSignIn(true)
    refreshInfo()
  }, [refreshInfo])

  const stats = useMemo(() => {
    const win = windowData ?? EMPTY_WINDOW
    const { pos, impressions, weather, roi } = win

    const revenue = pos.reduce((s, p) => s + p.amount_gbp, 0)
    const adSpend = impressions.reduce((s, i) => s + i.spend_amount_gbp, 0)
    const clicks = impressions.filter(i => i.clicked).length
    const conversions = impressions.filter(i => i.converted).length
    const coldTriggers = weather.filter(w => w.temp_c < COLD_TRIGGER_C).length
    const attributed = pos.filter(p => p.campaign_id !== '').length

    // Bucket both sources into the notebook's publish interval so the trend line has the
    // same granularity whether rows come from Kusto or the local generator.
    const buckets = new Map<number, { revenue: number; spend: number; transactions: number; impressions: number }>()
    const bucketOf = (isoTime: string) => Math.floor(Date.parse(isoTime) / POLL_MS) * POLL_MS
    const bucketAt = (key: number) => {
      let row = buckets.get(key)
      if (!row) { row = { revenue: 0, spend: 0, transactions: 0, impressions: 0 }; buckets.set(key, row) }
      return row
    }
    for (const p of pos) {
      const row = bucketAt(bucketOf(p.event_time))
      row.revenue += p.amount_gbp
      row.transactions += 1
    }
    for (const i of impressions) {
      const row = bucketAt(bucketOf(i.event_time))
      row.spend += i.spend_amount_gbp
      row.impressions += 1
    }

    const series = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, row]) => ({
        label: new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        ...row,
      }))

    // Revenue + product mix by city (city derived from store_id, same as the KQL).
    const cityMap = new Map<string, { city: string; revenue: number; transactions: number; hot: number }>()
    for (const p of pos) {
      const city = cityFromStore(p.store_id)
      const row = cityMap.get(city) ?? { city, revenue: 0, transactions: 0, hot: 0 }
      row.revenue += p.amount_gbp
      row.transactions += 1
      if (HOT_PRODUCT_IDS.has(p.product_id)) row.hot += 1
      cityMap.set(city, row)
    }

    const tempMap = new Map<string, { sum: number; n: number }>()
    for (const w of weather) {
      const row = tempMap.get(w.city) ?? { sum: 0, n: 0 }
      row.sum += w.temp_c
      row.n += 1
      tempMap.set(w.city, row)
    }

    const byCity = [...cityMap.values()]
      .map(r => {
        const t = tempMap.get(r.city)
        return {
          ...r,
          hotPct: r.transactions ? (100 * r.hot) / r.transactions : 0,
          aov: r.transactions ? r.revenue / r.transactions : 0,
          temp: t && t.n ? t.sum / t.n : null,
        }
      })
      .sort((a, b) => b.revenue - a.revenue)

    // Funnel + cost efficiency by publisher.
    const pubMap = new Map<string, { publisher: string; impressions: number; clicks: number; conversions: number; spend: number }>()
    for (const i of impressions) {
      const row = pubMap.get(i.publisher) ?? { publisher: i.publisher, impressions: 0, clicks: 0, conversions: 0, spend: 0 }
      row.impressions += 1
      if (i.clicked) row.clicks += 1
      if (i.converted) row.conversions += 1
      row.spend += i.spend_amount_gbp
      pubMap.set(i.publisher, row)
    }

    const byPublisher = [...pubMap.values()].map(r => ({
      ...r,
      ctr: r.impressions ? (100 * r.clicks) / r.impressions : 0,
      cvr: r.clicks ? (100 * r.conversions) / r.clicks : 0,
      cpc: r.clicks ? r.spend / r.clicks : 0,
      cpa: r.conversions ? r.spend / r.conversions : 0,
    })).sort((a, b) => b.ctr - a.ctr)

    // Reported ROAS from the ROIMetrics stream (independent of POS/impressions).
    const roiMap = new Map<string, { publisher: string; sum: number; n: number; revenue: number; spend: number }>()
    for (const r of roi) {
      const row = roiMap.get(r.publisher) ?? { publisher: r.publisher, sum: 0, n: 0, revenue: 0, spend: 0 }
      row.sum += r.roi
      row.n += 1
      row.revenue += r.attributed_revenue_gbp
      row.spend += r.total_spend_gbp
      roiMap.set(r.publisher, row)
    }

    const byRoi = [...roiMap.values()]
      .map(r => ({ publisher: r.publisher, avgRoi: r.sum / r.n, revenue: r.revenue, spend: r.spend, samples: r.n }))
      .sort((a, b) => b.avgRoi - a.avgRoi)

    // Top products by revenue.
    const prodMap = new Map<string, { id: string; revenue: number; units: number }>()
    for (const p of pos) {
      const row = prodMap.get(p.product_id) ?? { id: p.product_id, revenue: 0, units: 0 }
      row.revenue += p.amount_gbp
      row.units += 1
      prodMap.set(p.product_id, row)
    }
    const topProducts = [...prodMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6)

    return {
      revenue, adSpend, clicks, conversions, coldTriggers, attributed,
      posCount: pos.length,
      impressionCount: impressions.length,
      weatherCount: weather.length,
      roiCount: roi.length,
      aov: pos.length ? revenue / pos.length : 0,
      ctr: impressions.length ? (100 * clicks) / impressions.length : 0,
      cvr: clicks ? (100 * conversions) / clicks : 0,
      cpa: conversions ? adSpend / conversions : 0,
      blendedRoas: adSpend ? revenue / adSpend : 0,
      attributionRate: pos.length ? (100 * attributed) / pos.length : 0,
      series, byCity, byPublisher, byRoi, topProducts,
      windowMinutes: win.minutes,
      anchor: win.anchor,
    }
  }, [windowData])

  const scatterData = stats.byCity.filter(c => c.temp !== null)
    .map(c => ({ city: c.city, temp: c.temp as number, hotPct: c.hotPct, revenue: c.revenue }))

  const isLive = source === 'live'
  const hasRows = stats.posCount + stats.impressionCount > 0

  // Why did a read come back empty? Shows the actual HTTP status / row count / failure reason.
  const diag = lastRefresh >= 0 ? getLastQuery() : null
  const diagLabel = diag
    ? [
        `transport ${diag.transport}`,
        diag.status ? `HTTP ${diag.status}` : 'no HTTP response',
        diag.tables !== undefined ? `${diag.tables} tables` : null,
        diag.rows !== undefined ? `${diag.rows} rows` : null,
        `${diag.ms} ms`,
        diag.detail ? `— ${diag.detail}` : null,
      ].filter(Boolean).join(' · ')
    : 'no query has completed yet'
  const lagMs = hasRows ? Date.now() - stats.anchor : 0
  // "Flowing" means the newest row in Kusto is recent, i.e. the notebook is still publishing.
  const flowing = isLive ? hasRows && lagMs < LIVE_LAG_MS : running
  const lagLabel = lagMs < 90_000
    ? `${Math.max(0, Math.round(lagMs / 1000))}s ago`
    : `${Math.round(lagMs / 60_000)} min ago`

  return (
    <div>
      <h1 className="page-title">Stream Analytics</h1>
      <p className="page-intro">
        Live view of the four event streams produced by the <code>04_RT_Eventstream_Simulator</code> notebook,
        routed through <code>mybrew_rt_eventstream</code> into the <code>mybrew_eventhouse</code> KQL database.
        In <strong>Eventhouse</strong> mode every number below is queried straight from those tables, so this page
        and the Fabric dashboard are reading the same rows. Each section explains one metric and shows the KQL
        behind it.
      </p>

      <div className={`conn-banner ${isLive && info?.connected ? 'ok' : 'warn'}`}>
        {isLive ? (
          <>
            <span className="conn-label">Eventhouse</span>
            <code>{info?.database ?? '…'}</code>
            <span className="conn-sep">·</span>
            <span className="conn-dim">{info?.cluster?.replace('https://', '') ?? '…'}</span>
            {info?.identity && <><span className="conn-sep">·</span><span className="conn-dim">as {info.identity}</span></>}
            <span className="conn-sep">·</span>
            <span className="conn-dim">
              {info?.transport === 'direct' ? 'direct browser query (Entra sign-in)' : 'dev proxy (Azure CLI login)'}
            </span>
            <span className="conn-sep">·</span>
            <span className="conn-dim">build {__BUILD_STAMP__}</span>
            <span className="conn-sep">·</span>
            <span className="conn-dim">last read: {diagLabel}</span>
            {info?.transport === 'direct' && info?.connected && (
              <button className="btn btn-sm btn-ghost conn-action" onClick={handleSignOut}>Sign out</button>
            )}
          </>
        ) : (
          <>
            <span className="conn-label sim">Simulated</span>
            <span className="conn-dim">
              generated in the browser with the notebook's own logic — nothing is read from Fabric
            </span>
          </>
        )}
      </div>

      {needsSignIn && (
        <div className="conn-error signin">
          <strong>{signInMessage || 'Sign in to query the Eventhouse.'}</strong>{' '}
          This build queries Kusto straight from the browser and normally reuses the Entra session you
          already have from Fabric. If you are signed in with more than one account, set
          <code> VITE_ENTRA_LOGIN_HINT</code> to the account that has access to
          <code> {info?.database ?? 'mybrew_eventhouse'}</code>.
          <div className="conn-error-actions">
            <button className="btn btn-sm" onClick={handleSignIn}>Sign in with Entra</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSource('sim')}>
              Use simulated data
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="conn-error">
          <strong>Eventhouse query failed.</strong> {error}
          <div className="conn-error-actions">
            <button className="btn btn-sm" onClick={reset}>Retry</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setSource('sim')}>
              Use simulated data
            </button>
          </div>
        </div>
      )}

      {isLive && !hasRows && !loading && !needsSignIn && (
        <p className="chart-note idle-note">
          The last read came back empty. Diagnostic: {diagLabel}
        </p>
      )}

      <div className="stream-toolbar">
        <span className={`status-dot ${flowing ? 'live' : 'paused'}`} />
        <span className="status-text">
          {loading && !hasRows
            ? 'Querying the Eventhouse…'
            : isLive
              ? !hasRows
                ? <>No rows yet · {WINDOW_MINUTES} min window</>
                : <>
                    {flowing ? 'Streaming' : 'Notebook idle'} · newest event {lagLabel} ·
                    {' '}{WINDOW_MINUTES} min window · {running ? `refresh every ${INTERVAL_SECONDS}s` : 'refresh paused'}
                    {lastRefresh > 0 && <> · read at {new Date(lastRefresh).toLocaleTimeString()}</>}
                  </>
              : <>
                  {running ? 'Streaming' : 'Paused'} · batch every {INTERVAL_SECONDS}s ·
                  {' '}rolling window {stats.windowMinutes.toFixed(0)} min
                </>}
        </span>

        <div className="source-toggle">
          <button
            className={`btn btn-sm ${isLive ? 'active' : 'btn-ghost'}`}
            onClick={() => setSource('live')}
          >
            Eventhouse
          </button>
          <button
            className={`btn btn-sm ${!isLive ? 'active' : 'btn-ghost'}`}
            onClick={() => setSource('sim')}
          >
            Simulated
          </button>
        </div>

        <button className="btn btn-sm" onClick={() => setRunning(r => !r)}>
          {running ? 'Pause' : 'Resume'}
        </button>
        <button className="btn btn-sm btn-ghost" onClick={reset}>
          {isLive ? 'Refresh' : 'Reset'}
        </button>
      </div>

      {isLive && !loading && !flowing && hasRows && (
        <p className="chart-note idle-note">
          The newest row in the Eventhouse is <strong>{lagLabel}</strong>, so the notebook isn't publishing right
          now. The window is anchored to that last burst of activity, which is why the charts still have data.
          Run <code>04_RT_Eventstream_Simulator</code> in Fabric and these numbers start moving within a few seconds.
        </p>
      )}

      {/* ---------------- KPI scorecards ---------------- */}
      <h2 className="section-title">1. Headline metrics</h2>
      <MetricNote>
        The "is it live?" row. Everything is computed over the rolling {stats.windowMinutes.toFixed(0)}-minute
        window, matching a <code>where event_time &gt; ago(...)</code> filter in KQL.
      </MetricNote>

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="label">Revenue</div>
          <div className="value">{money(stats.revenue)}</div>
          <div className="kpi-sub">sum(amount_gbp)</div>
        </div>
        <div className="kpi-card">
          <div className="label">Transactions</div>
          <div className="value">{stats.posCount.toLocaleString()}</div>
          <div className="kpi-sub">POSTransactions rows</div>
        </div>
        <div className="kpi-card">
          <div className="label">Avg order value</div>
          <div className="value">£{stats.aov.toFixed(2)}</div>
          <div className="kpi-sub">revenue / transactions</div>
        </div>
        <div className="kpi-card">
          <div className="label">Attribution rate</div>
          <div className="value">{stats.attributionRate.toFixed(0)}%</div>
          <div className="kpi-sub">POS rows with a campaign</div>
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi-card">
          <div className="label">Impressions</div>
          <div className="value">{stats.impressionCount.toLocaleString()}</div>
          <div className="kpi-sub">AdImpressions rows</div>
        </div>
        <div className="kpi-card">
          <div className="label">CTR</div>
          <div className="value">{stats.ctr.toFixed(1)}%</div>
          <div className="kpi-sub">clicks / impressions</div>
        </div>
        <div className="kpi-card">
          <div className="label">Ad spend</div>
          <div className="value negative">{money(stats.adSpend)}</div>
          <div className="kpi-sub">sum(spend_amount_gbp)</div>
        </div>
        <div className="kpi-card">
          <div className="label">Cold triggers</div>
          <div className="value positive">{stats.coldTriggers}</div>
          <div className="kpi-sub">weather readings under 5°C</div>
        </div>
      </div>

      <Kql query={`
POSTransactions
| where event_time > ago(30m)
| summarize Revenue=sum(amount_gbp), Transactions=count()
| extend AOV = round(Revenue / Transactions, 2)`} />

      {/* ---------------- Revenue trend ---------------- */}
      <h2 className="section-title">2. Revenue &amp; throughput over time</h2>
      <MetricNote>
        Revenue per 5-second batch. This is the proof the pipeline is flowing — a flat line at zero means the
        notebook stopped or the Eventstream is unhealthy. Watch the shape, not the absolute value: the generator
        emits 4–10 sales per batch, so the band is naturally noisy.
      </MetricNote>
      <div className="chart-card full-width">
        <h3>Revenue per batch (£)</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={stats.series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
            <XAxis dataKey="label" tick={{ fill: '#888', fontSize: 11 }} interval="preserveStartEnd" minTickGap={60} />
            <YAxis tick={{ fill: '#888', fontSize: 11 }} tickFormatter={moneyShort} />
            <Tooltip formatter={tooltipMoney} {...tooltipStyle} />
            <Area type="monotone" dataKey="revenue" stroke="#4ecdc4" fill="#4ecdc4" fillOpacity={0.25} name="Revenue" />
            <Area type="monotone" dataKey="spend" stroke="#ff6b6b" fill="#ff6b6b" fillOpacity={0.18} name="Ad spend" />
          </AreaChart>
        </ResponsiveContainer>
        <Kql query={`
POSTransactions
| where event_time > ago(30m)
| summarize Revenue=sum(amount_gbp), Txns=count() by bin(event_time, 1m)
| render timechart`} />
      </div>

      {/* ---------------- City breakdown ---------------- */}
      <h2 className="section-title">3. Where the revenue comes from</h2>
      <MetricNote>
        City is derived from the <code>store_id</code> prefix (<code>STR-LDN-*</code> → London), exactly as the KQL
        <code> case()</code> expression does. London is deliberately weighted to ~50% of traffic, so it should
        dominate — if it doesn't, your traffic weighting changed.
      </MetricNote>
      <div className="chart-grid">
        <div className="chart-card">
          <h3>Revenue by city</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.byCity}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
              <XAxis dataKey="city" tick={{ fill: '#888', fontSize: 11 }} />
              <YAxis tick={{ fill: '#888', fontSize: 11 }} tickFormatter={moneyShort} />
              <Tooltip formatter={tooltipMoney} {...tooltipStyle} />
              <Bar dataKey="revenue" name="Revenue" radius={[4, 4, 0, 0]}>
                {stats.byCity.map((_, i) => <Cell key={i} fill={CITY_COLORS[i % CITY_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Top products by revenue</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.topProducts} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
              <XAxis type="number" tick={{ fill: '#888', fontSize: 11 }} tickFormatter={moneyShort} />
              <YAxis
                type="category" dataKey="id" width={120}
                tick={{ fill: '#888', fontSize: 10 }} tickFormatter={productName}
              />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip formatter={tooltipMoney} labelFormatter={(id: any) => productName(String(id))} {...tooltipStyle} />
              <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]}>
                {stats.topProducts.map((p, i) => (
                  <Cell key={i} fill={HOT_PRODUCT_IDS.has(p.id) ? '#ff6b6b' : '#4ecdc4'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="chart-legend-note">
            <span className="swatch hot" /> hot drink &nbsp;
            <span className="swatch cold" /> cold drink
          </p>
        </div>
      </div>
      <Kql query={`
POSTransactions
| where event_time > ago(1h)
| extend City = case(store_id startswith "STR-LDN","London",
                     store_id startswith "STR-MAN","Manchester",
                     store_id startswith "STR-LA","Los Angeles",
                     store_id startswith "STR-SF","San Francisco",
                     store_id startswith "STR-NYC","New York",
                     store_id startswith "STR-SEA","Seattle","Other")
| summarize Revenue=sum(amount_gbp), Txns=count() by City
| order by Revenue desc`} />

      {/* ---------------- Funnel ---------------- */}
      <h2 className="section-title">4. Advertising funnel &amp; cost efficiency</h2>
      <MetricNote>
        Each publisher has a different click-through rate baked into the generator
        (Direct {(PUBLISHER_CTR.Direct * 100).toFixed(0)}%, Meta {(PUBLISHER_CTR.Meta * 100).toFixed(0)}%,
        Amazon {(PUBLISHER_CTR.Amazon * 100).toFixed(0)}%, Google {(PUBLISHER_CTR.Google * 100).toFixed(0)}%),
        and only clicks can convert ({/* conversion */}14% of them). Direct also costs pennies per impression,
        so it wins on CTR <em>and</em> CPA — that's the "owned channels beat paid" story.
      </MetricNote>
      <div className="chart-grid">
        <div className="chart-card">
          <h3>Impressions → clicks → conversions</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.byPublisher}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
              <XAxis dataKey="publisher" tick={{ fill: '#888', fontSize: 11 }} />
              <YAxis tick={{ fill: '#888', fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
              <Legend />
              <Bar dataKey="impressions" name="Impressions" fill="#2f6f8f" radius={[4, 4, 0, 0]} />
              <Bar dataKey="clicks" name="Clicks" fill="#4ecdc4" radius={[4, 4, 0, 0]} />
              <Bar dataKey="conversions" name="Conversions" fill="#51cf66" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Click-through rate by publisher</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={stats.byPublisher}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
              <XAxis dataKey="publisher" tick={{ fill: '#888', fontSize: 11 }} />
              <YAxis tick={{ fill: '#888', fontSize: 11 }} unit="%" />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} {...tooltipStyle} />
              <Bar dataKey="ctr" name="CTR" radius={[4, 4, 0, 0]}>
                {stats.byPublisher.map((p, i) => (
                  <Cell key={i} fill={PUBLISHER_COLORS[p.publisher] ?? '#4ecdc4'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="chart-card full-width">
        <h3>Funnel detail by publisher</h3>
        <table>
          <thead>
            <tr>
              <th>Publisher</th><th>Impressions</th><th>Clicks</th><th>CTR</th>
              <th>Conversions</th><th>CVR</th><th>Spend</th><th>CPC</th><th>CPA</th>
            </tr>
          </thead>
          <tbody>
            {stats.byPublisher.map(p => (
              <tr key={p.publisher}>
                <td><span className="dot" style={{ background: PUBLISHER_COLORS[p.publisher] }} />{p.publisher}</td>
                <td>{p.impressions.toLocaleString()}</td>
                <td>{p.clicks.toLocaleString()}</td>
                <td style={{ color: '#4ecdc4' }}>{p.ctr.toFixed(1)}%</td>
                <td>{p.conversions.toLocaleString()}</td>
                <td>{p.cvr.toFixed(1)}%</td>
                <td>{money(p.spend)}</td>
                <td>{p.clicks ? `£${p.cpc.toFixed(2)}` : '—'}</td>
                <td style={{ color: p.conversions ? '#51cf66' : '#666' }}>
                  {p.conversions ? `£${p.cpa.toFixed(2)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Kql query={`
AdImpressions
| where event_time > ago(1h)
| summarize Impressions=count(), Clicks=countif(clicked),
            Conversions=countif(converted), Spend=sum(spend_amount_gbp)
    by publisher
| extend CTR = round(100.0 * Clicks / Impressions, 2),
         CVR = round(100.0 * Conversions / max_of(Clicks, 1), 2),
         CPC = round(Spend / max_of(Clicks, 1), 2),
         CPA = round(Spend / max_of(Conversions, 1), 2)
| order by CTR desc`} />
      </div>

      {/* ---------------- Weather correlation ---------------- */}
      <h2 className="section-title">5. Weather → product mix (the differentiator)</h2>
      <MetricNote>
        The causal link in the data: cities whose baseline temperature is under 10°C only sell hot drinks, so their
        hot-drink share pins at 100%. Warmer cities sell the full range and settle near 60%. A downward-sloping
        cloud of points here <em>is</em> the personalization story — cold weather drives hot-drink demand.
      </MetricNote>
      <div className="chart-card full-width">
        <h3>Average temperature vs hot-drink share of sales</h3>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
            <XAxis
              type="number" dataKey="temp" name="Temp" unit="°C" domain={['dataMin - 2', 'dataMax + 2']}
              tick={{ fill: '#888', fontSize: 11 }}
              label={{ value: 'Avg temperature (°C)', position: 'insideBottom', offset: -10, fill: '#888', fontSize: 12 }}
            />
            <YAxis
              type="number" dataKey="hotPct" name="Hot drinks" unit="%" domain={[0, 105]}
              tick={{ fill: '#888', fontSize: 11 }}
              label={{ value: 'Hot drink share (%)', angle: -90, position: 'insideLeft', fill: '#888', fontSize: 12 }}
            />
            <ZAxis type="number" dataKey="revenue" range={[80, 600]} name="Revenue" />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              {...tooltipStyle}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any, name: any) => {
                if (name === 'Revenue') return money(Number(v))
                if (name === 'Hot drinks') return `${Number(v).toFixed(0)}%`
                return `${Number(v).toFixed(1)}°C`
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.city ?? ''}
            />
            <Scatter data={scatterData} name="City">
              {scatterData.map((c, i) => (
                <Cell key={i} fill={c.temp < 10 ? '#ff6b6b' : '#4ecdc4'} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <p className="chart-legend-note">
          <span className="swatch hot" /> cold city (&lt;10°C) &nbsp;
          <span className="swatch cold" /> warm city &nbsp;· bubble size = revenue
        </p>
        <Kql query={`
let temps = WeatherEvents
| where event_time > ago(1h)
| summarize Temp=avg(temp_c) by city;
POSTransactions
| where event_time > ago(1h)
| extend City = case(store_id startswith "STR-LDN","London",
                     store_id startswith "STR-MAN","Manchester",
                     store_id startswith "STR-LA","Los Angeles",
                     store_id startswith "STR-SF","San Francisco",
                     store_id startswith "STR-NYC","New York",
                     store_id startswith "STR-SEA","Seattle","Other")
| extend IsHot = product_id in ("PRD-001","PRD-005","PRD-006","PRD-008","PRD-010","PRD-011")
| summarize HotPct=round(100.0 * countif(IsHot) / count(), 1), Revenue=sum(amount_gbp) by City
| join kind=inner temps on $left.City == $right.city
| project City, Temp, HotPct, Revenue
| order by Temp asc`} />
      </div>

      <div className="chart-card full-width">
        <h3>City detail</h3>
        <table>
          <thead>
            <tr>
              <th>City</th><th>Avg temp</th><th>Revenue</th><th>Transactions</th>
              <th>AOV</th><th>Hot-drink share</th>
            </tr>
          </thead>
          <tbody>
            {stats.byCity.map(c => (
              <tr key={c.city}>
                <td>{c.city}</td>
                <td style={{ color: c.temp !== null && c.temp < 10 ? '#ff6b6b' : '#4ecdc4' }}>
                  {c.temp !== null ? `${c.temp.toFixed(1)}°C` : '—'}
                </td>
                <td>{money(c.revenue)}</td>
                <td>{c.transactions.toLocaleString()}</td>
                <td>£{c.aov.toFixed(2)}</td>
                <td>{c.hotPct.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- ROI ---------------- */}
      <h2 className="section-title">6. Reported ROAS by publisher</h2>
      <MetricNote>
        This comes from the <code>ROIMetrics</code> stream, which is a <strong>pre-aggregated feed</strong> — think
        "numbers the ad platform reports back", not something derived from the POS and impression rows. Each
        publisher has a stable ROAS baseline ({Object.entries(PUBLISHER_ROAS).map(([k, v]) => `${k} ${v}`).join(', ')}),
        so the ranking converges quickly even though individual rows are noisy.
      </MetricNote>
      <div className="chart-grid">
        <div className="chart-card">
          <h3>Average ROAS by publisher</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={stats.byRoi}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
              <XAxis dataKey="publisher" tick={{ fill: '#888', fontSize: 11 }} />
              <YAxis tick={{ fill: '#888', fontSize: 11 }} unit="x" />
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <Tooltip formatter={(v: any) => `${Number(v).toFixed(2)}x`} {...tooltipStyle} />
              <Bar dataKey="avgRoi" name="Avg ROAS" radius={[4, 4, 0, 0]}>
                {stats.byRoi.map((r, i) => (
                  <Cell key={i} fill={PUBLISHER_COLORS[r.publisher] ?? '#4ecdc4'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>Campaign roster</h3>
          <table>
            <thead>
              <tr><th>Campaign</th><th>Publisher</th><th>Target CPA</th></tr>
            </thead>
            <tbody>
              {Object.entries(CAMPAIGNS).map(([id, c]) => (
                <tr key={id}>
                  <td>{c.name}<div className="cell-sub">{id}</div></td>
                  <td><span className="dot" style={{ background: PUBLISHER_COLORS[c.publisher] }} />{c.publisher}</td>
                  <td>£{c.cpa_base.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Kql query={`
ROIMetrics
| where event_time > ago(1h)
| summarize AvgROI=avg(roi), TotalRevenue=sum(attributed_revenue_gbp),
            TotalSpend=sum(total_spend_gbp), Samples=count()
    by publisher
| order by AvgROI desc`} />

      {/* ---------------- Stream health ---------------- */}
      <h2 className="section-title">7. Stream health</h2>
      <MetricNote>
        Row counts per stream over the window. The expected ratio is roughly 1 ROI : 6 weather : 21 POS : 55
        impressions. A stream stuck at zero points at a broken Eventstream route rather than a broken generator.
      </MetricNote>
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="label">POSTransactions</div>
          <div className="value">{stats.posCount.toLocaleString()}</div>
          <div className="kpi-sub">4–10 per batch</div>
        </div>
        <div className="kpi-card">
          <div className="label">AdImpressions</div>
          <div className="value">{stats.impressionCount.toLocaleString()}</div>
          <div className="kpi-sub">12–25 per batch</div>
        </div>
        <div className="kpi-card">
          <div className="label">WeatherEvents</div>
          <div className="value">{stats.weatherCount.toLocaleString()}</div>
          <div className="kpi-sub">1–3 per batch</div>
        </div>
        <div className="kpi-card">
          <div className="label">ROIMetrics</div>
          <div className="value">{stats.roiCount.toLocaleString()}</div>
          <div className="kpi-sub">1 every 3rd batch</div>
        </div>
      </div>

      <MetricNote>
        In Eventhouse mode the page issues exactly one query per refresh — this one. It anchors the window to the
        newest event rather than to <code>now()</code>, so the charts keep showing the last burst of activity when
        the notebook is stopped.
      </MetricNote>
      <Kql query={windowQuery(WINDOW_MINUTES)} />

      {/* ---------------- Caveats ---------------- */}
      <h2 className="section-title">Reading the data honestly</h2>
      <div className="chart-card full-width caveats">
        <ul>
          <li>
            <strong>ROIMetrics doesn't reconcile with POS or impressions.</strong> It is generated independently,
            with its own spend range (£5K–£50K per row). Present it as a reported platform feed — never as the sum
            of the transaction stream. The blended ROAS from actual streams is{' '}
            <strong>{stats.blendedRoas.toFixed(1)}x</strong>, which will not match the ROAS chart above.
          </li>
          <li>
            <strong>~30% of POS rows have an empty <code>campaign_id</code></strong> (organic sales). Filter with{' '}
            <code>where isnotempty(campaign_id)</code> in attribution views or you get a large blank bucket.
          </li>
          <li>
            <strong>POS campaign attribution is random</strong>, not tied to the impressions that customer actually
            saw. Customer-level attribution joins will run and look plausible, but they aren't causal. Keep
            attribution at campaign/publisher aggregate level.
          </li>
          <li>
            <strong>Weather drives product mix by city baseline</strong>, not per individual reading. Correlate on
            city averages, as the scatter above does — joining on <code>event_time</code> won't show a signal.
          </li>
          <li>
            <strong>Low cardinality by design:</strong> 15 customers, 13 stores, 6 campaigns, 4 publishers. Great for
            bars and tables; too sparse for cohort, percentile, or retention analysis.
          </li>
        </ul>
      </div>
    </div>
  )
}
