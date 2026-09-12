import { motion } from 'framer-motion'
import { ArrowLeft, Play, Sparkles } from 'lucide-react'
import { getCharacter } from '@/content/characters'
import { conceptLabel } from '@/content/knowledge'
import { useGame } from '@/engine/gameStore'
import { weakestConcept } from '@/engine/adaptive'
import { SceneCanvas } from '../SceneCanvas'
import { Chip, Eyebrow } from '../ui/Bits'
import { CharacterPortrait } from '../ui/CharacterPortrait'

export function EpisodeIntro() {
  const { state, dispatch, episode } = useGame()
  if (!episode) return null

  const entry = episode.scenes[episode.entrySceneId]
  const adaptiveSlot = Object.values(episode.scenes).find((s) => s.variants?.length)
  const focus = adaptiveSlot
    ? weakestConcept(state.player.mastery, adaptiveSlot.variants!.map((v) => v.conceptFocus))
    : null

  return (
    <div className="relative h-full overflow-hidden">
      <SceneCanvas shot={entry.shot} sceneKey={`intro-${episode.id}`} />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/80 to-ink-900/35" />

      <button
        onClick={() => dispatch({ type: 'GOTO', view: 'home' })}
        className="absolute left-6 top-6 z-20 flex items-center gap-2 font-mono text-[10px] uppercase tracking-ultra text-bone-dim transition-colors hover:text-bone sm:left-10"
      >
        <ArrowLeft size={13} /> episodes
      </button>

      <div className="relative flex h-full items-end overflow-y-auto">
        <div className="w-full px-6 pb-14 pt-24 sm:px-12 lg:px-20">
          <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-end">
            {/* left: title block */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="h-px w-10 bg-signal" />
                <Eyebrow className="text-signal">{episode.code}</Eyebrow>
                <Eyebrow>{episode.topic}</Eyebrow>
              </div>

              <h1 className="t-display text-[clamp(3rem,10vw,6.6rem)] text-bone">{episode.title}</h1>

              <p className="mt-5 max-w-xl font-sans text-[17px] font-light leading-relaxed text-bone sm:text-[20px]">
                {episode.subtitle}
              </p>
              <p className="mt-3 max-w-xl font-sans text-[14px] font-light leading-relaxed text-bone-faint">
                {episode.synopsis}
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                {episode.concepts.map((c) => (
                  <Chip key={c}>{conceptLabel(c)}</Chip>
                ))}
              </div>

              {focus && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="glass mt-7 max-w-xl p-4"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <Sparkles size={12} className="text-cyan" />
                    <span className="t-eyebrow text-cyan">personalised before you start</span>
                  </div>
                  <p className="font-sans text-[13.5px] font-light leading-relaxed text-bone-dim">
                    Act three will be built around <span className="text-bone">{conceptLabel(focus).toLowerCase()}</span> —
                    currently your weakest demonstrated area at{' '}
                    {Math.round(state.player.mastery[focus].score * 100)}%. Another employee opening this same episode
                    gets a different act three.
                  </p>
                </motion.div>
              )}

              <div className="mt-9">
                <button
                  onClick={() => dispatch({ type: 'START_EPISODE' })}
                  className="group inline-flex items-center gap-3 bg-signal px-10 py-4 font-mono text-[12px] uppercase tracking-ultra text-ink-900 transition-all duration-300 hover:bg-signal-hot hover:shadow-[0_0_60px_-12px_rgba(245,165,36,.8)]"
                >
                  <Play size={14} fill="currentColor" />
                  start episode
                </button>
                <p className="mt-3 font-mono text-[9px] uppercase tracking-[0.16em] text-bone-faint">
                  {episode.duration} · {episode.beats.length} acts · consequences are permanent within a run
                </p>
              </div>
            </motion.div>

            {/* right: cast */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            >
              <Eyebrow className="mb-4">cast</Eyebrow>
              <div className="space-y-2">
                {episode.cast.map((id, i) => {
                  const ch = getCharacter(id)
                  return (
                    <motion.div
                      key={id}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.35 + i * 0.09 }}
                      className="glass flex items-center gap-4 p-3"
                    >
                      <CharacterPortrait character={ch} size={58} />
                      <div className="min-w-0">
                        <div className="font-sans text-[13px] font-bold uppercase tracking-[0.06em]" style={{ color: ch.accent }}>
                          {ch.name}
                        </div>
                        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-bone-faint">{ch.role}</div>
                        <div className="mt-1 font-sans text-[12px] font-light italic leading-snug text-bone-dim">
                          {ch.tagline}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
              <p className="mt-4 font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-bone-faint">
                original placeholder cast · licensed or customer-recorded characters swap in at the asset layer
              </p>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}
