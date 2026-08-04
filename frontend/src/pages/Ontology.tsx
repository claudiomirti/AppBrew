import { useCallback, useMemo, useRef, useState } from 'react'
import ontology from '../data/ontology.json'
import {
  AgentNotPublishedError,
  askAgent,
  parseNumber,
  AGENT_NAME,
  type AgentTable,
} from '../lib/fabricAgent'
import { SignInRequiredError, signIn } from '../lib/eventhouse'

interface OntologyProperty {
  name: string
  valueType: string
  sourceColumn: string | null
}

interface OntologyEntity {
  id: string
  name: string
  namespaceType: string
  idParts: string[]
  sourceTable: string | null
  properties: OntologyProperty[]
}

interface OntologyRelationship {
  id: string
  name: string
  sourceId: string
  targetId: string
}

const entities = ontology.entities as OntologyEntity[]
const relationships = ontology.relationships as OntologyRelationship[]

const byId = new Map(entities.map(e => [e.id, e]))

/** Facts carry the measures; dimensions describe them. Drives colour and ring placement. */
function kindOf(entity: OntologyEntity): 'fact' | 'dimension' | 'unbound' {
  if (!entity.sourceTable) return 'unbound'
  return entity.sourceTable.startsWith('fact') ? 'fact' : 'dimension'
}

/**
 * Nodes that take part in at least one relationship are laid out on a circle; everything else
 * is listed separately rather than left floating, because an isolated node on a graph reads as
 * a rendering bug when it is actually a modelling gap.
 */
const linkedIds = new Set(relationships.flatMap(r => [r.sourceId, r.targetId]))
const linked = entities.filter(e => linkedIds.has(e.id))
const isolated = entities.filter(e => !linkedIds.has(e.id))

const RX = 370
const RY = 225
const CENTRE = { x: 520, y: 320 }
const NODE_W = 154
const NODE_H = 46

const positions = new Map(
  linked.map((entity, index) => {
    // Start at the top and go clockwise so the layout is stable across reloads.
    const angle = (index / linked.length) * Math.PI * 2 - Math.PI / 2
    return [
      entity.id,
      { x: CENTRE.x + RX * Math.cos(angle), y: CENTRE.y + RY * Math.sin(angle) },
    ]
  }),
)

/**
 * Stop an edge at the node's border instead of its centre, otherwise the arrowheads disappear
 * underneath the boxes and the direction of the relationship is lost.
 */
function edgePoint(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (dx === 0 && dy === 0) return from
  const hw = NODE_W / 2 + 6
  const hh = NODE_H / 2 + 6
  const t = Math.min(
    dx === 0 ? Infinity : hw / Math.abs(dx),
    dy === 0 ? Infinity : hh / Math.abs(dy),
  )
  return { x: from.x + dx * t, y: from.y + dy * t }
}

const SUGGESTED = [
  'Show total revenue by loyalty tier as a table',
  'Show spend and conversions by campaign as a table',
  'Which products sell the most, by units? Show a table',
  'Show revenue by store city as a table',
]

/**
 * The agent answers in prose with markdown tables. A table with one numeric column is worth
 * charting; anything else is shown as a table, because guessing at a chart from data we do not
 * understand produces confident nonsense.
 */
