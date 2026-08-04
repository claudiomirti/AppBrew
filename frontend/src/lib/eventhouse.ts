/**
 * Browser-side client for the `mybrew_eventhouse` KQL database.
 *
 * Two transports, picked automatically:
 *
 *   proxy  — `/api/kql`, served by the Vite dev-server plugin in `vite-kql-proxy.ts`, which
 *            attaches a token from the developer's Azure CLI login. No sign-in prompt.
 *   direct — browser calls the cluster's REST API itself using an Entra token from MSAL.
 *            Used by deployed static builds, where no proxy exists. Works because the Fabric
 *            Kusto endpoint returns permissive CORS headers.
 *
 * The row shapes returned here are deliberately identical to the simulator's types, so the
 * Stream Analytics page renders live and simulated data through exactly the same code path.
 */
import type { ImpressionEvent, PosEvent, RoiEvent, WeatherEvent } from './streamSimulator'
import { KUSTO_CLUSTER, KUSTO_DATABASE } from './eventhouseConfig'
import { SignInRequiredError } from './authTypes'

export { SignInRequiredError }

/** MSAL is ~230 kB, so it is only fetched when the direct transport is actually used. */
const auth = () => import('./entraAuth')

export const signIn = async () => (await auth()).signIn()
export const signOut = async () => (await auth()).signOut()

export type Transport = 'proxy' | 'direct'

export interface EventhouseInfo {
  cluster: string
  database: string
  connected: boolean
  transport: Transport
  identity?: string
  error?: string
}

export interface StreamWindow {
  pos: PosEvent[]
  impressions: ImpressionEvent[]
  weather: WeatherEvent[]
  roi: RoiEvent[]
  /** Newest `event_time` in the database, i.e. the right edge of the window. */
  anchor: number
  /** Width of the window in minutes. */
  minutes: number
}

/** A weather reading below this triggers the cold-weather campaign in the demo narrative. */
export const COLD_TRIGGER_C = 5

interface KqlResponse {
  columns?: string[]
  rows?: unknown[][]
  error?: string
}

export class EventhouseError extends Error {}

interface KustoV1Response {
  Tables: Array<{ Columns: Array<{ ColumnName: string }>; Rows: unknown[][] }>
}

/** What the most recent KQL round trip actually returned. Surfaced in the UI for diagnosis. */
export interface QueryDiagnostic {
  at: number
  ok: boolean
  ms: number
  transport: Transport
  status?: number
  tables?: number
  rows?: number
  detail?: string
}

let lastQuery: QueryDiagnostic | null = null
export const getLastQuery = (): QueryDiagnostic | null => lastQuery

let transport: Transport | null = null

/**
 * Decide once whether the dev proxy is available. A static build has no `/api/kql` route,
 * so Vite's SPA fallback serves index.html — non-JSON content is the tell.
 */
async function detectTransport(): Promise<Transport> {
  if (transport) return transport
  try {
    const res = await fetch('/api/kql/info')
    const contentType = res.headers.get('content-type') ?? ''
    transport = res.ok && contentType.includes('application/json') ? 'proxy' : 'direct'
  } catch {
    transport = 'direct'
  }
  return transport
}

function toObjects<T>(columns: string[], rows: unknown[][]): T[] {
  return rows.map(row => {
    const obj: Record<string, unknown> = {}
    columns.forEach((name, i) => { obj[name] = row[i] })
    return obj as T
  })
}

