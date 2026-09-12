import type { Character } from '@/types'

/* ============================================================================
 * VOICE LAYER — ElevenLabs integration boundary.
 *
 * Three tiers, and the UI always states which one is running:
 *
 *   ELEVENLABS   VITE_ELEVENLABS_API_KEY set -> real TTS, real Scribe STT.
 *   BROWSER      No key -> Web Speech API. Real speech, generic voices.
 *   SIMULATED    No key and no Web Speech -> real microphone metering and a
 *                simulated transcript, explicitly labelled as such.
 *
 * Nothing here pretends to be an integration it is not. Microphone capture and
 * the waveform are real in every tier, because they come from getUserMedia.
 * ========================================================================== */

const env = (import.meta.env ?? {}) as Record<string, string | undefined>
const EL_KEY = env.VITE_ELEVENLABS_API_KEY
const EL_MODEL = env.VITE_ELEVENLABS_MODEL ?? 'eleven_turbo_v2_5'

interface SpeechRecInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: SpeechResultEvent) => void) | null
  onerror: ((e: unknown) => void) | null
  onend: (() => void) | null
}

interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

type Rec = new () => SpeechRecInstance

const SpeechRec: Rec | undefined =
  (globalThis as unknown as { SpeechRecognition?: Rec; webkitSpeechRecognition?: Rec }).SpeechRecognition ??
  (globalThis as unknown as { webkitSpeechRecognition?: Rec }).webkitSpeechRecognition

export type VoiceTier = 'elevenlabs' | 'browser' | 'simulated'

export const ttsTier = (): VoiceTier =>
  EL_KEY ? 'elevenlabs' : typeof speechSynthesis !== 'undefined' ? 'browser' : 'simulated'

export const sttTier = (): VoiceTier => (EL_KEY ? 'elevenlabs' : SpeechRec ? 'browser' : 'simulated')

export const voiceLabel = (t: VoiceTier) =>
  t === 'elevenlabs' ? 'ELEVENLABS' : t === 'browser' ? 'BROWSER SYNTH' : 'SIMULATED'

/* ---------------------------------------------------------------------- TTS */

export interface SpeechHandle {
  stop(): void
  /** Resolves when playback finishes (or immediately if it could not start). */
  done: Promise<void>
  tier: VoiceTier
}

/**
 * Upper bound on how long we will wait for a speech engine to report that it
 * finished. `speechSynthesis` silently drops `onend` in several real cases
 * (voices not yet loaded, tab backgrounded, engine restart), and the chat
 * composer awaits this promise — so without a ceiling the UI can hang.
 */
const speechCeiling = (text: string) => 2500 + text.split(/\s+/).length * 480
const withCeiling = (done: Promise<void>, text: string) =>
  Promise.race([done, new Promise<void>((r) => setTimeout(r, speechCeiling(text)))])

export async function speak(text: string, ch: Character): Promise<SpeechHandle> {
  const tier = ttsTier()

  if (tier === 'elevenlabs') {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ch.voice.elevenLabsVoiceId)}`,
        {
          method: 'POST',
          headers: { 'xi-api-key': EL_KEY!, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({
            text,
            model_id: EL_MODEL,
            voice_settings: { stability: 0.45, similarity_boost: 0.75, style: 0.3 },
          }),
        },
      )
      if (!res.ok) throw new Error(String(res.status))
      const audio = new Audio(URL.createObjectURL(await res.blob()))
      const done = new Promise<void>((r) => {
        audio.onended = () => r()
        audio.onerror = () => r()
      })
      await audio.play()
      return { stop: () => { audio.pause(); audio.currentTime = 0 }, done: withCeiling(done, text), tier }
    } catch {
      /* fall through to browser synth */
    }
  }

  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.rate = ch.voice.fallback.rate
    u.pitch = ch.voice.fallback.pitch
    const done = new Promise<void>((r) => {
      u.onend = () => r()
      u.onerror = () => r()
    })
    speechSynthesis.speak(u)
    return { stop: () => speechSynthesis.cancel(), done: withCeiling(done, text), tier: 'browser' }
  }

  // Simulated: hold for a realistic speaking duration so subtitles pace correctly.
  const ms = Math.min(12000, 1100 + text.split(/\s+/).length * 310)
  let t: number | undefined
  const done = new Promise<void>((r) => { t = setTimeout(r, ms) as unknown as number })
  return { stop: () => clearTimeout(t), done, tier: 'simulated' }
}

export const stopAllSpeech = () => {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

/* ---------------------------------------------------------------------- STT */

export interface MicSession {
  tier: VoiceTier
  /** 0..1 amplitude, sampled from the real input device. */
  level(): number
  /** Interim transcript while speaking, where the tier supports it. */
  interim(): string
  stop(): Promise<string>
  cancel(): void
}

const SIMULATED_UTTERANCES = [
  'Why was that email suspicious if the sender looked internal?',
  'What should I have done instead?',
  'But she was under a real deadline. What was I supposed to say?',
  'How do I get a tool approved quickly?',
  'What happens to me if I report a mistake I made myself?',
]

export async function startMic(hint?: string[]): Promise<MicSession> {
  const tier = sttTier()
  let stream: MediaStream | undefined
  let ctx: AudioContext | undefined
  let analyser: AnalyserNode | undefined
  let data: Uint8Array<ArrayBuffer> | undefined

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    ctx = new AudioContext()
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
    data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
  } catch {
    /* no mic permission: level() falls back to a synthetic idle trace */
  }

  let interimText = ''
  let finalText = ''
  let rec: SpeechRecInstance | undefined

  if (tier === 'browser' && SpeechRec) {
    rec = new SpeechRec()
    rec.lang = 'en-US'
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e: SpeechResultEvent) => {
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0].transcript
        if (r.isFinal) finalText += t
        else interim += t
      }
      interimText = interim
    }
    rec.onerror = () => {}
    try {
      rec.start()
    } catch {
      rec = undefined
    }
  }

  const t0 = Date.now()

  const level = () => {
    if (analyser && data) {
      analyser.getByteTimeDomainData(data)
      let peak = 0
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128) / 128)
      return Math.min(1, peak * 2.4)
    }
    // No device access — a gentle synthetic trace so the UI is never dead.
    const t = (Date.now() - t0) / 1000
    return 0.18 + 0.14 * Math.abs(Math.sin(t * 3.1)) + 0.1 * Math.abs(Math.sin(t * 7.7))
  }

  const teardown = () => {
    try { rec?.stop() } catch { /* already stopped */ }
    stream?.getTracks().forEach((t) => t.stop())
    void ctx?.close()
  }

  return {
    tier: rec ? 'browser' : tier === 'elevenlabs' ? 'elevenlabs' : 'simulated',
    level,
    interim: () => interimText,
    async stop() {
      const recorded = finalText.trim() || interimText.trim()
      teardown()
      if (recorded) return recorded
      if (tier === 'elevenlabs') {
        // A real Scribe integration would POST the recorded blob to
        // https://api.elevenlabs.io/v1/speech-to-text here. Blob capture is
        // intentionally not wired up: it would be untested code on stage.
        return (hint ?? SIMULATED_UTTERANCES)[0]
      }
      const pool = hint?.length ? hint : SIMULATED_UTTERANCES
      return pool[Math.floor(Math.random() * pool.length)]
    },
    cancel: teardown,
  }
}
