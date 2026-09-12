import { conceptLabel } from '@/content/knowledge'
import type { ConceptId, DecisionRecord, Mastery } from '@/types'
import { growth, weakestConcept, strongestConcept } from '@/engine/adaptive'
import { complete, isLive, LLMUnavailable } from './llm'

/* ============================================================================
 * AI COACH
 *
 * Reads the run — not just the score — and says something the player could not
 * have written themselves. The signal comes from the deterministic model; the
 * language is the only thing an LLM is asked for.
 *
 * The offline composer is not a generic template. It runs actual analyses over
 * the decision log (speed/accuracy correlation, threat-shape bias, wager
 * calibration, engagement) and only reports the patterns that are present.
 * ========================================================================== */

export interface CoachAnalysis {
  headline: string
  paragraphs: string[]
  nextFocus: ConceptId[]
  nextEpisodePlan: string
  source: 'llm' | 'local'
}

/** Concepts where the threat announces itself vs. where it arrives as a favour. */
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
  wagerOverconfident: boolean
  wagerTimid: boolean
  questionsAsked: number
  netCredits: number
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

  const wagers = decisions.map((d) => d.wager).filter(Boolean) as NonNullable<DecisionRecord['wager']>[]
  const lostBig = wagers.filter((w) => !w.won && w.tier !== 'safe').length
  const wonSmall = wagers.filter((w) => w.won && w.tier === 'safe').length
  const netCredits = wagers.reduce((s, w) => s + (w.won ? w.payout : -w.staked), 0)

  return {
    best,
    acceptable,
    poor,
    avgMs,
    fastPoor,
    overtScore: rate(OVERT),
    pressureScore: rate(SOCIAL_PRESSURE),
    wagerOverconfident: lostBig >= 1,
    wagerTimid: wonSmall >= 2 && lostBig === 0,
    questionsAsked,
    netCredits,
  }
}

