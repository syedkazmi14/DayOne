#!/usr/bin/env node
/* ============================================================================
 * ASSET FETCH — character portraits and episode stills.
 *
 * Run once (`npm run assets`) to populate public/characters and
 * public/episodes. Everything the app renders at runtime is then served from
 * this origin: no third-party hotlinking, no broken card art when a wiki CDN
 * moves a file, and the images are in the build output.
 *
 * SOURCES
 *   thesimpsonsapi.com    public JSON API, character portraits + episode stills
 *   *.fandom.com          MediaWiki `pageimages` for every other show
 *
 * LICENSING: these are show screenshots and promotional art fetched from
 * community wikis. Fine for a prototype, NOT cleared for commercial use.
 * Replace them with licensed or customer-supplied artwork before shipping —
 * `assetSource` on each character marks which tier an asset came from.
 * ========================================================================== */

import { execFile } from 'node:child_process'
import { mkdir, writeFile, rm as rmrf } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_CHAR = path.join(ROOT, 'public/characters')
const OUT_EP = path.join(ROOT, 'public/episodes')
const TMP = path.join(ROOT, 'node_modules/.cache/onboard-assets')

const run = (cmd, args) =>
  new Promise((res, rej) => execFile(cmd, args, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))))

/* ------------------------------------------------------------------ sources */

const simp = (n) => `https://cdn.thesimpsonsapi.com/1280/character/${n}.webp`
const simpEp = (n) => `https://cdn.thesimpsonsapi.com/1280/episode/${n}.webp`
const wiki = (host, page) => ({ host, page })

/** characterId -> direct url, or a wiki page to resolve. */
const CHARACTERS = {
  rick: wiki('rickandmorty', 'Rick Sanchez'),
  morty: wiki('rickandmorty', 'Morty Smith'),
  summer: wiki('rickandmorty', 'Summer Smith'),
  jerry: wiki('rickandmorty', 'Jerry Smith'),

  cartman: wiki('southpark', 'Eric Cartman'),
  stan: wiki('southpark', 'Stan Marsh'),
  kyle: wiki('southpark', 'Kyle Broflovski'),
  kenny: wiki('southpark', 'Kenny McCormick'),

  peter: wiki('familyguy', 'Peter Griffin'),
  stewie: wiki('familyguy', 'Stewie Griffin'),
  brian: wiki('familyguy', 'Brian Griffin'),
  lois: wiki('familyguy', 'Lois Griffin'),

  homer: simp(1),
  marge: simp(2),
  bart: simp(3),
  lisa: simp(4),
}

/** episodeId -> still. Ids match src/content/episodes. */
const EPISODES = {
  'rm-ep01': wiki('rickandmorty', 'Lawnmower Dog'),
  'rm-ep02': wiki('rickandmorty', 'M. Night Shaym-Aliens!'),
  'rm-ep03': wiki('rickandmorty', 'Total Rickall'),

  'sp-ep01': wiki('southpark', 'Scott Tenorman Must Die'),
  'sp-ep02': wiki('southpark', 'Casa Bonita'),
  'sp-ep03': wiki('southpark', 'Make Love, Not Warcraft'),

  'fg-ep01': wiki('familyguy', 'Death Has a Shadow'),
  'fg-ep02': wiki('familyguy', 'Road to Rhode Island'),
  'fg-ep03': wiki('familyguy', 'PTV'),

  'si-ep01': simpEp(3),
  'si-ep02': simpEp(12),
  'si-ep03': simpEp(24),
}

/* ------------------------------------------------------------------ helpers */

async function resolveWikiImage({ host, page }) {
  const url =
    `https://${host}.fandom.com/api.php?action=query&format=json&prop=pageimages&piprop=original` +
    `&titles=${encodeURIComponent(page)}`
  const res = await fetch(url, { headers: { 'user-agent': 'onboard-asset-fetch/1.0' } })
  if (!res.ok) throw new Error(`wiki ${host}/${page}: ${res.status}`)
  const json = await res.json()
  const first = Object.values(json?.query?.pages ?? {})[0]
  const src = first?.original?.source
  if (!src) throw new Error(`wiki ${host}/${page}: no page image`)
  return src
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'user-agent': 'onboard-asset-fetch/1.0' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

const dims = async (file) => {
  const out = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file])
  const w = Number(/pixelWidth: (\d+)/.exec(out)?.[1])
  const h = Number(/pixelHeight: (\d+)/.exec(out)?.[1])
  return { w, h }
}

/**
 * Cover-crop to exactly w x h: scale so the short edge meets the target, then
 * centre-crop the overflow. `sips -Z` alone letterboxes, which would leave
 * bars behind the card art.
 */
async function coverCrop(src, dest, w, h) {
  const { w: sw, h: sh } = await dims(src)
  const scaleByWidth = sw / sh < w / h
  await run('sips', [
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', '82',
    scaleByWidth ? '--resampleWidth' : '--resampleHeight',
    String(scaleByWidth ? w : h),
    src, '--out', dest,
  ])
  await run('sips', ['-c', String(h), String(w), dest])
}

async function process(entries, outDir, w, h, label) {
  await mkdir(outDir, { recursive: true })
  const failed = []
  for (const [id, source] of Object.entries(entries)) {
    const dest = path.join(outDir, `${id}.jpg`)
    try {
      const url = typeof source === 'string' ? source : await resolveWikiImage(source)
      const raw = path.join(TMP, `${id}${path.extname(new URL(url).pathname) || '.img'}`)
      await download(url, raw)
      await coverCrop(raw, dest, w, h)
      console.log(`  ok   ${label}/${id}.jpg  ${w}x${h}`)
    } catch (e) {
      failed.push(id)
      console.log(`  FAIL ${label}/${id}: ${e.message}`)
    }
  }
  return failed
}

/* --------------------------------------------------------------------- main */

await mkdir(TMP, { recursive: true })
console.log('characters -> public/characters (640x640)')
const cf = await process(CHARACTERS, OUT_CHAR, 640, 640, 'characters')
console.log('\nepisodes -> public/episodes (1280x720)')
const ef = await process(EPISODES, OUT_EP, 1280, 720, 'episodes')

const missing = [...cf, ...ef]
console.log(
  '\n' +
    (missing.length
      ? `${missing.length} asset(s) unavailable: ${missing.join(', ')} — the UI falls back to the generated portrait/procedural card art for these.`
      : 'all assets fetched'),
)
if (existsSync(TMP)) await rmrf(TMP, { recursive: true, force: true })
