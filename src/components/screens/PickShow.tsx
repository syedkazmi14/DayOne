import { motion } from 'framer-motion'
import { Lock } from 'lucide-react'
import { characterGroups, groupCast } from '@/content/characterGroups'
import { featuredEpisode, playableCount } from '@/content/episodes'
import { useGame } from '@/engine/gameStore'
import type { CharacterGroup } from '@/types'
import { Eyebrow } from '../ui/Bits'
import { CharacterAvatar } from '../ui/CharacterAvatar'
import { EpisodeStill } from '../ui/EpisodeStill'

/* ============================================================================
 * PICK SHOW — the one question asked before the lobby.
 *
 * The show scopes the entire episode shelf, so it is a decision worth a screen
 * rather than a control tucked into the corner of one. It is asked exactly
 * once: the choice is persisted (see loadGroupId in the store) and this screen
 * is skipped on every later sign-in. Changing it afterwards lives in the
 * account menu, which is where a preference belongs.
 *
 * Rendered from src/content/characterGroups.ts, so it does not know how many
 * shows exist. The grid is 2-up and 4-up; a fifth show needs no change here.
 *
 * WHY THE AVAILABILITY LABEL
 * Three of the four shows currently have no playable episode — every one of
 * their entries is an authoring stub. Picking one of those lands you on a hero
 * whose only button reads "Episode in authoring", which is a poor thing to do
 * to someone on their first screen. They stay selectable, because the artwork
 * and cast are real and worth browsing; they just say so up front. The label
 * is derived, not authored, so it disappears on its own as episodes unlock.
 * ========================================================================== */

const EASE = [0.16, 1, 0.3, 1] as const

/** How much of this show you can actually play right now. */
const availability = (group: CharacterGroup) => {
  const playable = playableCount(group.id)
  return playable === 0
    ? { playable, label: 'In production', open: false }
    : { playable, label: `${playable} episode${playable === 1 ? '' : 's'} ready`, open: true }
}

export function PickShow() {
  const { dispatch } = useGame()

  const choose = (groupId: string) => {
    dispatch({ type: 'SELECT_GROUP', groupId })
    dispatch({ type: 'GOTO', view: 'home' })
  }

  return (
    <div className="relative h-full overflow-y-auto bg-ink-900">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col justify-center px-6 py-16 sm:px-12">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
        >
          <Eyebrow>before you start</Eyebrow>
          <h1 className="t-display mt-3 text-[clamp(2.25rem,6vw,3.75rem)] text-bone">Pick your show</h1>
          <p className="mt-4 max-w-xl font-sans text-[15.5px] font-light leading-relaxed text-bone-dim">
            Your training plays out as episodes of a show you already know. Pick the cast you want
            running your onboarding. You can change it any time from your account menu.
          </p>
        </motion.div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {characterGroups.map((group, i) => {
            const cast = groupCast(group)
            const featured = featuredEpisode(group.id)
            const { label, open } = availability(group)

            return (
              <motion.button
                key={group.id}
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.12 + i * 0.08, duration: 0.55, ease: EASE }}
                onClick={() => choose(group.id)}
                className="group relative flex h-[330px] flex-col justify-end overflow-hidden rounded border border-bone/10 p-5 text-left transition-colors duration-300 hover:border-bone/30"
              >
                {featured && (
                  <div className="absolute inset-0 transition-transform duration-700 group-hover:scale-[1.04]">
                    <EpisodeStill episode={featured} sceneKey={`pick-${group.id}`} paused />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/80 to-ink-900/30" />

                {/* cast, so the choice is visibly about who you get */}
                <div className="relative mb-auto flex gap-1.5">
                  {cast.map((ch) => (
                    <CharacterAvatar
                      key={ch.id}
                      character={ch}
                      size={34}
                      sizes="34px"
                      className="rounded border border-bone/10"
                    />
                  ))}
                </div>

                <div className="relative">
                  <h2 className="font-sans text-[17px] font-semibold tracking-[-0.01em]" style={{ color: group.accent }}>
                    {group.name}
                  </h2>
                  <p className="mt-1.5 font-sans text-[12.5px] font-light leading-snug text-bone-dim">
                    {group.tagline}
                  </p>
                  <div className="mt-3 flex items-center gap-1.5 font-sans text-[12px] text-bone-faint">
                    {!open && <Lock size={11} />}
                    {label}
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
