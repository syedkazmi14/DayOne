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

export interface Character {
  id: string
  name: string
  role: string
  /** One line the player sees on the character card. */
  tagline: string
  /** System-prompt persona. Constrains tone, never facts. */
  persona: string
  /** Hard behavioural rails handed to the conversation agent. */
  speechRules: string[]
  accent: string
  portrait: PortraitSpec
  voice: VoiceSpec
  /** Placeholder-cast bookkeeping: a company can swap in licensed assets. */
  casting: {
    archetype: string
    assetSource: 'placeholder_original' | 'licensed' | 'customer_uploaded'
  }
}

export interface PortraitSpec {
  /** Which SVG silhouette to draw. */
  build: 'spiky' | 'round' | 'long' | 'sharp' | 'wide'
  hue: string
  hue2: string
}

export interface VoiceSpec {
  /** ElevenLabs voice id — used only when a real key is configured. */
  elevenLabsVoiceId: string
  label: string
  /** Browser-synth fallback shaping, so mocked voice still feels in-character. */
  fallback: { rate: number; pitch: number }
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

export interface ShotSpec {
  /** Environment key for the procedural cinematic renderer. */
  env: 'lobby' | 'desk' | 'open_office' | 'corridor' | 'server_room' | 'night_office' | 'rooftop'
  time: 'morning' | 'midday' | 'dusk' | 'night'
  mood: 'neutral' | 'warm' | 'tense' | 'alarm' | 'calm'
  /** The prompt that WOULD be sent to a video generation API at authoring time. */
  prompt: string
  /** Populated once a clip has been pre-generated. Player never waits on it. */
  videoUrl?: string
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
}

export interface Episode {
  id: string
  number: number
  code: string
  title: string
  subtitle: string
  topic: string
  duration: string
  locked: boolean
  synopsis: string
  concepts: ConceptId[]
  cast: string[]
  entrySceneId: string
  /** Card art for episodes with no graph yet — keeps the shelf consistent. */
  poster?: ShotSpec
  scenes: Record<string, Scene>
  /** Ordered act beats, used for the progress rail. */
  beats: { act: number; label: string }[]
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
}

export interface WagerResult {
  tier: 'safe' | 'risky' | 'allin'
  staked: number
  payout: number
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