function AgentChart({ table }: { table: AgentTable }) {
  const { columns, rows, valueColumn, labelColumn } = table

  const bars = useMemo(() => {
    if (valueColumn == null) return null
    const parsed = rows.map(r => ({
      label: r[labelColumn] ?? '',
      value: parseNumber(r[valueColumn] ?? '') ?? 0,
      raw: r[valueColumn] ?? '',
    }))
    const max = Math.max(...parsed.map(p => Math.abs(p.value)), 0)
    if (max === 0) return null
    return parsed.map(p => ({ ...p, pct: (Math.abs(p.value) / max) * 100 }))
  }, [rows, valueColumn, labelColumn])

  return (
    <div className="agent-viz">
      {bars && (
        <div className="agent-bars">
          <p className="agent-viz-title">
            {columns[valueColumn!]} by {columns[labelColumn]}
          </p>
          {bars.map((b, i) => (
            <div className="agent-bar-row" key={`${b.label}-${i}`}>
              <span className="agent-bar-label" title={b.label}>{b.label}</span>
              <span className="agent-bar-track">
                <span className="agent-bar-fill" style={{ width: `${b.pct}%` }} />
              </span>
              <span className="agent-bar-value">{b.raw}</span>
            </div>
          ))}
        </div>
      )}

      <table className="onto-props agent-table">
        <thead>
          <tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((_, c) => (
                <td key={c} className={c === valueColumn ? 'cell-num' : undefined}>
                  {r[c] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface ChatTurn {
  question: string
  answer?: string
  prose?: string
  tables?: AgentTable[]
  error?: string
  ms?: number
  pending?: boolean
}

export default function Ontology() {
  const [selected, setSelected] = useState<string | null>(linked[0]?.id ?? null)
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const abort = useRef<AbortController | null>(null)

  const entity = selected ? byId.get(selected) : undefined

  const relationsFor = useMemo(() => {
    if (!selected) return []
    return relationships
      .filter(r => r.sourceId === selected || r.targetId === selected)
      .map(r => ({
        name: r.name,
        other: byId.get(r.sourceId === selected ? r.targetId : r.sourceId)?.name ?? '?',
        outgoing: r.sourceId === selected,
      }))
  }, [selected])

  const ask = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setQuestion('')
    setBusy(true)
    setTurns(prev => [...prev, { question: trimmed, pending: true }])

    abort.current = new AbortController()
    try {
      const answer = await askAgent(trimmed, abort.current.signal)
      setNeedsSignIn(false)
      setTurns(prev =>
        prev.map((t, i) =>
          i === prev.length - 1
            ? {
                ...t,
                pending: false,
                answer: answer.text,
                prose: answer.prose,
                tables: answer.tables,
                ms: answer.ms,
              }
            : t,
        ),
      )
    } catch (err) {
      if (err instanceof SignInRequiredError) setNeedsSignIn(true)
      const message =
        err instanceof SignInRequiredError
          ? 'Sign in to ask the data agent.'
          : err instanceof AgentNotPublishedError
            ? err.message
            : (err as Error).message
      setTurns(prev =>
        prev.map((t, i) => (i === prev.length - 1 ? { ...t, pending: false, error: message } : t)),
      )
    } finally {
      setBusy(false)
    }
  }, [busy])

  return (
    <div>
      <h1 className="page-title">🧠 Business Context</h1>

      <p className="page-intro">
        The <code>MybrewOnto</code> ontology is the shared business vocabulary sitting on top of{' '}
        <code>{ontology.lakehouse}</code>: {entities.length} entity types joined by{' '}
        {relationships.length} relationships. The <code>AgentBrew</code> data agent answers
        questions against that model, so you ask in business language rather than SQL.
      </p>

      <div className="chart-card full-width onto-graph-card">
        <h3>Entity graph</h3>
        <div className="onto-graph-scroll">
        <svg className="onto-graph" viewBox="0 0 1040 640" role="img" aria-label="Ontology entity graph">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#5a5a7a" />
            </marker>
            <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#4ecdc4" />
            </marker>
          </defs>

          {relationships.map(rel => {
            const a = positions.get(rel.sourceId)
            const b = positions.get(rel.targetId)
            if (!a || !b) return null
            const active = selected === rel.sourceId || selected === rel.targetId
            const start = edgePoint(a, b)
            const end = edgePoint(b, a)
            return (
              <g key={rel.id} className={active ? 'onto-edge active' : 'onto-edge'}>
                <line
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  markerEnd={active ? 'url(#arrow-active)' : 'url(#arrow)'}
                />
                <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 6} textAnchor="middle">
                  {rel.name}
                </text>
              </g>
            )
          })}

          {linked.map(node => {
            const p = positions.get(node.id)
            if (!p) return null
            return (
              <g
                key={node.id}
                className={`onto-node ${kindOf(node)}${selected === node.id ? ' selected' : ''}`}
                transform={`translate(${p.x},${p.y})`}
                onClick={() => setSelected(node.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') setSelected(node.id)
                }}
              >
                <rect x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx={10} />
                <text className="onto-node-name" dy="-1">{node.name}</text>
                <text className="onto-node-sub" dy="13">
                  {node.properties.length} fields
                </text>
              </g>
            )
          })}
        </svg>
        </div>
        <p className="chart-legend-note">
          <span className="swatch fact" /> fact (measures) &nbsp;
          <span className="swatch dim" /> dimension (context) &nbsp; · click a node to inspect it
          below
        </p>
      </div>

      <div className="onto-grid">
        <div className="chart-card">
          <h3>{entity ? entity.name : 'Select an entity'}</h3>
          {entity && (
            <>
              <p className="onto-meta">
                bound to <code>{entity.sourceTable ?? 'no table'}</code>
                {entity.idParts.length > 0 && (
                  <> · key <code>{entity.idParts.join(', ')}</code></>
                )}
                {' · '}
                {entity.namespaceType.toLowerCase()}
              </p>

              {relationsFor.length > 0 && (
                <ul className="onto-rels">
                  {relationsFor.map(r => (
                    <li key={`${r.name}-${r.other}`}>
                      {r.outgoing ? '→' : '←'} <strong>{r.name}</strong> {r.other}
                    </li>
                  ))}
                </ul>
              )}

              <table className="onto-props">
                <thead>
                  <tr><th>Property</th><th>Type</th><th>Column</th></tr>
                </thead>
                <tbody>
                  {entity.properties.map(p => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td className="cell-sub">{p.valueType}</td>
                      <td className="cell-sub">{p.sourceColumn ?? '—'}</td>
                    </tr>
                  ))}
                  {entity.properties.length === 0 && (
                    <tr><td colSpan={3} className="cell-sub">No properties defined yet.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>

        {isolated.length > 0 && (
          <div className="chart-card">
            <h3>Not yet connected</h3>
            <p className="chart-note">
              These entity types exist in the ontology but have no relationships, so the agent
              cannot reason across them. Worth wiring up before a demo that leans on them.
            </p>
            <ul className="onto-rels">
              {isolated.map(e => (
                <li key={e.id}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setSelected(e.id)}>
                    {e.name}
                  </button>{' '}
                  <span className="cell-sub">
                    {e.sourceTable ? `bound to ${e.sourceTable}` : 'no data binding'} ·{' '}
                    {e.properties.length} properties
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="chart-card full-width">
        <h3>Ask {AGENT_NAME}</h3>
        <p className="chart-note">
          Questions run against the Fabric data agent <code>{AGENT_NAME}</code>, grounded on the{' '}
          <code>Mybrew Marketing Model</code> semantic model over the same lakehouse as the
          ontology above, using your own Entra identity — so you only ever see data you are
          allowed to see. Tables in the answer are charted below.
        </p>

        <div className="agent-suggestions">
          {SUGGESTED.map(s => (
            <button key={s} className="btn btn-sm btn-ghost" disabled={busy} onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>

        {needsSignIn && (
          <div className="conn-error signin">
            <strong>Sign in to ask the data agent.</strong>{' '}
            <span className="conn-dim">
              A popup is used so you keep this page and your conversation.
            </span>
            <div className="conn-error-actions">
              <button
                className="btn btn-sm"
                onClick={async () => {
                  try {
                    await signIn()
                    setNeedsSignIn(false)
                  } catch (err) {
                    setTurns(prev => [
                      ...prev,
                      { question: 'sign in', error: (err as Error).message },
                    ])
                  }
                }}
              >
                Sign in with Entra
              </button>
            </div>
          </div>
        )}

        <form
          className="agent-form"
          onSubmit={e => {
            e.preventDefault()
            ask(question)
          }}
        >
          <input
            className="agent-input"
            placeholder="Ask about campaigns, stores, customers, revenue…"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            disabled={busy}
          />
          <button className="btn btn-sm" type="submit" disabled={busy || !question.trim()}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </form>

        <div className="agent-thread">
          {turns.length === 0 && (
            <p className="idle-note">
              No questions yet. <code>{AGENT_NAME}</code> answers over{' '}
              <code>{ontology.lakehouse}</code> — the same {entities.length} entity types the{' '}
              <code>MybrewOnto</code> ontology describes above.
            </p>
          )}
          {turns.map((turn, i) => (
            <div key={i} className="agent-turn">
              <p className="agent-q">{turn.question}</p>
              {turn.pending && <p className="agent-a pending">Querying the model…</p>}
              {turn.prose && <p className="agent-a">{turn.prose}</p>}
              {turn.tables?.map((t, ti) => <AgentChart key={ti} table={t} />)}
              {turn.ms != null && !turn.error && (
                <p className="agent-meta cell-sub">
                  answered in {(turn.ms / 1000).toFixed(1)}s
                  {turn.tables && turn.tables.length > 0
                    ? ` · ${turn.tables.reduce((n, t) => n + t.rows.length, 0)} rows`
                    : ''}
                </p>
              )}
              {turn.error && <p className="agent-a error">{turn.error}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
