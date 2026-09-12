import { memo } from 'react'
import type { Character } from '@/types'

/* ============================================================================
 * Poster-style duotone character portraits, drawn as SVG.
 *
 * Deliberately graphic rather than illustrative: silhouettes, halftone and a
 * hard rim light. A customer swapping in licensed or self-recorded character
 * assets replaces this component's output, not the episode data.
 * ========================================================================== */

type Build = Character['portrait']['build']

/** Head + shoulders paths per build, in a 200 x 230 frame. */
const FIGURE: Record<Build, { head: string; hair?: string; body: string }> = {
  spiky: {
    head: 'M100 42c19 0 32 15 32 34 0 13-3 22-8 29-4 5-10 9-16 10l-2 14h-12l-2-14c-6-1-12-5-16-10-5-7-8-16-8-29 0-19 13-34 32-34Z',
    hair: 'M64 58c2-14 16-26 36-26 19 0 33 10 36 24l-8-9-5 8-7-9-6 9-6-10-7 10-6-7-6 9-8-8-7 9Z',
    body: 'M100 128c22 0 40 14 47 34 4 12 6 25 7 38H46c1-13 3-26 7-38 7-20 25-34 47-34Z',
  },
  round: {
    head: 'M100 40c21 0 35 16 35 36s-14 38-35 38-35-18-35-38 14-36 35-36Z',
    hair: 'M65 62c0-20 15-33 35-33s35 13 35 33c-6-11-19-17-35-17s-29 6-35 17Z',
    body: 'M100 124c20 0 36 13 43 32 4 12 6 26 7 40H50c1-14 3-28 7-40 7-19 23-32 43-32Z',
  },
  long: {
    head: 'M100 42c19 0 32 15 32 35 0 21-13 37-32 37s-32-16-32-37c0-20 13-35 32-35Z',
    hair: 'M62 74c0-26 16-42 38-42s38 16 38 42c0 24 4 40 9 56l-18-6c3-14 4-28 2-40-4 10-14 16-31 16s-27-6-31-16c-2 12-1 26 2 40l-18 6c5-16 9-32 9-56Z',
    body: 'M100 126c21 0 38 13 45 33 4 12 6 26 7 39H48c1-13 3-27 7-39 7-20 24-33 45-33Z',
  },
  sharp: {
    head: 'M100 44c18 0 30 14 30 33 0 22-12 38-30 38s-30-16-30-38c0-19 12-33 30-33Z',
    hair: 'M68 66c0-22 14-36 32-36s32 14 32 36l-7-4c-3-12-12-19-25-19s-22 7-25 19l-7 4Z',
    body: 'M100 124c8 0 15 2 21 6l-21 16-21-16c6-4 13-6 21-6Zm0 22 25-19c14 7 23 21 26 38 2 11 3 22 4 33H45c1-11 2-22 4-33 3-17 12-31 26-38l25 19Z',
  },
  wide: {
    head: 'M100 44c19 0 33 15 33 34 0 21-14 37-33 37s-33-16-33-37c0-19 14-34 33-34Z',
    body: 'M100 124c25 0 45 15 52 37 4 12 6 25 7 37H41c1-12 3-25 7-37 7-22 27-37 52-37Z',
  },
}

interface Props {
  character: Character
  size?: number
  speaking?: boolean
  dim?: boolean
  className?: string
}

export const CharacterPortrait = memo(function CharacterPortrait({
  character,
  size = 160,
  speaking = false,
  dim = false,
  className = '',
}: Props) {
  const f = FIGURE[character.portrait.build]
  const uid = `p-${character.id}`
  const { hue, hue2 } = character.portrait

  return (
    <div
      className={`relative ${className}`}
      style={{ width: size, height: size * 1.15, transition: 'opacity .5s' , opacity: dim ? 0.4 : 1 }}
    >
      <svg viewBox="0 0 200 230" className="h-full w-full drag-none" aria-label={character.name}>
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity="0.95" />
            <stop offset="55%" stopColor={hue2} stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0A0B0E" stopOpacity="0.95" />
          </linearGradient>
          <linearGradient id={`${uid}-rim`} x1="1" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hue} stopOpacity="0.9" />
            <stop offset="40%" stopColor={hue} stopOpacity="0" />
          </linearGradient>
          <pattern id={`${uid}-dots`} width="5" height="5" patternUnits="userSpaceOnUse">
            <circle cx="1.4" cy="1.4" r="1.1" fill="#000" opacity="0.34" />
          </pattern>
          <radialGradient id={`${uid}-halo`}>
            <stop offset="0%" stopColor={hue} stopOpacity="0.3" />
            <stop offset="70%" stopColor={hue} stopOpacity="0.04" />
            <stop offset="100%" stopColor={hue} stopOpacity="0" />
          </radialGradient>
          <clipPath id={`${uid}-clip`}>
            <path d={f.body} />
            <path d={f.head} />
            {f.hair && <path d={f.hair} />}
          </clipPath>
        </defs>

        <circle cx="100" cy="112" r="98" fill={`url(#${uid}-halo)`} />

        {/* depth shadow */}
        <g transform="translate(5 5)" opacity="0.5">
          <path d={f.body} fill="#000" />
          <path d={f.head} fill="#000" />
        </g>

        <g
          style={{
            transformOrigin: '100px 200px',
            animation: speaking ? 'breathe 1.4s ease-in-out infinite' : undefined,
          }}
        >
          <path d={f.body} fill={`url(#${uid}-fill)`} />
          <path d={f.head} fill={`url(#${uid}-fill)`} />
          {f.hair && <path d={f.hair} fill={hue2} opacity="0.95" />}

          {/* halftone + rim light, clipped to the figure */}
          <g clipPath={`url(#${uid}-clip)`}>
            <rect x="0" y="0" width="200" height="230" fill={`url(#${uid}-dots)`} />
            <rect x="0" y="0" width="200" height="230" fill={`url(#${uid}-rim)`} style={{ mixBlendMode: 'screen' }} />
          </g>

          <path d={f.head} fill="none" stroke={hue} strokeWidth="1.1" opacity="0.5" />
          <path d={f.body} fill="none" stroke={hue} strokeWidth="1.1" opacity="0.35" />
        </g>
      </svg>

      {speaking && (
        <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 items-end gap-[3px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-full"
              style={{
                background: hue,
                height: 6 + ((i * 7) % 13),
                animation: `breathe ${0.6 + i * 0.13}s ease-in-out infinite alternate`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
})
