import type { Episode } from '@/types'
import { firstDay } from './firstDay'

/* ============================================================================
 * EPISODE LIBRARY — the hand-authored episodes.
 *
 * Every show plays the same lineup; the show only decides the cast. These are
 * the authored episodes in that lineup, each written once for one show and
 * recast for the others at play time (src/engine/recast.ts). Topics an admin
 * builds in the Studio join them when published (src/engine/lineup.ts).
 *
 * `image` is a path under public/episodes; a recast swaps the show prefix, so
 * First Day wears each show's own key art.
 * ========================================================================== */

export const episodes: Episode[] = [firstDay]

export const getEpisode = (id: string) => episodes.find((e) => e.id === id)

export { firstDay }
