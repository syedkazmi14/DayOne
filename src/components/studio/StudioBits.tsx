import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Eyebrow } from '../ui/Bits'

export type StepState = 'locked' | 'active' | 'done'

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
  return (
    <section className={`mt-14 transition-opacity duration-500 ${state === 'locked' ? 'opacity-40' : ''}`}>
      <div className="flex items-start gap-4">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border font-mono text-[11px] ${
            state === 'done' ? 'border-good/50 text-good' : state === 'active' ? 'border-signal/60 text-signal' : 'border-bone/15 text-bone-faint'
          }`}
        >
          {state === 'done' ? <Check size={13} /> : String(n).padStart(2, '0')}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="t-display text-[clamp(1.35rem,3.4vw,2rem)] text-bone">{title}</h2>
          {detail && <p className="mt-1 max-w-2xl font-sans text-[13px] font-light leading-relaxed text-bone-faint">{detail}</p>}
          {state !== 'locked' && <div className="mt-5">{children}</div>}
        </div>
      </div>
    </section>
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
    <div className="glass p-5">
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <div className={`font-mono text-[12px] uppercase tracking-[0.14em] ${tone === 'good' ? 'text-good' : 'text-signal'}`}>{value}</div>
      <p className="mt-2.5 font-sans text-[12px] font-light leading-relaxed text-bone-faint [overflow-wrap:anywhere]">{detail}</p>
    </div>
  )
}

const NODES = [
  { label: 'COMPANY CONTENT', kind: 'io', sub: 'pdf · transcript · handbook' },
  { label: 'KNOWLEDGE AGENT', kind: 'ai', sub: 'llm · authoring' },
  { label: 'SCENARIO GENERATOR', kind: 'ai', sub: 'llm · authoring' },
  { label: 'EPISODE GRAPH', kind: 'data', sub: 'validated json + shot specs' },
  { label: 'ASSET PIPELINE', kind: 'ai', sub: 'video · image · voice' },
  { label: 'DETERMINISTIC GAME', kind: 'engine', sub: 'reducer · no llm' },
] as const

const COLORS: Record<string, string> = {
  io: 'rgba(237,233,226,.35)',
  ai: '#6FD3D8',
  data: '#F5A524',
  engine: '#54D1A0',
}

export function Pipeline() {
  return (
    <div className="min-w-[900px]">
      <div className="flex items-center gap-2">
        {NODES.map((n, i) => (
          <div key={n.label} className="flex items-center gap-2">
            <div
              className="rounded border px-3 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em]"
              style={{ borderColor: `${COLORS[n.kind]}55`, color: COLORS[n.kind] }}
            >
              {n.label}
              <div className="mt-0.5 text-[7.5px] tracking-[0.12em] text-bone-faint">{n.sub}</div>
            </div>
            {i < NODES.length - 1 && <span className="block h-px w-4 bg-bone/20" />}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-start justify-end gap-5">
        {[
          { label: 'player choice', sub: 'authored branch', ai: false },
          { label: 'character chat', sub: 'rag + llm → elevenlabs', ai: true },
          { label: 'coach → mastery', sub: 'next scenario adapts', ai: true },
        ].map((b) => (
          <div key={b.label} className="flex flex-col items-center">
            <span className={`block h-4 w-px ${b.ai ? 'bg-cyan/40' : 'bg-bone/20'}`} />
            <div
              className={`whitespace-nowrap rounded border px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] ${
                b.ai ? 'border-cyan/40 text-cyan' : 'border-bone/20 text-bone-dim'
              }`}
            >
              {b.label}
              <div className="mt-0.5 text-[7.5px] text-bone-faint">{b.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
