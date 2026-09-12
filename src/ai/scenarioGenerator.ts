import type { Choice, KnowledgeItem } from '@/types'
import { complete, isLive, LLMUnavailable } from './llm'

/* ============================================================================
 * SCENARIO GENERATOR
 *
 * Knowledge -> a situation that tests APPLICATION, not recall.
 *
 * The generated artefact is an episode-graph fragment: a setup, a decision with
 * three defensible options, per-branch consequences, and the shot prompts a
 * video pipeline would render ahead of time. Nothing here runs while a player
 * is waiting.
 * ========================================================================== */

export const SCENARIO_SYSTEM = `You convert one piece of company policy into a playable scene for an interactive onboarding episode.

Design constraints — these are what make it a game rather than a quiz:
- The scene must test whether the employee can APPLY the rule under pressure, never whether they can recall it.
- The pressure must be social and legitimate: a real deadline, a senior colleague, a customer waiting. Never a cartoon villain.
- Exactly three options. Every one must be defensible to a reasonable person. The wrong answer must be the one that is most helpful in the short term.
- No option may be identifiable as correct from its wording. Do not signal with adverbs.
- Each branch gets a consequence that SHOWS what happens in the world before any explanation is given.
- Never say "correct" or "incorrect".

Return JSON only:
{ "situation": string, "setup": [{"speaker": string, "line": string}], "prompt": string,
  "choices": [{"text": string, "quality": "best"|"acceptable"|"poor", "consequence": string, "lesson": string}],
  "shots": [string] }`

export interface ScenarioDraft {
  knowledgeId: string
  situation: string
  setup: { speaker: string; line: string }[]
  prompt: string
  choices: (Pick<Choice, 'text' | 'quality'> & { consequence: string; lesson: string })[]
  shots: string[]
  source: 'llm' | 'local'
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
const stripTrailing = (s: string) => s.replace(/\.$/, '')

/**
 * Deterministic derivation. Uses the knowledge item's own fields as the raw
 * material: the common mistake becomes the tempting option, the recommended
 * action becomes the strong option, and the edge case becomes the ambiguity
 * that makes the third option feel reasonable.
 */
function localDraft(k: KnowledgeItem): ScenarioDraft {
  const mistake = stripTrailing(lower(k.commonMistake))
  const best = stripTrailing(lower(k.recommended[0] ?? 'follow the documented process'))
  const edge = k.edgeCases[0] ?? ''

  return {
    knowledgeId: k.id,
    situation: `A colleague under a real deadline asks you to help in a way that involves ${mistake}. They are not being careless — it is genuinely the fastest route, and they have done it before without consequence.`,
    setup: [
      { speaker: 'COLLEAGUE', line: `I need this in twenty minutes and I am about to be in a meeting. Easiest thing is just ${mistake} — that is what I normally do.` },
      { speaker: 'COLLEAGUE', line: edge ? `And before you ask — ${lower(edge)}` : 'It has never been a problem before.' },
    ],
    prompt: 'WHAT DO YOU DO?',
    choices: [
      {
        text: `Help them the way they asked — ${mistake}.`,
        quality: 'poor',
        consequence: k.consequence,
        lesson: `${k.rule} The reason is mechanical rather than bureaucratic: ${lower(k.consequence)}`,
      },
      {
        text: `Do it a different way: ${best}.`,
        quality: 'best',
        consequence: 'The task still gets done, inside the boundary, and the colleague learns the reason rather than the rule.',
        lesson: `${k.rule} Refusing the container rather than the task is what makes this workable in a real workplace.`,
      },
      {
        text: 'Ask whether what they are describing has actually been approved.',
        quality: 'acceptable',
        consequence: 'The question is enough to stop it, but it puts the check on someone else and you still do not know the answer yourself.',
        lesson: `${k.rule} Surfacing the assumption is genuinely useful; verifying it yourself is what closes it.`,
      },
    ],
    shots: [
      `Medium two-shot across a desk divider, late afternoon light, a colleague leaning in mid-request. Handheld, 40mm, warm practical light, documentary framing.`,
      `Tight insert on the screen showing the action being requested. Shallow focus, cursor hovering, high contrast.`,
      `Consequence shot: ${k.severity === 'critical' ? 'a meeting room weeks later, cold institutional light, a printed page sliding across a table' : 'the same desk, task complete, tension leaving the room, warm light returning'}.`,
    ],
    source: 'local',
  }
}

export async function generateScenario(k: KnowledgeItem): Promise<ScenarioDraft> {
  if (isLive()) {
    try {
      const raw = await complete({
        system: SCENARIO_SYSTEM,
        messages: [
          {
            role: 'user',
            content: JSON.stringify(
              { rule: k.rule, severity: k.severity, commonMistake: k.commonMistake, consequence: k.consequence, edgeCases: k.edgeCases, recommended: k.recommended, prohibited: k.prohibited },
              null,
              2,
            ),
          },
        ],
        maxTokens: 1200,
        temperature: 0.8,
      })
      const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, '')) as Omit<ScenarioDraft, 'knowledgeId' | 'source'>
      return { ...parsed, knowledgeId: k.id, source: 'llm' }
    } catch (e) {
      if (!(e instanceof LLMUnavailable) && !(e instanceof SyntaxError)) throw e
    }
  }
  await new Promise((r) => setTimeout(r, 900))
  return localDraft(k)
}

/* Whole playable episodes are built by src/ai/episodeGenerator.ts, and video
 * for them goes through requestClip() in src/media/video.ts. This module keeps
 * the single-rule scene draft the Studio shows as a close-up of one beat. */
