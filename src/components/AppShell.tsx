import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { characterGroups } from '@/content/characterGroups'
import { playableCount } from '@/content/episodes'
import { useGame, type View } from '@/engine/gameStore'
import { applyTheme, BASE, channelsToHex, getTheme, loadThemeId, saveThemeId, themeSwatch, THEMES } from '@/theme/themes'
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
  const { state, dispatch, group } = useGame()
  /* The cinematic screens carry their own chrome — a second header would
   * collide with their own back button and break the full-bleed frame. Sign-in
   * and the show picker have no chrome at all: offering Episodes / Shop /
   * Studio before a show is chosen navigates past the one question being
   * asked. */
  const cinematic = state.view === 'scene' || state.view === 'intro' || state.view === 'results'
  const inScene = cinematic || state.view === 'signin' || state.view === 'pickshow'

  /* Account menu. Closes on outside click, on Escape, and on any navigation —
   * a menu still hanging open over the next screen is the classic bug here. */
  const [menuOpen, setMenuOpen] = useState(false)
  /* Both lists are flyouts off a row rather than rows sitting in the menu
   * itself: each is rare next to Profile and Sign out, and ten permanent rows
   * would push the common items off the bottom. One open at a time. */
  const [openSub, setOpenSub] = useState<'shows' | 'theme' | null>(null)
  /* Hover previews a flyout, a click pins it open, so a list can be read
   * without holding the pointer perfectly still over the row. */
  const [pinned, setPinned] = useState(false)
  const [themeId, setThemeIdState] = useState<string>(loadThemeId)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMenuOpen(false), [state.view])
  useEffect(() => {
    if (!menuOpen) {
      setOpenSub(null)
      setPinned(false)
    }
  }, [menuOpen])

  const setTheme = (id: string) => {
    setThemeIdState(id)
    applyTheme(id)
    saveThemeId(id)
  }

  const subProps = (id: 'shows' | 'theme') => ({
    onMouseEnter: () => {
      if (!pinned) setOpenSub(id)
    },
    onMouseLeave: () => {
      if (!pinned) setOpenSub(null)
    },
  })
  /** The live accent, for the dot on the Theme row. */
  const activeAccent = channelsToHex({ ...BASE, ...getTheme(themeId).vars }['--signal'])

  const subToggle = (id: 'shows' | 'theme') => () => {
    if (openSub === id && pinned) {
      setOpenSub(null)
      setPinned(false)
    } else {
      setOpenSub(id)
      setPinned(true)
    }
  }

  /* Switching show also returns to the lobby, because that is the only screen
   * the choice is visible on. Closing is explicit: GOTO home from home leaves
   * `view` untouched, so the effect above would never fire. */
  const chooseShow = (groupId: string) => {
    dispatch({ type: 'SELECT_GROUP', groupId })
    dispatch({ type: 'GOTO', view: 'home' })
    setOpenSub(null)
    setPinned(false)
    setMenuOpen(false)
  }

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
      if (e.key !== 'Escape') return
      /* Escape backs out one level at a time, so it never closes the whole
       * menu out from under someone browsing shows or themes. */
      if (openSub) {
        setOpenSub(null)
        setPinned(false)
      } else setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen, openSub])

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
                  className={`relative shrink-0 px-2 py-2 font-sans text-[13px] tracking-[-0.005em] transition-colors sm:px-2.5 ${
                    state.view === view ? 'font-medium text-signal' : 'text-bone hover:text-white'
                  }`}
                >
                  {label}
                  {/* Weight and an underline, not colour alone: a theme whose
                    * accent is the text colour would leave the current tab
                    * looking exactly like the other two. */}
                  {state.view === view && (
                    <span aria-hidden className="absolute inset-x-2 bottom-1 h-px bg-signal sm:inset-x-2.5" />
                  )}
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
                    className="menu-surface absolute right-0 top-full z-40 mt-2 w-48 py-1"
                  >
                    {/* The show scopes the whole episode shelf, so it is a
                      * preference rather than a destination, which is what puts
                      * it here rather than in the nav. Chosen once at
                      * onboarding; this is where it gets changed. */}
                    <div className="relative" {...subProps('shows')}>
                      <button
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={openSub === 'shows'}
                        onClick={subToggle('shows')}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-sans text-[13px] text-bone-dim transition-colors hover:bg-bone/5 hover:text-bone"
                      >
                        Change show
                        {/* Text, not an icon: this header is type only. */}
                        <span aria-hidden className="ml-auto shrink-0 text-bone-faint">&rsaquo;</span>
                      </button>

                      <AnimatePresence>
                        {openSub === 'shows' && (
                          <motion.div
                            role="menu"
                            aria-label="Show"
                            initial={{ opacity: 0, x: 4 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 4 }}
                            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                            /* Flies out to the left: the account menu is already
                             * pinned to the right edge of the viewport. Flush
                             * against it on purpose — the flyout is a child of
                             * the row that opens it, so any gap between them is
                             * outside both, and crossing it fired mouseLeave
                             * then mouseEnter on every pass: a flicker loop. */
                            className="menu-surface absolute right-full top-0 z-50 w-56 py-1"
                          >
                            {characterGroups.map((g) => {
                              const active = g.id === group.id
                              return (
                                <button
                                  key={g.id}
                                  role="menuitemradio"
                                  aria-checked={active}
                                  onClick={() => chooseShow(g.id)}
                                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left font-sans text-[13px] transition-colors hover:bg-bone/5"
                                >
                                  <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                                    style={{
                                      background: active ? g.accent : 'transparent',
                                      boxShadow: active ? undefined : 'inset 0 0 0 1px rgba(237,233,226,.25)',
                                    }}
                                  />
                                  <span className={active ? 'text-bone' : 'text-bone-dim'}>{g.name}</span>
                                  {playableCount(g.id) === 0 && (
                                    <span className="ml-auto shrink-0 font-sans text-[11px] text-bone-faint">
                                      In production
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* THEME — a local design tool, not a shipping setting.
                      * Rewrites the palette variables on :root, which every
                      * Tailwind colour token resolves through, so the whole app
                      * recolours at once. See src/theme/themes.ts. */}
                    <div className="relative" {...subProps('theme')}>
                      <button
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={openSub === 'theme'}
                        onClick={subToggle('theme')}
                        className="flex w-full items-center gap-2 px-4 py-2.5 text-left font-sans text-[13px] text-bone-dim transition-colors hover:bg-bone/5 hover:text-bone"
                      >
                        Theme
                        <span
                          aria-hidden
                          className="ml-auto h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: activeAccent }}
                        />
                        <span aria-hidden className="shrink-0 text-bone-faint">&rsaquo;</span>
                      </button>

                      <AnimatePresence>
                        {openSub === 'theme' && (
                          <motion.div
                            role="menu"
                            aria-label="Theme"
                            initial={{ opacity: 0, x: 4 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 4 }}
                            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                            className="menu-surface absolute right-full top-0 z-50 w-56 py-1"
                          >
                            {THEMES.map((t) => {
                              const active = t.id === themeId
                              const sw = themeSwatch(t)
                              return (
                                <button
                                  key={t.id}
                                  role="menuitemradio"
                                  aria-checked={active}
                                  onClick={() => setTheme(t.id)}
                                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-bone/5"
                                >
                                  <span className="flex shrink-0 gap-[3px]">
                                    {[sw.ground, sw.accent, sw.text].map((c) => (
                                      <span
                                        key={c}
                                        className="block h-2.5 w-2.5 rounded-full"
                                        style={{ background: c, boxShadow: 'inset 0 0 0 1px rgb(var(--bone) / .2)' }}
                                      />
                                    ))}
                                  </span>
                                  <span className={`font-sans text-[13px] ${active ? 'text-bone' : 'text-bone-dim'}`}>
                                    {t.name}
                                  </span>
                                </button>
                              )
                            })}

                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <div role="separator" className="my-1 h-px bg-bone/10" />

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
