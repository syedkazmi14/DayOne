import { characters } from '@/content/characters'
import { concepts, knowledgeById } from '@/content/knowledge'
import type { Episode, KnowledgeItem, Scene } from '@/types'

/* ============================================================================
 * EPISODE GRAPH VALIDATION
 *
 * The gate between "a graph something generated" and "a graph the reducer is
 * allowed to play". Pure: no logging, no throwing. scripts/validate.ts turns
 * errors into FAILs; the reducer refuses to publish a graph with any; the
 * Studio renders them.
 *
 * These are the rules scripts/validate.ts has always enforced on FIRST DAY,
 * stated once so the hand-authored episode and generated ones cannot drift.
 * ========================================================================== */

export interface GraphIssue {
  sceneId: string
  message: string
}

export interface GraphReport {
  ok: boolean
  errors: GraphIssue[]
  reachable: number
  total: number
  terminals: string[]
  decisions: number
  adaptiveVariants: number
}

export interface ValidateOptions {
  /** Consequence lessons must exceed this. Thin lessons teach nothing. */
  minLessonChars?: number
  resolveKnowledge?: (id: string) => KnowledgeItem | undefined
}

const CORRECTNESS = /\b(correct|incorrect|right answer|wrong answer)\b/i
const conceptIds = new Set<string>(concepts.map((c) => c.id))

/** Citations resolve against the episode's own snapshot first, then the base. */
export const episodeKnowledgeResolver =
  (ep?: Pick<Episode, 'knowledge'>) =>
  (id: string): KnowledgeItem | undefined =>
    ep?.knowledge?.find((k) => k.id === id) ?? knowledgeById(id)

/** Where the engine can go from a scene. Mirrors the reducer's own precedence. */
export const successors = (s: Scene): string[] =>
  s.variants?.length
    ? s.variants.map((v) => v.sceneId)
    : s.choices?.length
      ? s.choices.map((c) => c.consequenceSceneId)
      : s.next
        ? [s.next]
        : []

/** A lesson at or under this length does not explain a mechanism. */
export const MIN_LESSON_CHARS = 180

export function validateEpisode(ep: Episode, opts: ValidateOptions = {}): GraphReport {
  const errors: GraphIssue[] = []
  const err = (sceneId: string, message: string) => errors.push({ sceneId, message })
  const resolve = opts.resolveKnowledge ?? episodeKnowledgeResolver(ep)
  const minLesson = opts.minLessonChars ?? MIN_LESSON_CHARS
  const scenes: Record<string, Scene> = ep?.scenes ?? {}
  const ids = Object.keys(scenes)

  if (!scenes[ep.entrySceneId]) err('<episode>', `entry scene "${ep.entrySceneId}" does not exist`)
  for (const id of ep.cast ?? []) if (!characters[id]) err('<episode>', `casts unknown character ${id}`)

  let decisions = 0
  let adaptiveVariants = 0

  for (const [key, s] of Object.entries(scenes)) {
    if (s.id !== key) err(key, `scene key mismatch: ${s.id}`)
    if (s.next && !scenes[s.next]) err(key, `next -> missing ${s.next}`)

    const variants = s.variants ?? []
    adaptiveVariants += variants.length
    for (const v of variants) {
      if (!scenes[v.sceneId]) err(key, `variant -> missing ${v.sceneId}`)
      if (!conceptIds.has(v.conceptFocus)) err(key, `variant targets unknown concept ${v.conceptFocus}`)
    }
    if (new Set(variants.map((v) => v.conceptFocus)).size !== variants.length)
      err(key, 'adaptive variants must target distinct concepts')

    ;(s.dialogue ?? []).forEach((d, i) => {
      if (!characters[d.characterId]) err(key, `unknown speaker ${d.characterId}`)
      if (!d.line?.trim()) err(key, `dialogue[${i}] is empty`)
    })

    for (const r of s.knowledgeRefs ?? []) if (!resolve(r)) err(key, `references unknown knowledge ${r}`)

    if (s.kind === 'decision') {
      decisions++
      const cs = s.choices ?? []
      if (cs.length !== 3) err(key, `should have 3 choices, has ${cs.length}`)
      if (cs.filter((c) => c.quality === 'best').length !== 1) err(key, 'needs exactly one best choice')
      if (new Set(cs.map((c) => c.quality)).size !== 3) err(key, 'choices should span all three qualities')
      if (new Set(cs.map((c) => c.id)).size !== cs.length) err(key, 'duplicate choice ids')
      for (const c of cs) {
        if (!scenes[c.consequenceSceneId]) err(key, `${c.id} -> missing ${c.consequenceSceneId}`)
        if (!c.knowledgeConcepts?.length) err(key, `${c.id} has no concepts`)
        for (const k of c.knowledgeConcepts ?? []) if (!conceptIds.has(k)) err(key, `${c.id} unknown concept ${k}`)
        if (!c.ledgerLabel) err(key, `${c.id} has no ledger label`)
        if (!c.text?.trim()) err(key, `${c.id} has no text`)
        if (CORRECTNESS.test(c.text ?? '')) err(key, `${c.id} leaks correctness in wording`)
      }
    }

    if (s.kind === 'consequence') {
      const o = s.outcome
      if (!o) err(key, 'consequence without outcome')
      else {
        if (!o.citations?.length) err(key, 'outcome has no citations')
        for (const c of o.citations ?? []) if (!resolve(c)) err(key, `cites unknown knowledge ${c}`)
        if (/\b(correct|incorrect)\b/i.test(o.lesson ?? '')) err(key, 'lesson says correct/incorrect')
        if ((o.lesson?.length ?? 0) <= minLesson) err(key, `lesson too thin (${o.lesson?.length ?? 0} chars)`)
      }
      if (!s.next) err(key, 'has no next')
      if (!s.chatWith?.length) err(key, 'has no chat partners')
      for (const id of s.chatWith ?? []) if (!characters[id]) err(key, `chat partner ${id} does not exist`)
    }
  }

  /* Reachability + cycles. A cycle means a player could loop forever; an
   * unreachable scene means something was generated that nobody can see. */
  const mark = new Map<string, 'open' | 'done'>()
  const terminals: string[] = []
  const visit = (id: string) => {
    const s = scenes[id]
    if (!s) return
    const m = mark.get(id)
    if (m === 'open') return err(id, 'cycle: the player could loop forever')
    if (m === 'done') return
    mark.set(id, 'open')
    const next = successors(s)
    if (!next.length) terminals.push(id)
    next.forEach(visit)
    mark.set(id, 'done')
  }
  if (scenes[ep.entrySceneId]) visit(ep.entrySceneId)

  const unreachable = ids.filter((id) => !mark.has(id))
  if (unreachable.length) err('<episode>', `unreachable scenes: ${unreachable.join(', ')}`)
  if (terminals.length !== 1) err('<episode>', `expected exactly one terminal scene, found ${terminals.length}: ${terminals.join(', ')}`)
  for (const t of terminals) if (scenes[t].kind !== 'ending') err(t, 'terminal scene should be an ending')

  return { ok: errors.length === 0, errors, reachable: mark.size, total: ids.length, terminals, decisions, adaptiveVariants }
}
