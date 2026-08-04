import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  COMPARISON_BRANDS, DEFAULT_BRAND, WEBIQ_KEY, WebIqError, fetchBrandPulse, fetchCoverage,
  type Article, type Channel,
} from '../lib/webiq'
import {
  SENTIMENT_COLORS, scoreSentiment, type SentimentLabel, type SentimentResult,
} from '../lib/sentiment'

type Scored = Article & { sentiment: SentimentResult }

const WINDOWS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: 'All', days: 0 },
]

const DAY_MS = 86_400_000

function relativeAge(ms: number | null): string {
  if (ms === null) return 'undated'
  const days = Math.floor((Date.now() - ms) / DAY_MS)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Mean sentiment, expressed -100..100 so it reads as a percentage-like figure. */
function netSentiment(items: Scored[]): number {
  if (!items.length) return 0
  return (items.reduce((sum, i) => sum + i.sentiment.score, 0) / items.length) * 100
}

export default function WebIQ() {
  const [brand, setBrand] = useState(DEFAULT_BRAND)
  const [brandInput, setBrandInput] = useState(DEFAULT_BRAND)
  const [region, setRegion] = useState('GB')
  const [windowDays, setWindowDays] = useState(30)
  const [channel, setChannel] = useState<Channel | 'all'>('all')
  const [themeFilter, setThemeFilter] = useState<string | null>(null)
  const [labelFilter, setLabelFilter] = useState<SentimentLabel | null>(null)

  const [articles, setArticles] = useState<Scored[]>([])
  const [pulse, setPulse] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState<number | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    setError(null)
    const t0 = performance.now()
    try {
      const raw = await fetchCoverage({ brand, region, signal: ctrl.signal })
      const scored = raw.map<Scored>(a => ({
        ...a,
        sentiment: scoreSentiment(`${a.title} ${a.snippet}`),
      }))
      scored.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
      setArticles(scored)
      setElapsed(Math.round(performance.now() - t0))
      setFetchedAt(Date.now())
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setError(err instanceof WebIqError ? err.message : (err as Error).message)
      setArticles([])
    } finally {
      if (!ctrl.signal.aborted) setBusy(false)
    }
  }, [brand, region])

  useEffect(() => {
    void load()
    return () => abortRef.current?.abort()
  }, [load])

  // Competitor pulse is a separate, lighter set of calls so it never blocks the main grid.
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    async function run() {
      const results: Record<string, number> = {}
      await Promise.all(
        COMPARISON_BRANDS.map(async b => {
          try {
            const items = await fetchBrandPulse(b, region, 'en', ctrl.signal)
            const scored = items.map<Scored>(a => ({
              ...a,
              sentiment: scoreSentiment(`${a.title} ${a.snippet}`),
            }))
            const recent = scored.filter(
              s => s.publishedAt !== null && Date.now() - s.publishedAt <= 90 * DAY_MS,
            )
            results[b] = netSentiment(recent.length ? recent : scored)
          } catch {
            /* a missing competitor bar is better than a broken page */
          }
        }),
      )
      if (!cancelled) setPulse(results)
    }
    void run()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [region])

  /** Date window applies only to dated articles; undated are tracked separately. */
  const { inWindow, undated } = useMemo(() => {
    const cutoff = windowDays ? Date.now() - windowDays * DAY_MS : 0
    const dated = articles.filter(a => a.publishedAt !== null)
    return {
      inWindow: windowDays ? dated.filter(a => a.publishedAt! >= cutoff) : dated,
      undated: articles.filter(a => a.publishedAt === null),
    }
  }, [articles, windowDays])

  const visible = useMemo(
    () =>
      inWindow.filter(
        a =>
          (channel === 'all' || a.channel === channel) &&
          (themeFilter === null || a.theme === themeFilter) &&
          (labelFilter === null || a.sentiment.label === labelFilter),
      ),
    [inWindow, channel, themeFilter, labelFilter],
  )

  const counts = useMemo(() => {
    const c = { positive: 0, neutral: 0, negative: 0 }
    for (const a of inWindow) c[a.sentiment.label]++
    return c
  }, [inWindow])

  const trend = useMemo(() => {
    const byDay = new Map<string, { day: string; positive: number; neutral: number; negative: number }>()
    for (const a of inWindow) {
      const key = dayKey(a.publishedAt!)
      const row = byDay.get(key) ?? { day: key, positive: 0, neutral: 0, negative: 0 }
      row[a.sentiment.label]++
      byDay.set(key, row)
    }
    return [...byDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(r => ({ ...r, label: r.day.slice(5) }))
  }, [inWindow])

  const publishers = useMemo(() => {
    const by = new Map<string, { source: string; count: number; net: number; items: Scored[] }>()
    for (const a of inWindow) {
      const row = by.get(a.source) ?? { source: a.source, count: 0, net: 0, items: [] }
      row.count++
      row.items.push(a)
      by.set(a.source, row)
    }
    return [...by.values()]
      .map(r => ({ ...r, net: netSentiment(r.items) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
  }, [inWindow])

  const themes = useMemo(() => {
    const by = new Map<string, { theme: string; positive: number; neutral: number; negative: number; items: Scored[] }>()
    for (const a of inWindow) {
      const row = by.get(a.theme) ?? { theme: a.theme, positive: 0, neutral: 0, negative: 0, items: [] }
      row[a.sentiment.label]++
      row.items.push(a)
      by.set(a.theme, row)
    }
    return [...by.values()]
      .map(r => ({ ...r, total: r.items.length, net: netSentiment(r.items) }))
      .sort((a, b) => a.net - b.net)
  }, [inWindow])

  const net = netSentiment(inWindow)
  const freshest = inWindow.length ? Math.max(...inWindow.map(a => a.publishedAt!)) : null
  const activeFilters = channel !== 'all' || themeFilter !== null || labelFilter !== null

  return (
    <div>
      <h1 className="page-title">🌐 WW IQ</h1>
      <p className="page-intro">
        Competitor news and web coverage for <strong>{brand}</strong>, retrieved live from
        Microsoft Web IQ and scored for sentiment in the browser. Web IQ returns no sentiment
        field, so scores come from a coffee-retail and financial-press lexicon — hover any
        article to see the terms behind its score, and follow the link to check it.
      </p>

      {!WEBIQ_KEY && (
        <div className="conn-error">
          <strong>No Web IQ key configured.</strong>{' '}
          <span className="conn-dim">
            Set <code>VITE_WEBIQ_KEY</code> in <code>frontend/.env.local</code> and restart.
          </span>
        </div>
      )}

      <div className="stream-toolbar webiq-toolbar">
        <form
          className="webiq-brand"
          onSubmit={e => {
            e.preventDefault()
            if (brandInput.trim()) setBrand(brandInput.trim())
          }}
        >
          <input
            className="agent-input"
            value={brandInput}
            onChange={e => setBrandInput(e.target.value)}
            placeholder="Brand to monitor"
            disabled={busy}
          />
          <button className="btn btn-sm" type="submit" disabled={busy || !brandInput.trim()}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </form>

        <div className="webiq-controls">
          {WINDOWS.map(w => (
            <button
              key={w.label}
              className={`btn btn-sm ${windowDays === w.days ? '' : 'btn-ghost'}`}
              onClick={() => setWindowDays(w.days)}
            >
              {w.label}
            </button>
          ))}
          <span className="conn-sep">·</span>
          {(['all', 'news', 'web'] as const).map(c => (
            <button
              key={c}
              className={`btn btn-sm ${channel === c ? '' : 'btn-ghost'}`}
              onClick={() => setChannel(c)}
            >
              {c === 'all' ? 'All sources' : c === 'news' ? 'News' : 'Web'}
            </button>
          ))}
          <span className="conn-sep">·</span>
          <select
            className="webiq-select"
            value={region}
            onChange={e => setRegion(e.target.value)}
            disabled={busy}
          >
            <option value="GB">GB</option>
            <option value="US">US</option>
          </select>
          <button className="btn btn-sm btn-ghost" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="conn-error">
          <strong>Web IQ request failed.</strong> <span className="conn-dim">{error}</span>
          <div className="conn-error-actions">
            <button className="btn btn-sm" onClick={() => void load()}>Retry</button>
          </div>
        </div>
      )}

      <div className="kpi-row webiq-kpis">
        <div className="kpi-card">
          <div className="label">Articles in window</div>
          <div className="value">{inWindow.length}</div>
          <div className="kpi-sub">{articles.length} retrieved</div>
        </div>
        <div className="kpi-card">
          <div className="label">Net sentiment</div>
          <div className="value" style={{ color: net >= 0 ? SENTIMENT_COLORS.positive : SENTIMENT_COLORS.negative }}>
            {net >= 0 ? '+' : ''}{net.toFixed(0)}
          </div>
          <div className="kpi-sub">mean score ×100</div>
        </div>
        <div className="kpi-card">
          <div className="label">Positive</div>
          <div className="value" style={{ color: SENTIMENT_COLORS.positive }}>
            {inWindow.length ? Math.round((counts.positive / inWindow.length) * 100) : 0}%
          </div>
          <div className="kpi-sub">{counts.positive} articles</div>
        </div>
        <div className="kpi-card">
          <div className="label">Negative</div>
          <div className="value" style={{ color: SENTIMENT_COLORS.negative }}>
            {inWindow.length ? Math.round((counts.negative / inWindow.length) * 100) : 0}%
          </div>
          <div className="kpi-sub">{counts.negative} articles</div>
        </div>
        <div className="kpi-card">
          <div className="label">Publishers</div>
          <div className="value">{new Set(inWindow.map(a => a.source)).size}</div>
          <div className="kpi-sub">distinct sources</div>
        </div>
        <div className="kpi-card">
          <div className="label">Freshest</div>
          <div className="value">{relativeAge(freshest)}</div>
          <div className="kpi-sub">{undated.length} undated excluded</div>
        </div>
      </div>

      <div className="chart-grid">
        <div className="chart-card">
          <h3>Sentiment over time</h3>
          <p className="chart-note">
            Articles per day by sentiment. Undated articles ({undated.length}) are excluded —
            Web IQ omits a date on some results and guessing one would fake the trend.
          </p>
          {trend.length === 0 ? (
            <p className="idle-note">{busy ? 'Loading…' : 'No dated articles in this window.'}</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3441" />
                <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="positive" stackId="s" fill={SENTIMENT_COLORS.positive} />
                <Bar dataKey="neutral" stackId="s" fill={SENTIMENT_COLORS.neutral} />
                <Bar dataKey="negative" stackId="s" fill={SENTIMENT_COLORS.negative} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="chart-card">
          <h3>Share of voice</h3>
          <p className="chart-note">
            Which publishers are driving the conversation, and how positive each one is.
          </p>
          {publishers.length === 0 ? (
            <p className="idle-note">{busy ? 'Loading…' : 'No coverage yet.'}</p>
          ) : (
            <div className="agent-bars">
              {publishers.map(p => {
                const max = publishers[0].count || 1
                return (
                  <div className="agent-bar-row" key={p.source}>
                    <span className="agent-bar-label" title={p.source}>{p.source}</span>
                    <span className="agent-bar-track">
                      <span
                        className="agent-bar-fill"
                        style={{
                          width: `${(p.count / max) * 100}%`,
                          background: p.net >= 0 ? SENTIMENT_COLORS.positive : SENTIMENT_COLORS.negative,
                        }}
                      />
                    </span>
                    <span className="agent-bar-value">
                      {p.count} <span className="conn-dim">({p.net >= 0 ? '+' : ''}{p.net.toFixed(0)})</span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="chart-card full-width">
        <h3>Sentiment by theme</h3>
        <p className="chart-note">
          Each theme is a separate Web IQ query, so this shows where the brand is winning and
          where it is exposed. Click a bar to filter the feed.
        </p>
        {themes.length === 0 ? (
          <p className="idle-note">{busy ? 'Loading…' : 'No coverage yet.'}</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, themes.length * 42)}>
            <BarChart data={themes} layout="vertical" margin={{ left: 24, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3441" />
              <XAxis type="number" domain={[-100, 100]} stroke="#94a3b8" fontSize={11} />
              <YAxis type="category" dataKey="theme" width={92} stroke="#94a3b8" fontSize={12} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value, _name, item) => {
                  const v = typeof value === 'number' ? value : 0
                  const total = (item as { payload?: { total?: number } }).payload?.total ?? 0
                  return [`${v >= 0 ? '+' : ''}${v.toFixed(0)} net · ${total} articles`, 'Sentiment']
                }}
              />
              <Bar
                dataKey="net"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={data => {
                  const theme = (data as { payload?: { theme?: string } }).payload?.theme
                  if (theme) setThemeFilter(prev => (prev === theme ? null : theme))
                }}
              >
                {themes.map(t => (
                  <Cell
                    key={t.theme}
                    fill={t.net >= 0 ? SENTIMENT_COLORS.positive : SENTIMENT_COLORS.negative}
                    opacity={themeFilter === null || themeFilter === t.theme ? 1 : 0.35}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="chart-card full-width">
        <h3>Competitor pulse</h3>
        <p className="chart-note">
          Net sentiment across the last 90 days of sales and earnings coverage for each brand,
          scored the same way.
        </p>
        <div className="agent-bars">
          {COMPARISON_BRANDS.map(b => {
            const value = pulse[b]
            if (value === undefined) {
              return (
                <div className="agent-bar-row" key={b}>
                  <span className="agent-bar-label">{b}</span>
                  <span className="agent-bar-track" />
                  <span className="agent-bar-value conn-dim">loading…</span>
                </div>
              )
            }
            return (
              <div className="agent-bar-row" key={b}>
                <span className="agent-bar-label">{b}</span>
                <span className="agent-bar-track webiq-diverging">
                  <span
                    className="agent-bar-fill"
                    style={{
                      width: `${Math.min(50, Math.abs(value) / 2)}%`,
                      marginLeft: value >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(value) / 2)}%`,
                      background: value >= 0 ? SENTIMENT_COLORS.positive : SENTIMENT_COLORS.negative,
                    }}
                  />
                </span>
                <span className="agent-bar-value">{value >= 0 ? '+' : ''}{value.toFixed(0)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="chart-card full-width">
        <div className="webiq-feed-head">
          <h3>Coverage ({visible.length})</h3>
          <div className="webiq-chips">
            {(['positive', 'neutral', 'negative'] as const).map(l => (
              <button
                key={l}
                className={`webiq-chip ${labelFilter === l ? 'active' : ''}`}
                style={{ borderColor: SENTIMENT_COLORS[l] }}
                onClick={() => setLabelFilter(prev => (prev === l ? null : l))}
              >
                <span className="webiq-dot" style={{ background: SENTIMENT_COLORS[l] }} />
                {l} {counts[l]}
              </button>
            ))}
            {activeFilters && (
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setThemeFilter(null)
                  setLabelFilter(null)
                  setChannel('all')
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {themeFilter && (
          <p className="chart-note">
            Filtered to theme <strong>{themeFilter}</strong>.
          </p>
        )}

        {visible.length === 0 ? (
          <p className="idle-note">
            {busy ? 'Retrieving coverage…' : 'Nothing matches these filters.'}
          </p>
        ) : (
          <div className="webiq-feed">
            {visible.map(a => (
              <article className="webiq-card" key={a.id}>
                {a.thumbnail && (
                  <img
                    className="webiq-thumb"
                    src={a.thumbnail}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={e => { e.currentTarget.style.display = 'none' }}
                  />
                )}
                <div className="webiq-body">
                  <div className="webiq-meta">
                    <span
                      className="webiq-pill"
                      style={{ background: SENTIMENT_COLORS[a.sentiment.label] }}
                      title={
                        a.sentiment.matches.length
                          ? `Scored ${a.sentiment.score.toFixed(2)} from: ${a.sentiment.matches
                              .map(m => `${m.term}${m.negated ? ' (negated)' : ''}`)
                              .join(', ')}`
                          : 'No sentiment terms matched — treated as neutral'
                      }
                    >
                      {a.sentiment.label} {a.sentiment.score >= 0 ? '+' : ''}
                      {a.sentiment.score.toFixed(2)}
                    </span>
                    <span className="webiq-source">
                      {a.source}
                      {'\u00a0·\u00a0'}
                      <span className={a.publishedAt === null ? 'webiq-undated' : ''}>
                        {relativeAge(a.publishedAt)}
                      </span>
                    </span>
                    <span className="webiq-tag">{a.theme}</span>
                    <span className={`webiq-tag channel-${a.channel}`}>{a.channel}</span>
                  </div>
                  <a className="webiq-title" href={a.url} target="_blank" rel="noreferrer">
                    {a.title}
                  </a>
                  {a.snippet && <p className="webiq-snippet">{a.snippet}</p>}
                  {a.sentiment.matches.length > 0 && (
                    <p className="webiq-terms">
                      {a.sentiment.matches.slice(0, 5).map(m => (
                        <span
                          key={m.term}
                          className="webiq-term"
                          style={{ color: m.weight >= 0 ? SENTIMENT_COLORS.positive : SENTIMENT_COLORS.negative }}
                        >
                          {m.term}
                          {m.negated ? '¬' : ''}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="agent-meta">
          {fetchedAt
            ? `Retrieved ${new Date(fetchedAt).toLocaleTimeString()} · ${elapsed} ms · ${articles.length} unique articles · region ${region}`
            : 'Not yet retrieved.'}
          {undated.length > 0 && ` · ${undated.length} undated (excluded from trend)`}
        </p>
      </div>
    </div>
  )
}

const TOOLTIP_STYLE = {
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: 8,
  color: '#e2e8f0',
  fontSize: 12,
} as const

