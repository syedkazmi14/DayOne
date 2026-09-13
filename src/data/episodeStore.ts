import type { Episode } from '@/types'
import { MEDIA_BASE, mediaHealth } from '@/media/mediaStatus'

/* ============================================================================
 * EPISODE LIBRARY — mirrored through the media server, the same way
 * src/media/storage.ts mirrors an uploaded document.
 *
 * gameStore.tsx loads this once and echoes every publish/unpublish back, so
 * every show's lobby sees what every admin has published — see
 * server/mediaServer.mjs's GET/POST /api/media/episodes and
 * DELETE /api/media/episodes/:id.
 *
 * Best-effort throughout, matching every other media-server client here:
 * without a media server running, `loadLibrary` resolves null, gameStore.tsx
 * never dispatches HYDRATE_PUBLISHED, and localStorage stays the library —
 * exactly the behaviour before the shared library existed.
 * ========================================================================== */

export async function loadLibrary(): Promise<Episode[] | null> {
  if (!mediaHealth()) return null
  try {
    const res = await fetch(`${MEDIA_BASE}/episodes`)
    if (!res.ok) return null
    return ((await res.json()) as { episodes?: Episode[] }).episodes ?? null
  } catch {
    return null
  }
}

export async function saveToLibrary(episode: Episode): Promise<void> {
  if (!mediaHealth()) return
  try {
    await fetch(`${MEDIA_BASE}/episodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ episode }),
    })
  } catch {
    /* best-effort mirror — state.published stays this session's source of truth */
  }
}

export async function removeFromLibrary(id: string): Promise<void> {
  if (!mediaHealth()) return
  try {
    await fetch(`${MEDIA_BASE}/episodes/${encodeURIComponent(id)}`, { method: 'DELETE' })
  } catch {
    /* best-effort mirror */
  }
}
