#!/usr/bin/env node
/* ============================================================================
 * MEDIA SERVER — authoring-time asset generation and storage.
 *
 * The only process that sees REPLICATE_API_TOKEN. The Studio asks it for a
 * scene image, a cinematic clip, or a line of dialogue; it calls the provider,
 * downloads the result, and stores it under a cloud-shaped key layout:
 *
 *   company/knowledge/<doc>.txt
 *   company/episodes/<episode>/backgrounds/<scene>.jpg   scene images + keyframes
 *   company/episodes/<episode>/videos/<scene>.mp4        image-to-video clips
 *   company/episodes/<episode>/audio/<scene>-<line>.mp3  dialogue
 *
 * Video is IMAGE-TO-VIDEO: Wan 2.2 I2V Fast animates the scene's stored
 * keyframe, so a clip keeps the composition the Studio already generated. The
 * story is not the model's business — it receives a motion prompt for one shot.
 *
 * Storage is local disk (ASSET_ROOT, default ./storage) served at
 * /api/media/assets/<key>. The keys are object-store keys on purpose: pointing
 * putObject() at S3/R2/GCS is a change to one function, not to the app.
 *
 * It also backs src/data/contentStore.ts's 'db' tier: uploaded documents and
 * the knowledge the Studio extracts from them, in a small SQLite file
 * (CONTENT_DB_PATH, default ./data/content.db, via node:sqlite — built into
 * Node 22.5+, no dependency). This is the one thing here that needs no
 * external account at all: without REPLICATE_API_TOKEN the server still runs,
 * still persists content, and only video/image generation stay unconfigured.
 *
 * Nobody playing an episode ever waits on this server. Without the token,
 * /health reports video and image unconfigured and the app renders procedural
 * previs, labelled as such.
 *
 *   REPLICATE_API_TOKEN    enables scene images + video (Replicate)
 *   REPLICATE_VIDEO_MODEL  default wan-video/wan-2.2-i2v-fast
 *   REPLICATE_IMAGE_MODEL  default black-forest-labs/flux-schnell
 *   REPLICATE_API_BASE     default https://api.replicate.com/v1 (tests point
 *                          this at a fake Replicate server)
 *   VOICE_PROXY_URL        default http://localhost:$VOICE_PROXY_PORT (8787);
 *                          dialogue audio is rendered THROUGH the voice proxy,
 *                          so ELEVENLABS_API_KEY stays in exactly one process
 *   ASSET_ROOT             default ./storage
 *   MEDIA_SERVER_PORT      default 8788
 *
 * ROUTES
 *   GET  /api/media/health
 *   POST /api/media/image        { episodeId, sceneId, prompt } -> { url, storageKey }
 *   POST /api/media/video        { episodeId, sceneId, prompt, imageKey, durationSec? } -> { jobId, status }
 *   GET  /api/media/video/:jobId -> { status: queued|rendering|ready|failed, url?, storageKey?, error? }
 *   POST /api/media/audio        { episodeId, sceneId, lineIndex, text, voiceId, fallbackVoiceId?, settings? }
 *   POST /api/media/knowledge    { docId, text } -> { url, storageKey }
 *   GET  /api/media/assets/<key>
 *   GET  /api/media/content/docs       -> { docs: SourceDoc[] }
 *   POST /api/media/content/docs       one SourceDoc -> { ok }
 *   GET  /api/media/content/knowledge  -> { items: KnowledgeItem[] }
 *   POST /api/media/content/knowledge  { items: KnowledgeItem[] } -> { ok, saved }
 * ========================================================================== */

import { createServer } from 'node:http'
import { createReadStream, mkdirSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.MEDIA_SERVER_PORT ?? 8788)
const TOKEN = process.env.REPLICATE_API_TOKEN ?? ''
const REPLICATE = (process.env.REPLICATE_API_BASE ?? 'https://api.replicate.com/v1').replace(/\/$/, '')
const VIDEO_MODEL = process.env.REPLICATE_VIDEO_MODEL ?? 'wan-video/wan-2.2-i2v-fast'
const IMAGE_MODEL = process.env.REPLICATE_IMAGE_MODEL ?? 'black-forest-labs/flux-schnell'
const VOICE_PROXY = (process.env.VOICE_PROXY_URL ?? `http://localhost:${process.env.VOICE_PROXY_PORT ?? 8787}`).replace(/\/$/, '')
const ASSET_ROOT = path.resolve(ROOT, process.env.ASSET_ROOT ?? 'storage')
const EXTRA_ORIGIN = process.env.MEDIA_SERVER_ORIGIN ?? ''
/** Structured content (uploaded docs + extracted knowledge), separate from
 *  the binary asset store above — a row, not an object, is the natural unit. */
