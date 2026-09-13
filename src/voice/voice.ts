import type { Character } from '@/types'
import { resolveVoiceProfile, type VoiceProfile } from './voiceProfiles'

/* ============================================================================
 * VOICE LAYER — ElevenLabs integration boundary.
 *
 * Four tiers, and the UI always states which one is running:
 *
 *   ELEVENLABS · PROXY    server/voiceProxy.mjs is up with ELEVENLABS_API_KEY.
 *                         The preferred path: the key stays server-side.
 *   ELEVENLABS · DIRECT   legacy demo path — VITE_ELEVENLABS_API_KEY in the
 *                         browser bundle. Kept for offline demos; never ship it.
 *   BROWSER               no provider -> Web Speech API. Real speech, generic
 *                         voices, shaped per character by the voice profile.
 *   SIMULATED             no provider and no Web Speech -> real microphone
 *                         metering and a simulated transcript, labelled as such.
 *
 * Nothing here pretends to be an integration it is not. Microphone capture and
 * the waveform are real in every tier, because they come from getUserMedia.
 *
 * Which voice a character speaks with is never decided here: `speak()` resolves
 * `character.voiceProfileId` through src/voice/voiceProfiles.ts. Selecting a
 * character is therefore all it takes to change the voice.
 * ========================================================================== */

const env = (import.meta.env ?? {}) as Record<string, string | undefined>

/** Legacy browser-side key. Present only so existing demo setups keep working. */
const DIRECT_KEY = env.VITE_ELEVENLABS_API_KEY
const MODEL = env.VITE_ELEVENLABS_MODEL ?? 'eleven_turbo_v2_5'
/** Where the server-side proxy lives. Same-origin in dev via the Vite proxy. */
const PROXY_BASE = (env.VITE_VOICE_PROXY_URL ?? '/api/voice').replace(/\/$/, '')

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
export type VoiceProvider = 'proxy' | 'direct' | 'none'

/* ------------------------------------------------- provider discovery (async) */

/**
 * Whether the proxy is up and holding a key can only be known at runtime, so
 * it is probed once and cached. Callers read the cached answer synchronously
 * (so the existing sync `ttsTier()` contract is unchanged) and can subscribe to
 * be told when the probe lands.
 */
let proxyReady: boolean | null = null
let probe: Promise<boolean> | null = null
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((l) => l())

export function subscribeVoiceStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function probeVoiceProvider(): Promise<boolean> {
  if (probe) return probe
  probe = (async () => {
    if (typeof fetch !== 'function') return false
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 2500)
      const res = await fetch(`${PROXY_BASE}/health`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (!res.ok) return false
      const body = (await res.json()) as { configured?: boolean }
      return !!body.configured
    } catch {
      // No proxy in this deployment (static hosting, a test harness, offline).
      return false
    }
  })()
    .then((ok) => {
      proxyReady = ok
      notify()
      return ok
    })
    .catch(() => {
      proxyReady = false
      notify()
      return false
    })
  return probe
}

// Kick the probe off at module load in a browser; harmless if it fails.
if (typeof window !== 'undefined') void probeVoiceProvider()

export const voiceProvider = (): VoiceProvider => (proxyReady ? 'proxy' : DIRECT_KEY ? 'direct' : 'none')

/** True until the proxy probe has resolved — lets the UI avoid claiming a tier. */
export const voiceStatusPending = () => proxyReady === null && !DIRECT_KEY

export const ttsTier = (): VoiceTier =>
  voiceProvider() !== 'none' ? 'elevenlabs' : typeof speechSynthesis !== 'undefined' ? 'browser' : 'simulated'

export const sttTier = (): VoiceTier =>
  voiceProvider() !== 'none' ? 'elevenlabs' : SpeechRec ? 'browser' : 'simulated'

export const voiceLabel = (t: VoiceTier) => {
  if (t !== 'elevenlabs') return t === 'browser' ? 'BROWSER SYNTH' : 'SIMULATED'
  return voiceProvider() === 'direct' ? 'ELEVENLABS · DIRECT' : 'ELEVENLABS'
}

