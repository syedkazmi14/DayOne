/** Film grain + vignette. One fixed layer, drawn once, never re-renders. */
export function FilmOverlay({ intensity = 0.16 }: { intensity?: number }) {
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <svg className="absolute inset-0 h-full w-full" aria-hidden>
        <filter id="onboard-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect
          width="100%"
          height="100%"
          filter="url(#onboard-grain)"
          opacity={intensity}
          className="animate-grain"
          style={{ transformOrigin: 'center' }}
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