function localAnalysis(
  decisions: DecisionRecord[],
  before: Record<ConceptId, Mastery>,
  after: Record<ConceptId, Mastery>,
  questionsAsked: number,
): CoachAnalysis {
  const s = analyse(decisions, questionsAsked)
  const weak = weakestConcept(after)
  const strong = strongestConcept(after)
  const g = growth(before, after)
  const paragraphs: string[] = []

  /* --- opening read: what kind of employee did the log describe? --- */
  const headline =
    s.poor === 0 && s.best >= 3
      ? 'You slow down when it counts.'
      : s.overtScore !== null && s.pressureScore !== null && s.overtScore > s.pressureScore + 0.3
        ? 'You catch attackers. You do not catch colleagues.'
        : s.poor >= 3
          ? 'Today was expensive. That is what day one is for.'
          : s.fastPoor
            ? 'Your speed is the tell.'
            : 'Careful, uneven, and improving.'

  const ledger = `${s.best} strong call${s.best === 1 ? '' : 's'}, ${s.acceptable} partial, ${s.poor} costly`
  paragraphs.push(
    `${ledger}. Across four decisions you were at your best on ${conceptLabel(strong).toLowerCase()} and at your most exposed on ${conceptLabel(weak).toLowerCase()}. That gap is not a knowledge gap — it is a situational one, and it repeats.`,
  )

  /* --- the actual insight: threat-shape bias --- */
  if (s.overtScore !== null && s.pressureScore !== null) {
    if (s.overtScore > s.pressureScore + 0.25) {
      paragraphs.push(
        `You recognise a threat when it looks like a threat. A strange email, an unsolicited call — you were ${Math.round(s.overtScore * 100)}% right on those. When the same risk arrives as a colleague under deadline asking for a favour, you were ${Math.round(s.pressureScore * 100)}% right. Attackers know that asymmetry, and so does anyone who has ever been busy. The scenarios that cost companies money almost never announce themselves.`,
      )
    } else if (s.pressureScore > s.overtScore + 0.25) {
      paragraphs.push(
        `Unusually, you hold up better under social pressure than against overt attacks — you said no to colleagues but moved too quickly on the messages engineered to look legitimate. That is the rarer profile. It means your judgement is sound and your pattern-recognition for forged authority is the part that needs reps.`,
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
      `Timing is worth naming. Your wrong answers came in noticeably faster than your right ones — you commit quickest on exactly the decisions you go on to get wrong, which is the signature of recognising a situation as familiar rather than actually reading it. The intervention is mechanical: when a request carries a deadline, that is the moment to slow down, not speed up.`,
    )
  } else if (s.avgMs > 14000) {
    paragraphs.push(
      `You deliberate — averaging ${Math.round(s.avgMs / 1000)} seconds a decision. That is a real strength under this kind of pressure, and the only thing to watch is that hesitation does not become the reason you default to the most helpful-looking option.`,
    )
  }

  /* --- wager calibration as a confidence read --- */
  if (s.wagerOverconfident) {
    paragraphs.push(
      `Your wagers say something your answers do not: you staked heavily on a call you then got wrong. Confidence and competence came apart in the same moment, which is the most useful thing to know about yourself here. ${s.netCredits < 0 ? `Net ${s.netCredits} credits.` : ''}`,
    )
  } else if (s.wagerTimid) {
    paragraphs.push(
      `You consistently under-bet decisions you then got right. You know more than you are willing to price, and that under-confidence has a cost in real workplaces: it is why people defer to whoever sounds most certain in the room.`,
    )
  }

  /* --- engagement --- */
  if (s.questionsAsked >= 3) {
    paragraphs.push(
      `You also asked the cast ${s.questionsAsked} questions rather than accepting the outcome — the transcript shows you pushing on the reasoning, not just the rule. That is the behaviour that generalises to situations no training covered.`,
    )
  } else if (s.questionsAsked === 0) {
    paragraphs.push(
      `You never asked anyone anything. Every consequence today came with somebody standing there willing to explain the mechanism, and you took the outcome at face value. Try arguing with Vera next time; she is difficult to annoy.`,
    )
  }

  /* --- movement --- */
  if (g.length) {
    const up = g.filter((x) => x.after > x.before).slice(0, 2)
    const down = g.filter((x) => x.after < x.before).slice(0, 2)
    const fmt = (x: (typeof g)[number]) =>
      `${conceptLabel(x.concept)} ${Math.round(x.before * 100)}→${Math.round(x.after * 100)}%`
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

  const focus = [weak, ...(Object.keys(after) as ConceptId[])
    .filter((c) => c !== weak)
    .sort((a, b) => after[a].score - after[b].score)
    .slice(0, 1)]

  const plan = `Episode 02 will bias towards ${focus.map((c) => conceptLabel(c).toLowerCase()).join(' and ')}, and the scenarios will be more ambiguous: requests that are partly legitimate, from people with a real reason to ask. ${conceptLabel(strong)} is demonstrated — it moves to spot-checks rather than full scenes.`

  return { headline, paragraphs, nextFocus: focus, nextEpisodePlan: plan, source: 'local' }
}

const COACH_SYSTEM = `You are the ONBOARD adaptive learning coach. You analyse an employee's run through an interactive security-onboarding episode and report what their decisions reveal.

Voice: direct, specific, respectful. Like a good manager giving feedback, not an LMS. No praise inflation, no shaming, no bullet points, no emoji.

Hard rules:
- Only use the data provided. Never invent a decision, number, or moment that is not in it.
- Describe behavioural patterns, not scores. The player can already see their score.
- Name the single most useful thing they do not know about themselves.
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

  const payload = {
    score: args.score,
    questionsAskedOfCharacters: args.questionsAsked,
    signals: analyse(args.decisions, args.questionsAsked),
    decisions: args.decisions.map((d) => ({
      scene: d.sceneTitle,
      chose: d.choiceLabel,
      quality: d.quality,
      concepts: d.concepts,
      secondsToDecide: Math.round(d.msToDecide / 100) / 10,
      wager: d.wager ? { tier: d.wager.tier, staked: d.wager.staked, won: d.wager.won } : null,
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
      source: 'llm',
    }
  } catch (e) {
    if (!(e instanceof LLMUnavailable) && !(e instanceof SyntaxError)) throw e
    return local
  }
}
