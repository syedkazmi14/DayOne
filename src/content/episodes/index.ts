import type { Episode, ImageSpec, ShotSpec } from '@/types'
import { firstDay } from './firstDay'

/* ============================================================================
 * EPISODE LIBRARY
 *
 * One flat array, each entry tagged with the roster `groupId` it belongs to.
 * The home-screen shelf renders `episodesForGroup(selectedGroup)` — so adding
 * a group's episodes is a data change here and nothing else.
 *
 * `image` is the still shown behind the episode title on the shelf card and on
 * the intro screen. It is deliberately just a path: change it and the UI
 * follows. When it is absent (or fails to load) the procedural cinematic
 * renderer draws `poster`/`shot` instead, so the shelf never has a hole in it.
 *
 * Locked episodes are authored stubs — enough for the shelf, no scene graph
 * yet. That is the same pattern the two original locked episodes used.
 * ========================================================================== */

const poster = (env: ShotSpec['env'], time: ShotSpec['time'], mood: ShotSpec['mood'], prompt: string): ShotSpec => ({
  env,
  time,
  mood,
  prompt,
})

const still = (id: string, alt: string, focus = '50% 40%'): ImageSpec => ({
  src: `/episodes/${id}.jpg`,
  alt,
  focus,
  credit: 'community wiki · prototype use only',
})

/** Every locked episode shares the same shape; only the copy differs. */
interface StubInput {
  id: string
  number: number
  groupId: string
  title: string
  subtitle: string
  topic: Episode['topic']
  duration: string
  synopsis: string
  concepts: Episode['concepts']
  cast: string[]
  poster: ShotSpec
}

const stub = (e: StubInput): Episode => ({
  ...e,
  code: `EPISODE ${String(e.number).padStart(2, '0')}`,
  locked: true,
  entrySceneId: '',
  image: still(e.id, e.title),
  beats: [],
  scenes: {},
})

/* ------------------------------------------------------------ Rick and Morty */

const rmEpisodes: Episode[] = [
  firstDay,
  stub({
    id: 'rm-ep02',
    number: 2,
    groupId: 'rick-and-morty',
    title: 'THE CLIENT',
    subtitle: 'They want the data today. Legal wants it never.',
    topic: 'Data Handling',
    duration: '7–9 min',
    synopsis:
      'A customer escalation, a spreadsheet that should not exist, and three people who each think someone else approved it.',
    concepts: ['data_handling', 'approved_tools', 'incident_reporting'],
    cast: ['jerry', 'summer', 'rick'],
    poster: poster(
      'open_office',
      'dusk',
      'tense',
      'Operations floor at dusk, escalation on every screen, a lead standing at a desk that is not his.',
    ),
  }),
  stub({
    id: 'rm-ep03',
    number: 3,
    groupId: 'rick-and-morty',
    title: 'THE DEADLINE',
    subtitle: 'Everyone is tired and the shortcut is right there.',
    topic: 'Communication',
    duration: '6–8 min',
    synopsis: 'Ship date in nine hours. Every safe path costs time you do not have. Who do you tell, and when?',
    concepts: ['incident_reporting', 'social_engineering', 'physical_security'],
    cast: ['rick', 'morty', 'summer'],
    poster: poster(
      'night_office',
      'night',
      'tense',
      'Nine hours to ship. One fluorescent tube, two people, a stairwell conversation nobody wants to have.',
    ),
  }),
]

/* ---------------------------------------------------------------- South Park */

const spEpisodes: Episode[] = [
  stub({
    id: 'sp-ep01',
    number: 1,
    groupId: 'south-park',
    title: 'THE GROUP CHAT',
    subtitle: 'It started as a joke. It is now discoverable.',
    topic: 'Communication',
    duration: '6–8 min',
    synopsis:
      'A side channel nobody declared, a screenshot that leaves the building, and four people arguing about who is technically at fault.',
    concepts: ['data_handling', 'approved_tools', 'incident_reporting'],
    cast: ['cartman', 'stan', 'kyle', 'kenny'],
    poster: poster('open_office', 'midday', 'tense', 'Four desks, four phones, one conversation that should have been an email.'),
  }),
  stub({
    id: 'sp-ep02',
    number: 2,
    groupId: 'south-park',
    title: 'THE SIDE DOOR',
    subtitle: 'Someone propped it open. Everyone uses it now.',
    topic: 'Physical Security',
    duration: '5–7 min',
    synopsis: 'A badge reader that has been broken for three weeks, and the very reasonable reasons nobody reported it.',
    concepts: ['physical_security', 'incident_reporting', 'social_engineering'],
    cast: ['kenny', 'kyle', 'cartman', 'stan'],
    poster: poster('corridor', 'morning', 'neutral', 'A service corridor, a fire door held open with a folded coffee cup.'),
  }),
  stub({
    id: 'sp-ep03',
    number: 3,
    groupId: 'south-park',
    title: 'THE FREE TIER',
    subtitle: 'It was free, so nobody asked.',
    topic: 'Approved Tools',
    duration: '7–9 min',
    synopsis:
      'A tool the whole team adopted in an afternoon, and the data processing agreement that does not exist for it.',
    concepts: ['approved_tools', 'data_handling', 'password_security'],
    cast: ['cartman', 'kyle', 'stan', 'kenny'],
    poster: poster('desk', 'midday', 'neutral', 'A signup screen, a company email address, and a checkbox nobody read.'),
  }),
]

