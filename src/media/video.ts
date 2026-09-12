import type { AssetRef, AssetTier, ShotSpec } from '@/types'
import { MEDIA_BASE, mediaHealth } from './mediaStatus'

/* ============================================================================
 * VIDEO GENERATION — an authoring-time asset pipeline.
 *
 *   scene image + shot spec -> requestClip() -> VideoProvider -> stored clip
 *                                                          -> Scene.assets.video
 *
 * `requestClip` is the seam between the game and whatever renders video. The
 * game never calls it at runtime: the Studio does, once, when an episode is
 * authored, and the player loads the stored file.
 *
 * Two providers, one contract:
 *   ServerVideoProvider      the media server animates the scene's generated
 *                            keyframe with an image-to-video model (Replicate,
 *                            Wan 2.2 I2V Fast by default), stores the clip and
 *                            returns a URL. Tier 'generated'.
 *   ProceduralPrevisProvider no model. The job resolves immediately with NO
 *                            file; SceneCanvas renders the shot spec live.
 *                            Tier 'procedural', and labelled as such — it is
 *                            never presented as AI video.
 *
 * The video model is only ever asked for motion within one shot. Which scene
 * comes next, and what the player's choice meant, stay in the authored graph.
 * ========================================================================== */

export type ClipStatus = 'queued' | 'rendering' | 'ready' | 'failed'

export interface ClipRequest {
  episodeId: string
  sceneId: string
  shot: ShotSpec
  /** The generated scene image the clip animates. Required by image-to-video providers. */
  image?: AssetRef
}

export interface ClipJob {
  id: string
  episodeId: string
  sceneId: string
  status: ClipStatus
  provider: string
  tier: AssetTier
  prompt: string
  url?: string
  storageKey?: string
  error?: string
}

export interface VideoProvider {
  readonly id: string
  readonly label: string
  readonly tier: AssetTier
  generateClip(req: ClipRequest): Promise<ClipJob>
  getStatus(jobId: string): Promise<ClipJob>
  /** The playable URL once ready; null while rendering, on failure, or when there is no file. */
  getClipUrl(jobId: string): Promise<string | null>
}

/* ---------------------------------------------------------- shot -> motion */

const CAMERA_BY_MOOD: Record<ShotSpec['mood'], string> = {
  neutral: 'slow lateral dolly across the scene',
  warm: 'gentle dolly forward',
  tense: 'slow cinematic push-in toward the character',
  alarm: 'handheld camera with a subtle shake, pushing closer',
  calm: 'slow pull-back revealing the space',
}

const EXPRESSION_BY_MOOD: Record<ShotSpec['mood'], string> = {
  neutral: 'the character stays focused, with small natural movements',
  warm: 'the character relaxes into a small, hopeful smile',
  tense: 'the character’s expression tightens with concern and they hesitate',
  alarm: 'the character reacts with alarm, eyes widening and shoulders tensing',
  calm: 'the character exhales and their expression settles, relieved',
}

