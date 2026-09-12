import { useEffect, useState } from 'react'
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
 * content (an `h-full` child there would collapse to nothing).
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
  const src = episode.image?.src

  useEffect(() => {
    setFailed(false)
    setLoaded(false)
  }, [src])

  if (src && !failed)
    return (
      <div className={`absolute inset-0 overflow-hidden bg-ink-800 ${className}`}>
        <img
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
      </div>
    )

  const shot = episode.entrySceneId ? episode.scenes[episode.entrySceneId]?.shot ?? episode.poster : episode.poster
  if (shot) return <SceneCanvas shot={shot} sceneKey={sceneKey} paused={paused} />
  return <div className={`absolute inset-0 bg-gradient-to-br from-ink-700 to-ink-900 ${className}`} />
}
