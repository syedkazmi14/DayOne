import type { ShopItem } from '@/types'
import { BadgeMark } from '../ui/BadgeMark'
import { CollectibleArt } from '../ui/CollectibleArt'
import { ProfileAvatar } from '../ui/ProfileAvatar'

/** What the item looks like on you. Fills a positioned, sized parent. */
export function ItemPreview({ item, playerName, large = false }: { item: ShopItem; playerName: string; large?: boolean }) {
  if (item.type === 'character') return <CollectibleArt item={item} />

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-ink-800">
      {item.type === 'border' && <ProfileAvatar name={playerName} borderId={item.id} size={large ? 104 : 76} />}
      {item.type === 'badge' && <BadgeMark id={item.id} image={item.image} size={large ? 84 : 64} />}
      {item.type === 'title' && (
        <div className="px-6 text-center">
          <div className={`font-sans font-semibold tracking-[-0.015em] text-bone ${large ? 'text-[22px]' : 'text-[17px]'}`}>
            {playerName}
          </div>
          <div className={`mt-1 font-sans font-medium text-signal ${large ? 'text-[15px]' : 'text-[13.5px]'}`}>
            {item.name}
          </div>
        </div>
      )}
    </div>
  )
}
