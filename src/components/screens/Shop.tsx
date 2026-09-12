import { AnimatePresence, motion } from 'framer-motion'
import { Check } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { earnedBadges, shopItems } from '@/content/shop'
import { owns } from '@/engine/cosmetics'
import { useGame } from '@/engine/gameStore'
import type { CosmeticType, ShopItem } from '@/types'
import { EarnedBadgeCard, ItemCard } from '../shop/ItemCard'
import { PurchaseDialog, type DialogMode } from '../shop/PurchaseDialog'
import { titleCase } from '../ui/ProfileAvatar'

/* ============================================================================
 * The shop. Cosmetic profile items, bought outright with credits earned in
 * episodes. Fixed prices, no randomness, no timers, no scarcity — the fun is
 * in the collectibles and in what they do to your profile.
 * ========================================================================== */

type Tab = 'featured' | CosmeticType
type Filter = 'all' | 'owned' | 'not-owned'

const TABS: { id: Tab; label: string }[] = [
  { id: 'featured', label: 'Featured' },
  { id: 'border', label: 'Borders' },
  { id: 'title', label: 'Titles' },
  { id: 'badge', label: 'Badges' },
  { id: 'character', label: 'Characters' },
]

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'not-owned', label: 'Not owned' },
]

const COLS = { 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' } as const

function Grid({ cols, count, filter, children }: { cols: 3 | 4; count: number; filter: Filter; children: ReactNode }) {
  if (count === 0)
    return (
      <p className="py-10 font-sans text-[14px] font-light text-bone-faint">
        {filter === 'owned' ? 'Nothing owned here yet.' : 'You own all of these. Show-off.'}
      </p>
    )
  return <div className={`grid gap-4 ${COLS[cols]}`}>{children}</div>
}

const Reveal = ({ i, children }: { i: number; children: ReactNode }) => (
  <motion.div
    initial={{ opacity: 0, y: 14 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.04 + i * 0.045, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
  >
    {children}
  </motion.div>
)

export function Shop() {
  const { state, dispatch } = useGame()
  const p = state.player
  const c = p.cosmetics
  const playerName = titleCase(p.name)

  const [tab, setTab] = useState<Tab>('featured')
  const [filter, setFilter] = useState<Filter>('all')
  const [dialog, setDialog] = useState<{ item: ShopItem; mode: DialogMode } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  const closeDialog = useCallback(() => setDialog(null), [])
  const passes = (id: string) => filter === 'all' || (filter === 'owned') === owns(c, id)

  const handlers = {
    onBuy: (item: ShopItem) => setDialog({ item, mode: 'buy' }),
    onPreview: (item: ShopItem) => setDialog({ item, mode: 'preview' }),
    onEquip: (itemId: string) => dispatch({ type: 'EQUIP_ITEM', itemId }),
    onUnequip: (itemId: string) => dispatch({ type: 'UNEQUIP_ITEM', itemId }),
  }

  const confirmBuy = () => {
    if (!dialog) return
    dispatch({ type: 'BUY_ITEM', itemId: dialog.item.id })
    setToast(`Purchased ${dialog.item.name}`)
    setDialog(null)
  }

  const cards = (items: ShopItem[], cols: 3 | 4, tall = false) => {
    const shown = items.filter((i) => passes(i.id))
    return (
      <Grid cols={cols} count={shown.length} filter={filter}>
        {shown.map((item, i) => (
          <Reveal key={item.id} i={i}>
            <ItemCard item={item} cosmetics={c} balance={p.credits} playerName={playerName} tall={tall} {...handlers} />
          </Reveal>
        ))}
      </Grid>
    )
  }

  const ofType = (t: CosmeticType) => shopItems.filter((i) => i.type === t)
  const earned = earnedBadges.filter((b) => passes(b.id))

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-6 pb-32 pt-36 sm:px-10">
        <button
          onClick={() => dispatch({ type: 'GOTO', view: 'home' })}
          className="mb-12 font-sans text-[13px] text-bone-dim transition-colors hover:text-bone"
        >
          ← Episodes
        </button>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4"
        >
          <div>
            <h1 className="font-sans text-[34px] font-semibold tracking-[-0.02em] text-bone">Shop</h1>
            <p className="mt-3 max-w-xl font-sans text-[15px] font-light leading-relaxed text-bone-dim">
              Spend your credits on profile cosmetics and collectibles.
            </p>
          </div>
          <p className="pb-1 font-sans text-[15px] tabular-nums text-bone">
            <span className="font-medium">{p.credits.toLocaleString()}</span>{' '}
            <span className="text-bone-dim">credits</span>
          </p>
        </motion.div>

        {/* category tabs + ownership filter */}
        <div className="mt-10 flex flex-wrap items-end justify-between gap-x-8 sm:border-b sm:border-bone/10">
          <div role="tablist" aria-label="Shop categories" className="no-scrollbar -mb-px flex w-full gap-6 overflow-x-auto border-b border-bone/10 sm:w-auto sm:border-b-0">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`shrink-0 border-b-2 pb-3 font-sans text-[14px] transition-colors ${
                  tab === t.id ? 'border-signal font-medium text-bone' : 'border-transparent text-bone-dim hover:text-bone'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Filter by ownership" className="flex gap-4 py-3">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={`font-sans text-[13px] transition-colors ${
                  filter === f.id
                    ? 'text-bone underline decoration-signal decoration-2 underline-offset-[6px]'
                    : 'text-bone-faint hover:text-bone-dim'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div key={`${tab}-${filter}`} role="tabpanel" className="mt-10">
          {tab === 'featured' && (
            <>
              <h2 className="t-section mb-5">Featured</h2>
              {cards(
                shopItems.filter((i) => i.featured),
                4,
              )}
              <h2 className="t-section mb-5 mt-16">New this week</h2>
              {cards(
                shopItems.filter((i) => i.isNew),
                3,
              )}
            </>
          )}

          {tab === 'border' && cards(ofType('border'), 4)}
          {tab === 'title' && cards(ofType('title'), 4)}
          {tab === 'character' && cards(ofType('character'), 4, true)}

          {tab === 'badge' && (
            <>
              <h2 className="t-section">Shop badges</h2>
              <p className="mb-5 mt-1.5 font-sans text-[13.5px] font-light text-bone-dim">
                Wear up to three next to your name.
              </p>
              {cards(ofType('badge'), 4)}

              <h2 className="t-section mt-16">Earned in episodes</h2>
              <p className="mb-5 mt-1.5 font-sans text-[13.5px] font-light text-bone-dim">
                Not for sale. You have to actually do the thing.
              </p>
              <Grid cols={4} count={earned.length} filter={filter}>
                {earned.map((b, i) => (
                  <Reveal key={b.id} i={i}>
                    <EarnedBadgeCard badge={b} cosmetics={c} onEquip={handlers.onEquip} onUnequip={handlers.onUnequip} />
                  </Reveal>
                ))}
              </Grid>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {dialog && (
          <PurchaseDialog
            key={dialog.item.id}
            item={dialog.item}
            mode={dialog.mode}
            balance={p.credits}
            owned={owns(c, dialog.item.id)}
            playerName={playerName}
            onClose={closeDialog}
            onRequestBuy={() => setDialog({ item: dialog.item, mode: 'buy' })}
            onConfirmBuy={confirmBuy}
          />
        )}
      </AnimatePresence>

      <div role="status" className="pointer-events-none fixed inset-x-0 bottom-8 z-40 flex justify-center px-4">
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-2 border border-bone/12 bg-ink-800 px-4 py-2.5 font-sans text-[13px] text-bone"
            >
              <Check size={13} strokeWidth={2.25} className="text-signal" />
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
