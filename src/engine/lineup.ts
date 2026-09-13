import { episodes as authored } from '@/content/episodes'
import { getGroup } from '@/content/characterGroups'
import type { ConceptId, Episode } from '@/types'
import { recastEpisode } from './recast'

/* ============================================================================
 * LINEUP — what an employee can play.
 *
 * Every show has the same lineup: the authored episodes, then every topic an
 * admin has published from the Studio, in publish order. Picking a show only
 * decides who is in them — each entry is recast into that show. Drafts are the
 * admin's and never appear here.
 * ========================================================================== */

export interface LineupEntry {
  episode: Episode
  /** Position in the lineup — the "Episode 02" an employee sees. */
  number: number
  /** Built by an admin in the Studio rather than hand-authored. */
  generated: boolean
}

export function lineupFor(groupId: string | null | undefined, published: Record<string, Episode>): LineupEntry[] {
  const show = getGroup(groupId).id
  const live = Object.values(published).filter((e) => e.provenance?.status === 'published')
  return [...authored, ...live].map((ep, i) => ({
    episode: recastEpisode(ep, show),
    number: i + 1,
    generated: !!ep.provenance,
  }))
}

/**
 * The adaptive loop, closed without letting an employee generate anything:
 * the lineup entry that best covers the weakest concepts (weighted by rank),
 * preferring episodes not yet completed. Never the episode just played.
 */
export function recommendNext(
  lineup: LineupEntry[],
  focus: ConceptId[],
  currentId?: string | null,
  completed: string[] = [],
): { entry: LineupEntry; covers: ConceptId[] } | null {
  const ranked = lineup
    .filter((e) => e.episode.id !== currentId)
    .map((entry, i) => ({
      entry,
      i,
      covers: focus.filter((c) => entry.episode.concepts.includes(c)),
      weight: focus.reduce((s, c, rank) => s + (entry.episode.concepts.includes(c) ? focus.length - rank : 0), 0),
      done: completed.includes(entry.episode.id),
    }))
    .sort((a, b) => b.weight - a.weight || Number(a.done) - Number(b.done) || a.i - b.i)
  return ranked.length ? { entry: ranked[0].entry, covers: ranked[0].covers } : null
}
