import type { DecisionRecord, ThreatProfile } from '@/types'
import { TIER_CONFIDENCE } from './risk'

/* ============================================================================
 * RUN TELEMETRY — what the decisions actually show, measured deterministically.
 *
 * The coach narrates this; it does not compute it. Every number here comes from
 * the decision log: authored choice quality, the scene's threat profile, time to
 * decide, and the bet placed. Nothing is inferred by a model.
 * ========================================================================== */

export interface RateStat {
  correct: number
  total: number
  /** null when the category was never observed — absent evidence is not 0%. */
  rate: number | null
}

const stat = (ds: DecisionRecord[]): RateStat => {
  const correct = ds.filter((d) => d.quality === 'best').length
  return { correct, total: ds.length, rate: ds.length ? correct / ds.length : null }
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

/* -------------------------------------------------------------- calibration */

export type CalibrationVerdict = 'overconfident' | 'underconfident' | 'calibrated' | 'no_data'

export interface Calibration {
  bets: number
  skipped: number
  /** Mean confidence implied by the tiers chosen. */
  meanConfidence: number | null
  /** Mean outcome on bet decisions: best 1, acceptable 0.5, poor 0. */
  hitRate: number | null
  /** meanConfidence − hitRate. Positive = bet bigger than performance earned. */
  gap: number | null
  brier: number | null
  verdict: CalibrationVerdict
}

const OUTCOME = { best: 1, acceptable: 0.5, poor: 0 } as const
const CALIBRATION_BAND = 0.15

export function calibration(decisions: DecisionRecord[]): Calibration {
  const bets = decisions.filter((d) => d.wager)
  const skipped = decisions.length - bets.length
  if (!bets.length)
    return { bets: 0, skipped, meanConfidence: null, hitRate: null, gap: null, brier: null, verdict: 'no_data' }

  const conf = bets.map((d) => TIER_CONFIDENCE[d.wager!.tier])
  const out = bets.map((d) => OUTCOME[d.quality])
  const meanConfidence = mean(conf)!
  const hitRate = mean(out)!
  const gap = meanConfidence - hitRate
  const brier = mean(conf.map((c, i) => (c - out[i]) ** 2))!
  const verdict: CalibrationVerdict =
    gap > CALIBRATION_BAND ? 'overconfident' : gap < -CALIBRATION_BAND ? 'underconfident' : 'calibrated'
  return { bets: bets.length, skipped, meanConfidence, hitRate, gap, brier, verdict }
}

/* ----------------------------------------------------------------- weakness */

export type WeaknessId = 'trusts_known_people' | 'external_lures' | 'authority_pressure' | 'overconfidence' | 'urgency'

export interface Weakness {
  id: WeaknessId
  headline: string
  evidence: string
}

export interface RunTelemetry {
  accuracy: RateStat
  bySource: Record<ThreatProfile['source'], RateStat>
  byPressure: Record<ThreatProfile['pressure'], RateStat>
  meanMs: number | null
  authorityMs: number | null
  otherMs: number | null
  /** Positive = slower when authority pressure was present. null if either side unobserved. */
  authoritySlowdownMs: number | null
  calibration: Calibration
  weakness: Weakness | null
}

/** Two rates must differ by at least this much before it counts as a pattern. */
const SEPARATION = 0.2

export const pct = (r: number) => `${Math.round(r * 100)}%`

export function analyseRun(decisions: DecisionRecord[]): RunTelemetry {
  const tagged = decisions.filter((d) => d.threat)
  const where = (f: (t: ThreatProfile) => boolean) => tagged.filter((d) => f(d.threat!))

  const bySource = {
    external: stat(where((t) => t.source === 'external')),
    internal: stat(where((t) => t.source === 'internal')),
  }
  const byPressure = {
    authority: stat(where((t) => t.pressure === 'authority')),
    urgency: stat(where((t) => t.pressure === 'urgency')),
    peer: stat(where((t) => t.pressure === 'peer')),
    none: stat(where((t) => t.pressure === 'none')),
  }

  const authorityDs = where((t) => t.pressure === 'authority')
  const otherDs = where((t) => t.pressure !== 'authority')
  const authorityMs = mean(authorityDs.map((d) => d.msToDecide))
  const otherMs = mean(otherDs.map((d) => d.msToDecide))
  const cal = calibration(decisions)

  return {
    accuracy: stat(decisions),
    bySource,
    byPressure,
    meanMs: mean(decisions.map((d) => d.msToDecide)),
    authorityMs,
    otherMs,
    authoritySlowdownMs: authorityMs !== null && otherMs !== null ? authorityMs - otherMs : null,
    calibration: cal,
    weakness: pickWeakness(bySource, byPressure.authority, stat(otherDs), byPressure.urgency, cal),
  }
}

/** Priority order is deliberate: the most specific, most actionable pattern wins. */
function pickWeakness(
  src: RunTelemetry['bySource'],
  authority: RateStat,
  other: RateStat,
  urgency: RateStat,
  cal: Calibration,
): Weakness | null {
  const { external: ex, internal: inn } = src
  if (ex.rate !== null && inn.rate !== null) {
    if (inn.rate < ex.rate - SEPARATION)
      return {
        id: 'trusts_known_people',
        headline: 'Your biggest weakness is trusting requests that appear to come from people you already know.',
        evidence: `${pct(ex.rate)} on external threats vs ${pct(inn.rate)} on requests from coworkers.`,
      }
    if (ex.rate < inn.rate - SEPARATION)
      return {
        id: 'external_lures',
        headline: 'Your biggest weakness is messages engineered to look legitimate.',
        evidence: `${pct(inn.rate)} on coworker requests vs ${pct(ex.rate)} on external threats.`,
      }
  }
  if (authority.rate !== null && other.rate !== null && authority.rate < other.rate - SEPARATION)
    return {
      id: 'authority_pressure',
      headline: 'Your biggest weakness is seniority: you comply when someone important is asking.',
      evidence: `${pct(authority.rate)} under authority pressure vs ${pct(other.rate)} otherwise.`,
    }
  if (cal.verdict === 'overconfident')
    return {
      id: 'overconfidence',
      headline: 'Your biggest weakness is certainty: you bet big on calls that did not hold.',
      evidence: `Your bets implied ${pct(cal.meanConfidence!)} confidence; you delivered ${pct(cal.hitRate!)}.`,
    }
  if (urgency.rate !== null && urgency.rate < 0.5)
    return {
      id: 'urgency',
      headline: 'Your biggest weakness is the clock: a deadline makes you skip the check.',
      evidence: `${pct(urgency.rate)} on decisions with a deadline attached.`,
    }
  return null
}

/** The two sentences the coach leads with. Only states what was observed. */
export function describeTelemetry(t: RunTelemetry): string[] {
  const out: string[] = []
  const { external: ex, internal: inn } = t.bySource
  if (ex.rate !== null && inn.rate !== null) {
    if (inn.rate < ex.rate)
      out.push(`You correctly identified ${pct(ex.rate)} of external threats, but only ${pct(inn.rate)} of requests involving coworkers.`)
    else if (ex.rate < inn.rate)
      out.push(`You handled ${pct(inn.rate)} of requests involving coworkers well, but only ${pct(ex.rate)} of external threats.`)
    else out.push(`You were consistent: ${pct(ex.rate)} on external threats and on requests from coworkers alike.`)
  }
  const s = t.authoritySlowdownMs
  if (s !== null && Math.abs(s) >= 700)
    out.push(
      `Your decisions were ${(Math.abs(s) / 1000).toFixed(1)} seconds ${s > 0 ? 'slower' : 'faster'} when authority pressure was introduced.`,
    )
  return out
}
