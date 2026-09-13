#!/usr/bin/env node
/* ============================================================================
 * VOICE PROXY — the only process that ever sees ELEVENLABS_API_KEY.
 *
 * The browser POSTs text plus a voice id; this server adds the credential and
 * streams the audio back. The key is read from the environment at startup and
 * is never sent to the client, never logged, and never written into the Vite
 * bundle (no VITE_ prefix, so Vite cannot inline it even by accident).
 *
 *   npm run dev          runs this and Vite together
 *   npm run dev:voice    runs this alone
 *
 *   ELEVENLABS_API_KEY   required for live speech. Absent, /health reports
 *                        `configured: false` and the app falls back to the
 *                        browser speech engine, labelled honestly in the UI.
 *   ELEVENLABS_MODEL     default eleven_turbo_v2_5
 *   ELEVENLABS_STT_MODEL default scribe_v2 (speech-to-text)
 *   VOICE_PROXY_PORT     default 8787
 *   VOICE_PROXY_ORIGIN   extra allowed CORS origin (dev proxy needs none)
 *
 * ROUTES
 *   GET  /api/voice/health   { configured, model, provider }
 *   POST /api/voice/tts      { text, voiceId, fallbackVoiceId?, settings?,
 *                              modelId? } -> audio/mpeg
 *   POST /api/voice/stt      raw recorded audio (content-type = its mime) -> { text }
 *                            transcribed by ElevenLabs Scribe; the key stays here
 *
 * `voiceId` is the cast voice, usually a community ("shared library") voice,
 * which the API only serves to Creator tier and above. When it is rejected for
 * plan reasons the request is retried once with `fallbackVoiceId` — a premade
 * voice available on every plan — so one build works on a free key and a paid
 * one. The response reports which voice actually spoke.
 * ========================================================================== */

import { createServer } from 'node:http'

const PORT = Number(process.env.VOICE_PROXY_PORT ?? 8787)
const API_KEY = process.env.ELEVENLABS_API_KEY ?? ''
const MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_turbo_v2_5'
const EXTRA_ORIGIN = process.env.VOICE_PROXY_ORIGIN ?? ''
const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v2'
/** Tests point this at a fake ElevenLabs. */
const API_BASE = (process.env.ELEVENLABS_API_BASE ?? 'https://api.elevenlabs.io').replace(/\/$/, '')
/** A spoken question, not a podcast: a few minutes of opus is well under this. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024
/** Shorter than this, the recorder captured nothing worth sending. */
const MIN_AUDIO_BYTES = 1000

/** Spoken dialogue, not documents. Caps cost and latency per request. */
const MAX_CHARS = 1200
const UPSTREAM_TIMEOUT_MS = 20_000

/** Plan-gated voice: retry with the premade fallback rather than failing. */
const isPlanRejection = (status, body) =>
  status === 402 ||
  (status === 400 && /free_users_not_allowed|paid_plan_required|creator tier/i.test(body))

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers })
  res.end(body)
}
const json = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), { 'content-type': 'application/json' })

function cors(req, res) {
  const origin = req.headers.origin
  const allowed =
    !origin ||
    origin === EXTRA_ORIGIN ||
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
  if (allowed && origin) res.setHeader('access-control-allow-origin', origin)
  res.setHeader('vary', 'origin')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  return allowed
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 64 * 1024) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const readRaw = (req, max) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > max) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

const extensionFor = (mime) => (/mp4|m4a|aac/.test(mime) ? 'mp4' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm')

/** Speech to text through ElevenLabs Scribe: the browser sends its recording, this adds the key. */
async function transcribe(audio, mime) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const form = new FormData()
    form.append('model_id', STT_MODEL)
    form.append('language_code', 'en')
    form.append('file', new Blob([audio], { type: mime || 'audio/webm' }), `question.${extensionFor(mime)}`)
    const res = await fetch(`${API_BASE}/v1/speech-to-text`, { method: 'POST', signal: ctrl.signal, headers: { 'xi-api-key': API_KEY }, body: form })
    if (!res.ok) return { ok: false, status: res.status, detail: await res.text().catch(() => '') }
    const body = await res.json().catch(() => ({}))
    return { ok: true, text: typeof body.text === 'string' ? body.text.trim() : '' }
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    return { ok: false, status: aborted ? 504 : 502, detail: aborted ? 'upstream timeout' : String(e?.message ?? e) }
  } finally {
    clearTimeout(timer)
  }
}

