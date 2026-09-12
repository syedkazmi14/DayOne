import { motion } from 'framer-motion'
import { Coins, Flame, Shield, Zap } from 'lucide-react'
import { wagerOptions, type WagerTier } from '@/engine/risk'

/* ============================================================================
 * WAGER — three bets, readable at a glance.
 *
 * VIRTUAL CREDITS ONLY. The player's own decision settles the bet, never
 * chance and never a model. The mastery estimate is recorded by the reducer
 * and only revealed after the world reacts, so nothing here anchors the call.
 * ========================================================================== */

const LOOK: Record<WagerTier, { Icon: typeof Shield; accent: string }> = {
  safe: { Icon: Shield, accent: '#54D1A0' },
  risky: { Icon: Flame, accent: '#F5A524' },
  allin: { Icon: Zap, accent: '#FF4D4D' },
}

export function RiskTerminal({
  credits,
  onStake,
  onSkip,
}: {
  credits: number
  onStake: (tier: WagerTier) => void
  onSkip: () => void
}) {
  const options = wagerOptions(credits)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto no-scrollbar px-4 py-[8vh]"
    >
      <div className="absolute inset-0 bg-ink-900/80 backdrop-blur-md" />

      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative my-auto w-full max-w-2xl"
      >
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h3 className="t-display text-4xl text-bone sm:text-5xl">MAKE YOUR CALL</h3>
          <span className="inline-flex items-center gap-2 rounded border border-signal/30 px-3 py-1.5 font-mono text-sm tabular-nums text-signal">
            <Coins size={13} />
            {credits.toLocaleString()}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {options.map((o, i) => {
            const { Icon, accent } = LOOK[o.tier]
            const share = credits ? o.stake / credits : 0
            return (
              <motion.button
                key={o.tier}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + i * 0.07 }}
                onClick={() => onStake(o.tier)}
                disabled={o.stake <= 0 || o.stake > credits}
                className="glass-strong flex min-w-0 flex-col items-center gap-3 border px-2 py-6 transition-[transform,background-color] duration-300 hover:-translate-y-1 hover:bg-bone/[0.04] disabled:pointer-events-none disabled:opacity-30 sm:py-8"
                style={{ borderColor: `${accent}45` }}
              >
                <Icon size={26} style={{ color: accent }} />
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-bone">{o.label}</span>
                <span className="font-sans text-[34px] font-black leading-none tabular-nums sm:text-[46px]" style={{ color: accent }}>
                  {o.multiplier}×
                </span>
                <span className="block h-[3px] w-3/4 overflow-hidden rounded rail">
                  <span className="block h-full rounded" style={{ width: `${Math.max(4, share * 100)}%`, background: accent }} />
                </span>
                <span className="font-mono text-[10px] tabular-nums text-bone-faint">−{o.stake.toLocaleString()}</span>
              </motion.button>
            )
          })}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            onClick={onSkip}
            className="px-2 py-2 font-mono text-[10px] uppercase tracking-ultra text-bone-dim transition-colors hover:text-bone"
          >
            no bet
          </button>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-bone-faint">virtual credits · no real money</span>
        </div>
      </motion.div>
    </motion.div>
  )
}
