import { useState } from 'react'
import { getCharacter } from '@/content/characters'
import { conceptLabel } from '@/content/knowledge'
import { episodeKnowledgeResolver, successors, type GraphReport } from '@/engine/validateEpisode'
import type { Episode, Scene } from '@/types'
import { Chip, Eyebrow } from '../ui/Bits'

/* ============================================================================
 * REVIEW THE STORY — what the generator wrote, read the way it will be played.
 *
 * This step is named for the story, so the story is what it shows: who says
 * what, which choices exist, what each one teaches. The graph underneath it
 * (scene ids, branch pointers, shot specs) is real and occasionally necessary,
 * but it is debugging information and lives behind a toggle.
 *
 * COLOUR MEANS ONE THING HERE: how good a choice is. It used to mean four —
 * `signal` was simultaneously the decision kind, the acceptable-quality tier,
 * the shot-spec rule and the citation id, so nothing could be read at a
 * glance. Scene kind and outcome tone are words now. Adding a second colour
 * axis to this file is a regression, not a feature.
 * ========================================================================== */

/** The only colour axis. */
const QUALITY_TONE = { best: 'good', acceptable: 'signal', poor: 'danger' } as const

/** Breadth-first from the entry, so a scene's branches sit together. */
export function orderedScenes(ep: Episode): Scene[] {
  const seen = new Set<string>()
  const out: Scene[] = []
  const queue = [ep.entrySceneId]
  while (queue.length) {
    const id = queue.shift()!
    const s = ep.scenes[id]
    if (!s || seen.has(id)) continue
    seen.add(id)
    out.push(s)
    queue.push(...successors(s))
  }
  for (const s of Object.values(ep.scenes)) if (!seen.has(s.id)) out.push(s)
  return out
}

