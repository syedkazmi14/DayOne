import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Clock, Lock, Play } from 'lucide-react'
import { episodesForGroup, featuredEpisode } from '@/content/episodes'
import { getCharacter } from '@/content/characters'
import { useGame } from '@/engine/gameStore'
import { overallKnowledge } from '@/engine/adaptive'
import { CharacterCarousel } from '../CharacterCarousel'
import { Chip, Eyebrow } from '../ui/Bits'
import { CharacterAvatar } from '../ui/CharacterAvatar'
import { EpisodeStill } from '../ui/EpisodeStill'
import { CHARACTER_WIDTHS, preloadImage } from '../ui/responsiveImage'

/* ============================================================================
 * The lobby. First impression has to read "interactive show", not "LMS".
 *
 * Everything on this screen is derived from the group the carousel is resting
 * on: the hero, the cast strip and the episode shelf. Nothing about the number
 * of groups or characters is encoded here — see src/content/characterGroups.ts.
 * ========================================================================== */

export function Home() {
  const { state, dispatch, group, selectedCharacter } = useGame()
  const featured = featuredEpisode(group.id)
  const shelf = episodesForGroup(group.id)
  const know = Math.round(overallKnowledge(state.player.mastery) * 100)
  const playable = featured && !featured.locked

  /* Starting the featured episode goes straight to the intro screen, whose
   * cast strip is the first thing that needs art. Those avatars are drawn at
   * 58px there, so this warms the same small rung the intro will ask for — the
   * hero still it also shows is already the one loaded behind this screen. */
  const castIds = featured?.cast
  useEffect(() => {
    for (const id of castIds ?? []) preloadImage(getCharacter(id).avatar?.src, CHARACTER_WIDTHS, '58px')
  }, [castIds])

  return (
    <div className="relative h-full overflow-y-auto">
      {/* hero */}
      <div className="relative min-h-[68vh] w-full overflow-hidden">
        {featured ? (
          <EpisodeStill episode={featured} sceneKey={`home-hero-${featured.id}`} priority />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-ink-900 via-ink-900/80 to-ink-900/30" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink-900 to-transparent" />

        <div className="relative flex min-h-[68vh] flex-col justify-center px-6 py-16 sm:px-12 lg:px-20">
          <motion.div
            key={group.id}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl"
          >
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <span className="h-px w-12" style={{ background: group.accent }} />
              <Eyebrow style={{ color: group.accent }}>
                {playable ? 'now playing' : 'coming soon'} · {group.name}
              </Eyebrow>
            </div>

            <h1 className="t-display text-[clamp(3rem,10vw,7rem)] text-bone">
              {(featured?.title ?? 'ONBOARD').split(' ').map((word) => (
                <span key={word} className="block">
                  {word}
                </span>
              ))}
            </h1>

            <p className="mt-6 max-w-lg font-sans text-[16px] font-light leading-relaxed text-bone-dim sm:text-[18px]">
              {featured?.synopsis}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              {featured && <Chip tone="signal">{featured.topic}</Chip>}
              {featured && (
                <Chip>
                  <Clock size={10} /> {featured.duration}
                </Chip>
              )}
              {playable && <Chip>4 decisions</Chip>}
              {playable && <Chip tone="cyan">adaptive act 3</Chip>}
            </div>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              {featured && playable ? (
                <button
                  onClick={() => dispatch({ type: 'SELECT_EPISODE', episodeId: featured.id })}
                  className="group inline-flex items-center gap-3 bg-signal px-8 py-4 font-mono text-[12px] uppercase tracking-ultra text-ink-900 transition-all duration-300 hover:bg-signal-hot hover:shadow-[0_0_50px_-10px_rgba(245,165,36,.7)]"
                >
                  <Play size={14} fill="currentColor" />
                  {state.player.completedEpisodes.includes(featured.id) ? 'replay episode' : 'start episode'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-3 border border-bone/15 px-8 py-4 font-mono text-[12px] uppercase tracking-ultra text-bone-faint">
                  <Lock size={13} />
                  episode in authoring
                </span>
              )}
              <div className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.16em] text-bone-faint">
                your knowledge · {know}%
                <br />
                level {state.player.level} · {state.player.credits.toLocaleString()} cr
              </div>
            </div>
          </motion.div>

          {/* cast strip — the group's four, or the one the player picked */}
          <motion.div
            key={`cast-${group.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="pointer-events-none absolute bottom-8 right-6 hidden items-end gap-2 lg:flex"
          >
            {group.characterIds.map((id, i) => {
              const ch = getCharacter(id)
              const isPicked = selectedCharacter?.id === ch.id
              return (
                <div key={id} className="text-center" style={{ opacity: isPicked ? 1 : 1 - i * 0.12 }}>
                  <CharacterAvatar
                    character={ch}
                    size={74}
                    priority
                    dim={!!selectedCharacter && !isPicked}
                    className="border border-bone/10"
                  />
                  <div
                    className="mt-1 font-mono text-[8px] uppercase tracking-[0.16em]"
                    style={{ color: ch.accent }}
                  >
                    {ch.name.split(' ')[0]}
                  </div>
                </div>
              )
            })}
          </motion.div>
        </div>
      </div>

      {/* roster carousel */}
      <div className="relative -mt-6 pb-2">
        <CharacterCarousel />
      </div>

      {/* episode shelf */}
      <div className="px-6 pb-36 pt-12 sm:px-12 lg:px-20">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow>
            {group.name} · season one · your training. your choices.
          </Eyebrow>
          <span className="font-mono text-[10px] text-bone-faint">
            {shelf.filter((e) => state.player.completedEpisodes.includes(e.id)).length} / {shelf.length} complete
          </span>
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
                className={`group relative h-[280px] overflow-hidden border text-left transition-all duration-500 ${
                  ep.locked
                    ? 'cursor-not-allowed border-bone/8'
                    : 'border-bone/12 hover:border-signal/50 hover:shadow-[0_20px_60px_-30px_rgba(0,0,0,.9)]'
                }`}
              >
                {/* card art — episode.image, with the procedural shot as backup */}
                <div
                  className={`absolute inset-0 transition-all duration-700 ${
                    ep.locked ? 'grayscale' : 'group-hover:scale-[1.04]'
                  }`}
                >
                  <EpisodeStill episode={ep} sceneKey={`card-${ep.id}`} paused />
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/72 to-ink-900/25" />

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
          <button
            onClick={() => dispatch({ type: 'GOTO', view: 'authoring' })}
            className="text-signal underline decoration-signal/40 underline-offset-4"
          >
            STUDIO
          </button>{' '}
          to watch that pipeline run. Character artwork and voices are placeholder casting — see the README.
        </p>
      </div>
    </div>
  )
}
