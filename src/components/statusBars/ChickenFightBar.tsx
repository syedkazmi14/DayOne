import { useMemo, type CSSProperties } from 'react'
import type { StatusBarProps } from './types'
import { useTrackWidth } from './useTrackWidth'

/* ============================================================================
 * Family Guy — Peter punches the chicken across the status bar.
 *
 *   [ Peter ] ~~~~ blood trail ~~~~ [ chicken → ]
 *
 * Peter is fixed on the left. The chicken is the moving endpoint: its left
 * edge sits exactly where progress puts the end of the trail. Both figures are
 * the supplied PNGs in public/statusBars/, cropped to the character with
 * background positioning so the files stay untouched.
 *
 * The trail is one organic streak laid out along the FULL track and revealed
 * up to the current progress, so its shape never shifts as it grows — only
 * how much of it you see.
 * ========================================================================== */

const PETER_SRC = '/statusBars/peterPunch.png'
const CHICKEN_SRC = '/statusBars/chickenFlying.png'

/** Both PNGs share a 577×433 canvas; boxes are the character, in source pixels. */
const CANVAS = { w: 577, h: 433 }
const PETER = { x: 82, y: 108, w: 218, h: 261, fistX: 296, fistY: 176 }
const CHICKEN = { x: 257, y: 104, w: 259, h: 263, beakX: 275, beakY: 176 }

/** The trail runs a few px under the chicken so the join is never a seam. */
const OVERLAP = 7

const BLOOD = '#8E1616'
const BLOOD_CORE = '#B22222'

/** Stable pseudo-random numbers, so the splatter is the same every render. */
const rand = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** A wavy-edged streak `length` px long, centred on y = 0. */
function streak(length: number, halfMin: number, halfMax: number, seed: number) {
  const step = 11
  const n = Math.max(2, Math.ceil(length / step))
  const top: string[] = []
  const bottom: string[] = []
  for (let i = 0; i <= n; i++) {
    const x = Math.min(length, i * step)
    // taper out of the fist, then wander between halfMin and halfMax
    const taper = Math.min(1, x / 26)
    const half = (halfMin + (halfMax - halfMin) * rand(seed + i)) * (0.35 + 0.65 * taper)
    const drift = (rand(seed + i * 3.1) - 0.5) * 0.9
    top.push(`${x}px calc(50% + ${(-half + drift).toFixed(2)}px)`)
    bottom.unshift(`${x}px calc(50% + ${(half + drift * 0.6).toFixed(2)}px)`)
  }
  return `polygon(${[...top, ...bottom].join(', ')})`
}

interface Drop {
  x: number
  y: number
  w: number
  h: number
}

/** Occasional drips and flecks off the streak — sparse, small, never on the art. */
function splatter(length: number, seed: number): Drop[] {
  const drops: Drop[] = []
  for (let x = 40, i = 0; x < length - 10; i++) {
    const r = rand(seed + i * 7.7)
    const below = rand(seed + i * 5.3) > 0.35
    const drip = below && r > 0.55
    drops.push({
      x,
      y: below ? 3 + r * (drip ? 4 : 3) : -(3 + r * 3),
      w: drip ? 2 : 1.5 + r * 1.5,
      h: drip ? 3 + r * 2.5 : 1.5 + r * 1.5,
    })
    x += 38 + rand(seed + i * 2.9) * 70
  }
  return drops
}

export function ChickenFightBar({ progress, compact }: StatusBarProps) {
  const [ref, boxW] = useTrackWidth<HTMLDivElement>()

  /* Same footprint as the portal-gun bar: 38px tall (30 compact). The figures
   * overhang it a few pixels so they read clearly without moving the layout. */
  const boxH = compact ? 30 : 38
  const figureH = compact ? 38 : 46
  const figureTop = (boxH - figureH) / 2

  const p = figureH / PETER.h
  const c = figureH / CHICKEN.h
  const peterW = PETER.w * p
  const chickenW = CHICKEN.w * c

  const fistX = (PETER.fistX - PETER.x) * p
  const lineY = figureTop + (PETER.fistY - PETER.y) * p
  const beakOffset = (CHICKEN.beakX - CHICKEN.x) * c
  const chickenTop = lineY - (CHICKEN.beakY - CHICKEN.y) * c

  /* The chicken travels from just off the fist to the far right edge. */
  const start = fistX - 2
  const travel = Math.max(0, boxW - chickenW + beakOffset - start)
  const trailW = Math.max(0, Math.min(1, progress)) * travel
  const chickenLeft = start + trailW - beakOffset

  const full = Math.max(0, boxW - start)
  const shape = useMemo(
    () => ({
      under: streak(full, 2.1, 3.3, 11),
      core: streak(full, 0.9, 1.7, 29),
      drops: splatter(full, 5),
    }),
    [full],
  )

  const crop = (src: string, box: typeof PETER | typeof CHICKEN, scale: number): CSSProperties => ({
    backgroundImage: `url(${src})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${CANVAS.w * scale}px ${CANVAS.h * scale}px`,
    backgroundPosition: `${-box.x * scale}px ${-box.y * scale}px`,
  })

  return (
    <div ref={ref} className="relative w-full" style={{ height: boxH }}>
      {/* the trail, revealed up to the chicken */}
      <div
        className="absolute overflow-hidden transition-[width] duration-700 ease-out"
        style={{ left: start, top: lineY - 12, width: trailW + OVERLAP, height: 24 }}
        aria-hidden="true"
      >
        <div className="absolute inset-y-0 left-0" style={{ width: full, background: BLOOD, clipPath: shape.under }} />
        <div className="absolute inset-y-0 left-0" style={{ width: full, background: BLOOD_CORE, clipPath: shape.core }} />
        {shape.drops.map((d, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{ left: d.x, top: 12 + d.y, width: d.w, height: d.h, background: BLOOD }}
          />
        ))}
      </div>

      {/* the splat at the point of impact, tucked under the beak */}
      <span
        className="absolute rounded-full transition-[left] duration-700 ease-out"
        style={{ left: start + trailW - 3, top: lineY - 3.5, width: 10, height: 7, background: BLOOD_CORE, boxShadow: `0 0 0 1px ${BLOOD}` }}
        aria-hidden="true"
      />

      {/* Peter, fixed */}
      <div
        className="pointer-events-none absolute left-0"
        style={{ top: figureTop, width: peterW, height: figureH, ...crop(PETER_SRC, PETER, p) }}
        aria-hidden="true"
      />

      {/* the chicken, riding the end of the trail */}
      <div
        className="pointer-events-none absolute transition-[left] duration-700 ease-out"
        style={{ left: chickenLeft, top: chickenTop, width: chickenW, height: figureH }}
        aria-hidden="true"
      >
        <div className="chicken-tumble h-full w-full" style={crop(CHICKEN_SRC, CHICKEN, c)} />
      </div>
    </div>
  )
}
