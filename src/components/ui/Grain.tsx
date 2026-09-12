/**
 * Film grain + vignette. One fixed layer; re-renders only when `intensity`
 * changes, and that change is transitioned rather than snapped.
 *
 * The filter region is declared explicitly. The default is
 * `x=-10% y=-10% width=120% height=120%`, which paints noise only from -10% to
 * +110% of the rect — but the `grain` keyframes drift the rect by up to 15%, so
 * anything past that 10% overshoot left a band of un-grained pixels at the
 * viewport edge. Over near-black the grain *lifts* the pixel, so the band read
 * as a black bar flashing four times a second at the top and sides (never the
 * bottom: the largest upward translate is exactly -10%). 20% covers the 15%
 * drift with margin. See tailwind.config.js `keyframes.grain`.
 */
export function FilmOverlay({ intensity = 0.16 }: { intensity?: number }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <filter id="onboard-grain" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect
          width="100%"
          height="100%"
          filter="url(#onboard-grain)"
          className="motion-safe:animate-grain"
          style={{
            transformOrigin: 'center',
            opacity: intensity,
            transition: 'opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </svg>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(130% 100% at 50% 45%, rgba(0,0,0,0) 52%, rgba(0,0,0,0.26) 80%, rgba(0,0,0,0.54) 100%)',
        }}
      />
    </div>
  )
}
