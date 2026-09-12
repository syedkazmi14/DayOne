import { motion } from 'framer-motion'
import { Star } from 'lucide-react'
import type { ReactNode } from 'react'

export const Eyebrow = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`t-eyebrow ${className}`}>{children}</div>
)

export function Chip({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: 'neutral' | 'signal' | 'good' | 'danger' | 'cyan'
  className?: string
}) {
  const tones = {
    neutral: 'border-bone/15 text-bone-dim',
    signal: 'border-signal/40 text-signal',
    good: 'border-good/40 text-good',
    danger: 'border-danger/45 text-danger',
    cyan: 'border-cyan/40 text-cyan',
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

export function Btn({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'outline' | 'danger'
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const base =
    'group relative inline-flex items-center justify-center gap-2.5 px-6 py-3 font-mono text-[11px] uppercase tracking-[0.2em] transition-all duration-300 disabled:opacity-35 disabled:pointer-events-none'
  const variants = {
    primary: 'bg-signal text-ink-900 hover:bg-signal-hot hover:shadow-[0_0_40px_-8px_rgba(245,165,36,.6)]',
    outline: 'border border-bone/20 text-bone hover:border-signal/60 hover:text-signal',
    ghost: 'text-bone-dim hover:text-bone',
    danger: 'border border-danger/40 text-danger hover:bg-danger/10',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function Meter({
  value,
  label,
  sub,
  accent = '#F5A524',
  delta,
}: {
  value: number
  label: string
  sub?: string
  accent?: string
  delta?: number
}) {
  const pct = Math.round(value * 100)
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="t-label text-bone-dim">{label}</span>
        <span className="flex items-baseline gap-2 font-mono text-[13px] tabular-nums" style={{ color: accent }}>
          {delta !== undefined && Math.abs(delta) > 0.005 && (
            <span className={`text-[10px] ${delta > 0 ? 'text-good' : 'text-danger'}`}>
              {delta > 0 ? '▲' : '▼'}
              {Math.abs(Math.round(delta * 100))}
            </span>
          )}
          {pct}%
        </span>
      </div>
      <div className="relative h-[3px] w-full rail overflow-hidden">
        <motion.div
          className="absolute inset-y-0 left-0"
          style={{ background: accent, boxShadow: `0 0 12px ${accent}66` }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      {sub && <div className="mt-1 font-mono text-[10px] text-bone-faint">{sub}</div>}
    </div>
  )
}

export const Stars = ({ n, size = 13 }: { n: number; size?: number }) => (
  <span className="inline-flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((i) => (
      <Star
        key={i}
        size={size}
        className={i <= n ? 'text-signal' : 'text-bone/20'}
        fill={i <= n ? 'currentColor' : 'none'}
        strokeWidth={1.6}
      />
    ))}
  </span>
)

/** Section divider with a label sitting on the line. */
export const Rule = ({ label }: { label?: string }) => (
  <div className="flex items-center gap-3">
    <span className="h-px flex-1 bg-bone/10" />
    {label && <span className="t-eyebrow">{label}</span>}
    <span className="h-px flex-1 bg-bone/10" />
  </div>
)
