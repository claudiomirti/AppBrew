/**
 * Sentiment scoring for news and web passages.
 *
 * Web IQ returns no sentiment field, and this app is a static site with nowhere to run a
 * model, so scoring happens here in the browser. This is a weighted lexicon tuned for
 * coffee retail and the financial press rather than a general-purpose one — "beat",
 * "comp growth" and "boycott" carry very different weight in this domain than in prose.
 *
 * It is deliberately explainable: every score comes back with the terms that produced it
 * so the UI can show its working, and every article links out so a human can check.
 */

export type SentimentLabel = 'positive' | 'neutral' | 'negative'

export interface SentimentResult {
  score: number
  label: SentimentLabel
  confidence: number
  /** Terms that fired, with their post-modifier contribution, strongest first. */
  matches: { term: string; weight: number; negated: boolean }[]
}

/** Weights are roughly -3..+3; multi-word entries are matched as phrases. */
const LEXICON: Record<string, number> = {
  // — financial performance, positive
  beat: 2, beats: 2, exceeded: 2, outperform: 2.5, outperformed: 2.5, upgrade: 2.5,
  upgraded: 2.5, rally: 2, rallied: 2, surge: 2.5, surged: 2.5, jumped: 2, soared: 3,
  rebound: 2, rebounded: 2, record: 2, growth: 1.5, grew: 1.5, grow: 1.5, grows: 1.5,
  growing: 1.5, rose: 1.2, rise: 1.2, rising: 1.2, increase: 1.2, increased: 1.2,
  improve: 1.5, improved: 1.5, improving: 1.5, recovery: 1.5, gains: 1.5,
  profit: 1.5, profitable: 2, strong: 1.5, robust: 2, momentum: 1.5, expansion: 1.5,
  expanding: 1.5, 'margin expansion': 2.5, 'comp growth': 2.5, 'same-store sales': 1,
  raised: 1.5, boost: 1.5, boosted: 1.5, optimistic: 2, bullish: 2.5, buy: 1.2,
  // — financial performance, negative
  miss: -2, missed: -2, misses: -2, downgrade: -2.5, downgraded: -2.5, slump: -2.5,
  slumped: -2.5, plunge: -3, plunged: -3, tumble: -2.5, tumbled: -2.5, fell: -1.5,
  falls: -1.5, decline: -2, declined: -2, declining: -2, drop: -1.5, dropped: -1.5,
  loss: -2, losses: -2, weak: -1.8, weakness: -1.8, sluggish: -2, disappointing: -2.5,
  disappointed: -2.5, warned: -2, warning: -2, cut: -1.5, cuts: -1.5, bearish: -2.5,
  sell: -1.2, underperform: -2.5, slowdown: -2, headwinds: -1.8, pressure: -1.2,
  // — brand, reputation and operations
  boycott: -3, boycotts: -3, strike: -2.5, strikes: -2.5, striking: -2.5, walkout: -2.5,
  union: -0.8, unionize: -1.2, unionized: -1.2, lawsuit: -2.5, sued: -2.5, sues: -2.5,
  probe: -2, investigation: -2, backlash: -2.8, criticism: -2, criticized: -2,
  controversy: -2.2, protest: -2.2, protests: -2.2, recall: -2.5, closures: -2.2,
  closing: -1.8, layoffs: -2.5, 'job cuts': -2.5, fired: -1.8, resign: -1.5,
  resigned: -1.5, 'stepped down': -1.5, scandal: -3, fine: -1.5, fined: -2,
  complaint: -1.8, complaints: -1.8, outage: -1.8, shortage: -1.8, apologized: -1.2,
  // — brand, positive
  loyalty: 1.2, rewards: 1, popular: 1.5, favourite: 1.8, favorite: 1.8, praised: 2.2,
  award: 2, awarded: 2, celebrated: 1.8, partnership: 1.2, launch: 1, launches: 1,
  innovation: 1.5, innovative: 1.5, sustainability: 1.2, viral: 1.2, hit: 1.2,
  acclaimed: 2.2, 'best-selling': 2, bestselling: 2, delicious: 1.8, refreshing: 1.5,
  // — pricing, cuts both ways in retail coverage
  'price increase': -1.5, 'price hike': -2, expensive: -1.5, overpriced: -2.2,
  affordable: 1.2, discount: 0.8, deal: 0.8, value: 0.8,
}

