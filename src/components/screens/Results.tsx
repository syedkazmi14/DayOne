import { motion } from 'framer-motion'
import { ArrowRight, BrainCircuit, Check, Coins, Minus, User, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { generateCoachAnalysis, type CoachAnalysis } from '@/ai/coach'
import { llmLabel } from '@/ai/llm'
import { concepts, conceptLabel } from '@/content/knowledge'
import { useGame } from '@/engine/gameStore'
import { growth } from '@/engine/adaptive'
import { SceneCanvas } from '../SceneCanvas'
import { Btn, Chip, Eyebrow, Meter, Rule } from '../ui/Bits'

const MARK = {
  best: { Icon: Check, color: '#54D1A0' },
  acceptable: { Icon: Minus, color: '#F5A524' },
  poor: { Icon: X, color: '#FF4D4D' },
} as const

export function Results() {
  const { state, dispatch, episode } = useGame()
  const [coach, setCoach] = useState<CoachAnalysis | null>(null)
  const decisions = state.decisionsThisEpisode
  const score = state.finalScore ?? 0

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

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[62vh]">
        {episode?.scenes[episode.entrySceneId] && (
          <SceneCanvas shot={(episode.scenes.s_end ?? episode.scenes[episode.entrySceneId]).shot} sceneKey="results" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-ink-900/55 via-ink-900/85 to-ink-900" />
      </div>

      <div className="relative mx-auto max-w-4xl px-6 pb-24 pt-[14vh] sm:px-10">
        {/* headline */}
        <motion.div initial={{ opacity: 0, y: 26 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px w-10 bg-signal" />
            <Eyebrow className="text-signal">episode complete</Eyebrow>
          </div>
          <h1 className="t-display text-[clamp(2.8rem,9vw,6rem)] text-bone">{episode?.title}</h1>

          <div className="mt-8 flex flex-wrap items-end gap-x-12 gap-y-6">
            <div>
              <Eyebrow className="mb-1">final score</Eyebrow>
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, duration: 0.7 }}
                className="font-sans text-[68px] font-black leading-none tabular-nums text-signal"
              >
                {score}
              </motion.div>
            </div>
            <div className="space-y-1.5">
              <Eyebrow>run summary</Eyebrow>
              <div className="flex flex-wrap gap-2">
                <Chip tone="good">{decisions.filter((d) => d.quality === 'best').length} strong</Chip>
                <Chip tone="signal">{decisions.filter((d) => d.quality === 'acceptable').length} partial</Chip>
                <Chip tone="danger">{decisions.filter((d) => d.quality === 'poor').length} costly</Chip>
                <Chip tone="cyan">
                  {state.questionsAsked} question{state.questionsAsked === 1 ? '' : 's'} asked
                </Chip>
                {state.creditsDelta !== 0 && (
                  <Chip tone={state.creditsDelta > 0 ? 'good' : 'danger'}>
                    <Coins size={10} />
                    {state.creditsDelta > 0 ? '+' : ''}
                    {state.creditsDelta} cr
                  </Chip>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* ledger */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.7 }} className="mt-12">
          <Eyebrow className="mb-4">your decisions</Eyebrow>
          <div className="space-y-px">
            {decisions.map((d, i) => {
              const { Icon, color } = MARK[d.quality]
              return (
                <motion.div
                  key={d.sceneId + i}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.09 }}
                  className="flex items-center gap-4 border-b border-bone/8 py-3.5"
                >
                  <Icon size={15} style={{ color }} className="shrink-0" />
                  <span className="min-w-0 flex-1 font-sans text-[14.5px] font-light text-bone">{d.ledgerLabel}</span>
                  <span className="hidden font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint sm:inline">
                    {d.concepts.map((c) => conceptLabel(c)).join(' · ')}
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-[11px] tabular-nums" style={{ color }}>
                    {d.scoreImpact > 0 ? '+' : ''}
                    {d.scoreImpact}
                  </span>
                </motion.div>
              )
            })}
          </div>
        </motion.div>

        {/* coach */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.7 }} className="glass mt-12 p-6 sm:p-8">
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <BrainCircuit size={15} className="text-cyan" />
            <Eyebrow className="text-cyan">ai coach analysis</Eyebrow>
            <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
              {coach ? (coach.source === 'llm' ? llmLabel() : 'deterministic · no model configured') : 'analysing…'}
            </span>
          </div>

          {!coach ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="h-3 rail"
                  style={{ width: `${88 - i * 14}%` }}
                  animate={{ opacity: [0.25, 0.6, 0.25] }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.18 }}
                />
              ))}
            </div>
          ) : (
            <>
              <h3 className="t-display mb-5 text-2xl text-bone sm:text-3xl">{coach.headline}</h3>
              <div className="space-y-4">
                {coach.paragraphs.map((p, i) => (
                  <motion.p
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.12, duration: 0.5 }}
                    className="font-sans text-[14.5px] font-light leading-[1.72] text-bone-dim"
                  >
                    {p}
                  </motion.p>
                ))}
              </div>
              <div className="mt-6 border-l-2 border-cyan/40 pl-4">
                <Eyebrow className="mb-1.5 text-cyan">what changes next</Eyebrow>
                <p className="font-sans text-[14px] font-light leading-relaxed text-bone">{coach.nextEpisodePlan}</p>
              </div>
            </>
          )}
        </motion.div>

        {/* mastery movement */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="mt-12">
          <Eyebrow className="mb-5">what the system learned about you</Eyebrow>
          <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {concepts.map((c) => {
              const d = deltaFor(c.id)
              return (
                <Meter
                  key={c.id}
                  label={c.label}
                  value={state.player.mastery[c.id].score}
                  delta={d ? d.after - d.before : undefined}
                  accent={coach?.nextFocus.includes(c.id) ? '#6FD3D8' : '#F5A524'}
                  sub={state.player.mastery[c.id].attempts === 0 ? 'not yet tested' : `${state.player.mastery[c.id].attempts} observations`}
                />
              )
            })}
          </div>
        </motion.div>

        <Rule label="next" />

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Btn onClick={() => dispatch({ type: 'GOTO', view: 'home' })}>
            next episode <ArrowRight size={13} />
          </Btn>
          <Btn variant="outline" onClick={() => dispatch({ type: 'GOTO', view: 'profile' })}>
            <User size={13} /> employee profile
          </Btn>
        </div>
      </div>
    </div>
  )
}
