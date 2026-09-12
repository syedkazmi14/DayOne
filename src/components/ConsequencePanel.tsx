import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Coins, MessageSquare, MinusCircle } from 'lucide-react'
import { useState } from 'react'
import { getCharacter } from '@/content/characters'
import type { KnowledgeItem, Scene, WagerResult } from '@/types'
import { verdictHeadline } from '@/engine/risk'
import { Btn } from './ui/Bits'

/* ============================================================================
 * The world has already reacted by the time this appears. Only now does the
 * system explain anything — and it never says "correct" or "incorrect".
 * ========================================================================== */

const TONES = {
  good: { accent: '#54D1A0', Icon: CheckCircle2, label: 'outcome' },
  bad: { accent: '#FF4D4D', Icon: AlertTriangle, label: 'outcome' },
  mixed: { accent: '#F5A524', Icon: MinusCircle, label: 'outcome' },
} as const

const TIER_LABEL = { safe: 'SAFE', risky: 'RISKY', allin: 'ALL IN' } as const

export function ConsequencePanel({
  scene,
  wager,
  knowledge,
  onContinue,
  onTalk,
}: {
  scene: Scene
  wager: WagerResult | null
  /** Resolves citations against the episode's own knowledge, then the base. */
  knowledge: (id: string) => KnowledgeItem | undefined
  onContinue: () => void
  onTalk: (characterId: string) => void
}) {
  const [openCite, setOpenCite] = useState<string | null>(null)
  const outcome = scene.outcome!
  const { accent, Icon } = TONES[outcome.tone]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45 }}
      className="absolute inset-0 z-20 flex items-end justify-center overflow-y-auto no-scrollbar"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/92 to-ink-900/45" />

      <div className="relative w-full max-w-3xl px-6 pb-[9vh] pt-[12vh] sm:px-10">
        {/* banner */}
        <motion.div
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-3 flex items-center gap-3">
            <Icon size={16} style={{ color: accent }} />
            <span className="t-eyebrow" style={{ color: accent }}>
              {outcome.tone === 'bad' ? 'incident' : outcome.tone === 'good' ? 'result' : 'partial'}
            </span>
            <span className="h-px flex-1" style={{ background: `${accent}33` }} />
          </div>
          <h2 className="t-display text-[clamp(1.9rem,5.2vw,3.4rem)]" style={{ color: accent }}>
            {outcome.banner}
          </h2>
        </motion.div>

        {/* wager settlement */}
        {wager && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.28, duration: 0.5 }}
            className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-bone/10 py-3"
          >
            <span className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-signal">
              <Coins size={12} />
              {verdictHeadline(wager.won ? 'win' : wager.payout > 0 ? 'push' : 'loss')}
            </span>
            <span className="border border-bone/15 px-2 py-[2px] font-mono text-[10px] uppercase tracking-[0.14em] text-bone-dim">
              {TIER_LABEL[wager.tier]} {wager.multiplier}×
            </span>
            <span
              className={`font-sans text-[16px] font-bold tabular-nums ${wager.payout - wager.staked >= 0 ? 'text-good' : 'text-danger'}`}
            >
              {wager.payout - wager.staked >= 0 ? '+' : ''}
              {wager.payout - wager.staked} cr
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-bone-faint sm:ml-auto">
              mastery model had you at {Math.round(wager.estimate * 100)}%
            </span>
          </motion.div>
        )}

        {/* lesson */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.42, duration: 0.55 }}
          className="mt-6"
        >
          <div className="t-eyebrow mb-2.5">what actually happened</div>
          <p className="max-w-2xl font-sans text-[15px] font-light leading-[1.68] text-bone-dim sm:text-[16.5px]">
            {outcome.lesson}
          </p>
        </motion.div>

        {/* citations */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <BookOpen size={12} className="text-bone-faint" />
            {outcome.citations.map((id) => {
              const k = knowledge(id)
              if (!k) return null
              const open = openCite === id
              return (
                <button
                  key={id}
                  onClick={() => setOpenCite(open ? null : id)}
                  className={`border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
                    open ? 'border-signal/60 text-signal' : 'border-bone/15 text-bone-faint hover:border-bone/35 hover:text-bone-dim'
                  }`}
                >
                  {id}
                </button>
              )
            })}
          </div>
          <AnimatePresence>
            {openCite && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                {(() => {
                  const k = knowledge(openCite)!
                  return (
                    <div className="glass mt-3 p-4">
                      <div className="t-eyebrow mb-1.5 text-signal">{k.topic}</div>
                      <p className="font-sans text-[13.5px] font-light leading-relaxed text-bone">{k.rule}</p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-bone-faint">
                        {k.source.doc} § {k.source.section}
                        {k.source.page ? ` · p.${k.source.page}` : ''} · severity {k.severity}
                      </p>
                    </div>
                  )
                })()}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* talk + continue */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75, duration: 0.5 }}
          className="mt-8"
        >
          {scene.chatHook && <p className="mb-3 font-sans text-[13px] font-light italic text-bone-faint">{scene.chatHook}</p>}
          <div className="flex flex-wrap items-center gap-3">
            {(scene.chatWith ?? []).map((id) => {
              const ch = getCharacter(id)
              return (
                <button
                  key={id}
                  onClick={() => onTalk(id)}
                  className="group inline-flex items-center gap-2.5 border px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.18em] transition-all duration-300"
                  style={{ borderColor: `${ch.accent}44`, color: ch.accent }}
                >
                  <MessageSquare size={12} />
                  talk to {ch.name.split(' ')[0]}
                </button>
              )
            })}
            <Btn onClick={onContinue} className="ml-auto">
              Continue <ArrowRight size={13} />
            </Btn>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}
