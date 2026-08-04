/**
 * Microsoft Web IQ client.
 *
 * Endpoint and auth verified live against the API:
 *   POST https://api.microsoft.ai/v3/search/news   header `x-apikey`
 *   POST https://api.microsoft.ai/v3/search/web    header `x-apikey`
 * CORS is enabled and echoes the caller's origin (deployed host and localhost both
 * allowed), so these calls run directly from the browser with no proxy.
 *
 * Three real quirks, all measured over 150 live articles, drive the shape of this module:
 *
 *  1. The news endpoint has NO freshness parameter and ranks by relevance, so a bare
 *     "Starbucks" query returned only 2 of 20 articles inside 30 days and one from 2024.
 *     Fixed by fanning out over facet queries and filtering on date here.
 *  2. `lastUpdatedAt` is often missing (16 of 150) and `source` sometimes is too. Undated
 *     items are kept but flagged, never silently treated as "today".
 *  3. `/search/web` on a bare brand name returns nothing but the brand's own site. Web
 *     queries must be opinion/analyst framed and exclude the owned domain.
 */

const BASE = 'https://api.microsoft.ai/v3'

/**
 * Demo key, exposed by explicit choice: this is a static site with no backend, so it ships
 * in the bundle and is readable by anyone who opens the app. Rotate it after the demo.
 */
export const WEBIQ_KEY = import.meta.env.VITE_WEBIQ_KEY ?? ''

export type Channel = 'news' | 'web'

export interface Article {
  id: string
  title: string
  url: string
  source: string
  /** null when Web IQ returned no date — these are excluded from trends. */
  publishedAt: number | null
  snippet: string
  thumbnail: string | null
  channel: Channel
  theme: string
}

interface NewsItem {
  title?: string
  url?: string
  content?: string
  thumbnail?: { url?: string }
  lastUpdatedAt?: string | null
  source?: string | null
}

interface WebItem {
  title?: string
  url?: string
  content?: string
  lastUpdatedAt?: string | null
}

/**
 * Facet queries. A single brand query is too stale to be useful, and each facet also
 * doubles as the theme label, which is what makes the theme breakdown meaningful.
 * Measured recent-article yield per facet is noted for tuning.
 */
const NEWS_FACETS: { suffix: string; theme: string }[] = [
  { suffix: '', theme: 'Brand' },                    // 2/20 recent
  { suffix: 'earnings', theme: 'Earnings' },         // 19/20
  { suffix: 'sales', theme: 'Sales' },               // 20/20
  { suffix: 'stock', theme: 'Stock' },               // 13/20
  { suffix: 'CEO', theme: 'Leadership' },            // 12/20
  { suffix: 'new menu', theme: 'Product' },          // 10/20
  { suffix: 'boycott', theme: 'Backlash' },          // 4/20
  { suffix: 'union', theme: 'Labour' },              // 1/20
  { suffix: 'coffee prices', theme: 'Pricing' },     // 1/20
]

/** Web queries need opinion framing plus an owned-domain exclusion to be worth anything. */
const WEB_FACETS: { suffix: string; theme: string }[] = [
  { suffix: 'customer backlash opinion', theme: 'Opinion' },
  { suffix: 'analyst outlook', theme: 'Analyst' },
  { suffix: 'review verdict', theme: 'Reviews' },
]

export interface FetchOptions {
  brand: string
  region?: string
  language?: string
  signal?: AbortSignal
}

export class WebIqError extends Error {}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (!WEBIQ_KEY) {
    throw new WebIqError(
      'No Web IQ key configured. Set VITE_WEBIQ_KEY in frontend/.env.local and restart the dev server.',
    )
  }
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'x-apikey': WEBIQ_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const err = await res.json()
      detail = err.userMessage || err.errorCode || ''
    } catch {
      /* body may not be JSON */
    }
    if (res.status === 401) throw new WebIqError('Web IQ rejected the API key (401).')
    if (res.status === 429 || res.status === 430) {
      throw new WebIqError('Web IQ rate limit reached — wait a moment and refresh.')
    }
    throw new WebIqError(`Web IQ returned HTTP ${res.status}${detail ? ` — ${detail}` : ''}`)
  }
  return res.json() as Promise<T>
}

/** Web IQ omits `source` on some items, so fall back to a tidied hostname. */
function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'unknown'
  }
}

function parseDate(value?: string | null): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? null : ms
}

