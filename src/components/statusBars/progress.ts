import type { Episode } from '@/types'

/**
 * How far through the episode the player is, 0–1, from the act they are in.
 * Every status bar design reads this one number, so a new design never has to
 * re-derive progress. Being inside act n of N counts as n/N: the first act
 * shows a short stretch, the final act shows the whole thing.
 */
export function episodeProgress(episode: Episode, currentAct: number): number {
  const total = episode.beats.length
  if (!total) return 0
  const reached = episode.beats.filter((b) => b.act <= currentAct).length
  return Math.min(1, Math.max(0, reached / total))
}
