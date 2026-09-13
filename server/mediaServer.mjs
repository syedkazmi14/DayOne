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
 * Storage is Supabase when SUPABASE_URL + SUPABASE_SECRET_KEY are set: media
 * goes to a public Storage bucket (the browser loads it from the bucket's URL),
 * extracted policy text to a private one, and structured rows (published
 * episodes, uploaded docs, knowledge) to Postgres tables with RLS on and no
 * policies — only this process, holding the secret key, can touch them.
 * Without Supabase it is local disk (ASSET_ROOT, default ./storage, served at
 * /api/media/assets/<key>) plus a SQLite file. Same keys, same routes.
 *
 * Anything already in storage is reused: asking for a scene image or clip that
 * exists returns the stored file unless the request says `force: true`.
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
 *   GEMINI_API_KEY         enables per-scene stills from Gemini, drawn with the
 *                          characters' portraits as references (clips stay on Replicate)
 *   GEMINI_IMAGE_MODEL     default gemini-3.1-flash-image
 *   GEMINI_IMAGE_SIZE      default 1K (512px is cheaper, softer)
 *   GEMINI_API_BASE        default https://generativelanguage.googleapis.com/v1beta
 *   REPLICATE_API_BASE     default https://api.replicate.com/v1 (tests point
 *                          this at a fake Replicate server)
 *   VOICE_PROXY_URL        default http://localhost:$VOICE_PROXY_PORT (8787);
 *                          dialogue audio is rendered THROUGH the voice proxy,
 *                          so ELEVENLABS_API_KEY stays in exactly one process
 *   SUPABASE_URL           https://<ref>.supabase.co — with the secret key,
 *   SUPABASE_SECRET_KEY    switches storage + content to Supabase (server only)
 *   SUPABASE_BUCKET        default dayone-assets (public: images, clips, audio)
 *   SUPABASE_PRIVATE_BUCKET default dayone-private (extracted policy text)
 *   ASSET_ROOT             default ./storage (local fallback)
 *   MEDIA_SERVER_PORT      default 8788
 *
 * ROUTES
 *   GET  /api/media/health
 *   POST /api/media/image        { episodeId, sceneId, prompt, showId?, force? } -> { url, storageKey, reused? }
 *   POST /api/media/video        { episodeId, sceneId, prompt, imageKey, durationSec?, showId?, force? } -> { jobId, status }
 *                                showId scopes the asset to one show's world: company/episodes/<ep>/<show>/…
 *   GET  /api/media/video/:jobId -> { status: queued|rendering|ready|failed, url?, storageKey?, error? }
 *   POST /api/media/audio        { episodeId, sceneId, lineIndex, text, voiceId, fallbackVoiceId?, settings? }
 *   POST /api/media/knowledge    { docId, text } -> { url, storageKey }
 *   GET  /api/media/assets/<key>
 *   GET  /api/media/content/docs       -> { docs: SourceDoc[] }
 *   POST /api/media/content/docs       one SourceDoc -> { ok }
 *   GET  /api/media/content/knowledge  -> { items: KnowledgeItem[] }
 *   POST /api/media/content/knowledge  { items: KnowledgeItem[] } -> { ok, saved }
 *   GET  /api/media/episodes           -> { episodes: Episode[] }  (drafts included)
 *   POST /api/media/episodes           { episode } -> { ok }
 *   DELETE /api/media/episodes/:id     -> { ok }
 *   DELETE /api/media/content/docs/:id -> { ok }   (row + its private text)
 *   POST /api/media/content/knowledge/remove  { ids: string[] } -> { ok, removed }
 * ========================================================================== */

