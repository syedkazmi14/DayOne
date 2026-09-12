import { getGroup, groupCast } from '@/content/characterGroups'
import { conceptLabel, knowledgeBase } from '@/content/knowledge'
import { sanitizeText } from '@/content/validateKnowledge'
import { validateEpisode, type GraphReport } from '@/engine/validateEpisode'
import type {
  Character,
  Choice,
  ConceptId,
  Dialogue,
  Episode,
  KnowledgeItem,
  Mastery,
  Scene,
  ShotSpec,
  SpeechArchetype,
  ThreatProfile,
} from '@/types'
import { complete, isLive, llmLabel, LLMUnavailable } from './llm'
import { CONFIDENCE_FLOOR, retrieve } from './retrieval'

/* ============================================================================
 * EPISODE GENERATOR — company knowledge + topic + mastery -> playable graph.
 *
 *   select knowledge   which rules in THIS company's material cover the topic
 *   cast roles         mentor / pressure / peer / manager from the roster
 *   build graph        acts, decisions, consequences, adaptive act three,
 *                      citations, threat profiles, shot specifications
 *   write script       (with a model) rewrite the words, never the structure
 *   validate           the same gate the reducer enforces on publish
 *
 * Split of authority, deliberately:
 *   CODE owns structure — scene ids, transitions, which option is strong,
 *   what each branch cites, which concepts the adaptive act targets. A model
 *   cannot invent a branch here any more than it can at runtime.
 *   THE MODEL owns language — lines, choice wording, banners, lessons, shot
 *   prompts — merged field by field into the code-built skeleton, then
 *   validated. A script that breaks the graph is discarded, not patched.
 *
 * Without a model the deterministic composer writes the words from the
 * knowledge items' own fields, and labels itself as such.
 * ========================================================================== */

export const COMPANY = 'Helix Dynamics'

/* ------------------------------------------------------------------ topics */

export interface TopicDef {
  id: string
  label: string
  blurb: string
  /** Concepts the topic spans. Empty = select by retrieval over `query`. */
  concepts: ConceptId[]
  query: string
}

export const TOPICS: TopicDef[] = [
  {
    id: 'phishing',
    label: 'Phishing',
    blurb: 'Deceptive email, calls and impersonation',
    concepts: ['phishing', 'social_engineering', 'incident_reporting', 'password_security'],
    query: 'phishing suspicious email link impersonation urgency',
  },
  {
    id: 'cybersecurity',
    label: 'Cybersecurity',
    blurb: 'The whole security baseline',
    concepts: ['phishing', 'password_security', 'social_engineering', 'approved_tools', 'data_handling', 'incident_reporting'],
    query: 'security',
  },
  {
    id: 'data-privacy',
    label: 'Data privacy',
    blurb: 'Where customer data may and may not go',
    concepts: ['data_handling', 'approved_tools', 'incident_reporting'],
    query: 'customer personal data export privacy',
  },
  {
    id: 'workplace-safety',
    label: 'Workplace safety',
    blurb: 'Hazards, evacuation, injuries',
    concepts: [],
    query: 'workplace safety fire evacuation injury hazard first aid',
  },
]

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)

export const customTopic = (text: string): TopicDef => {
  const label = sanitizeText(text).slice(0, 60)
  return { id: slug(label) || 'custom', label, blurb: 'Custom topic', concepts: [], query: label }
}

export class TopicNotCovered extends Error {
  constructor(
    readonly topic: string,
    readonly found: KnowledgeItem[],
  ) {
    super(
      `Only ${found.length} rule${found.length === 1 ? '' : 's'} in the company material cover "${topic}". Add material on it — the generator will not invent policy.`,
    )
    this.name = 'TopicNotCovered'
  }
}

/** Two decisions need two distinct rules to stand on. */
export const MIN_RULES = 2

export function selectKnowledge(topic: TopicDef, corpus: KnowledgeItem[] = knowledgeBase): KnowledgeItem[] {
  if (topic.concepts.length) return corpus.filter((k) => k.concepts.some((c) => topic.concepts.includes(c)))
  const r = retrieve(topic.query, { corpus, k: 8 })
  if (r.confidence < CONFIDENCE_FLOOR) return []
  return r.hits.filter((h) => h.relevance >= 0.2).map((h) => h.item)
}

/* ------------------------------------------------------------------- roles */

