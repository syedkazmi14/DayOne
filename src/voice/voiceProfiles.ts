/* ============================================================================
 * VOICE REGISTRY — the single place ElevenLabs voice ids live.
 *
 *   character  ->  voiceProfileId  ->  VoiceProfile  ->  ElevenLabs
 *
 * Characters carry a `voiceProfileId` and nothing else about speech synthesis,
 * so adding a character is a data change in src/content/characters.ts and
 * adding a voice is a data change here. No voice id appears anywhere else in
 * the app, and no component ever talks to ElevenLabs directly.
 *
 * WHY TWO IDS PER PROFILE
 * `voiceId` is the cast voice: a community ("shared library") voice chosen for
 * its fit to the character. The API only serves those to Creator tier and
 * above. `fallbackVoiceId` is the nearest premade voice, which every plan can
 * use — including Free. The proxy tries the cast voice first and retries with
 * the fallback when the plan rejects it (HTTP 400 `free_users_not_allowed` /
 * 402 `paid_plan_required`), so the same build works on either key.
 *
 * Every `voiceId` below was auditioned against the live API: all sixteen
 * return audio and all sixteen are distinct.
 *
 * NO CREDENTIALS HERE. Voice ids are public identifiers; the API key lives
 * only in the server process (server/voiceProxy.mjs, ELEVENLABS_API_KEY).
 * ========================================================================== */

export interface VoiceSettings {
  stability: number
  similarity_boost: number
  style: number
  use_speaker_boost?: boolean
}

export interface VoiceProfile {
  id: string
  /** Shown in the UI so the player can see which voice is speaking. */
  label: string
  /** The cast voice. Community voices need Creator tier or above. */
  voiceId: string
  /** Premade stand-in, available on every plan. Used if `voiceId` is refused. */
  fallbackVoiceId?: string
  /** Override the server's default TTS model for this voice specifically. */
  modelId?: string
  /** Human note on why this voice was cast, for whoever re-casts it later. */
  casting?: string
  settings: VoiceSettings
  /** Browser-synth shaping, so the fallback tier still reads as this character. */
  fallback: { rate: number; pitch: number }
}

const defaults: VoiceSettings = { stability: 0.45, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true }

/** Terser profile literals — `settings` is a shallow override of `defaults`. */
const profile = (
  id: string,
  label: string,
  voiceId: string,
  fallback: { rate: number; pitch: number },
  extra: Partial<Omit<VoiceProfile, 'id' | 'label' | 'voiceId' | 'fallback'>> = {},
): VoiceProfile => ({
  id,
  label,
  voiceId,
  fallback,
  ...extra,
  settings: { ...defaults, ...extra.settings },
})

export const DEFAULT_VOICE_PROFILE_ID = 'narrator'

