/* ============================================================================
 * PROFILE AVATAR — the player's initials, plus an optional cosmetic border.
 *
 * Borders are drawn as an SVG ring that sits just outside the circle, so they
 * never crop the avatar and scale cleanly at any size. Motion is limited to a
 * slow drift or flicker and is dropped entirely under reduced motion.
 * ========================================================================== */

export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

const initials = (s: string) =>
  s
    .split(' ')
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')

/** The SVG box is this much larger than the avatar, leaving room for the ring. */
const RING_SCALE = 1.3

export function ProfileAvatar({
  name,
  borderId,
  size = 72,
}: {
  name: string
  borderId?: string | null
  size?: number
}) {
  const ring = size * RING_SCALE
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="flex h-full w-full items-center justify-center rounded-full bg-ink-600 font-sans font-medium text-bone-dim"
        style={{ fontSize: Math.round(size * 0.3) }}
      >
        {initials(name)}
      </div>
      {borderId && (
        <svg
          viewBox="0 0 120 120"
          aria-hidden
          className="pointer-events-none absolute"
          style={{ width: ring, height: ring, left: (size - ring) / 2, top: (size - ring) / 2 }}
        >
          <BorderArt id={borderId} />
        </svg>
      )}
    </div>
  )
}

/* Avatar edge sits at r ≈ 46 in this 120-unit box. */
const C = 60
const spin = 'motion-safe:animate-[spin_28s_linear_infinite] origin-center [transform-box:fill-box]'

function BorderArt({ id }: { id: string }) {
  switch (id) {
    case 'portal-frame':
      return (
        <>
          <circle cx={C} cy={C} r={50} fill="none" stroke="#97CE4C" strokeWidth={5} opacity={0.18} />
          <circle cx={C} cy={C} r={49} fill="none" stroke="#97CE4C" strokeWidth={2.2} />
          <g className={spin}>
            <circle
              cx={C}
              cy={C}
              r={53}
              fill="none"
              stroke="#C6F27A"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeDasharray="22 9 5 12 14 18"
              opacity={0.75}
            />
          </g>
          <circle cx={C} cy={C} r={56.5} fill="none" stroke="#97CE4C" strokeWidth={0.6} opacity={0.3} />
        </>
      )

    case 'plumbus-frame': {
      const pts = Array.from({ length: 73 }, (_, i) => {
        const t = (i / 72) * Math.PI * 2
        const r = 51 + 2.4 * Math.sin(3 * t) + 1.3 * Math.sin(5 * t + 1)
        return `${(C + r * Math.cos(t)).toFixed(2)},${(C + r * Math.sin(t)).toFixed(2)}`
      })
      const nubs = [38, 158, 282].map((deg) => {
        const t = (deg * Math.PI) / 180
        return { x: C + 56 * Math.cos(t), y: C + 56 * Math.sin(t) }
      })
      return (
        <>
          <polygon points={pts.join(' ')} fill="none" stroke="#E79CB5" strokeWidth={4.5} strokeLinejoin="round" />
          <polygon points={pts.join(' ')} fill="none" stroke="#9E4A6A" strokeWidth={1} opacity={0.7} />
          {nubs.map((n, i) => (
            <circle key={i} cx={n.x} cy={n.y} r={3.4} fill="#E79CB5" stroke="#9E4A6A" strokeWidth={0.8} />
          ))}
        </>
      )
    }

    case 'interdimensional-static':
      return (
        <g className="motion-safe:animate-flicker">
          <circle cx={C + 0.9} cy={C} r={51} fill="none" stroke="#6FD3D8" strokeWidth={3} strokeDasharray="2 3 9 2 1 5 4 2" opacity={0.45} />
          <circle cx={C - 0.9} cy={C} r={51} fill="none" stroke="#FF4D4D" strokeWidth={3} strokeDasharray="2 3 9 2 1 5 4 2" opacity={0.35} />
          <circle cx={C} cy={C} r={51} fill="none" stroke="#EDE9E2" strokeWidth={2.4} strokeDasharray="2 3 9 2 1 5 4 2" opacity={0.85} />
          <circle cx={C} cy={C} r={55} fill="none" stroke="#EDE9E2" strokeWidth={0.8} strokeDasharray="1 6 12 4" opacity={0.35} />
        </g>
      )

    case 'chicken-fight-frame': {
      const feathers = Array.from({ length: 30 }, (_, i) => ({ deg: i * 12, len: 5 + ((i * 5) % 3) * 1.6 }))
      const bursts = [42, 222]
      return (
        <>
          <circle cx={C} cy={C} r={49.5} fill="none" stroke="#D9C58A" strokeWidth={2} />
          {feathers.map((f) => (
            <line
              key={f.deg}
              x1={C}
              y1={C - 50.5}
              x2={C}
              y2={C - 50.5 - f.len}
              stroke={f.deg % 36 === 0 ? '#D9C58A' : '#EDE9E2'}
              strokeWidth={2.2}
              strokeLinecap="round"
              transform={`rotate(${f.deg} ${C} ${C})`}
            />
          ))}
          {bursts.map((deg) => (
            <g key={deg} transform={`rotate(${deg} ${C} ${C})`}>
              {[-22, -11, 0, 11, 22].map((a) => (
                <line
                  key={a}
                  x1={C}
                  y1={C - 58}
                  x2={C}
                  y2={C - 58 - (a === 0 ? 3.5 : 2.2)}
                  stroke="#FF7A1A"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                  transform={`rotate(${a * 0.35} ${C} ${C})`}
                />
              ))}
            </g>
          ))}
        </>
      )
    }

    default:
      return null
  }
}
