#!/usr/bin/env node
/* ============================================================================
 * ASSET OPTIMISE — responsive WebP derivatives for the fetched artwork.
 *
 * `npm run assets` writes one baseline JPEG per asset at its largest needed
 * size (characters 640x640, episodes 1280x720). Every surface then reused that
 * one file: a 58px intro avatar and a 295px roster card both pulled the same
 * 640px, ~52KB JPEG. This script derives the ladder those surfaces actually
 * want, in WebP:
 *
 *   public/characters/<id>.jpg  ->  <id>-160.webp  <id>-320.webp  <id>-640.webp
 *   public/episodes/<id>.jpg    ->  <id>-640.webp  <id>-1280.webp
 *
 * The JPEG stays exactly as it was and stays the `<img src>`, so it remains
 * the fallback in `<picture>` and nothing about the artwork changes — these
 * are additional encodings of the same crop, not a new look.
 *
 * Requires `cwebp` (brew install webp). If it is missing this exits 0 with a
 * notice: the app still renders from the JPEGs, just without the saving, so a
 * machine without the encoder can still build and run.
 * ========================================================================== */

import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Keep in sync with LADDER in src/components/ui/responsiveImage.ts. */
const SETS = [
  { dir: 'public/characters', widths: [160, 320, 640], quality: 80 },
  { dir: 'public/episodes', widths: [640, 1280], quality: 80 },
]

const run = (cmd, args) =>
  new Promise((res, rej) => execFile(cmd, args, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so))))

const has = async (cmd) => {
  try {
    await run('command', ['-v', cmd])
    return true
  } catch {
    try {
      await run(cmd, ['-version'])
      return true
    } catch {
      return false
    }
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)}kB`

if (!(await has('cwebp'))) {
  console.log('cwebp not found — skipping WebP derivatives (install with `brew install webp`).')
  console.log('The app falls back to the JPEGs, so this is not fatal.')
  process.exit(0)
}

let before = 0
let after = 0
let written = 0

for (const { dir, widths, quality } of SETS) {
  const abs = path.join(ROOT, dir)
  const files = (await readdir(abs)).filter((f) => f.endsWith('.jpg')).sort()
  console.log(`${dir} -> ${widths.join('w, ')}w webp`)

  for (const file of files) {
    const src = path.join(abs, file)
    const id = file.replace(/\.jpg$/, '')
    const srcBytes = (await stat(src)).size
    before += srcBytes

    const sizes = []
    for (const w of widths) {
      const dest = path.join(abs, `${id}-${w}.webp`)
      // `-resize w 0` keeps the aspect ratio; the crop is already correct.
      await run('cwebp', ['-quiet', '-q', String(quality), '-resize', String(w), '0', src, '-o', dest])
      const outBytes = (await stat(dest)).size
      sizes.push(`${w}w ${kb(outBytes)}`)
      after += outBytes
      written++
    }
    console.log(`  ok   ${id}  jpg ${kb(srcBytes)}  ->  ${sizes.join('  ')}`)
  }
}

console.log(
  `\n${written} derivative(s) written. Baseline JPEGs total ${kb(before)}; ` +
    `the full WebP ladder totals ${kb(after)}, and no surface loads the whole ladder — ` +
    'each picks the one rung its rendered size needs.',
)
