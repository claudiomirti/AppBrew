/**
 * Dev-server proxy that lets the browser query the Fabric Eventhouse (Kusto) directly.
 *
 * The browser cannot mint an Entra token on its own without an app registration, so this
 * plugin borrows the developer's existing Azure CLI login (`az account get-access-token`)
 * and forwards KQL to the cluster's REST API.
 *
 * Routes:
 *   GET  /api/kql/info  -> { cluster, database, connected, identity }
 *   POST /api/kql       -> { columns, rows } | { error }
 *
 * Only active under `vite dev` / `vite preview`. A production build has no proxy, so the
 * Stream Analytics page falls back to its in-browser simulator.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Connect, Plugin } from 'vite'

const execFileAsync = promisify(execFile)

const CLUSTER = process.env.KUSTO_CLUSTER
  ?? 'https://trd-t1s1uap7p3xkuvdx9s.z8.kusto.fabric.microsoft.com'
const DATABASE = process.env.KUSTO_DATABASE ?? 'mybrew_eventhouse'

/** Node refuses to spawn the `az.cmd` shim directly on Windows, so go through cmd.exe. */
const AZ_COMMAND = process.platform === 'win32' ? 'cmd.exe' : 'az'
const AZ_PREFIX = process.platform === 'win32' ? ['/c', 'az'] : []

interface CachedToken { token: string; expiresAt: number; identity: string }
let cached: CachedToken | null = null

async function getToken(): Promise<CachedToken> {
  // Refresh a minute early so a long query never runs into an expiring token.
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached

  const { stdout } = await execFileAsync(
    AZ_COMMAND,
    [...AZ_PREFIX, 'account', 'get-access-token', '--resource', CLUSTER, '-o', 'json'],
    { maxBuffer: 4 * 1024 * 1024 },
  )
  const parsed = JSON.parse(stdout) as {
    accessToken: string
    expiresOn?: string
    expires_on?: number
  }

  // `expiresOn` is local time without a zone; `expires_on` is a reliable epoch. Prefer it.
  const expiresAt = parsed.expires_on
    ? parsed.expires_on * 1000
    : Date.parse(parsed.expiresOn ?? '') || Date.now() + 30 * 60_000

  // The token's `upn`/`unique_name` claim is only used to display who the page is querying as.
  let identity = 'unknown'
  try {
    const claims = JSON.parse(
      Buffer.from(parsed.accessToken.split('.')[1], 'base64').toString('utf8'),
    ) as Record<string, string>
    identity = claims.upn ?? claims.unique_name ?? claims.appid ?? 'unknown'
  } catch {
    /* claim parsing is best-effort */
  }

  cached = { token: parsed.accessToken, expiresAt, identity }
  return cached
}

function send(res: Parameters<Connect.NextHandleFunction>[1], status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req: Parameters<Connect.NextHandleFunction>[0]): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const middleware: Connect.NextHandleFunction = async (req, res, next) => {
  const url = req.url ?? ''
  if (!url.startsWith('/api/kql')) return next()

  if (url.startsWith('/api/kql/info')) {
    try {
      const { identity } = await getToken()
      return send(res, 200, { cluster: CLUSTER, database: DATABASE, connected: true, identity })
    } catch (err) {
      return send(res, 200, {
        cluster: CLUSTER,
        database: DATABASE,
        connected: false,
        error: `Azure CLI login required: ${(err as Error).message}`,
      })
    }
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' })

  try {
    const { csl } = JSON.parse(await readBody(req)) as { csl?: string }
    if (!csl) return send(res, 400, { error: 'Missing "csl" in request body' })

    const { token } = await getToken()
    const upstream = await fetch(`${CLUSTER}/v1/rest/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ db: DATABASE, csl }),
    })

    const text = await upstream.text()
    if (!upstream.ok) {
      return send(res, upstream.status, { error: `Kusto ${upstream.status}: ${text.slice(0, 600)}` })
    }

    // v1 responses put the query result in the first table; the rest is telemetry.
    const primary = (JSON.parse(text) as { Tables: Array<{ Columns: Array<{ ColumnName: string }>; Rows: unknown[][] }> }).Tables[0]
    return send(res, 200, {
      columns: primary.Columns.map(c => c.ColumnName),
      rows: primary.Rows,
    })
  } catch (err) {
    return send(res, 500, { error: (err as Error).message })
  }
}

export function kqlProxy(): Plugin {
  return {
    name: 'mybrew-kql-proxy',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) },
  }
}
