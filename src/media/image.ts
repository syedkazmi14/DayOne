import type { AssetRef, AssetTier, Scene } from '@/types'
import { showWorld } from '@/content/showWorlds'
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
  /** The show whose world this image belongs to; stored under that show. */
  showId?: string
  /** Character ids whose portraits the image model draws from. */
  references?: string[]
}

export interface BackgroundResult {
  asset: AssetRef | null
  error?: string
  /** The stored image was reused rather than generated again. */
  reused?: boolean
  /** The model declined to draw it (e.g. a safety filter) — nothing was stored. */
  refused?: boolean
}

export interface ImageProvider {
  readonly id: string
  readonly label: string
  readonly tier: AssetTier
  generateBackground(req: BackgroundRequest): Promise<BackgroundResult>
}

const firstSentence = (t: string) => (t.split(/(?<=\.)\s/)[0] ?? t).trim().replace(/[.\s]+$/, '')

/**
 * Scene shot -> an empty environment plate the sprites can stand in front of.
 * With a show, the plate is that show's world: its setting for the scene's
 * environment, in its art direction. The shot's own prose describes a generic
 * office, so it is left out rather than fighting the world.
 */
export const backgroundPrompt = (s: Pick<Scene, 'shot'>, groupId?: string) => {
  const w = showWorld(groupId)
  if (!w)
    return `Empty environment plate for an interactive drama background, no people in frame. ${s.shot.prompt.trim()} Wide static 16:9 composition, cinematic lighting, soft depth of field, lower third uncluttered for subtitles, no text.`
  return `Empty background for an animated episode, no people or characters in frame. ${w.style}. Setting: ${w.env[s.shot.env]}, ${s.shot.time} light, ${s.shot.mood} mood. Wide static 16:9 composition with a simple foreground at the bottom of the frame. No text, no captions, no subtitles, no text boxes, no logos, no watermark.`
}

/**
 * Clip scene shot -> the opening frame an image-to-video model animates. With a
 * show, the frame is set in its world, and the cold open is the world's own
 * establishing shot.
 */
export const keyframePrompt = (s: Pick<Scene, 'shot'>, groupId?: string, opening = false) => {
  const w = showWorld(groupId)
  if (!w)
    return `A single cinematic film still, the opening frame of a shot. ${s.shot.prompt.trim()} 16:9 widescreen, photographic, natural light, shallow depth of field. No text, no logos, no watermark.`
  const moment = opening ? w.coldOpen.still : `${w.env[s.shot.env]}. ${s.shot.action ?? firstSentence(s.shot.prompt)}`
  return `A single frame from an animated episode, the opening frame of a shot. ${w.style}. ${moment}. ${s.shot.time} light, ${s.shot.mood} mood. Any people are generic original cartoon office workers, not existing characters. 16:9 widescreen. No text, no logos, no watermark.`
}

/**
 * One scene's still in a show's world. With a cast, each character's portrait
 * goes to the image model as a reference, in order, and the prompt names who
 * each reference is; without one, the still is the setting alone and the
 * player puts portraits on top.
 */
export const stillPrompt = (s: Pick<Scene, 'shot'>, groupId: string, cast: { name: string }[], opening = false) => {
  const w = showWorld(groupId)
  const setting = w ? (opening ? w.coldOpen.still : w.env[s.shot.env]) : firstSentence(s.shot.prompt)
  const style = w?.style ?? 'animated cartoon'
  const light = `${s.shot.time} light, ${s.shot.mood} mood`
  // Never mention subtitles here: the model reads that as an instruction to draw them.
  const frame =
    'Wide 16:9 composition with a simple, uncluttered foreground at the bottom of the frame. Absolutely no text, no captions, no subtitles, no speech bubbles, no text boxes, no bars or panels, no logos, no watermark.'
  if (!cast.length) return `A single frame from an animated TV episode, no people in frame. ${style}. Setting: ${setting}. ${light}. ${frame}`
  const names = cast.map((c) => c.name)
  const refs = names.map((n, i) => `reference image ${i + 1} is ${n}`).join('; ')
  const action = opening ? 'arriving for the working day' : (s.shot.action ?? firstSentence(s.shot.prompt))
  return `A single frame from an animated TV episode. ${refs.charAt(0).toUpperCase()}${refs.slice(1)}. Draw ${names.join(' and ')} exactly as they look in their reference images — same character design and cartoon art style — in this setting: ${setting}. Scene: ${action}. ${style}. ${light}. ${frame}`
}

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
      const body = (await res.json().catch(() => ({}))) as {
        url?: string
        storageKey?: string
        message?: string
        error?: string
        reused?: boolean
        provider?: string
        characters?: string[]
      }
      if (!res.ok || !body.url)
        return { asset: null, error: body.message ?? `image request failed (${res.status})`, refused: body.error === 'refused' }
      return {
        reused: body.reused === true,
        asset: {
          kind: 'image',
          tier: 'generated',
          provider: body.provider ? `${body.provider} · ${this.id}` : this.id,
          characters: body.characters,
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