/** Words that flip the sense of a term appearing shortly after them. */
const NEGATORS = new Set([
  'not', 'no', 'never', 'without', 'lacks', 'lacking', 'fails', 'failed', 'failing',
  'cannot', "can't", "won't", "didn't", "doesn't", "isn't", "wasn't", "aren't", 'nor',
  'unable', 'denies', 'denied', 'avoid', 'avoids', 'less', 'fewer',
])

const INTENSIFIERS: Record<string, number> = {
  very: 1.5, sharply: 1.6, significantly: 1.5, substantially: 1.5, hugely: 1.7,
  massively: 1.7, extremely: 1.8, deeply: 1.5, badly: 1.5, steeply: 1.6, strongly: 1.5,
  slightly: 0.5, somewhat: 0.6, marginally: 0.5, modestly: 0.6, mildly: 0.5,
}

/** Words back from a term that a negator or intensifier can still reach. */
const MODIFIER_WINDOW = 3

const PHRASES = Object.keys(LEXICON)
  .filter(k => k.includes(' ') || k.includes('-'))
  .sort((a, b) => b.length - a.length)

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/**
 * Score a passage. Longer texts naturally accumulate more hits, so the raw total is
 * squashed rather than averaged — averaging would let one neutral sentence dilute a
 * genuinely damning headline.
 *
 * Repeated terms get diminishing returns. Without that, an article saying "strike" six
 * times pins at exactly -1.00, and so does every other strike story, which destroys any
 * useful ranking between them.
 */
export function scoreSentiment(text: string): SentimentResult {
  if (!text) return { score: 0, label: 'neutral', confidence: 0, matches: [] }

  const lower = text.toLowerCase()
  /** term -> { weight per occurrence, occurrences, negated } */
  const hits = new Map<string, { weight: number; count: number; negated: boolean }>()

  const record = (term: string, weight: number, negated: boolean) => {
    const existing = hits.get(term)
    if (existing) {
      existing.count++
      // Keep the strongest reading of a term that appears both negated and not.
      if (Math.abs(weight) > Math.abs(existing.weight)) {
        existing.weight = weight
        existing.negated = negated
      }
    } else {
      hits.set(term, { weight, count: 1, negated })
    }
  }

  // Phrases first, so "price increase" doesn't also score as bare "increase".
  let working = lower
  for (const phrase of PHRASES) {
    let idx = working.indexOf(phrase)
    while (idx !== -1) {
      record(phrase, LEXICON[phrase], false)
      working = working.slice(0, idx) + ' '.repeat(phrase.length) + working.slice(idx + phrase.length)
      idx = working.indexOf(phrase)
    }
  }

  const tokens = tokenize(working)
  tokens.forEach((token, i) => {
    const base = LEXICON[token]
    if (base === undefined) return

    let weight = base
    let negated = false
    for (let back = 1; back <= MODIFIER_WINDOW && i - back >= 0; back++) {
      const prev = tokens[i - back]
      if (NEGATORS.has(prev)) negated = true
      const intensity = INTENSIFIERS[prev]
      if (intensity !== undefined) weight *= intensity
    }
    // Negation dampens as well as flips: "not strong" is mildly bad, not strongly bad.
    if (negated) weight = -weight * 0.7

    record(token, weight, negated)
  })

  let raw = 0
  const matches: SentimentResult['matches'] = []
  for (const [term, hit] of hits) {
    // 1 occurrence = 1x, 4 = ~1.6x, 10 = 2x. Repetition is evidence, not proportional.
    const contribution = hit.weight * (1 + Math.log10(hit.count))
    raw += contribution
    matches.push({ term, weight: contribution, negated: hit.negated })
  }

  const score = Math.tanh(raw / 6)
  const label: SentimentLabel = score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral'
  // More corroborating distinct terms => more trustworthy, saturating around six.
  const confidence = hits.size === 0 ? 0 : Math.min(1, hits.size / 6)

  matches.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
  return { score, label, confidence, matches: matches.slice(0, 8) }
}

export const SENTIMENT_COLORS: Record<SentimentLabel, string> = {
  positive: '#4ecdc4',
  neutral: '#94a3b8',
  negative: '#ff6b6b',
}
