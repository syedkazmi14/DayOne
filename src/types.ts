/* ============================================================================
 * ONBOARD — core data model
 *
 * Everything the runtime plays is DATA, never JSX. That is the whole point:
 * an episode is a graph that an authoring pipeline (Knowledge Agent ->
 * Scenario Generator) can emit, and that the deterministic game engine can
 * play back without ever asking an LLM what happens next.
 * ========================================================================== */

/* ---------------------------------------------------------------- knowledge */

export type Severity = 'critical' | 'high' | 'medium' | 'low'

/** One atomic, citable unit of company policy. Output of the Knowledge Agent. */
export interface KnowledgeItem {
  id: string
  topic: string
  /** The single normative statement. Characters quote/paraphrase this. */
  rule: string
  severity: Severity
  /** What people actually get wrong in the wild. Feeds scenario design. */
  commonMistake: string
  /** What happens when the rule is broken. Feeds consequence writing. */
  consequence: string
  /** Ambiguous situations the rule still covers. Feeds harder variants. */
  edgeCases: string[]
  recommended: string[]
  prohibited: string[]
  concepts: ConceptId[]
  /** Provenance so a character can cite instead of inventing. */
  source: { doc: string; section: string; page?: number }
}

export type ConceptId =
  | 'phishing'
  | 'password_security'
  | 'data_handling'
  | 'approved_tools'
  | 'incident_reporting'
  | 'social_engineering'
  | 'physical_security'

export interface ConceptMeta {
  id: ConceptId
  label: string
  blurb: string
}

/* --------------------------------------------------------------- characters */

/**
 * A locally-served image. Every asset the UI renders comes from this origin
 * (see scripts/fetchAssets.mjs) so card art never depends on a third-party CDN
 * staying up. `src` is still allowed to be an absolute URL — the components
 * fall back to generated art when a load fails either way.
 */
export interface ImageSpec {
  src: string
  alt?: string
  /** CSS object-position, so a crop can be nudged per asset without new code. */
  focus?: string
  /** Where the asset came from, for the attribution line. */
  credit?: string
}

/**
 * Which opener/closer table the offline grounded composer speaks through.
 * Keyed on archetype rather than character id so adding a character is a pure
 * data change — no new branch anywhere in src/ai.
 */
export type SpeechArchetype = 'chaotic' | 'anxious' | 'pragmatic' | 'authority'

export interface Character {
  id: string
  name: string
  /** Which roster group this character belongs to. */
  groupId: string
  role: string
  /** One line the player sees on the character card. */
  tagline: string
  /** System-prompt persona. Constrains tone, never facts. */
  persona: string
  /** Hard behavioural rails handed to the conversation agent. */
  speechRules: string[]
  speechArchetype: SpeechArchetype
  /** In-character hellos. The first one doubles as the voice-preview line. */
  greetings: string[]
  /** What they say when retrieval comes back empty. Never a guess. */
  refusal: string
  /** Optional in-character sign-offs. */
  closers: string[]
  accent: string
  /** Portrait artwork. Absent or failing, the SVG portrait stands in. */
  avatar?: ImageSpec
  portrait: PortraitSpec
  /** Key into the voice registry — see src/voice/voiceProfiles.ts. */
  voiceProfileId: string
  /** Placeholder-cast bookkeeping: a company can swap in licensed assets. */
  casting: {
    archetype: string
    assetSource: 'placeholder_original' | 'licensed' | 'community_wiki' | 'customer_uploaded'
  }
}

export interface PortraitSpec {
  /** Which SVG silhouette to draw. */
  build: 'spiky' | 'round' | 'long' | 'sharp' | 'wide'
  hue: string
  hue2: string
}

/** One swipeable panel on the home-screen roster carousel. */
export interface CharacterGroup {
  id: string
  name: string
  /** Sits under the group title. */
  tagline: string
  accent: string
  /** Ordered — this is the card order inside the panel. */
  characterIds: string[]
}

/* ------------------------------------------------------------------ episode */

export type SceneKind = 'cinematic' | 'decision' | 'consequence' | 'debrief' | 'ending'

