import { Film, Image as ImageIcon, Shapes } from 'lucide-react'
import { visualTierOf } from '@/media/assetPlan'
import type { SceneAssets } from '@/types'

/* ============================================================================
 * Which visual tier the player is looking at, stated plainly. A procedural
 * previs is never allowed to pass for generated video.
 * ========================================================================== */

export function AssetTierBadge({ assets, className = '' }: { assets?: SceneAssets; className?: string }) {
  const tier = visualTierOf(assets)
  const look =
    tier === 'ai-video'
      ? { Icon: Film, label: `AI video · ${assets!.video!.provider}`, tone: 'border-good/35 text-good' }
      : tier === 'ai-background'
        ? { Icon: ImageIcon, label: `AI background · ${assets!.background!.provider}`, tone: 'border-cyan/35 text-cyan' }
        : { Icon: Shapes, label: 'procedural previs · not AI-generated', tone: 'border-bone/15 text-bone-faint' }
  return (
    <span
      data-visual-tier={tier}
      className={`inline-flex max-w-full items-center gap-1.5 rounded border bg-ink-900/50 px-2 py-[3px] font-mono text-[8.5px] uppercase tracking-[0.14em] backdrop-blur ${look.tone} ${className}`}
    >
      <look.Icon size={10} className="shrink-0" />
      <span className="truncate">{look.label}</span>
    </span>
  )
}