export type Role = 'mentor' | 'pressure' | 'peer' | 'manager'

export const ROLE_LABEL: Record<Role, string> = {
  mentor: 'security lead — explains the why',
  pressure: 'the shortcut — applies the pressure',
  peer: 'the peer — shares the risk',
  manager: 'the manager — owns the deadline',
}

const ROLE_ARCHETYPE: Record<Role, SpeechArchetype> = {
  mentor: 'authority',
  pressure: 'chaotic',
  peer: 'anxious',
  manager: 'pragmatic',
}

export function assignRoles(cast: Character[]): Record<Role, Character> {
  const pool = [...cast]
  const out = {} as Record<Role, Character>
  for (const role of ['mentor', 'pressure', 'peer', 'manager'] as Role[]) {
    const i = pool.findIndex((c) => c.speechArchetype === ROLE_ARCHETYPE[role])
    out[role] = pool.splice(i >= 0 ? i : 0, 1)[0] ?? cast[0]
  }
  return out
}

/* ------------------------------------------------------------------- plan */

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const
const EXTERNAL: ConceptId[] = ['phishing', 'social_engineering', 'physical_security']

const CONCEPT_THREAT: Record<ConceptId, ThreatProfile> = {
  phishing: { source: 'external', pressure: 'urgency' },
  social_engineering: { source: 'external', pressure: 'authority' },
  physical_security: { source: 'external', pressure: 'peer' },
  password_security: { source: 'internal', pressure: 'authority' },
  data_handling: { source: 'internal', pressure: 'urgency' },
  approved_tools: { source: 'internal', pressure: 'peer' },
  incident_reporting: { source: 'internal', pressure: 'peer' },
}

const CONCEPT_ENV: Record<ConceptId, ShotSpec['env']> = {
  phishing: 'desk',
  social_engineering: 'desk',
  password_security: 'desk',
  data_handling: 'open_office',
  approved_tools: 'open_office',
  incident_reporting: 'night_office',
  physical_security: 'lobby',
}

const GOOD_BANNER: Record<ConceptId, string> = {
  phishing: 'THREAT CONTAINED',
  social_engineering: 'THE CALL DEAD-ENDED',
  password_security: 'ACCESS INTACT',
  data_handling: 'THE DATA STAYED PUT',
  approved_tools: 'NO SHADOW IT',
  incident_reporting: 'CONTAINED EARLY',
  physical_security: 'THE DOOR STAYED SHUT',
}

const BAD_BANNER: Record<ConceptId, string> = {
  phishing: 'SECURITY INCIDENT',
  social_engineering: 'ACCOUNT TAKEN OVER',
  password_security: 'ACCESS COMPROMISED',
  data_handling: 'REPORTABLE DATA BREACH',
  approved_tools: 'DATA IN AN UNREVIEWED TOOL',
  incident_reporting: 'THE INCIDENT GREW',
  physical_security: 'BUILDING BREACHED',
}

export interface Beat {
  id: string
  act: number
  item: KnowledgeItem
  focus: ConceptId
  threat: ThreatProfile
}

export interface EpisodePlan {
  knowledge: KnowledgeItem[]
  /** Concepts the adaptive act covers, weakest-first for the authoring profile. */
  targets: ConceptId[]
  difficulty: 'intro' | 'standard' | 'hard'
  d1: Beat
  d2: Beat
  variants: Beat[]
}

