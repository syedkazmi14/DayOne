import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Sparkles, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { conceptLabel } from '@/content/knowledge'
import { useGame } from '@/engine/gameStore'
import { stopAllSpeech } from '@/voice/voice'
import { CharacterChat } from '../CharacterChat'
import { ChoicePanel } from '../ChoicePanel'
import { ConsequencePanel } from '../ConsequencePanel'
import { DialogueOverlay } from '../DialogueOverlay'
import { EpisodeProgress } from '../EpisodeProgress'
import { RiskTerminal } from '../RiskTerminal'
import { SceneCanvas } from '../SceneCanvas'
import { Btn, Eyebrow } from '../ui/Bits'

/* ============================================================================
 * The player. One full-bleed cinematic frame; every overlay is transient.
 * Phase transitions come from the reducer, never from this component.
 * ========================================================================== */

export function ScenePlayer() {
  const { state, dispatch, episode, scene, advance } = useGame()
  const [voiceOn, setVoiceOn] = useState(false)
  const [titleShown, setTitleShown] = useState(true)
  const [adaptShown, setAdaptShown] = useState<string | null>(null)

  // Adaptive interstitial: only the first time we land on a generated branch.
  const adaptPending = !!state.adaptation && state.adaptation.sceneId === state.sceneId && adaptShown !== state.sceneId

  // Title card in, then out — held back while the interstitial is up, or the
  // adapted act would burn its title card behind a full-screen overlay.
  useEffect(() => {
    if (adaptPending) return
    setTitleShown(true)
    const t = setTimeout(() => setTitleShown(false), 2600)
    return () => clearTimeout(t)
  }, [state.sceneId, adaptPending])
  useEffect(() => {
    if (!adaptPending) return
    const t = setTimeout(() => setAdaptShown(state.sceneId!), 3000)
    return () => clearTimeout(t)
  }, [adaptPending, state.sceneId])

  // Keyboard: advance dialogue, close chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.chat.open) {
        dispatch({ type: 'CLOSE_CHAT' })
        return
      }
      if (state.chat.open || adaptPending) return
      if ((e.key === ' ' || e.key === 'Enter') && state.phase === 'dialogue') {
        e.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state.phase, state.chat.open, adaptPending, advance, dispatch])

  useEffect(() => () => stopAllSpeech(), [])

  if (!episode || !scene) return null
  const line = scene.dialogue[state.dialogueIndex]

  return (
    <div className="letterbox relative h-full overflow-hidden bg-black">
      {/* scene */}
      <SceneCanvas shot={scene.shot} sceneKey={scene.id} paused={state.phase === 'choices' || state.phase === 'wager'} />

      {/* cut-to-black between scenes */}
      <AnimatePresence>
        <motion.div
          key={scene.id}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 z-[35] bg-black"
        />
      </AnimatePresence>

      {/* HUD */}
      <div className="absolute inset-x-0 top-0 z-[31] flex items-start justify-between px-6 pt-[calc(4.5vh+14px)] sm:px-10">
        <div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-ultra text-bone-dim">{episode.code}</span>
            <span className="h-px w-5 bg-bone/25" />
            <span className="font-mono text-[10px] uppercase tracking-ultra text-signal">{episode.title}</span>
          </div>
          <div className="mt-2.5">
            <div className="hidden sm:block">
              <EpisodeProgress episode={episode} currentAct={scene.act} />
            </div>
            <div className="sm:hidden">
              <EpisodeProgress episode={episode} currentAct={scene.act} compact />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-[10px] tabular-nums text-bone-faint sm:inline">
            {state.player.credits.toLocaleString()} cr
          </span>
          <button
            onClick={() => {
              setVoiceOn((v) => !v)
              stopAllSpeech()
            }}
            title={voiceOn ? 'Scene voices on' : 'Scene voices off'}
            className={`transition-colors ${voiceOn ? 'text-signal' : 'text-bone-faint hover:text-bone'}`}
          >
            {voiceOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button
            onClick={() => {
              stopAllSpeech()
              dispatch({ type: 'GOTO', view: 'home' })
            }}
            aria-label="Exit episode"
            className="text-bone-faint transition-colors hover:text-bone"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* title card */}
      <AnimatePresence>
        {titleShown && scene.title && state.phase === 'dialogue' && (
          <motion.div
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute left-6 top-[26vh] z-20 sm:left-10"
          >
            <div className="mb-2 h-px w-12 bg-signal" />
            <h2 className="t-display text-[clamp(1.7rem,4.5vw,3rem)] text-bone text-shadow-cine">{scene.title}</h2>
            {scene.subtitle && (
              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-ultra text-bone-dim">{scene.subtitle}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* phases */}
      {!adaptPending && (
        <>
          {state.phase === 'dialogue' && line && (
            <DialogueOverlay
              line={line}
              index={state.dialogueIndex}
              total={scene.dialogue.length}
              onAdvance={advance}
              voiceOn={voiceOn}
            />
          )}

          {state.phase === 'wager' && (
            <RiskTerminal
              scene={scene}
              mastery={state.player.mastery}
              credits={state.player.credits}
              onStake={(option, estimate) => dispatch({ type: 'STAGE_WAGER', option, estimate })}
              onSkip={() => dispatch({ type: 'SKIP_WAGER' })}
            />
          )}

          {state.phase === 'choices' && scene.choices && (
            <ChoicePanel
              prompt={scene.prompt ?? 'WHAT DO YOU DO?'}
              choices={scene.choices}
              wager={state.stagedWager}
              onChoose={(choice) => {
                stopAllSpeech()
                dispatch({ type: 'CHOOSE', choice })
              }}
            />
          )}

          {state.phase === 'outcome' && scene.outcome && (
            <ConsequencePanel
              scene={scene}
              wager={state.lastWager}
              onContinue={() => dispatch({ type: 'CONTINUE' })}
              onTalk={(characterId) => dispatch({ type: 'OPEN_CHAT', characterId })}
            />
          )}

          {state.phase === 'ending' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.8 }}
              className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-ink-900/55"
            >
              <Eyebrow className="text-signal">end of episode</Eyebrow>
              <h2 className="t-display mt-4 text-center text-[clamp(2.4rem,8vw,5rem)] text-bone">{scene.title}</h2>
              {scene.dialogue.length > 0 && state.dialogueIndex < scene.dialogue.length && (
                <button
                  onClick={advance}
                  className="mt-6 max-w-xl px-8 text-center font-sans text-[16px] font-light italic leading-relaxed text-bone-dim"
                >
                  {scene.dialogue[Math.min(state.dialogueIndex, scene.dialogue.length - 1)].line}
                </button>
              )}
              <Btn className="mt-10" onClick={() => dispatch({ type: 'CONTINUE' })}>
                see your results <ArrowRight size={13} />
              </Btn>
            </motion.div>
          )}
        </>
      )}

      {/* adaptive interstitial */}
      <AnimatePresence>
        {adaptPending && state.adaptation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="absolute inset-0 z-[36] flex flex-col items-center justify-center bg-ink-900/94"
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.7 }}
              className="max-w-lg px-8 text-center"
            >
              <div className="mb-4 flex items-center justify-center gap-2">
                <Sparkles size={13} className="text-cyan" />
                <span className="t-eyebrow text-cyan">adaptive learning agent</span>
              </div>
              <h3 className="t-display text-[clamp(1.8rem,6vw,3rem)] text-bone">
                BUILDING ACT THREE
                <br />
                FOR YOU
              </h3>
              <p className="mt-5 font-sans text-[15px] font-light leading-relaxed text-bone-dim">
                {state.adaptation.rationale}
              </p>
              <div className="mt-6 inline-flex items-center gap-3 border border-cyan/30 px-4 py-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan">focus</span>
                <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-bone">
                  {conceptLabel(state.adaptation.focus)}
                </span>
              </div>
              <div className="mt-8 h-[2px] w-full overflow-hidden rail">
                <motion.div
                  className="h-full bg-cyan"
                  initial={{ width: 0 }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 2.7, ease: 'linear' }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* character chat */}
      <AnimatePresence>
        {state.chat.open && state.chat.characterId && (
          <CharacterChat characterId={state.chat.characterId} onClose={() => dispatch({ type: 'CLOSE_CHAT' })} />
        )}
      </AnimatePresence>
    </div>
  )
}
