import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getCharacter } from '@/content/characters'
import type { AssetRef, Dialogue } from '@/types'
import { playLineAsset, speak, stopAllSpeech, type SpeechHandle } from '@/voice/voice'
import { CharacterAvatar } from './ui/CharacterAvatar'

/* ============================================================================
 * Dialogue presentation — the half of the hybrid model that is NOT video.
 *
 * Background (SceneCanvas) + character sprite + name + line + voice, with a
 * little life in the sprite while it speaks. Far cheaper and more controllable
 * than generating a clip per line. Voice prefers the line's pre-rendered
 * ElevenLabs file, then live synthesis.
 * ========================================================================== */

const SPEED = 16 // ms per character

function Waveform({ active, color, bars = 9, className = '' }: { active: boolean; color: string; bars?: number; className?: string }) {
  return (
    <span className={`flex h-4 items-end gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <motion.span
          key={i}
          className="w-[3px] rounded-full"
          style={{ background: color }}
          animate={active ? { height: [3, 6 + ((i * 5) % 11), 4] } : { height: 3 }}
          transition={active ? { duration: 0.46 + (i % 4) * 0.08, repeat: Infinity, repeatType: 'mirror' } : { duration: 0.2 }}
        />
      ))}
    </span>
  )
}

export function DialogueOverlay({
  line,
  index,
  total,
  onAdvance,
  voiceOn,
  audio,
}: {
  line: Dialogue
  index: number
  total: number
  onAdvance: () => void
  voiceOn: boolean
  /** Pre-rendered voice for this line, if the Studio generated one. */
  audio?: AssetRef
}) {
  const ch = getCharacter(line.characterId)
  const isPlayer = line.characterId === 'you'
  const [shown, setShown] = useState(0)
  const [voicePlaying, setVoicePlaying] = useState(false)
  const complete = shown >= line.line.length
  const timer = useRef<number>()

  useEffect(() => {
    setShown(0)
    let i = 0
    timer.current = window.setInterval(() => {
      i += 1
      setShown(i)
      if (i >= line.line.length) window.clearInterval(timer.current)
    }, SPEED)
    return () => window.clearInterval(timer.current)
  }, [line.line])

  useEffect(() => {
    if (!voiceOn || isPlayer) return
    let handle: SpeechHandle | undefined
    let alive = true
    const start = audio?.url ? playLineAsset(audio.url, line.line, ch) : speak(line.line, ch)
    void start.then((h) => {
      handle = h
      if (!alive) return h.stop()
      setVoicePlaying(true)
      void h.done.then(() => alive && setVoicePlaying(false))
    })
    return () => {
      alive = false
      handle?.stop()
      stopAllSpeech()
      setVoicePlaying(false)
    }
  }, [line.line, voiceOn, isPlayer, ch, audio?.url])

  const speaking = !isPlayer && (!complete || voicePlaying)

  const skipOrAdvance = () => {
    if (!complete) {
      window.clearInterval(timer.current)
      setShown(line.line.length)
      return
    }
    onAdvance()
  }

  return (
    <div className="absolute inset-0 z-20 flex cursor-pointer items-end" onClick={skipOrAdvance}>
      <div className="w-full px-6 pb-[10vh] sm:px-12 lg:px-20">
        <div className="mx-auto flex max-w-5xl items-end gap-5 sm:gap-8">
          {!isPlayer && (
            <motion.div
              key={ch.id}
              initial={{ opacity: 0, x: -28, filter: 'blur(6px)' }}
              animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="relative hidden shrink-0 sm:block"
            >
              <div className="pointer-events-none absolute -inset-8 opacity-25 blur-3xl" style={{ background: ch.accent }} />
              <motion.div
                animate={speaking ? { y: [0, -3, 0] } : { y: 0 }}
                transition={speaking ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
                className="relative border"
                style={{ borderColor: `${ch.accent}55`, boxShadow: `0 30px 80px -30px ${ch.accent}99` }}
              >
                <CharacterAvatar character={ch} size={164} ratio={1.18} priority />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink-900/90 to-transparent" />
                <Waveform active={speaking} color={ch.accent} className="absolute bottom-2.5 left-1/2 -translate-x-1/2" />
              </motion.div>
            </motion.div>
          )}

          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${line.characterId}-${index}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="mb-2.5 flex items-center gap-3">
                  <span className="h-[14px] w-[2px]" style={{ background: ch.accent }} />
                  <span
                    className="font-mono text-[11px] uppercase tracking-ultra"
                    style={{ color: isPlayer ? '#8A857D' : ch.accent }}
                  >
                    {isPlayer ? 'YOU' : ch.name}
                  </span>
                  {!isPlayer && <span className="hidden font-mono text-[10px] text-bone-faint sm:inline">{ch.role}</span>}
                  {voicePlaying && <Waveform active color={ch.accent} bars={5} className="sm:hidden" />}
                </div>

                <p
                  className={`text-shadow-cine max-w-3xl ${
                    isPlayer
                      ? 'font-sans text-[17px] font-light italic leading-relaxed text-bone-dim sm:text-[19px]'
                      : 'font-sans text-[21px] font-medium leading-[1.35] text-bone sm:text-[27px]'
                  }`}
                >
                  {line.line.slice(0, shown)}
                  {!complete && <span className="ml-0.5 inline-block h-[0.95em] w-[3px] translate-y-[2px] bg-signal align-middle" />}
                </p>

                {line.direction && complete && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.15, duration: 0.5 }}
                    className="mt-3 max-w-2xl border-l border-bone/12 pl-3 font-sans text-[13px] font-light italic leading-relaxed text-bone-faint"
                  >
                    {line.direction}
                  </motion.p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* advance affordance */}
        <div className="mx-auto mt-7 flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className="block h-[2px] transition-all duration-300"
                style={{
                  width: i === index ? 20 : 10,
                  background: i <= index ? 'rgba(245,165,36,.8)' : 'rgba(237,233,226,.16)',
                }}
              />
            ))}
          </div>
          <motion.div
            animate={{ opacity: complete ? 1 : 0.3, x: complete ? [0, 4, 0] : 0 }}
            transition={{ x: { repeat: Infinity, duration: 1.6 }, opacity: { duration: 0.3 } }}
            className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-ultra text-bone-dim"
          >
            {complete ? 'continue' : 'skip'}
            <ChevronRight size={13} />
          </motion.div>
        </div>
      </div>
    </div>
  )
}