const CONTENT_DB_PATH = path.resolve(ROOT, 'data/content.db')

const PUBLIC_PREFIX = '/api/media/assets/'
const UPSTREAM_TIMEOUT_MS = 90_000
const IMAGE_WAIT_MS = 120_000
const MAX_BODY = 2 * 1024 * 1024
/** Replicate accepts data URLs for small files; keyframes are ~200 KB jpgs. */
const MAX_KEYFRAME_BYTES = 1_000_000
/** Wan 2.2 renders at 16 fps; 81 frames (~5 s) is its sweet spot, 121 its max. */
const WAN_FPS = 16

const TYPES = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
}

/* -------------------------------------------------------------- http utils */

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers })
  res.end(body)
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

function cors(req, res) {
  const origin = req.headers.origin
  const allowed =
    !origin || origin === EXTRA_ORIGIN || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)
  if (allowed && origin) res.setHeader('access-control-allow-origin', origin)
  res.setHeader('vary', 'origin')
  res.setHeader('access-control-allow-headers', 'content-type, range')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  return allowed
}

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })

/** Ids become path segments, so they are allow-listed, never escaped. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/
const safeId = (v) => (typeof v === 'string' && SAFE_ID.test(v) ? v : null)
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
/** A keyframe must be a scene image this server stored — never an arbitrary path. */
const KEYFRAME_KEY = /^company\/episodes\/[A-Za-z0-9][A-Za-z0-9_-]{0,80}\/backgrounds\/[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(jpg|jpeg|png|webp)$/

/* ---------------------------------------------------------------- storage */

const keys = {
  knowledge: (doc) => `company/knowledge/${doc}.txt`,
  image: (ep, scene) => `company/episodes/${ep}/backgrounds/${scene}.jpg`,
  video: (ep, scene) => `company/episodes/${ep}/videos/${scene}.mp4`,
  audio: (ep, scene, i) => `company/episodes/${ep}/audio/${scene}-${i}.mp3`,
}

const inRoot = (key) => {
  const file = path.resolve(ASSET_ROOT, key)
  return file.startsWith(ASSET_ROOT + path.sep) ? file : null
}

/** The one function an object-store adapter would replace. */
async function putObject(key, buffer) {
  const file = path.join(ASSET_ROOT, key)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, buffer)
  return `${PUBLIC_PREFIX}${key}`
}

/* ------------------------------------------------------------- content db */

/**
 * Uploaded source documents and the knowledge extracted from them, so a
 * Studio session survives a reload. Backed by node:sqlite (built into Node
 * 22.5+, no dependency) rather than the object store above — this is a
 * handful of small JSON rows queried by id, not a binary blob served by URL.
 *
 * One file, two tables, each row a JSON blob keyed by the domain id. This
 * mirrors src/data/contentStore.ts's ContentStore shape exactly, so the
 * server has no opinions about what a KnowledgeItem or SourceDoc contains.
 */
mkdirSync(path.dirname(CONTENT_DB_PATH), { recursive: true })
const contentDb = new DatabaseSync(CONTENT_DB_PATH)
contentDb.exec(`
  CREATE TABLE IF NOT EXISTS source_docs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS knowledge_items (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
`)

/** node:sqlite prepares against a fixed SQL string, so each table gets its own statement. */
const upsertSourceDoc = contentDb.prepare(
  'INSERT INTO source_docs (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
)
const upsertKnowledgeItem = contentDb.prepare(
  'INSERT INTO knowledge_items (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
)
const selectSourceDocs = contentDb.prepare('SELECT data FROM source_docs ORDER BY updated_at ASC')
const selectKnowledgeItems = contentDb.prepare('SELECT data FROM knowledge_items ORDER BY updated_at ASC')

const listRows = (stmt) => stmt.all().map((r) => JSON.parse(r.data))

