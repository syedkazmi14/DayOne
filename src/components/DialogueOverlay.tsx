import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getCharacter } from '@/content/characters'
import type { Dialogue } from '@/types'
import { speak, stopAllSpeech } from '@/voice/voice'
import { CharacterPortrait } from './ui/CharacterPortrait'

/* ============================================================================
 * Subtitle layer for cinematic scenes: speaker card, typewriter reveal, and
 * click-anywhere-to-advance. Minimal chrome — the scene is the interface.
 * ========================================================================== */

const SPEED = 16 // ms per character

export function DialogueOverlay({
  line,
  index,
  total,
  onAdvance,
  voiceOn,
}: {
  line: Dialogue
  index: number
  total: number
  onAdvance: () => void
  voiceOn: boolean
}) {
  const ch = getCharacter(line.characterId)
  const isPlayer = line.characterId === 'you'
  const [shown, setShown] = useState(0)
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
    let handle: { stop(): void } | undefined
    void speak(line.line, ch).then((h) => (handle = h))
    return () => {
      handle?.stop()
      stopAllSpeech()
    }
  }, [line.line, voiceOn, isPlayer, ch])

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
              initial={{ opacity: 0, y: 24, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="hidden shrink-0 sm:block"
            >
              <CharacterPortrait character={ch} size={116} speaking={!complete} />
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
