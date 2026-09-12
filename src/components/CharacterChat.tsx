import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, CornerDownLeft, Keyboard, Mic, ShieldAlert, ShieldCheck, Square, Terminal, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { askCharacter, suggestedQuestions, type CharacterReply, type SceneContext } from '@/ai/characterAgent'
import { llmLabel } from '@/ai/llm'
import { corpusFor } from '@/ai/retrieval'
import { getCharacter } from '@/content/characters'
import type { ChatTurn } from '@/types'
import { useGame } from '@/engine/gameStore'
import { episodeKnowledgeResolver } from '@/engine/validateEpisode'
import { GroundingInspector } from './GroundingInspector'
import { speak, startMic, stopAllSpeech, ttsTier, voiceLabel, type MicSession } from '@/voice/voice'
import { resolveVoiceProfile } from '@/voice/voiceProfiles'
import { Chip } from './ui/Bits'
import { CharacterAvatar } from './ui/CharacterAvatar'

/* ============================================================================
 * CHARACTER CHAT — text and voice.
 *
 * The player can ask anything, which is exactly why this is the one runtime
 * surface an LLM belongs on. Every answer is retrieval-grounded and carries its
 * citations; when retrieval comes back empty the character says so instead of
 * inventing company policy. The inspector shows the retrieval and the prompt,
 * because "grounded" should be verifiable rather than claimed.
 * ========================================================================== */

const BARS = 34

