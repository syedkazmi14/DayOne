import type { StatusBarProps } from './types'

/** ●───○───○───○ — the default design: act-level dots with their labels. */
export function ActRailBar({ episode, currentAct, compact }: StatusBarProps) {
  return (
    <div className="flex items-center gap-2">
      {episode.beats.map((b, i) => {
        const done = b.act < currentAct
        const active = b.act === currentAct
        return (
          <div key={b.act} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className="relative block rounded-full transition-all duration-500"
                style={{
                  width: active ? 9 : 6,
                  height: active ? 9 : 6,
                  background: active ? '#F5A524' : done ? 'rgba(237,233,226,.55)' : 'rgba(237,233,226,.18)',
                  boxShadow: active ? '0 0 14px rgba(245,165,36,.8)' : undefined,
                }}
              />
              {!compact && (
                <span
                  className={`font-mono text-[9px] uppercase tracking-[0.18em] transition-colors ${
                    active ? 'text-signal' : done ? 'text-bone-dim' : 'text-bone-faint'
                  }`}
                >
                  {b.label}
                </span>
              )}
            </div>
            {i < episode.beats.length - 1 && (
              <span
                className="block h-px transition-all duration-500"
                style={{ width: compact ? 14 : 22, background: done ? 'rgba(237,233,226,.4)' : 'rgba(237,233,226,.14)' }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
