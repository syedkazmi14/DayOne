import { BadgeCheck, CalendarCheck, Clover, Coins, ShieldCheck, type LucideIcon } from 'lucide-react'

/* A small round medallion. One quiet glyph (or a cropped photo) per badge; the
 * name always travels with it in text, so the mark never has to carry meaning
 * on its own. */

const ICONS: Record<string, { Icon: LucideIcon; color: string }> = {
  'first-week': { Icon: CalendarCheck, color: '#EDE9E2' },
  'perfect-episode': { Icon: BadgeCheck, color: '#54D1A0' },
  'no-warnings': { Icon: ShieldCheck, color: '#6FD3D8' },
  'high-roller': { Icon: Coins, color: '#F5A524' },
  'lucky-guess': { Icon: Clover, color: '#54D1A0' },
}

export function BadgeMark({
  id,
  image,
  size = 28,
  dim = false,
}: {
  id: string
  image?: string
  size?: number
  dim?: boolean
}) {
  const glyph = Math.round(size * 0.5)
  const entry = ICONS[id]
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-bone/15 bg-ink-700 ${
        dim ? 'opacity-40 grayscale' : ''
      }`}
      style={{ width: size, height: size }}
    >
      {image ? (
        <img src={image} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : entry ? (
        <entry.Icon size={glyph} color={entry.color} strokeWidth={1.75} />
      ) : null}
    </span>
  )
}