export interface Dialogue {
  characterId: string
  line: string
  /** Optional stage direction shown as a dim italic caption. */
  direction?: string
}

export interface Choice {
  id: string
  label: string
  text: string
  /** Deterministic branch target. No LLM decides this. */
  consequenceSceneId: string
  knowledgeConcepts: ConceptId[]
  scoreImpact: number
  /** Quality tier drives consequence framing, mastery updates and wagers. */
  quality: 'best' | 'acceptable' | 'poor'
  /** Short label used on the results ledger. */
  ledgerLabel: string
}

/**
 * SHOT SPECIFICATION — instructions for generating a scene's visual asset.
 *
 * The spec is authored (by a person or the scenario generator); the asset it
 * describes is produced ahead of time by a provider (src/media) and attached as
 * `Scene.assets`. The reducer never reads either.
 */
export interface ShotSpec {
  /** Environment key for the procedural cinematic renderer. */
  env: 'lobby' | 'desk' | 'open_office' | 'corridor' | 'server_room' | 'night_office' | 'rooftop'
  time: 'morning' | 'midday' | 'dusk' | 'night'
  mood: 'neutral' | 'warm' | 'tense' | 'alarm' | 'calm'
  /** The text-to-video / text-to-image prompt sent at authoring time. */
  prompt: string
  /**
   * 'clip' — a major beat worth a short generated video.
   * 'still' — a generated background plus character sprites and voice.
   * Absent: titled cinematic scenes are clips, everything else is a still.
   */
  presentation?: 'clip' | 'still'
  /** Target clip length. Clips are short cinematic shots, 5–8 s. */
  durationSec?: number
  camera?: string
  /** What visibly happens in the shot — the character and environment motion a video model animates. */
  action?: string
}

/* ------------------------------------------------------------------- assets */

export type AssetKind = 'video' | 'image' | 'audio'

/**
 * 'generated'  — an AI provider produced a file (video model, image model, TTS).
 * 'procedural' — nothing was generated; the runtime renders it from the spec.
 * The UI states which. A procedural asset is never presented as AI output.
 */
export type AssetTier = 'generated' | 'procedural'

/** One authored asset. Produced at authoring time; the player only loads it. */
export interface AssetRef {
  kind: AssetKind
  tier: AssetTier
  /** 'fal-ai/ltx-video', 'elevenlabs', 'procedural-previs', … */
  provider: string
  /** Absent for procedural assets — there is no file. */
  url?: string
  prompt?: string
  /** Object-store key: company/episodes/<episode>/videos/<scene>.mp4 */
  storageKey?: string
  createdAt: string
}

export interface SceneAssets {
  video?: AssetRef
  background?: AssetRef
  /** Pre-rendered voice per dialogue line index. */
  audio?: Record<number, AssetRef>
}

/** What shape of risk a decision presents. Drives run telemetry, not branching. */
export interface ThreatProfile {
  /** Does the risk arrive from outside, or from someone the player works with? */
  source: 'external' | 'internal'
  pressure: 'authority' | 'urgency' | 'peer' | 'none'
}

export interface Scene {
  id: string
  kind: SceneKind
  act: number
  title?: string
  subtitle?: string
  shot: ShotSpec
  dialogue: Dialogue[]
  /** Present on decision scenes. */
  prompt?: string
  choices?: Choice[]
  /** Wager terminal before a decision. */
  allowWager?: boolean
  /** Consequence-scene payload. */
  outcome?: {
    tone: 'good' | 'bad' | 'mixed'
    banner: string
    /** The teaching moment — shown AFTER the world reacts, never before. */
    lesson: string
    citations: string[]
  }
  /** Who the player may talk to after this scene. */
  chatWith?: string[]
  chatHook?: string
  next?: string
  /** Adaptive slot: engine picks one variant by the player's weakest concept. */
  variants?: { conceptFocus: ConceptId; sceneId: string }[]
  /** Pre-generated visual/audio assets. Optional: absent, the runtime renders the shot. */
  assets?: SceneAssets
  /** Knowledge ids this scene is built on (decisions); consequences cite via outcome. */
  knowledgeRefs?: string[]
  /** Decision scenes: the risk shape, recorded with the decision for the coach. */
  threat?: ThreatProfile
}

