import { motion } from 'framer-motion'
import { concepts, conceptLabel } from '@/content/knowledge'
import { episodes } from '@/content/episodes'
import { getCharacter } from '@/content/characters'
import { getGroup } from '@/content/characterGroups'
import { badgeName, getShopItem } from '@/content/shop'
import { useGame } from '@/engine/gameStore'
import { levelProgress, overallKnowledge, weakestConcept, XP_PER_LEVEL } from '@/engine/adaptive'
import type { Mastery } from '@/types'
import { BadgeMark } from '../ui/BadgeMark'
import { Btn } from '../ui/Bits'
import { CollectibleArt } from '../ui/CollectibleArt'
import { ProfileAvatar, titleCase } from '../ui/ProfileAvatar'

/* ============================================================================
 * The employee profile. Every number here is an input to scenario selection or
 * coaching — none of it is decorative XP — but it is written for the person,
 * not for the engine: scores become plain-language standings, and the one bar
 * on the page is the level rail.
 * ========================================================================== */

/** Stands in until there is real HR data to read a department from. */
const EMPLOYER = 'Helix Dynamics'

/** Four standings, so a score reads as a position rather than a measurement. */
function standing(m: Mastery): string {
  if (m.attempts === 0) return 'Baseline'
  if (m.score >= 0.7) return 'Strong'
  if (m.score >= 0.5) return 'Developing'
  return 'Needs practice'
}

