import { knowledgeBase } from '@/content/knowledge'
import type { ConceptId, KnowledgeItem } from '@/types'

/* ============================================================================
 * RETRIEVAL — deterministic lexical search over the knowledge base.
 *
 * Small corpora do not need embeddings, and an offline demo should not need a
 * network call to stay grounded. This is a BM25-flavoured scorer over field-
 * weighted text, plus a boost for concepts that are live in the current scene.
 *
 * The contract that matters: retrieval decides what a character is ALLOWED to
 * say. If nothing clears the confidence floor, the character refuses.
 * ========================================================================== */

const STOP = new Set([
  'the','a','an','is','are','was','were','be','been','being','to','of','and','or','but','if','then','than','that','this','these','those','it','its','as','at','by','for','from','in','into','on','onto','with','without','about','so','do','does','did','doing','i','you','he','she','they','we','my','your','me','him','her','them','us','what','why','how','when','where','who','which','can','could','should','would','will','shall','may','might','must','not','no','yes','just','really','actually','okay','ok','know','think','tell','say','said','get','got','make','made','also','even','still','very','more','most','some','any','all','because','there','here','like','well','right','wrong',
  // Generic modifiers and numerals: high frequency in speech, no retrieval value,
  // and the main source of false-positive matches on off-topic questions.
  'new','old','one','two','three','other','same','different','many','much','few','little','long','short','big','small','good','bad','thing','things','stuff',
])

const STEM = (t: string) =>
  t
    .replace(/(ing|edly|edness)$/, '')
    .replace(/(ies)$/, 'y')
    .replace(/(sses)$/, 'ss')
    .replace(/([^s])s$/, '$1')
    .replace(/(ed|er|ly)$/, '')

export const tokenize = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .map(STEM)

/** Field weights: the normative statement matters most, prose least. */
const FIELDS: { pick: (k: KnowledgeItem) => string; w: number }[] = [
  { pick: (k) => k.rule, w: 3.0 },
  { pick: (k) => k.topic, w: 2.4 },
  { pick: (k) => k.commonMistake, w: 1.8 },
  { pick: (k) => k.edgeCases.join(' '), w: 1.8 },
  { pick: (k) => k.consequence, w: 1.4 },
  { pick: (k) => [...k.recommended, ...k.prohibited].join(' '), w: 1.6 },
  { pick: (k) => k.concepts.join(' ').replace(/_/g, ' '), w: 1.2 },
]

interface Indexed {
  item: KnowledgeItem
  tf: Map<string, number>
  len: number
}

const index: Indexed[] = knowledgeBase.map((item) => {
  const tf = new Map<string, number>()
  let len = 0
  for (const f of FIELDS) {
    for (const tok of tokenize(f.pick(item))) {
      tf.set(tok, (tf.get(tok) ?? 0) + f.w)
      len += f.w
    }
  }
  return { item, tf, len }
})

const avgLen = index.reduce((s, d) => s + d.len, 0) / index.length

const df = new Map<string, number>()
for (const d of index) for (const tok of d.tf.keys()) df.set(tok, (df.get(tok) ?? 0) + 1)

const idf = (tok: string) => {
  const n = df.get(tok) ?? 0
  return Math.log(1 + (index.length - n + 0.5) / (n + 0.5))
}

export interface Retrieved {
  item: KnowledgeItem
  score: number
  /** Which query terms actually matched — used by the inspector panel. */
  matched: string[]
}

export interface RetrievalResult {
  hits: Retrieved[]
  /** 0..1. Below CONFIDENCE_FLOOR the character must decline to answer. */
  confidence: number
  queryTerms: string[]
}

export const CONFIDENCE_FLOOR = 0.3

const K1 = 1.4
const B = 0.7

export function retrieve(
  query: string,
  opts: { activeConcepts?: ConceptId[]; k?: number } = {},
): RetrievalResult {
  const terms = tokenize(query)
  const active = new Set(opts.activeConcepts ?? [])
  const k = opts.k ?? 3

  const scored: Retrieved[] = index.map(({ item, tf, len }) => {
    let score = 0
    const matched: string[] = []
    for (const t of terms) {
      const f = tf.get(t)
      if (!f) continue
      matched.push(t)
      score += idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (len / avgLen))))
    }
    // Scene-context boost: knowledge relevant to what is happening right now.
    if (active.size) {
      const overlap = item.concepts.filter((c) => active.has(c)).length
      score *= 1 + 0.22 * overlap
    }
    // Severity tilt — a tiebreaker only. Kept deliberately small: at 10% it
    // overturned genuine lexical wins (a data rule outranking the tool-approval
    // rule on "how do I get a tool approved").
    const sev = { critical: 1.03, high: 1.015, medium: 1, low: 0.99 }[item.severity]
    return { item, score: score * sev, matched }
  })

  scored.sort((a, b) => b.score - a.score)
  const hits = scored.filter((h) => h.score > 0).slice(0, k)

  /* Confidence gates whether a character is allowed to answer at all, so it has
   * to punish accidental matches. Three signals:
   *   strength  — how well the best rule scored
   *   coverage  — how much of the answerable question it explains
   *   oov       — query terms absent from the corpus entirely, the clearest
   *               signal that the player has asked about something else
   * A single coincidental term match ("that machine", "the new one") is damped
   * so the character declines instead of confidently answering the wrong rule. */
  const known = terms.filter((t) => df.has(t))
  const oovRatio = terms.length ? 1 - known.length / terms.length : 1
  const matchedTop = hits[0]?.matched.length ?? 0
  const strength = Math.min(1, (hits[0]?.score ?? 0) / 9)
  const coverage = known.length ? matchedTop / known.length : 0
  const thinMatch = matchedTop < 2 ? 0.72 : 1
  const confidence = Math.max(
    0,
    Math.min(1, (strength * 0.55 + coverage * 0.45) * (1 - oovRatio * 0.9) * thinMatch),
  )

  return { hits, confidence, queryTerms: terms }
}
