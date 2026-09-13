import { motion } from 'framer-motion'
import { wagerOptions, type WagerTier } from '@/engine/risk'

/* ============================================================================
 * WAGER — four cards, laid out low to high.
 *
 * VIRTUAL CREDITS ONLY. The player's own decision settles the bet, never
 * chance and never a model. The mastery estimate is recorded by the reducer
 * and only revealed after the world reacts, so nothing here anchors the call.
 *
 * Each option is a playing card: the multiplier is the rank, the stake sits
 * under it, and the suit follows bridge order (clubs < diamonds < hearts <
 * spades) so the lowest suit is the pass and the highest is all in. Passing is
 * a 1× card like the others, because it is an equally valid call.
 * ========================================================================== */

type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades'

const SUIT_COLOR: Record<Suit, string> = {
  clubs: 'text-bone',
  diamonds: 'text-[#E0625C]',
  hearts: 'text-[#E0625C]',
  spades: 'text-bone',
}

function SuitMark({ suit, className = '' }: { suit: Suit; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`fill-current ${SUIT_COLOR[suit]} ${className}`}>
      {suit === 'spades' && (
        <path d="M12 2C9.2 5.9 4 8.9 4 13.4a4 4 0 0 0 6.6 3.1L9.2 22h5.6l-1.4-5.5A4 4 0 0 0 20 13.4C20 8.9 14.8 5.9 12 2z" />
      )}
      {suit === 'hearts' && <path d="M12 21s-8.5-5.4-8.5-11.4A4.7 4.7 0 0 1 12 7a4.7 4.7 0 0 1 8.5 2.6C20.5 15.6 12 21 12 21z" />}
      {suit === 'diamonds' && <path d="M12 2l7.2 10L12 22 4.8 12z" />}
      {suit === 'clubs' && (
        <>
          <circle cx="12" cy="7" r="4" />
          <circle cx="7" cy="13.2" r="4" />
          <circle cx="17" cy="13.2" r="4" />
          <path d="M10.9 12h2.2l1.7 10H9.2z" />
        </>
      )}
    </svg>
  )
}

interface Card {
  key: string
  suit: Suit
  multiplier: number
  stake: string
  weight: string
  ariaLabel: string
  disabled?: boolean
  onPick: () => void
}

const SUIT: Record<WagerTier, Suit> = { safe: 'diamonds', risky: 'hearts', allin: 'spades' }
const WEIGHT: Record<WagerTier, string> = { safe: 'font-normal', risky: 'font-medium', allin: 'font-semibold' }

export function RiskTerminal({
  credits,
  onStake,
  onSkip,
}: {
  credits: number
  onStake: (tier: WagerTier) => void
  onSkip: () => void
}) {
  const cards: Card[] = [
    {
      key: 'none',
      suit: 'clubs',
      multiplier: 1,
      stake: 'No stake',
      weight: 'font-light',
      ariaLabel: 'No bet, 1×',
      onPick: onSkip,
    },
    ...wagerOptions(credits).map((o) => ({
      key: o.tier,
      suit: SUIT[o.tier],
      multiplier: o.multiplier,
      stake: `Stake ${o.stake.toLocaleString()}`,
      weight: WEIGHT[o.tier],
      ariaLabel: `${o.label} bet, ${o.multiplier}×, stake ${o.stake.toLocaleString()}`,
      disabled: o.stake <= 0 || o.stake > credits,
      onPick: () => onStake(o.tier),
    })),
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 z-30 flex items-center justify-center overflow-y-auto no-scrollbar px-4 py-[8vh]"
    >
      <div className="absolute inset-0 bg-ink-900/80 backdrop-blur-[3px]" />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative my-auto w-full max-w-3xl"
      >
        <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-bone/10 pb-4">
          <div>
            <p className="mb-1.5 font-sans text-[13px] text-bone-faint">Before you answer</p>
            <h3 className="font-sans text-[28px] font-semibold leading-tight tracking-[-0.01em] text-bone sm:text-[32px]">
              Make your call
            </h3>
          </div>
          <p className="font-sans text-[14px] text-bone-dim">
            Balance <span className="ml-1 font-medium tabular-nums text-bone">{credits.toLocaleString()}</span>
          </p>
        </div>

        <div className="mx-auto grid max-w-[22rem] grid-cols-2 gap-3 sm:max-w-none sm:grid-cols-4 sm:gap-4">
          {cards.map((c, i) => (
            <motion.button
              key={c.key}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 + i * 0.05 }}
              onClick={c.onPick}
              disabled={c.disabled}
              aria-label={c.ariaLabel}
              className="relative flex aspect-[5/7] min-w-0 flex-col items-center justify-center rounded border border-bone/15 bg-ink-800 shadow-[0_1px_0_rgba(237,233,226,0.04)_inset] transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-bone/40 focus-visible:border-signal/70 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35"
            >
              <SuitMark suit={c.suit} className="absolute left-3 top-3 h-4 w-4 sm:left-3.5 sm:top-3.5" />
              <SuitMark suit={c.suit} className="absolute bottom-3 right-3 h-4 w-4 rotate-180 sm:bottom-3.5 sm:right-3.5" />

              <span className={`font-sans text-[40px] leading-none tabular-nums text-bone sm:text-[44px] ${c.weight}`}>
                {c.multiplier}×
              </span>
              <span className="mt-3 font-sans text-[12.5px] tabular-nums text-bone-faint">{c.stake}</span>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
