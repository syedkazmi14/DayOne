import type { Character, SpeechArchetype } from '@/types'

/* ============================================================================
 * CAST ROLES — what lets one episode play in every show.
 *
 * An episode is written for four ROLES, not four characters: the mentor who
 * explains the why, the one pushing the shortcut, the peer sharing the risk,
 * and the manager who owns the deadline. Each show fills those roles from its
 * own cast by speech archetype, so the same graph is recast per show
 * (src/engine/recast.ts) without touching its scenes, choices or scoring.
 * ========================================================================== */

export type Role = 'mentor' | 'pressure' | 'peer' | 'manager'

export const ROLES: Role[] = ['mentor', 'pressure', 'peer', 'manager']

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

/** Fill the four roles from a show's cast. A missing archetype takes the next unassigned character. */
export function assignRoles(cast: Character[]): Record<Role, Character> {
  const pool = [...cast]
  const out = {} as Record<Role, Character>
  for (const role of ROLES) {
    const i = pool.findIndex((c) => c.speechArchetype === ROLE_ARCHETYPE[role])
    out[role] = pool.splice(i >= 0 ? i : 0, 1)[0] ?? cast[0]
  }
  return out
}

/** Pronouns the recast follows when a role changes gender between shows. */
export const PRONOUN: Record<string, 'he' | 'she'> = {
  rick: 'he',
  morty: 'he',
  summer: 'she',
  jerry: 'he',
  cartman: 'he',
  stan: 'he',
  kyle: 'he',
  kenny: 'he',
  peter: 'he',
  stewie: 'he',
  brian: 'he',
  lois: 'she',
  homer: 'he',
  bart: 'he',
  marge: 'she',
  lisa: 'she',
}

/** What the rest of the cast calls someone. Usually the first name — not always. */
const CALL_NAME: Record<string, string> = { cartman: 'Cartman' }

export const callName = (c: Pick<Character, 'id' | 'name'>): string => {
  if (CALL_NAME[c.id]) return CALL_NAME[c.id]
  const w = c.name.split(' ')[0]
  return w.charAt(0) + w.slice(1).toLowerCase()
}

/** Each show's key-art prefix under public/episodes (rm-ep01.jpg, sp-ep01.jpg, …). */
export const SHOW_ART: Record<string, string> = {
  'rick-and-morty': 'rm',
  'south-park': 'sp',
  'family-guy': 'fg',
  'the-simpsons': 'si',
}
