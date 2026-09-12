/* ============================================================================
 * MEDIA SERVER DISCOVERY
 *
 * Whether real generation is available is only knowable at runtime: the media
 * server (server/mediaServer.mjs) holds REPLICATE_API_TOKEN and reaches the voice proxy.
 * Probed once, cached, subscribable — the same contract as src/voice/voice.ts.
 * Absent or unconfigured, every provider resolves to its procedural tier and
 * the UI says so.
 * ========================================================================== */

export interface MediaHealth {
  video: { configured: boolean; provider: string; model: string }
  image: { configured: boolean; provider: string; model: string }
  audio: { configured: boolean; provider: string }
  storage: { kind: string; layout: string }
}

const env = (import.meta.env ?? {}) as Record<string, string | undefined>
export const MEDIA_BASE = env.VITE_MEDIA_SERVER_URL ?? '/api/media'

let health: MediaHealth | null = null
let probed = false
let probe: Promise<MediaHealth | null> | null = null
const listeners = new Set<() => void>()

export const mediaHealth = (): MediaHealth | null => health
export const mediaStatusPending = () => !probed

export function subscribeMediaStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const isHealth = (v: unknown): v is MediaHealth => {
  const h = v as MediaHealth
  return !!h && typeof h === 'object' && !!h.video && !!h.image && !!h.audio && !!h.storage
}

export function probeMediaServer(): Promise<MediaHealth | null> {
  if (probe) return probe
  probe = (async () => {
    if (typeof fetch !== 'function') return null
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 2500)
      const res = await fetch(`${MEDIA_BASE}/health`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (!res.ok) return null
      const body: unknown = await res.json()
      return isHealth(body) ? body : null
    } catch {
      return null
    }
  })().then((h) => {
    health = h
    probed = true
    listeners.forEach((l) => l())
    return h
  })
  return probe
}

if (typeof window !== 'undefined') void probeMediaServer()
