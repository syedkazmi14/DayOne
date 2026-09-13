import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Play } from 'lucide-react'
import { getCharacter } from '@/content/characters'
import { useGame } from '@/engine/gameStore'
import { lineupFor } from '@/engine/lineup'
import { overallKnowledge } from '@/engine/adaptive'
import { CastSwitcher } from '../CastSwitcher'
import { EpisodeStill } from '../ui/EpisodeStill'
import { CHARACTER_WIDTHS, preloadImage } from '../ui/responsiveImage'

/* ============================================================================
 * The lobby. First impression has to read "interactive show", not "LMS".
 *
 * Every show plays the same lineup — First Day plus every topic the admin has
 * published — recast with the chosen show's characters (src/engine/lineup.ts).
 * Switching show changes who is in the episodes, never which episodes exist, so
 * everything on the shelf is playable.
 * ========================================================================== */

const episodeLabel = (n: number) => `Episode ${String(n).padStart(2, '0')}`

export function Home() {
  const { state, dispatch, group } = useGame()
  const lineup = lineupFor(group.id, state.published)
  const featured = lineup[0]
  const know = Math.round(overallKnowledge(state.player.mastery) * 100)

  /* Starting the featured episode goes straight to the intro screen, whose cast
   * strip draws these four at 58px — a rung nothing on this screen has loaded.
   * Warm it here so that screen paints with art instead of fading it in. */
  const castIds = featured?.episode.cast
  useEffect(() => {
    for (const id of castIds ?? []) preloadImage(getCharacter(id).avatar?.src, CHARACTER_WIDTHS, '58px')
  }, [castIds])

  return (
    <div className="relative h-full overflow-y-auto">
      {/* hero */}
      <div className="relative min-h-[64vh] w-full overflow-hidden">
        {featured ? (
          <EpisodeStill episode={featured.episode} sceneKey={`home-hero-${featured.episode.id}-${group.id}`} priority />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900" />
        )}
        <div className="scrim-left absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-900 to-transparent" />

        <div className="relative flex min-h-[64vh] flex-col justify-center px-6 pb-16 pt-36 sm:px-12 lg:px-20">
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
              {(featured?.episode.title ?? 'DayOne').split(' ').map((word, i) => (
                <span key={`${word}-${i}`} className="block">
                  {word}
                </span>
              ))}
            </h1>

            <p className="mt-5 max-w-lg font-sans text-[15.5px] font-light leading-relaxed text-bone-dim sm:text-[16.5px]">
              {featured?.episode.synopsis}
            </p>

            {featured && (
              <div className="mt-5 flex items-center gap-2 font-sans text-[13px] text-bone-dim">
                <span>{featured.episode.topic}</span>
                <span className="text-bone-faint">·</span>
                <span>{featured.episode.duration}</span>
              </div>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-5">
              {featured && (
                <button
                  onClick={() => dispatch({ type: 'SELECT_EPISODE', episodeId: featured.episode.id })}
                  className="inline-flex items-center gap-2.5 rounded bg-signal px-7 py-3.5 font-sans text-[14px] font-medium text-ink-900 transition-colors duration-200 hover:bg-signal-hot"
                >
                  <Play size={14} fill="currentColor" />
                  {state.player.completedEpisodes.includes(featured.episode.id) ? 'Replay episode' : 'Start episode'}
                </button>
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
          <CastSwitcher className="order-first mb-8 self-end lg:absolute lg:right-6 lg:top-28 lg:order-none lg:mb-0 xl:right-12" />
        </div>
      </div>

      {/* episode shelf */}
      <div className="px-6 pb-36 pt-6 sm:px-12 lg:px-20">
        <div className="mb-6 flex flex-wrap items-baseline gap-3">
          <h2 className="t-section">Episodes</h2>
          <span className="font-mono text-[10px] text-bone-faint">
            {lineup.filter((e) => state.player.completedEpisodes.includes(e.episode.id)).length} / {lineup.length} complete
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {lineup.map(({ episode: ep, number, generated }, i) => {
            const done = state.player.completedEpisodes.includes(ep.id)
            return (
              <motion.button
                key={ep.id}
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 + i * 0.07, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => dispatch({ type: 'SELECT_EPISODE', episodeId: ep.id })}
                className="group relative h-[280px] overflow-hidden rounded border border-bone/10 text-left transition-colors duration-300 hover:border-signal/45"
              >
                {/* card art — the show's still for authored episodes, the cold-open
                  * asset (or procedural previs) for admin-built ones */}
                <div className="absolute inset-0 transition-transform duration-700 group-hover:scale-[1.04]">
                  <EpisodeStill episode={ep} sceneKey={`card-${ep.id}-${group.id}`} paused />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/72 to-ink-900/25" />

                <div className="relative flex h-full flex-col justify-end p-5">
                  <div className="mb-auto flex items-center justify-between gap-3 font-sans text-[12px] text-bone-faint">
                    <span>{episodeLabel(number)}</span>
                    {generated && <span className="text-cyan">From your company's material</span>}
                  </div>

                  <h3 className="t-display text-[27px] text-bone">{ep.title}</h3>
                  <p className="mt-2 font-sans text-[13px] font-light leading-snug text-bone-dim">{ep.subtitle}</p>
                  <div className="mt-3 flex items-center justify-between gap-3 font-sans text-[12px]">
                    <span className="text-bone-dim">{ep.topic}</span>
                    <span className="text-bone-dim">{done ? 'Complete' : ep.duration}</span>
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
