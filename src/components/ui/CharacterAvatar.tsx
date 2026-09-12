import { useEffect, useState } from 'react'
import type { Character } from '@/types'
import { CharacterPortrait } from './CharacterPortrait'

/* ============================================================================
 * CHARACTER AVATAR — artwork first, generated portrait as the safety net.
 *
 * Every character has an image (public/characters/<id>.jpg, fetched by
 * `npm run assets`). If a character has no `avatar`, or the file 404s, or an
 * external URL goes dark, this renders the SVG portrait instead — same box,
 * same accent, no layout shift and no broken-image icon. That is the whole
 * reason the portrait system stayed.
 *
 * Images are `loading="lazy"` and `decoding="async"`, so a carousel of four
 * rosters does not fetch sixteen files before first paint.
 * ========================================================================== */

interface Props {
  character: Character
  size?: number
  /** Square crop (cards) or a taller box (ratio = height / width). */
  ratio?: number
  /**
   * Fill the nearest positioned ancestor instead of taking a pixel box. Use
   * this inside a sized container (an `aspect-square` card, say) — a fixed
   * `size` there would fight the container.
   */
  fill?: boolean
  speaking?: boolean
  dim?: boolean
  /** Eager-load the visible group so the first panel has no pop-in. */
  priority?: boolean
  className?: string
  rounded?: string
}

export function CharacterAvatar({
  character,
  size = 160,
  ratio = 1,
  fill = false,
  speaking = false,
  dim = false,
  priority = false,
  className = '',
  rounded = '',
}: Props) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const src = character.avatar?.src

  // A character swap must not inherit the previous one's error state.
  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [src])

  const height = Math.round(size * ratio)
  const box = fill ? 'absolute inset-0' : 'relative'
  const boxStyle = fill ? undefined : { width: size, height }

  if (!src || failed)
    return (
      <div
        className={`flex items-center justify-center overflow-hidden ${box} ${rounded} ${className}`}
        style={boxStyle}
      >
        <CharacterPortrait character={character} fill={fill} size={size} speaking={speaking} dim={dim} />
      </div>
    )

  return (
    <div
      className={`overflow-hidden ${box} ${rounded} ${className}`}
      style={{ ...boxStyle, opacity: dim ? 0.42 : 1, transition: 'opacity .5s' }}
    >
      {/* Accent wash: fills the frame before the image decodes, and stays
       *  behind transparent artwork afterwards. */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(155deg, ${character.portrait.hue}22, ${character.portrait.hue2}14 55%, #06070A)`,
        }}
      />
      <img
        src={src}
        alt={character.avatar?.alt ?? character.name}
        {...(fill ? {} : { width: size, height })}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className="drag-none relative h-full w-full object-cover transition-opacity duration-500"
        style={{ objectPosition: character.avatar?.focus ?? '50% 30%', opacity: loaded ? 1 : 0 }}
      />
      {speaking && (
        <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-end gap-[3px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-full"
              style={{
                background: character.accent,
                height: 5 + ((i * 7) % 12),
                animation: `breathe ${0.6 + i * 0.13}s ease-in-out infinite alternate`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
