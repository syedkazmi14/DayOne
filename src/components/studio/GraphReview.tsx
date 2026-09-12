import { ChevronDown, GitBranch } from 'lucide-react'
import { useState } from 'react'
import { getCharacter } from '@/content/characters'
import { conceptLabel } from '@/content/knowledge'
import { presentationOf, visualTierOf } from '@/media/assetPlan'
import { episodeKnowledgeResolver, successors, type GraphReport } from '@/engine/validateEpisode'
import type { Episode, Scene } from '@/types'
import { Chip, Eyebrow } from '../ui/Bits'

/* ============================================================================
 * GRAPH REVIEW — Episode → Acts → Scenes → Choices → Consequences → Citations
 * → Shot specs → Assets. What the generator produced, and whether the engine
 * will accept it.
 * ========================================================================== */

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

const KIND_TONE = { cinematic: 'neutral', decision: 'signal', consequence: 'neutral', debrief: 'neutral', ending: 'cyan' } as const
const QUALITY_TONE = { best: 'good', acceptable: 'signal', poor: 'danger' } as const
const OUTCOME_TONE = { good: 'good', mixed: 'signal', bad: 'danger' } as const

export function GraphReview({ episode, report }: { episode: Episode; report: GraphReport }) {
  const scenes = orderedScenes(episode)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {report.ok ? <Chip tone="good">validated · playable</Chip> : <Chip tone="danger">{report.errors.length} graph errors</Chip>}
        <Chip>
          {report.reachable}/{report.total} reachable
        </Chip>
        <Chip>{report.decisions} decisions</Chip>
        <Chip tone="cyan">{report.adaptiveVariants} adaptive variants</Chip>
        <Chip>{report.terminals.length} ending</Chip>
      </div>
      {!report.ok && (
        <ul className="mt-3 space-y-1">
          {report.errors.slice(0, 8).map((e, i) => (
            <li key={i} className="font-mono text-[10px] text-danger">
              {e.sceneId} · {e.message}
            </li>
          ))}
        </ul>
      )}

      {episode.provenance && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1">
          {Object.entries(episode.provenance.roles).map(([id, role]) => (
            <span key={id} className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-bone-faint">
              <span style={{ color: getCharacter(id).accent }}>{getCharacter(id).name}</span> · {role}
            </span>
          ))}
        </div>
      )}

      {episode.beats.map((beat) => {
        const inAct = scenes.filter((s) => s.act === beat.act)
        if (!inAct.length) return null
        return (
          <div key={beat.act} className="mt-7">
            <Eyebrow className="mb-2">
              act {beat.act} · {beat.label}
            </Eyebrow>
            <div className="space-y-px">
              {inAct.map((s) => (
                <SceneRow key={s.id} episode={episode} scene={s} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SceneRow({ episode, scene: s }: { episode: Episode; scene: Scene }) {
  const [open, setOpen] = useState(false)
  const resolve = episodeKnowledgeResolver(episode)
  const tier = visualTierOf(s.assets)
  const isGate = !!s.variants?.length

  return (
    <div className="rounded border border-bone/8 bg-ink-900/30">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left">
        {isGate ? <GitBranch size={12} className="shrink-0 text-cyan" /> : null}
        <Chip tone={s.outcome ? OUTCOME_TONE[s.outcome.tone] : KIND_TONE[s.kind]}>{isGate ? 'adaptive' : s.kind}</Chip>
        <span className="min-w-0 flex-1 truncate font-sans text-[13px] text-bone">{s.outcome?.banner ?? s.title ?? s.id}</span>
        <span className="hidden font-mono text-[9px] text-bone-faint sm:inline">{s.id}</span>
        {!isGate && (
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-bone-faint sm:inline">
            {presentationOf(s)} · {tier === 'procedural' ? 'previs' : tier}
          </span>
        )}
        {s.threat && (
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-signal md:inline">
            {s.threat.source} · {s.threat.pressure}
          </span>
        )}
        <ChevronDown size={12} className={`shrink-0 text-bone-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-bone/8 px-3 py-3">
          {isGate && (
            <div className="space-y-1">
              {s.variants!.map((v) => (
                <div key={v.sceneId} className="font-mono text-[10px] text-bone-dim">
                  weakest = <span className="text-cyan">{conceptLabel(v.conceptFocus)}</span> ⇒ {v.sceneId} ·{' '}
                  {episode.scenes[v.sceneId]?.title}
                </div>
              ))}
            </div>
          )}

          {s.dialogue.length > 0 && (
            <div className="space-y-1.5">
              {s.dialogue.map((d, i) => {
                const ch = getCharacter(d.characterId)
                return (
                  <p key={i} className="font-sans text-[12px] font-light leading-snug text-bone-dim">
                    <span className="mr-2 font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: ch.accent }}>
                      {d.characterId === 'you' ? 'you' : ch.name.split(' ')[0]}
                    </span>
                    {d.line}
                    {s.assets?.audio?.[i] && <span className="ml-2 font-mono text-[8.5px] uppercase text-good">voiced</span>}
                  </p>
                )
              })}
            </div>
          )}

          {s.choices && (
            <div className="space-y-1.5">
              {s.choices.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded border border-bone/10 px-2.5 py-2">
                  <span className="font-mono text-[11px] text-bone-dim">{c.label}</span>
                  <span className="min-w-0 flex-1 font-sans text-[12.5px] font-light text-bone">{c.text}</span>
                  <Chip tone={QUALITY_TONE[c.quality]}>{c.quality}</Chip>
                  <span className="font-mono text-[9px] text-bone-faint">→ {c.consequenceSceneId}</span>
                </div>
              ))}
            </div>
          )}

          {s.outcome && (
            <div>
              <p className="font-sans text-[12px] font-light leading-relaxed text-bone-dim">{s.outcome.lesson}</p>
              <div className="mt-2 space-y-1">
                {s.outcome.citations.map((id) => {
                  const k = resolve(id)
                  return (
                    <p key={id} className="font-mono text-[9.5px] leading-relaxed text-bone-faint">
                      <span className="text-signal">{id}</span> {k ? `${k.rule} — ${k.source.doc} § ${k.source.section}` : 'UNRESOLVED'}
                    </p>
                  )
                })}
              </div>
            </div>
          )}

          {s.next && <p className="font-mono text-[9.5px] text-bone-faint">next → {s.next}</p>}

          <div className="border-l-2 border-signal/30 pl-3">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-signal">
              shot spec · {s.shot.env} · {s.shot.time} · {s.shot.mood} · {presentationOf(s)}
              {s.shot.durationSec ? ` · ${s.shot.durationSec}s` : ''}
              {s.shot.camera ? ` · ${s.shot.camera}` : ''}
            </div>
            <p className="mt-1 font-sans text-[11.5px] font-light leading-relaxed text-bone-dim">{s.shot.prompt}</p>
            {(s.assets?.video || s.assets?.background) && (
              <p className="mt-1 font-mono text-[9px] text-bone-faint">
                {s.assets.video && `video: ${s.assets.video.tier} · ${s.assets.video.provider}${s.assets.video.storageKey ? ` · ${s.assets.video.storageKey}` : ''}`}
                {s.assets.background && ` background: ${s.assets.background.tier} · ${s.assets.background.provider}`}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
