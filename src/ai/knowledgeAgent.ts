import { knowledgeBase } from '@/content/knowledge'
import { partitionValidItems, type ValidationError } from '@/content/validateKnowledge'
import { sourceDocs } from '@/content/sourceDocs'
import type { KnowledgeItem, SourceDoc } from '@/types'
import { complete, isLive, LLMUnavailable } from './llm'

/* ============================================================================
 * KNOWLEDGE AGENT — the authoring half of the product.
 *
 * Input: whatever the company already has (handbook PDFs, policy docs, an
 * all-hands deck, a 31-minute briefing video transcript).
 * Output: atomic, citable KnowledgeItems — the substrate everything else uses.
 *
 * Runs at AUTHORING time, never in the player's path. The employee experience
 * must not depend on an extraction job completing.
 * ========================================================================== */

export const KNOWLEDGE_AGENT_SYSTEM = `You extract structured onboarding knowledge from company material.

For each distinct normative statement in the source, emit one object:
{
  "id": "K-XXX-NN",
  "topic": short noun phrase,
  "rule": the single normative statement, in plain language, imperative where possible,
  "severity": "critical" | "high" | "medium" | "low",
  "commonMistake": what real employees actually do wrong here,
  "consequence": the mechanism of harm — what physically happens when the rule is broken,
  "edgeCases": [situations where the rule still applies but people assume it does not],
  "recommended": [concrete compliant actions],
  "prohibited": [concrete non-compliant actions],
  "concepts": [from the fixed concept taxonomy],
  "source": { "doc": filename, "section": section number and title, "page": number }
}

Rules:
- One rule per item. Split compound policies.
- Rewrite legalese into language a new employee would use. Preserve meaning exactly.
- Never invent a consequence. If the source does not state the mechanism, infer only what is technically necessary and mark severity conservatively.
- Always populate source. Unciteable knowledge is unusable downstream — a character that cannot cite will be made to say "I don't know".

Return a JSON array only.`

export type PipelineStage =
  | 'parse'
  | 'segment'
  | 'extract'
  | 'normalise'
  | 'link'
  | 'validate'

export const STAGES: { id: PipelineStage; label: string; detail: string }[] = [
  { id: 'parse', label: 'PARSE', detail: 'Text, layout and transcript extraction' },
  { id: 'segment', label: 'SEGMENT', detail: 'Split into normative statements' },
  { id: 'extract', label: 'EXTRACT', detail: 'Rule, mechanism, mistake, edge cases' },
  { id: 'normalise', label: 'NORMALISE', detail: 'Deduplicate and rewrite legalese' },
  { id: 'link', label: 'LINK', detail: 'Map to the concept taxonomy' },
  { id: 'validate', label: 'VALIDATE', detail: 'Reject anything uncitable' },
]

export interface PipelineEvent {
  type: 'stage' | 'item' | 'done'
  stage?: PipelineStage
  doc?: SourceDoc
  item?: KnowledgeItem
  message?: string
  /** Why extracted items were dropped. Set on the 'validate' stage only. */
  rejected?: ValidationError[]
}

/**
 * Streams the extraction so the authoring UI can show real staged progress.
 * With a key configured the extract stage calls the model on the actual
 * excerpt; without one it replays the pre-extracted knowledge for this corpus.
 */
export async function* runKnowledgeAgent(
  docs: SourceDoc[] = sourceDocs,
  opts: { speed?: number } = {},
): AsyncGenerator<PipelineEvent> {
  const speed = opts.speed ?? 1
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms / speed))

  for (const doc of docs) {
    /* Populated by the extract stage, reported by the validate stage that
     * follows it for the same doc. */
    let rejected: ValidationError[] = []

    for (const stage of STAGES) {
      const note =
        stage.id === 'validate' && rejected.length ? ` · dropped ${rejected.length} uncitable` : ''
      yield {
        type: 'stage',
        stage: stage.id,
        doc,
        message: `${stage.label} · ${doc.name}${note}`,
        rejected: stage.id === 'validate' ? rejected : undefined,
      }
      await wait(stage.id === 'extract' ? 520 : 190)

      if (stage.id === 'extract') {
        let emitted: KnowledgeItem[] | null = null
        if (isLive()) {
          try {
            const raw = await complete({
              system: KNOWLEDGE_AGENT_SYSTEM,
              messages: [{ role: 'user', content: `FILE: ${doc.name}\n\n${doc.excerpt}` }],
              maxTokens: 1600,
              temperature: 0.2,
            })
            const parsed: unknown = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''))

            /* A model completion is untrusted input, and this is the only path
             * that produces knowledge the content suite never saw. An item that
             * cannot be cited makes a character decline; an unknown severity
             * reaches retrieval as NaN rather than as an error. Both are caught
             * here instead of downstream. */
            if (Array.isArray(parsed)) {
              const split = partitionValidItems(parsed as KnowledgeItem[])
              rejected = split.rejected.flatMap((r) => r.errors)
              /* Every item rejected is a failed extraction, not an empty one —
               * fall back so the doc still contributes its known-good rules. */
              emitted = split.valid.length ? split.valid : null
            }
          } catch (e) {
            if (!(e instanceof LLMUnavailable) && !(e instanceof SyntaxError)) throw e
          }
        }
        const items = emitted ?? (doc.yields.map((id) => knowledgeBase.find((k) => k.id === id)!).filter(Boolean) as KnowledgeItem[])
        for (const item of items) {
          yield { type: 'item', doc, item }
          await wait(260)
        }
      }
    }
  }
  yield { type: 'done', message: 'Knowledge base ready' }
}
