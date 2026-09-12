import { motion } from 'framer-motion'
import { Activity, X } from 'lucide-react'
import { conceptLabel } from '@/content/knowledge'
import type { ConceptId, Mastery, Scene } from '@/types'
import { estimateSuccess, wagerOptions, type WagerOption } from '@/engine/risk'

/* ============================================================================
 * RISK TERMINAL — price your own confidence.
 *
 * VIRTUAL CURRENCY ONLY. No real money, no deposits, no cash-out, no external
 * wallet, no odds sourced from anywhere but the player's own mastery model.
 * The mechanic exists to make the player ask "do I actually understand this?"
 * before they answer — the stake is the question, not the point.
 * ========================================================================== */

export function RiskTerminal({
  scene,
  mastery,
  credits,
  onStake,
  onSkip,
}: {
  scene: Scene
  mastery: Record<ConceptId, Mastery>
  credits: number
  onStake: (o: WagerOption, estimate: number) => void
  onSkip: () => void
}) {
  const { p, drivers } = estimateSuccess(scene, mastery)
  const options = wagerOptions(credits, p)
  const pct = Math.round(p * 100)
  const C = 2 * Math.PI * 52

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto no-scrollbar px-4 py-[8vh]"
    >
      <div className="absolute inset-0 bg-ink-900/85 backdrop-blur-md" />

      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="glass-strong relative my-auto w-full max-w-3xl"
      >
        <button
          onClick={onSkip}
          aria-label="Skip wager"
          className="absolute right-4 top-4 text-bone-faint transition-colors hover:text-bone"
        >
          <X size={16} />
        </button>

        <div className="border-b border-bone/10 px-7 py-5 sm:px-9">
          <div className="flex items-center gap-3">
            <Activity size={14} className="text-signal" />
            <span className="t-eyebrow text-signal">risk terminal</span>
          </div>
          <h3 className="t-display mt-2 text-3xl sm:text-4xl">MAKE YOUR CALL</h3>
        </div>

        <div className="grid gap-7 px-7 py-7 sm:grid-cols-[auto_1fr] sm:px-9">
          {/* estimate ring */}
          <div className="flex items-center gap-5">
            <div className="relative h-[124px] w-[124px] shrink-0">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(237,233,226,.1)" strokeWidth="3" />
                <motion.circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke="#F5A524"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  initial={{ strokeDashoffset: C }}
                  animate={{ strokeDashoffset: C * (1 - p) }}
                  transition={{ duration: 1.3, ease: [0.16, 1, 0.3, 1] }}
                  style={{ filter: 'drop-shadow(0 0 8px rgba(245,165,36,.55))' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-sans text-3xl font-bold tabular-nums text-bone">{pct}%</span>
                <span className="font-mono text-[8px] uppercase tracking-[0.18em] text-bone-faint">estimate</span>
              </div>
            </div>

            <div className="min-w-0">
              <div className="t-eyebrow mb-2">model inputs</div>
              <div className="space-y-1.5">
                {drivers.map((d) => (
                  <div key={d.concept} className="flex items-center gap-2">
                    <span className="w-[92px] shrink-0 font-mono text-[10px] uppercase tracking-wide text-bone-faint">
                      {conceptLabel(d.concept)}
                    </span>
                    <span className="h-[2px] w-16 rail overflow-hidden">
                      <span className="block h-full bg-cyan" style={{ width: `${d.score * 100}%` }} />
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-bone-dim">{Math.round(d.score * 100)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 max-w-[220px] font-sans text-[11px] font-light leading-relaxed text-bone-faint">
                Your odds are your own mastery scores. The house is not guessing.
              </p>
            </div>
          </div>

          {/* stake options */}
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <span className="t-eyebrow">balance</span>
              <span className="font-mono text-sm tabular-nums text-signal">{credits.toLocaleString()} cr</span>
            </div>
            <div className="space-y-2">
              {options.map((o, i) => (
                <motion.button
                  key={o.tier}
                  initial={{ opacity: 0, x: 14 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.07 }}
                  onClick={() => onStake(o, p)}
                  disabled={o.stake > credits}
                  className="group flex w-full items-center gap-4 border border-bone/12 px-4 py-3 text-left transition-all duration-300 hover:border-signal/55 hover:bg-signal/[0.06] disabled:pointer-events-none disabled:opacity-30"
                >
                  <span className="w-[52px] shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-bone group-hover:text-signal">
                    {o.label}
                  </span>
                  <span className="flex-1 font-mono text-[10px] leading-relaxed text-bone-faint">{o.blurb}</span>
                  <span className="shrink-0 text-right">
                    <span className="block font-mono text-[11px] tabular-nums text-bone-dim">−{o.stake}</span>
                    <span className="block font-mono text-[12px] tabular-nums text-good">+{o.reward}</span>
                  </span>
                </motion.button>
              ))}
            </div>
            <button
              onClick={onSkip}
              className="mt-3 w-full py-2 font-mono text-[10px] uppercase tracking-ultra text-bone-faint transition-colors hover:text-bone"
            >
              decide without staking
            </button>
          </div>
        </div>

        <div className="border-t border-bone/10 px-7 py-3 sm:px-9">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-bone-faint">
            virtual credits · no real money · no deposits · no cash-out · a confidence exercise, not a casino
          </p>
        </div>
      </motion.div>
    </motion.div>
  )
}