export function planEpisode(items: KnowledgeItem[], topic: TopicDef, mastery: Record<ConceptId, Mastery>): EpisodePlan {
  const ranked = items
    .map((k, i) => ({ k, i }))
    .sort((a, b) => SEVERITY_RANK[a.k.severity] - SEVERITY_RANK[b.k.severity] || a.i - b.i)
    .map((x) => x.k)
  const inScope = (c: ConceptId) => !topic.concepts.length || topic.concepts.includes(c)
  const focusOf = (k: KnowledgeItem) => k.concepts.find(inScope) ?? k.concepts[0]

  const candidates = [...new Set(ranked.flatMap((k) => k.concepts).filter(inScope))]
  const targets = candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => mastery[a.c].score - mastery[b.c].score || a.i - b.i)
    .map((x) => x.c)
    .slice(0, 3)
  const avg = targets.reduce((s, c) => s + mastery[c].score, 0) / Math.max(1, targets.length)
  const difficulty = avg < 0.45 ? 'intro' : avg < 0.7 ? 'standard' : 'hard'

  // Act one opens on an external threat, act two turns to a colleague — so
  // both halves of the telemetry get evidence in every episode.
  const d1Item = ranked.find((k) => EXTERNAL.includes(focusOf(k))) ?? ranked[0]
  const d1Focus = focusOf(d1Item)
  const rest = ranked.filter((k) => k !== d1Item)
  const d2Item = rest.find((k) => CONCEPT_THREAT[focusOf(k)].source !== CONCEPT_THREAT[d1Focus].source) ?? rest[0]
  const d2Focus = focusOf(d2Item)
  const d2Threat: ThreatProfile =
    difficulty === 'hard' ? { ...CONCEPT_THREAT[d2Focus], pressure: 'authority' } : CONCEPT_THREAT[d2Focus]

  const used = new Set([d1Item.id, d2Item.id])
  const variants = targets.map((c): Beat => {
    const pool = ranked.filter((k) => k.concepts.includes(c))
    const item = pool.find((k) => !used.has(k.id) && k.concepts[0] === c) ?? pool.find((k) => !used.has(k.id)) ?? pool[0]
    used.add(item.id)
    return { id: `g_v_${c}`, act: 3, item, focus: c, threat: CONCEPT_THREAT[c] }
  })

  return {
    knowledge: ranked,
    targets,
    difficulty,
    d1: { id: 'g_d1', act: 1, item: d1Item, focus: d1Focus, threat: CONCEPT_THREAT[d1Focus] },
    d2: { id: 'g_d2', act: 2, item: d2Item, focus: d2Focus, threat: d2Threat },
    variants,
  }
}

/* ---------------------------------------------------------- text helpers */

const KEEP_CAPS = /^(Helix|IT|MFA|SSO|VPN|SaaS|DPA|Security Portal|Report Phish|Access Portal|Service Desk)\b/
const strip = (t: string) => t.trim().replace(/[.\s]+$/, '')
const low = (t: string) => (KEEP_CAPS.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1))
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const firstSentence = (t: string) => (t.split(/(?<=\.)\s/)[0] ?? t).trim()
const firstName = (c: Character) => {
  const w = c.name.split(' ')[0]
  return w.charAt(0) + w.slice(1).toLowerCase()
}

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const ENV_DESC: Record<ShotSpec['env'], string> = {
  lobby: 'the glass atrium lobby of a modern tech company',
  desk: 'an open-plan desk with a laptop and two monitors',
  open_office: 'an operations floor of desk pods and whiteboards',
  corridor: 'a long office corridor with slatted glass walls',
  server_room: 'a dim server room of blinking racks',
  night_office: 'a concrete office stairwell under a single fluorescent tube',
  rooftop: 'an office building seen from the street, one floor still lit',
}
const TIME_DESC: Record<ShotSpec['time'], string> = {
  morning: 'cold morning',
  midday: 'harsh midday',
  dusk: 'low amber late-afternoon',
  night: 'cool blue night',
}
const MOOD_DESC: Record<ShotSpec['mood'], string> = {
  neutral: 'naturalistic',
  warm: 'warm, hopeful',
  tense: 'tense, claustrophobic',
  alarm: 'alarmed, red-tinged',
  calm: 'quiet, resolved',
}

function shotSpec(
  env: ShotSpec['env'],
  time: ShotSpec['time'],
  mood: ShotSpec['mood'],
  subject: string,
  presentation: ShotSpec['presentation'],
  durationSec?: number,
): ShotSpec {
  return {
    env,
    time,
    mood,
    presentation,
    durationSec,
    camera: presentation === 'clip' ? 'slow cinematic push-in, 35mm, shallow depth of field' : 'locked-off wide, 28mm',
    action: subject,
    prompt: `Cinematic shot of ${ENV_DESC[env]}, ${TIME_DESC[time]} light, ${MOOD_DESC[mood]} atmosphere. ${subject} Muted teal and amber grade.`,
  }
}

const ACT_TIME: Record<number, ShotSpec['time']> = { 1: 'morning', 2: 'midday', 3: 'dusk', 4: 'night' }
const ACT_CLOCK: Record<number, string> = { 1: '09:40', 2: '13:15', 3: '16:20', 4: '18:30' }

