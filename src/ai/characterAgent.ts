import { getCharacter } from '@/content/characters'
import type { Character, ChatTurn, ConceptId, KnowledgeItem } from '@/types'
import { complete, isLive, LLMUnavailable } from './llm'
import { CONFIDENCE_FLOOR, retrieve, tokenize, type RetrievalResult } from './retrieval'

/* ============================================================================
 * CHARACTER CONVERSATION AGENT
 *
 * The one place in this app where an LLM earns its keep: the player can ask
 * anything, and hundreds of hardcoded branches cannot cover that.
 *
 * Two execution paths, one contract:
 *   LIVE     retrieval -> grounded system prompt -> LLM -> answer + citations
 *   OFFLINE  retrieval -> deterministic in-voice composer -> answer + citations
 *
 * Both paths obey the same rule: an answer may only assert policy that came
 * back from retrieval. Below CONFIDENCE_FLOOR the character says it does not
 * know. Characters are personalities with a knowledge boundary — not agents.
 * ========================================================================== */

export interface SceneContext {
  sceneTitle: string
  /** What just happened, in one line, so answers can be situated. */
  situation: string
  activeConcepts: ConceptId[]
  lastChoiceText?: string
  lastChoiceQuality?: 'best' | 'acceptable' | 'poor'
}

export interface CharacterReply {
  text: string
  /** greeting/refusal replies carry no policy, so the UI must not score them. */
  kind: 'answer' | 'greeting' | 'refusal'
  citations: string[]
  grounded: boolean
  confidence: number
  source: 'llm' | 'local'
  /** Exactly what the LLM was (or would be) sent. Rendered by the inspector. */
  promptPreview: string
  retrieved: RetrievalResult
}

/* ------------------------------------------------------------ prompt assembly */

const renderKnowledge = (k: KnowledgeItem) =>
  [
    `[${k.id}] ${k.topic} (severity: ${k.severity})`,
    `  RULE: ${k.rule}`,
    `  WHY IT MATTERS: ${k.consequence}`,
    `  COMMON MISTAKE: ${k.commonMistake}`,
    k.edgeCases.length ? `  EDGE CASES: ${k.edgeCases.join(' | ')}` : '',
    `  DO: ${k.recommended.join('; ')}`,
    `  DO NOT: ${k.prohibited.join('; ')}`,
    `  SOURCE: ${k.source.doc} § ${k.source.section}${k.source.page ? `, p.${k.source.page}` : ''}`,
  ]
    .filter(Boolean)
    .join('\n')

