import { memo } from 'react'
import type { Character } from '@/types'

/* ============================================================================
 * Poster-style character portraits, drawn as SVG.
 *
 * Deliberately graphic rather than illustrative — silhouette, a hard key light
 * from one side, and a garment that carries most of the identity. Each build
 * differs in head shape, hair outline AND neckline, so the four read as four
 * people at 60px, not as four tinted copies of the same avatar.
 *
 * A customer swapping in licensed or self-recorded character assets replaces
 * this component's output, not the episode data.
 * ========================================================================== */

type Build = Character['portrait']['build']

interface Figure {
  /** Head and neck. */
  head: string
  /** Behind the head — long hair, drawn before the body. */
  hairBack?: string
  /** Over the head. */
  hair: string
  /** Shoulders and torso. */
  body: string
  /** Garment detail drawn over the body: collar, lapel, neckline. */
  garment?: string
  /** Stroked garment detail rather than filled. */
  garmentStroke?: string
}

/* All paths live in a 200 x 230 frame, figure centred on x=100. */
const FIGURE: Record<Build, Figure> = {
  // DEX — angular jaw, spiky hair, open collar, shoulders thrown back.
  spiky: {
    head: 'M100 44c19 0 31 14 31 33 0 10-2 18-5 25-3 7-9 13-16 15l1 15h-22l1-15c-7-2-13-8-16-15-3-7-5-15-5-25 0-19 12-33 31-33Z',
    hair: 'M67 62c3-15 16-25 33-25s30 9 33 23l-7-8-4 9-7-9-5 10-7-10-6 11-6-9-6 10-8-8-6 9-4-3Z',
    body: 'M100 132c-9 0-17 2-24 5l-6 3c-16 8-25 22-29 39-3 12-5 25-6 36h130c-1-11-3-24-6-36-4-17-13-31-29-39l-6-3c-7-3-15-5-24-5Z',
    garmentStroke: 'M86 137 100 171 114 137M100 171v42',
  },
  // MILO — round head, soft cap of hair, crew-neck knit, narrow shoulders.
  round: {
    head: 'M100 40c20 0 33 16 33 35 0 13-3 23-9 30-4 5-9 9-14 10l1 14h-22l1-14c-5-1-10-5-14-10-6-7-9-17-9-30 0-19 13-35 33-35Z',
    hair: 'M67 78c-1-6-1-11-1-16 0-21 15-34 34-34s34 13 34 34c0 5 0 10-1 16l-7-4c1-4 1-7 1-10-4-12-14-19-27-19s-23 7-27 19c0 3 0 6 1 10Z',
    body: 'M100 128c-24 0-41 14-47 35-4 13-6 27-7 39h108c-1-12-3-26-7-39-6-21-23-35-47-35Z',
    garmentStroke: 'M79 137q21 20 42 0',
  },
  // NOOR — long hair falling past the shoulders, blazer with a notched lapel.
  long: {
    hairBack: 'M60 80c0-27 18-44 40-44s40 17 40 44c0 30 5 52 12 74l-24-4c4-20 5-40 3-56-5 12-16 19-31 19s-26-7-31-19c-2 16-1 36 3 56l-24 4c7-22 12-44 12-74Z',
    head: 'M100 44c18 0 30 14 30 33 0 12-3 22-8 29-4 5-9 8-15 9l1 15h-16l1-15c-6-1-11-4-15-9-5-7-8-17-8-29 0-19 12-33 30-33Z',
    hair: 'M68 72c0-24 14-38 32-38s32 14 32 38c-4-14-15-22-32-22s-28 8-32 22Z',
    body: 'M100 130c-25 0-43 14-49 36-4 13-6 26-7 38h112c-1-12-3-25-7-38-6-22-24-36-49-36Z',
    garment: 'M88 133 100 168 74 204l-6-40c3-13 10-24 20-31Zm24 0c10 7 17 18 20 31l-6 40-26-36Z',
    garmentStroke: 'M100 168v36',
  },
  // VERA — cropped hair with a low bun, high-collar blazer, square shoulders.
  sharp: {
    head: 'M100 46c17 0 29 13 29 32 0 12-3 22-8 29-4 5-9 8-14 9l1 14h-16l1-14c-5-1-10-4-14-9-5-7-8-17-8-29 0-19 12-32 29-32Z',
    hair: 'M71 70c0-22 13-35 29-35s29 13 29 35l-6-2c-3-13-11-20-23-20s-20 7-23 20l-6 2Zm58 6c9 1 14 7 14 14s-6 12-14 12Z',
    body: 'M100 130c-27 0-46 15-52 38-3 13-5 25-6 36h116c-1-11-3-23-6-36-6-23-25-38-52-38Z',
    garment: 'M90 132 100 160l-10 44-16-6 4-58c3-3 7-6 12-8Zm20 0c5 2 9 5 12 8l4 58-16 6-10-44Z',
    garmentStroke: 'M100 160v44',
  },
  // YOU — the protagonist. No features, broad shoulders, deliberately anonymous.
  wide: {
    head: 'M100 46c19 0 33 15 33 34 0 20-14 36-33 36s-33-16-33-36c0-19 14-34 33-34Z',
    hair: '',
    body: 'M100 130c-29 0-50 16-57 40-4 13-6 25-7 35h128c-1-10-3-22-7-35-7-24-28-40-57-40Z',
  },
}

