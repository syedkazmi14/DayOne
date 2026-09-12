import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { TYPE_LABEL } from '@/content/shop'
import type { ShopItem } from '@/types'
import { Btn } from '../ui/Bits'
import { ItemPreview } from './ItemPreview'

export type DialogMode = 'preview' | 'buy'

export function PurchaseDialog({
  item,
  mode,
  balance,
  owned,
  playerName,
  onClose,
  onRequestBuy,
  onConfirmBuy,
}: {
  item: ShopItem
  mode: DialogMode
  balance: number
  owned: boolean
  playerName: string
  onClose: () => void
  onRequestBuy: () => void
  onConfirmBuy: () => void
}) {
  const remaining = balance - item.price

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
    >
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-ink-900/80" />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="purchase-title"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 6 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[380px] border border-bone/12 bg-ink-800"
      >
        <div className={`relative overflow-hidden ${item.type === 'character' ? 'aspect-[4/3]' : 'aspect-[16/10]'}`}>
          <ItemPreview item={item} playerName={playerName} large />
        </div>

        <div className="border-t border-bone/8 p-6">
          {mode === 'buy' ? (
            <>
              <h2 id="purchase-title" className="font-sans text-[20px] font-semibold tracking-[-0.015em] text-bone">
                Buy {item.name}?
              </h2>
              <p className="mt-2 font-sans text-[14px] tabular-nums text-bone-dim">
                {item.price.toLocaleString()} credits
              </p>
              <p className="mt-1 font-sans text-[13px] tabular-nums text-bone-faint">
                You will have {remaining.toLocaleString()} credits remaining.
              </p>
            </>
          ) : (
            <>
              <p className="font-sans text-[12.5px] text-bone-dim">Preview · {TYPE_LABEL[item.type]}</p>
              <h2 id="purchase-title" className="mt-1 font-sans text-[20px] font-semibold tracking-[-0.015em] text-bone">
                {item.name}
              </h2>
              <p className="mt-2 font-sans text-[13.5px] font-light leading-snug text-bone-dim">{item.description}</p>
            </>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <Btn size="sm" variant="outline" onClick={onClose}>
              {mode === 'buy' ? 'Cancel' : 'Close'}
            </Btn>
            {mode === 'buy' ? (
              <Btn size="sm" onClick={onConfirmBuy} disabled={remaining < 0}>
                Buy
              </Btn>
            ) : (
              !owned && (
                <Btn size="sm" onClick={onRequestBuy} disabled={remaining < 0}>
                  Buy · {item.price.toLocaleString()}
                </Btn>
              )
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