export function buildSystemPrompt(
  ch: Character,
  ctx: SceneContext,
  r: RetrievalResult,
): string {
  return [
    `You are ${ch.name}, ${ch.role}, at Helix Dynamics. You are a character in an interactive onboarding episode. The player is a new employee on their first day.`,
    ``,
    `PERSONALITY`,
    ch.persona,
    ``,
    `SPEECH RULES`,
    ...ch.speechRules.map((s) => `- ${s}`),
    `- Maximum 70 words. This is spoken dialogue, not documentation.`,
    `- Stay in character. Never mention being an AI, a model, or a prompt.`,
    ``,
    `CURRENT SCENE: ${ctx.sceneTitle}`,
    `WHAT JUST HAPPENED: ${ctx.situation}`,
    ctx.lastChoiceText ? `THE PLAYER'S LAST DECISION: "${ctx.lastChoiceText}" (rated ${ctx.lastChoiceQuality})` : '',
    ``,
    `COMPANY KNOWLEDGE — retrieved for this question. This is the ONLY source of policy you may assert:`,
    r.hits.length ? r.hits.map((h) => renderKnowledge(h.item)).join('\n\n') : '(nothing retrieved)',
    ``,
    `GROUNDING RULES — these override personality:`,
    `- Never invent a Helix policy, tool name, system name, number, or deadline that is not in the knowledge above.`,
    `- If the knowledge above does not answer the question, say plainly that you do not know and point the player at Security or the Service Desk. Do not guess.`,
    `- Prefer explaining the mechanism (why the rule exists) over reciting the rule.`,
    `- You may disagree with the player's reasoning, but not with the policy.`,
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/* --------------------------------------------------------- intent classifier */

type Intent = 'greeting' | 'why' | 'how' | 'whatif' | 'objection' | 'permission' | 'whatdo' | 'meta' | 'explain'

function classify(q: string): Intent {
  const s = q.toLowerCase().trim()
  if (/^(hi|hey|hello|yo|sup|good morning|morning|thanks|thank you|ok|okay)\b[\s!.?]*$/.test(s)) return 'greeting'
  if (/^(who are you|what do you do|what'?s your (name|job|role))/.test(s)) return 'greeting'
  if (/(what should i have|was i wrong|did i (mess|screw|get)|was that (right|wrong|bad)|how did i do)/.test(s)) return 'meta'
  if (/^(but|surely|however)\b/.test(s) || /(doesn'?t|isn'?t|wouldn'?t|why would).*(matter|count|apply|be)/.test(s)) return 'objection'
  if (/(what if|suppose|what about|and if)/.test(s)) return 'whatif'
  if (/^(can i|could i|am i allowed|is it ok|is it okay|is it fine|is that allowed|may i)/.test(s)) return 'permission'
  if (/^(what (should|do) i do|what now|what next)/.test(s)) return 'whatdo'
  if (/^(how|what'?s the (right|correct|proper) way)/.test(s)) return 'how'
  if (/^why/.test(s)) return 'why'
  return 'explain'
}

/* ------------------------------------------------- deterministic voice engine */

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619
  return Math.abs(h >>> 0)
}
const pick = <T,>(arr: T[], seed: number) => arr[seed % arr.length]

/* Sentence realisation. The composer stitches knowledge fields into speech, so
 * capitalisation and terminal punctuation have to be handled explicitly rather
 * than hoped for — otherwise you get "That is a fair challenge. the sender…". */

/** Acronyms and proper nouns that must keep their capital mid-sentence. */
const KEEP_CAPS = /^(Helix|IT|MFA|SSO|VPN|SaaS|DPA|Security Portal|Report Phish|Access Portal|Service Desk)\b/

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const low = (t: string) => (KEEP_CAPS.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1))
/** Drop trailing punctuation so a field can be embedded mid-sentence. */
const strip = (t: string) => t.trim().replace(/[.\s]+$/, '')
/** Guarantee the fragment ends a sentence. */
const sent = (t: string) => {
  const x = t.trim().replace(/\s+/g, ' ')
  return /[.!?…"]$/.test(x) ? x : x + '.'
}
/**
 * Join a character's opener to a knowledge fragment. Openers carry their own
 * trailing space; whether the fragment is capitalised depends on whether the
 * opener ended a sentence ("Look. " -> capital) or leads into one
 * ("Because " -> lowercase).
 */
const lead = (opener: string, frag: string) => {
  const startsSentence = opener.trim() === '' || /[.!?]\s*$/.test(opener)
  return opener + (startsSentence ? cap(strip(frag)) : low(strip(frag)))
}
const firstSentence = (t: string) => (t.split(/(?<=\.)\s/)[0] ?? t).trim()

/** Pick the edge case that best matches the question's own words. */
function bestEdgeCase(item: KnowledgeItem, q: string): string | undefined {
  const qt = new Set(tokenize(q))
  let best: { t: string; n: number } | undefined
  for (const e of item.edgeCases) {
    const n = tokenize(e).filter((t) => qt.has(t)).length
    if (!best || n > best.n) best = { t: e, n }
  }
  return best && best.n > 0 ? best.t : item.edgeCases[0]
}

const OPENERS: Record<string, Record<Intent | 'default', string[]>> = {
  dex: {
    default: ['Look. ', 'Honestly? ', 'Right, so. '],
    greeting: ['Dex. I write the things that break.', 'Hey. Do not take my advice this morning, apparently.'],
    why: ['Because — and I hate this — ', 'Fine. Because '],
    how: ['Easy. ', 'The boring way. '],
    whatif: ['Sure, edge case. ', 'Yeah, that one comes up. '],
    objection: ['I said the same thing. I was wrong. ', 'Yeah, I made that argument once. '],
    permission: ['No. ', 'Nope. '],
    whatdo: ['Two steps. ', 'Do the dull thing. '],
    meta: ['You want the honest version? ', 'Eh. '],
    explain: ['Look. ', 'Short version. '],
  },
  milo: {
    default: ['Okay, so — ', 'Right, um — '],
    greeting: ['Hi! Sorry. Hi.', 'Oh — hey. I am still working out where the coffee is.'],
    why: ['Okay so I think — and I did read this bit — ', 'Because, um, '],
    how: ['I actually know this one. ', 'Okay so what I do is — '],
    whatif: ['Ooh, I thought about that too. ', 'I asked someone this exact thing. '],
    objection: ['That is exactly what I said! And then — ', 'I know, right? But apparently '],
    permission: ['I do not think so. No. ', 'No — I am fairly sure no. '],
    whatdo: ['Okay. So. ', 'Right, um, so '],
    meta: ['I mean — I am not the person to judge. ', 'Honestly? '],
    explain: ['So the way I understand it, ', 'Okay so — '],
  },
  noor: {
    default: ['Practically: ', 'Here is the version that matters: '],
    greeting: ['Noor. Customer ops. I have four minutes and I like you already.', 'Hi. Ask fast, I am on a call at half past.'],
    why: ['Because ', 'Simple. Because '],
    how: ['Fastest compliant route: ', 'Do it like this: '],
    whatif: ['That happens weekly. ', 'Good question, it is the real one. '],
    objection: ['I argued this for eight months. ', 'That was my position too. '],
    permission: ['No — and I say that as the person who wanted it to be yes. ', 'No. '],
    whatdo: ['Two things. ', 'Do this: '],
    meta: ['From where I was standing? ', 'Honestly, '],
    explain: ['Here is how it works in practice. ', 'Right. So '],
  },
  vera: {
    default: ['', ''],
    greeting: ['Vera Okonjo, Security. Ask me anything — that is genuinely the job.', 'Vera. Head of Security. You are not in trouble, by the way.'],
    why: ['Because of the mechanism. ', 'Here is the mechanism. '],
    how: ['', 'The process is short. '],
    whatif: ['That is the interesting case. ', 'Good — that is where people get caught. '],
    objection: ['That is a fair challenge. ', 'Reasonable objection, and it is the common one. '],
    permission: ['No. ', 'No, and I will tell you why it is a hard no. '],
    whatdo: ['In order. ', 'Do this. '],
    meta: ['Straight answer. ', 'I will be direct. '],
    explain: ['', ''],
  },
}

const CLOSERS: Record<string, string[]> = {
  dex: ['Do not tell Vera I explained a policy correctly.', 'Anyway. I have a deploy.', 'That is the whole trick.'],
  milo: ['I think that is right? Ask Vera if it matters a lot.', 'Sorry, that was a lot of words.', 'I wrote it on a sticky note, honestly.'],
  noor: ['It costs about two minutes. I checked.', 'That is the part nobody explains.', 'Then get on with your day.'],
  vera: ['Report it and I will handle the rest.', 'That is the whole standard.', 'Ask me again any time.'],
}

const cite = (item: KnowledgeItem) => `${item.source.doc} § ${item.source.section}`

interface Composed {
  text: string
  grounded: boolean
  /** Knowledge ids the answer actually leaned on — not everything retrieved. */
  used: string[]
  kind: CharacterReply['kind']
}

/** Spoken dialogue, not documentation: drop trailing colour past this budget. */
const MAX_WORDS = 72

function composeGrounded(
  ch: Character,
  question: string,
  r: RetrievalResult,
  ctx: SceneContext,
): Composed {
  const intent = classify(question)
  const seed = hash(question + ch.id)
  const openers = OPENERS[ch.id] ?? OPENERS.vera
  const opener = pick(openers[intent] ?? openers.default, seed)

  if (intent === 'greeting')
    return { text: pick(openers.greeting, seed), grounded: true, used: [], kind: 'greeting' }

  const top = r.hits[0]?.item
  if (!top || r.confidence < CONFIDENCE_FLOOR) {
    const refusals: Record<string, string> = {
      dex: 'Genuinely no idea, and I am not going to invent a policy at you. Ask Security — Vera actually likes being asked.',
      milo: 'Um — I do not know that one, and I do not want to guess and be wrong at you. The Security Portal has a question box? I used it twice.',
      noor: 'I do not know, and a confident guess from me is worth nothing here. Put it to Security; they answer same-day.',
      vera: 'I do not have that in our policy set, so I am not going to improvise an answer. Send it to the Security Portal and I will get you something written down.',
    }
    return { text: refusals[ch.id] ?? refusals.vera, grounded: false, used: [], kind: 'refusal' }
  }

  const second = r.hits[1]?.item
  const used = new Set<string>([top.id])
  const rule = firstSentence(top.rule)
  const why = firstSentence(top.consequence)
  const edge = bestEdgeCase(top, question)
  const doThis = top.recommended[0]
  const dont = top.prohibited[0]

  const parts: string[] = []

  switch (intent) {
    case 'why':
      parts.push(sent(lead(opener, why)))
      parts.push(sent(`The standard is blunt about it: ${low(strip(rule))}`))
      if (edge) parts.push(sent(`And ${low(strip(edge))}`))
      break

    case 'objection':
      parts.push(sent(lead(opener, edge ?? why)))
      parts.push(sent(`That is exactly why the rule is absolute: ${low(strip(rule))}`))
      break

    case 'whatif':
      parts.push(sent(lead(opener, edge ?? why)))
      parts.push(sent(`The rule still holds: ${low(strip(rule))}`))
      break

    case 'permission':
      // Verdict, then the rule itself, then the mechanism, then the way through.
      parts.push(sent(lead(opener, rule)))
      parts.push(sent(cap(strip(why))))
      if (doThis) parts.push(sent(`What you can do: ${low(strip(doThis))}`))
      break

    case 'whatdo':
    case 'how':
      parts.push(sent(lead(opener, top.recommended.map((x) => low(strip(x))).join(', then '))))
      parts.push(
        sent(`The thing to avoid is ${low(strip(dont ?? top.commonMistake))}, because ${low(strip(why))}`),
      )
      break

    case 'meta': {
      const q = ctx.lastChoiceQuality
      const verdicts = {
        best: 'You got that one right, and not by luck — you refused the thing that felt helpful.',
        acceptable: 'Half right. The instinct was good, the execution left a gap.',
        poor: 'It went badly, and you are allowed to say so out loud. Everyone here has one.',
      }
      parts.push(sent(lead(opener, q ? verdicts[q] : 'Too early to say')))
      parts.push(sent(`The rule in play was ${low(strip(rule))} — because ${low(strip(why))}`))
      break
    }

    default:
      parts.push(sent(lead(opener, rule)))
      parts.push(sent(`The reason: ${low(strip(why))}`))
      if (top.commonMistake) parts.push(sent(`Where people trip is ${low(strip(top.commonMistake))}`))
  }

  // Vera cites documents by section; nobody else talks like that.
  if (ch.id === 'vera') parts.push(sent(`That is ${cite(top)}`))
  else if (ch.id === 'milo' && seed % 2 === 0)
    parts.push(sent(`It is in the ${top.source.doc.replace(/\s+v?[\d.]+$/, '')}, I checked`))

  if (second && seed % 3 === 0) {
    used.add(second.id)
    parts.push(
      ch.id === 'vera'
        ? sent(`Related, and people miss it: ${low(strip(firstSentence(second.rule)))}`)
        : sent(`Also — ${low(strip(firstSentence(second.rule)))}`),
    )
  }

  if (seed % 4 === 0) parts.push(pick(CLOSERS[ch.id] ?? CLOSERS.vera, seed))

  // Trim trailing colour until the reply is speakable. The first two parts —
  // the answer and its mechanism — are never dropped.
  const words = (ps: string[]) => ps.join(' ').split(/\s+/).length
  while (parts.length > 2 && words(parts) > MAX_WORDS) {
    const dropped = parts.pop()!
    if (second && dropped.includes(strip(firstSentence(second.rule)).slice(0, 24))) used.delete(second.id)
  }

  return { text: parts.join(' ').replace(/\s+/g, ' ').trim(), grounded: true, used: [...used], kind: 'answer' }
}

/* --------------------------------------------------------------- public API */

export async function askCharacter(args: {
  characterId: string
  question: string
  ctx: SceneContext
  history: ChatTurn[]
}): Promise<CharacterReply> {
  const ch = getCharacter(args.characterId)

  const intent = classify(args.question)

  /* Retrieve on the question as asked. Query expansion is a RECOVERY step, not
   * the default: folding the scene context into every query drags strong
   * scene-adjacent rules over the one the player actually asked about. */
  let r = retrieve(args.question, { activeConcepts: args.ctx.activeConcepts, k: 3 })
  /* Only questions that are *about the current moment* get expanded — "what
   * should I have done", "what now". A question with its own subject that simply
   * is not covered by the knowledge base must be allowed to fail, so the
   * character declines instead of answering a scene-adjacent rule. */
  const deictic = intent === 'meta' || intent === 'whatdo'
  if (r.confidence < CONFIDENCE_FLOOR && deictic && tokenize(args.question).length < 4) {
    const expanded = [
      args.question,
      args.ctx.activeConcepts.join(' ').replace(/_/g, ' '),
      args.ctx.lastChoiceText ?? '',
    ].join(' ')
    const retry = retrieve(expanded, { activeConcepts: args.ctx.activeConcepts, k: 3 })
    if (retry.confidence > r.confidence) r = retry
  }
  const system = buildSystemPrompt(ch, args.ctx, r)
  // The live path sees every retrieved rule, so it may cite any of them.
  const citations = r.confidence >= CONFIDENCE_FLOOR ? r.hits.map((h) => h.item.id) : []

  if (isLive()) {
    try {
      const messages = [
        ...args.history
          .filter((t) => t.characterId === args.characterId)
          .slice(-6)
          .map((t) => ({ role: (t.role === 'player' ? 'user' : 'assistant') as 'user' | 'assistant', content: t.text })),
        { role: 'user' as const, content: args.question },
      ]
      const text = await complete({ system, messages, maxTokens: 220, temperature: 0.7 })
      return {
        text,
        kind: intent === 'greeting' ? 'greeting' : citations.length ? 'answer' : 'refusal',
        citations,
        grounded: citations.length > 0,
        confidence: r.confidence,
        source: 'llm',
        promptPreview: system,
        retrieved: r,
      }
    } catch (e) {
      if (!(e instanceof LLMUnavailable)) throw e
      // fall through to local composer
    }
  }

  // Small deliberate latency so the local path reads as "thinking", not instant.
  await new Promise((res) => setTimeout(res, 420 + (hash(args.question) % 380)))
  const { text, grounded, used, kind } = composeGrounded(ch, args.question, r, args.ctx)
  return {
    text,
    kind,
    // The local composer cites only the rules it actually used.
    citations: used,
    grounded,
    confidence: r.confidence,
    source: 'local',
    promptPreview: system,
    retrieved: r,
  }
}

/** Question chips offered under the chat input, drawn from live scene concepts. */
export function suggestedQuestions(ctx: SceneContext): string[] {
  const base: Record<ConceptId, string[]> = {
    phishing: ['Why was that email suspicious?', 'But the sender looked internal. Why would it be phishing?'],
    password_security: ['Why can’t I just share my login once?', 'What if it is genuinely an emergency?'],
    data_handling: ['Why does it matter if the tool is good?', 'What if I remove the names first?'],
    approved_tools: ['How do I get a tool approved?', 'Half the floor uses it — is that not approval?'],
    incident_reporting: ['What happens to me if I report a mistake?', 'Nothing happened. Why report it at all?'],
    social_engineering: ['How was I supposed to tell it was fake?', 'What if the voice is someone I know?'],
    physical_security: ['Is holding a door really a security problem?', 'What do I do about an unlocked laptop?'],
  }
  const out: string[] = []
  for (const c of ctx.activeConcepts) out.push(...(base[c] ?? []))
  out.push('What should I have done?')
  return [...new Set(out)].slice(0, 4)
}
