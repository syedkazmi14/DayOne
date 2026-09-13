import type { ComponentType } from 'react'
import type { Episode } from '@/types'

/** What every status bar design is handed. Designs draw; they never compute progress. */
export interface StatusBarProps {
  /** 0–1, from episodeProgress(). */
  progress: number
  episode: Episode
  currentAct: number
  /** Narrow viewports. */
  compact: boolean
}

export type StatusBarDesign = ComponentType<StatusBarProps>
