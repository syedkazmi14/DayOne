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
 * To go live:
 *   echo 'VITE_ANTHROPIC_API_KEY=sk-ant-...' >> .env.local
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

export type LLMMode = 'anthropic' | 'proxy' | 'offline'

const env = (import.meta.env ?? {}) as Record<string, string | undefined>

const ANTHROPIC_KEY = env.VITE_ANTHROPIC_API_KEY
const PROXY_URL = env.VITE_LLM_PROXY_URL
const MODEL = env.VITE_LLM_MODEL ?? 'claude-sonnet-5'

export const llmMode = (): LLMMode =>
  ANTHROPIC_KEY ? 'anthropic' : PROXY_URL ? 'proxy' : 'offline'

export const isLive = () => llmMode() !== 'offline'

export const llmLabel = (): string => {
  switch (llmMode()) {
    case 'anthropic':
      return `LIVE · ${MODEL}`
    case 'proxy':
      return 'LIVE · PROXY'
    default:
      return 'GROUNDED LOCAL'
  }
}

export class LLMUnavailable extends Error {}

/** Returns the model's text, or throws LLMUnavailable so callers can fall back. */
export async function complete(req: LLMRequest): Promise<string> {
  const mode = llmMode()
  if (mode === 'offline') throw new LLMUnavailable('No LLM configured')

  const body = {
    model: MODEL,
    max_tokens: req.maxTokens ?? 400,
    temperature: req.temperature ?? 0.6,
    system: req.system,
    messages: req.messages,
  }

  const url = mode === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : PROXY_URL!
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (mode === 'anthropic') {
    headers['x-api-key'] = ANTHROPIC_KEY!
    headers['anthropic-version'] = '2023-06-01'
    // Required for direct browser calls; a server route would not need it.
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  }

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  } catch (e) {
    throw new LLMUnavailable(`Network error: ${(e as Error).message}`)
  }
  if (!res.ok) throw new LLMUnavailable(`${res.status} ${await res.text().catch(() => '')}`)

  const json = (await res.json()) as { content?: { type: string; text?: string }[]; text?: string }
  const text = json.content?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('') ?? json.text
  if (!text) throw new LLMUnavailable('Empty completion')
  return text.trim()
}
