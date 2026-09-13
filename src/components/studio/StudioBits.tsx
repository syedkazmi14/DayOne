import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Eyebrow } from '../ui/Bits'

const EASE = [0.16, 1, 0.3, 1] as const

export type StepState = 'locked' | 'active' | 'done'

export function Step({
  n,
  title,
  detail,
  state,
  summary,
  open,
  revealed = true,
  onOpen,
  children,
}: {
  n: number
  title: string
  detail?: string
  state: StepState
  summary?: string
  open: boolean
  /** False for steps past the cursor: a step you have not reached yet should
    * not be announced, so it is not rendered at all rather than dimmed. */
  revealed?: boolean
  onOpen: () => void
  children?: ReactNode
}) {
  if (!revealed) return null

  const isOpen = open && state !== 'locked'
  const locked = state === 'locked'

  const badge = (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border font-mono text-[11px] ${
        state === 'done' ? 'border-good/50 text-good' : state === 'active' ? 'border-signal/60 text-signal' : 'border-bone/15 text-bone-faint'
      }`}
    >
      {state === 'done' ? <Check size={13} /> : String(n).padStart(2, '0')}
    </span>
  )

  /* Only the opened body animates. An AnimatePresence swapping the collapsed
   * row for the open one looked right in isolation, but every step runs its
   * own, so reopening a step left a blank hole for over a second while the
   * outgoing rows finished exiting. The row itself is chrome — it should just
   * be there. */
  if (!isOpen) {
    const row = (
      <>
        {badge}
        <span className="min-w-0 flex-1 truncate font-sans text-[14px] font-medium">{title}</span>
        {state === 'done' && summary && (
          <span className="shrink-0 truncate font-mono text-[10px] uppercase tracking-[0.08em] text-bone-faint">{summary}</span>
        )}
      </>
    )
    return locked ? (
      <div
        data-step={n}
        className="flex w-full scroll-mt-32 items-center gap-4 rounded px-1 py-2.5 text-left text-bone-faint/70"
        aria-disabled="true"
      >
        {row}
      </div>
    ) : (
      <button
        type="button"
        data-step={n}
        onClick={onOpen}
        className="flex w-full scroll-mt-32 items-center gap-4 rounded px-1 py-2.5 text-left text-bone-dim transition-colors duration-200 hover:bg-bone/[0.03] hover:text-bone"
      >
        {row}
      </button>
    )
  }

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

export function StudioProgress({
  states,
  at,
  onJump,
}: {
  states: StepState[]
  at: number
  onJump: (n: number) => void
}) {
  return (
    <div className="flex items-center">
      {states.map((state, i) => {
        const n = i + 1
        const active = n === at
        const locked = state === 'locked'
        const done = state === 'done'
        return (
          <div key={n} className="flex items-center">
            <button
              type="button"
              disabled={locked}
              onClick={() => onJump(n)}
              aria-label={`Step ${n}${done ? ', done' : active ? ', current' : locked ? ', locked' : ''}`}
              title={`Step ${n}`}
              className="flex items-center justify-center p-1 disabled:cursor-default"
            >
              <span
                className={`block rounded-full transition-all duration-300 ${
                  active
                    ? 'h-[9px] w-[9px] bg-signal'
                    : done
                      ? 'h-[6px] w-[6px] bg-good/70'
                      : 'h-[6px] w-[6px] bg-bone/18'
                }`}
              />
            </button>
            {i < states.length - 1 && (
              <span className={`block h-px w-[10px] transition-colors duration-300 ${done ? 'bg-bone/35' : 'bg-bone/12'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