import { createServer } from 'node:http'
import { createReadStream, mkdirSync } from 'node:fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
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
const CONTENT_DB_PATH = path.resolve(ROOT, process.env.CONTENT_DB_PATH ?? 'data/content.db')
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY ?? ''
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET ?? 'dayone-assets'
const SUPABASE_PRIVATE_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET ?? 'dayone-private'
const GEMINI_KEY = process.env.GEMINI_API_KEY ?? ''
const GEMINI = (process.env.GEMINI_API_BASE ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')
const GEMINI_IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image'
const GEMINI_IMAGE_SIZE = process.env.GEMINI_IMAGE_SIZE ?? '1K'
/** Character portraits the app already ships; stills reference them by character id. */
const PORTRAITS = path.join(ROOT, 'public', 'characters')
const CHARACTER_ID = /^[a-z][a-z0-9-]{0,40}$/
const MAX_REFERENCES = 4

const PUBLIC_PREFIX = '/api/media/assets/'
const UPSTREAM_TIMEOUT_MS = 90_000
const IMAGE_WAIT_MS = 120_000
const MAX_BODY = 2 * 1024 * 1024
/** Local storage has no public URL, so a keyframe goes to Replicate inline; a 1K still can be a few MB. */
const MAX_KEYFRAME_BYTES = 8_000_000
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
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
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
/** Optional show scope for per-show assets: absent is fine, present must be a safe id. */
const showScope = (v) => (v === undefined || v === null || v === '' ? { ok: true, show: null } : safeId(v) ? { ok: true, show: v } : { ok: false })
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
/** A keyframe must be a scene image this server stored — never an arbitrary path. */
const KEYFRAME_KEY = /^company\/episodes\/[A-Za-z0-9][A-Za-z0-9_-]{0,80}\/(?:[A-Za-z0-9][A-Za-z0-9_-]{0,80}\/)?backgrounds\/[A-Za-z0-9][A-Za-z0-9_-]{0,80}\.(jpg|jpeg|png|webp)$/

/* ---------------------------------------------------------------- storage */

const keys = {
  knowledge: (doc) => `company/knowledge/${doc}.txt`,
  // A show id scopes the asset to that show's world: company/episodes/<ep>/<show>/…
  image: (ep, scene, show, ext = 'jpg') => `company/episodes/${ep}/${show ? `${show}/` : ''}backgrounds/${scene}.${ext}`,
  video: (ep, scene, show) => `company/episodes/${ep}/${show ? `${show}/` : ''}videos/${scene}.mp4`,
  audio: (ep, scene, i) => `company/episodes/${ep}/audio/${scene}-${i}.mp3`,
}

const inRoot = (key) => {
  const file = path.resolve(ASSET_ROOT, key)
  return file.startsWith(ASSET_ROOT + path.sep) ? file : null
}

/* Supabase, when configured. The secret key only ever travels from this
 * process to Supabase; responses to the browser carry public URLs and rows. */
const supabase = !!(SUPABASE_URL && SUPABASE_KEY)
const supaHeaders = (extra = {}) => ({
  apikey: SUPABASE_KEY,
  // Opaque sb_secret_ keys go in apikey alone; a legacy service_role JWT is also a bearer token.
  ...(SUPABASE_KEY.startsWith('sb_') ? {} : { authorization: `Bearer ${SUPABASE_KEY}` }),
  ...extra,
})
const encodeKey = (key) => key.split('/').map(encodeURIComponent).join('/')
const publicUrl = (key) => `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/${encodeKey(key)}`

async function supa(route, init = {}) {
  const res = await upstream(`${SUPABASE_URL}${route}`, { ...init, headers: supaHeaders(init.headers) })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Supabase ${init.method ?? 'GET'} ${route.split('?')[0]} failed (${res.status}) ${detail.slice(0, 160)}`)
  }
  return res
}

const mimeOf = (key) => TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream'

/**
 * Store bytes under an object key and return the URL the browser loads.
 * `private` objects (extracted policy text) never get a public URL.
 */
async function putObject(key, buffer, { private: isPrivate = false } = {}) {
  if (supabase) {
    const bucket = isPrivate ? SUPABASE_PRIVATE_BUCKET : SUPABASE_BUCKET
    await supa(`/storage/v1/object/${bucket}/${encodeKey(key)}`, {
      method: 'POST',
      headers: { 'content-type': mimeOf(key).split(';')[0], 'x-upsert': 'true' },
      body: buffer,
    })
    // Re-renders overwrite the same key; the version stops the CDN serving the old file.
    return isPrivate ? null : `${publicUrl(key)}?v=${Date.now()}`
  }
  const file = path.join(ASSET_ROOT, key)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, buffer)
  return `${PUBLIC_PREFIX}${key}`
}

/** Bytes of a stored object, or null when it is not there. */
async function getObject(key) {
  if (supabase) {
    const res = await upstream(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${encodeKey(key)}`, { headers: supaHeaders() })
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  }
  const file = inRoot(key)
  if (!file) return null
  return readFile(file).catch(() => null)
}

