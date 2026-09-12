import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Loader2, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { characterGroups, groupCast } from '@/content/characterGroups'
import { useGame } from '@/engine/gameStore'
import type { Character, CharacterGroup } from '@/types'
import { speak, stopAllSpeech, type SpeechHandle } from '@/voice/voice'
import { resolveVoiceProfile } from '@/voice/voiceProfiles'
import { Eyebrow } from './ui/Bits'
import { CharacterAvatar } from './ui/CharacterAvatar'

/* ============================================================================
 * ROSTER CAROUSEL
 *
 * One horizontally-swipeable panel per character group, rendered from
 * src/content/characterGroups.ts. It does not know how many groups exist.
 *
 * WHY NATIVE SCROLL RATHER THAN A DRAG LIBRARY
 * The track is a real overflow-x container with CSS scroll snapping. That buys
 * momentum scrolling on iOS, trackpad and shift-wheel on desktop, correct
 * scrollbar semantics, and keyboard scrolling — for free and with no new
 * dependency. On top of it:
 *   · pointer drag-to-pan for mouse users (touch is left to the browser,
 *     which already does it better than JS can)
 *   · arrows and dots, both real buttons
 *   · ArrowLeft / ArrowRight / Home / End on the track
 *   · the resting panel is reported up so the hero and episode shelf follow
 * framer-motion is only used for the entrance and hover motion, as elsewhere.
 *
 * Selecting a character dispatches SELECT_CHARACTER and previews their
 * ElevenLabs voice; which voice that is comes entirely from the character's
 * voiceProfileId, so a new character needs no change here.
 * ========================================================================== */

const SNAP_EPSILON = 8

