import type { AssetRef, AssetTier, Scene } from '@/types'
import { MEDIA_BASE, mediaHealth } from './mediaStatus'

/* ============================================================================
 * BACKGROUND GENERATION — the still half of the hybrid presentation.
 *
 * Dialogue scenes do not get video. They get a generated environment plate,
 * character sprites over it, and a voice. Far cheaper than a clip per line,
 * and far more controllable. Same two tiers as video.
 * ========================================================================== */

export interface BackgroundRequest {
  episodeId: string
  sceneId: string
  prompt: string
  /** Render again even if this scene's image is already in storage. */
  force?: boolean
}

export interface BackgroundResult {
  asset: AssetRef | null
  error?: string
  /** The stored image was reused rather than generated again. */
  reused?: boolean
}

export interface ImageProvider {
  readonly id: string
  readonly label: string
  readonly tier: AssetTier
  generateBackground(req: BackgroundRequest): Promise<BackgroundResult>
}

/** Scene shot -> an empty environment plate the sprites can stand in front of. */
export const backgroundPrompt = (s: Pick<Scene, 'shot'>) =>
  `Empty environment plate for an interactive drama background, no people in frame. ${s.shot.prompt.trim()} Wide static 16:9 composition, cinematic lighting, soft depth of field, lower third uncluttered for subtitles, no text.`

/** Clip scene shot -> the opening frame an image-to-video model animates. */
export const keyframePrompt = (s: Pick<Scene, 'shot'>) =>
  `A single cinematic film still, the opening frame of a shot. ${s.shot.prompt.trim()} 16:9 widescreen, photographic, natural light, shallow depth of field. No text, no logos, no watermark.`

export class ProceduralBackdropProvider implements ImageProvider {
  readonly id = 'procedural-previs'
  readonly label = 'PROCEDURAL BACKDROP'
  readonly tier: AssetTier = 'procedural'
  async generateBackground(req: BackgroundRequest): Promise<BackgroundResult> {
    return {
      asset: { kind: 'image', tier: 'procedural', provider: this.id, prompt: req.prompt, createdAt: new Date().toISOString() },
    }
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class ServerImageProvider implements ImageProvider {
  readonly tier: AssetTier = 'generated'
  readonly id: string
  readonly label: string
  constructor(private opts: { model: string; base?: string; fetch?: FetchLike }) {
    this.id = opts.model
    this.label = `AI IMAGE · ${opts.model}`
  }

  async generateBackground(req: BackgroundRequest): Promise<BackgroundResult> {
    const call = this.opts.fetch ?? ((i: string, init?: RequestInit) => fetch(i, init))
    try {
      const res = await call(`${this.opts.base ?? MEDIA_BASE}/image`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      })
      const body = (await res.json().catch(() => ({}))) as { url?: string; storageKey?: string; message?: string; reused?: boolean }
      if (!res.ok || !body.url) return { asset: null, error: body.message ?? `image request failed (${res.status})` }
      return {
        reused: body.reused === true,
        asset: {
          kind: 'image',
          tier: 'generated',
          provider: this.id,
          url: body.url,
          storageKey: body.storageKey,
          prompt: req.prompt,
          createdAt: new Date().toISOString(),
        },
      }
    } catch (e) {
      return { asset: null, error: `media server unreachable: ${(e as Error).message}` }
    }
  }
}

const backdrop = new ProceduralBackdropProvider()
let server: ServerImageProvider | null = null

export function imageProvider(): ImageProvider {
  const h = mediaHealth()
  if (!h?.image.configured) return backdrop
  if (!server || server.id !== h.image.model) server = new ServerImageProvider({ model: h.image.model })
  return server
}
