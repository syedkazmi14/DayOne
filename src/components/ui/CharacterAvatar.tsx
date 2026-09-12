import { memo, useEffect, useRef, useState } from 'react'
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
 * the box being drawn. A 62px cast-switcher portrait therefore pulls the 160w
 * rung (~4kB) instead of the 640px JPEG (~52kB) every surface used to share.
 * The JPEG stays the `<img src>`, so it remains the fallback and the artwork
 * is unchanged.
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
  /**
   * Override the `sizes` hint. Needed when `fill` is set, since the rendered
   * box then comes from the container rather than from `size`.
   */
  sizes?: string
  /** Eager-load the visible group so the first panel has no pop-in. */
  priority?: boolean
  className?: string
  rounded?: string
}

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
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  /* `<picture>` falls back only on a type/media miss, never on a 404 — so a
   * missing WebP rung (assets fetched without cwebp) would drop straight to the
   * SVG portrait. Step down to the JPEG first. */
  const [noWebp, setNoWebp] = useState(false)
  const src = character.avatar?.src

  /**
   * A cached image can finish loading before React attaches `onLoad` — on a
   * re-mount with a warm cache that handler never fires, and the fade-in would
   * leave the image invisible forever. So reconcile against the element's own
   * `complete`/`naturalWidth` after every commit, and keep `onLoad`/`onError`
   * for the cold path.
   */
  useEffect(() => {
    const el = imgRef.current
    if (el?.complete) {
      setLoaded(el.naturalWidth > 0)
      setFailed(el.naturalWidth === 0)
      return
    }
    // Cold load, or a character swap: do not inherit the previous state.
    setLoaded(false)
    setFailed(false)
    setNoWebp(false)
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

  const srcSet = noWebp ? undefined : webpSrcSet(src, CHARACTER_WIDTHS)
  /* `fill` surfaces must pass `sizes`: the box then comes from the container,
   * not from `size`, and a wrong hint would fetch the wrong rung. */
  const sizesAttr = sizes ?? `${size}px`

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
      {/* `contents` keeps the picture box out of layout, so the img stays a
       *  direct child of the sized frame and h-full/w-full resolve as before. */}
      <picture className="contents">
        {srcSet && <source type="image/webp" srcSet={srcSet} sizes={sizesAttr} />}
        <img
          ref={imgRef}
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
