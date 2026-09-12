import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { useGame, type View } from '@/engine/gameStore'
import { FilmOverlay } from './ui/Grain'
import { ProfileAvatar, titleCase } from './ui/ProfileAvatar'

/* ============================================================================
 * Chrome. Present everywhere except inside a scene, where the frame is the UI.
 *
 * Type only — no icons. The nav sits over the page on a long fade rather than
 * in a bar of its own, so the artwork behind it is never cut by an edge.
 *
 * The chrome cross-fades on the same curve and duration as the screen swap in
 * App.tsx. `inScene` flips synchronously on dispatch while AnimatePresence
 * holds the outgoing screen for 420ms, so an unanimated header snapped in at
 * full opacity over the previous screen — a hard-edged dark band across the top
 * on every navigation.
 * ========================================================================== */

/* No 'Profile' entry: the avatar at the right of the header is the profile
 * affordance, and two controls for one destination is noise. */
const NAV: { view: View; label: string }[] = [
  { view: 'home', label: 'Episodes' },
  { view: 'shop', label: 'Shop' },
  { view: 'authoring', label: 'Studio' },
]

/** Matches App.tsx's screen transition, so chrome and content move together. */
const CHROME_FADE = { duration: 0.42, ease: [0.16, 1, 0.3, 1] } as const
const FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useGame()
  /* The cinematic screens carry their own chrome — a second header would
   * collide with their own back button and break the full-bleed frame. Sign-in
   * has no chrome at all: there is nothing to navigate to yet. */
  const cinematic = state.view === 'scene' || state.view === 'intro' || state.view === 'results'
  const inScene = cinematic || state.view === 'signin'

  /* Account menu. Closes on outside click, on Escape, and on any navigation —
   * a menu still hanging open over the next screen is the classic bug here. */
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMenuOpen(false), [state.view])

  /* Condense the header fade once the screen scrolls. Each screen owns its own
   * overflow-y-auto container, so there is no window scroll to read: listen on
   * <main> in the CAPTURE phase, which is the one way to catch a scroll event
   * from a descendant (scroll does not bubble). */
  const [scrolled, setScrolled] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => setScrolled(false), [state.view])

  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const onScroll = (e: Event) => setScrolled(((e.target as HTMLElement)?.scrollTop ?? 0) > 32)
    el.addEventListener('scroll', onScroll, true)
    return () => el.removeEventListener('scroll', onScroll, true)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900">
      <AnimatePresence>
        {!inScene && (
          <motion.header
            key="chrome-header"
            {...FADE}
            transition={CHROME_FADE}
            className={`pointer-events-none absolute inset-x-0 top-0 z-30 scrim-top flex items-center gap-3 px-6 pt-5 transition-[padding-bottom] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] sm:gap-6 sm:px-10 [&>*]:pointer-events-auto ${
              scrolled ? 'pb-8' : 'pb-28'
            }`}
          >
            <button className="shrink-0" onClick={() => dispatch({ type: 'GOTO', view: 'home' })}>
              <span className="font-sans text-[19px] font-semibold tracking-[-0.015em] text-bone">DayOne</span>
            </button>

            <nav className="no-scrollbar flex min-w-0 flex-1 items-center justify-end gap-0.5 overflow-x-auto">
              {NAV.map(({ view, label }) => (
                <button
                  key={view}
                  onClick={() => dispatch({ type: 'GOTO', view })}
                  className={`shrink-0 px-2 py-2 font-sans text-[13px] tracking-[-0.005em] transition-colors sm:px-2.5 ${
                    state.view === view ? 'font-medium text-signal' : 'text-bone hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            {/* The avatar replaces the level readout and shows at every width —
              * it carries the equipped border, so the Shop visibly pays off —
              * and it is the only way back out of the app. */}
            <div ref={menuRef} className="relative flex shrink-0 items-center gap-3">
              <span className="hidden font-sans text-[12.5px] tabular-nums text-bone-faint lg:inline">
                {state.player.credits.toLocaleString()}
              </span>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`${titleCase(state.player.name)} — account menu`}
                className="transition-opacity hover:opacity-80"
              >
                <ProfileAvatar
                  name={titleCase(state.player.name)}
                  borderId={state.player.cosmetics.equippedBorder}
                  size={30}
                />
              </button>

              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                    className="glass-strong absolute right-0 top-full z-40 mt-2 w-44 py-1"
                  >
                    <button
                      role="menuitem"
                      onClick={() => dispatch({ type: 'GOTO', view: 'profile' })}
                      className="block w-full px-4 py-2.5 text-left font-sans text-[13px] text-bone-dim transition-colors hover:bg-bone/5 hover:text-bone"
                    >
                      Profile
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => dispatch({ type: 'SIGN_OUT' })}
                      className="block w-full px-4 py-2.5 text-left font-sans text-[13px] text-danger transition-colors hover:bg-danger/10"
                    >
                      Sign out
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.header>
        )}

        {/* The bottom scrim stays — the browse surfaces scroll full-bleed artwork
          * under it — but carries no text. Runtime tiers are reported in Studio. */}
        {!inScene && (
          <motion.div
            key="chrome-scrim"
            {...FADE}
            transition={CHROME_FADE}
            className="scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 z-30 h-24"
          />
        )}
      </AnimatePresence>

      <main ref={mainRef} className="h-full w-full">
        {children}
      </main>

      <FilmOverlay intensity={cinematic ? 0.12 : 0.07} />
    </div>
  )
}