const ENVIRONMENT_MOTION: Record<ShotSpec['env'], string> = {
  lobby: 'people cross the lobby out of focus and daylight shifts across the glass',
  desk: 'monitor light flickers softly and colleagues move out of focus behind',
  open_office: 'colleagues walk between desk pods out of focus while screens glow',
  corridor: 'figures pass behind slatted glass and the ceiling lights hum',
  server_room: 'status lights blink along the racks',
  night_office: 'the single fluorescent tube flickers and dust drifts through the light',
  rooftop: 'city lights shimmer and distant traffic moves on the street',
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const clause = (t: string) => t.trim().replace(/[.\s]+$/, '')
const firstSentence = (t: string) => (t.split(/(?<=\.)\s/)[0] ?? t).trim()

/** Clips are short: ~5 s is the model's sweet spot, never more than 8. */
export const clipSeconds = (shot: ShotSpec) => Math.min(8, Math.max(5, shot.durationSec ?? 5))

/**
 * Shot spec -> an image-to-video motion prompt: camera movement, character
 * action, expression, environmental motion, framing. Deterministic. It describes
 * one shot of an existing image; it never describes what happens next in the
 * story.
 */
export function motionPrompt(shot: ShotSpec): string {
  return [
    `${cap(clause(shot.camera ?? CAMERA_BY_MOOD[shot.mood]))}.`,
    `${cap(clause(shot.action ?? firstSentence(shot.prompt)))}.`,
    `${cap(EXPRESSION_BY_MOOD[shot.mood])}.`,
    `In the background, ${ENVIRONMENT_MOTION[shot.env]}.`,
    `Cinematic framing, ${clipSeconds(shot)}-second shot, smooth natural motion.`,
    'Maintain the original composition, lighting and character design from the first frame. No text, no captions, no scene cuts.',
  ].join(' ')
}

const STATUSES: ClipStatus[] = ['queued', 'rendering', 'ready', 'failed']

/* ------------------------------------------------------------- procedural */

export class ProceduralPrevisProvider implements VideoProvider {
  readonly id = 'procedural-previs'
  readonly label = 'PROCEDURAL PREVIS'
  readonly tier: AssetTier = 'procedural'
  private jobs = new Map<string, ClipJob>()
  private n = 0

  async generateClip(req: ClipRequest): Promise<ClipJob> {
    const job: ClipJob = {
      id: `previs-${++this.n}`,
      episodeId: req.episodeId,
      sceneId: req.sceneId,
      status: 'ready',
      provider: this.id,
      tier: this.tier,
      prompt: motionPrompt(req.shot),
    }
    this.jobs.set(job.id, job)
    return job
  }

  async getStatus(jobId: string): Promise<ClipJob> {
    return (
      this.jobs.get(jobId) ?? {
        id: jobId,
        episodeId: '',
        sceneId: '',
        status: 'failed',
        provider: this.id,
        tier: this.tier,
        prompt: '',
        error: 'unknown job',
      }
    )
  }

  /** Rendered live from the shot spec — there is no file to point at. */
  async getClipUrl(): Promise<string | null> {
    return null
  }
}

/* ----------------------------------------------------------------- server */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class ServerVideoProvider implements VideoProvider {
  readonly tier: AssetTier = 'generated'
  readonly id: string
  readonly label: string
  private jobs = new Map<string, ClipJob>()

  constructor(private opts: { model: string; base?: string; fetch?: FetchLike }) {
    this.id = opts.model
    this.label = `AI VIDEO · ${opts.model}`
  }

  private get base() {
    return this.opts.base ?? MEDIA_BASE
  }
  private call(input: string, init?: RequestInit) {
    return this.opts.fetch ? this.opts.fetch(input, init) : fetch(input, init)
  }

  async generateClip(req: ClipRequest): Promise<ClipJob> {
    const prompt = motionPrompt(req.shot)
    const failed = (error: string): ClipJob => ({
      id: `failed-${req.episodeId}-${req.sceneId}`,
      episodeId: req.episodeId,
      sceneId: req.sceneId,
      status: 'failed',
      provider: this.id,
      tier: this.tier,
      prompt,
      error,
    })
    // Image-to-video needs a real stored scene image; a procedural backdrop has no file.
    if (req.image?.tier !== 'generated' || !req.image.storageKey)
      return failed('This model animates the scene image — generate visual assets first.')
    try {
      const res = await this.call(`${this.base}/video`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId: req.episodeId,
          sceneId: req.sceneId,
          prompt,
          imageKey: req.image.storageKey,
          durationSec: clipSeconds(req.shot),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as Partial<ClipJob> & { jobId?: string; message?: string }
      if (!res.ok || !body.jobId) return failed(body.message ?? `video request failed (${res.status})`)
      const job: ClipJob = {
        ...failed(''),
        id: body.jobId,
        status: STATUSES.includes(body.status!) ? body.status! : 'queued',
        url: body.url,
        storageKey: body.storageKey,
        error: body.error,
      }
      this.jobs.set(job.id, job)
      return job
    } catch (e) {
      return failed(`media server unreachable: ${(e as Error).message}`)
    }
  }

  async getStatus(jobId: string): Promise<ClipJob> {
    const known: ClipJob = this.jobs.get(jobId) ?? {
      id: jobId,
      episodeId: '',
      sceneId: '',
      status: 'queued',
      provider: this.id,
      tier: this.tier,
      prompt: '',
    }
    if (known.status === 'ready' || known.status === 'failed') return known
    try {
      const res = await this.call(`${this.base}/video/${encodeURIComponent(jobId)}`)
      const body = (await res.json().catch(() => ({}))) as Partial<ClipJob> & { message?: string }
      const next: ClipJob = !res.ok
        ? { ...known, status: 'failed', error: body.message ?? `status check failed (${res.status})` }
        : STATUSES.includes(body.status as ClipStatus)
          ? { ...known, status: body.status as ClipStatus, url: body.url, storageKey: body.storageKey, error: body.error }
          : { ...known, status: 'failed', error: `unexpected status ${JSON.stringify(body.status)}` }
      this.jobs.set(jobId, next)
      return next
    } catch {
      // A dropped poll is transient: keep the last known state and poll again.
      return known
    }
  }

  async getClipUrl(jobId: string): Promise<string | null> {
    const job = await this.getStatus(jobId)
    return job.status === 'ready' ? (job.url ?? null) : null
  }
}

/* -------------------------------------------------------------- selection */

const previs = new ProceduralPrevisProvider()
let server: ServerVideoProvider | null = null

/** The best provider this deployment actually has. Never claims a tier it lacks. */
export function videoProvider(): VideoProvider {
  const h = mediaHealth()
  if (!h?.video.configured) return previs
  if (!server || server.id !== h.video.model) server = new ServerVideoProvider({ model: h.video.model })
  return server
}

/**
 * THE SEAM. Everything that wants a clip for a scene goes through here, at
 * authoring time, with a shot spec (and the scene image, for image-to-video).
 * What renders it is the provider's business.
 */
export function requestClip(
  shot: ShotSpec,
  ctx: { episodeId: string; sceneId: string; image?: AssetRef },
  provider: VideoProvider = videoProvider(),
): Promise<ClipJob> {
  return provider.generateClip({ ...ctx, shot })
}

/** Poll a job to a terminal state. Real renders take tens of seconds. */
export async function awaitClip(
  job: ClipJob,
  provider: VideoProvider,
  opts: { intervalMs?: number; timeoutMs?: number; onUpdate?: (j: ClipJob) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ClipJob> {
  const interval = opts.intervalMs ?? 3000
  const timeout = opts.timeoutMs ?? 240_000
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let current = job
  let waited = 0
  while (current.status === 'queued' || current.status === 'rendering') {
    if (waited >= timeout) return { ...current, status: 'failed', error: `timed out after ${Math.round(timeout / 1000)}s` }
    await sleep(interval)
    waited += interval
    current = await provider.getStatus(current.id)
    opts.onUpdate?.(current)
  }
  return current
}

/** A finished job as a scene asset. Failed jobs attach nothing. */
export function clipToAsset(job: ClipJob, now = new Date()): AssetRef | null {
  if (job.status !== 'ready') return null
  return {
    kind: 'video',
    tier: job.tier,
    provider: job.provider,
    url: job.url,
    prompt: job.prompt,
    storageKey: job.storageKey,
    createdAt: now.toISOString(),
  }
}
