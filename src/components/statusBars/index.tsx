import type { Episode } from '@/types'
import { ActRailBar } from './ActRailBar'
import { ChickenFightBar } from './ChickenFightBar'
import { PortalGunBar } from './PortalGunBar'
import { episodeProgress } from './progress'
import type { StatusBarDesign } from './types'

/* ============================================================================
 * The episode status bar. Progress is computed once, here; each show picks how
 * it is drawn. To give a show its own bar, add a design component that takes
 * StatusBarProps and register it below — the progress logic does not change.
 * ========================================================================== */

const DESIGNS: Record<string, StatusBarDesign> = {
  'rick-and-morty': PortalGunBar,
  'family-guy': ChickenFightBar,
}

export function statusBarFor(groupId: string | null | undefined): StatusBarDesign {
  return (groupId && DESIGNS[groupId]) || ActRailBar
}

export function EpisodeStatusBar({
  episode,
  currentAct,
  compact = false,
}: {
  episode: Episode
  currentAct: number
  compact?: boolean
}) {
  const progress = episodeProgress(episode, currentAct)
  const Design = statusBarFor(episode.groupId)
  const index = episode.beats.findIndex((b) => b.act === currentAct)
  const beat = episode.beats[index]

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={beat ? `Act ${index + 1} of ${episode.beats.length}: ${beat.label}` : undefined}
    >
      <Design progress={progress} episode={episode} currentAct={currentAct} compact={compact} />
    </div>
  )
}

export { episodeProgress } from './progress'
export type { StatusBarDesign, StatusBarProps } from './types'
