import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { StatusBarProps } from './types'

/* ============================================================================
 * Rick and Morty — the portal gun fires the progress bar.
 *
 * Both visuals are the supplied PNGs in public/statusBars/. The gun is fixed on
 * the left. The shot is split into two slices of the same image:
 *
 *   stem  the straight beam, stretched horizontally to fill the progress width
 *   head  the flared portal, kept at its own proportions on the leading edge
 *
 * so the beam grows like a bar without squashing the portal. All geometry below
 * is measured in source-image pixels and scaled once from the gun's height.
 * The track fills whatever width the parent gives it; the gun never scales.
 * ========================================================================== */

const GUN_SRC = '/statusBars/portalGun.png'
const SHOT_SRC = '/statusBars/shot.png'

const GUN = { w: 402, h: 262, muzzleX: 343, muzzleY: 106, muzzleH: 47 }
const SHOT = {
  w: 376,
  h: 664,
  /** Beam centre line and thickness at the narrow end. */
  stemY: 330,
  stemH: 60,
  /** Vertical band of the stem, cut clean of the lightning around it. */
  bandTop: 296,
  bandBottom: 366,
  /** Where the straight stem hands over to the flare. */
  split: 150,
  /** Right edge of the portal. */
  end: 334,
  /** Where the flare is wide enough that nothing else sits beside it. */
  neck: 210,
}

/** Beam edges where the flare meets the portal (at SHOT.neck). */
const FLARE_TOP = 256
const FLARE_BOTTOM = 404

/** The beam sits a touch narrower than the muzzle it leaves. */
const STEM_TO_MUZZLE = 0.72
/** Tuck the beam under the gun so there is never a seam at the barrel. */
const TUCK = 4

/** Used for the first paint only, before the real width is measured. */
const FALLBACK_W = 360

export function PortalGunBar({ progress, compact }: StatusBarProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [boxW, setBoxW] = useState(FALLBACK_W)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.clientWidth > 0) setBoxW(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => entry.contentRect.width > 0 && setBoxW(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const gunH = compact ? 30 : 38

  const g = gunH / GUN.h
  const s = (GUN.muzzleH * STEM_TO_MUZZLE * g) / SHOT.stemH
  const gunW = GUN.w * g
  const muzzleX = GUN.muzzleX * g
  const muzzleY = GUN.muzzleY * g
  const trackW = Math.max(0, boxW - muzzleX)

  const shotH = SHOT.h * s
  const headW = (SHOT.end - SHOT.split) * s
  const beamW = Math.max(0, progress) * (trackW + TUCK)
  const stemW = Math.max(0, beamW - headW)
  const neckW = (SHOT.neck - SHOT.split) * s

  const image = (size: string, position: string): CSSProperties => ({
    backgroundImage: `url(${SHOT_SRC})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: size,
    backgroundPosition: position,
  })

  return (
    <div ref={ref} className="relative w-full" style={{ height: gunH }}>
      {/* the uncompleted stretch: barely there */}
      <span
        className="absolute h-px bg-bone/10"
        style={{ left: muzzleX, top: muzzleY, width: trackW }}
        aria-hidden="true"
      />

      {/* the shot, clipped to how far the episode has come */}
      <div
        className="absolute overflow-hidden transition-[width] duration-700 ease-out"
        style={{
          left: muzzleX - TUCK,
          top: muzzleY - SHOT.stemY * s,
          width: beamW,
          height: shotH,
          filter: 'drop-shadow(0 0 4px rgba(151, 206, 76, 0.45))',
        }}
        aria-hidden="true"
      >
        {/* stem: the straight band of the shot, stretched to length */}
        <div
          className="absolute left-0 transition-[width] duration-700 ease-out"
          style={{
            top: SHOT.bandTop * s,
            height: (SHOT.bandBottom - SHOT.bandTop) * s,
            width: stemW,
            ...image(`${(stemW * SHOT.w) / SHOT.split}px ${shotH}px`, `0 ${-SHOT.bandTop * s}px`),
          }}
        >
          {/* energy running down the beam — a light sheen, nothing drawn */}
          <span className="portal-beam-sheen absolute inset-0" />
        </div>

        {/* head: the flared portal at its true proportions, riding the front.
         * Its narrow end is trimmed to the beam so no loose lightning fragment
         * floats beside it once the rest of the lightning is cut away. */}
        <div
          className="absolute top-0 transition-[left] duration-700 ease-out"
          style={{
            left: beamW - headW,
            width: headW,
            height: shotH,
            clipPath: `polygon(0 ${SHOT.bandTop * s}px, ${neckW}px ${FLARE_TOP * s}px, ${neckW}px 0, 100% 0, 100% 100%, ${neckW}px 100%, ${neckW}px ${FLARE_BOTTOM * s}px, 0 ${SHOT.bandBottom * s}px)`,
            ...image(`${SHOT.w * s}px ${shotH}px`, `${-SHOT.split * s}px 0`),
          }}
        />
      </div>

      <img
        src={GUN_SRC}
        alt=""
        draggable={false}
        className="pointer-events-none absolute left-0 top-0 select-none"
        style={{ width: gunW, height: gunH }}
      />
    </div>
  )
}