interface Props {
  character: Character
  size?: number
  /** Stretch to the parent box instead of a fixed pixel size. */
  fill?: boolean
  speaking?: boolean
  dim?: boolean
  className?: string
}

export const CharacterPortrait = memo(function CharacterPortrait({
  character,
  size = 160,
  fill = false,
  speaking = false,
  dim = false,
  className = '',
}: Props) {
  const f = FIGURE[character.portrait.build]
  const uid = `p-${character.id}`
  const { hue, hue2 } = character.portrait

  return (
    <div
      className={`relative ${fill ? 'h-full w-full' : ''} ${className}`}
      style={{
        ...(fill ? {} : { width: size, height: size * 1.15 }),
        opacity: dim ? 0.4 : 1,
        transition: 'opacity .5s',
      }}
    >
      <svg viewBox="0 0 200 230" className="h-full w-full drag-none" aria-label={character.name}>
        <defs>
          {/* Key light from the upper right, falling into near-black. */}
          <linearGradient id={`${uid}-skin`} x1="1" y1="0" x2="0.1" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity="1" />
            <stop offset="52%" stopColor={hue2} stopOpacity="1" />
            <stop offset="100%" stopColor="#070809" stopOpacity="1" />
          </linearGradient>
          <linearGradient id={`${uid}-cloth`} x1="1" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stopColor={hue2} stopOpacity="0.95" />
            <stop offset="48%" stopColor="#11151B" stopOpacity="1" />
            <stop offset="100%" stopColor="#06070A" stopOpacity="1" />
          </linearGradient>
          <radialGradient id={`${uid}-halo`}>
            <stop offset="0%" stopColor={hue} stopOpacity="0.26" />
            <stop offset="62%" stopColor={hue} stopOpacity="0.05" />
            <stop offset="100%" stopColor={hue} stopOpacity="0" />
          </radialGradient>
          {/* Rim light: a thin bright edge on the key side only. */}
          <linearGradient id={`${uid}-rim`} x1="1" y1="0.2" x2="0.55" y2="0.8">
            <stop offset="0%" stopColor={hue} stopOpacity="0.95" />
            <stop offset="100%" stopColor={hue} stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${uid}-figure`}>
            <path d={f.body} />
            <path d={f.head} />
          </clipPath>
        </defs>

        <circle cx="100" cy="110" r="96" fill={`url(#${uid}-halo)`} />

        {/* cast shadow */}
        <g transform="translate(6 6)" opacity="0.45">
          {f.hairBack && <path d={f.hairBack} fill="#000" />}
          <path d={f.body} fill="#000" />
          <path d={f.head} fill="#000" />
        </g>

        <g
          style={{
            transformOrigin: '100px 214px',
            animation: speaking ? 'breathe 1.5s ease-in-out infinite' : undefined,
          }}
        >
          {f.hairBack && <path d={f.hairBack} fill={hue2} opacity="0.55" />}

          <path d={f.body} fill={`url(#${uid}-cloth)`} />
          {f.garment && <path d={f.garment} fill={hue2} opacity="0.32" />}
          {f.garmentStroke && (
            <path d={f.garmentStroke} fill="none" stroke={hue} strokeWidth="1.6" opacity="0.42" strokeLinecap="round" />
          )}

          <path d={f.head} fill={`url(#${uid}-skin)`} />
          {f.hair && <path d={f.hair} fill={hue2} />}
          {f.hair && <path d={f.hair} fill="#000" opacity="0.2" />}

          {/* rim light along the lit edge, clipped to the figure */}
          <g clipPath={`url(#${uid}-figure)`} style={{ mixBlendMode: 'screen' }}>
            <rect x="0" y="0" width="200" height="230" fill={`url(#${uid}-rim)`} opacity="0.5" />
          </g>

          <path d={f.head} fill="none" stroke={hue} strokeWidth="1" opacity="0.4" />
          <path d={f.body} fill="none" stroke={hue} strokeWidth="1" opacity="0.22" />
        </g>
      </svg>

      {speaking && (
        <div className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-end gap-[3px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-full"
              style={{
                background: hue,
                height: 5 + ((i * 7) % 12),
                animation: `breathe ${0.6 + i * 0.13}s ease-in-out infinite alternate`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
})
