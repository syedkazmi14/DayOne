import { characters, getCharacter } from './characters'
import type { Character, CharacterGroup } from '@/types'

/* ============================================================================
 * ROSTER GROUPS — the home-screen carousel is a render of this array.
 *
 * Adding a group is adding an entry here plus its characters in
 * ./characters.ts and (optionally) episodes in ./episodes. The carousel, the
 * hero, the episode shelf and the voice preview all read from this data; none
 * of them know how many groups there are.
 * ========================================================================== */

export const characterGroups: CharacterGroup[] = [
  {
    id: 'rick-and-morty',
    name: 'Rick and Morty',
    tagline: 'A genius, a nervous wreck, and two people holding the household together.',
    accent: '#6FD3D8',
    characterIds: ['rick', 'morty', 'summer', 'jerry'],
  },
  {
    id: 'south-park',
    name: 'South Park',
    tagline: 'Four kids who will find the hole in any process you give them.',
    accent: '#FF7A1A',
    characterIds: ['cartman', 'stan', 'kyle', 'kenny'],
  },
  {
    id: 'family-guy',
    name: 'Family Guy',
    tagline: 'Total confidence, immaculate diction, and nobody reading the handbook.',
    accent: '#F5A524',
    characterIds: ['peter', 'stewie', 'brian', 'lois'],
  },
  {
    id: 'the-simpsons',
    name: 'The Simpsons',
    tagline: 'A safety inspector, an intern, and the two people who fix it afterwards.',
    accent: '#54D1A0',
    characterIds: ['homer', 'bart', 'marge', 'lisa'],
  },
]

export const DEFAULT_GROUP_ID = characterGroups[0].id

export const getGroup = (id: string | null | undefined): CharacterGroup =>
  characterGroups.find((g) => g.id === id) ?? characterGroups[0]

export const groupIndex = (id: string | null | undefined): number => {
  const i = characterGroups.findIndex((g) => g.id === id)
  return i === -1 ? 0 : i
}

/** Cast of a group, resolved and ordered. Missing ids are dropped, not thrown. */
export const groupCast = (group: CharacterGroup): Character[] =>
  group.characterIds.filter((id) => id in characters).map(getCharacter)

/** Which group a character belongs to — used to keep selection and shelf in sync. */
export const groupOfCharacter = (characterId: string): CharacterGroup =>
  getGroup(getCharacter(characterId).groupId)
