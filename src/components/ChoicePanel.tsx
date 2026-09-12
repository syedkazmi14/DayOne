import { motion } from 'framer-motion'
import { Coins } from 'lucide-react'
import type { Choice } from '@/types'

/* ============================================================================
 * The decision. No option is styled as correct; no letter is highlighted; the
 * tempting answer gets the same visual weight as the careful one.
 * ========================================================================== */

export function ChoicePanel({
  prompt,
  choices,
  onChoose,
  wager,
}: {
  prompt: string
  choices: Choice[]
  onChoose: (c: Choice) => void
  wager?: { stake: number; reward: number; tier: string } | null
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto no-scrollbar py-[9vh]"
    >
      <div className="absolute inset-0 bg-ink-900/72 backdrop-blur-[3px]" />

      <div className="relative my-auto w-full max-w-4xl px-6 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="mb-8"
        >
          <div className="mb-3 flex items-center gap-4">
            <span className="h-px w-10 bg-signal" />
            <span className="t-eyebrow text-signal">decision point</span>
            {wager && (
              <span className="ml-auto inline-flex items-center gap-2 border border-signal/40 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-signal">
                <Coins size={11} />
                {wager.tier} · {wager.stake} staked
              </span>
            )}
          </div>
          <h2 className="t-display text-[clamp(2.1rem,6vw,4.2rem)] text-bone">{prompt}</h2>
        </motion.div>

        <div className="space-y-3">
          {choices.map((c, i) => (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, x: -22 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.16 + i * 0.09, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              onClick={() => onChoose(c)}
              className="choice group flex items-stretch"
            >
              <span className="relative z-10 flex w-[64px] shrink-0 items-center justify-center border-r border-bone/10 font-mono text-lg text-bone-dim transition-colors group-hover:border-signal/30 group-hover:text-signal sm:w-[78px] sm:text-xl">
                {c.label}
              </span>
              <span className="relative z-10 flex-1 px-5 py-5 text-[15px] font-light leading-snug text-bone sm:px-7 sm:py-6 sm:text-[17px]">
                {c.text}
              </span>
            </motion.button>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-bone-faint"
        >
          no feedback until the world reacts
        </motion.p>
      </div>
    </motion.div>
  )
}
