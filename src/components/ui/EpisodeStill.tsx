import { useEffect, useRef, useState } from 'react'
import type { Episode } from '@/types'
import { SceneCanvas } from '../SceneCanvas'

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
 * content (an `h-full` child there would collapse to nothing). It also applies
 * the same top-and-bottom vignette SceneCanvas grades every shot with: the
 * header and footer chrome are transparent and were designed against that
 * darkening, so a raw photographic still would leave them unreadable.
 * ========================================================================== */

interface Props {
  episode: Episode
  /** Distinguishes canvases when the same episode appears twice on a screen. */
  sceneKey: string
  /** Pause the procedural fallback (shelf cards) or animate it (hero). */
  paused?: boolean
  priority?: boolean
  className?: string
}

export function EpisodeStill({ episode, sceneKey, paused = false, priority = false, className = '' }: Props) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const src = episode.image?.src

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
    setLoaded(false)
    setFailed(false)
  }, [src])

  if (src && !failed)
    return (
      <div className={`absolute inset-0 overflow-hidden bg-ink-800 ${className}`}>
        <img
          ref={imgRef}
          src={src}
          alt={episode.image?.alt ?? episode.title}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="drag-none h-full w-full object-cover transition-opacity duration-700"
          style={{ objectPosition: episode.image?.focus ?? '50% 40%', opacity: loaded ? 1 : 0 }}
        />
        {/* Same grade as SceneCanvas, so stills and procedural shots are
          * interchangeable in every slot. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,.68) 0%, rgba(0,0,0,.12) 24%, rgba(0,0,0,.2) 52%, rgba(0,0,0,.92) 100%)',
          }}
        />
      </div>
    )

  const shot = episode.entrySceneId ? episode.scenes[episode.entrySceneId]?.shot ?? episode.poster : episode.poster
  if (shot) return <SceneCanvas shot={shot} sceneKey={sceneKey} paused={paused} />
  return <div className={`absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900 ${className}`} />
}
