import type { AssetRef, Episode, Scene, SceneAssets } from '@/types'
import { backgroundPrompt, keyframePrompt } from './image'
import { motionPrompt } from './video'

/* ============================================================================
 * ASSET PLAN — which scenes get which generated asset. Pure, deterministic.
 *
 * Hybrid presentation, budgeted:
 *   clips        cold open, confrontation, incident, ending — capped, because a
 *                clip per dialogue line is neither affordable nor controllable.
 *                Each clip scene also gets its own KEYFRAME image: the frame the
 *                image-to-video model animates, and the still shown if no clip.
 *   backgrounds  every other scene; scenes that share a look share one plate
 *   audio        every character line
 * ========================================================================== */

export type Presentation = 'clip' | 'still'

export const presentationOf = (s: Scene): Presentation =>
  s.shot.presentation ?? (s.kind === 'cinematic' && !!s.title && !s.variants?.length ? 'clip' : 'still')

export interface AssetPlanItem {
  key: string
  kind: 'video' | 'image' | 'audio'
  /** The scene the asset is generated for. */
  sceneId: string
  /** Every scene it is attached to (backgrounds are shared by look). */
  sceneIds: string[]
  prompt: string
  reason: string
  lineIndex?: number
  characterId?: string
}

export const DEFAULT_MAX_CLIPS = 4

export function planEpisodeAssets(ep: Episode, opts: { maxClips?: number } = {}): AssetPlanItem[] {
  const max = opts.maxClips ?? DEFAULT_MAX_CLIPS
  // Adaptive gates are routing, not scenes anyone sees.
  const scenes = Object.values(ep.scenes).filter((s) => !s.variants?.length)

  const rank = (s: Scene) =>
    s.id === ep.entrySceneId ? 0 : s.kind === 'ending' ? 1 : s.kind === 'decision' ? 2 : s.outcome?.tone === 'bad' ? 3 : 4
  const clips = scenes
    .filter((s) => presentationOf(s) === 'clip')
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.s)
  const clipIds = new Set(clips.map((s) => s.id))

  const items: AssetPlanItem[] = clips.flatMap((s): AssetPlanItem[] => [
    {
      key: `image:keyframe:${s.id}`,
      kind: 'image',
      sceneId: s.id,
      sceneIds: [s.id],
      prompt: keyframePrompt(s),
      reason: 'keyframe · the image the clip animates',
    },
    {
      key: `video:${s.id}`,
      kind: 'video',
      sceneId: s.id,
      sceneIds: [s.id],
      prompt: motionPrompt(s.shot),
      reason: ['cold open', 'closing shot', 'confrontation', 'incident beat', 'major scene'][rank(s)],
    },
  ])

  const looks = new Map<string, AssetPlanItem>()
  for (const s of scenes) {
    if (clipIds.has(s.id)) continue
    const look = `${s.shot.env}|${s.shot.time}|${s.shot.mood}`
    const shared = looks.get(look)
    if (shared) {
      shared.sceneIds.push(s.id)
      continue
    }
    const item: AssetPlanItem = {
      key: `image:${look}`,
      kind: 'image',
      sceneId: s.id,
      sceneIds: [s.id],
      prompt: backgroundPrompt(s),
      reason: presentationOf(s) === 'clip' ? 'over the clip budget — still instead' : 'dialogue scene',
    }
    looks.set(look, item)
    items.push(item)
  }

  for (const s of scenes)
    s.dialogue.forEach((d, i) => {
      if (d.characterId === 'you') return
      items.push({
        key: `audio:${s.id}:${i}`,
        kind: 'audio',
        sceneId: s.id,
        sceneIds: [s.id],
        prompt: d.line,
        reason: 'character line',
        lineIndex: i,
        characterId: d.characterId,
      })
    })

  return items
}

/** Attach a finished asset to every scene the plan item covers. Never mutates. */
export function attachAsset(ep: Episode, item: AssetPlanItem, ref: AssetRef): Episode {
  const scenes = { ...ep.scenes }
  for (const id of item.sceneIds) {
    const s = scenes[id]
    if (!s) continue
    const a: SceneAssets = { ...(s.assets ?? {}) }
    if (item.kind === 'video') a.video = ref
    else if (item.kind === 'image') a.background = ref
    else a.audio = { ...(a.audio ?? {}), [item.lineIndex!]: ref }
    scenes[id] = { ...s, assets: a }
  }
  return { ...ep, scenes }
}

export interface AssetCoverage {
  clips: number
  generatedClips: number
  backgrounds: number
  generatedBackgrounds: number
  lines: number
  generatedLines: number
}

export function assetCoverage(ep: Episode, plan = planEpisodeAssets(ep)): AssetCoverage {
  const scene = (id: string) => ep.scenes[id]?.assets
  const count = (kind: AssetPlanItem['kind'], generated: (i: AssetPlanItem) => boolean) => {
    const of = plan.filter((i) => i.kind === kind)
    return [of.length, of.filter(generated).length] as const
  }
  const [clips, generatedClips] = count('video', (i) => scene(i.sceneId)?.video?.tier === 'generated')
  const [backgrounds, generatedBackgrounds] = count('image', (i) => scene(i.sceneId)?.background?.tier === 'generated')
  const [lines, generatedLines] = count('audio', (i) => scene(i.sceneId)?.audio?.[i.lineIndex!]?.tier === 'generated')
  return { clips, generatedClips, backgrounds, generatedBackgrounds, lines, generatedLines }
}

/** What the runtime will actually show for a scene, for the tier badge. */
export type VisualTier = 'ai-video' | 'ai-background' | 'procedural'

export const visualTierOf = (assets?: SceneAssets): VisualTier =>
  assets?.video?.tier === 'generated' && assets.video.url
    ? 'ai-video'
    : assets?.background?.tier === 'generated' && assets.background.url
      ? 'ai-background'
      : 'procedural'
