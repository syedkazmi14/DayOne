import { getEarnedBadge, getShopItem } from '@/content/shop'
import type { Cosmetics, DecisionRecord, PlayerState } from '@/types'

/* ============================================================================
 * COSMETICS — pure transitions over PlayerState. Every function returns the
 * player unchanged when the move is not allowed, so the reducer never has to
 * guard and a stale click can never double-charge.
 * ========================================================================== */

export const MAX_EQUIPPED_BADGES = 3

export const freshCosmetics = (): Cosmetics => ({
  ownedItems: [],
  earnedBadges: [],
  equippedBorder: null,
  equippedTitle: null,
  equippedBadges: [],
  showcaseCharacter: null,
})

export const owns = (c: Cosmetics, id: string) => c.ownedItems.includes(id) || c.earnedBadges.includes(id)

export function isEquipped(c: Cosmetics, id: string): boolean {
  return c.equippedBorder === id || c.equippedTitle === id || c.showcaseCharacter === id || c.equippedBadges.includes(id)
}

export function purchase(player: PlayerState, itemId: string): PlayerState {
  const item = getShopItem(itemId)
  if (!item || owns(player.cosmetics, item.id) || player.credits < item.price) return player
  return {
    ...player,
    credits: player.credits - item.price,
    cosmetics: { ...player.cosmetics, ownedItems: [...player.cosmetics.ownedItems, item.id] },
  }
}

export function equip(player: PlayerState, itemId: string): PlayerState {
  const c = player.cosmetics
  if (!owns(c, itemId)) return player
  const type = getShopItem(itemId)?.type ?? (getEarnedBadge(itemId) ? 'badge' : undefined)

  let next: Cosmetics
  switch (type) {
    case 'border':
      next = { ...c, equippedBorder: itemId }
      break
    case 'title':
      next = { ...c, equippedTitle: itemId }
      break
    case 'character':
      next = { ...c, showcaseCharacter: itemId }
      break
    case 'badge':
      if (c.equippedBadges.includes(itemId) || c.equippedBadges.length >= MAX_EQUIPPED_BADGES) return player
      next = { ...c, equippedBadges: [...c.equippedBadges, itemId] }
      break
    default:
      return player
  }
  return { ...player, cosmetics: next }
}

export function unequip(player: PlayerState, itemId: string): PlayerState {
  const c = player.cosmetics
  if (!isEquipped(c, itemId)) return player
  return {
    ...player,
    cosmetics: {
      ...c,
      equippedBorder: c.equippedBorder === itemId ? null : c.equippedBorder,
      equippedTitle: c.equippedTitle === itemId ? null : c.equippedTitle,
      showcaseCharacter: c.showcaseCharacter === itemId ? null : c.showcaseCharacter,
      equippedBadges: c.equippedBadges.filter((b) => b !== itemId),
    },
  }
}

function award(player: PlayerState, ids: string[]): PlayerState {
  const fresh = ids.filter((id) => !player.cosmetics.earnedBadges.includes(id))
  if (!fresh.length) return player
  return { ...player, cosmetics: { ...player.cosmetics, earnedBadges: [...player.cosmetics.earnedBadges, ...fresh] } }
}

/** Badges a single settled decision can earn. */
export function awardForDecision(player: PlayerState, record: DecisionRecord): PlayerState {
  const w = record.wager
  if (!w?.won) return player
  return award(player, [w.tier === 'safe' ? 'lucky-guess' : 'high-roller'])
}

/** Badges a finished episode can earn. */
export function awardForEpisode(player: PlayerState, decisions: DecisionRecord[]): PlayerState {
  const ids = ['first-week']
  const wagers = decisions.flatMap((d) => (d.wager ? [d.wager] : []))
  if (wagers.length > 0 && wagers.every((w) => w.payout >= w.staked)) ids.push('perfect-episode')
  if (decisions.length > 0 && decisions.every((d) => d.quality === 'best')) ids.push('no-warnings')
  return award(player, ids)
}
