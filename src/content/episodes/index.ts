import type { Episode, ShotSpec } from '@/types'

const poster = (env: ShotSpec['env'], time: ShotSpec['time'], mood: ShotSpec['mood'], prompt: string): ShotSpec => ({ env, time, mood, prompt })
import { firstDay } from './firstDay'

/** Locked episodes are authored stubs — enough for the shelf, no graph yet. */
const theClient: Episode = {
  id: 'ep02',
  number: 2,
  code: 'EPISODE 02',
  title: 'THE CLIENT',
  subtitle: 'They want the data today. Legal wants it never.',
  topic: 'Data Handling',
  duration: '7–9 min',
  locked: true,
  synopsis: 'A customer escalation, a spreadsheet that should not exist, and three people who each think someone else approved it.',
  concepts: ['data_handling', 'approved_tools', 'incident_reporting'],
  cast: ['noor', 'vera', 'dex'],
  entrySceneId: '',
  poster: poster('open_office', 'dusk', 'tense', 'Operations floor at dusk, escalation on every screen, a lead standing at a desk that is not hers.'),
  beats: [],
  scenes: {},
}

const theDeadline: Episode = {
  id: 'ep03',
  number: 3,
  code: 'EPISODE 03',
  title: 'THE DEADLINE',
  subtitle: 'Everyone is tired and the shortcut is right there.',
  topic: 'Communication',
  duration: '6–8 min',
  locked: true,
  synopsis: 'Ship date in nine hours. Every safe path costs time you do not have. Who do you tell, and when?',
  concepts: ['incident_reporting', 'social_engineering', 'physical_security'],
  cast: ['dex', 'milo', 'vera'],
  entrySceneId: '',
  poster: poster('night_office', 'night', 'tense', 'Nine hours to ship. One fluorescent tube, two people, a stairwell conversation nobody wants to have.'),
  beats: [],
  scenes: {},
}

export const episodes: Episode[] = [firstDay, theClient, theDeadline]
export const getEpisode = (id: string) => episodes.find((e) => e.id === id)
export { firstDay }
