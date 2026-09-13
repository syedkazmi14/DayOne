import { motion } from 'framer-motion'
import { wagerOptions, type WagerTier } from '@/engine/risk'

/* ============================================================================
 * WAGER — four cards, laid out low to high.
 *
 * VIRTUAL CREDITS ONLY. The player's own decision settles the bet, never
 * chance and never a model. The mastery estimate is recorded by the reducer
 * and only revealed after the world reacts, so nothing here anchors the call.
 *
 * Each option is a paper playing card: the multiplier is the rank, indexed in
 * the corners and set large in the centre with the stake under it. Suits
 * follow bridge order (clubs < diamonds < hearts < spades) so the lowest suit
 * is the pass and the highest is all in. Passing is a 1× card like the others,
 * because it is an equally valid call.
 * ========================================================================== */

type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades'

/* Card stock, ink and hairline — the cards are paper on the table, so they
 * carry their own palette rather than the app's dark UI tokens. */
const PAPER = '#F4EEE1'
const NAVY = '#1E2A4A'
const RED = '#B3302B'
const INK: Record<Suit, string> = { clubs: NAVY, diamonds: RED, hearts: RED, spades: NAVY }
const HAIRLINE = 'rgba(30, 42, 74, 0.22)'

function SuitMark({ suit, className = '' }: { suit: Suit; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} style={{ fill: INK[suit] }}>
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

/** A hairline rule broken by a run of all four suits — the deck's signature. */
function PipRule({ className = '' }: { className?: string }) {
  return (
    <div className={`absolute inset-x-[27%] flex items-center gap-1 ${className}`} aria-hidden="true">
      <span className="h-px flex-1" style={{ background: HAIRLINE }} />
      {(['diamonds', 'spades', 'hearts', 'clubs'] as const).map((s) => (
        <SuitMark key={s} suit={s} className="h-[7px] w-[7px]" />
      ))}
      <span className="h-px flex-1" style={{ background: HAIRLINE }} />
    </div>
  )
}

/** The multiplier as a card rank: lining serif figures (Playfair defaults to
 * old-style, where 1 reads as I) and a sturdier sans ×. */
function Rank({ value }: { value: number }) {
  return (
    <>
      <span className="font-card [font-variant-numeric:lining-nums_tabular-nums]">{value}</span>
      <span className="relative -top-[0.32em] ml-[0.04em] font-sans text-[0.6em] font-semibold">×</span>
    </>
  )
}

/** Rank over suit, the way a real card is indexed in its corner. It sits on a
 * patch of card stock so it breaks the printed frame instead of crossing it. */
function CornerIndex({ suit, rank, className = '' }: { suit: Suit; rank: number; className?: string }) {
  return (
    <div
      className={`absolute flex flex-col items-center gap-[3px] px-[3px] py-[2px] leading-none ${className}`}
      style={{ background: PAPER }}
      aria-hidden="true"
    >
      <span className="text-[14px] font-bold" style={{ color: INK[suit] }}>
        <Rank value={rank} />
      </span>
      <SuitMark suit={suit} className="h-[10px] w-[10px]" />
    </div>
  )
}

interface Card {
  key: string
  suit: Suit
  multiplier: number
  stake: string
  ariaLabel: string
  disabled?: boolean
  onPick: () => void
}

const SUIT: Record<WagerTier, Suit> = { safe: 'diamonds', risky: 'hearts', allin: 'spades' }

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
      ariaLabel: 'No bet, 1×',
      onPick: onSkip,
    },
    ...wagerOptions(credits).map((o) => ({
      key: o.tier,
      suit: SUIT[o.tier],
      multiplier: o.multiplier,
      stake: `Stake ${o.stake.toLocaleString()}`,
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
              className="relative flex aspect-[5/7] min-w-0 flex-col items-center justify-center rounded shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_14px_28px_-12px_rgba(0,0,0,0.7),0_2px_4px_rgba(0,0,0,0.35)] transition-[transform,box-shadow] duration-200 hover:-translate-y-1.5 hover:shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_22px_36px_-12px_rgba(0,0,0,0.75),0_2px_4px_rgba(0,0,0,0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 disabled:pointer-events-none disabled:opacity-40 disabled:saturate-0"
              style={{ background: PAPER }}
            >
              {/* inset frame, like the printed border inside a card's edge */}
              <span className="pointer-events-none absolute inset-[7px] rounded border" style={{ borderColor: HAIRLINE }} />

              <CornerIndex suit={c.suit} rank={c.multiplier} className="left-[3px] top-3" />
              <CornerIndex suit={c.suit} rank={c.multiplier} className="bottom-3 right-[3px] rotate-180" />
              <PipRule className="top-[18px]" />
              <PipRule className="bottom-[18px]" />

              <SuitMark suit={c.suit} className="h-7 w-7 sm:h-8 sm:w-8" />
              <span className="mt-3 text-[36px] font-bold leading-none sm:text-[40px]" style={{ color: NAVY }}>
                <Rank value={c.multiplier} />
              </span>
              <span
                className="mt-3 font-sans text-[10.5px] font-medium uppercase tracking-[0.2em] tabular-nums"
                style={{ color: 'rgba(30, 42, 74, 0.62)' }}
              >
                {c.stake}
              </span>
            </motion.button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
