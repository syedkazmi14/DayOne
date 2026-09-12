import { useEffect, useState } from 'react'
import { mediaHealth, mediaStatusPending, probeMediaServer, subscribeMediaStatus, type MediaHealth } from './mediaStatus'

/** Re-renders when the media server probe lands, so tiers never go stale. */
export function useMediaStatus(): { health: MediaHealth | null; pending: boolean } {
  const [, tick] = useState(0)
  useEffect(() => {
    const unsubscribe = subscribeMediaStatus(() => tick((n) => n + 1))
    void probeMediaServer()
    return () => {
      unsubscribe()
    }
  }, [])
  return { health: mediaHealth(), pending: mediaStatusPending() }
}