/** Run a KQL query and return the primary result table as plain objects. */
export async function queryKql<T = Record<string, unknown>>(csl: string): Promise<T[]> {
  const mode = await detectTransport()
  const started = Date.now()
  const record = (d: Omit<QueryDiagnostic, 'at' | 'ms' | 'transport'>) => {
    lastQuery = { ...d, at: Date.now(), ms: Date.now() - started, transport: mode }
  }

  if (mode === 'direct') {
    // Throws SignInRequiredError when the user still has to sign in.
    let token: string
    try {
      token = await (await auth()).getKustoTokenSilent()
    } catch (err) {
      // The silent ladder swallows its intermediate failures, so pull the recorded reason
      // in as well — without it the diagnostic only ever says "sign in required".
      const why = (await auth()).getLastAuthDetail()
      record({ ok: false, detail: `auth: ${(err as Error).message}${why ? ` · ${why}` : ''}` })
      throw err
    }
    let res: Response
    try {
      res = await fetch(`${KUSTO_CLUSTER}/v1/rest/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ db: KUSTO_DATABASE, csl }),
      })
    } catch (err) {
      // A blocked request never reaches Kusto, so there is no status to report.
      record({ ok: false, detail: `network/CORS: ${(err as Error).message}` })
      throw new EventhouseError(`Could not reach the Eventhouse: ${(err as Error).message}`)
    }

    const text = await res.text()
    if (!res.ok) {
      record({ ok: false, status: res.status, detail: text.slice(0, 300) })
      throw new EventhouseError(`Kusto ${res.status}: ${text.slice(0, 600)}`)
    }

    const parsed = JSON.parse(text) as Partial<KustoV1Response>
    // Guards against a non-v1 response shape, which would otherwise fail obscurely.
    if (!Array.isArray(parsed.Tables) || parsed.Tables.length === 0) {
      record({ ok: false, status: res.status, detail: `unexpected shape: ${text.slice(0, 200)}` })
      throw new EventhouseError(`Unexpected Kusto response shape: ${text.slice(0, 400)}`)
    }

    const primary = parsed.Tables[0]
    record({ ok: true, status: res.status, tables: parsed.Tables.length, rows: primary.Rows.length })
    return toObjects<T>(primary.Columns.map(c => c.ColumnName), primary.Rows)
  }

  let res: Response
  try {
    res = await fetch('/api/kql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csl }),
    })
  } catch (err) {
    record({ ok: false, detail: (err as Error).message })
    throw new EventhouseError(`Could not reach the KQL proxy: ${(err as Error).message}`)
  }

  const body = (await res.json()) as KqlResponse
  if (!res.ok || body.error) {
    record({ ok: false, status: res.status, detail: body.error })
    throw new EventhouseError(body.error ?? `HTTP ${res.status}`)
  }
  record({ ok: true, status: res.status, rows: body.rows?.length ?? 0 })
  return toObjects<T>(body.columns ?? [], body.rows ?? [])
}

export async function fetchInfo(): Promise<EventhouseInfo> {
  if (await detectTransport() === 'direct') {
    const account = await (await auth()).getAccount()
    return {
      cluster: KUSTO_CLUSTER,
      database: KUSTO_DATABASE,
      transport: 'direct',
      connected: account !== null,
      identity: account?.username,
      error: account ? undefined : 'Sign in with your Entra account to query the Eventhouse.',
    }
  }

  const res = await fetch('/api/kql/info')
  return { ...(await res.json()) as Omit<EventhouseInfo, 'transport'>, transport: 'proxy' }
}

/**
 * One query returns every stream for the window, tagged with a `stream` discriminator and
 * packed into a dynamic `payload`. Cheaper and more consistent than four round trips: all
 * four streams are then guaranteed to describe the same slice of time.
 *
 * The window is anchored to the newest event in the database rather than to `now()`. While
 * the notebook is running the two are the same, but when it is stopped the page still shows
 * the last live burst instead of going blank.
 */
export function windowQuery(minutes: number): string {
  return `
let win = ${minutes}m;
let anchor = max_of(
    toscalar(POSTransactions | summarize mx = max(event_time)),
    toscalar(AdImpressions   | summarize mx = max(event_time)));
union
    (POSTransactions | where event_time between (anchor - win .. anchor) | extend stream = "pos"),
    (AdImpressions   | where event_time between (anchor - win .. anchor) | extend stream = "imp"),
    (WeatherEvents   | where event_time between (anchor - win .. anchor) | extend stream = "wx"),
    (ROIMetrics      | where event_time between (anchor - win .. anchor) | extend stream = "roi")
| extend anchor_time = anchor
| project stream, anchor_time, payload = pack_all(true)
| order by anchor_time asc`.trim()
}

interface WindowRow {
  stream: 'pos' | 'imp' | 'wx' | 'roi'
  anchor_time: string
  payload: Record<string, unknown>
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0))
const str = (v: unknown) => (v == null ? '' : String(v))

/** Fetch every stream for the trailing `minutes` of activity in the Eventhouse. */
export async function fetchWindow(minutes: number): Promise<StreamWindow> {
  const rows = await queryKql<WindowRow>(windowQuery(minutes))

  const win: StreamWindow = {
    pos: [], impressions: [], weather: [], roi: [],
    anchor: rows.length ? Date.parse(rows[0].anchor_time) : Date.now(),
    minutes,
  }

  for (const row of rows) {
    // The proxy hands back `payload` already parsed when Kusto types it as dynamic,
    // but a string is possible depending on how the column is serialised.
    const p = (typeof row.payload === 'string'
      ? JSON.parse(row.payload)
      : row.payload) as Record<string, unknown>

    switch (row.stream) {
      case 'pos':
        win.pos.push({
          txn_id: str(p.txn_id),
          customer_id: str(p.customer_id),
          store_id: str(p.store_id),
          campaign_id: str(p.campaign_id),
          product_id: str(p.product_id),
          amount_gbp: num(p.amount_gbp),
          event_time: str(p.event_time),
        })
        break
      case 'imp':
        win.impressions.push({
          impression_id: str(p.impression_id),
          campaign_id: str(p.campaign_id),
          customer_id: str(p.customer_id),
          publisher: str(p.publisher),
          creative_id: str(p.creative_id),
          clicked: p.clicked === true,
          converted: p.converted === true,
          spend_amount_gbp: num(p.spend_amount_gbp),
          event_time: str(p.event_time),
        })
        break
      case 'wx':
        win.weather.push({
          city: str(p.city),
          temp_c: num(p.temp_c),
          condition: str(p.condition),
          precip_mm: num(p.precip_mm),
          event_time: str(p.event_time),
        })
        break
      case 'roi':
        win.roi.push({
          campaign_id: str(p.campaign_id),
          publisher: str(p.publisher),
          region: str(p.region),
          attributed_revenue_gbp: num(p.attributed_revenue_gbp),
          total_spend_gbp: num(p.total_spend_gbp),
          roi: num(p.roi),
          conversions: num(p.conversions),
          event_time: str(p.event_time),
        })
        break
    }
  }

  return win
}
