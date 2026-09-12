import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { getGroup } from '@/content/characterGroups'
import { TYPE_LABEL } from '@/content/shop'
import { isEquipped, MAX_EQUIPPED_BADGES, owns } from '@/engine/cosmetics'
import type { Cosmetics, EarnedBadge, ShopItem } from '@/types'
import { BadgeMark } from '../ui/BadgeMark'
import { Btn } from '../ui/Bits'
import { ItemPreview } from './ItemPreview'

const credits = (n: number) => `${n.toLocaleString()} credits`

function CardShell({
  preview,
  tall,
  name,
  category,
  status,
  description,
  footnote,
  actions,
}: {
  preview: ReactNode
  tall?: boolean
  name: string
  category: string
  status?: ReactNode
  description: string
  footnote?: ReactNode
  actions?: ReactNode
}) {
  return (
    <article className="flex h-full flex-col border border-bone/10 bg-ink-850 transition-colors duration-300 hover:border-bone/20">
      <div className={`relative overflow-hidden ${tall ? 'aspect-[4/5]' : 'aspect-[4/3]'}`}>{preview}</div>
      <div className="flex flex-1 flex-col border-t border-bone/8 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-sans text-[15px] font-medium tracking-[-0.01em] text-bone">{name}</h3>
            <p className="mt-0.5 font-sans text-[12.5px] text-bone-dim">{category}</p>
          </div>
          {status}
        </div>
        <p className="mt-2 font-sans text-[13px] font-light leading-snug text-bone-faint">{description}</p>
        <div className="mt-auto flex min-h-[36px] items-center justify-between gap-3 pt-4">
          <span className="font-sans text-[13px] tabular-nums text-bone">{footnote}</span>
          <div className="flex items-center gap-1">{actions}</div>
        </div>
      </div>
    </article>
  )
}

function Status({ equipped, label }: { equipped: boolean; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 font-sans text-[12px] ${equipped ? 'text-signal' : 'text-bone-dim'}`}
    >
      {equipped && <Check size={12} strokeWidth={2.25} />}
      {label}
    </span>
  )
}

/** Equip/unequip controls shared by bought and earned items. */
function WearControls({
  cosmetics,
  id,
  character,
  onEquip,
  onUnequip,
}: {
  cosmetics: Cosmetics
  id: string
  character: boolean
  onEquip: () => void
  onUnequip: () => void
}) {
  if (isEquipped(cosmetics, id))
    return (
      <Btn size="sm" variant="ghost" onClick={onUnequip}>
        {character ? 'Remove' : 'Unequip'}
      </Btn>
    )
  return (
    <Btn size="sm" variant="outline" onClick={onEquip}>
      {character ? 'Showcase' : 'Equip'}
    </Btn>
  )
}

export interface CardHandlers {
  onBuy: (item: ShopItem) => void
  onPreview: (item: ShopItem) => void
  onEquip: (id: string) => void
  onUnequip: (id: string) => void
}

export function ItemCard({
  item,
  cosmetics,
  balance,
  playerName,
  tall,
  onBuy,
  onPreview,
  onEquip,
  onUnequip,
}: {
  item: ShopItem
  cosmetics: Cosmetics
  balance: number
  playerName: string
  tall?: boolean
} & CardHandlers) {
  const owned = owns(cosmetics, item.id)
  const equipped = isEquipped(cosmetics, item.id)
  const character = item.type === 'character'
  const short = item.price - balance
  const slotsFull = item.type === 'badge' && !equipped && cosmetics.equippedBadges.length >= MAX_EQUIPPED_BADGES

  return (
    <CardShell
      tall={tall}
      preview={<ItemPreview item={item} playerName={playerName} />}
      name={item.name}
      category={character ? getGroup(item.show).name : TYPE_LABEL[item.type]}
      status={
        owned && <Status equipped={equipped} label={equipped ? (character ? 'Showcased' : 'Equipped') : 'Owned'} />
      }
      description={item.description}
      footnote={
        !owned ? (
          <>
            {credits(item.price)}
            {short > 0 && <span className="text-bone-faint"> · {short.toLocaleString()} short</span>}
          </>
        ) : slotsFull ? (
          <span className="text-bone-faint">{MAX_EQUIPPED_BADGES} badges worn</span>
        ) : null
      }
      actions={
        !owned ? (
          <>
            {item.type === 'border' && (
              <Btn size="sm" variant="ghost" onClick={() => onPreview(item)}>
                Preview
              </Btn>
            )}
            <Btn size="sm" onClick={() => onBuy(item)} disabled={short > 0}>
              Buy
            </Btn>
          </>
        ) : slotsFull ? (
          <Btn size="sm" variant="outline" disabled>
            Equip
          </Btn>
        ) : (
          <WearControls
            cosmetics={cosmetics}
            id={item.id}
            character={character}
            onEquip={() => onEquip(item.id)}
            onUnequip={() => onUnequip(item.id)}
          />
        )
      }
    />
  )
}

export function EarnedBadgeCard({
  badge,
  cosmetics,
  onEquip,
  onUnequip,
}: {
  badge: EarnedBadge
  cosmetics: Cosmetics
} & Pick<CardHandlers, 'onEquip' | 'onUnequip'>) {
  const earned = cosmetics.earnedBadges.includes(badge.id)
  const equipped = isEquipped(cosmetics, badge.id)
  const slotsFull = earned && !equipped && cosmetics.equippedBadges.length >= MAX_EQUIPPED_BADGES

  return (
    <CardShell
      preview={
        <div className="absolute inset-0 flex items-center justify-center bg-ink-800">
          <BadgeMark id={badge.id} size={64} dim={!earned} />
        </div>
      }
      name={badge.name}
      category="Earned badge"
      status={earned ? <Status equipped={equipped} label={equipped ? 'Equipped' : 'Earned'} /> : undefined}
      description={badge.description}
      footnote={
        !earned ? (
          <span className="text-bone-faint">Not for sale</span>
        ) : slotsFull ? (
          <span className="text-bone-faint">{MAX_EQUIPPED_BADGES} badges worn</span>
        ) : null
      }
      actions={
        !earned ? null : slotsFull ? (
          <Btn size="sm" variant="outline" disabled>
            Equip
          </Btn>
        ) : (
          <WearControls
            cosmetics={cosmetics}
            id={badge.id}
            character={false}
            onEquip={() => onEquip(badge.id)}
            onUnequip={() => onUnequip(badge.id)}
          />
        )
      }
    />
  )
}
