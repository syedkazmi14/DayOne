import { Activity, Gauge, Target, Timer } from 'lucide-react'
import { pct, type RateStat, type RunTelemetry } from '@/engine/telemetry'
import { Chip, Eyebrow } from './ui/Bits'

/* ============================================================================
 * What the run measured — accuracy by threat source, tempo under authority,
 * wager calibration, and the single biggest weakness. All deterministic.
 * ========================================================================== */

const CALIBRATION = {
  overconfident: { label: 'overconfident', tone: 'danger' },
  underconfident: { label: 'underconfident', tone: 'signal' },
  calibrated: { label: 'well calibrated', tone: 'good' },
  no_data: { label: 'no bets placed', tone: 'neutral' },
} as const

function RateBar({ label, stat, accent }: { label: string; stat: RateStat; accent: string }) {
  if (stat.rate === null) return null
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-bone-dim">{label}</span>
        <span className="font-sans text-[24px] font-bold tabular-nums" style={{ color: accent }}>
          {pct(stat.rate)}
        </span>
      </div>
      <div className="h-[4px] overflow-hidden rail">
        <div className="h-full" style={{ width: `${Math.max(2, stat.rate * 100)}%`, background: accent }} />
      </div>
      <div className="mt-1 font-mono text-[9px] text-bone-faint">
        {stat.correct}/{stat.total} strong call{stat.total === 1 ? '' : 's'}
      </div>
    </div>
  )
}

export function RunTelemetryPanel({ telemetry: t }: { telemetry: RunTelemetry }) {
  const cal = t.calibration
  const slow = t.authoritySlowdownMs
  const c = CALIBRATION[cal.verdict]

  return (
    <div className="mt-12">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Activity size={14} className="text-signal" />
        <Eyebrow className="text-signal">behaviour under pressure</Eyebrow>
        <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
          measured from your decision log · no model
        </span>
      </div>

      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-3">
        <RateBar label="external threats" stat={t.bySource.external} accent="#6FD3D8" />
        <RateBar label="coworker requests" stat={t.bySource.internal} accent="#F5A524" />
        <RateBar label="authority pressure" stat={t.byPressure.authority} accent="#FF8A5B" />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {slow !== null && (
          <div className="glass flex items-center gap-4 p-4">
            <Timer size={16} className="shrink-0 text-bone-dim" />
            <div>
              <div className="font-sans text-[22px] font-bold tabular-nums text-bone">
                {slow >= 0 ? '+' : '−'}
                {(Math.abs(slow) / 1000).toFixed(1)}s
              </div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-bone-faint">
                {slow >= 0 ? 'slower' : 'faster'} under authority pressure
              </div>
            </div>
          </div>
        )}
        <div className="glass flex items-center gap-4 p-4">
          <Gauge size={16} className="shrink-0 text-bone-dim" />
          <div className="min-w-0">
            <Chip tone={c.tone}>{c.label}</Chip>
            {cal.meanConfidence !== null && (
              <div className="mt-2 font-mono text-[10px] text-bone-faint">
                bet like {pct(cal.meanConfidence)} sure · delivered {pct(cal.hitRate!)}
              </div>
            )}
          </div>
        </div>
      </div>

      {t.weakness && (
        <div className="mt-6 border-l-2 border-danger/50 pl-4">
          <div className="mb-1 flex items-center gap-2">
            <Target size={12} className="text-danger" />
            <Eyebrow className="text-danger">biggest weakness</Eyebrow>
          </div>
          <p className="font-sans text-[15px] font-light leading-relaxed text-bone">{t.weakness.headline}</p>
          <p className="mt-1 font-mono text-[10px] text-bone-faint">{t.weakness.evidence}</p>
        </div>
      )}
    </div>
  )
}