/** The six orderings of three options; the strong one is never always "B". */
const ORDERS: Choice['quality'][][] = [
  ['poor', 'best', 'acceptable'],
  ['best', 'acceptable', 'poor'],
  ['acceptable', 'poor', 'best'],
  ['poor', 'acceptable', 'best'],
  ['best', 'poor', 'acceptable'],
  ['acceptable', 'best', 'poor'],
]

/* ------------------------------------------------------------- composing */

type Cast = Record<Role, Character>

function pressureLines(b: Beat, cast: Cast): Dialogue[] {
  const mistake = low(strip(b.item.commonMistake))
  const { pressure, peer } = cast
  if (b.threat.source === 'external')
    return [
      {
        characterId: peer.id,
        line: `This just came in and it wants us to act right now. The quick way is ${mistake} — right?`,
        direction: 'It looks legitimate. Close enough, anyway.',
      },
      { characterId: pressure.id, line: 'Just do it. It is always fine.', direction: `${firstName(pressure)} has not looked up.` },
      { characterId: 'you', line: 'Everyone is waiting on you.' },
    ]
  const opener = {
    authority: 'I am signing off on this, so let us not make it a thing.',
    urgency: 'This has to be done in the next ten minutes.',
    peer: 'Everyone on the team does it this way.',
    none: 'Honestly, it is not a big deal.',
  }[b.threat.pressure]
  return [
    { characterId: pressure.id, line: `${opener} The quick way is ${mistake}.`, direction: 'It is a reasonable ask from someone with a real reason to ask.' },
    { characterId: peer.id, line: 'It has never been a problem before... has it?' },
    { characterId: 'you', line: 'Everyone is waiting on you.' },
  ]
}