/* ---------------------------------------------------------------------- TTS */

export type SpeechFailure = 'not_configured' | 'no_voice' | 'api_error' | 'playback_error'

export interface SpeechHandle {
  stop(): void
  /** Resolves when playback finishes (or immediately if it could not start). */
  done: Promise<void>
  tier: VoiceTier
  /** Which voice profile drove this utterance. */
  profile: VoiceProfile
  /**
   * Set when the preferred tier failed and something else spoke instead.
   * Never throws: the caller gets working audio, plus a reason to surface.
   */
  failure?: SpeechFailure
  /** One short line, safe to show a player. */
  failureMessage?: string
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

/** Wraps a decoded clip in a handle, or reports why playback never started. */
async function playBlob(
  blob: Blob,
  text: string,
  profile: VoiceProfile,
): Promise<SpeechHandle | { playbackError: true }> {
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  const release = () => URL.revokeObjectURL(url)
  const done = new Promise<void>((r) => {
    audio.onended = () => {
      release()
      r()
    }
    audio.onerror = () => {
      release()
      r()
    }
  })
  try {
    await audio.play()
  } catch {
    // Autoplay blocked, decode failure, or no output device.
    release()
    return { playbackError: true }
  }
  return {
    stop: () => {
      audio.pause()
      audio.currentTime = 0
      release()
    },
    done: withCeiling(done, text),
    tier: 'elevenlabs',
    profile,
  }
}

/** Browser speech engine, shaped by the character's voice profile. */
function speakWithBrowser(text: string, profile: VoiceProfile, failure?: SpeechFailure, failureMessage?: string): SpeechHandle {
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate = profile.fallback.rate
  u.pitch = profile.fallback.pitch
  const done = new Promise<void>((r) => {
    u.onend = () => r()
    u.onerror = () => r()
  })
  speechSynthesis.speak(u)
  return { stop: () => speechSynthesis.cancel(), done: withCeiling(done, text), tier: 'browser', profile, failure, failureMessage }
}

/** Last resort: hold for a realistic duration so subtitles still pace. */
function speakSimulated(text: string, profile: VoiceProfile, failure?: SpeechFailure, failureMessage?: string): SpeechHandle {
  const ms = Math.min(12000, 1100 + text.split(/\s+/).length * 310)
  let t: ReturnType<typeof setTimeout> | undefined
  const done = new Promise<void>((r) => {
    t = setTimeout(r, ms)
  })
  return { stop: () => clearTimeout(t), done, tier: 'simulated', profile, failure, failureMessage }
}

const degrade = (text: string, profile: VoiceProfile, failure: SpeechFailure, message: string): SpeechHandle =>
  typeof speechSynthesis !== 'undefined'
    ? speakWithBrowser(text, profile, failure, message)
    : speakSimulated(text, profile, failure, message)

/**
 * Speak `text` as `ch`. Resolves the character's voice profile, then walks the
 * tiers down until something can speak. It never rejects and never throws:
 * every failure comes back as a working handle carrying a `failure` reason, so
 * a dead API key degrades the voice rather than taking the chat panel with it.
 */
export async function speak(text: string, ch: Character): Promise<SpeechHandle> {
  const profile = resolveVoiceProfile(ch.voiceProfileId)
  const provider = voiceProvider()

  if (provider !== 'none' && !profile.voiceId)
    return degrade(text, profile, 'no_voice', `No ElevenLabs voice is configured for ${ch.name}.`)

  if (provider === 'proxy') {
    try {
      const res = await fetch(`${PROXY_BASE}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId: profile.voiceId,
          fallbackVoiceId: profile.fallbackVoiceId,
          settings: profile.settings,
          modelId: profile.modelId,
        }),
      })
      if (!res.ok) {
        if (res.status === 503) {
          // Proxy lost its key: stop claiming the ElevenLabs tier.
          proxyReady = false
          notify()
          return degrade(text, profile, 'not_configured', 'Voice service has no API key — using the browser voice.')
        }
        throw new Error(String(res.status))
      }
      const handle = await playBlob(await res.blob(), text, profile)
      if ('playbackError' in handle)
        return degrade(text, profile, 'playback_error', 'Audio playback was blocked — using the browser voice.')
      return handle
    } catch {
      return degrade(text, profile, 'api_error', 'Voice service did not respond — using the browser voice.')
    }
  }

  if (provider === 'direct') {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(profile.voiceId)}`,
        {
          method: 'POST',
          headers: { 'xi-api-key': DIRECT_KEY!, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({ text, model_id: MODEL, voice_settings: profile.settings }),
        },
      )
      if (!res.ok) throw new Error(String(res.status))
      const handle = await playBlob(await res.blob(), text, profile)
      if ('playbackError' in handle)
        return degrade(text, profile, 'playback_error', 'Audio playback was blocked — using the browser voice.')
      return handle
    } catch {
      return degrade(text, profile, 'api_error', 'ElevenLabs request failed — using the browser voice.')
    }
  }

  if (typeof speechSynthesis !== 'undefined') return speakWithBrowser(text, profile)
  return speakSimulated(text, profile)
}

/**
 * Play a line pre-rendered at authoring time (Scene.assets.audio). If the file
 * will not load or play, the line is synthesised live instead — the same
 * degrade-never-throw contract as `speak`.
 */
export async function playLineAsset(url: string, text: string, ch: Character): Promise<SpeechHandle> {
  const profile = resolveVoiceProfile(ch.voiceProfileId)
  try {
    const res = await fetch(url)
    if (res.ok) {
      const handle = await playBlob(await res.blob(), text, profile)
      if (!('playbackError' in handle)) return handle
    }
  } catch {
    /* fall through to live synthesis */
  }
  return speak(text, ch)
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
  'But he was under a real deadline. What was I supposed to say?',
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

  // Browser recognition runs in every tier that has it: it is the live transcript
  // while speaking, and the fallback if a Scribe upload fails.
  if (SpeechRec) {
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

  /* With ElevenLabs behind the proxy, the recording itself is what gets
   * transcribed (Scribe, through /api/voice/stt — the key never leaves the proxy). */
  let recorder: MediaRecorder | undefined
  const chunks: Blob[] = []
  if (tier === 'elevenlabs' && stream && typeof MediaRecorder !== 'undefined') {
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t))
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      recorder.start()
    } catch {
      recorder = undefined
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
    try {
      rec?.stop()
    } catch {
      /* already stopped */
    }
    stream?.getTracks().forEach((t) => t.stop())
    void ctx?.close()
  }

  /** The whole recording, once the recorder has flushed its last chunk. */
  const finishRecording = () =>
    new Promise<Blob | null>((resolve) => {
      const done = () => resolve(chunks.length ? new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }) : null)
      if (!recorder || recorder.state === 'inactive') return done()
      recorder.onstop = done
      recorder.stop()
    })

  return {
    tier: recorder ? 'elevenlabs' : rec ? 'browser' : 'simulated',
    level,
    interim: () => interimText,
    /**
     * What was actually said, or '' when nothing was understood. Only the
     * labelled simulated tier — no recognition of any kind — makes one up.
     */
    async stop() {
      const browserHeard = () => finalText.trim() || interimText.trim()
      const audio = await finishRecording()
      teardown()
      if (audio && audio.size > 0) {
        try {
          const res = await fetch(`${PROXY_BASE}/stt`, { method: 'POST', headers: { 'content-type': audio.type || 'audio/webm' }, body: audio })
          const body = (await res.json().catch(() => ({}))) as { text?: string }
          if (res.ok && body.text?.trim()) return body.text.trim()
        } catch {
          /* upload failed — fall back to what the browser heard */
        }
        return browserHeard()
      }
      if (rec || tier !== 'simulated') return browserHeard()
      const pool = hint?.length ? hint : SIMULATED_UTTERANCES
      return pool[Math.floor(Math.random() * pool.length)]
    },
    cancel: teardown,
  }
}