export interface Episode {
  id: string
  number: number
  code: string
  title: string
  subtitle: string
  /** Which roster group this episode belongs to. Drives the home-screen shelf. */
  groupId: string
  topic: string
  duration: string
  locked: boolean
  synopsis: string
  concepts: ConceptId[]
  cast: string[]
  entrySceneId: string
  /**
   * Still image shown behind the episode title, on the shelf card and on the
   * intro screen. Pure data: swap the `src` and the UI follows, no component
   * changes. Absent or failing to load, the procedural card art stands in.
   */
  image?: ImageSpec
  /** Card art for episodes with no graph yet — keeps the shelf consistent. */
  poster?: ShotSpec
  scenes: Record<string, Scene>
  /** Ordered act beats, used for the progress rail. */
  beats: { act: number; label: string }[]
  /**
   * Knowledge a generated episode is grounded in, snapshotted at generation so
   * its citations and character chat keep resolving whatever the base becomes.
   */
  knowledge?: KnowledgeItem[]
  /** Present on generated episodes. */
  provenance?: EpisodeProvenance
}

export interface EpisodeProvenance {
  generator: 'llm' | 'local'
  model?: string
  topic: string
  knowledgeIds: string[]
  /** Concepts the adaptive act can target, weakest-first for the authoring profile. */
  masteryTargets: ConceptId[]
  difficulty: 'intro' | 'standard' | 'hard'
  /** characterId -> narrative role in this episode. */
  roles: Record<string, string>
  createdAt: string
  status: 'draft' | 'published'
}

/* ------------------------------------------------------------- player state */

export interface Mastery {
  /** 0..1 posterior estimate of demonstrated understanding. */
  score: number
  attempts: number
  correct: number
}

export interface DecisionRecord {
  sceneId: string
  sceneTitle: string
  choiceId: string
  choiceLabel: string
  ledgerLabel: string
  quality: Choice['quality']
  concepts: ConceptId[]
  scoreImpact: number
  wager?: WagerResult
  msToDecide: number
  threat?: ThreatProfile
}

export interface WagerResult {
  tier: 'safe' | 'risky' | 'allin'
  staked: number
  payout: number
  multiplier: number
  /** Mastery-model estimate, recorded silently at bet time and revealed after. */
  estimate: number
  won: boolean
}

export interface PlayerState {
  name: string
  level: number
  xp: number
  credits: number
  reputation: number
  mastery: Record<ConceptId, Mastery>
  decisions: DecisionRecord[]
  completedEpisodes: string[]
  transcript: ChatTurn[]
  cosmetics: Cosmetics
}

/* ---------------------------------------------------------------- cosmetics */

/** Profile decoration only. Nothing here is read by the engine or the scoring. */
export type CosmeticType = 'border' | 'title' | 'badge' | 'character'

export interface ShopItem {
  id: string
  name: string
  type: CosmeticType
  price: number
  description: string
  /** Character art. Absent means the card renders a labelled placeholder. */
  image?: string
  /** Which show a character belongs to — a CharacterGroup id. */
  show?: string
  featured?: boolean
  isNew?: boolean
}

/** Awarded by play, never sold. */
export interface EarnedBadge {
  id: string
  name: string
  description: string
}

export interface Cosmetics {
  ownedItems: string[]
  earnedBadges: string[]
  equippedBorder: string | null
  equippedTitle: string | null
  /** Shown next to the name on Profile, in the order they were equipped. */
  equippedBadges: string[]
  showcaseCharacter: string | null
}

export interface ChatTurn {
  id: string
  characterId: string
  role: 'player' | 'character'
  text: string
  /** Knowledge ids the answer was grounded in. Empty = refused to speculate. */
  citations?: string[]
  mode: 'text' | 'voice'
  grounded?: boolean
}

/* ---------------------------------------------------------------- authoring */

export interface SourceDoc {
  id: string
  name: string
  type: 'pdf' | 'video' | 'slides' | 'handbook' | 'policy'
  pages: number
  excerpt: string
  /** Knowledge ids the Knowledge Agent extracted from this doc. */
  yields: string[]
}
