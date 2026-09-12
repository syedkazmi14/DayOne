import type { ConceptId, Mastery, Scene } from '@/types'

/* ============================================================================
 * RISK TERMINAL — virtual credits only.
 *
 * No real money, no deposits, no cash-out, no external wallet. Credits exist
 * for exactly one reason: to force the player to price their own confidence
 * before they answer. The estimate they are betting against is their own
 * mastery model, so a bad bet is informative rather than punitive.
 * ========================================================================== */

export type WagerTier = 'safe' | 'risky' | 'allin'

export interface WagerOption {
  tier: WagerTier
  label: string
  stake: number
  reward: number
  blurb: string
}

/**
 * The house's estimate that the player will pick the best option — derived from
 * the same mastery model that drives adaptation, not from a random number.
 */
export function estimateSuccess(
  scene: Scene,
  mastery: Record<ConceptId, Mastery>,
): { p: number; drivers: { concept: ConceptId; score: number }[] } {
  const cs = [...new Set((scene.choices ?? []).flatMap((c) => c.knowledgeConcepts))]
  const drivers = cs.map((c) => ({ concept: c, score: mastery[c].score }))
  if (!drivers.length) return { p: 0.5, drivers }
  // Weakest concept dominates: a scenario is as hard as its hardest component.
  const min = Math.min(...drivers.map((d) => d.score))
  const mean = drivers.reduce((s, d) => s + d.score, 0) / drivers.length
  const raw = 0.62 * min + 0.38 * mean
  // Compress towards the middle — the model is never certain about a person.
  const p = 0.16 + raw * 0.7
  return { p: Math.round(p * 100) / 100, drivers }
}

export function wagerOptions(credits: number, p: number): WagerOption[] {
  const safe = Math.max(25, Math.round((credits * 0.04) / 5) * 5)
  const risky = Math.max(safe * 3, Math.round((credits * 0.16) / 5) * 5)
  // Fair-odds inverse of the estimate, minus a small edge. Long shots pay more.
  const mult = (stakeFactor: number) => 1 + (1 / Math.max(0.18, p) - 1) * stakeFactor
  return [
    {
      tier: 'safe',
      label: 'SAFE',
      stake: safe,
      reward: Math.round(safe * mult(0.55)),
      blurb: 'Low exposure. You are fairly sure.',
    },
    {
      tier: 'risky',
      label: 'RISKY',
      stake: Math.min(risky, credits),
      reward: Math.round(Math.min(risky, credits) * mult(0.95)),
      blurb: 'You have read the situation and you trust it.',
    },
    {
      tier: 'allin',
      label: 'ALL IN',
      stake: credits,
      reward: Math.round(credits * mult(1.45)),
      blurb: 'Total conviction. No hedge.',
    },
  ]
}

export type WagerVerdict = 'win' | 'push' | 'loss'

/** Best answer pays. A defensible-but-incomplete answer returns the stake. */
export const resolveWager = (quality: 'best' | 'acceptable' | 'poor'): WagerVerdict =>
  quality === 'best' ? 'win' : quality === 'acceptable' ? 'push' : 'loss'

export const verdictHeadline = (v: WagerVerdict) =>
  v === 'win' ? 'YOU BEAT THE HOUSE' : v === 'push' ? 'THE HOUSE SPLIT IT' : 'THE HOUSE CALLED IT'
