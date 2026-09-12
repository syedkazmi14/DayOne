import { motion } from 'framer-motion'
import { Clock, Lock, Play } from 'lucide-react'
import { episodes } from '@/content/episodes'
import { getCharacter } from '@/content/characters'
import { useGame } from '@/engine/gameStore'
import { overallKnowledge } from '@/engine/adaptive'
import { SceneCanvas } from '../SceneCanvas'
import { Chip, Eyebrow } from '../ui/Bits'
import { CharacterPortrait } from '../ui/CharacterPortrait'

/* ============================================================================
 * The lobby. First impression has to read "interactive show", not "LMS".
 * ========================================================================== */

export function Home() {
  const { state, dispatch } = useGame()
  const featured = episodes[0]
  const know = Math.round(overallKnowledge(state.player.mastery) * 100)

  return (
    <div className="relative h-full overflow-y-auto">
      {/* hero */}
      <div className="relative min-h-[74vh] w-full overflow-hidden">
        <SceneCanvas shot={featured.scenes[featured.entrySceneId].shot} sceneKey="home-hero" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/75 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-900 to-transparent" />

        <div className="relative flex min-h-[74vh] flex-col justify-center px-6 py-16 sm:px-12 lg:px-20">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-12 bg-signal" />
              <Eyebrow className="text-signal">now playing · episode 01</Eyebrow>
            </div>

            <h1 className="t-display text-[clamp(3.4rem,11vw,7.5rem)] text-bone">
              FIRST
              <br />
              DAY
            </h1>

            <p className="mt-6 max-w-lg font-sans text-[16px] font-light leading-relaxed text-bone-dim sm:text-[18px]">
              {featured.synopsis}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Chip tone="signal">{featured.topic}</Chip>
              <Chip>
                <Clock size={10} /> {featured.duration}
              </Chip>
              <Chip>4 decisions</Chip>
              <Chip tone="cyan">adaptive act 3</Chip>
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <button
                onClick={() => dispatch({ type: 'SELECT_EPISODE', episodeId: featured.id })}
                className="group inline-flex items-center gap-3 bg-signal px-8 py-4 font-mono text-[12px] uppercase tracking-ultra text-ink-900 transition-all duration-300 hover:bg-signal-hot hover:shadow-[0_0_50px_-10px_rgba(245,165,36,.7)]"
              >
                <Play size={14} fill="currentColor" />
                {state.player.completedEpisodes.includes(featured.id) ? 'replay episode' : 'start episode'}
              </button>
              <div className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-bone-faint">
                your knowledge · {know}%
                <br />
                level {state.player.level} · {state.player.credits.toLocaleString()} cr
              </div>
            </div>
          </motion.div>

          {/* cast strip */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.9 }}
            className="pointer-events-none absolute bottom-8 right-6 hidden items-end gap-1 lg:flex"
          >
            {featured.cast.map((id, i) => {
              const ch = getCharacter(id)
              return (
                <div key={id} className="text-center" style={{ opacity: 1 - i * 0.14 }}>
                  <CharacterPortrait character={ch} size={78} />
                  <div className="mt-1 font-mono text-[8px] uppercase tracking-[0.16em]" style={{ color: ch.accent }}>
                    {ch.name.split(' ')[0]}
                  </div>
                </div>
              )
            })}
          </motion.div>
        </div>
      </div>

      {/* episode shelf */}
      <div className="px-6 pb-36 sm:px-12 lg:px-20">
        <div className="mb-6 flex items-baseline justify-between">
          <Eyebrow>season one · your training. your choices.</Eyebrow>
          <span className="font-mono text-[10px] text-bone-faint">
            {state.player.completedEpisodes.length} / {episodes.length} complete
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {episodes.map((ep, i) => {
            const done = state.player.completedEpisodes.includes(ep.id)
            return (
              <motion.button
                key={ep.id}
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                disabled={ep.locked}
                onClick={() => dispatch({ type: 'SELECT_EPISODE', episodeId: ep.id })}
                className={`group relative h-[280px] overflow-hidden border text-left transition-all duration-500 ${
                  ep.locked
                    ? 'cursor-not-allowed border-bone/8'
                    : 'border-bone/12 hover:border-signal/50 hover:shadow-[0_20px_60px_-30px_rgba(0,0,0,.9)]'
                }`}
              >
                {/* card art */}
                <div className={`absolute inset-0 transition-all duration-700 ${ep.locked ? 'grayscale' : 'group-hover:scale-[1.04]'}`}>
                  {(() => {
                    const art = ep.entrySceneId ? ep.scenes[ep.entrySceneId]?.shot : ep.poster
                    return art ? (
                      <SceneCanvas shot={art} sceneKey={`card-${ep.id}`} paused />
                    ) : (
                      <div className="h-full w-full bg-gradient-to-br from-ink-700 to-ink-900" />
                    )
                  })()}
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/70 to-ink-900/20" />

                <div className="relative flex h-full flex-col justify-end p-5">
                  <div className="mb-auto flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-ultra text-bone-faint">{ep.code}</span>
                    {ep.locked ? (
                      <Lock size={13} className="text-bone-faint" />
                    ) : done ? (
                      <Chip tone="good">complete</Chip>
                    ) : (
                      <Chip tone="signal">unlocked</Chip>
                    )}
                  </div>

                  <h3 className="t-display text-3xl text-bone">{ep.title}</h3>
                  <p className="mt-2 font-sans text-[12.5px] font-light leading-snug text-bone-dim">{ep.subtitle}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-signal">{ep.topic}</span>
                    <span className="h-px flex-1 bg-bone/10" />
                    <span className="font-mono text-[9px] text-bone-faint">{ep.locked ? 'locked' : ep.duration}</span>
                  </div>
                </div>
              </motion.button>
            )
          })}
        </div>

        <p className="mt-10 max-w-2xl font-sans text-[13px] font-light leading-relaxed text-bone-faint">
          Every episode in this library was generated from company onboarding material — handbooks, policy PDFs, decks
          and a 31-minute briefing video. Open{' '}
          <button onClick={() => dispatch({ type: 'GOTO', view: 'authoring' })} className="text-signal underline decoration-signal/40 underline-offset-4">
            STUDIO
          </button>{' '}
          to watch that pipeline run.
        </p>
      </div>
    </div>
  )
}
