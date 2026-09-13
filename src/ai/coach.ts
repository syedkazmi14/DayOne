import { conceptLabel } from '@/content/knowledge'
import type { ConceptId, DecisionRecord, Mastery } from '@/types'
import { weakestConcept, strongestConcept } from '@/engine/adaptive'
import { analyseRun, describeTelemetry, pct, type RunTelemetry, type WeaknessId } from '@/engine/telemetry'
import { complete, isLive, LLMUnavailable } from './llm'

/* ============================================================================
 * AI COACH
 *
 * Reads the run — not just the score — and says something the player could not
 * have written themselves. The signal comes from deterministic models (mastery,
 * src/engine/telemetry.ts); the language is the only thing an LLM is asked for.
 *
 * The summary is read at a glance on the results page, so it is deliberately
 * short: a headline, the measured lead, and the single most useful behavioural
 * signal (tempo, wager calibration, or engagement) — only ones actually present
 * in the log. The full measurements sit beside it in RunTelemetryPanel.
 * ========================================================================== */

export interface CoachAnalysis {
  headline: string
  /** At most three short sentences — the result at a glance, not an essay. */
  points: string[]
  nextFocus: ConceptId[]
  /** One short sentence on what the next episode changes. */
  nextEpisodePlan: string
  /** The measurements the narration is built on. Rendered alongside it. */
  telemetry: RunTelemetry
  source: 'llm' | 'local'
}

/** Hard ceiling on the summary, whichever path wrote it. */
const MAX_POINTS = 3

/** Concept-level fallback for runs whose scenes carry no threat tags. */
const OVERT: ConceptId[] = ['phishing', 'social_engineering']
const SOCIAL_PRESSURE: ConceptId[] = ['data_handling', 'approved_tools', 'incident_reporting']

interface Signals {
  best: number
  acceptable: number
  poor: number
  avgMs: number
  fastPoor: boolean
  overtScore: number | null
  pressureScore: number | null
  questionsAsked: number
}

function analyse(decisions: DecisionRecord[], questionsAsked: number): Signals {
  const best = decisions.filter((d) => d.quality === 'best').length
  const acceptable = decisions.filter((d) => d.quality === 'acceptable').length
  const poor = decisions.filter((d) => d.quality === 'poor').length
  const avgMs = decisions.reduce((s, d) => s + d.msToDecide, 0) / Math.max(1, decisions.length)

  const good = decisions.filter((d) => d.quality === 'best')
  const bad = decisions.filter((d) => d.quality !== 'best')
  const meanMs = (ds: DecisionRecord[]) => (ds.length ? ds.reduce((s, d) => s + d.msToDecide, 0) / ds.length : 0)
  const fastPoor = bad.length > 0 && good.length > 0 && meanMs(bad) < meanMs(good) * 0.7

  const rate = (pool: ConceptId[]) => {
    const rel = decisions.filter((d) => d.concepts.some((c) => pool.includes(c)))
    if (!rel.length) return null
    return rel.filter((d) => d.quality === 'best').length / rel.length
  }

  return { best, acceptable, poor, avgMs, fastPoor, overtScore: rate(OVERT), pressureScore: rate(SOCIAL_PRESSURE), questionsAsked }
}

const WEAKNESS_HEADLINE: Record<WeaknessId, string> = {
  trusts_known_people: 'You catch attackers. You do not catch colleagues.',
  external_lures: 'Colleagues, yes. Forgeries, no.',
  authority_pressure: 'Seniority is your blind spot.',
  overconfidence: 'Your certainty outran your judgement.',
  urgency: 'The clock is doing your thinking.',
}

const lower = (c: ConceptId) => conceptLabel(c).toLowerCase()

