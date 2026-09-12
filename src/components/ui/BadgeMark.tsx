import { BadgeCheck, CalendarCheck, Clover, Coins, Drumstick, ShieldCheck, Stamp, type LucideIcon } from 'lucide-react'

/* A small round medallion. One quiet glyph per badge; the name always travels
 * with it in text, so the mark never has to carry meaning on its own. */

const ICONS: Record<string, { Icon: LucideIcon; color: string }> = {
  'chicken-badge': { Icon: Drumstick, color: '#D9C58A' },
  'certified-menace': { Icon: Stamp, color: '#FF7A1A' },
  'first-week': { Icon: CalendarCheck, color: '#EDE9E2' },
  'perfect-episode': { Icon: BadgeCheck, color: '#54D1A0' },
  'no-warnings': { Icon: ShieldCheck, color: '#6FD3D8' },
  'high-roller': { Icon: Coins, color: '#F5A524' },
  'lucky-guess': { Icon: Clover, color: '#54D1A0' },
}

export function BadgeMark({ id, size = 28, dim = false }: { id: string; size?: number; dim?: boolean }) {
  const glyph = Math.round(size * 0.5)
  const entry = ICONS[id]
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full border border-bone/15 bg-ink-700 ${
        dim ? 'opacity-40 grayscale' : ''
      }`}
      style={{ width: size, height: size }}
    >
      {entry ? (
        <entry.Icon size={glyph} color={entry.color} strokeWidth={1.75} />
      ) : (
        <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
          {id === 'portal-badge' && (
            <>
              <ellipse cx="12" cy="12" rx="9" ry="10" stroke="#97CE4C" strokeWidth="1.8" />
              <ellipse cx="12.5" cy="12" rx="5.5" ry="6.5" stroke="#97CE4C" strokeWidth="1.5" opacity=".7" />
              <ellipse cx="13" cy="12" rx="2.2" ry="3" fill="#C6F27A" opacity=".8" />
            </>
          )}
          {id === 'plumbus-badge' && (
            <path
              d="M7 19c-2.5-1-3-4-1.5-6.5C4 10 5.5 6.5 8.5 6.5c.5-2 3-3 4.5-1.5 2-1.5 5 0 5 2.5 2.5.5 3 3.5 1.5 5 1.5 2 .5 5-2 5.5-1 2-4 2.5-5.5 1C10.5 20.5 8 20.5 7 19Z"
              stroke="#E79CB5"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          )}
        </svg>
      )}
    </span>
  )
}
