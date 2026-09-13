import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Eyebrow } from '../ui/Bits'

const EASE = [0.16, 1, 0.3, 1] as const

export type StepState = 'locked' | 'active' | 'done'

/** Only the active step ever renders in the body — StudioRail (below) owns
 * navigation now, so there is no collapsed row to be, and no reason for a
 * step to know its neighbours. */
export function Step({
  n,
  title,
  detail,
  state,
  children,
}: {
  n: number
  title: string
  detail?: string
  state: StepState
  children?: ReactNode
}) {
  const badge = (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border font-mono text-[11px] ${
        state === 'done' ? 'border-good/50 text-good' : state === 'active' ? 'border-signal/60 text-signal' : 'border-bone/15 text-bone-faint'
      }`}
    >
      {state === 'done' ? <Check size={13} /> : String(n).padStart(2, '0')}
    </span>
  )

  return (
    <motion.section
      data-step={n}
      className="scroll-mt-32"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE }}
    >
      <div className="flex items-start gap-4">
        {badge}
        <div className="min-w-0 flex-1">
          <h2 className="t-section">{title}</h2>
          {detail && <p className="mt-1 max-w-2xl font-sans text-[13px] font-light leading-relaxed text-bone-faint">{detail}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </motion.section>
  )
}

export function StatusCard({
  title,
  value,
  detail,
  tone,
}: {
  title: string
  value: string
  detail: string
  tone: 'good' | 'neutral'
}) {
  return (
    <div className="hairline rounded border border-bone/10 px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>{title}</Eyebrow>
        <span className={`font-mono text-[11px] uppercase tracking-[0.1em] ${tone === 'good' ? 'text-good' : 'text-signal'}`}>{value}</span>
      </div>
      <p className="mt-1.5 font-sans text-[12px] font-light leading-relaxed text-bone-faint [overflow-wrap:anywhere]">{detail}</p>
    </div>
  )
}

/** Step chrome used to live in the flow as a stack of collapsed rows, so by
 * step 7 the active step sat under six rows and started further down the
 * page every single time. Pulling navigation into fixed header chrome fixes
 * that at the cost of the rows themselves — this is the whole nine-step list,
 * always, so it has to stay a single line. `overflow-x-auto` is the release
 * valve if a future label is too long to fit rather than a layout that grows
 * downward again. */
export function StudioRail({
  steps,
  at,
  onJump,
}: {
  steps: { n: number; label: string; state: StepState; summary?: string }[]
  at: number
  onJump: (n: number) => void
}) {
  return (
    <nav aria-label="Studio steps" className="no-scrollbar flex items-center overflow-x-auto">
      {steps.map((step, i) => {
        const { n, label, state, summary } = step
        const active = n === at
        const locked = state === 'locked'
        const done = state === 'done'
        const ariaLabel = `Step ${n}${done ? ', done' : active ? ', current' : locked ? ', locked' : ''}`

        const inner = (
          <>
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-mono text-[9px] ${
                done ? 'border-good/50 text-good' : active ? 'border-signal/70 text-signal' : 'border-bone/15 text-bone-faint/50'
              }`}
            >
              {done ? <Check size={10} /> : n}
            </span>
            <span
              className={`whitespace-nowrap font-sans text-[12px] font-medium ${
                active ? 'text-bone' : done ? 'text-bone-dim' : 'text-bone-faint/40'
              }`}
            >
              {label}
            </span>
          </>
        )

        return (
          <div key={n} className="flex shrink-0 items-center">
            {locked ? (
              // Future steps are shown so the shape of the wizard reads at a
              // glance, but they are not a list of destinations — a div, not
              // a disabled button, so no focus ring implies otherwise.
              <div aria-label={ariaLabel} aria-disabled="true" className="relative flex shrink-0 items-center gap-1.5 rounded px-2.5 py-2">
                {inner}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onJump(n)}
                aria-label={ariaLabel}
                title={done ? summary : undefined}
                className="relative flex shrink-0 items-center gap-1.5 rounded px-2.5 py-2 transition-colors duration-200 hover:bg-bone/[0.04]"
              >
                {inner}
                {active && (
                  // A plain underline, deliberately not a shared-layout one:
                  // App.tsx swaps screens with AnimatePresence mode="wait", and
                  // a layoutId animation inside the outgoing subtree never
                  // settles, so leaving the Studio hung on its own exit and the
                  // next screen never mounted.
                  <span className="absolute inset-x-2.5 -bottom-px h-px bg-signal" />
                )}
              </button>
            )}
            {i < steps.length - 1 && (
              <span className={`h-px w-4 shrink-0 transition-colors duration-300 ${done ? 'bg-bone/25' : 'bg-bone/10'}`} />
            )}
          </div>
        )
      })}
    </nav>
  )
}