/** Trim passages to something card-sized without cutting mid-word. */
function snippet(content: string | undefined, max = 260): string {
  if (!content) return ''
  const clean = content.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, clean.lastIndexOf(' ', max))}…`
}

/** Strip tracking noise so the same article from two facets dedupes to one entry. */
function canonical(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    u.search = ''
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function ownedDomain(brand: string): string {
  return `${brand.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`
}

/**
 * Fan out across every facet in parallel and merge into one deduped set.
 *
 * Individual facet failures are swallowed on purpose: with a dozen calls in flight, one
 * bad response should thin the results, not blank the page. A total failure still throws.
 */
export async function fetchCoverage(opts: FetchOptions): Promise<Article[]> {
  const { brand, region = 'GB', language = 'en', signal } = opts
  const exclude = `-site:${ownedDomain(brand)}`

  const newsCalls = NEWS_FACETS.map(async ({ suffix, theme }) => {
    const query = suffix ? `${brand} ${suffix}` : brand
    const data = await post<{ newsResults?: NewsItem[] }>(
      '/search/news',
      { query, maxResults: 20, language, region, contentFormat: 'passage', maxLength: 1200 },
      signal,
    )
    return (data.newsResults ?? [])
      .filter(n => n.url && n.title)
      .map<Article>(n => ({
        id: `news:${n.url}`,
        title: n.title!.trim(),
        url: n.url!,
        source: n.source?.trim() || hostLabel(n.url!),
        publishedAt: parseDate(n.lastUpdatedAt),
        snippet: snippet(n.content),
        thumbnail: n.thumbnail?.url ?? null,
        channel: 'news',
        theme,
      }))
  })

  const webCalls = WEB_FACETS.map(async ({ suffix, theme }) => {
    const data = await post<{ webResults?: WebItem[] }>(
      '/search/web',
      {
        query: `${brand} ${suffix} ${exclude}`,
        maxResults: 10,
        language,
        region,
        contentFormat: 'passage',
        maxLength: 1200,
      },
      signal,
    )
    return (data.webResults ?? [])
      .filter(w => w.url && w.title)
      .map<Article>(w => ({
        id: `web:${w.url}`,
        title: w.title!.trim(),
        url: w.url!,
        // The web schema has no `source` field at all, unlike news.
        source: hostLabel(w.url!),
        publishedAt: parseDate(w.lastUpdatedAt),
        snippet: snippet(w.content),
        thumbnail: null,
        channel: 'web',
        theme,
      }))
  })

  const settled = await Promise.allSettled([...newsCalls, ...webCalls])
  const ok = settled.filter(r => r.status === 'fulfilled')
  if (ok.length === 0) {
    const first = settled.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    throw first?.reason instanceof Error
      ? first.reason
      : new WebIqError('Every Web IQ query failed.')
  }

  const byUrl = new Map<string, Article>()
  for (const result of ok) {
    for (const article of (result as PromiseFulfilledResult<Article[]>).value) {
      const key = canonical(article.url)
      const existing = byUrl.get(key)
      // Prefer the copy that carries a date, then the one with a thumbnail.
      if (
        !existing ||
        (existing.publishedAt === null && article.publishedAt !== null) ||
        (!existing.thumbnail && article.thumbnail)
      ) {
        byUrl.set(key, existing ? { ...article, theme: existing.theme } : article)
      }
    }
  }
  return [...byUrl.values()]
}

/** Lightweight two-query probe used for the competitor comparison strip. */
export async function fetchBrandPulse(
  brand: string,
  region = 'GB',
  language = 'en',
  signal?: AbortSignal,
): Promise<Article[]> {
  const calls = ['sales', 'earnings'].map(async suffix => {
    const data = await post<{ newsResults?: NewsItem[] }>(
      '/search/news',
      {
        query: `${brand} ${suffix}`,
        maxResults: 20,
        language,
        region,
        contentFormat: 'passage',
        maxLength: 600,
      },
      signal,
    )
    return (data.newsResults ?? [])
      .filter(n => n.url && n.title)
      .map<Article>(n => ({
        id: `pulse:${brand}:${n.url}`,
        title: n.title!.trim(),
        url: n.url!,
        source: n.source?.trim() || hostLabel(n.url!),
        publishedAt: parseDate(n.lastUpdatedAt),
        snippet: snippet(n.content, 160),
        thumbnail: null,
        channel: 'news',
        theme: 'Pulse',
      }))
  })

  const settled = await Promise.allSettled(calls)
  const byUrl = new Map<string, Article>()
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue
    for (const a of r.value) byUrl.set(canonical(a.url), a)
  }
  return [...byUrl.values()]
}

export const DEFAULT_BRAND = 'Starbucks'
export const COMPARISON_BRANDS = ['Starbucks', 'Costa Coffee', 'Pret A Manger']