/** The URL of a stored public object, or null — how generation skips work already paid for. */
async function existingObject(key) {
  if (supabase) {
    const res = await upstream(publicUrl(key), { method: 'HEAD' }).catch(() => null)
    return res?.ok ? publicUrl(key) : null
  }
  const file = inRoot(key)
  return file && (await stat(file).catch(() => null)) ? `${PUBLIC_PREFIX}${key}` : null
}

/** A stored still in whichever format its provider returned (Gemini PNG, FLUX JPEG). */
async function existingImage(ep, scene, show) {
  for (const ext of ['png', 'jpg', 'webp']) {
    const key = keys.image(ep, scene, show, ext)
    const url = await existingObject(key)
    if (url) return { url, key }
  }
  return null
}

/** Delete a stored object. One that is already gone is not an error. */
async function removeObject(key, { private: isPrivate = false } = {}) {
  if (supabase) {
    const bucket = isPrivate ? SUPABASE_PRIVATE_BUCKET : SUPABASE_BUCKET
    await upstream(`${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeKey(key)}`, { method: 'DELETE', headers: supaHeaders() }).catch(() => null)
    return
  }
  const file = inRoot(key)
  if (file) await unlink(file).catch(() => {})
}

/* ---------------------------------------------------------------- content */

/**
 * Structured rows: uploaded source documents, the knowledge extracted from
 * them, and episodes the Studio saved. Each row is the domain object as JSON,
 * keyed by its id — this server has no opinions about what those shapes
 * contain (episodes are re-validated by the reducer when they load).
 *
 * Supabase Postgres when configured; otherwise a local node:sqlite file
 * (built into Node 22.5+, no dependency) with the same three tables.
 */
const TABLES = ['source_docs', 'knowledge_items', 'episodes']

