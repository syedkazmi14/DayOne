import { pct, type RateStat, type RunTelemetry } from '@/engine/telemetry'
import { Eyebrow } from './ui/Bits'

/* ============================================================================
 * What the run measured — accuracy by threat source, tempo under authority,
 * wager calibration, and the single biggest weakness. All deterministic.
 *
 * Laid out as a plain grid of figures: a label, a number, one line of context.
 * ========================================================================== */

const CALIBRATION = {
  overconfident: 'Overconfident',
  underconfident: 'Underconfident',
  calibrated: 'Well calibrated',
  no_data: 'No bets placed',
} as const

function Figure({ label, value, note, bar }: { label: string; value: string; note?: string; bar?: number }) {
  return (
    <div>
      <div className="font-sans text-[12.5px] text-bone-faint">{label}</div>
      <div className="mt-1 font-sans text-[22px] font-medium leading-none tabular-nums text-bone">{value}</div>
      {bar !== undefined && (
        <div className="mt-2.5 h-[3px] overflow-hidden rounded rail">
          <div className="h-full rounded bg-bone-dim" style={{ width: `${Math.max(2, bar * 100)}%` }} />
        </div>
      )}
      {note && <div className="mt-1.5 font-sans text-[12.5px] text-bone-faint">{note}</div>}
    </div>
  )
}

const rate = (label: string, stat: RateStat) =>
  stat.rate === null ? null : (
    <Figure
      label={label}
      value={pct(stat.rate)}
      bar={stat.rate}
      note={`${stat.correct} of ${stat.total} strong call${stat.total === 1 ? '' : 's'}`}
    />
  )

export function RunTelemetryPanel({ telemetry: t }: { telemetry: RunTelemetry }) {
  const cal = t.calibration
  const slow = t.authoritySlowdownMs

  return (
    <section className="mt-16">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Eyebrow>behaviour under pressure</Eyebrow>
        <span className="font-sans text-[12px] text-bone-faint">Measured from your decision log</span>
      </div>

      <div className="grid gap-x-10 gap-y-8 sm:grid-cols-3">
        {rate('External threats', t.bySource.external)}
        {rate('Coworker requests', t.bySource.internal)}
        {rate('Authority pressure', t.byPressure.authority)}
        {slow !== null && (
          <Figure
            label="Decision time under authority"
            value={Math.abs(slow) < 50 ? '0.0s' : `${slow > 0 ? '+' : '−'}${(Math.abs(slow) / 1000).toFixed(1)}s`}
            note={Math.abs(slow) < 50 ? 'no change' : slow > 0 ? 'slower than usual' : 'faster than usual'}
          />
        )}
        <Figure
          label="Wager calibration"
          value={CALIBRATION[cal.verdict]}
          note={cal.meanConfidence !== null ? `bet like ${pct(cal.meanConfidence)} sure, delivered ${pct(cal.hitRate!)}` : undefined}
        />
      </div>

      {t.weakness && (
        <div className="mt-8 max-w-2xl">
          <div className="font-sans text-[12.5px] text-bone-faint">Biggest weakness</div>
          <p className="mt-1 font-sans text-[15px] text-bone">{t.weakness.headline}</p>
          <p className="mt-0.5 font-sans text-[12.5px] text-bone-faint">{t.weakness.evidence}</p>
        </div>
      )}
    </section>
  )
}