export function GraphReview({ episode, report }: { episode: Episode; report: GraphReport }) {
  const scenes = orderedScenes(episode)
  const [act, setAct] = useState(episode.beats[0]?.act ?? 1)
  const [picked, setPicked] = useState<string | null>(null)
  const [tech, setTech] = useState(false)

  const inAct = scenes.filter((s) => s.act === act)
  /* Resolved rather than stored, so switching act cannot leave the pane
   * showing a scene that is no longer in the list beside it. */
  const scene = inAct.find((s) => s.id === picked) ?? inAct[0]

  return (
    <div>
      {report.ok ? (
        /* One line, because four of the five numbers this replaced only ever
         * said "nothing is wrong". Reachability is an exception report; it
         * carries information when it fails, and none when it passes. */
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-bone-faint">
          <span className="text-good">validated · playable</span> · {report.total} scenes · {report.decisions} decisions ·{' '}
          {report.adaptiveVariants} adaptive endings
        </p>
      ) : (
        <div className="rounded border border-danger/40 bg-danger/[0.06] p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-danger">
            {report.errors.length} graph {report.errors.length === 1 ? 'error' : 'errors'} · not playable
          </p>
          <ul className="mt-2 space-y-1">
            {report.errors.slice(0, 8).map((e, i) => (
              <li key={i} className="font-mono text-[10px] text-danger/90">
                {e.sceneId} · {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Acts as tabs rather than four stacked sections: a review surface that
        * grows with the episode cannot be scanned, and one act is a coherent
        * unit of reading on its own. */}
      <div className="no-scrollbar mt-5 flex gap-1 overflow-x-auto border-b border-bone/10">
        {episode.beats.map((b) => {
          const count = scenes.filter((s) => s.act === b.act).length
          const on = b.act === act
          return (
            <button
              key={b.act}
              onClick={() => {
                setAct(b.act)
                setPicked(null)
              }}
              className={`shrink-0 border-b-2 px-3 py-2 text-left transition-colors ${
                on ? 'border-bone text-bone' : 'border-transparent text-bone-faint hover:text-bone-dim'
              }`}
            >
              <span className="block font-mono text-[10px] uppercase tracking-[0.14em]">{b.label}</span>
              <span className="mt-0.5 block font-mono text-[9px] tracking-[0.12em] text-bone-faint">{count} scenes</span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 grid gap-5 lg:grid-cols-[240px_1fr]">
        {/* Left: every scene in this act, one line each. */}
        <div className="space-y-px lg:border-r lg:border-bone/8 lg:pr-4">
          {inAct.map((s) => {
            const on = s.id === scene?.id
            return (
              <button
                key={s.id}
                onClick={() => setPicked(s.id)}
                className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors ${
                  on ? 'bg-bone/[0.06] text-bone' : 'text-bone-dim hover:bg-bone/[0.03] hover:text-bone'
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-sans text-[12.5px]">{s.outcome?.banner ?? s.title ?? s.id}</span>
                {/* Kind as a word. It used to be a coloured chip competing with
                  * the choice-quality marks for the same attention. */}
                <span className="shrink-0 font-mono text-[8.5px] uppercase tracking-[0.12em] text-bone-faint">
                  {s.variants?.length ? 'adaptive' : s.kind}
                </span>
              </button>
            )
          })}
        </div>

        {/* Right: one scene, in full. Selecting replaces this pane rather than
          * expanding beneath the list, so the page never lengthens. */}
        {scene && <SceneDetail episode={episode} scene={scene} tech={tech} />}
      </div>

      <button
        onClick={() => setTech((v) => !v)}
        className="mt-5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-bone-faint transition-colors hover:text-bone-dim"
      >
        {tech ? '− technical detail' : '+ technical detail'}
      </button>
    </div>
  )
}

function SceneDetail({ episode, scene: s, tech }: { episode: Episode; scene: Scene; tech: boolean }) {
  const resolve = episodeKnowledgeResolver(episode)

  return (
    <div className="min-w-0 space-y-5">
      <div>
        <Eyebrow>{s.variants?.length ? 'adaptive gate' : s.kind}</Eyebrow>
        <h3 className="mt-1 font-sans text-[17px] font-semibold tracking-[-0.01em] text-bone">
          {s.outcome?.banner ?? s.title ?? s.id}
        </h3>
      </div>

      {!!s.variants?.length && (
        <div className="space-y-1">
          {s.variants.map((v) => (
            <p key={v.sceneId} className="font-sans text-[12px] font-light text-bone-dim">
              Weakest in <span className="text-bone">{conceptLabel(v.conceptFocus)}</span> → {episode.scenes[v.sceneId]?.title}
            </p>
          ))}
        </div>
      )}

      {s.dialogue.length > 0 && (
        <div className="space-y-2">
          {s.dialogue.map((d, i) => (
            <p key={i} className="font-sans text-[12.5px] font-light leading-relaxed text-bone-dim">
              {/* Weight, not colour. Character accents are hex literals in
                * characters.ts, so styling speakers with them made this the one
                * screen that ignored the theme entirely. */}
              <span className="mr-2 font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-bone">
                {d.characterId === 'you' ? 'you' : getCharacter(d.characterId).name.split(' ')[0]}
              </span>
              {d.line}
            </p>
          ))}
        </div>
      )}

      {s.choices && (
        <div className="space-y-1.5">
          {s.choices.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 rounded border border-bone/10 px-2.5 py-2">
              <span className="min-w-0 flex-1 font-sans text-[12.5px] font-light text-bone">{c.text}</span>
              <Chip tone={QUALITY_TONE[c.quality]}>{c.quality}</Chip>
            </div>
          ))}
        </div>
      )}

      {s.outcome && (
        <div>
          <p className="font-sans text-[12.5px] font-light leading-relaxed text-bone-dim">{s.outcome.lesson}</p>
          <div className="mt-2 space-y-1">
            {s.outcome.citations.map((id) => {
              const k = resolve(id)
              return (
                <p key={id} className="font-mono text-[9.5px] leading-relaxed text-bone-faint">
                  <span className="text-bone-dim">{id}</span> {k ? k.rule + ' — ' + k.source.doc + ' § ' + k.source.section : 'UNRESOLVED'}
                </p>
              )
            })}
          </div>
        </div>
      )}

      {tech && (
        <div className="space-y-2 border-t border-bone/10 pt-4">
          <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-bone-faint">
            {s.id}
            {s.next ? ' → ' + s.next : ''}
          </p>
          {s.choices && (
            <div className="space-y-0.5">
              {s.choices.map((c) => (
                <p key={c.id} className="font-mono text-[9.5px] text-bone-faint">
                  {c.label} → {c.consequenceSceneId}
                </p>
              ))}
            </div>
          )}
          <div>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-bone-faint">
              shot · {s.shot.env} · {s.shot.time} · {s.shot.mood}
              {s.shot.durationSec ? ' · ' + s.shot.durationSec + 's' : ''}
              {s.shot.camera ? ' · ' + s.shot.camera : ''}
            </p>
            <p className="mt-1 font-sans text-[11.5px] font-light leading-relaxed text-bone-faint">{s.shot.prompt}</p>
          </div>
        </div>
      )}
    </div>
  )
}