function decisionScenes(b: Beat, cast: Cast, next: string): Scene[] {
  const k = b.item
  const { mentor, pressure, manager } = cast
  const env = CONCEPT_ENV[b.focus]
  const time = ACT_TIME[b.act]
  const edge = k.edgeCases[0]
  const concepts = [b.focus, ...k.concepts.filter((c) => c !== b.focus)].slice(0, 2)
  const bestAction = `${cap(strip(k.recommended[0]))}${k.recommended[1] ? `, then ${low(strip(k.recommended[1]))}` : ''}`
  const ids = { best: `${b.id}_good`, acceptable: `${b.id}_asked`, poor: `${b.id}_shortcut` }
  const cite = `${k.source.doc} § ${k.source.section}`

  const option: Record<Choice['quality'], Omit<Choice, 'id' | 'label'>> = {
    best: {
      text: `${bestAction}.`,
      consequenceSceneId: ids.best,
      knowledgeConcepts: concepts,
      scoreImpact: 14,
      quality: 'best',
      ledgerLabel: `Handled ${low(strip(k.topic))} by the book`,
    },
    acceptable: {
      text: `Stop and ask ${firstName(manager)} whether this is actually allowed before anyone does anything.`,
      consequenceSceneId: ids.acceptable,
      knowledgeConcepts: concepts,
      scoreImpact: 4,
      quality: 'acceptable',
      ledgerLabel: `Paused to question ${low(strip(k.topic))}`,
    },
    poor: {
      text: `Go along with it — ${low(strip(k.commonMistake))}.`,
      consequenceSceneId: ids.poor,
      knowledgeConcepts: concepts,
      scoreImpact: -12,
      quality: 'poor',
      ledgerLabel: `Took the shortcut on ${low(strip(k.topic))}`,
    },
  }
  const order = ORDERS[hash(b.id + k.id) % ORDERS.length]
  const choices: Choice[] = order.map((q, i) => ({ ...option[q], id: `${b.id}_${'abc'[i]}`, label: 'ABC'[i] }))

  const decision: Scene = {
    id: b.id,
    kind: 'decision',
    act: b.act,
    title: strip(k.topic).toUpperCase(),
    subtitle: `ACT ${b.act} · ${ACT_CLOCK[b.act]}`,
    // Act one's decision is the episode's confrontation, so it earns a clip.
    shot:
      b.act === 1
        ? shotSpec(
            env,
            time,
            'tense',
            'A colleague leans over the desk pressing an urgent request while the new hire looks at the screen, reaches toward the keyboard and pauses.',
            'clip',
            6,
          )
        : shotSpec(env, time, 'tense', 'Someone leans over the desk mid-request; the held moment before a decision.', 'still'),
    dialogue: pressureLines(b, cast),
    prompt: 'WHAT DO YOU DO?',
    allowWager: true,
    choices,
    knowledgeRefs: [k.id],
    threat: b.threat,
  }

  const consequence = (
    id: string,
    tone: 'good' | 'bad' | 'mixed',
    banner: string,
    shot: ShotSpec,
    dialogue: Dialogue[],
    lesson: string,
    chatWith: string[],
    chatHook: string,
  ): Scene => ({ id, kind: 'consequence', act: b.act, shot, dialogue, outcome: { tone, banner, lesson, citations: [k.id] }, next, chatWith, chatHook })

  return [
    decision,
    consequence(
      ids.best,
      'good',
      GOOD_BANNER[b.focus],
      shotSpec(env, time, 'calm', 'Tension leaving the room; the work carries on the documented way.', 'still'),
      [
        { characterId: mentor.id, line: `Good call. Here is what did not happen: ${low(strip(firstSentence(k.consequence)))}.` },
        { characterId: pressure.id, line: 'Fine. Slower. But fine.' },
      ],
      `${k.rule} ${edge ? `The case that catches people: ${low(strip(edge))}. ` : ''}What you did — ${low(strip(k.recommended[0]))} — is the route ${cite} documents, and it held up under pressure because it never depended on judging whether the request felt legitimate.`,
      [mentor.id, pressure.id],
      `Ask ${firstName(mentor)} why the quick way is so dangerous.`,
    ),
    consequence(
      ids.acceptable,
      'mixed',
      'STOPPED — FOR NOW',
      shotSpec(env, time, 'neutral', 'Two colleagues pause mid-conversation; the request hangs unresolved.', 'still'),
      [
        { characterId: manager.id, line: 'Asking stopped it. Next time it will be you on your own.' },
        { characterId: pressure.id, line: 'Yeah. Fair. I assumed.' },
      ],
      `Asking was enough to stop it, and making an assumption visible is worth a lot. The gap is that the check was yours to make: ${low(strip(k.recommended[0]))}. ${k.rule} ${cap(strip(k.commonMistake))} is common precisely because everyone expects someone else to check.`,
      [manager.id, mentor.id],
      `Ask ${firstName(manager)} what you should have checked yourself.`,
    ),
    consequence(
      ids.poor,
      'bad',
      k.severity === 'critical' || k.severity === 'high' ? BAD_BANNER[b.focus] : 'IT COST SOMETHING',
      shotSpec(
        env,
        time,
        'alarm',
        'An incident unfolding: screens flash red, people gather behind a desk, a phone call nobody wants to take.',
        'clip',
        5,
      ),
      [
        { characterId: mentor.id, line: `${cap(strip(firstSentence(k.consequence)))}. That is what just happened.` },
        { characterId: pressure.id, line: 'I said it was fine. It was not.' },
      ],
      `What happened is mechanical, not bad luck: ${low(strip(k.consequence))}. ${k.rule} Where this goes wrong in practice is ${low(strip(k.commonMistake))}.${edge ? ` Watch for this: ${low(strip(edge))}.` : ''}`,
      [mentor.id, pressure.id],
      `Ask ${firstName(mentor)} what you should have done instead.`,
    ),
  ]
}

const TITLES: Record<string, string> = {
  phishing: 'THE SUSPICIOUS REQUEST',
  cybersecurity: 'THE LONG MONDAY',
  'data-privacy': 'THE EXPORT QUEUE',
}

