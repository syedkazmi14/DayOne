/* ============================================================================
 * LLM BOUNDARY
 *
 * One narrow seam. Everything above it (character agent, coach, knowledge
 * agent) is provider-agnostic; everything below is a single fetch.
 *
 * There is no fake "API integration" here. Either a key is configured and a
 * real request goes out, or `isLive()` returns false and callers fall back to
 * the local grounded composer — which the UI labels honestly.
 *
 * To go live with Anthropic:
 *   echo 'VITE_ANTHROPIC_API_KEY=sk-ant-...' >> .env.local
 * Or with OpenAI:
 *   echo 'VITE_OPENAI_API_KEY=sk-...' >> .env.local
 * (Browser-side keys are fine for a demo, never for production — in production
 * this same function points at your own server route.)
 * ========================================================================== */

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMRequest {
  system: string
  messages: LLMMessage[]
  maxTokens?: number
  temperature?: number
}

export type LLMMode = 'anthropic' | 'openai' | 'proxy' | 'offline'

const env = (import.meta.env ?? {}) as Record<string, string | undefined>

const ANTHROPIC_KEY = env.VITE_ANTHROPIC_API_KEY
const OPENAI_KEY = env.VITE_OPENAI_API_KEY
const PROXY_URL = env.VITE_LLM_PROXY_URL
const MODEL_OVERRIDE = env.VITE_LLM_MODEL

const DEFAULT_MODEL: Record<'anthropic' | 'openai', string> = {
  anthropic: 'claude-sonnet-5',
  // The cheapest model that extracts reliably: gpt-4.1-nano tagged travel-expense
  // rules as data handling on the sample docs; mini correctly skipped them.
  openai: 'gpt-4.1-mini',
}

/** Anthropic wins if both keys are set, since it's this project's default provider. */
export const llmMode = (): LLMMode =>
  ANTHROPIC_KEY ? 'anthropic' : OPENAI_KEY ? 'openai' : PROXY_URL ? 'proxy' : 'offline'

export const isLive = () => llmMode() !== 'offline'

const modelFor = (mode: 'anthropic' | 'openai'): string => MODEL_OVERRIDE ?? DEFAULT_MODEL[mode]

export const llmLabel = (): string => {
  const mode = llmMode()
  switch (mode) {
    case 'anthropic':
    case 'openai':
      return `LIVE · ${modelFor(mode)}`
    case 'proxy':
      return 'LIVE · PROXY'
    default:
      return 'GROUNDED LOCAL'
  }
}

export class LLMUnavailable extends Error {}

/**
 * The first complete JSON value in a model reply. Models wrap JSON in code
 * fences or add a sentence after it, and JSON.parse on the whole reply then
 * fails. Throws SyntaxError when there is no complete value — a truncated
 * reply included — exactly like JSON.parse, so callers keep their fallback.
 */
export function parseJsonReply(raw: string): unknown {
  const s = raw.replace(/^\s*```(?:json)?\s*$/gim, '')
  const start = s.search(/[[{]/)
  if (start === -1) throw new SyntaxError('No JSON in model reply')
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return JSON.parse(s.slice(start, i + 1))
    }
  }
  throw new SyntaxError('Model reply ended before its JSON did')
}

/** Returns the model's text, or throws LLMUnavailable so callers can fall back. */
export async function complete(req: LLMRequest): Promise<string> {
  const mode = llmMode()
  if (mode === 'offline') throw new LLMUnavailable('No LLM configured')

  const url =
    mode === 'anthropic'
      ? 'https://api.anthropic.com/v1/messages'
      : mode === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : PROXY_URL!

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (mode === 'anthropic') {
    headers['x-api-key'] = ANTHROPIC_KEY!
    headers['anthropic-version'] = '2023-06-01'
    // Required for direct browser calls; a server route would not need it.
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else if (mode === 'openai') {
    headers['authorization'] = `Bearer ${OPENAI_KEY}`
  }

  // OpenAI's chat completions API carries the system prompt as a message,
  // not a top-level field; Anthropic (and the proxy, which mirrors it) does the opposite.
  const body =
    mode === 'openai'
      ? {
          model: modelFor('openai'),
          max_tokens: req.maxTokens ?? 400,
          temperature: req.temperature ?? 0.6,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
        }
      : {
          model: modelFor('anthropic'),
          max_tokens: req.maxTokens ?? 400,
          temperature: req.temperature ?? 0.6,
          system: req.system,
          messages: req.messages,
        }

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (e) {
    throw new LLMUnavailable(`Network error: ${(e as Error).message}`)
  }
  if (!res.ok) throw new LLMUnavailable(`${res.status} ${await res.text().catch(() => '')}`)

  const json = (await res.json()) as {
    content?: { type: string; text?: string }[]
    text?: string
    choices?: { message?: { content?: string } }[]
  }
  const text =
    mode === 'openai'
      ? json.choices?.[0]?.message?.content
      : (json.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? json.text)
  if (!text) throw new LLMUnavailable('Empty completion')
  return text.trim()
}
