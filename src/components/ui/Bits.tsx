import { motion } from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'

export const Eyebrow = ({
  children,
  className = '',
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) => (
  <div className={`t-eyebrow ${className}`} style={style}>
    {children}
  </div>
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
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.07em] ${tones[tone]} ${className}`}
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
  size = 'md',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'outline' | 'danger'
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
  size?: 'md' | 'sm'
}) {
  const sizes = { md: 'px-6 py-3 text-[13.5px]', sm: 'px-4 py-2 text-[13px]' }
  const base = `group relative inline-flex items-center justify-center gap-2 rounded font-sans font-medium transition-colors duration-200 disabled:opacity-35 disabled:pointer-events-none ${sizes[size]}`
  const variants = {
    primary: 'bg-signal text-ink-900 hover:bg-signal-hot',
    outline: 'border border-bone/15 text-bone-dim hover:border-bone/35 hover:text-bone',
    ghost: 'text-bone-dim hover:text-bone',
    danger: 'border border-danger/35 text-danger hover:bg-danger/10',
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
      <div className="relative h-[3px] w-full rail overflow-hidden rounded">
        <motion.div
          className="absolute inset-y-0 left-0 rounded"
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

/** Section divider with a label sitting on the line. */
export const Rule = ({ label }: { label?: string }) => (
  <div className="flex items-center gap-3">
    <span className="h-px flex-1 bg-bone/10" />
    {label && <span className="t-eyebrow">{label}</span>}
    <span className="h-px flex-1 bg-bone/10" />
  </div>
)