export function buildEpisode(args: {
  plan: EpisodePlan
  topic: TopicDef
  groupId: string
  cast: Cast
  castIds: string[]
  generator: 'llm' | 'local'
  company?: string
  now?: Date
}): Episode {
  const { plan, topic, cast } = args
  const company = args.company ?? COMPANY
  const { mentor, peer } = cast
  const id = `gen-${topic.id}-${hash([topic.id, args.groupId, ...plan.knowledge.map((k) => k.id), ...plan.targets].join('|')).toString(36)}`
  const gate = 'g_gate'
  const end = 'g_end'
  const doc = plan.d1.item.source.doc

  const open: Scene = {
    id: 'g_open',
    kind: 'cinematic',
    act: 1,
    title: company.toUpperCase(),
    subtitle: `${topic.label.toUpperCase()} · MONDAY 09:12`,
    shot: shotSpec(
      'lobby',
      'morning',
      'warm',
      `Wide establishing shot: employees cross the lobby with coffee and badges; a new hire hesitates at the gates, then walks in. ${company}.`,
      'clip',
      6,
    ),
    dialogue: [
      { characterId: 'you', line: 'Monday. Coffee, badge, and an inbox that is already full.' },
      { characterId: peer.id, line: `You are new too? I am ${firstName(peer)}. Stick with me — it gets weird up there.` },
      { characterId: mentor.id, line: `${firstName(mentor)}, security. If anything feels off today, it probably is. Come and find me.` },
    ],
    next: plan.d1.id,
  }

  const act1 = decisionScenes(plan.d1, cast, plan.d2.id)
  const act2 = decisionScenes(plan.d2, cast, gate)
  const gateScene: Scene = {
    id: gate,
    kind: 'cinematic',
    act: 3,
    title: 'ADAPTING',
    subtitle: 'READING YOUR DECISIONS',
    shot: shotSpec('corridor', 'dusk', 'neutral', 'Transitional corridor walk, figures blurring past.', 'still'),
    dialogue: [],
    variants: plan.variants.map((v) => ({ conceptFocus: v.focus, sceneId: v.id })),
  }
  const act3 = plan.variants.flatMap((v) => decisionScenes(v, cast, end))
  const ending: Scene = {
    id: end,
    kind: 'ending',
    act: 4,
    title: 'END OF SHIFT',
    subtitle: `${company.toUpperCase()} · ${ACT_CLOCK[4]}`,
    shot: shotSpec('rooftop', 'night', 'calm', 'A figure walks out of the revolving door, stops on the pavement and looks back up at the one lit floor.', 'clip', 6),
    dialogue: [
      { characterId: 'you', line: `Three calls nobody labelled. Every one of them was in ${doc.replace(/\.[a-z0-9]+$/i, '')} somewhere.` },
      { characterId: mentor.id, line: 'Same time tomorrow. Bring the instincts, not the slides.' },
    ],
  }

  const scenes = [open, ...act1, ...act2, gateScene, ...act3, ending]
  const concepts = [...new Set(scenes.flatMap((s) => s.choices?.flatMap((c) => c.knowledgeConcepts) ?? []))]

  return {
    id,
    number: 1,
    code: 'GENERATED',
    title: TITLES[topic.id] ?? `THE ${topic.label.toUpperCase()} SHIFT`,
    subtitle: `Built from ${plan.knowledge.length} rules in your company's material.`,
    groupId: args.groupId,
    topic: topic.label,
    duration: '5–7 min',
    locked: false,
    synopsis: `${cap(low(strip(plan.d1.item.topic)))}, then ${low(strip(plan.d2.item.topic))} — and an act three built around whatever you are weakest at.`,
    concepts,
    cast: args.castIds,
    entrySceneId: open.id,
    poster: open.shot,
    beats: [
      { act: 1, label: 'COLD OPEN' },
      { act: 2, label: 'THE PRESSURE' },
      { act: 3, label: 'MADE FOR YOU' },
      { act: 4, label: 'END OF SHIFT' },
    ],
    scenes: Object.fromEntries(scenes.map((s) => [s.id, s])),
    knowledge: plan.knowledge,
    provenance: {
      generator: args.generator,
      model: args.generator === 'llm' ? llmLabel() : undefined,
      topic: topic.label,
      knowledgeIds: plan.knowledge.map((k) => k.id),
      masteryTargets: plan.targets,
      difficulty: plan.difficulty,
      roles: Object.fromEntries((Object.keys(cast) as Role[]).map((r) => [cast[r].id, ROLE_LABEL[r]])),
      createdAt: (args.now ?? new Date()).toISOString(),
      status: 'draft',
    },
  }
}

/* ------------------------------------------------------------ model script */