export function CharacterChat({ characterId, onClose }: { characterId: string; onClose: () => void }) {
  const { state, dispatch, scene, episode, activeConcepts } = useGame()
  const ch = getCharacter(characterId)
  // A generated episode's characters are grounded in the material it was built from.
  const corpus = corpusFor(episode?.knowledge)
  const resolveKnowledge = episodeKnowledgeResolver(episode)
  const [mode, setMode] = useState<'text' | 'voice'>('text')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [voiceOut, setVoiceOut] = useState(true)
  const [subtitle, setSubtitle] = useState<string | null>(null)
  const [inspect, setInspect] = useState(false)
  const [lastReply, setLastReply] = useState<CharacterReply | null>(null)
  const lastConfidence = lastReply && lastReply.kind !== 'greeting' ? lastReply.confidence : null
  /** Set when speech had to degrade a tier. Shown, never thrown. */
  const [voiceNote, setVoiceNote] = useState<string | null>(null)

  // voice capture
  const [recording, setRecording] = useState(false)
  const [levels, setLevels] = useState<number[]>(Array(BARS).fill(0.04))
  const [interim, setInterim] = useState('')
  const mic = useRef<MicSession | null>(null)
  const raf = useRef<number>()
  const scroller = useRef<HTMLDivElement>(null)

  const turns = state.player.transcript.filter((t) => t.characterId === characterId)

  const ctx: SceneContext = {
    sceneTitle: scene?.title ?? 'Helix Dynamics',
    situation: scene?.outcome?.banner
      ? `${scene.outcome.banner}. ${scene.outcome.lesson.slice(0, 220)}`
      : (scene?.dialogue[0]?.line ?? 'The player is on their first day.'),
    activeConcepts,
    lastChoiceText: state.lastChoice?.text,
    lastChoiceQuality: state.lastChoice?.quality,
  }

  useEffect(() => {
    // scrollTo is missing in some embedded webviews; the transcript still works.
    scroller.current?.scrollTo?.({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, busy])

  useEffect(
    () => () => {
      mic.current?.cancel()
      if (raf.current) cancelAnimationFrame(raf.current)
      stopAllSpeech()
    },
    [],
  )

  async function send(question: string, viaVoice: boolean) {
    const q = question.trim()
    if (!q || busy) return
    setInput('')
    setInterim('')
    dispatch({
      type: 'CHAT_TURN',
      turn: { id: crypto.randomUUID(), characterId, role: 'player', text: q, mode: viaVoice ? 'voice' : 'text' },
    })
    setBusy(true)
    try {
      const reply = await askCharacter({ characterId, question: q, ctx, history: turns, corpus })
      setLastReply(reply)
      const turn: ChatTurn = {
        id: crypto.randomUUID(),
        characterId,
        role: 'character',
        text: reply.text,
        citations: reply.citations,
        mode: viaVoice ? 'voice' : 'text',
        grounded: reply.grounded,
      }
      dispatch({ type: 'CHAT_TURN', turn })

      if (voiceOut || viaVoice) {
        setSpeaking(true)
        // Subtitles belong to the voice flow. In text mode the reply is already
        // on screen, so a band repeating it verbatim is just noise.
        if (viaVoice || mode === 'voice') setSubtitle(reply.text)
        const handle = await speak(reply.text, ch)
        setVoiceNote(handle.failureMessage ?? null)
        await handle.done
        setSpeaking(false)
        setTimeout(() => setSubtitle(null), 900)
      }
    } finally {
      setBusy(false)
    }
  }

  async function toggleRecording() {
    if (recording) {
      setRecording(false)
      if (raf.current) cancelAnimationFrame(raf.current)
      const session = mic.current
      mic.current = null
      setLevels(Array(BARS).fill(0.04))
      if (session) {
        const text = await session.stop()
        void send(text, true)
      }
      return
    }
    stopAllSpeech()
    const session = await startMic(suggestedQuestions(ctx, corpus))
    mic.current = session
    setRecording(true)
    const tick = () => {
      const l = session.level()
      setLevels((prev) => [...prev.slice(1), l])
      setInterim(session.interim())
      raf.current = requestAnimationFrame(tick)
    }
    tick()
  }

  const suggestions = suggestedQuestions(ctx, corpus)

  return (
    <motion.aside
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 260, damping: 32 }}
      className="glass-strong absolute inset-0 z-50 flex flex-col sm:left-auto sm:w-[500px] sm:border-l"
    >
      {/* header */}
      <div className="relative shrink-0 overflow-hidden border-b border-bone/10">
        <div
          className="absolute inset-0 opacity-[0.14]"
          style={{ background: `radial-gradient(120% 140% at 82% 0%, ${ch.accent}, transparent 62%)` }}
        />
        <div className="relative flex items-start gap-4 px-5 py-4">
          <CharacterAvatar character={ch} size={68} priority speaking={speaking} className="shrink-0 border border-bone/10" />
          <div className="min-w-0 flex-1 pt-1">
            <div className="font-sans text-[17px] font-bold uppercase tracking-[0.05em]" style={{ color: ch.accent }}>
              {ch.name}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-bone-faint">{ch.role}</div>
            <div className="mt-1.5 font-sans text-[12px] font-light italic leading-snug text-bone-dim">{ch.tagline}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-bone-faint transition-colors hover:text-bone">
            <X size={16} />
          </button>
        </div>
        <div className="relative flex flex-wrap items-center gap-1.5 px-5 pb-3">
          <Chip tone="cyan">{llmLabel()}</Chip>
          <Chip tone="neutral">rag · {corpus.length} rules</Chip>
          <Chip tone="neutral">
            <Volume2 size={10} />
            {resolveVoiceProfile(ch.voiceProfileId).label.split(' — ')[0]}
          </Chip>
          {lastConfidence !== null && (
            <Chip tone={lastConfidence >= 0.3 ? 'good' : 'danger'}>
              {lastConfidence >= 0.3 ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />}
              conf {Math.round(lastConfidence * 100)}
            </Chip>
          )}
          <button
            onClick={() => setVoiceOut((v) => !v)}
            className="ml-auto text-bone-faint transition-colors hover:text-bone"
            aria-label="Toggle spoken replies"
            title={voiceOut ? 'Spoken replies on' : 'Spoken replies off'}
          >
            {voiceOut ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
        </div>
        {voiceNote && (
          <p className="relative px-5 pb-3 font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-danger">
            {voiceNote}
          </p>
        )}
      </div>

      {/* transcript */}
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {turns.length === 0 && (
          <div className="space-y-3 pt-2">
            <p className="font-sans text-[15px] font-light leading-relaxed text-bone-dim">
              Ask {ch.name.split(' ')[0]} anything about this situation. They answer from the onboarding material — and
              say so when it does not cover your question.
            </p>
          </div>
        )}

        {turns.map((t) => (
          <div key={t.id} className={t.role === 'player' ? 'flex justify-end' : ''}>
            {t.role === 'player' ? (
              <div className="max-w-[85%] border border-signal/25 bg-signal/[0.07] px-3.5 py-2.5">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-signal/70">you</span>
                  {t.mode === 'voice' && <Mic size={9} className="text-signal/70" />}
                </div>
                <p className="font-sans text-[14px] font-light leading-relaxed text-bone">{t.text}</p>
              </div>
            ) : (
              <div className="max-w-[92%]">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="h-[10px] w-[2px]" style={{ background: ch.accent }} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: ch.accent }}>
                    {ch.name.split(' ')[0]}
                  </span>
                  {t.grounded === false && <Chip tone="danger">no source · declined</Chip>}
                </div>
                <p className="font-sans text-[14.5px] font-light leading-[1.62] text-bone">{t.text}</p>
                {!!t.citations?.length && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {t.citations.map((id) => {
                      const k = resolveKnowledge(id)
                      return (
                        <span
                          key={id}
                          title={k ? `${k.rule}\n\n${k.source.doc} § ${k.source.section}` : id}
                          className="cursor-help border border-bone/12 px-1.5 py-[2px] font-mono text-[9px] uppercase tracking-[0.12em] text-bone-faint"
                        >
                          {id}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2">
            <span className="h-[10px] w-[2px]" style={{ background: ch.accent }} />
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="block h-[3px] w-[3px] rounded-full"
                  style={{ background: ch.accent }}
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.16 }}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      {/* live subtitle while speaking */}
      <AnimatePresence>
        {subtitle && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="shrink-0 border-t px-5 py-3"
            style={{ borderColor: `${ch.accent}33`, background: `${ch.accent}0D` }}
          >
            <div className="flex items-center gap-2">
              <span className="t-eyebrow" style={{ color: ch.accent }}>
                {voiceLabel(ttsTier())} · subtitles
              </span>
            </div>
            <p className="mt-1 font-sans text-[13.5px] font-light leading-snug text-bone">{subtitle}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* inspector */}
      <AnimatePresence>
        {inspect && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden border-t border-bone/10 bg-ink-900/70"
          >
            <div className="max-h-[44vh] overflow-y-auto px-5 py-4">
              <GroundingInspector reply={lastReply} resolveKnowledge={resolveKnowledge} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* composer */}
      <div className="shrink-0 border-t border-bone/10">
        <div className="flex items-center gap-1 px-5 pt-3">
          {(['text', 'voice'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors ${
                mode === m ? 'bg-bone/10 text-bone' : 'text-bone-faint hover:text-bone-dim'
              }`}
            >
              {m === 'text' ? <Keyboard size={11} /> : <Mic size={11} />}
              {m}
            </button>
          ))}
          <button
            onClick={() => setInspect((v) => !v)}
            className={`ml-auto flex items-center gap-1.5 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors ${
              inspect ? 'text-cyan' : 'text-bone-faint hover:text-bone-dim'
            }`}
          >
            <Terminal size={11} />
            inspect
            <ChevronDown size={10} className={inspect ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
        </div>

        {mode === 'text' ? (
          <div className="px-5 pb-5 pt-3">
            {turns.length < 3 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s, false)}
                    disabled={busy}
                    className="border border-bone/12 px-2.5 py-1.5 text-left font-sans text-[11.5px] font-light leading-snug text-bone-dim transition-colors hover:border-signal/40 hover:text-bone disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void send(input, false)
              }}
              className="flex items-center gap-2 border border-bone/15 px-3 focus-within:border-signal/50"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Ask ${ch.name.split(' ')[0]} anything…`}
                className="min-w-0 flex-1 bg-transparent py-3 font-sans text-[14px] font-light text-bone placeholder:text-bone-faint focus:outline-none"
              />
              <button
                type="submit"
                disabled={!input.trim() || busy}
                className="shrink-0 text-bone-faint transition-colors hover:text-signal disabled:opacity-30"
                aria-label="Send"
              >
                <CornerDownLeft size={15} />
              </button>
            </form>
          </div>
        ) : (
          <div className="px-5 pb-6 pt-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="t-eyebrow">{voiceLabel(mic.current?.tier ?? ttsTier())} pipeline</span>
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
                mic → stt → rag → llm → tts
              </span>
            </div>

            {/* waveform */}
            <div className="mb-4 flex h-[54px] items-center justify-center gap-[2px] border border-bone/10 bg-ink-900/50 px-3">
              {levels.map((l, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full transition-[height] duration-75"
                  style={{
                    height: `${Math.max(3, l * 46)}px`,
                    background: recording ? ch.accent : 'rgba(237,233,226,.18)',
                    opacity: recording ? 0.5 + l * 0.5 : 1,
                  }}
                />
              ))}
            </div>

            {(interim || recording) && (
              <p className="mb-3 min-h-[18px] font-sans text-[13px] font-light italic text-bone-dim">
                {interim || 'listening…'}
              </p>
            )}

            <button
              onClick={() => void toggleRecording()}
              disabled={busy}
              className={`flex w-full items-center justify-center gap-3 py-4 font-mono text-[11px] uppercase tracking-ultra transition-all duration-300 disabled:opacity-40 ${
                recording ? 'bg-danger/15 text-danger' : 'bg-bone/[0.06] text-bone hover:bg-bone/10'
              }`}
              style={recording ? { boxShadow: 'inset 0 0 0 1px rgba(255,77,77,.4)' } : undefined}
            >
              {recording ? (
                <>
                  <Square size={12} /> stop &amp; send
                </>
              ) : (
                <>
                  <Mic size={13} /> hold the floor — talk to {ch.name.split(' ')[0]}
                </>
              )}
            </button>

            {mic.current?.tier === 'simulated' && recording && (
              <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-bone-faint">
                no speech-to-text provider configured — transcript will be simulated. mic level above is real.
              </p>
            )}
          </div>
        )}
      </div>
    </motion.aside>
  )
}