/* ---------------------------------------------------------------- Family Guy */

const fgEpisodes: Episode[] = [
  stub({
    id: 'fg-ep01',
    number: 1,
    groupId: 'family-guy',
    title: 'THE CONFIDENT ANSWER',
    subtitle: 'He was sure. He was also wrong.',
    topic: 'Social Engineering',
    duration: '6–8 min',
    synopsis:
      'Somebody on the phone knows three true things about the company, which is exactly enough to be believed about a fourth.',
    concepts: ['social_engineering', 'password_security', 'incident_reporting'],
    cast: ['peter', 'stewie', 'brian', 'lois'],
    poster: poster('desk', 'morning', 'tense', 'A desk phone on speaker, a caller who knows your manager’s name.'),
  }),
  stub({
    id: 'fg-ep02',
    number: 2,
    groupId: 'family-guy',
    title: 'THE ESCALATION',
    subtitle: 'The customer is on hold. The policy is in another tab.',
    topic: 'Data Handling',
    duration: '7–9 min',
    synopsis: 'An escalation clock, a records request, and the identity check that takes ninety seconds nobody has.',
    concepts: ['data_handling', 'incident_reporting', 'approved_tools'],
    cast: ['lois', 'brian', 'peter', 'stewie'],
    poster: poster('open_office', 'midday', 'tense', 'An escalations desk, three screens of queue, one very polite request.'),
  }),
  stub({
    id: 'fg-ep03',
    number: 3,
    groupId: 'family-guy',
    title: 'THE CLEVER PLAN',
    subtitle: 'A brilliant workaround with one logged side effect.',
    topic: 'Approved Tools',
    duration: '6–8 min',
    synopsis:
      'An elegant piece of automation that quietly moves production data somewhere the audit trail cannot follow it.',
    concepts: ['approved_tools', 'data_handling', 'password_security'],
    cast: ['stewie', 'brian', 'peter', 'lois'],
    poster: poster('server_room', 'night', 'alarm', 'A rack, a laptop balanced on it, and a script with nobody’s name on it.'),
  }),
]

/* --------------------------------------------------------------- Simpsons */

const siEpisodes: Episode[] = [
  stub({
    id: 'si-ep01',
    number: 1,
    groupId: 'the-simpsons',
    title: 'SECTOR 7-G',
    subtitle: 'The safety inspector has not read the safety material.',
    topic: 'Physical Security',
    duration: '6–8 min',
    synopsis:
      'A walkthrough of a floor where every control has a very practical reason it was disabled, and one of them matters today.',
    concepts: ['physical_security', 'incident_reporting', 'social_engineering'],
    cast: ['homer', 'marge', 'lisa', 'bart'],
    poster: poster('corridor', 'morning', 'neutral', 'A control room, a clipboard, and a warning light nobody can remember the meaning of.'),
  }),
  stub({
    id: 'si-ep02',
    number: 2,
    groupId: 'the-simpsons',
    title: 'THE INTERN',
    subtitle: 'He found the gap in about a day and a half.',
    topic: 'Password Security',
    duration: '5–7 min',
    synopsis: 'A shared login that predates everyone, and the week it takes to work out whose name is on what.',
    concepts: ['password_security', 'approved_tools', 'incident_reporting'],
    cast: ['bart', 'lisa', 'marge', 'homer'],
    poster: poster('desk', 'midday', 'neutral', 'A sticky note under a keyboard, photographed by someone who found it funny.'),
  }),
  stub({
    id: 'si-ep03',
    number: 3,
    groupId: 'the-simpsons',
    title: 'THE ANNOTATED HANDBOOK',
    subtitle: 'Someone actually read it, and has questions.',
    topic: 'Cybersecurity',
    duration: '7–9 min',
    synopsis:
      'The graduate analyst walks the floor with a marked-up copy of the standard and finds four things that stopped being true.',
    concepts: ['incident_reporting', 'data_handling', 'phishing'],
    cast: ['lisa', 'marge', 'homer', 'bart'],
    poster: poster('open_office', 'dusk', 'calm', 'A printed policy covered in annotations, laid across two desks at end of day.'),
  }),
]

/* --------------------------------------------------------------------- api */

export const episodes: Episode[] = [...rmEpisodes, ...spEpisodes, ...fgEpisodes, ...siEpisodes]

export const getEpisode = (id: string) => episodes.find((e) => e.id === id)

/** Shelf contents for one roster group, in authored order. */
export const episodesForGroup = (groupId: string) => episodes.filter((e) => e.groupId === groupId)

/**
 * The episode the group's hero should feature: the first playable one, or the
 * first stub if the group has no graph authored yet.
 */
export const featuredEpisode = (groupId: string): Episode | undefined => {
  const list = episodesForGroup(groupId)
  return list.find((e) => !e.locked) ?? list[0]
}

export { firstDay }
