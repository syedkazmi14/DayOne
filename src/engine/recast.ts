import { assignRoles, callName, PRONOUN, ROLES, SHOW_ART } from '@/content/castRoles'
import { getGroup, groupCast } from '@/content/characterGroups'
import { getCharacter } from '@/content/characters'
import type { Episode, Scene } from '@/types'

/* ============================================================================
 * RECAST — one episode, every show.
 *
 * An episode is authored once with one show's cast. When an employee picks a
 * different show, each character is replaced by whoever fills the same role in
 * that show (src/content/castRoles.ts): the lines move to the new speaker, names
 * in every piece of text follow, and pronouns follow where a role changes gender.
 *
 * What never changes: scene ids, choices, which option is strong, consequence
 * targets, citations, scoring, the adaptive act. The recast is a pure function
 * of (episode, show), memoised, so the reducer plays the same deterministic
 * graph whichever cast is saying the words. The original show gets the
 * original object back, untouched — First Day stays hand-written for Rick and
 * Morty.
 * ========================================================================== */

type Gender = 'he' | 'she'

/** Source character id -> the character filling the same role in the target show. */
export function castMapping(sourceGroupId: string, targetGroupId: string): Record<string, string> {
  const from = assignRoles(groupCast(getGroup(sourceGroupId)))
  const to = assignRoles(groupCast(getGroup(targetGroupId)))
  return Object.fromEntries(ROLES.map((r) => [from[r].id, to[r].id]))
}

/* ------------------------------------------------------------------- names */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const titleCase = (s: string) =>
  s
    .split(' ')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')

/** Every way a character is written: "RICK SANCHEZ", "Rick Sanchez", "Rick", "RICK". */
const nameForms = (id: string) => {
  const ch = getCharacter(id)
  const call = callName(ch)
  return [ch.name, titleCase(ch.name), call, call.toUpperCase()]
}

/** One simultaneous substitution, so Rick -> Peter can never chain into Peter -> anyone else. */
function namer(map: Record<string, string>) {
  const to = new Map<string, string>()
  const who = new Map<string, string>()
  for (const [src, dst] of Object.entries(map)) {
    const a = nameForms(src)
    const b = nameForms(dst)
    a.forEach((form, i) => {
      to.set(form, b[i])
      who.set(form, src)
    })
  }
  const alternation = [...to.keys()].sort((x, y) => y.length - x.length).map(escapeRe).join('|')
  const re = new RegExp(`(?<![A-Za-z])(${alternation})(?![A-Za-z])`, 'g')
  return {
    rename: (t: string) => t.replace(re, (m) => to.get(m) ?? m),
    /** Source ids named in a piece of text. */
    mentioned: (t: string) => [...new Set([...t.matchAll(re)].map((m) => who.get(m[1])!))],
  }
}

/* ---------------------------------------------------------------- pronouns */

/** Words after "her" that mark it as an object ("ask her anything") rather than possessive ("her meeting"). */
const OBJECT_NEXT = new Set([
  'anything', 'something', 'if', 'to', 'a', 'an', 'the', 'that', 'this', 'what', 'why', 'how', 'about', 'and', 'or',
  'because', 'for', 'on', 'in', 'at', 'with', 'too', 'again', 'back', 'out', 'up', 'down', 'off', 'now', 'first',
  'so', 'but', 'know', 'whether', 'before', 'after', 'when', 'where', 'who', 'it', 'directly',
])

const keepCase = (src: string, word: string) =>
  src.length > 1 && src === src.toUpperCase()
    ? word.toUpperCase()
    : src[0] === src[0].toUpperCase()
      ? word[0].toUpperCase() + word.slice(1)
      : word

const toHe = (s: string) =>
  s.replace(/\b(herself|hers|her|she)\b(\s*)([A-Za-z]*)/gi, (_m, p: string, gap: string, next: string) => {
    const w = p.toLowerCase()
    const rep =
      w === 'she' ? 'he' : w === 'herself' ? 'himself' : w === 'hers' ? 'his' : !next || OBJECT_NEXT.has(next.toLowerCase()) ? 'him' : 'his'
    return keepCase(p, rep) + gap + next
  })