function localAnalysis(decisions: DecisionRecord[], after: Record<ConceptId, Mastery>, questionsAsked: number): CoachAnalysis {
  const s = analyse(decisions, questionsAsked)
  const t = analyseRun(decisions)
  const weak = weakestConcept(after)
  const strong = strongestConcept(after)

  const headline =
    s.poor === 0 && s.best >= 3
      ? 'You slow down when it counts.'
      : t.weakness
        ? WEAKNESS_HEADLINE[t.weakness.id]
        : s.poor >= 3
          ? 'Today was expensive. That is what day one is for.'
          : s.overtScore !== null && s.pressureScore !== null && s.overtScore > s.pressureScore + 0.3
            ? 'You catch attackers. You do not catch colleagues.'
            : s.fastPoor
              ? 'Your speed is the tell.'
              : 'Careful, uneven, and improving.'

  /* 1 · the measured lead, or where the run was strongest and weakest */
  const measured = describeTelemetry(t)
  const lead = measured[0] ?? `Strongest on ${lower(strong)}; most exposed on ${lower(weak)}.`

  /* 2 · the single most useful behavioural signal, in priority order */
  const cal = t.calibration
  const signal = s.fastPoor
    ? 'Your wrong answers came faster than your right ones.'
    : cal.verdict === 'overconfident'
      ? `Your bets implied ${pct(cal.meanConfidence!)} confidence; you delivered ${pct(cal.hitRate!)}.`
      : cal.verdict === 'underconfident'
        ? `You bet like ${pct(cal.meanConfidence!)} sure and delivered ${pct(cal.hitRate!)}. Trust your read.`
        : (measured[1] ??
          (s.questionsAsked === 0 && s.best < decisions.length ? 'You never asked the cast why an outcome happened.' : null))

  const points = [lead, signal].filter((p): p is string => !!p)

  const focus = [
    weak,
    ...(Object.keys(after) as ConceptId[])
      .filter((c) => c !== weak)
      .sort((a, b) => after[a].score - after[b].score)
      .slice(0, 1),
  ]

  return {
    headline,
    points,
    nextFocus: focus,
    nextEpisodePlan: `Next episode focuses on ${focus.map(lower).join(' and ')}.`,
    telemetry: t,
    source: 'local',
  }
}

const COACH_SYSTEM = `You are the ONBOARD adaptive learning coach. You analyse an employee's run through an interactive security-onboarding episode and report what their decisions reveal.

Voice: direct, specific, respectful. Like a good manager giving feedback, not an LMS. No praise inflation, no shaming, no emoji.

Hard rules:
- Only use the data provided. Never invent a decision, number, or moment that is not in it.
- If "leadSentences" is non-empty, your first point must be its first sentence, verbatim — it is measured.
- If "weakness" is present, name it in the headline, in your own words. It is the single most useful thing the player does not know about themselves. Its headline sentence is already shown on the page — never repeat it in a point.
- Describe behavioural patterns, not scores. The player can already see their score.
- Be brief: the player reads this at a glance. 1 to 3 points, each a single sentence of at most 20 words. No filler, and do not restate the headline.
- nextEpisodePlan is one sentence of at most 12 words.

Return JSON only: {"headline": string (max 8 words), "points": string[], "nextEpisodePlan": string}`

export async function generateCoachAnalysis(args: {
  decisions: DecisionRecord[]
  before: Record<ConceptId, Mastery>
  after: Record<ConceptId, Mastery>
  questionsAsked: number
  score: number
}): Promise<CoachAnalysis> {
  const local = localAnalysis(args.decisions, args.after, args.questionsAsked)
  if (!isLive()) return local

  const t = local.telemetry
  const payload = {
    score: args.score,
    questionsAskedOfCharacters: args.questionsAsked,
    leadSentences: describeTelemetry(t),
    weakness: t.weakness,
    telemetry: {
      externalThreatAccuracy: t.bySource.external.rate,
      coworkerRequestAccuracy: t.bySource.internal.rate,
      authoritySlowdownSeconds: t.authoritySlowdownMs === null ? null : Math.round(t.authoritySlowdownMs / 100) / 10,
      calibration: { verdict: t.calibration.verdict, impliedConfidence: t.calibration.meanConfidence, delivered: t.calibration.hitRate },
    },
    signals: analyse(args.decisions, args.questionsAsked),
    decisions: args.decisions.map((d) => ({
      scene: d.sceneTitle,
      chose: d.choiceLabel,
      quality: d.quality,
      concepts: d.concepts,
      threat: d.threat ?? null,
      secondsToDecide: Math.round(d.msToDecide / 100) / 10,
      wager: d.wager ? { tier: d.wager.tier, multiplier: d.wager.multiplier, staked: d.wager.staked, won: d.wager.won } : null,
    })),
    masteryBefore: Object.fromEntries(Object.entries(args.before).map(([k, v]) => [k, Math.round(v.score * 100)])),
    masteryAfter: Object.fromEntries(Object.entries(args.after).map(([k, v]) => [k, Math.round(v.score * 100)])),
  }

  try {
    const raw = await complete({
      system: COACH_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(payload, null, 2) }],
      maxTokens: 300,
      temperature: 0.65,
    })
    const json = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as Partial<CoachAnalysis>
    const points = json.points?.filter((p) => typeof p === 'string' && p.trim()).slice(0, MAX_POINTS)
    if (!points?.length) return local
    return {
      headline: json.headline ?? local.headline,
      points,
      nextFocus: local.nextFocus,
      nextEpisodePlan: json.nextEpisodePlan ?? local.nextEpisodePlan,
      telemetry: t,
      source: 'llm',
    }
  } catch (e) {
    if (!(e instanceof LLMUnavailable) && !(e instanceof SyntaxError)) throw e
    return local
  }
}