export const SCRIPT_SYSTEM = `You are the dialogue writer for an interactive onboarding episode. The episode STRUCTURE is fixed by the game engine and you must not change it: scene ids, choice ids, which option is strong or weak, branching and citations are already decided. You only rewrite the WORDS.

Rules:
- Every claim must come from the knowledge given for that scene. Never invent a policy, tool, number, system or deadline.
- Pressure is social and legitimate — a deadline, a senior colleague, a customer waiting. Never a cartoon villain.
- Choices keep their quality, but no option may reveal it through wording. Never write "correct" or "incorrect".
- Lessons explain the mechanism, 220–480 characters, and are shown only after the world reacts.
- Dialogue lines are at most 30 words. Speakers must be one of the role names provided.
- Shot prompts describe one short cinematic shot: environment, light, action. No on-screen text.

Return JSON only:
{"scenes": {"<sceneId>": {"title"?: string, "dialogue"?: [{"speaker": string, "line": string}], "choices"?: {"<choiceId>": string}, "banner"?: string, "lesson"?: string, "shotPrompt"?: string}}}`

interface ScriptScene {
  title?: unknown
  dialogue?: unknown
  choices?: unknown
  banner?: unknown
  lesson?: unknown
  shotPrompt?: unknown
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = sanitizeText(v)
  return t && t.length <= max ? t : null
}

/** Field-by-field merge. Unknown scenes, choices and speakers are ignored. */
export function applyScript(ep: Episode, script: unknown, speakers: Record<string, string>): Episode {
  const scenesIn = (script as { scenes?: Record<string, ScriptScene> })?.scenes
  if (!scenesIn || typeof scenesIn !== 'object') return ep
  const scenes = { ...ep.scenes }
  for (const [id, patch] of Object.entries(scenesIn)) {
    const s = scenes[id]
    if (!s || !patch || typeof patch !== 'object') continue
    const next: Scene = { ...s }
    const title = text(patch.title, 48)
    if (title && s.title) next.title = title.toUpperCase()
    if (Array.isArray(patch.dialogue) && patch.dialogue.length) {
      const lines = patch.dialogue.map((d: { speaker?: unknown; line?: unknown }) => ({
        characterId: typeof d?.speaker === 'string' ? speakers[d.speaker.toLowerCase()] : undefined,
        line: text(d?.line, 240),
      }))
      if (lines.every((l) => l.characterId && l.line))
        next.dialogue = lines.map((l) => ({ characterId: l.characterId!, line: l.line! }))
    }
    if (s.choices && patch.choices && typeof patch.choices === 'object') {
      const byId = patch.choices as Record<string, unknown>
      next.choices = s.choices.map((c) => ({ ...c, text: text(byId[c.id], 240) ?? c.text }))
    }
    if (s.outcome) {
      next.outcome = {
        ...s.outcome,
        banner: text(patch.banner, 40)?.toUpperCase() ?? s.outcome.banner,
        lesson: text(patch.lesson, 700) ?? s.outcome.lesson,
      }
    }
    const shotPrompt = text(patch.shotPrompt, 600)
    if (shotPrompt) next.shot = { ...s.shot, prompt: shotPrompt }
    scenes[id] = next
  }
  return { ...ep, scenes }
}

async function writeScript(ep: Episode, cast: Cast): Promise<unknown> {
  const roleOf: Record<string, string> = { you: 'player' }
  for (const r of Object.keys(cast) as Role[]) roleOf[cast[r].id] = r
  const knowledge = (id?: string) => ep.knowledge?.find((k) => k.id === id)
  const request = {
    company: COMPANY,
    topic: ep.topic,
    roles: Object.fromEntries((Object.keys(cast) as Role[]).map((r) => [r, `${cast[r].name} — ${cast[r].persona}`])),
    scenes: Object.values(ep.scenes)
      .filter((s) => !s.variants?.length)
      .map((s) => {
        const k = knowledge(s.knowledgeRefs?.[0] ?? s.outcome?.citations[0])
        return {
          id: s.id,
          kind: s.kind,
          act: s.act,
          knowledge: k && { rule: k.rule, commonMistake: k.commonMistake, consequence: k.consequence, edgeCases: k.edgeCases, recommended: k.recommended },
          draft: {
            title: s.title,
            dialogue: s.dialogue.map((d) => ({ speaker: roleOf[d.characterId] ?? 'player', line: d.line })),
            choices: s.choices?.map((c) => ({ id: c.id, quality: c.quality, text: c.text })),
            banner: s.outcome?.banner,
            lesson: s.outcome?.lesson,
            shotPrompt: s.shot.prompt,
          },
        }
      }),
  }
  const raw = await complete({
    system: SCRIPT_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(request) }],
    maxTokens: 8000,
    temperature: 0.8,
  })
  return JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''))
}

