import { useGame, type View } from '@/engine/gameStore'
import { FilmOverlay } from './ui/Grain'

/* ============================================================================
 * Chrome. Present everywhere except inside a scene, where the frame is the UI.
 *
 * Type only — no icons. The nav sits over the page on a long fade rather than
 * in a bar of its own, so the artwork behind it is never cut by an edge.
 * ========================================================================== */

const NAV: { view: View; label: string }[] = [
  { view: 'home', label: 'Episodes' },
  { view: 'profile', label: 'Profile' },
  { view: 'shop', label: 'Shop' },
  { view: 'authoring', label: 'Studio' },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useGame()
  /* The cinematic screens carry their own chrome — a second header would
   * collide with their own back button and break the full-bleed frame. */
  const inScene = state.view === 'scene' || state.view === 'intro' || state.view === 'results'

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900">
      {!inScene && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-6 bg-gradient-to-b from-ink-900 via-ink-900/72 via-45% to-transparent px-6 pb-28 pt-5 sm:px-10 [&>*]:pointer-events-auto">
          <button onClick={() => dispatch({ type: 'GOTO', view: 'home' })}>
            <span className="font-sans text-[19px] font-semibold tracking-[-0.015em] text-bone">DayOne</span>
          </button>

          <nav className="ml-auto flex items-center gap-0.5">
            {NAV.map(({ view, label }) => (
              <button
                key={view}
                onClick={() => dispatch({ type: 'GOTO', view })}
                className={`px-2.5 py-2 font-sans text-[13px] tracking-[-0.005em] transition-colors ${
                  state.view === view ? 'font-medium text-signal' : 'text-bone-dim hover:text-bone'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="hidden items-center gap-3 pl-2 font-sans text-[12.5px] tabular-nums text-bone-faint lg:flex">
            <span>{state.player.credits.toLocaleString()}</span>
            <span>Level {state.player.level}</span>
          </div>
        </header>
      )}

      <main className="h-full w-full">{children}</main>

      {/* The bottom scrim stays — the browse surfaces scroll full-bleed artwork
        * under it — but carries no text. Runtime tiers are reported in Studio. */}
      {!inScene && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-24 bg-gradient-to-t from-ink-900 via-ink-900/80 to-transparent" />
      )}

      <FilmOverlay intensity={inScene ? 0.12 : 0.07} />
    </div>
  )
}
