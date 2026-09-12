import { concepts } from '@/content/knowledge'
import type { Choice, ConceptId, DecisionRecord, Mastery, PlayerState } from '@/types'

/* ============================================================================
 * ADAPTIVE LEARNING
 *
 * Deliberately not an LLM. Mastery is an online estimate updated from observed
 * decisions, because a number that drives branching must be stable, explainable
 * and reproducible. The LLM's job is to *narrate* this model (see coach.ts),
 * not to be it.
 *
 * Update rule: exponentially-weighted move towards the target implied by the
 * decision quality, with a learning rate that decays as evidence accumulates,
 * scaled by how much the concept mattered in that decision.
 * ========================================================================== */

const TARGET: Record<Choice['quality'], number> = { best: 1, acceptable: 0.62, poor: 0.05 }

/** A returning employee: this is the output of the pre-episode baseline check. */
export const baselineMastery = (): Record<ConceptId, Mastery> => ({
  phishing: { score: 0.72, attempts: 3, correct: 2 },
  password_security: { score: 0.48, attempts: 2, correct: 1 },
  data_handling: { score: 0.41, attempts: 2, correct: 0 },
  approved_tools: { score: 0.55, attempts: 1, correct: 1 },
  incident_reporting: { score: 0.38, attempts: 1, correct: 0 },
  social_engineering: { score: 0.44, attempts: 2, correct: 1 },
  physical_security: { score: 0.5, attempts: 0, correct: 0 },
})

export function applyDecision(
  mastery: Record<ConceptId, Mastery>,
  choice: Choice,
): Record<ConceptId, Mastery> {
  const next = { ...mastery }
  const target = TARGET[choice.quality]
  // Primary concept carries the decision; secondary concepts move less.
  choice.knowledgeConcepts.forEach((c, i) => {
    const m = next[c]
    const weight = i === 0 ? 1 : 0.55
    const lr = (0.5 / (1 + m.attempts * 0.28)) * weight
    next[c] = {
      score: clamp01(m.score + lr * (target - m.score)),
      attempts: m.attempts + 1,
      correct: m.correct + (choice.quality === 'best' ? 1 : 0),
    }
  })
  return next
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Lowest demonstrated understanding, optionally restricted to a candidate set. */
export function weakestConcept(
  mastery: Record<ConceptId, Mastery>,
  among?: ConceptId[],
): ConceptId {
  const pool = among && among.length ? among : (Object.keys(mastery) as ConceptId[])
  return pool.reduce((worst, c) => (mastery[c].score < mastery[worst].score ? c : worst), pool[0])
}

export function strongestConcept(mastery: Record<ConceptId, Mastery>): ConceptId {
  const pool = Object.keys(mastery) as ConceptId[]
  return pool.reduce((best, c) => (mastery[c].score > mastery[best].score ? c : best), pool[0])
}

export const overallKnowledge = (mastery: Record<ConceptId, Mastery>) => {
  const ids = concepts.map((c) => c.id)
  // Attempted concepts count double: demonstrated beats assumed.
  let num = 0
  let den = 0
  for (const id of ids) {
    const m = mastery[id]
    const w = m.attempts > 0 ? 2 : 1
    num += m.score * w
    den += w
  }
  return num / den
}

/** Human-readable reason the engine chose a branch. Shown in the UI. */
export function adaptationRationale(
  mastery: Record<ConceptId, Mastery>,
  focus: ConceptId,
): string {
  const m = mastery[focus]
  const label = concepts.find((c) => c.id === focus)?.label ?? focus
  const pct = Math.round(m.score * 100)
  return m.attempts === 0
    ? `${label} is untested. Probing it now.`
    : `${label} is your weakest signal at ${pct}%. Raising the pressure there.`
}

export interface Growth {
  concept: ConceptId
  before: number
  after: number
}

export function growth(
  before: Record<ConceptId, Mastery>,
  after: Record<ConceptId, Mastery>,
): Growth[] {
  return concepts
    .map((c) => ({ concept: c.id, before: before[c.id].score, after: after[c.id].score }))
    .filter((g) => Math.abs(g.after - g.before) > 0.005)
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
}

/* ------------------------------------------------------ progression plumbing */

export const XP_PER_LEVEL = 450

export const levelFromXp = (xp: number) => Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1)
export const levelProgress = (xp: number) => (xp % XP_PER_LEVEL) / XP_PER_LEVEL

export function reputationStars(p: PlayerState): number {
  const best = p.decisions.filter((d) => d.quality === 'best').length
  const poor = p.decisions.filter((d) => d.quality === 'poor').length
  const base = 3 + best * 0.45 - poor * 0.6
  return Math.max(1, Math.min(5, Math.round(base * 2) / 2))
}

/** Episode score: starts from a neutral baseline, moved by the decisions made. */
export function episodeScore(decisions: DecisionRecord[]): number {
  if (!decisions.length) return 0
  const raw = decisions.reduce((s, d) => s + d.scoreImpact, 0)
  return Math.max(0, Math.min(100, Math.round(50 + raw * 1.75)))
}
