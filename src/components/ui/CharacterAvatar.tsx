import { memo, useCallback, useState } from 'react'
import type { Character } from '@/types'
import { CharacterPortrait } from './CharacterPortrait'
import { CHARACTER_WIDTHS, webpSrcSet } from './responsiveImage'

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
 *
 * SIZING: `npm run assets:optimize` writes a 160/320/640 WebP ladder beside
 * each JPEG, and the `<source>` below hands the browser a `sizes` derived from
 * the box we are actually drawing. A 74px cast-strip avatar therefore pulls the
 * 160w rung (~4kB) rather than the 640px JPEG (~52kB) it used to; the JPEG
 * stays as the `<img src>` fallback and the artwork is unchanged.
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
  /**
   * Override the `sizes` hint. Only needed when `fill` is set and the container
   * is not the roster-card grid the default describes.
   */
  sizes?: string
  speaking?: boolean
  dim?: boolean
  /** Eager-load the visible group so the first panel has no pop-in. */
  priority?: boolean
  className?: string
  rounded?: string
}

/** The roster card grid: 4-up on desktop, 2-up below. */
const FILL_SIZES = '(min-width: 1024px) 25vw, 48vw'

export const CharacterAvatar = memo(function CharacterAvatar({
  character,
  size = 160,
  ratio = 1,
  fill = false,
  sizes,
  speaking = false,
  dim = false,
  priority = false,
  className = '',
  rounded = '',
}: Props) {
  const src = character.avatar?.src
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  /* `<picture>` only falls back on a type/media miss, never on a 404 — so a
   * missing WebP rung (assets fetched on a machine without cwebp) would drop
   * us all the way to the SVG portrait. Step down to the JPEG first. */
  const [noWebp, setNoWebp] = useState(false)

  /* A character swap must not inherit the previous one's load/error state.
   * Done during render rather than in an effect so that the `settle` ref below
   * — which fires at commit, before effects — is not immediately undone. */
  const [seenSrc, setSeenSrc] = useState(src)
  if (seenSrc !== src) {
    setSeenSrc(src)
    setFailed(false)
    setLoaded(false)
    setNoWebp(false)
  }

  /**
   * A cached image can finish before React attaches `onLoad`, and then the load
   * event never fires — leaving the frame stuck at `opacity: 0`. Checking
   * `complete` at commit closes that window, which is what made returning to a
   * screen look like the art was loading again.
   */
  const settle = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setLoaded(true)
  }, [])

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

  const srcSet = noWebp ? undefined : webpSrcSet(src, CHARACTER_WIDTHS)
  const sizesAttr = sizes ?? (fill ? FILL_SIZES : `${size}px`)

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
      {/* `contents` so the picture box never enters layout: the img stays a
       *  direct child of the sized frame and h-full/w-full resolve as before. */}
      <picture className="contents">
        {srcSet && <source type="image/webp" srcSet={srcSet} sizes={sizesAttr} />}
        <img
          ref={settle}
          src={src}
          alt={character.avatar?.alt ?? character.name}
          {...(fill ? {} : { width: size, height })}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => (srcSet ? setNoWebp(true) : setFailed(true))}
          className="drag-none relative h-full w-full object-cover transition-opacity duration-500"
          style={{ objectPosition: character.avatar?.focus ?? '50% 30%', opacity: loaded ? 1 : 0 }}
        />
      </picture>
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
})