export function CharacterCarousel() {
  const { state, dispatch } = useGame()
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(() => Math.max(0, characterGroups.findIndex((g) => g.id === state.groupId)))
  const [dragging, setDragging] = useState(false)
  const [previewOn, setPreviewOn] = useState(true)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [voiceNote, setVoiceNote] = useState<string | null>(null)
  const playing = useRef<SpeechHandle | null>(null)
  const dots = useRef<(HTMLButtonElement | null)[]>([])

  /* --------------------------------------------------------------- scrolling */

  const scrollToIndex = useCallback((i: number, behavior: ScrollBehavior = 'smooth') => {
    const el = track.current
    if (!el) return
    const clamped = Math.max(0, Math.min(characterGroups.length - 1, i))
    // scrollTo is missing in some embedded webviews; assigning still works.
    if (el.scrollTo) el.scrollTo({ left: clamped * el.clientWidth, behavior })
    else el.scrollLeft = clamped * el.clientWidth
  }, [])

  // Restore the panel the rest of the app thinks we are on (e.g. returning
  // from an episode). Layout effect so it lands before first paint.
  useLayoutEffect(() => {
    const i = characterGroups.findIndex((g) => g.id === state.groupId)
    if (i >= 0 && i !== index) {
      setIndex(i)
      scrollToIndex(i, 'auto')
    }
    // Only reacts to external group changes, never to our own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.groupId])

  // Report the resting panel upward. rAF-throttled so a flick does not
  // dispatch on every scroll event.
  useEffect(() => {
    const el = track.current
    if (!el) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const width = el.clientWidth || 1
        const next = Math.round(el.scrollLeft / width)
        if (Math.abs(el.scrollLeft - next * width) > SNAP_EPSILON) return
        if (next === index) return
        setIndex(next)
        const group = characterGroups[next]
        if (group) dispatch({ type: 'SELECT_GROUP', groupId: group.id })
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [index, dispatch])

  // Keep the resting panel aligned when the viewport resizes.
  useEffect(() => {
    const onResize = () => scrollToIndex(index, 'auto')
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [index, scrollToIndex])

  /** Move to an absolute panel index and tell the rest of the app. */
  const goTo = useCallback(
    (i: number) => {
      const next = Math.max(0, Math.min(characterGroups.length - 1, i))
      setIndex(next)
      dispatch({ type: 'SELECT_GROUP', groupId: characterGroups[next].id })
      scrollToIndex(next)
    },
    [dispatch, scrollToIndex],
  )
  const go = useCallback((delta: number) => goTo(index + delta), [goTo, index])

  /* ------------------------------------------------- pointer drag (mouse only) */

  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Touch already has native momentum + snapping; hijacking it feels worse.
    if (e.pointerType === 'touch' || !track.current) return
    drag.current = { x: e.clientX, left: track.current.scrollLeft, moved: false }
    setDragging(true)
    // Without capture, moving the cursor over an inert neighbouring panel
    // stops delivering pointermove and the drag dies mid-swipe.
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* not supported (older webview, test renderer) — drag still works */
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !track.current) return
    const dx = e.clientX - d.x
    if (Math.abs(dx) > 4) d.moved = true
    track.current.scrollLeft = d.left - dx
  }
  const endDrag = () => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d || !track.current) return
    // Snap to whichever panel the release landed nearest.
    const width = track.current.clientWidth || 1
    scrollToIndex(Math.round(track.current.scrollLeft / width))
  }
  /** Suppresses the click that would otherwise fire at the end of a drag. */
  const swallowClick = () => !!drag.current?.moved

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      go(1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      go(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      goTo(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      goTo(characterGroups.length - 1)
    }
  }

  /* ------------------------------------------------------------ voice preview */

  useEffect(
    () => () => {
      playing.current?.stop()
      stopAllSpeech()
    },
    [],
  )

  /**
   * Select a character and hear them. Every failure mode — no profile, no
   * API key, upstream error, blocked playback — comes back on the handle and
   * is shown as a one-line note; none of them can throw here.
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

  const toggled = () => {
    setPreviewOn((v) => {
      if (v) {
        playing.current?.stop()
        stopAllSpeech()
        setSpeakingId(null)
        setLoadingId(null)
      }
      return !v
    })
  }

  const active = characterGroups[index]

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Character rosters"
      className="relative select-none"
    >
      {/* header */}
      <div className="mb-4 flex items-end justify-between gap-4 px-6 sm:px-12 lg:px-20">
        <div className="min-w-0">
          <Eyebrow>choose your cast</Eyebrow>
          <p className="mt-1 max-w-xl font-sans text-[13px] font-light leading-snug text-bone-faint">
            Swipe, drag or use the arrow keys. Tap a character to hear their voice — the episode you start uses the
            cast you land on.
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={toggled}
            aria-pressed={previewOn}
            title={previewOn ? 'Voice previews on' : 'Voice previews off'}
            className={`p-2 transition-colors ${previewOn ? 'text-signal' : 'text-bone-faint hover:text-bone'}`}
          >
            {previewOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
          </button>
          <button
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Previous roster"
            className="border border-bone/15 p-2 text-bone-dim transition-colors hover:border-signal/50 hover:text-signal disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => go(1)}
            disabled={index === characterGroups.length - 1}
            aria-label="Next roster"
            className="border border-bone/15 p-2 text-bone-dim transition-colors hover:border-signal/50 hover:text-signal disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>

      {/* track */}
      <div
        ref={track}
        tabIndex={0}
        role="group"
        aria-label={`${active.name}, roster ${index + 1} of ${characterGroups.length}`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => drag.current && endDrag()}
        className={`no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain outline-none focus-visible:ring-1 focus-visible:ring-signal/40 ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ scrollbarWidth: 'none' }}
      >
        {characterGroups.map((group, i) => (
          <GroupPanel
            key={group.id}
            group={group}
            visible={i === index}
            priority={i === 0}
            selectedId={state.selectedCharacterId}
            speakingId={speakingId}
            loadingId={loadingId}
            onSelect={(ch) => {
              if (swallowClick()) return
              void select(ch)
            }}
          />
        ))}
      </div>

      {/* dots + voice note */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-6 sm:px-12 lg:px-20">
        <div
          className="flex items-center gap-2"
          role="tablist"
          aria-label="Rosters"
          onKeyDown={(e) => {
            const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
            if (!delta) return
            e.preventDefault()
            const next = Math.max(0, Math.min(characterGroups.length - 1, index + delta))
            goTo(next)
            // Roving tabindex: move focus with the selection, as tabs should.
            dots.current[next]?.focus()
          }}
        >
          {characterGroups.map((group, i) => (
            <button
              key={group.id}
              ref={(el) => {
                dots.current[i] = el
              }}
              id={`roster-tab-${group.id}`}
              role="tab"
              aria-selected={i === index}
              aria-controls={`roster-panel-${group.id}`}
              aria-label={group.name}
              tabIndex={i === index ? 0 : -1}
              onClick={() => goTo(i)}
              className="group py-2"
            >
              <span
                className="block h-[3px] transition-all duration-300"
                style={{
                  width: i === index ? 34 : 14,
                  background: i === index ? group.accent : 'rgba(237,233,226,.18)',
                }}
              />
            </button>
          ))}
        </div>

        {voiceNote && (
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-danger">{voiceNote}</span>
        )}
      </div>
    </section>
  )
}

/* -------------------------------------------------------------------- panel */

interface PanelProps {
  group: CharacterGroup
  visible: boolean
  priority: boolean
  selectedId: string | null
  speakingId: string | null
  loadingId: string | null
  onSelect: (ch: Character) => void
}

function GroupPanel({ group, visible, priority, selectedId, speakingId, loadingId, onSelect }: PanelProps) {
  const cast = useMemo(() => groupCast(group), [group])

  return (
    <div
      id={`roster-panel-${group.id}`}
      role="tabpanel"
      aria-labelledby={`roster-tab-${group.id}`}
      className="w-full shrink-0 snap-center px-6 sm:px-12 lg:px-20"
      aria-hidden={!visible}
      // Panels off-screen must not be tabbable, or Tab walks all 16 cards.
      {...(visible ? {} : { inert: '' as unknown as boolean })}
    >
      <div
        className="relative overflow-hidden border border-bone/10 p-5 sm:p-7"
        style={{ background: `linear-gradient(125deg, ${group.accent}0F, transparent 46%)` }}
      >
        <div
          className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full opacity-40 blur-3xl"
          style={{ background: `radial-gradient(circle, ${group.accent}33, transparent 68%)` }}
        />

        <div className="relative mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 className="t-display text-[clamp(1.8rem,5vw,2.9rem)] leading-none text-bone">{group.name}</h2>
          <span className="h-px min-w-6 flex-1" style={{ background: `${group.accent}44` }} />
          <span className="font-mono text-[9px] uppercase tracking-[0.18em]" style={{ color: group.accent }}>
            {cast.length} characters
          </span>
        </div>
        <p className="relative mb-6 max-w-2xl font-sans text-[13.5px] font-light leading-relaxed text-bone-dim">
          {group.tagline}
        </p>

        <div className="relative grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {cast.map((ch, i) => {
            const selected = selectedId === ch.id
            const speaking = speakingId === ch.id
            const loading = loadingId === ch.id
            const profile = resolveVoiceProfile(ch.voiceProfileId)
            return (
              <motion.button
                key={ch.id}
                type="button"
                aria-pressed={selected}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: visible ? 0.06 + i * 0.07 : 0, duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => onSelect(ch)}
                /* Hover lift is CSS, not a framer gesture: no per-card
                 * listeners, and it still works under a test renderer. */
                className={`group relative flex flex-col overflow-hidden border text-left transition-[transform,border-color] duration-300 hover:-translate-y-1 ${
                  selected ? 'border-signal/70' : 'border-bone/12 hover:border-bone/35'
                }`}
              >
                <div className="relative aspect-square w-full overflow-hidden">
                  <CharacterAvatar
                    character={ch}
                    fill
                    priority={priority}
                    speaking={speaking}
                    className="transition-transform duration-700 group-hover:scale-[1.05]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-900 via-ink-900/25 to-transparent" />

                  {(loading || speaking) && (
                    <span
                      className="absolute right-2 top-2 flex items-center gap-1.5 bg-ink-900/80 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.14em]"
                      style={{ color: ch.accent }}
                    >
                      {loading ? <Loader2 size={9} className="animate-spin" /> : <Volume2 size={9} />}
                      {loading ? 'voice…' : 'speaking'}
                    </span>
                  )}
                </div>

                <div className="relative -mt-7 px-3 pb-3">
                  <div
                    className="font-sans text-[12.5px] font-bold uppercase leading-tight tracking-[0.05em]"
                    style={{ color: ch.accent }}
                  >
                    {ch.name}
                  </div>
                  <div className="mt-1 font-mono text-[8.5px] uppercase leading-snug tracking-[0.12em] text-bone-faint">
                    {ch.role}
                  </div>
                  <p className="mt-2 line-clamp-2 font-sans text-[11.5px] font-light italic leading-snug text-bone-dim">
                    {ch.tagline}
                  </p>
                  <div className="mt-2 flex items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.12em] text-bone-faint">
                    <Volume2 size={8} />
                    <span className="truncate">{profile.label}</span>
                  </div>
                </div>
              </motion.button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
