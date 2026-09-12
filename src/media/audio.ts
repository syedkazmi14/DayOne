import type { AssetRef, Character } from '@/types'
import { resolveVoiceProfile } from '@/voice/voiceProfiles'
import { MEDIA_BASE, mediaHealth } from './mediaStatus'

/* ============================================================================
 * DIALOGUE AUDIO — ElevenLabs, pre-rendered at authoring time.
 *
 * Audio is not video. ElevenLabs voices the cast; it does not generate scenes.
 * The media server forwards each line to the voice proxy (which alone holds
 * ELEVENLABS_API_KEY) and stores the result, so a published episode plays its
 * lines from files. Without a key nothing is pre-rendered and the runtime
 * falls back to the browser voice — reported as 'runtime', not as generated.
 * ========================================================================== */

export interface LineAudioRequest {
  episodeId: string
  sceneId: string
  lineIndex: number
  text: string
  character: Character
}

export interface LineAudioResult {
  asset: AssetRef | null
  /** 'runtime' = deliberately not pre-rendered; the player synthesises live. */
  status: 'stored' | 'runtime' | 'failed'
  error?: string
}

export interface AudioProvider {
  readonly id: string
  readonly label: string
  renderLine(req: LineAudioRequest): Promise<LineAudioResult>
}

export class RuntimeSpeechProvider implements AudioProvider {
  readonly id = 'runtime-speech'
  readonly label = 'BROWSER SYNTH · AT RUNTIME'
  async renderLine(): Promise<LineAudioResult> {
    return { asset: null, status: 'runtime' }
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class ServerAudioProvider implements AudioProvider {
  readonly id = 'elevenlabs'
  readonly label = 'ELEVENLABS · PRE-RENDERED'
  constructor(private opts: { base?: string; fetch?: FetchLike } = {}) {}

  async renderLine(req: LineAudioRequest): Promise<LineAudioResult> {
    const profile = resolveVoiceProfile(req.character.voiceProfileId)
    const call = this.opts.fetch ?? ((i: string, init?: RequestInit) => fetch(i, init))
    try {
      const res = await call(`${this.opts.base ?? MEDIA_BASE}/audio`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          episodeId: req.episodeId,
          sceneId: req.sceneId,
          lineIndex: req.lineIndex,
          text: req.text,
          voiceId: profile.voiceId,
          fallbackVoiceId: profile.fallbackVoiceId,
          settings: profile.settings,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { url?: string; storageKey?: string; voiceId?: string; message?: string }
      if (!res.ok || !body.url) return { asset: null, status: 'failed', error: body.message ?? `tts failed (${res.status})` }
      return {
        status: 'stored',
        asset: {
          kind: 'audio',
          tier: 'generated',
          provider: `elevenlabs · ${body.voiceId ?? profile.voiceId}`,
          url: body.url,
          storageKey: body.storageKey,
          prompt: req.text,
          createdAt: new Date().toISOString(),
        },
      }
    } catch (e) {
      return { asset: null, status: 'failed', error: `media server unreachable: ${(e as Error).message}` }
    }
  }
}

const runtime = new RuntimeSpeechProvider()
const server = new ServerAudioProvider()

export const audioProvider = (): AudioProvider => (mediaHealth()?.audio.configured ? server : runtime)