async function serveAsset(req, res, key) {
  const file = inRoot(key)
  if (!file) return json(res, 400, { error: 'bad_key' })
  let info
  try {
    info = await stat(file)
  } catch {
    return json(res, 404, { error: 'not_found' })
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  // Video elements seek with Range requests; honour them.
  if (range) {
    const start = range[1] ? Number(range[1]) : 0
    const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
    if (start > end) return send(res, 416, '', { 'content-range': `bytes */${info.size}` })
    res.writeHead(206, {
      'content-type': type,
      'content-length': String(end - start + 1),
      'content-range': `bytes ${start}-${end}/${info.size}`,
      'accept-ranges': 'bytes',
      'cache-control': 'public, max-age=3600',
    })
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, {
    'content-type': type,
    'content-length': String(info.size),
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=3600',
  })
  createReadStream(file).pipe(res)
}

/* --------------------------------------------------------------- upstream */

async function upstream(url, init = {}, ms = UPSTREAM_TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

const auth = () => ({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' })

/** Provider error text is model output (validation, safety), never account data — still, keep it short. */
const reason = (p) => (p?.error ? `: ${String(p.error).slice(0, 200)}` : '')

/**
 * Prediction creation is serialised and 429-aware. Replicate rate-limits
 * creation (on low-credit accounts: 6 per minute, burst 1), and the Studio asks
 * for several clips at once — without a queue every clip but the first would
 * fail on a limit that clears in seconds.
 */
let creationQueue = Promise.resolve()
const MAX_THROTTLE_RETRIES = 8

function createPrediction(model, input, wait) {
  const run = creationQueue.then(() => createPredictionNow(model, input, wait))
  creationQueue = run.catch(() => {})
  return run
}

async function createPredictionNow(model, input, wait) {
  const headers = { ...auth(), ...(wait ? { prefer: `wait=${wait}` } : {}) }
  const post = async (url, payload) => {
    for (let attempt = 0; ; attempt++) {
      const res = await upstream(url, { method: 'POST', headers, body: JSON.stringify(payload) })
      if (res.status !== 429 || attempt >= MAX_THROTTLE_RETRIES) return res
      const body = await res.json().catch(() => ({}))
      const seconds = Number(body.retry_after ?? res.headers.get('retry-after') ?? 10)
      console.warn(`[media] Replicate throttled prediction creation — retrying in ${seconds}s`)
      await sleep(Math.max(0.1, Number.isFinite(seconds) ? seconds : 10) * 1000)
    }
  }
  let res = await post(`${REPLICATE}/models/${model}/predictions`, { input })
  // Community models are addressed by version rather than by name.
  if (res.status === 404) {
    const meta = await upstream(`${REPLICATE}/models/${model}`, { headers: auth() })
    const version = meta.ok ? (await meta.json())?.latest_version?.id : null
    if (!version) throw new Error(`model ${model} not found on Replicate`)
    res = await post(`${REPLICATE}/predictions`, { version, input })
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.id) throw new Error(`Replicate rejected the request (${res.status})${body.detail ? `: ${String(body.detail).slice(0, 200)}` : ''}`)
  return body
}

async function getPrediction(id) {
  const res = await upstream(`${REPLICATE}/predictions/${encodeURIComponent(id)}`, { headers: auth() })
  if (!res.ok) throw new Error(`Replicate status check failed (${res.status})`)
  return res.json()
}

const outputUrl = (output) => (Array.isArray(output) ? output[0] : output)
const TERMINAL = new Set(['succeeded', 'failed', 'canceled'])

async function download(url) {
  const res = await upstream(url)
  if (!res.ok) throw new Error(`download failed (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

async function voiceConfigured() {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch(`${VOICE_PROXY}/api/voice/health`, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.ok && !!(await res.json()).configured
  } catch {
    return false
  }
}

/* -------------------------------------------------------------- video jobs */

/** jobId -> { status, predictionId, episodeId, sceneId, url?, storageKey?, error?, finishing, misses } */
const jobs = new Map()

async function advanceVideoJob(job) {
  if (job.status === 'ready' || job.status === 'failed' || job.finishing) return job
  let prediction
  try {
    prediction = await getPrediction(job.predictionId)
    job.misses = 0
  } catch (e) {
    // A dropped poll must not fail a paid render; give up only if it keeps happening.
    if (++job.misses >= 5) {
      job.status = 'failed'
      job.error = String(e?.message ?? e)
    }
    return job
  }
  if (prediction.status === 'starting') job.status = 'queued'
  else if (prediction.status === 'processing') job.status = 'rendering'
  else if (prediction.status === 'succeeded') {
    job.finishing = true
    try {
      const url = outputUrl(prediction.output)
      if (!url) throw new Error('Replicate returned no video')
      job.storageKey = keys.video(job.episodeId, job.sceneId)
      job.url = await putObject(job.storageKey, await download(url))
      job.status = 'ready'
    } catch (e) {
      job.status = 'failed'
      job.error = String(e?.message ?? e)
    } finally {
      job.finishing = false
    }
  } else {
    job.status = 'failed'
    job.error = `video generation ${prediction.status}${reason(prediction)}`
  }
  return job
}

const publicJob = (id, j) => ({ jobId: id, status: j.status, url: j.url, storageKey: j.storageKey, error: j.error })

/* ------------------------------------------------------------------ routes */

const notConfigured = (res) =>
  json(res, 503, { error: 'not_configured', message: 'REPLICATE_API_TOKEN is not configured on the media server.' })

const server = createServer(async (req, res) => {
  const allowed = cors(req, res)
  if (req.method === 'OPTIONS') return send(res, allowed ? 204 : 403, '')
  if (!allowed) return json(res, 403, { error: 'origin not allowed' })

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const p = url.pathname

  try {
    if (req.method === 'GET' && p === '/api/media/health')
      return json(res, 200, {
        video: { configured: !!TOKEN, provider: 'replicate', model: VIDEO_MODEL, mode: 'image-to-video' },
        image: { configured: !!TOKEN, provider: 'replicate', model: IMAGE_MODEL },
        audio: { configured: await voiceConfigured(), provider: 'elevenlabs via voice proxy' },
        // Content persistence needs nothing beyond this process being up — no
        // token, no external account — so it is configured whenever this
        // server answers at all.
        content: { configured: true, kind: 'sqlite' },
        storage: { kind: 'local-disk', layout: 'company/{knowledge,episodes/<id>/{videos,backgrounds,audio}}' },
      })

    if (req.method === 'GET' && p === '/api/media/content/docs')
      return json(res, 200, { docs: listRows(selectSourceDocs) })

    if (req.method === 'GET' && p === '/api/media/content/knowledge')
      return json(res, 200, { items: listRows(selectKnowledgeItems) })

    if (req.method === 'GET' && p.startsWith(PUBLIC_PREFIX))
      return serveAsset(req, res, decodeURIComponent(p.slice(PUBLIC_PREFIX.length)))

    if (req.method === 'GET' && p.startsWith('/api/media/video/')) {
      const id = p.slice('/api/media/video/'.length)
      const job = jobs.get(id)
      if (!job) return json(res, 404, { error: 'unknown_job', message: 'No such render job.' })
      return json(res, 200, publicJob(id, await advanceVideoJob(job)))
    }

    if (req.method !== 'POST') return json(res, 404, { error: 'not found' })
    const body = await readJson(req)

    if (p === '/api/media/knowledge') {
      const docId = safeId(body.docId)
      const text = str(body.text, MAX_BODY)
      if (!docId || !text) return json(res, 400, { error: 'invalid_request' })
      const storageKey = keys.knowledge(docId)
      return json(res, 200, { url: await putObject(storageKey, Buffer.from(text, 'utf8')), storageKey })
    }

    /* Structured content: a whole SourceDoc / KnowledgeItem, stored as-is —
     * this server takes no view on what those shapes contain. */
    if (p === '/api/media/content/docs') {
      const id = safeId(body.id)
      if (!id || typeof body.name !== 'string') return json(res, 400, { error: 'invalid_request' })
      upsertSourceDoc.run(id, JSON.stringify(body), new Date().toISOString())
      return json(res, 200, { ok: true })
    }

    if (p === '/api/media/content/knowledge') {
      if (!Array.isArray(body.items)) return json(res, 400, { error: 'invalid_request' })
      const now = new Date().toISOString()
      let saved = 0
      for (const item of body.items) {
        const id = safeId(item?.id)
        if (!id) continue
        upsertKnowledgeItem.run(id, JSON.stringify(item), now)
        saved++
      }
      return json(res, 200, { ok: true, saved })
    }

    if (p === '/api/media/image') {
      if (!TOKEN) return notConfigured(res)
      const episodeId = safeId(body.episodeId)
      const sceneId = safeId(body.sceneId)
      const prompt = str(body.prompt, 2000)
      if (!episodeId || !sceneId || !prompt) return json(res, 400, { error: 'invalid_request' })
      let prediction = await createPrediction(
        IMAGE_MODEL,
        { prompt, aspect_ratio: '16:9', output_format: 'jpg', output_quality: 85, megapixels: '1', num_outputs: 1 },
        60,
      )
      const deadline = Date.now() + IMAGE_WAIT_MS
      while (!TERMINAL.has(prediction.status)) {
        if (Date.now() > deadline) return json(res, 504, { error: 'timeout', message: 'Scene image timed out.' })
        await sleep(1000)
        prediction = await getPrediction(prediction.id)
      }
      if (prediction.status !== 'succeeded')
        return json(res, 502, { error: 'generation_failed', message: `Image generation ${prediction.status}${reason(prediction)}` })
      const imageUrl = outputUrl(prediction.output)
      if (!imageUrl) return json(res, 502, { error: 'no_image', message: 'Replicate returned no image.' })
      const storageKey = keys.image(episodeId, sceneId)
      return json(res, 200, { url: await putObject(storageKey, await download(imageUrl)), storageKey })
    }

    if (p === '/api/media/video') {
      if (!TOKEN) return notConfigured(res)
      const episodeId = safeId(body.episodeId)
      const sceneId = safeId(body.sceneId)
      const prompt = str(body.prompt, 2000)
      if (!episodeId || !sceneId || !prompt) return json(res, 400, { error: 'invalid_request' })
      const imageKey = typeof body.imageKey === 'string' && KEYFRAME_KEY.test(body.imageKey) ? body.imageKey : null
      const file = imageKey && inRoot(imageKey)
      if (!file)
        return json(res, 400, { error: 'image_required', message: 'Wan 2.2 I2V animates a stored scene image — generate the scene image first.' })
      let bytes
      try {
        bytes = await readFile(file)
      } catch {
        return json(res, 404, { error: 'image_missing', message: 'The scene image is not in storage.' })
      }
      if (bytes.length > MAX_KEYFRAME_BYTES) return json(res, 413, { error: 'image_too_large', message: 'Scene image exceeds 1 MB.' })
      const durationSec = clamp(Number(body.durationSec) || 5, 5, 7.5)
      const prediction = await createPrediction(VIDEO_MODEL, {
        image: `data:${TYPES[path.extname(file).toLowerCase()]};base64,${bytes.toString('base64')}`,
        prompt,
        num_frames: clamp(Math.round(durationSec * WAN_FPS) + 1, 81, 121),
        frames_per_second: WAN_FPS,
        resolution: '480p',
        go_fast: true,
      })
      const id = randomUUID()
      const job = { status: 'queued', predictionId: prediction.id, episodeId, sceneId, finishing: false, misses: 0 }
      jobs.set(id, job)
      if (TERMINAL.has(prediction.status)) await advanceVideoJob(job)
      return json(res, 202, publicJob(id, job))
    }

    if (p === '/api/media/audio') {
      const episodeId = safeId(body.episodeId)
      const sceneId = safeId(body.sceneId)
      const lineIndex = Number.isInteger(body.lineIndex) && body.lineIndex >= 0 ? body.lineIndex : null
      const text = str(body.text, 1200)
      if (!episodeId || !sceneId || lineIndex === null || !text || typeof body.voiceId !== 'string')
        return json(res, 400, { error: 'invalid_request' })
      const tts = await upstream(`${VOICE_PROXY}/api/voice/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, voiceId: body.voiceId, fallbackVoiceId: body.fallbackVoiceId, settings: body.settings }),
      })
      if (!tts.ok) return json(res, tts.status === 503 ? 503 : 502, { error: 'tts_failed', message: 'Voice proxy could not render this line.' })
      const storageKey = keys.audio(episodeId, sceneId, lineIndex)
      const stored = await putObject(storageKey, Buffer.from(await tts.arrayBuffer()))
      return json(res, 200, { url: stored, storageKey, voiceId: tts.headers.get('x-voice-id') ?? body.voiceId })
    }

    return json(res, 404, { error: 'not found' })
  } catch (e) {
    const message = String(e?.message ?? e)
    console.warn(`[media] ${req.method} ${p} failed: ${message.slice(0, 240)}`)
    if (message === 'invalid json') return json(res, 400, { error: 'invalid_json' })
    return json(res, 502, { error: 'upstream_failed', message: message.startsWith('Replicate') ? message : 'Asset generation failed upstream.' })
  }
})

server.listen(PORT, () => {
  console.log(
    `[media] server on http://localhost:${PORT}  ` +
      (TOKEN ? `replicate configured · video ${VIDEO_MODEL} (image-to-video) · image ${IMAGE_MODEL}` : 'REPLICATE_API_TOKEN not set — Studio will use procedural previs') +
      `  · storage ${path.relative(ROOT, ASSET_ROOT) || '.'}/` +
      `  · content ${path.relative(ROOT, CONTENT_DB_PATH)}`,
  )
})