export const voiceProfiles: Record<string, VoiceProfile> = {
  /* ------------------------------------------------------ Rick and Morty */
  rick: profile('rick', 'Dr. Von — quirky, eccentric, mad-scientist', '57FpZFPShw2KfPbjIOGF', { rate: 1.12, pitch: 0.82 }, {
    fallbackVoiceId: 'N2lVS1w4EtoT3dr4eOWO', // Callum — husky trickster
    casting: 'Burnt-out genius: manic, contemptuous, no patience for a sentence he did not start. Low stability keeps the delivery unpredictable.',
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0 }, // matches this voice's stored ElevenLabs defaults
  }),
  morty: profile('morty', 'Timmy — anxious, nasal, stuttering', 'b3EsWgN6HTkTPLKdAn1D', { rate: 1.02, pitch: 1.24 }, {
    fallbackVoiceId: 'bIHbv24MWmeRgasZH58o', // Will — relaxed optimist
    casting: 'Anxious teenager who apologises mid-sentence. The stutter in this voice is the whole reason it was cast.',
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0 }, // matches this voice's stored ElevenLabs defaults
    modelId: 'eleven_multilingual_v2', // this clone needs the fidelity model — thin/off on the fast model
  }),
  summer: profile('summer', 'Briony — dry Southern California valley girl', '7yywlS3r48uNAvlq7pqA', { rate: 1.08, pitch: 1.1 }, {
    fallbackVoiceId: 'FGY2WhTYpPnrIDTdsKH5', // Laura — quirky, sassy
    casting: 'Unbothered teenager who is right and knows it. Dry, not shrill.',
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0 }, // matches this voice's stored ElevenLabs defaults
    modelId: 'eleven_multilingual_v2', // this clone needs the fidelity model — thin/off on the fast model
  }),
  jerry: profile('jerry', 'Odd Todd — nervous, over-earnest', 'm1vFFxFUahz0XVQz4bxA', { rate: 0.98, pitch: 1.04 }, {
    fallbackVoiceId: 'iP95p4xoKVk53GoZ742B', // Chris — casual, down-to-earth
    casting: 'Means well, over-explains, wants you to say he did fine.',
    settings: { stability: 0.5, similarity_boost: 0.75, style: 0 }, // matches this voice's stored ElevenLabs defaults
  }),

  /* ----------------------------------------------------------- South Park */
  cartman: profile('cartman', 'Bittu — heavy, gruff, playful kid', '4iqKdEXMW8NRF8USiS3Q', { rate: 1.06, pitch: 1.16 }, {
    fallbackVoiceId: 'SOYHLrjzK2X1ezoPC6cr', // Harry — young, rough
    casting: 'Fourth-grade authoritarian. Volume as an argument, in a kid register that still lands low.',
    settings: { stability: 0.32, similarity_boost: 0.72, style: 0.55 },
  }),
  stan: profile('stan', 'Aaron — plain, youthful, level', 'B6uUx2p7cRgxseOUyP6P', { rate: 1.0, pitch: 1.12 }, {
    fallbackVoiceId: 'TX3LPaxmHKxFdv7VOQHJ', // Liam — energetic, confident
    casting: 'The one who says the sensible thing last. Deliberately the least performed voice in the group.',
    settings: { stability: 0.55, similarity_boost: 0.8, style: 0.22 },
  }),
  kyle: profile('kyle', 'Manni — youthful know-it-all', 'KP4GbmyDmwaoy5dUlvZY', { rate: 1.05, pitch: 1.1 }, {
    fallbackVoiceId: 'IKne3meq5aSn9XLyUdCD', // Charlie — deep, energetic
    casting: 'Argues from principle, loudly, and is usually correct.',
    settings: { stability: 0.42, similarity_boost: 0.76, style: 0.45 },
  }),
  kenny: profile('kenny', 'Ethan — muffled, slow, deadpan', 'dEr1DpLere64jmURVAo9', { rate: 0.92, pitch: 0.9 }, {
    fallbackVoiceId: 'SAz9YHcvj6GT2YYXdXww', // River — neutral, calm
    casting: 'Muffled through a parka. Low stability keeps it indistinct on purpose.',
    settings: { stability: 0.28, similarity_boost: 0.62, style: 0.2 },
  }),

  /* ----------------------------------------------------------- Family Guy */
  peter: profile('peter', 'Alex — goofy, loud, enthusiastic', 'hYZHGYzFnp1GKImhQtGi', { rate: 1.04, pitch: 0.94 }, {
    fallbackVoiceId: 'CwhRBWXzGAHq8TQ4Fs17', // Roger — laid-back, resonant
    casting: 'Confident about things he has not read. Comic energy over precision.',
    settings: { stability: 0.32, similarity_boost: 0.7, style: 0.55 },
  }),
  stewie: profile('stewie', 'Blackwood — sinister, posh, British', 'agL69Vji082CshT65Tcy', { rate: 1.02, pitch: 1.2 }, {
    fallbackVoiceId: 'onwK4e9ZLuTAKqWW03F9', // Daniel — British, formal
    casting: 'Received Pronunciation delivered as a threat. Pitched up, because the aristocratic menace is the joke.',
    settings: { stability: 0.5, similarity_boost: 0.8, style: 0.5 },
  }),
  brian: profile('brian', 'Photi — writerly narrator, smooth', 'DjFOcJJK8rz0EB8LXAL0', { rate: 1.0, pitch: 0.98 }, {
    fallbackVoiceId: 'cjVigY5qzO86Huf0OWal', // Eric — smooth, trustworthy
    casting: 'A literal voice-over-narrator-and-writer voice, for the one who wrote the policy and wants you to know.',
    settings: { stability: 0.58, similarity_boost: 0.8, style: 0.28 },
  }),
  lois: profile('lois', 'Lena — warm, honest, end of a long day', 'roYauZ4bOLAKvVZTPLre', { rate: 1.0, pitch: 1.06 }, {
    fallbackVoiceId: 'hpp4J3VqNfWAUOO0d1Us', // Bella — bright, professional
    casting: 'Runs the household and the escalation queue, and is tired of both.',
    settings: { stability: 0.52, similarity_boost: 0.8, style: 0.3 },
  }),

  /* -------------------------------------------------------- The Simpsons */
  homer: profile('homer', 'Hugo — raspy, slow, lovable lackey', 'lAqElvydqyTzitpwAdj6', { rate: 0.9, pitch: 0.86 }, {
    fallbackVoiceId: 'nPczCjzI2devNBz1zQrb', // Brian — deep, resonant
    casting: 'Safety inspector who has not read the safety manual. Does what he is told, cheerfully.',
    settings: { stability: 0.38, similarity_boost: 0.7, style: 0.42 },
  }),
  bart: profile('bart', 'Valf — young, playful, sarcastic', 'loY1uopAz31XyhAEhNSa', { rate: 1.14, pitch: 1.22 }, {
    fallbackVoiceId: 'SOYHLrjzK2X1ezoPC6cr', // Harry — young, rough (shared with Cartman)
    casting: 'Finds the gap in every control for sport. Only the Free-tier fallback overlaps with Cartman.',
    settings: { stability: 0.3, similarity_boost: 0.72, style: 0.55 },
  }),
  marge: profile('marge', 'Linda — warm, steady, unhurried', '0mLOQqwA3kovxF1ID7z6', { rate: 0.95, pitch: 0.96 }, {
    fallbackVoiceId: 'XrExE9yKIg1WjnnlVkGX', // Matilda — knowledgable, upbeat
    casting: 'Patient to a fault, and the only adult in the room. High stability: she never escalates.',
    settings: { stability: 0.65, similarity_boost: 0.8, style: 0.2 },
  }),
  lisa: profile('lisa', 'Paisley — soft-spoken, earnest', 'n2rchuGxORaC6g9NUXBR', { rate: 1.02, pitch: 1.18 }, {
    fallbackVoiceId: 'cgSgspJ2msm6clMCkdW9', // Jessica — playful, bright
    casting: 'Has read the handbook. Twice. With annotations.',
    settings: { stability: 0.58, similarity_boost: 0.8, style: 0.28 },
  }),

  /* ------------------------------------------------------------- the player */
  narrator: profile('narrator', 'George — warm, measured narrator', 'JBFqnCBsd6RMkjVDRZzb', { rate: 1, pitch: 1 }, {
    casting: 'The player, and the fallback for any character with no profile. Premade on purpose: it must work on every plan.',
    settings: { stability: 0.55, similarity_boost: 0.75, style: 0.2 },
  }),
}

/**
 * Never throws and never returns undefined: a character pointing at a voice
 * that has been removed falls back to the narrator profile rather than taking
 * the chat panel down with it.
 */
export function resolveVoiceProfile(profileId: string | undefined): VoiceProfile {
  return (profileId ? voiceProfiles[profileId] : undefined) ?? voiceProfiles[DEFAULT_VOICE_PROFILE_ID]
}

/** True when `profileId` names a profile that actually exists. */
export const hasVoiceProfile = (profileId: string | undefined): boolean =>
  !!profileId && profileId in voiceProfiles
