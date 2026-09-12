import { useEffect, useState } from 'react'
import { subscribeVoiceStatus, sttTier, ttsTier, voiceProvider, voiceStatusPending, type VoiceProvider, type VoiceTier } from './voice'

/* ============================================================================
 * Whether the ElevenLabs proxy is up is discovered asynchronously, so the
 * status chips have to re-render when the probe lands. This is the only React
 * binding the voice layer needs.
 * ========================================================================== */

export interface VoiceStatus {
  provider: VoiceProvider
  tts: VoiceTier
  stt: VoiceTier
  /** True until discovery finishes — the UI should not claim a tier yet. */
  pending: boolean
}

const read = (): VoiceStatus => ({
  provider: voiceProvider(),
  tts: ttsTier(),
  stt: sttTier(),
  pending: voiceStatusPending(),
})

export function useVoiceStatus(): VoiceStatus {
  const [status, setStatus] = useState<VoiceStatus>(read)
  useEffect(() => subscribeVoiceStatus(() => setStatus(read())), [])
  return status
}
