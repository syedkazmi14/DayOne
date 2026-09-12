import { ArrowRight } from 'lucide-react'
import { conceptLabel } from '@/content/knowledge'
import { PLAYER_LENSES, selectVariant } from '@/engine/adaptive'
import type { Episode } from '@/types'
import { Eyebrow } from '../ui/Bits'

/* ============================================================================
 * PLAYER LENS — the same published graph, seen by two different employees.
 * The act three each gets comes from selectVariant(), the function the reducer
 * itself calls. No randomness, no model.
 * ========================================================================== */

export function PlayerLensPanel({ episode }: { episode: Episode }) {
  const gate = Object.values(episode.scenes).find((s) => s.variants?.length)
  if (!gate) return <p className="font-mono text-[10px] text-bone-faint">This episode has no adaptive slot.</p>

  const picks = PLAYER_LENSES.map((lens) => ({ lens, pick: selectVariant(gate, lens.mastery) }))
  const differ = new Set(picks.map((p) => p.pick.sceneId)).size > 1

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {picks.map(({ lens, pick }) => {
          const scene = episode.scenes[pick.sceneId]
          return (
            <div key={lens.id} className="glass p-5" data-lens-scene={pick.sceneId}>
              <Eyebrow className="text-signal">{lens.name}</Eyebrow>
              <p className="mt-1 font-sans text-[12.5px] font-light text-bone-dim">{lens.summary}</p>

              <div className="mt-4 space-y-1.5">
                {gate.variants!.map((v) => {
                  const score = lens.mastery[v.conceptFocus].score
                  const on = v.conceptFocus === pick.focus
                  return (
                    <div key={v.conceptFocus} className="flex items-center gap-2">
                      <span className={`w-[120px] shrink-0 font-mono text-[9.5px] uppercase tracking-wide ${on ? 'text-cyan' : 'text-bone-faint'}`}>
                        {conceptLabel(v.conceptFocus)}
                      </span>
                      <span className="block h-[3px] flex-1 overflow-hidden rail">
                        <span className={`block h-full ${on ? 'bg-cyan' : 'bg-bone/30'}`} style={{ width: `${score * 100}%` }} />
                      </span>
                      <span className="w-7 text-right font-mono text-[10px] tabular-nums text-bone-dim">{Math.round(score * 100)}</span>
                    </div>
                  )
                })}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-bone/10 pt-3">
                <ArrowRight size={12} className="shrink-0 text-cyan" />
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">act 3</span>
                <span className="min-w-0 truncate font-sans text-[14px] font-bold uppercase tracking-[0.04em] text-bone">
                  {scene?.title ?? pick.sceneId}
                </span>
              </div>
              <p className="mt-1.5 font-sans text-[12px] font-light leading-snug text-bone-dim">{pick.rationale}</p>
            </div>
          )
        })}
      </div>
      <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-bone-faint">
        {differ
          ? 'same graph · same reducer · different mastery → different act three'
          : 'both profiles share a weakest concept on this topic — widen the topic for more adaptive range'}
      </p>
    </div>
  )
}