export function PlayerProfile() {
  const { state, dispatch } = useGame()
  const session = state.session
  const p = state.player
  const overall = overallKnowledge(p.mastery)
  const weak = weakestConcept(p.mastery)
  const weakBlurb = concepts.find((c) => c.id === weak)?.blurb ?? ''
  const chats = p.transcript.filter((t) => t.role === 'player')
  const name = titleCase(p.name)
  const { cosmetics } = p
  const title = getShopItem(cosmetics.equippedTitle)
  const showcase = getShopItem(cosmetics.showcaseCharacter)

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-6 pb-32 pt-36 sm:px-10">
        <button
          onClick={() => dispatch({ type: 'GOTO', view: 'home' })}
          className="mb-12 font-sans text-[13px] text-bone-dim transition-colors hover:text-bone"
        >
          ← Episodes
        </button>

        {/* identity */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap items-start justify-between gap-10"
        >
          <div className="flex flex-wrap items-center gap-7">
            <ProfileAvatar name={name} borderId={cosmetics.equippedBorder} size={80} />
            <div>
              <h1 className="font-sans text-[30px] font-semibold tracking-[-0.02em] text-bone">{name}</h1>
              {title && <p className="mt-0.5 font-sans text-[15px] font-medium text-signal">{title.name}</p>}
              <p className="mt-1 font-sans text-[14px] text-bone-dim">
                {EMPLOYER} · Level {p.level}
              </p>
              {cosmetics.equippedBadges.length > 0 && (
                <ul aria-label="Badges" className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                  {cosmetics.equippedBadges.map((id) => (
                    <li key={id} className="flex items-center gap-2 font-sans text-[12.5px] text-bone-dim">
                      <BadgeMark id={id} size={22} />
                      {badgeName(id)}
                    </li>
                  ))}
                </ul>
              )}
              <Btn size="sm" variant="outline" className="mt-4" onClick={() => dispatch({ type: 'GOTO', view: 'shop' })}>
                Customize profile
              </Btn>
            </div>
          </div>

          {showcase && (
            <div className="w-[152px]">
              <div className="font-sans text-[12.5px] text-bone-faint">Showcase</div>
              <div className="relative mt-2 aspect-[4/5] overflow-hidden rounded border border-bone/10">
                <CollectibleArt item={showcase} />
              </div>
              <div className="mt-2 font-sans text-[14px] font-medium text-bone">{showcase.name}</div>
              <div className="font-sans text-[12.5px] text-bone-dim">{getGroup(showcase.show).name}</div>
            </div>
          )}
        </motion.div>

        {/* level rail — the only progress bar on the page */}
        <div className="mt-8 max-w-md">
          <div className="h-[2px] w-full overflow-hidden rounded bg-bone/12">
            <motion.div
              className="h-full rounded bg-signal"
              initial={{ width: 0 }}
              animate={{ width: `${levelProgress(p.xp) * 100}%` }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <p className="mt-2 font-sans text-[12.5px] text-bone-faint">
            {p.xp % XP_PER_LEVEL} / {XP_PER_LEVEL} XP to Level {p.level + 1}
          </p>
        </div>

        {/* headline stats */}
        <div className="mt-12 flex flex-wrap gap-x-16 gap-y-8">
          {[
            { value: `${Math.round(overall * 100)}%`, label: 'Knowledge' },
            { value: p.credits.toLocaleString(), label: 'Credits' },
            { value: `${p.completedEpisodes.length} of ${episodes.length}`, label: 'Episodes' },
          ].map((s) => (
            <div key={s.label}>
              <div className="font-sans text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-bone">
                {s.value}
              </div>
              <div className="mt-0.5 font-sans text-[13px] text-bone-dim">{s.label}</div>
            </div>
          ))}
        </div>

        {/* knowledge areas */}
        <section className="mt-20">
          <h2 className="t-section">Knowledge areas</h2>
          <div className="mt-8 grid gap-x-16 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {concepts.map((c) => {
              const m = p.mastery[c.id]
              return (
                <div key={c.id}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="font-sans text-[15px] font-medium text-bone">{c.label}</span>
                    <span className="font-sans text-[13px] tabular-nums text-bone-faint">
                      {Math.round(m.score * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 font-sans text-[13.5px] text-bone-dim">{standing(m)}</div>
                  <p className="mt-1.5 font-sans text-[13px] font-light leading-relaxed text-bone-faint">
                    {m.attempts === 0 ? 'No observations yet.' : c.blurb}
                  </p>
                </div>
              )
            })}
          </div>
        </section>

        {/* what the next episode will lean on */}
        <section className="mt-20 max-w-xl">
          <h2 className="t-section">Up next</h2>
          <p className="mt-5 font-sans text-[20px] font-medium tracking-[-0.01em] text-bone">{conceptLabel(weak)}</p>
          <p className="mt-2 font-sans text-[14.5px] font-light leading-relaxed text-bone-dim">
            Your next episode will spend more time on {weakBlurb.toLowerCase().replace(/\.$/, '')}.
          </p>
          <p className="mt-4 font-sans text-[13px] text-bone-faint">Chosen from your recent decisions.</p>
        </section>

        {/* decision history */}
        {p.decisions.length > 0 && (
          <section className="mt-20">
            <h2 className="t-section">Recent decisions</h2>
            <div className="mt-6 max-w-3xl">
              {[...p.decisions]
                .reverse()
                .slice(0, 8)
                .map((d, i) => (
                  <div key={i} className="flex items-baseline gap-6 border-b border-bone/8 py-3.5">
                    <span className="min-w-0 flex-1 truncate font-sans text-[14px] font-light text-bone-dim">
                      {d.ledgerLabel}
                    </span>
                    <span className="shrink-0 font-sans text-[13px] text-bone-faint">
                      {d.quality === 'best' ? 'Strong call' : d.quality === 'acceptable' ? 'Partial' : 'Costly'}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* conversation history */}
        {chats.length > 0 && (
          <section className="mt-20 max-w-3xl">
            <h2 className="t-section">Questions you asked</h2>
            <div className="mt-6 space-y-5">
              {chats
                .slice(-5)
                .reverse()
                .map((t) => (
                  <div key={t.id}>
                    <p className="font-sans text-[14px] font-light leading-snug text-bone-dim">“{t.text}”</p>
                    <span className="font-sans text-[12.5px] text-bone-faint">
                      to {titleCase(getCharacter(t.characterId).name.split(' ')[0])}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* account */}
        <section className="mt-24 border-t border-bone/8 pt-8">
          <h2 className="font-sans text-[14px] font-medium text-bone-dim">Account</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <button
              onClick={() => dispatch({ type: 'SIGN_OUT' })}
              className="font-sans text-[13px] text-bone-faint underline decoration-bone/20 underline-offset-4 transition-colors hover:text-bone"
            >
              Sign out
            </button>
            <button
              onClick={() => dispatch({ type: 'RESET_PROGRESS' })}
              className="font-sans text-[13px] text-bone-faint underline decoration-bone/20 underline-offset-4 transition-colors hover:text-danger"
            >
              Reset progression
            </button>
          </div>
          {session && (
            <p className="mt-3 font-sans text-[12.5px] font-light text-bone-faint">
              Signed in as {session.role === 'admin' ? 'an administrator' : 'an employee'} via {session.provider}. Signing
              out keeps everything you have earned.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