/** One upstream attempt. Returns either audio or a structured failure. */
async function synthesize({ voiceId, text, modelId, settings }) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${API_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'xi-api-key': API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: modelId || MODEL,
          ...(settings ? { voice_settings: settings } : {}),
        }),
      },
    )
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      return { ok: false, status: res.status, detail }
    }
    return { ok: true, audio: Buffer.from(await res.arrayBuffer()) }
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    return { ok: false, status: aborted ? 504 : 502, detail: aborted ? 'upstream timeout' : String(e?.message ?? e) }
  } finally {
    clearTimeout(timer)
  }
}

const server = createServer(async (req, res) => {
  const allowed = cors(req, res)
  if (req.method === 'OPTIONS') return send(res, allowed ? 204 : 403, '')
  if (!allowed) return json(res, 403, { error: 'origin not allowed' })

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/api/voice/health')
    return json(res, 200, { provider: 'elevenlabs', configured: !!API_KEY, model: MODEL, stt: !!API_KEY, sttModel: STT_MODEL })

  const route = req.method === 'POST' ? url.pathname : ''
  if (route !== '/api/voice/tts' && route !== '/api/voice/stt') return json(res, 404, { error: 'not found' })

  if (!API_KEY)
    return json(res, 503, {
      error: 'not_configured',
      message: 'ELEVENLABS_API_KEY is not set on the voice proxy.',
    })

  if (route === '/api/voice/stt') {
    let audio
    try {
      audio = await readRaw(req, MAX_AUDIO_BYTES)
    } catch {
      return json(res, 413, { error: 'audio_too_large' })
    }
    if (audio.length < MIN_AUDIO_BYTES) return json(res, 400, { error: 'no_audio', message: 'Nothing was recorded.' })
    const result = await transcribe(audio, String(req.headers['content-type'] ?? ''))
    if (result.ok) return json(res, 200, { text: result.text })
    console.warn(`[voice] stt failed: ${result.status} ${String(result.detail).slice(0, 200)}`)
    return json(res, result.status === 504 ? 504 : 502, {
      error: 'stt_failed',
      status: result.status,
      // Upstream detail can carry account metadata — keep it server-side.
      message: 'Speech recognition failed upstream.',
    })
  }

  let payload
  try {
    payload = JSON.parse((await readBody(req)) || '{}')
  } catch {
    return json(res, 400, { error: 'invalid_json' })
  }

  const text = typeof payload.text === 'string' ? payload.text.trim().slice(0, MAX_CHARS) : ''
  const voiceId = typeof payload.voiceId === 'string' ? payload.voiceId : ''
  const fallbackVoiceId = typeof payload.fallbackVoiceId === 'string' ? payload.fallbackVoiceId : ''
  const modelId = typeof payload.modelId === 'string' ? payload.modelId : ''
  const settings = payload.settings && typeof payload.settings === 'object' ? payload.settings : undefined

  if (!text) return json(res, 400, { error: 'missing_text' })
  if (!voiceId) return json(res, 400, { error: 'missing_voice', message: 'No voice configured for this character.' })

  const attempts = fallbackVoiceId && fallbackVoiceId !== voiceId ? [voiceId, fallbackVoiceId] : [voiceId]
  let last
  for (const [i, id] of attempts.entries()) {
    const result = await synthesize({ voiceId: id, text, modelId, settings })
    if (result.ok)
      return send(res, 200, result.audio, {
        'content-type': 'audio/mpeg',
        'content-length': String(result.audio.length),
        'x-voice-id': id,
        'x-voice-fallback': String(i > 0),
      })
    last = result
    const hasFallback = i < attempts.length - 1
    if (!(hasFallback && isPlanRejection(result.status, result.detail))) break
    console.warn(`[voice] cast voice ${id} rejected by plan (${result.status}) — retrying with the premade fallback`)
  }

  console.warn(`[voice] tts failed: ${last?.status} ${String(last?.detail).slice(0, 200)}`)
  return json(res, last?.status === 504 ? 504 : 502, {
    error: 'tts_failed',
    status: last?.status,
    // Upstream detail can carry account metadata — keep it server-side.
    message: 'Speech synthesis failed upstream.',
  })
})

server.listen(PORT, () => {
  console.log(
    `[voice] proxy on http://localhost:${PORT}  ` +
      (API_KEY
        ? `elevenlabs configured · model ${MODEL} · speech-to-text ${STT_MODEL}`
        : 'ELEVENLABS_API_KEY not set — the app will use the browser speech engine'),
  )
})
