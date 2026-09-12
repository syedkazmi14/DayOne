import { motion } from 'framer-motion'
import { Lock, Play } from 'lucide-react'
import { episodesForGroup, featuredEpisode } from '@/content/episodes'
import { useGame } from '@/engine/gameStore'
import { overallKnowledge } from '@/engine/adaptive'
import { CastSwitcher } from '../CastSwitcher'
import { EpisodeStill } from '../ui/EpisodeStill'

/* ============================================================================
 * The lobby. First impression has to read "interactive show", not "LMS".
 *
 * Two things, and only two: the featured episode as a full-bleed hero with the
 * cast switcher in its corner, and the episode shelf underneath. Both read the
 * selected group, so switching the cast reshelves the episodes. Nothing about
 * the number of groups or characters is encoded here — see
 * src/content/characterGroups.ts.
 * ========================================================================== */

const episodeLabel = (n: number) => `Episode ${String(n).padStart(2, '0')}`

export function Home() {
  const { state, dispatch, group } = useGame()
  const featured = featuredEpisode(group.id)
  const shelf = episodesForGroup(group.id)
  const know = Math.round(overallKnowledge(state.player.mastery) * 100)
  const playable = featured && !featured.locked

  return (
    <div className="relative h-full overflow-y-auto">
      {/* hero */}
      <div className="relative min-h-[58vh] w-full overflow-hidden">
        {featured ? (
          <EpisodeStill episode={featured} sceneKey={`home-hero-${featured.id}`} priority />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/80 to-ink-900/30" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-900 to-transparent" />

        <div className="relative flex min-h-[58vh] flex-col justify-center px-6 py-16 sm:px-12 lg:px-20">
          <motion.div
            key={group.id}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            {featured && (
              <div className="mb-4 font-sans text-[12.5px] text-bone-dim">{episodeLabel(featured.number)}</div>
            )}

            <h1 className="t-display text-[clamp(2.5rem,7vw,4.75rem)] text-bone">
              {(featured?.title ?? 'DayOne').split(' ').map((word) => (
                <span key={word} className="block">
                  {word}
                </span>
              ))}
            </h1>

            <p className="mt-5 max-w-lg font-sans text-[15.5px] font-light leading-relaxed text-bone-dim sm:text-[16.5px]">
              {featured?.synopsis}
            </p>

            {featured && (
              <div className="mt-5 flex items-center gap-2 font-sans text-[13px] text-bone-dim">
                <span>{featured.topic}</span>
                <span className="text-bone-faint">·</span>
                <span>{featured.duration}</span>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-5">
              {featured && playable ? (
                <button
                  onClick={() => dispatch({ type: 'SELECT_EPISODE', episodeId: featured.id })}
                  className="inline-flex items-center gap-2.5 bg-signal px-7 py-3.5 font-sans text-[14px] font-medium text-ink-900 transition-colors duration-200 hover:bg-signal-hot"
                >
                  <Play size={14} fill="currentColor" />
                  {state.player.completedEpisodes.includes(featured.id) ? 'Replay episode' : 'Start episode'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-2.5 border border-bone/15 px-7 py-3.5 font-sans text-[14px] text-bone-faint">
                  <Lock size={13} />
                  Episode in authoring
                </span>
              )}
              <div className="font-sans text-[13px] leading-relaxed text-bone-faint">
                Progress {know}%
                <br />
                Level {state.player.level} · {state.player.credits.toLocaleString()} credits
              </div>
            </div>
          </motion.div>

          {/* cast switcher: pinned to the hero's top-right where there is
            * room for it, and in normal flow above the title when there is not */}
          <CastSwitcher className="order-first mb-8 self-end lg:absolute lg:right-6 lg:top-20 lg:order-none lg:mb-0 xl:right-12" />
        </div>
      </div>

      {/* episode shelf */}
      <div className="px-6 pb-24 pt-8 sm:px-12 lg:px-20">
        <div className="mb-5 flex items-baseline gap-3">
          <h2 className="t-section">Episodes</h2>
          <span className="font-sans text-[13px] text-bone-faint">Season 1</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shelf.map((ep, i) => {
            const done = state.player.completedEpisodes.includes(ep.id)
            return (
              <motion.button
                key={ep.id}
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 + i * 0.07, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                disabled={ep.locked}
                onClick={() => dispatch({ type: 'SELECT_EPISODE', episodeId: ep.id })}
                className={`group relative h-[280px] overflow-hidden border text-left transition-colors duration-300 ${
                  ep.locked ? 'cursor-not-allowed border-bone/8' : 'border-bone/10 hover:border-signal/45'
                }`}
              >
                {/* card art — episode.image, with the procedural shot as backup.
                  * Locked art is dimmed rather than fully desaturated: the shelf
                  * should read as "not yet", not as broken. */}
                <div
                  className={`absolute inset-0 transition-transform duration-700 ${
                    ep.locked ? 'opacity-70 grayscale-[.65]' : 'group-hover:scale-[1.04]'
                  }`}
                >
                  <EpisodeStill episode={ep} sceneKey={`card-${ep.id}`} paused />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/72 to-ink-900/25" />

                <div className="relative flex h-full flex-col justify-end p-5">
                  <span className="mb-auto font-sans text-[12px] text-bone-faint">{episodeLabel(ep.number)}</span>

                  <h3 className="t-display text-[27px] text-bone">{ep.title}</h3>
                  <p className="mt-2 font-sans text-[13px] font-light leading-snug text-bone-dim">{ep.subtitle}</p>
                  <div className="mt-3 flex items-center justify-between gap-3 font-sans text-[12px]">
                    <span className="text-bone-dim">{ep.topic}</span>
                    <span className="flex items-center gap-1.5 text-bone-dim">
                      {ep.locked ? (
                        <>
                          <Lock size={11} /> Locked
                        </>
                      ) : done ? (
                        'Complete'
                      ) : (
                        ep.duration
                      )}
                    </span>
                  </div>
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
