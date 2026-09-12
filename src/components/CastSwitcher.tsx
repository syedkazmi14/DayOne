import { ChevronLeft, ChevronRight, Loader2, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { characterGroups, groupCast, groupIndex } from '@/content/characterGroups'
import { useGame } from '@/engine/gameStore'
import type { Character } from '@/types'
import { speak, stopAllSpeech, type SpeechHandle } from '@/voice/voice'
import { CharacterAvatar } from './ui/CharacterAvatar'

/* ============================================================================
 * CAST SWITCHER — the compact roster control in the hero corner.
 *
 * Four small portraits, the group name, and a pair of arrows to move between
 * rosters. That is the whole surface: the episode shelf below reads the same
 * selected group, so switching here reshelves the episodes.
 *
 * Rendered from src/content/characterGroups.ts, so it does not know how many
 * groups exist. Clicking a character selects them and previews their
 * ElevenLabs voice; which voice that is comes entirely from the character's
 * voiceProfileId, so casting a new character needs no change here.
 * ========================================================================== */

const PORTRAIT = 62

export function CastSwitcher({ className = '' }: { className?: string }) {
  const { state, dispatch, group } = useGame()
  const index = groupIndex(group.id)
  const cast = useMemo(() => groupCast(group), [group])

  const [previewOn, setPreviewOn] = useState(true)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const playing = useRef<SpeechHandle | null>(null)

  /** Wraps around, so two arrows are enough to reach any roster. */
  const go = useCallback(
    (delta: number) => {
      const next = (index + delta + characterGroups.length) % characterGroups.length
      dispatch({ type: 'SELECT_GROUP', groupId: characterGroups[next].id })
    },
    [index, dispatch],
  )

  useEffect(
    () => () => {
      playing.current?.stop()
      stopAllSpeech()
    },
    [],
  )

  /**
   * Select a character and hear them. Every failure mode — no profile, no API
   * key, upstream error, blocked playback — comes back on the handle as a
   * one-line note; none of them can throw here.
   */
  const select = useCallback(
    async (ch: Character) => {
      dispatch({ type: 'SELECT_CHARACTER', characterId: ch.id })
      if (!previewOn) return

      playing.current?.stop()
      stopAllSpeech()
      setVoiceNote(null)
      setLoadingId(ch.id)
      try {
        const handle = await speak(ch.greetings[0] ?? ch.tagline, ch)
        playing.current = handle
        if (handle.failureMessage) setVoiceNote(handle.failureMessage)
        setLoadingId(null)
        setSpeakingId(ch.id)
        await handle.done
      } catch {
        // speak() is contracted not to reject; this is belt and braces.
        setVoiceNote('Could not play a voice preview.')
      } finally {
        setLoadingId((id) => (id === ch.id ? null : id))
        setSpeakingId((id) => (id === ch.id ? null : id))
      }
    },
    [dispatch, previewOn],
  )

  const toggleMute = () =>
    setPreviewOn((v) => {
      if (v) {
        playing.current?.stop()
        stopAllSpeech()
        setSpeakingId(null)
        setLoadingId(null)
      }
      return !v
    })

  return (
    <div
      role="group"
      aria-label="Character roster"
      onKeyDown={(e) => {
        const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (!delta) return
        e.preventDefault()
        go(delta)
      }}
      /* glass backing: the hero still behind this can be any brightness, and
       * 8px mono labels over show artwork are otherwise unreadable. */
      className={`glass w-fit p-2.5 ${className}`}
    >
      {/* group name + switcher */}
      <div className="mb-2 flex items-center justify-end gap-1.5">
        <button
          onClick={toggleMute}
          aria-pressed={previewOn}
          title={previewOn ? 'Voice previews on' : 'Voice previews off'}
          className={`mr-auto p-1 transition-colors ${previewOn ? 'text-signal' : 'text-bone-faint hover:text-bone'}`}
        >
          {previewOn ? <Volume2 size={12} /> : <VolumeX size={12} />}
        </button>

        <button
          onClick={() => go(-1)}
          aria-label="Previous roster"
          className="p-1 text-bone-dim transition-colors hover:text-signal"
        >
          <ChevronLeft size={14} />
        </button>
        <span
          aria-live="polite"
          className="text-center font-mono text-[9px] uppercase tracking-[0.14em]"
          style={{ color: group.accent }}
        >
          {group.name}
        </span>
        <button
          onClick={() => go(1)}
          aria-label="Next roster"
          className="p-1 text-bone-dim transition-colors hover:text-signal"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* the four portraits. Labelled so the row is addressable on its own —
        * the mute toggle above is also an aria-pressed button. */}
      <div role="group" aria-label="Characters" className="flex items-end justify-end gap-1.5">
        {cast.map((ch) => {
          const selected = state.selectedCharacterId === ch.id
          const speaking = speakingId === ch.id
          const loading = loadingId === ch.id
          return (
            <button
              key={ch.id}
              onClick={() => void select(ch)}
              aria-pressed={selected}
              title={`${ch.name} — ${ch.role}`}
              className="group/card text-center"
            >
              <span
                className={`relative block overflow-hidden border transition-colors ${
                  selected ? 'border-signal' : 'border-bone/12 group-hover/card:border-bone/40'
                }`}
                style={{ width: PORTRAIT, height: PORTRAIT }}
              >
                <CharacterAvatar
                  character={ch}
                  fill
                  priority
                  speaking={speaking}
                  className="transition-transform duration-500 group-hover/card:scale-105"
                />
                {(loading || speaking) && (
                  <span className="absolute inset-x-0 bottom-0 flex justify-center bg-ink-900/75 py-[2px]">
                    {loading ? (
                      <Loader2 size={8} className="animate-spin" style={{ color: ch.accent }} />
                    ) : (
                      <Volume2 size={8} style={{ color: ch.accent }} />
                    )}
                  </span>
                )}
              </span>
              <span
                className={`mt-1 block font-mono text-[8px] uppercase tracking-[0.14em] ${
                  selected ? '' : 'text-bone-dim'
                }`}
                style={selected ? { color: ch.accent } : undefined}
              >
                {ch.name.split(' ')[0]}
              </span>
            </button>
          )
        })}
      </div>

      {voiceNote && (
        <p className="mt-1.5 max-w-[15rem] text-right font-mono text-[8px] uppercase leading-relaxed tracking-[0.12em] text-danger">
          {voiceNote}
        </p>
      )}
    </div>
  )
}
