import { motion } from 'framer-motion'
import { ArrowLeft, MessageSquare, RotateCcw, Target, TrendingUp } from 'lucide-react'
import { concepts, conceptLabel } from '@/content/knowledge'
import { episodes } from '@/content/episodes'
import { getCharacter } from '@/content/characters'
import { useGame } from '@/engine/gameStore'
import { levelProgress, overallKnowledge, reputationStars, strongestConcept, weakestConcept, XP_PER_LEVEL } from '@/engine/adaptive'
import { Btn, Chip, Eyebrow, Meter, Rule, Stars } from '../ui/Bits'

/* ============================================================================
 * Progression that means something: every number on this screen is an input to
 * scenario selection, wager odds, or coaching. None of it is decorative XP.
 * ========================================================================== */

export function PlayerProfile() {
  const { state, dispatch } = useGame()
  const p = state.player
  const overall = overallKnowledge(p.mastery)
  const weak = weakestConcept(p.mastery)
  const strong = strongestConcept(p.mastery)
  const stars = reputationStars(p)

  const composite = {
    Security: (p.mastery.phishing.score + p.mastery.password_security.score + p.mastery.social_engineering.score) / 3,
    'Data Handling': (p.mastery.data_handling.score + p.mastery.approved_tools.score) / 2,
    Communication: (p.mastery.incident_reporting.score + p.mastery.social_engineering.score) / 2,
    'Decision Making': p.decisions.length
      ? p.decisions.filter((d) => d.quality !== 'poor').length / p.decisions.length
      : 0.5,
  }

  const chats = p.transcript.filter((t) => t.role === 'player')

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 pb-28 pt-24 sm:px-10">
        <button
          onClick={() => dispatch({ type: 'GOTO', view: 'home' })}
          className="mb-8 flex items-center gap-2 font-mono text-[10px] uppercase tracking-ultra text-bone-dim transition-colors hover:text-bone"
        >
          <ArrowLeft size={13} /> episodes
        </button>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
          <Eyebrow className="text-signal">your employee profile</Eyebrow>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
            <h1 className="t-display text-[clamp(2.4rem,7vw,4.6rem)] text-bone">LEVEL {p.level}</h1>
            <div className="flex items-end gap-8">
              <div>
                <Eyebrow className="mb-1">overall knowledge</Eyebrow>
                <div className="font-sans text-4xl font-black tabular-nums text-signal">{Math.round(overall * 100)}%</div>
              </div>
              <div>
                <Eyebrow className="mb-1.5">reputation</Eyebrow>
                <Stars n={stars} size={16} />
              </div>
              <div>
                <Eyebrow className="mb-1">credits</Eyebrow>
                <div className="font-mono text-2xl tabular-nums text-bone">{p.credits.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* xp rail */}
          <div className="mt-6">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="t-label text-bone-faint">
                {p.xp % XP_PER_LEVEL} / {XP_PER_LEVEL} xp to level {p.level + 1}
              </span>
              <span className="font-mono text-[10px] text-bone-faint">
                {p.completedEpisodes.length} / {episodes.length} episodes
              </span>
            </div>
            <div className="h-[3px] w-full rail overflow-hidden">
              <motion.div
                className="h-full bg-signal"
                initial={{ width: 0 }}
                animate={{ width: `${levelProgress(p.xp) * 100}%` }}
                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        </motion.div>

        {/* composite stats */}
        <div className="mt-12 grid gap-x-12 gap-y-6 sm:grid-cols-2">
          {Object.entries(composite).map(([label, v], i) => (
            <motion.div key={label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.07 }}>
              <Meter label={label} value={v} accent={v < 0.5 ? '#FF4D4D' : v < 0.7 ? '#F5A524' : '#54D1A0'} />
            </motion.div>
          ))}
        </div>

        <div className="mt-12">
          <Rule label="demonstrated knowledge" />
        </div>

        {/* concept mastery */}
        <div className="mt-8 grid gap-x-12 gap-y-5 sm:grid-cols-2">
          {concepts.map((c) => {
            const m = p.mastery[c.id]
            return (
              <Meter
                key={c.id}
                label={c.label}
                value={m.score}
                accent={c.id === weak ? '#FF4D4D' : c.id === strong ? '#54D1A0' : '#F5A524'}
                sub={m.attempts === 0 ? 'no observations yet · assumed baseline' : `${m.correct}/${m.attempts} strong calls · ${c.blurb}`}
              />
            )
          })}
        </div>

        {/* how this is used */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="glass mt-12 grid gap-6 p-6 sm:grid-cols-2 sm:p-8">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Target size={13} className="text-cyan" />
              <Eyebrow className="text-cyan">next scenario target</Eyebrow>
            </div>
            <p className="font-sans text-[14px] font-light leading-relaxed text-bone-dim">
              The engine will bias your next episode towards{' '}
              <span className="text-bone">{conceptLabel(weak).toLowerCase()}</span> ({Math.round(p.mastery[weak].score * 100)}%)
              and spot-check <span className="text-bone">{conceptLabel(strong).toLowerCase()}</span> (
              {Math.round(p.mastery[strong].score * 100)}%) rather than re-teaching it.
            </p>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2">
              <TrendingUp size={13} className="text-signal" />
              <Eyebrow className="text-signal">wager odds</Eyebrow>
            </div>
            <p className="font-sans text-[14px] font-light leading-relaxed text-bone-dim">
              These same scores set the house estimate in the risk terminal. As your weakest concept rises, long-shot
              payouts on it shrink — the odds are a mirror, not a slot machine.
            </p>
          </div>
        </motion.div>

        {/* decision history */}
        {p.decisions.length > 0 && (
          <div className="mt-12">
            <Rule label={`decision history · ${p.decisions.length}`} />
            <div className="mt-6 space-y-px">
              {[...p.decisions].reverse().slice(0, 8).map((d, i) => (
                <div key={i} className="flex items-center gap-4 border-b border-bone/8 py-3">
                  <Chip tone={d.quality === 'best' ? 'good' : d.quality === 'acceptable' ? 'signal' : 'danger'}>
                    {d.quality}
                  </Chip>
                  <span className="min-w-0 flex-1 truncate font-sans text-[13.5px] font-light text-bone-dim">
                    {d.ledgerLabel}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-bone-faint">
                    {(d.msToDecide / 1000).toFixed(1)}s
                  </span>
                  {d.wager && (
                    <span className={`shrink-0 font-mono text-[10px] ${d.wager.won ? 'text-good' : 'text-danger'}`}>
                      {d.wager.won ? '+' : '−'}
                      {d.wager.won ? d.wager.payout - d.wager.staked : d.wager.staked}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* conversation history */}
        {chats.length > 0 && (
          <div className="mt-12">
            <Rule label={`questions you asked · ${chats.length}`} />
            <div className="mt-6 space-y-3">
              {chats.slice(-5).reverse().map((t) => {
                const ch = getCharacter(t.characterId)
                return (
                  <div key={t.id} className="flex items-start gap-3">
                    <MessageSquare size={12} className="mt-1 shrink-0" style={{ color: ch.accent }} />
                    <div className="min-w-0">
                      <p className="font-sans text-[13.5px] font-light leading-snug text-bone-dim">“{t.text}”</p>
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
                        to {ch.name.split(' ')[0]} · {t.mode}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-14">
          <Btn variant="danger" onClick={() => dispatch({ type: 'RESET_PROGRESS' })}>
            <RotateCcw size={12} /> reset progression
          </Btn>
        </div>
      </div>
    </div>
  )
}
