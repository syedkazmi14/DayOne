import type { AssetRef, Episode, Scene, SceneAssets } from '@/types'
import { getCharacter } from '@/content/characters'
import { recastEpisode } from '@/engine/recast'
import { backgroundPrompt, keyframePrompt, stillPrompt } from './image'
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
  /** The frame a clip animates, as opposed to a dialogue background. */
  keyframe?: boolean
  /** The show whose world this asset is rendered in. Absent: unscoped. */
  groupId?: string
  /** Characters drawn into a still, whose portraits go to the image model as references. */
  characters?: string[]
  /** The same still without its cast, for a model that cannot (or will not) draw the characters. */
  fallbackPrompt?: string
}

export const DEFAULT_MAX_CLIPS = 4
/** Per show, every scene is a still; only the cold open and the incident move. */
export const CLIPS_PER_SHOW = 2

/** With `groupId`, the plan is that show's instead — see planShowStills. */
export function planEpisodeAssets(ep: Episode, opts: { maxClips?: number; groupId?: string } = {}): AssetPlanItem[] {
  if (opts.groupId) return planShowStills(ep, opts.groupId, opts.maxClips ?? CLIPS_PER_SHOW)
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
      keyframe: true,
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

/**
 * One show's version of the episode, as pictures: a still for every scene, set
 * in the show's world and drawn with the characters who speak in it (their
 * portraits go to the image model as references). The cold open and the
 * incident are also animated from their stills. Speakers come from the recast,
 * so each show's stills show its own cast. No audio: the recast cast speaks live.
 */
function planShowStills(ep: Episode, show: string, maxClips: number): AssetPlanItem[] {
  const view = recastEpisode(ep, show)
  const scenes = Object.values(view.scenes).filter((s) => !s.variants?.length)
  const rank = (s: Scene) => (s.id === ep.entrySceneId ? 0 : s.outcome?.tone === 'bad' ? 1 : s.kind === 'ending' ? 2 : 3)
  const animated = new Set(
    scenes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => presentationOf(s) === 'clip')
      .sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i)
      .slice(0, maxClips)
      .map(({ s }) => s.id),
  )
  return scenes.flatMap((s): AssetPlanItem[] => {
    const opening = s.id === ep.entrySceneId
    const cast = [...new Set(s.dialogue.map((d) => d.characterId).filter((id) => id !== 'you'))].slice(0, 4)
    const moves = animated.has(s.id)
    const still: AssetPlanItem = {
      key: `image:${show}:still:${s.id}`,
      kind: 'image',
      sceneId: s.id,
      sceneIds: [s.id],
      groupId: show,
      keyframe: moves,
      characters: cast,
      prompt: stillPrompt(s, show, cast.map(getCharacter), opening),
      fallbackPrompt: stillPrompt(s, show, [], opening),
      reason: moves ? 'still · animated into a clip' : cast.length ? 'still · with the cast' : 'still · the setting',
    }
    if (!moves) return [still]
    return [
      still,
      {
        key: `video:${show}:${s.id}`,
        kind: 'video',
        sceneId: s.id,
        sceneIds: [s.id],
        groupId: show,
        prompt: motionPrompt(s.shot, { groupId: show, opening }),
        reason: opening ? 'cold open' : 'incident beat',
      },
    ]
  })
}

/** A scene's visuals as `groupId`'s show sees them: its own set, or the episode's for the show it was written in. */
export function visualsFor(ep: Episode, sceneId: string, groupId?: string): SceneAssets | undefined {
  const assets = ep.scenes[sceneId]?.assets
  return groupId && groupId !== ep.groupId ? assets?.byShow?.[groupId] : assets
}

/**
 * Attach a finished asset to every scene the plan item covers. Never mutates.
 * The episode's own show keeps the top-level slots; other shows' visuals go to
 * `byShow`, so recasting can hand each show its own world.
 */
export function attachAsset(ep: Episode, item: AssetPlanItem, ref: AssetRef): Episode {
  const scenes = { ...ep.scenes }
  for (const id of item.sceneIds) {
    const s = scenes[id]
    if (!s) continue
    const a: SceneAssets = { ...(s.assets ?? {}) }
    const other = item.groupId && item.groupId !== ep.groupId ? item.groupId : null
    if (other && item.kind !== 'audio') {
      const prev = a.byShow?.[other] ?? {}
      a.byShow = { ...(a.byShow ?? {}), [other]: item.kind === 'video' ? { ...prev, video: ref } : { ...prev, background: ref } }
    } else if (item.kind === 'video') a.video = ref
    else if (item.kind === 'image') a.background = ref
    else a.audio = { ...(a.audio ?? {}), [item.lineIndex!]: ref }
    // A show's still retires any clip that is not that show's own — a clip from
    // before per-show worlds would otherwise keep playing over the new still.
    if (item.kind === 'image' && item.groupId) {
      const stale = (v?: AssetRef) => !!v && !v.storageKey?.includes(`/${item.groupId}/videos/`)
      if (other && stale(a.byShow?.[other]?.video)) a.byShow = { ...a.byShow, [other]: { ...a.byShow![other], video: undefined } }
      if (!other && stale(a.video)) a.video = undefined
    }
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
