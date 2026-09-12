import { useState } from 'react'
import { getGroup } from '@/content/characterGroups'
import type { ShopItem } from '@/types'

/* Character collectible art. Fills its positioned parent. Until an item has an
 * `image` (or if that image fails), it renders a placeholder that says so
 * plainly, rather than borrowing some other character's artwork. */

const monogram = (name: string) =>
  name
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .filter((w) => /^[A-Z]/.test(w))
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')

export function CollectibleArt({ item }: { item: ShopItem }) {
  const [failed, setFailed] = useState(false)
  const accent = getGroup(item.show).accent

  if (item.image && !failed)
    return (
      <img
        src={item.image}
        alt={item.name}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={() => setFailed(true)}
        className="drag-none absolute inset-0 h-full w-full object-cover"
      />
    )

  return (
    <div className="absolute inset-0 bg-ink-800">
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(120% 90% at 50% 20%, ${accent}1F, transparent 65%)` }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="t-display select-none text-[64px]" style={{ color: `${accent}40` }}>
          {monogram(item.name)}
        </span>
      </div>
      <span className="t-eyebrow absolute bottom-3 left-3">Placeholder art</span>
    </div>
  )
}
