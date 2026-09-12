import { memo, useCallback, useState, type ImgHTMLAttributes } from 'react'
import type { Episode } from '@/types'
import { SceneCanvas } from '../SceneCanvas'
import { EPISODE_WIDTHS, webpSrcSet } from './responsiveImage'

/* ============================================================================
 * EPISODE STILL — the one place episode art is resolved.
 *
 * Purely data-driven: it reads `episode.image` and nothing else. Add or change
 * an image in src/content/episodes and every surface that shows episode art
 * (shelf card, intro backdrop) follows without a component edit.
 *
 * Fallback chain, so the shelf never has a hole in it:
 *   episode.image  ->  entry scene / poster ShotSpec (procedural renderer)
 *   ->  flat gradient
 *
 * It positions itself `absolute inset-0`, exactly as SceneCanvas does, so it
 * drops into the same slots — including the hero, whose height comes from its
 * content (an `h-full` child there would collapse to nothing).
 *
 * SIZING: the stills are authored at 1280x720 because the hero is full-bleed,
 * but a shelf card draws one about a third that wide. `npm run assets:optimize`
 * writes a 640/1280 WebP ladder beside each JPEG so a card can take the 640w
 * rung; the JPEG stays the `<img src>` fallback and the artwork is unchanged.
 * ========================================================================== */

interface Props {
  episode: Episode
  /** Distinguishes canvases when the same episode appears twice on a screen. */
  sceneKey: string
  /** Pause the procedural fallback (shelf cards) or animate it (hero). */
  paused?: boolean
  priority?: boolean
  /** Override the `sizes` hint when the slot is neither a hero nor a card. */
  sizes?: string
  className?: string
}

/** Full-bleed backdrops (hero, intro) against the 3-up / 2-up shelf grid. */
const HERO_SIZES = '100vw'
const CARD_SIZES = '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw'

/* React 18 does not know the camelCase `fetchPriority` prop — it warns and the
 * attribute does not land. The lowercase DOM attribute is what the browser
 * reads anyway, and React forwards unknown lowercase attributes untouched. */
const FETCH_HIGH = { fetchpriority: 'high' } as unknown as ImgHTMLAttributes<HTMLImageElement>

export const EpisodeStill = memo(function EpisodeStill({
  episode,
  sceneKey,
  paused = false,
  priority = false,
  sizes,
  className = '',
}: Props) {
  const src = episode.image?.src
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  /* A 404 on a WebP rung does not make `<picture>` fall back — it only falls
   * back on a type/media miss. Step down to the JPEG before giving up and
   * handing the slot to the procedural renderer. */
  const [noWebp, setNoWebp] = useState(false)

  /* Reset on an episode swap during render, not in an effect — an effect would
   * run after `settle` below and undo it. */
  const [seenSrc, setSeenSrc] = useState(src)
  if (seenSrc !== src) {
    setSeenSrc(src)
    setFailed(false)
    setLoaded(false)
    setNoWebp(false)
  }

  /**
   * A cached still can complete before React attaches `onLoad`, and then the
   * event never fires and the frame stays at `opacity: 0`. Checking `complete`
   * at commit is what stops a re-visited hero from looking like it is still
   * loading when the bytes are already there.
   */
  const settle = useCallback((el: HTMLImageElement | null) => {
    if (el?.complete && el.naturalWidth > 0) setLoaded(true)
  }, [])

  if (src && !failed) {
    const srcSet = noWebp ? undefined : webpSrcSet(src, EPISODE_WIDTHS)
    return (
      <div className={`absolute inset-0 overflow-hidden bg-ink-800 ${className}`}>
        {/* `contents` keeps the picture out of layout so the img still fills. */}
        <picture className="contents">
          {srcSet && <source type="image/webp" srcSet={srcSet} sizes={sizes ?? (priority ? HERO_SIZES : CARD_SIZES)} />}
          <img
            ref={settle}
            src={src}
            alt={episode.image?.alt ?? episode.title}
            /* Intrinsic size of the authored still: lets the browser reserve the
             * right aspect ratio before any bytes arrive. */
            width={1280}
            height={720}
            loading={priority ? 'eager' : 'lazy'}
            {...(priority ? FETCH_HIGH : null)}
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => (srcSet ? setNoWebp(true) : setFailed(true))}
            className="drag-none h-full w-full object-cover transition-opacity duration-700"
            style={{ objectPosition: episode.image?.focus ?? '50% 40%', opacity: loaded ? 1 : 0 }}
          />
        </picture>
      </div>
    )
  }

  const shot = episode.entrySceneId ? episode.scenes[episode.entrySceneId]?.shot ?? episode.poster : episode.poster
  if (shot) return <SceneCanvas shot={shot} sceneKey={sceneKey} paused={paused} />
  return <div className={`absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900 ${className}`} />
})
