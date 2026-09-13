import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { generateCoachAnalysis, type CoachAnalysis } from '@/ai/coach'
import { llmLabel } from '@/ai/llm'
import { lineupFor, recommendNext } from '@/engine/lineup'
import { RunTelemetryPanel } from '../RunTelemetryPanel'
import { concepts, conceptLabel } from '@/content/knowledge'
import { useGame } from '@/engine/gameStore'
import { growth } from '@/engine/adaptive'
import { SceneCanvas } from '../SceneCanvas'
import { Btn, Eyebrow, Meter } from '../ui/Bits'

/* Structure comes from type and spacing: one label per section, no accent
 * rules, icons or tinted panels. Colour is kept for meaning only — a gain or a
 * loss, and the concepts the next episode will target. */

const QUALITY_WORD = { best: 'Strong', acceptable: 'Partial', poor: 'Costly' } as const

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="font-sans text-[12.5px] text-bone-faint">{label}</dt>
      <dd className="mt-1 font-sans text-[22px] font-medium leading-none tabular-nums text-bone">{value}</dd>
    </div>
  )
}

export function Results() {
  const { state, dispatch, episode } = useGame()
  const [coach, setCoach] = useState<CoachAnalysis | null>(null)
  const decisions = state.decisionsThisEpisode
  const score = state.finalScore ?? 0
  /* Employees never generate episodes — admins build them in the Studio. The
   * adaptive loop closes by pointing at the published episode that best covers
   * this run's weakest concepts, recast into the show this employee picked. */
  const next = coach
    ? recommendNext(lineupFor(state.groupId, state.published), coach.nextFocus, episode?.id, state.player.completedEpisodes)
    : null

  useEffect(() => {
    let alive = true
    void generateCoachAnalysis({
      decisions,
      before: state.masteryAtStart ?? state.player.mastery,
      after: state.player.mastery,
      questionsAsked: state.questionsAsked,
      score,
    }).then((c) => alive && setCoach(c))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const deltas = state.masteryAtStart ? growth(state.masteryAtStart, state.player.mastery) : []
  const deltaFor = (id: string) => deltas.find((d) => d.concept === id)
  const count = (q: keyof typeof QUALITY_WORD) => decisions.filter((d) => d.quality === q).length

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[62vh]">
        {episode?.scenes[episode.entrySceneId] && (
          <SceneCanvas
            shot={(Object.values(episode.scenes).find((s) => s.kind === 'ending') ?? episode.scenes[episode.entrySceneId]).shot}
            sceneKey="results"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-ink-900/55 via-ink-900/85 to-ink-900" />
      </div>

      <div className="relative mx-auto max-w-4xl px-6 pb-24 pt-[14vh] sm:px-10">
        {/* headline */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
          <Eyebrow className="mb-3">episode complete</Eyebrow>
          <h1 className="t-display text-[clamp(2.6rem,8vw,5.2rem)] text-bone">{episode?.title}</h1>

          <dl className="mt-10 flex flex-wrap items-end gap-x-10 gap-y-6">
            <div className="mr-2">
              <dt className="font-sans text-[12.5px] text-bone-faint">Final score</dt>
              <dd className="mt-1 font-sans text-[56px] font-semibold leading-none tabular-nums text-bone">{score}</dd>
            </div>
            <Stat label="Strong" value={count('best')} />
            <Stat label="Partial" value={count('acceptable')} />
            <Stat label="Costly" value={count('poor')} />
            <Stat label="Questions asked" value={state.questionsAsked} />
            {state.creditsDelta !== 0 && (
              <Stat label="Credits" value={`${state.creditsDelta > 0 ? '+' : '−'}${Math.abs(state.creditsDelta).toLocaleString()}`} />
            )}
          </dl>
        </motion.div>

        {/* ledger */}
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.6 }} className="mt-16">
          <Eyebrow className="mb-3">your decisions</Eyebrow>
          <div className="border-t border-bone/10">
            {decisions.map((d, i) => (
              <div key={d.sceneId + i} className="grid grid-cols-[1fr_auto_3rem] items-baseline gap-x-4 border-b border-bone/10 py-3.5">
                <div className="min-w-0">
                  <div className="font-sans text-[15px] text-bone">{d.ledgerLabel}</div>
                  <div className="mt-0.5 font-sans text-[12.5px] text-bone-faint">{d.concepts.map((c) => conceptLabel(c)).join(', ')}</div>
                </div>
                <span className="font-sans text-[13px] text-bone-dim">{QUALITY_WORD[d.quality]}</span>
                <span
                  className={`text-right font-sans text-[14px] font-medium tabular-nums ${
                    d.scoreImpact > 0 ? 'text-good' : d.scoreImpact < 0 ? 'text-danger' : 'text-bone-dim'
                  }`}
                >
                  {d.scoreImpact > 0 ? '+' : d.scoreImpact < 0 ? '−' : ''}
                  {Math.abs(d.scoreImpact)}
                </span>
              </div>
            ))}
          </div>
        </motion.section>

        {/* coach */}
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.6 }} className="mt-16">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Eyebrow>coach summary</Eyebrow>
            <span className="font-sans text-[12px] text-bone-faint">
              {coach ? (coach.source === 'llm' ? llmLabel() : 'Written from your decision log, no model') : ''}
            </span>
          </div>

          {!coach ? (
            <p className="font-sans text-[15px] text-bone-faint">Reading your run…</p>
          ) : (
            <div className="max-w-2xl">
              <h2 className="font-sans text-[24px] font-semibold leading-snug tracking-[-0.01em] text-bone sm:text-[26px]">
                {coach.headline}
              </h2>
              <ul className="mt-3 space-y-1.5">
                {coach.points.map((p) => (
                  <li key={p} className="font-sans text-[15px] leading-relaxed text-bone-dim">
                    {p}
                  </li>
                ))}
              </ul>
              <p className="mt-4 font-sans text-[15px] text-bone">{coach.nextEpisodePlan}</p>
            </div>
          )}
        </motion.section>

        {coach && <RunTelemetryPanel telemetry={coach.telemetry} />}

        {/* mastery movement */}
        <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }} className="mt-16">
          <Eyebrow className="mb-5">what the system learned about you</Eyebrow>
          <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {concepts.map((c) => {
              const d = deltaFor(c.id)
              const m = state.player.mastery[c.id]
              const focus = !!coach?.nextFocus.includes(c.id)
              return (
                <Meter
                  key={c.id}
                  label={c.label}
                  value={m.score}
                  delta={d ? d.after - d.before : undefined}
                  accent={focus ? '#F5A524' : '#A8A399'}
                  sub={[m.attempts === 0 ? 'not yet tested' : `${m.attempts} observations`, focus ? 'next focus' : ''].filter(Boolean).join(' · ')}
                />
              )
            })}
          </div>
        </motion.section>

        {/* next */}
        <section className="mt-16">
          <div className="flex flex-wrap items-center gap-3">
            {next && (
              <Btn onClick={() => dispatch({ type: 'SELECT_EPISODE', episodeId: next.entry.episode.id })}>play recommended episode</Btn>
            )}
            <Btn variant="outline" onClick={() => dispatch({ type: 'GOTO', view: 'home' })}>
              episodes
            </Btn>
            <Btn variant="outline" onClick={() => dispatch({ type: 'GOTO', view: 'profile' })}>
              Employee profile
            </Btn>
          </div>
          {coach && (
            <p className="mt-3 font-sans text-[13px] text-bone-faint">
              {next
                ? `Recommended: ${next.entry.episode.title}${
                    next.covers.length ? `, covers ${next.covers.map((c) => conceptLabel(c).toLowerCase()).join(' and ')}` : ''
                  }.`
                : `Nothing in your library targets ${coach.nextFocus.map((c) => conceptLabel(c).toLowerCase()).join(' and ')} yet. Your admin can build it in the Studio.`}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
