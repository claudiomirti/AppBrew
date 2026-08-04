/**
 * Fabric data agent client.
 *
 * The agent speaks the Azure OpenAI Assistants protocol. The non-obvious part is that the
 * `assistant_id` on a run is NOT the data agent item id — you first POST /assistants to mint a
 * session-scoped assistant handle, and use that. Passing the item id makes every run fail with
 * `invalid_prompt`, which looks like a publishing problem but is not.
 *
 *   POST /assistants              -> assistant handle (cached for the page's lifetime)
 *   POST /threads                 -> conversation handle
 *   POST /threads/{id}/messages   -> the question
 *   POST /threads/{id}/runs       -> ask the agent to answer
 *   GET  /threads/{id}/runs/{run} -> poll until it leaves queued/in_progress
 *   GET  /threads/{id}/messages   -> newest assistant message
 *
 * api.fabric.microsoft.com returns permissive CORS headers, so the browser calls it directly
 * with the signed-in user's token — same pattern as the Eventhouse queries, no backend.
 */
import { AGENT_BASE_URL, AGENT_ID, AGENT_NAME, FABRIC_SCOPES } from './eventhouseConfig'
import { SignInRequiredError } from './authTypes'

export { AGENT_BASE_URL, AGENT_ID, AGENT_NAME }

/** Loaded lazily so MSAL stays out of the main bundle. */
const auth = () => import('./entraAuth')

/** Every call rejects the request without this. */
const API_VERSION = '2024-05-01-preview'

const url = (path: string) => `${AGENT_BASE_URL}${path}?api-version=${API_VERSION}`

/** A table lifted out of the agent's markdown answer, ready to chart. */
export interface AgentTable {
  columns: string[]
  rows: string[][]
  /** Index of the column charted as the bar value, or null when nothing is numeric. */
  valueColumn: number | null
  labelColumn: number
}

export interface AgentAnswer {
  text: string
  /** Prose with the markdown tables removed, so nothing is rendered twice. */
  prose: string
  tables: AgentTable[]
  /** Wall-clock time the agent took, for the demo narrative. */
  ms: number
  runStatus: string
}

export class AgentNotPublishedError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let token: string
  try {
    token = await (await auth()).getTokenQuiet(FABRIC_SCOPES)
  } catch (err) {
    if (err instanceof SignInRequiredError) throw err
    throw new SignInRequiredError((err as Error).message)
  }

  const res = await fetch(url(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // The service correlates its own telemetry on this; omitting it makes failures unsupportable.
      ActivityId: crypto.randomUUID(),
      ...(init?.headers ?? {}),
    },
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Fabric API ${res.status}: ${text.slice(0, 300)}`)
  }
  return (text ? JSON.parse(text) : {}) as T
}

interface IdResponse {
  id: string
}

interface RunResponse {
  id: string
  status: string
  last_error?: { code?: string; message?: string } | null
}

interface MessageList {
  data?: Array<{
    role: string
    created_at?: number
    content?: Array<{ text?: { value?: string } }>
  }>
}

let assistantPromise: Promise<string> | null = null

/** One assistant handle per page load is enough; minting one per question just adds latency. */
function getAssistantId(): Promise<string> {
  if (!assistantPromise) {
    assistantPromise = call<IdResponse>('/assistants', {
      method: 'POST',
      // The model is chosen by the data agent; this field is required but ignored.
      body: JSON.stringify({ model: 'not used' }),
    })
      .then(a => a.id)
      .catch(err => {
        assistantPromise = null
        throw err
      })
  }
  return assistantPromise
}

const NUMBER_RE = /^-?[\d,]+(\.\d+)?%?$/

export function parseNumber(cell: string): number | null {
  const cleaned = cell.replace(/[£$€\s]/g, '').replace(/,/g, '').replace(/%$/, '')
  if (cleaned === '' || !NUMBER_RE.test(cell.trim().replace(/[£$€\s]/g, ''))) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

const isDivider = (line: string) => /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line)
const splitRow = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

/**
 * The agent answers in markdown, so the only structured data on offer is whatever tables it
 * chose to emit. We lift those out and chart them rather than inventing numbers — if the answer
 * has no table, the page shows prose and nothing else.
 */
export function extractTables(markdown: string): { prose: string; tables: AgentTable[] } {
  const lines = markdown.split('\n')
  const tables: AgentTable[] = []
  const proseLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i]
    if (header.includes('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const columns = splitRow(header)
      const rows: string[][] = []
      let j = i + 2
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        const cells = splitRow(lines[j])
        if (cells.length > 1) rows.push(cells)
        j++
      }
      if (rows.length > 0) {
        // Chart the first column whose every cell parses as a number.
        let valueColumn: number | null = null
        for (let c = columns.length - 1; c >= 1; c--) {
          if (rows.every(r => parseNumber(r[c] ?? '') !== null)) valueColumn = c
        }
        tables.push({ columns, rows, valueColumn, labelColumn: 0 })
        i = j - 1
        continue
      }
    }
    proseLines.push(header)
  }

  return { prose: proseLines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), tables }
}

/**
 * The agent reuses one thread per user, so history accumulates server-side. We therefore
 * identify the answer by taking the newest assistant message rather than assuming position.
 */
export async function askAgent(question: string, signal?: AbortSignal): Promise<AgentAnswer> {
  const started = Date.now()

  const assistantId = await getAssistantId()
  const thread = await call<IdResponse>('/threads', { method: 'POST', body: '{}' })

  await call(`/threads/${thread.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role: 'user', content: question }),
  })

  const run = await call<RunResponse>(`/threads/${thread.id}/runs`, {
    method: 'POST',
    body: JSON.stringify({ assistant_id: assistantId }),
  })

  let status = run.status
  let lastError = run.last_error
  const deadline = Date.now() + 180_000

  while ((status === 'queued' || status === 'in_progress') && Date.now() < deadline) {
    if (signal?.aborted) throw new Error('cancelled')
    await new Promise(resolve => setTimeout(resolve, 1500))
    const polled = await call<RunResponse>(`/threads/${thread.id}/runs/${run.id}`)
    status = polled.status
    lastError = polled.last_error
  }

  if (status !== 'completed') {
    if (lastError?.code === 'invalid_prompt') {
      throw new AgentNotPublishedError(
        `The ${AGENT_NAME} agent rejected the request (invalid_prompt). Check that the agent is ` +
          'published in Fabric and that its data sources are still accessible to you.',
      )
    }
    throw new Error(`Run ${status}${lastError?.message ? `: ${lastError.message}` : ''}`)
  }

  const messages = await call<MessageList>(`/threads/${thread.id}/messages`)
  const answer = (messages.data ?? [])
    .filter(m => m.role === 'assistant')
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]

  const text = (answer?.content ?? [])
    .map(c => c.text?.value ?? '')
    .join('\n')
    .trim()

  const { prose, tables } = extractTables(text)

  return {
    text: text || '(the agent returned an empty answer)',
    prose: prose || (tables.length > 0 ? '' : text),
    tables,
    ms: Date.now() - started,
    runStatus: status,
  }
}
