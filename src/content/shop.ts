import type { CosmeticType, EarnedBadge, ShopItem } from '@/types'

/* ============================================================================
 * SHOP CATALOGUE — cosmetic profile items, bought outright with earned credits.
 *
 * Fixed prices, no randomness, no stock limits, no timers. Nothing here feeds
 * the engine: a border or a showcase character never changes a score, a wager
 * or an adaptation.
 *
 * Character art: none of these side characters has artwork in the project yet,
 * so every card renders a labelled placeholder. To add art, drop the file in
 * public/collectibles/ and set `image` on the item.
 * ========================================================================== */

export const shopItems: ShopItem[] = [
  /* -------------------------------------------------------------- borders */
  {
    id: 'portal-frame',
    name: 'Portal Frame',
    type: 'border',
    price: 450,
    description: 'Smells faintly of ozone. Probably fine.',
    featured: true,
  },
  {
    id: 'plumbus-frame',
    name: 'Plumbus Frame',
    type: 'border',
    price: 400,
    description: 'Everyone has one. Nobody knows why.',
  },
  {
    id: 'interdimensional-static',
    name: 'Interdimensional Static',
    type: 'border',
    price: 600,
    description: 'Looks unstable. Probably fine.',
    isNew: true,
  },
  {
    id: 'chicken-fight-frame',
    name: 'Chicken Fight Frame',
    type: 'border',
    price: 550,
    description: 'Twelve minutes of property damage, framed.',
  },

  /* --------------------------------------------------------------- titles */
  {
    id: 'first-day-survivor',
    name: 'First Day Survivor',
    type: 'title',
    price: 150,
    description: 'Badge still works. Mostly.',
  },
  {
    id: 'risk-taker',
    name: 'Risk Taker',
    type: 'title',
    price: 200,
    description: 'Saw the wager screen and chose violence.',
  },
  {
    id: 'chaos-coordinator',
    name: 'Chaos Coordinator',
    type: 'title',
    price: 250,
    description: 'Somebody has to schedule it.',
    featured: true,
  },
  {
    id: 'policy-breaker',
    name: 'Policy Breaker',
    type: 'title',
    price: 300,
    description: 'Read the handbook. Disagreed.',
    isNew: true,
  },

  /* --------------------------------------------------------------- badges */
  {
    id: 'portal-badge',
    name: 'Portal Badge',
    type: 'badge',
    price: 250,
    description: 'A pocket-sized hole in reality.',
    image: '/collectibles/badges/portal.png',
  },
  {
    id: 'plumbus-badge',
    name: 'Plumbus Badge',
    type: 'badge',
    price: 250,
    description: 'Rubbed with fleeb juice. Allegedly.',
    image: '/collectibles/badges/plumbus.png',
  },
  {
    id: 'chicken-badge',
    name: 'Chicken Badge',
    type: 'badge',
    price: 300,
    description: 'He will be back.',
    featured: true,
    image: '/collectibles/badges/chicken.png',
  },
  {
    id: 'cheesy-poofs',
    name: 'Cheesy Poofs',
    type: 'badge',
    price: 300,
    description: 'Rebranded snack. Same orange fingers.',
    image: '/collectibles/badges/CheesyPoofs.webp',
  },
  {
    id: 'pink-donut',
    name: "Homer's Donut",
    type: 'badge',
    price: 300,
    description: 'Pink frosting, rainbow sprinkles, zero nutritional value.',
    isNew: true,
    image: '/collectibles/badges/donut.png',
  },

  /* ----------------------------------------------------------- characters */
  {
    id: 'mr-poopybutthole',
    name: 'Mr. Poopybutthole',
    type: 'character',
    price: 600,
    show: 'rick-and-morty',
    description: 'Ooh-wee. Always turns up for the finale.',
    featured: true,
    image: '/collectibles/Mr_poopy_butthole.jpg',
  },
  {
    id: 'mr-meeseeks',
    name: 'Mr. Meeseeks',
    type: 'character',
    price: 650,
    show: 'rick-and-morty',
    description: 'Existence is pain. Onboarding is worse.',
    image: '/collectibles/Mr_Meeseeks.jpg',
  },
  {
    id: 'birdperson',
    name: 'Birdperson',
    type: 'character',
    price: 750,
    show: 'rick-and-morty',
    description: 'It has been a challenging onboarding.',
    image: '/collectibles/Birdperson.jpg',
  },
  {
    id: 'consuela',
    name: 'Consuela',
    type: 'character',
    price: 600,
    show: 'family-guy',
    description: 'No, no, no. Not in the shared drive.',
    image: '/collectibles/Consuela.jpg',
  },
  {
    id: 'ernie-the-giant-chicken',
    name: 'Ernie the Giant Chicken',
    type: 'character',
    price: 800,
    show: 'family-guy',
    description: 'Still upset about one expired coupon.',
    image: '/collectibles/Ernie_the_Giant_Chicken.jpg',
  },
  {
    id: 'death',
    name: 'Death',
    type: 'character',
    price: 850,
    show: 'family-guy',
    description: 'Out on sick leave, somehow.',
    image: '/collectibles/Death.jpg',
  },
  {
    id: 'towelie',
    name: 'Towelie',
    type: 'character',
    price: 550,
    show: 'south-park',
    description: 'Do not forget to bring a towel.',
    isNew: true,
    image: '/collectibles/sp_towelie.jpg',
  },
  {
    id: 'sideshow-bob',
    name: 'Sideshow Bob',
    type: 'character',
    price: 700,
    show: 'the-simpsons',
    description: 'Has survived every incident on record.',
    image: '/collectibles/Sideshowbob.jpg',
  },
  {
    id: 'krusty-the-clown',
    name: 'Krusty the Clown',
    type: 'character',
    price: 650,
    show: 'the-simpsons',
    description: 'Contractually obligated to be here.',
    isNew: true,
    image: '/collectibles/Krustytheclown.jpg',
  },
]

export const earnedBadges: EarnedBadge[] = [
  { id: 'first-week', name: 'First Week', description: 'Finish your first training episode.' },
  { id: 'perfect-episode', name: 'Perfect Episode', description: 'Wager during an episode and never lose one.' },
  { id: 'no-warnings', name: 'No Warnings', description: 'Make the strong call on every decision in an episode.' },
  { id: 'high-roller', name: 'High Roller', description: 'Win a Risky or All In wager.' },
  { id: 'lucky-guess', name: 'Lucky Guess', description: 'Win a wager on the Safe stake.' },
]

export const TYPE_LABEL: Record<CosmeticType, string> = {
  border: 'Profile border',
  title: 'Title',
  badge: 'Badge',
  character: 'Character',
}

export const getShopItem = (id: string | null | undefined): ShopItem | undefined =>
  shopItems.find((i) => i.id === id)

export const getEarnedBadge = (id: string): EarnedBadge | undefined => earnedBadges.find((b) => b.id === id)

/** Badge display name, whether it was bought or earned. */
export const badgeName = (id: string): string => getShopItem(id)?.name ?? getEarnedBadge(id)?.name ?? id