const SHE: Record<string, string> = { himself: 'herself', him: 'her', his: 'her', he: 'she' }
const toShe = (s: string) => s.replace(/\b(himself|him|his|he)\b/gi, (p) => keepCase(p, SHE[p.toLowerCase()]))

/**
 * Rewrite pronouns sentence by sentence, for whichever character the sentence
 * is about: the one it names, else the one the previous sentence named, else
 * `about` (the speaker of a stage direction, the partner of a chat hook).
 * Only characters whose role changes gender are touched.
 */
function regender(
  text: string,
  about: string | null,
  names: ReturnType<typeof namer>,
  swaps: Record<string, Gender>,
): string {
  let subject = about
  return text
    .split(/((?<=[.!?…"”])\s+)/)
    .map((seg, i) => {
      if (i % 2 === 1) return seg
      const named = names.mentioned(seg)
      if (named.length === 1) subject = named[0]
      else if (named.length > 1) subject = null
      const g = subject ? swaps[subject] : undefined
      return g === 'he' ? toHe(seg) : g === 'she' ? toShe(seg) : seg
    })
    .join('')
}

/* ------------------------------------------------------------------ recast */

const cache = new WeakMap<Episode, Map<string, Episode>>()

/**
 * The episode as it plays in `groupId`'s show. No show (an admin), or the
 * show it was written for, returns the episode itself.
 */
export function recastEpisode(ep: Episode, groupId: string | null | undefined): Episode {
  if (!groupId) return ep
  const target = getGroup(groupId).id
  if (target === ep.groupId) return ep

  let byShow = cache.get(ep)
  if (!byShow) cache.set(ep, (byShow = new Map()))
  const hit = byShow.get(target)
  if (hit) return hit

  const map = castMapping(ep.groupId, target)
  const who = (c: string) => map[c] ?? c
  const names = namer(map)
  const swaps: Record<string, Gender> = {}
  for (const [src, dst] of Object.entries(map)) {
    if (PRONOUN[src] && PRONOUN[dst] && PRONOUN[src] !== PRONOUN[dst]) swaps[src] = PRONOUN[dst]
  }
  const say = (t: string | undefined, about: string | null = null) =>
    t === undefined ? undefined : names.rename(regender(t, about, names, swaps))

  const scene = (s: Scene): Scene => ({
    ...s,
    title: say(s.title),
    subtitle: say(s.subtitle),
    prompt: say(s.prompt),
    chatHook: say(s.chatHook, s.chatWith?.[0] ?? null),
    chatWith: s.chatWith?.map(who),
    dialogue: s.dialogue.map((d) => ({
      ...d,
      characterId: who(d.characterId),
      line: say(d.line)!,
      direction: say(d.direction, d.characterId),
    })),
    choices: s.choices?.map((c) => ({ ...c, text: say(c.text)!, ledgerLabel: say(c.ledgerLabel)! })),
    outcome: s.outcome && { ...s.outcome, banner: say(s.outcome.banner)!, lesson: say(s.outcome.lesson)! },
    shot: { ...s.shot, prompt: say(s.shot.prompt)!, action: say(s.shot.action) },
    // This show's own world: its images and clips, or none (procedural previs) — never another
    // show's art. Pre-rendered lines were spoken in the original cast's voices; the new cast speaks live.
    assets: s.assets?.byShow?.[target] && { ...s.assets.byShow[target] },
  })

  const recast: Episode = {
    ...ep,
    groupId: target,
    title: say(ep.title)!,
    subtitle: say(ep.subtitle)!,
    synopsis: say(ep.synopsis)!,
    cast: ep.cast.map(who),
    image: ep.image && {
      ...ep.image,
      src: ep.image.src.replace(/\/episodes\/(rm|sp|fg|si)-/, `/episodes/${SHOW_ART[target] ?? 'rm'}-`),
      alt: say(ep.image.alt),
    },
    beats: ep.beats.map((b) => ({ ...b, label: say(b.label)! })),
    scenes: Object.fromEntries(Object.entries(ep.scenes).map(([k, s]) => [k, scene(s)])),
    provenance: ep.provenance && {
      ...ep.provenance,
      roles: Object.fromEntries(Object.entries(ep.provenance.roles).map(([c, role]) => [who(c), role])),
    },
  }
  byShow.set(target, recast)
  return recast
}
