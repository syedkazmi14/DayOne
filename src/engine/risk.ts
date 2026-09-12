import type { ConceptId, Mastery, Scene } from '@/types'

/* ============================================================================
 * WAGER — virtual credits only.
 *
 * No real money, no deposits, no cash-out, no external wallet. Three fixed
 * bets the player can read at a glance: SAFE 1.2×, RISKY 2×, ALL IN 4×.
 *
 * The outcome is decided by the authored quality of the choice the player
 * makes — never by chance and never by a model. The mastery estimate is still
 * computed, but it is recorded silently and only revealed after the world
 * reacts, so the player prices their own confidence without being anchored.
 * Tier-implied confidence vs actual outcome feeds the calibration model
 * (src/engine/telemetry.ts).
 * ========================================================================== */

export type WagerTier = 'safe' | 'risky' | 'allin'

export interface WagerOption {
  tier: WagerTier
  label: string
  stake: number
  /** Total returned on a win: stake × multiplier. */
  reward: number
  multiplier: number
}

export const MULTIPLIER: Record<WagerTier, number> = { safe: 1.2, risky: 2, allin: 4 }

/** How sure each bet says the player is. Feeds calibration, never the payout. */
export const TIER_CONFIDENCE: Record<WagerTier, number> = { safe: 0.55, risky: 0.75, allin: 0.95 }

const LABEL: Record<WagerTier, string> = { safe: 'SAFE', risky: 'RISKY', allin: 'ALL IN' }

/** Share of the balance each tier puts at risk. */
const STAKE_SHARE: Record<WagerTier, number> = { safe: 0.1, risky: 0.3, allin: 1 }

/**
 * The mastery model's estimate that the player picks the best option. Hidden
 * before the bet, revealed after — derived from the same scores that drive
 * adaptation, not from a random number.
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

const round5 = (n: number) => Math.round(n / 5) * 5

export function wagerOptions(credits: number): WagerOption[] {
  let floor = 0
  return (['safe', 'risky', 'allin'] as const).map((tier) => {
    const raw = tier === 'allin' ? credits : Math.max(floor + 5, 10, round5(credits * STAKE_SHARE[tier]))
    const stake = Math.min(credits, raw)
    floor = stake
    return { tier, label: LABEL[tier], stake, multiplier: MULTIPLIER[tier], reward: Math.round(stake * MULTIPLIER[tier]) }
  })
}

export type WagerVerdict = 'win' | 'push' | 'loss'

/** Best answer pays. A defensible-but-incomplete answer returns the stake. */
export const resolveWager = (quality: 'best' | 'acceptable' | 'poor'): WagerVerdict =>
  quality === 'best' ? 'win' : quality === 'acceptable' ? 'push' : 'loss'

export const verdictHeadline = (v: WagerVerdict) =>
  v === 'win' ? 'YOU BEAT THE HOUSE' : v === 'push' ? 'THE HOUSE SPLIT IT' : 'THE HOUSE CALLED IT'