/* -------------------------------------------------------------- pipeline */

export type GenStage = 'select' | 'cast' | 'graph' | 'script' | 'validate'

export const GEN_STAGES: { id: GenStage; label: string }[] = [
  { id: 'select', label: 'SELECT KNOWLEDGE' },
  { id: 'cast', label: 'CAST ROLES' },
  { id: 'graph', label: 'BUILD GRAPH + SHOT SPECS' },
  { id: 'script', label: 'WRITE SCRIPT' },
  { id: 'validate', label: 'VALIDATE' },
]

export interface GenerateInput {
  topic: TopicDef
  groupId: string
  mastery: Record<ConceptId, Mastery>
  corpus?: KnowledgeItem[]
  onStage?: (stage: GenStage, detail: string) => void
  /** Pause between stages so the pipeline is watchable. 0 in tests. */
  paceMs?: number
}

export interface GenerateResult {
  episode: Episode
  report: GraphReport
  source: 'llm' | 'local'
  plan: EpisodePlan
  roles: Cast
  /** Honest notes for the author: a discarded script, a fallback, and why. */
  notes: string[]
}

export async function generateEpisode(input: GenerateInput): Promise<GenerateResult> {
  const pace = () => (input.paceMs ? new Promise((r) => setTimeout(r, input.paceMs)) : Promise.resolve())
  const notes: string[] = []

  const items = selectKnowledge(input.topic, input.corpus ?? knowledgeBase)
  input.onStage?.('select', `${items.length} rules cover ${input.topic.label}`)
  if (items.length < MIN_RULES) throw new TopicNotCovered(input.topic.label, items)
  await pace()

  const group = getGroup(input.groupId)
  const castChars = groupCast(group)
  const roles = assignRoles(castChars)
  input.onStage?.('cast', (Object.keys(roles) as Role[]).map((r) => `${firstName(roles[r])} → ${r}`).join(' · '))
  await pace()

  const plan = planEpisode(items, input.topic, input.mastery)
  const local = buildEpisode({ plan, topic: input.topic, groupId: group.id, cast: roles, castIds: castChars.map((c) => c.id), generator: 'local' })
  input.onStage?.(
    'graph',
    `${Object.keys(local.scenes).length} scenes · act three targets ${plan.targets.map((c) => conceptLabel(c).toLowerCase()).join(', ')}`,
  )
  await pace()

  let episode = local
  let source: 'llm' | 'local' = 'local'
  if (isLive()) {
    input.onStage?.('script', `writing with ${llmLabel()}`)
    try {
      const speakers: Record<string, string> = { player: 'you' }
      for (const r of Object.keys(roles) as Role[]) speakers[r] = roles[r].id
      const scripted = applyScript({ ...local, provenance: { ...local.provenance!, generator: 'llm', model: llmLabel() } }, await writeScript(local, roles), speakers)
      const check = validateEpisode(scripted)
      if (check.ok) {
        episode = scripted
        source = 'llm'
      } else {
        notes.push(`Model script discarded — it broke ${check.errors.length} graph rule(s), first: ${check.errors[0].sceneId}: ${check.errors[0].message}`)
      }
    } catch (e) {
      if (!(e instanceof LLMUnavailable) && !(e instanceof SyntaxError)) throw e
      notes.push(`Model script unavailable (${(e as Error).message.slice(0, 80)}) — deterministic composer used.`)
    }
  } else {
    input.onStage?.('script', 'no model configured — deterministic composer')
  }
  await pace()

  const report = validateEpisode(episode)
  input.onStage?.('validate', report.ok ? `${report.reachable}/${report.total} reachable · 1 ending · all citations resolve` : `${report.errors.length} errors`)
  return { episode, report, source, plan, roles, notes }
}

/**
 * The adaptive loop closing: pick the topic that covers the player's weakest
 * concept and generate for their current mastery.
 */
export function topicForWeakness(focus: ConceptId[]): TopicDef {
  const weakest = focus[0]
  return (
    TOPICS.filter((t) => t.concepts.includes(weakest)).sort((a, b) => a.concepts.length - b.concepts.length)[0] ?? {
      id: slug(conceptLabel(weakest)),
      label: conceptLabel(weakest),
      blurb: 'Targeted at your weakest area',
      concepts: [weakest],
      query: conceptLabel(weakest),
    }
  )
}
