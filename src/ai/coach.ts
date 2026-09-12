import { conceptLabel } from '@/content/knowledge'
import type { ConceptId, DecisionRecord, Mastery } from '@/types'
import { growth, weakestConcept, strongestConcept } from '@/engine/adaptive'
import { analyseRun, describeTelemetry, pct, type RunTelemetry, type WeaknessId } from '@/engine/telemetry'
import { complete, isLive, LLMUnavailable } from './llm'

/* ============================================================================
 * AI COACH
 *
 * Reads the run — not just the score — and says something the player could not
 * have written themselves. The signal comes from deterministic models (mastery,
 * src/engine/telemetry.ts); the language is the only thing an LLM is asked for.
 *
 * The offline composer is not a generic template. It reports measured patterns:
 * accuracy by threat source, decision speed under authority pressure, wager
 * calibration, speed/accuracy correlation and engagement — and only the ones
 * actually present in the log.
 * ========================================================================== */

export interface CoachAnalysis {
  headline: string
  paragraphs: string[]
  nextFocus: ConceptId[]
  nextEpisodePlan: string
  /** The measurements the narration is built on. Rendered alongside it. */
  telemetry: RunTelemetry
  source: 'llm' | 'local'
}

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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function localAnalysis(
  decisions: DecisionRecord[],
  before: Record<ConceptId, Mastery>,
  after: Record<ConceptId, Mastery>,
  questionsAsked: number,
): CoachAnalysis {
  const s = analyse(decisions, questionsAsked)
  const t = analyseRun(decisions)
  const weak = weakestConcept(after)
  const strong = strongestConcept(after)
  const g = growth(before, after)
  const paragraphs: string[] = []

  /* --- opening read: what kind of employee did the log describe? --- */
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

  /* --- the measured lead: accuracy by threat source, tempo under authority --- */
  const lead = [...describeTelemetry(t), t.weakness?.headline].filter(Boolean)
  if (lead.length) paragraphs.push(lead.join(' '))

  const ledger = `${s.best} strong call${s.best === 1 ? '' : 's'}, ${s.acceptable} partial, ${s.poor} costly`
  paragraphs.push(
    `${ledger}. Across ${plural(decisions.length, 'decision')} you were at your best on ${conceptLabel(strong).toLowerCase()} and at your most exposed on ${conceptLabel(weak).toLowerCase()}. That gap is not a knowledge gap — it is a situational one, and it repeats.`,
  )

  /* --- threat-shape bias by concept, only when the scenes carried no tags --- */
  const tagged = t.bySource.external.total > 0 && t.bySource.internal.total > 0
  if (!tagged && s.overtScore !== null && s.pressureScore !== null) {
    if (s.overtScore > s.pressureScore + 0.25) {
      paragraphs.push(
        `You recognise a threat when it looks like a threat. A strange email, an unsolicited call — you were ${pct(s.overtScore)} right on those. When the same risk arrives as a colleague under deadline asking for a favour, you were ${pct(s.pressureScore)} right. Attackers know that asymmetry, and so does anyone who has ever been busy.`,
      )
    } else if (s.pressureScore > s.overtScore + 0.25) {
      paragraphs.push(
        `Unusually, you hold up better under social pressure than against overt attacks — you said no to colleagues but moved too quickly on the messages engineered to look legitimate. Your judgement is sound; your pattern-recognition for forged authority is the part that needs reps.`,
      )
    } else {
      paragraphs.push(
        `Your performance was consistent across both shapes of risk — messages engineered to deceive you, and people you like asking for something reasonable. Consistency at this stage is more useful than a high score, because it means the next episode can push difficulty rather than repeat basics.`,
      )
    }
  }

  /* --- tempo --- */
  if (s.fastPoor) {
    paragraphs.push(
      `Timing is worth naming. Your wrong answers came in noticeably faster than your right ones — you commit quickest on exactly the decisions you go on to get wrong, which is the signature of recognising a situation as familiar rather than actually reading it. When a request carries a deadline, that is the moment to slow down, not speed up.`,
    )
  } else if (s.avgMs > 14000) {
    paragraphs.push(
      `You deliberate — averaging ${Math.round(s.avgMs / 1000)} seconds a decision. That is a real strength under this kind of pressure, and the only thing to watch is that hesitation does not become the reason you default to the most helpful-looking option.`,
    )
  }

  /* --- wager calibration as a confidence read --- */
  const cal = t.calibration
  if (cal.verdict === 'overconfident') {
    paragraphs.push(
      `Your bets say something your answers do not: they implied ${pct(cal.meanConfidence!)} confidence, and you delivered ${pct(cal.hitRate!)}. Confidence and competence came apart in the same moment, which is the most useful thing to know about yourself here.`,
    )
  } else if (cal.verdict === 'underconfident') {
    paragraphs.push(
      `You under-bet decisions you then got right — ${pct(cal.meanConfidence!)} implied confidence against ${pct(cal.hitRate!)} delivered. You know more than you are willing to price, and that under-confidence has a cost: it is why people defer to whoever sounds most certain in the room.`,
    )
  } else if (cal.verdict === 'calibrated' && cal.bets >= 2) {
    paragraphs.push(
      `Your bets tracked your performance closely — ${pct(cal.meanConfidence!)} implied, ${pct(cal.hitRate!)} delivered. Calibration is rarer than accuracy, and it is what makes your judgement trustworthy to other people.`,
    )
  }

  /* --- engagement --- */
  if (s.questionsAsked >= 3) {
    paragraphs.push(
      `You also asked the cast ${s.questionsAsked} questions rather than accepting the outcome — the transcript shows you pushing on the reasoning, not just the rule. That is the behaviour that generalises to situations no training covered.`,
    )
  } else if (s.questionsAsked === 0) {
    paragraphs.push(
      `You never asked anyone anything. Every consequence today came with somebody standing there willing to explain the mechanism, and you took the outcome at face value. Argue with the cast next time; they are difficult to annoy.`,
    )
  }

  /* --- movement --- */
  if (g.length) {
    const up = g.filter((x) => x.after > x.before).slice(0, 2)
    const down = g.filter((x) => x.after < x.before).slice(0, 2)
    const fmt = (x: (typeof g)[number]) => `${conceptLabel(x.concept)} ${Math.round(x.before * 100)}→${Math.round(x.after * 100)}%`
    paragraphs.push(
      [
        up.length ? `Moved up: ${up.map(fmt).join(', ')}.` : '',
        down.length ? `Moved down: ${down.map(fmt).join(', ')}.` : '',
        'Those numbers are what the next episode is built from.',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  const focus = [
    weak,
    ...(Object.keys(after) as ConceptId[])
      .filter((c) => c !== weak)
      .sort((a, b) => after[a].score - after[b].score)
      .slice(0, 1),
  ]

  const plan = `Your next episode will bias towards ${focus.map((c) => conceptLabel(c).toLowerCase()).join(' and ')}, and the scenarios will be more ambiguous: requests that are partly legitimate, from people with a real reason to ask. ${conceptLabel(strong)} is demonstrated — it moves to spot-checks rather than full scenes.`

  return { headline, paragraphs, nextFocus: focus, nextEpisodePlan: plan, telemetry: t, source: 'local' }
}

const COACH_SYSTEM = `You are the ONBOARD adaptive learning coach. You analyse an employee's run through an interactive security-onboarding episode and report what their decisions reveal.

Voice: direct, specific, respectful. Like a good manager giving feedback, not an LMS. No praise inflation, no shaming, no bullet points, no emoji.

Hard rules:
- Only use the data provided. Never invent a decision, number, or moment that is not in it.
- If "leadSentences" is non-empty, your first paragraph must open with those sentences verbatim — they are measured.
- If "weakness" is present, name it. It is the single most useful thing the player does not know about themselves.
- Describe behavioural patterns, not scores. The player can already see their score.
- 3 short paragraphs maximum. Then one sentence on what the next episode will change.

Return JSON only: {"headline": string (max 8 words), "paragraphs": string[], "nextEpisodePlan": string}`

export async function generateCoachAnalysis(args: {
  decisions: DecisionRecord[]
  before: Record<ConceptId, Mastery>
  after: Record<ConceptId, Mastery>
  questionsAsked: number
  score: number
}): Promise<CoachAnalysis> {
  const local = localAnalysis(args.decisions, args.before, args.after, args.questionsAsked)
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
      maxTokens: 700,
      temperature: 0.65,
    })
    const json = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as Partial<CoachAnalysis>
    if (!json.paragraphs?.length) return local
    return {
      headline: json.headline ?? local.headline,
      paragraphs: json.paragraphs,
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
