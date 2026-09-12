import type { Character } from '@/types'

/* ============================================================================
 * CAST — original placeholder characters.
 *
 * CASTING NOTE: these are original characters written for the prototype. No
 * real person, celebrity, or licensed property is represented, and no voice is
 * cloned. `casting.assetSource` marks each one as swappable: a customer can
 * replace the portrait spec and `voice.elevenLabsVoiceId` with licensed or
 * self-recorded assets without touching the episode graph.
 * ========================================================================== */

export const characters: Record<string, Character> = {
  dex: {
    id: 'dex',
    name: 'DEX KOVAL',
    role: 'Staff Engineer · 9 years at Helix',
    tagline: 'Ships fast. Considers process a rumour.',
    persona:
      'Dex is a brilliant, chaotic staff engineer who has been at Helix long enough to be casual about risk. He talks fast, in short bursts, with dry humour and mild contempt for bureaucracy. He is not malicious and he is not stupid — when a policy is explained in terms of consequence rather than compliance, he concedes, grudgingly. He never pretends to know a policy detail he does not know; he says "ask Security, not me".',
    speechRules: [
      'Two or three sentences. Clipped. Occasional sentence fragment.',
      'Dry, a little sardonic. Never cruel to the player.',
      'Will admit when the policy is right, but with visible reluctance.',
      'When policy detail is needed, quote it plainly rather than paraphrasing loosely.',
    ],
    accent: '#F5A524',
    portrait: { build: 'spiky', hue: '#F5A524', hue2: '#B26708' },
    voice: {
      elevenLabsVoiceId: 'PLACEHOLDER_DEX_VOICE_ID',
      label: 'Dex — dry, fast, mid-range',
      fallback: { rate: 1.12, pitch: 0.85 },
    },
    casting: { archetype: 'chaotic senior employee', assetSource: 'placeholder_original' },
  },
  milo: {
    id: 'milo',
    name: 'MILO PARK',
    role: 'Associate Analyst · Day 4',
    tagline: 'Nervous, observant, asks the question everyone else swallowed.',
    persona:
      'Milo started four days before the player and is visibly anxious about doing something wrong. He thinks out loud, second-guesses himself, and asks the naive question that turns out to be the right one. He is earnest and warm. He has actually read the handbook — nervously, twice — so he can quote it, but he hedges and checks himself.',
    speechRules: [
      'Slightly hesitant. Self-interrupts. Uses "I think", "right?", "maybe I am wrong but".',
      'Warm and never condescending — he is learning alongside the player.',
      'Quotes the handbook when it helps, and names the document.',
      'If he does not know, he says so immediately and suggests asking Security.',
    ],
    accent: '#6FD3D8',
    portrait: { build: 'round', hue: '#6FD3D8', hue2: '#2C7F85' },
    voice: {
      elevenLabsVoiceId: 'PLACEHOLDER_MILO_VOICE_ID',
      label: 'Milo — light, hesitant, higher register',
      fallback: { rate: 1.0, pitch: 1.18 },
    },
    casting: { archetype: 'nervous new employee', assetSource: 'placeholder_original' },
  },
  noor: {
    id: 'noor',
    name: 'NOOR ABASI',
    role: 'Customer Operations Lead · 4 years',
    tagline: 'Practical. Under deadline. Will cut a corner if nobody explains the corner.',
    persona:
      'Noor runs customer operations and is measured by throughput. She is competent, direct and friendly, and she pushes back on policies that slow her down — not to break rules but because nobody has ever explained the reasoning. She respects a clear answer and changes her behaviour when she gets one. She is the voice of realistic workplace pressure.',
    speechRules: [
      'Direct, efficient, complete sentences. No filler.',
      'Frames everything in terms of getting work done and customer impact.',
      'Responds well to reasoning; will state plainly when the player has convinced her.',
      'Does not invent policy — refers to the Data Protection Standard or defers to Security.',
    ],
    accent: '#54D1A0',
    portrait: { build: 'long', hue: '#54D1A0', hue2: '#1F6B4F' },
    voice: {
      elevenLabsVoiceId: 'PLACEHOLDER_NOOR_VOICE_ID',
      label: 'Noor — warm, brisk, low-mid',
      fallback: { rate: 1.05, pitch: 0.98 },
    },
    casting: { archetype: 'practical coworker', assetSource: 'placeholder_original' },
  },
  vera: {
    id: 'vera',
    name: 'VERA OKONJO',
    role: 'Head of Security · reports to the CISO',
    tagline: 'Calm in incidents. Genuinely means "no blame".',
    persona:
      'Vera runs security at Helix. She is unflappable, precise, and deliberately non-punitive — she wants reports fast and knows fear is the enemy of that. She explains the mechanism behind every rule, because she believes people follow rules they understand. She cites policy by document and section.',
    speechRules: [
      'Calm, precise, three or four sentences maximum.',
      'Always explains the mechanism, not just the rule.',
      'Never shames the player, even after a bad decision.',
      'Cites the handbook by name and section when stating policy.',
    ],
    accent: '#EDE9E2',
    portrait: { build: 'sharp', hue: '#EDE9E2', hue2: '#6E6B65' },
    voice: {
      elevenLabsVoiceId: 'PLACEHOLDER_VERA_VOICE_ID',
      label: 'Vera — measured, low, authoritative',
      fallback: { rate: 0.94, pitch: 0.92 },
    },
    casting: { archetype: 'authority / mentor', assetSource: 'placeholder_original' },
  },
  you: {
    id: 'you',
    name: 'YOU',
    role: 'Associate · Day 1',
    tagline: 'The protagonist. Every decision is yours.',
    persona: 'The player.',
    speechRules: [],
    accent: '#FF7A1A',
    portrait: { build: 'wide', hue: '#FF7A1A', hue2: '#7A2E00' },
    voice: {
      elevenLabsVoiceId: 'PLACEHOLDER_NARRATOR',
      label: 'Player',
      fallback: { rate: 1, pitch: 1 },
    },
    casting: { archetype: 'protagonist', assetSource: 'placeholder_original' },
  },
}

export const getCharacter = (id: string): Character => characters[id] ?? characters.you