function supabaseRows() {
  return {
    kind: 'supabase',
    async list(table) {
      const res = await supa(`/rest/v1/${table}?select=data&order=updated_at.asc`)
      return (await res.json()).map((r) => r.data)
    },
    async upsert(table, records) {
      if (!records.length) return
      const updated_at = new Date().toISOString()
      await supa(`/rest/v1/${table}?on_conflict=id`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(
          records.map((r) => ({ id: r.id, data: r.data, updated_at, ...(table === 'episodes' ? { status: r.status } : {}) })),
        ),
      })
    },
    async remove(table, id) {
      await supa(`/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } })
    },
  }
}

function sqliteRows() {
  mkdirSync(path.dirname(CONTENT_DB_PATH), { recursive: true })
  const db = new DatabaseSync(CONTENT_DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_docs (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS knowledge_items (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
  `)
  // node:sqlite prepares against a fixed SQL string, so each table gets its own statements.
  const stmts = Object.fromEntries(
    TABLES.map((t) => [
      t,
      {
        list: db.prepare(`SELECT data FROM ${t} ORDER BY updated_at ASC`),
        upsert:
          t === 'episodes'
            ? db.prepare(
                'INSERT INTO episodes (id, status, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at',
              )
            : db.prepare(
                `INSERT INTO ${t} (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
              ),
        remove: db.prepare(`DELETE FROM ${t} WHERE id = ?`),
      },
    ]),
  )
  return {
    kind: 'sqlite',
    async list(table) {
      return stmts[table].list.all().map((r) => JSON.parse(r.data))
    },
    async upsert(table, records) {
      const now = new Date().toISOString()
      for (const r of records) {
        if (table === 'episodes') stmts[table].upsert.run(r.id, r.status, JSON.stringify(r.data), now)
        else stmts[table].upsert.run(r.id, JSON.stringify(r.data), now)
      }
    },
    async remove(table, id) {
      stmts[table].remove.run(id)
    },
  }
}

const rows = supabase ? supabaseRows() : sqliteRows()

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

/* ----------------------------------------------------------- gemini stills */

const sniffImage = (buf) =>
  buf[0] === 0x89 && buf[1] === 0x50
    ? 'image/png'
    : buf[0] === 0xff && buf[1] === 0xd8
      ? 'image/jpeg'
      : buf.subarray(8, 12).toString('ascii') === 'WEBP'
        ? 'image/webp'
        : null

/** A character's portrait from the app's own art, by id — never an arbitrary path. */
async function loadPortrait(id) {
  if (typeof id !== 'string' || !CHARACTER_ID.test(id)) return null
  const bytes = await readFile(path.join(PORTRAITS, `${id}.jpg`)).catch(() => null)
  const mime = bytes && sniffImage(bytes)
  return mime ? { mime, data: bytes.toString('base64') } : null
}

const retryDelaySeconds = (res, body) => {
  const info = body?.error?.details?.find((d) => typeof d?.retryDelay === 'string')
  const s = info ? parseFloat(info.retryDelay) : Number(res.headers.get('retry-after'))
  return Number.isFinite(s) && s > 0 ? s : 10
}

/**
 * One still from Gemini: the prompt, then each character's portrait as a
 * reference image. Returns the image bytes, or { refused } with Gemini's reason
 * when it declines — a refusal is an answer the Studio acts on, not an error.
 */
async function generateStill(prompt, portraits) {
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, ...portraits.map((p) => ({ inline_data: { mime_type: p.mime, data: p.data } }))],
      },
    ],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: GEMINI_IMAGE_SIZE } },
  }
  for (let attempt = 0; ; attempt++) {
    const res = await upstream(
      `${GEMINI}/models/${GEMINI_IMAGE_MODEL}:generateContent`,
      { method: 'POST', headers: { 'x-goog-api-key': GEMINI_KEY, 'content-type': 'application/json' }, body: JSON.stringify(payload) },
      IMAGE_WAIT_MS,
    )
    const body = await res.json().catch(() => ({}))
    // A 429 is worth waiting out only when it is a rate limit: an exhausted prepay balance or a daily quota will not clear in seconds.
    const unrecoverable = /prepayment|credits are depleted|billing|per day/i.test(String(body?.error?.message ?? ''))
    if ((res.status === 429 || res.status === 503) && !unrecoverable && attempt < MAX_THROTTLE_RETRIES) {
      const seconds = retryDelaySeconds(res, body)
      console.warn(`[media] Gemini ${res.status} — retrying in ${seconds}s`)
      await sleep(Math.max(0.1, seconds) * 1000)
      continue
    }
    if (!res.ok)
      throw new Error(`Gemini rejected the request (${res.status})${body?.error?.message ? `: ${String(body.error.message).slice(0, 200)}` : ''}`)
    const candidate = body.candidates?.[0]
    const parts = candidate?.content?.parts ?? []
    const image = parts.map((p) => p.inlineData ?? p.inline_data).find((d) => d?.data)
    if (!image) {
      const note = parts.map((p) => p.text).filter(Boolean).join(' ').slice(0, 160)
      return { refused: body.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'NO_IMAGE', note }
    }
    return { mime: image.mimeType ?? image.mime_type ?? 'image/png', bytes: Buffer.from(image.data, 'base64') }
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
      job.storageKey = keys.video(job.episodeId, job.sceneId, job.showId)
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

const publicJob = (id, j) => ({ jobId: id, status: j.status, url: j.url, storageKey: j.storageKey, error: j.error, reused: j.reused })

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
        image: GEMINI_KEY
          ? { configured: true, provider: 'gemini', model: GEMINI_IMAGE_MODEL, characters: true }
          : { configured: !!TOKEN, provider: 'replicate', model: IMAGE_MODEL },
        audio: { configured: await voiceConfigured(), provider: 'elevenlabs via voice proxy' },
        // Content persistence needs no generation token: Supabase when it is
        // configured, the local SQLite file otherwise — so it is available
        // whenever this server answers at all.
        content: { configured: true, kind: rows.kind, episodes: true },
        storage: {
          kind: supabase ? 'supabase' : 'local-disk',
          layout: 'company/{knowledge,episodes/<id>/{videos,backgrounds,audio}}',
          ...(supabase ? { bucket: SUPABASE_BUCKET } : {}),
        },
      })

    if (req.method === 'GET' && p === '/api/media/content/docs')
      return json(res, 200, { docs: await rows.list('source_docs') })

    if (req.method === 'GET' && p === '/api/media/content/knowledge')
      return json(res, 200, { items: await rows.list('knowledge_items') })

    if (req.method === 'GET' && p === '/api/media/episodes')
      return json(res, 200, { episodes: await rows.list('episodes') })

    if (req.method === 'DELETE' && p.startsWith('/api/media/episodes/')) {
      const id = safeId(decodeURIComponent(p.slice('/api/media/episodes/'.length)))
      if (!id) return json(res, 400, { error: 'invalid_request' })
      await rows.remove('episodes', id)
      return json(res, 200, { ok: true })
    }

    if (req.method === 'DELETE' && p.startsWith('/api/media/content/docs/')) {
      const id = safeId(decodeURIComponent(p.slice('/api/media/content/docs/'.length)))
      if (!id) return json(res, 400, { error: 'invalid_request' })
      await rows.remove('source_docs', id)
      await removeObject(keys.knowledge(id), { private: true })
      return json(res, 200, { ok: true })
    }

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
      const stored = await putObject(storageKey, Buffer.from(text, 'utf8'), { private: true })
      return json(res, 200, { ...(stored ? { url: stored } : {}), storageKey })
    }

    /* Structured content: a whole SourceDoc / KnowledgeItem, stored as-is —
     * this server takes no view on what those shapes contain. */
    if (p === '/api/media/content/docs') {
      const id = safeId(body.id)
      if (!id || typeof body.name !== 'string') return json(res, 400, { error: 'invalid_request' })
      await rows.upsert('source_docs', [{ id, data: body }])
      return json(res, 200, { ok: true })
    }

    if (p === '/api/media/content/knowledge') {
      if (!Array.isArray(body.items)) return json(res, 400, { error: 'invalid_request' })
      const records = body.items.filter((item) => safeId(item?.id)).map((item) => ({ id: item.id, data: item }))
      await rows.upsert('knowledge_items', records)
      return json(res, 200, { ok: true, saved: records.length })
    }

    if (p === '/api/media/content/knowledge/remove') {
      if (!Array.isArray(body.ids)) return json(res, 400, { error: 'invalid_request' })
      const ids = body.ids.map(safeId).filter(Boolean)
      for (const id of ids) await rows.remove('knowledge_items', id)
      return json(res, 200, { ok: true, removed: ids.length })
    }

    /* An episode the Studio saved (draft or live). Shape-checked only: every
     * client re-runs validateEpisode before an episode can be played. */
    if (p === '/api/media/episodes') {
      const episode = body.episode
      const id = safeId(episode?.id)
      const status = episode?.provenance?.status
      if (!id || (status !== 'draft' && status !== 'published') || !episode.scenes || typeof episode.scenes !== 'object')
        return json(res, 400, { error: 'invalid_request' })
      await rows.upsert('episodes', [{ id, status, data: episode }])
      return json(res, 200, { ok: true })
    }

    if (p === '/api/media/image') {
      if (!TOKEN && !GEMINI_KEY) return notConfigured(res)
      const episodeId = safeId(body.episodeId)
      const sceneId = safeId(body.sceneId)
      const prompt = str(body.prompt, 2000)
      if (!episodeId || !sceneId || !prompt) return json(res, 400, { error: 'invalid_request' })
      const scope = showScope(body.showId)
      if (!scope.ok) return json(res, 400, { error: 'invalid_request' })
      const references = Array.isArray(body.references) ? body.references : []
      if (references.length > MAX_REFERENCES)
        return json(res, 400, { error: 'invalid_request', message: `At most ${MAX_REFERENCES} character references.` })
      const portraits = await Promise.all(references.map(loadPortrait))
      if (portraits.some((p) => !p)) return json(res, 400, { error: 'unknown_character', message: 'A referenced character has no portrait.' })
      const existing = body.force === true ? null : await existingImage(episodeId, sceneId, scope.show)
      if (existing) return json(res, 200, { url: existing.url, storageKey: existing.key, reused: true })

      if (GEMINI_KEY) {
        const still = await generateStill(prompt, portraits)
        if (still.refused)
          return json(res, 422, { error: 'refused', message: `Gemini declined this image (${still.refused})${still.note ? `: ${still.note}` : ''}` })
        const ext = still.mime.includes('png') ? 'png' : still.mime.includes('webp') ? 'webp' : 'jpg'
        const stillKey = keys.image(episodeId, sceneId, scope.show, ext)
        const stillUrl = await putObject(stillKey, still.bytes)
        // A clip animates its still: once the still is redrawn, the stored clip is stale and must not be reused.
        await removeObject(keys.video(episodeId, sceneId, scope.show))
        return json(res, 200, { url: stillUrl, storageKey: stillKey, provider: 'gemini', characters: references })
      }

      const storageKey = keys.image(episodeId, sceneId, scope.show)
      // No synchronous wait: creation is serialised, so waiting inside the queue
      // held every other scene back until this one finished (~1 image a minute).
      let prediction = await createPrediction(IMAGE_MODEL, {
        prompt,
        aspect_ratio: '16:9',
        output_format: 'jpg',
        output_quality: 85,
        megapixels: '1',
        num_outputs: 1,
      })
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
      const imageStored = await putObject(storageKey, await download(imageUrl))
      await removeObject(keys.video(episodeId, sceneId, scope.show))
      return json(res, 200, { url: imageStored, storageKey })
    }

    if (p === '/api/media/video') {
      if (!TOKEN) return notConfigured(res)
      const episodeId = safeId(body.episodeId)
      const sceneId = safeId(body.sceneId)
      const prompt = str(body.prompt, 2000)
      if (!episodeId || !sceneId || !prompt) return json(res, 400, { error: 'invalid_request' })
      // A clip already in storage is reused: a re-render is a paid prediction, so it has to be asked for.
      const scope = showScope(body.showId)
      if (!scope.ok) return json(res, 400, { error: 'invalid_request' })
      const videoKey = keys.video(episodeId, sceneId, scope.show)
      const existing = body.force === true ? null : await existingObject(videoKey)
      if (existing) {
        const id = randomUUID()
        const job = { status: 'ready', url: existing, storageKey: videoKey, episodeId, sceneId, showId: scope.show, finishing: false, misses: 0, reused: true }
        jobs.set(id, job)
        return json(res, 202, publicJob(id, job))
      }
      const imageKey = typeof body.imageKey === 'string' && KEYFRAME_KEY.test(body.imageKey) ? body.imageKey : null
      if (!imageKey)
        return json(res, 400, { error: 'image_required', message: 'Wan 2.2 I2V animates a stored scene image — generate the scene image first.' })
      // A public bucket URL is fetched by Replicate directly (a 1K still is too big to inline);
      // local storage has no public URL, so the bytes go inline.
      let image = supabase ? await existingObject(imageKey) : null
      if (!supabase) {
        const bytes = await getObject(imageKey)
        if (bytes && bytes.length > MAX_KEYFRAME_BYTES) return json(res, 413, { error: 'image_too_large', message: 'Scene image exceeds 8 MB.' })
        image = bytes && `data:${mimeOf(imageKey)};base64,${bytes.toString('base64')}`
      }
      if (!image) return json(res, 404, { error: 'image_missing', message: 'The scene image is not in storage.' })
      const durationSec = clamp(Number(body.durationSec) || 5, 5, 7.5)
      const prediction = await createPrediction(VIDEO_MODEL, {
        image,
        prompt,
        num_frames: clamp(Math.round(durationSec * WAN_FPS) + 1, 81, 121),
        frames_per_second: WAN_FPS,
        resolution: '480p',
        go_fast: true,
      })
      const id = randomUUID()
      const job = { status: 'queued', predictionId: prediction.id, episodeId, sceneId, showId: scope.show, finishing: false, misses: 0 }
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
    return json(res, 502, { error: 'upstream_failed', message: /^(Replicate|Supabase|Gemini)/.test(message) ? message : 'Asset generation failed upstream.' })
  }
})

server.listen(PORT, () => {
  console.log(
    `[media] server on http://localhost:${PORT}  ` +
      (TOKEN ? `replicate configured · video ${VIDEO_MODEL} (image-to-video) · image ${IMAGE_MODEL}` : 'REPLICATE_API_TOKEN not set — Studio will use procedural previs') +
      (GEMINI_KEY ? `  · stills gemini ${GEMINI_IMAGE_MODEL} ${GEMINI_IMAGE_SIZE} (with character references)` : '') +
      (supabase
        ? `  · storage + content: supabase (${new URL(SUPABASE_URL).host}, bucket ${SUPABASE_BUCKET})`
        : `  · storage ${path.relative(ROOT, ASSET_ROOT) || '.'}/  · content ${path.relative(ROOT, CONTENT_DB_PATH)}`),
  )
})
