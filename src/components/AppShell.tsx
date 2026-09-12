import { Coins, Layers, Mic, Sparkles, User } from 'lucide-react'
import { llmLabel, llmMode } from '@/ai/llm'
import { useGame, type View } from '@/engine/gameStore'
import { voiceLabel } from '@/voice/voice'
import { useVoiceStatus } from '@/voice/useVoiceStatus'
import { FilmOverlay } from './ui/Grain'

/* ============================================================================
 * Chrome. Present everywhere except inside a scene, where the frame is the UI.
 * ========================================================================== */

const NAV: { view: View; label: string; Icon: typeof Layers }[] = [
  { view: 'home', label: 'episodes', Icon: Layers },
  { view: 'profile', label: 'profile', Icon: User },
  { view: 'authoring', label: 'studio', Icon: Sparkles },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const { state, dispatch } = useGame()
  // Provider discovery is async, so this re-renders once the probe lands
  // rather than permanently claiming the fallback tier.
  const voice = useVoiceStatus()
  /* The cinematic screens carry their own chrome — a second header would
   * collide with their own back button and break the full-bleed frame. */
  const inScene = state.view === 'scene' || state.view === 'intro' || state.view === 'results'

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-900">
      {!inScene && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-6 bg-gradient-to-b from-ink-900 via-ink-900/85 to-transparent px-6 pb-8 pt-4 sm:px-10 [&>*]:pointer-events-auto">
          <button onClick={() => dispatch({ type: 'GOTO', view: 'home' })} className="flex items-baseline gap-2.5">
            <span className="font-sans text-[15px] font-black uppercase tracking-[0.34em] text-bone">ONBOARD</span>
            <span className="hidden font-mono text-[9px] uppercase tracking-[0.2em] text-bone-faint sm:inline">
              your training. your choices.
            </span>
          </button>

          <nav className="ml-auto flex items-center gap-1">
            {NAV.map(({ view, label, Icon }) => (
              <button
                key={view}
                onClick={() => dispatch({ type: 'GOTO', view })}
                className={`flex items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                  state.view === view ? 'text-signal' : 'text-bone-faint hover:text-bone-dim'
                }`}
              >
                <Icon size={12} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>

          <div className="hidden items-center gap-4 border-l border-bone/10 pl-5 lg:flex">
            <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-signal">
              <Coins size={11} />
              {state.player.credits.toLocaleString()}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-bone-faint">
              lv {state.player.level}
            </span>
          </div>
        </header>
      )}

      <main className="h-full w-full">{children}</main>

      {!inScene && (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex flex-wrap items-center flex-nowrap gap-x-4 bg-gradient-to-t from-ink-900 via-ink-900/95 to-transparent px-6 pb-3 pt-8 sm:px-10">
          <span
            className={`font-mono text-[9px] uppercase tracking-[0.16em] ${
              llmMode() === 'offline' ? 'text-bone-faint' : 'text-good'
            }`}
          >
            llm · {llmLabel()}
          </span>
          <span className="hidden items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-bone-faint sm:flex">
            <Mic size={9} />
            {voice.pending ? 'voice · detecting…' : `tts ${voiceLabel(voice.tts)} · stt ${voiceLabel(voice.stt)}`}
          </span>
          <span className="ml-auto hidden font-mono text-[9px] uppercase tracking-[0.16em] text-bone-faint sm:inline">
            prototype · placeholder cast · virtual credits only
          </span>
        </footer>
      )}

      <FilmOverlay intensity={inScene ? 0.17 : 0.1} />
    </div>
  )
}
