#!/usr/bin/env node
/* ============================================================================
 * VISUAL VERIFICATION — the checks jsdom structurally cannot make.
 *
 * `verify:walkthrough` renders the real app and asserts behaviour, but jsdom
 * has no layout engine and never loads an image, so it is blind to a whole
 * class of bug. Every assertion below exists because it caught a real one:
 *
 *   hero height          an `h-full` child inside a `min-h` parent collapses
 *                        to zero, taking the hero art with it
 *   content clipping     a <button> computes align-items:flex-start from the
 *                        UA stylesheet, so flex-col children shrink-wrap to
 *                        max-content and clip at narrow widths
 *   off-screen chrome    an absolutely-positioned corner control that slides
 *                        out of the viewport at a width nobody checked
 *   invisible images     a cached image fires `load` before React attaches
 *                        onLoad, so an opacity fade-in never runs
 *   page overflow        anything that makes the document scroll sideways
 *
 * It drives real Chrome over the DevTools protocol via puppeteer-core, so
 * there is no bundled browser download: it uses the Chrome already on the
 * machine (or $PUPPETEER_EXECUTABLE_PATH). Screenshots land in
 * scripts/.out/shots/ as artifacts.
 *
 * It starts Vite AND the voice proxy, mirroring `npm run dev`, so the page
 * under test is in the same shape a developer sees. No ELEVENLABS_API_KEY is
 * needed: the proxy reports `configured: false` and the app labels itself
 * BROWSER SYNTH, which is exactly the default path worth regression-testing.
 *
 *   npm run verify:visual
 * ========================================================================== */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'scripts/.out/shots')
const PORT = Number(process.env.VISUAL_PORT ?? 5199)
const URL = `http://localhost:${PORT}/`

/* ------------------------------------------------------------ chrome lookup */

const CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)

const chrome = CANDIDATES.find((p) => existsSync(p))
if (!chrome) {
  console.error(
    'No Chrome or Chromium found. Install one (macOS: brew install --cask google-chrome)\n' +
      'or set PUPPETEER_EXECUTABLE_PATH to an existing binary.\n' +
      'Looked in:\n' + CANDIDATES.map((c) => '  ' + c).join('\n'),
  )
  process.exit(1)
}

/* ------------------------------------------------------------- test harness */

let fails = 0
const ok = (cond, msg) => {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
  if (!cond) fails++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------- dev server */

mkdirSync(SHOTS, { recursive: true })

const VOICE_PORT = Number(process.env.VISUAL_VOICE_PORT ?? 8799)
let viteOut = ''
const children = []
const start = (args, env) => {
  const c = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  })
  c.stdout.on('data', (d) => (viteOut += d))
  c.stderr.on('data', (d) => (viteOut += d))
  children.push(c)
  return c
}

const MEDIA_PORT = Number(process.env.VISUAL_MEDIA_PORT ?? 8798)
start(['server/voiceProxy.mjs'], { VOICE_PROXY_PORT: String(VOICE_PORT), ELEVENLABS_API_KEY: '' })
// No REPLICATE_API_TOKEN: the app must report procedural previs, which is the default path.
start(['server/mediaServer.mjs'], { MEDIA_SERVER_PORT: String(MEDIA_PORT), VOICE_PROXY_PORT: String(VOICE_PORT), REPLICATE_API_TOKEN: '' })
start(['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], {
  VOICE_PROXY_PORT: String(VOICE_PORT),
  MEDIA_SERVER_PORT: String(MEDIA_PORT),
})

const shutdown = () => {
  for (const c of children) if (!c.killed) c.kill('SIGTERM')
}
process.on('exit', shutdown)
process.on('SIGINT', () => {
  shutdown()
  process.exit(130)
})

// Wait for Vite to answer rather than sleeping a fixed amount.
let up = false
for (let i = 0; i < 60 && !up; i++) {
  await sleep(250)
  try {
    up = (await fetch(URL)).ok
  } catch {
    /* not listening yet */
  }
}
if (!up) {
  console.error('vite did not come up on ' + URL + '\n' + viteOut)
  process.exit(1)
}

/* ------------------------------------------------------------------ browser */

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'],
})
const page = await browser.newPage()
/* The app opens on the sign-in gate, and a signed-in player who has never
 * chosen a show gets the picker. Both are seeded before any page script runs,
 * so the first paint is Home; the picker has its own pass at the end. */
const seedSignedIn = (page) =>
  page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem(
        'onboard.session.v1',
        JSON.stringify({ role: 'employee', provider: 'Company SSO', signedInAt: Date.now() }),
      )
      localStorage.setItem('onboard.group.v1', 'rick-and-morty')
    } catch {}
  })
await seedSignedIn(page)

const problems = []
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()))
page.on('response', (r) => {
  // A missing favicon is noise, not a regression in the app.
  if (r.status() >= 400 && !r.url().endsWith('/favicon.ico'))
    problems.push(`http ${r.status()}: ${r.url().replace(URL, '/')}`)
})

/** Everything measured in one page evaluation, so the DOM is read once. */
const probe = () =>
  page.evaluate(() => {
    const rounded = (n) => Math.round(n)
    const doc = document.documentElement

    const hero = document.querySelector('main [class*="min-h-"]')
    const switcher = document.querySelector('[role="group"][aria-label="Character roster"]')
    const portraits = [...document.querySelectorAll('[aria-label="Characters"] button[aria-pressed]')]
    const shelfCards = [...document.querySelectorAll('main .grid > *')]

    const imgs = [...document.querySelectorAll('img')].map((e) => ({
      src: (e.currentSrc || e.src).replace(location.origin, ''),
      complete: e.complete,
      natural: e.naturalWidth,
      opacity: getComputedStyle(e).opacity,
      lazy: e.loading === 'lazy',
    }))

    return {
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      heroHeight: hero ? rounded(hero.getBoundingClientRect().height) : 0,
      // The switcher must stay inside the viewport at every width.
      switcher: switcher
        ? (() => {
            const r = switcher.getBoundingClientRect()
            return { right: rounded(r.right), left: rounded(r.left), top: rounded(r.top), w: rounded(r.width) }
          })()
        : null,
      portraitCount: portraits.length,
      // An element whose content is wider than itself is clipping its own text.
      clippedCards: [...portraits, ...shelfCards]
        .map((c) => ({ w: c.clientWidth, content: c.scrollWidth }))
        .filter((c) => c.content > c.w + 1),
      cardCount: shelfCards.length,
      carouselGone: !document.querySelector('[aria-roledescription="carousel"]'),
      invisibleLoaded: imgs.filter((i) => i.complete && i.natural > 0 && i.opacity === '0').map((i) => i.src),
      brokenEager: imgs.filter((i) => !i.lazy && (!i.complete || i.natural === 0)).map((i) => i.src),
      imgTotal: imgs.length,
      shelf: [...document.querySelectorAll('h3')].map((e) => e.textContent),
      groupName: switcher?.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? null,
    }
  })

const shot = async (name, opts = {}) => {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts })
}

async function viewport(label, width, height) {
  console.log(`\n=== ${label} · ${width}x${height} ===`)
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  await page.goto(URL, { waitUntil: 'networkidle2' })
  await sleep(1200)

  let m = await probe()
  ok(m.pageOverflow <= 0, `no horizontal page overflow (${m.pageOverflow}px)`)
  ok(m.heroHeight > 300, `hero art has real height (${m.heroHeight}px) — not collapsed`)
  ok(m.carouselGone, 'no big roster card section on the page')
  ok(!!m.switcher, 'cast switcher rendered')
  ok(m.portraitCount === 4, `${m.portraitCount} character portraits in the switcher`)
  ok(
    !!m.switcher && m.switcher.left >= 0 && m.switcher.right <= width,
    `switcher sits inside the viewport (${m.switcher?.left}..${m.switcher?.right} of ${width})`,
  )
  ok(m.cardCount === 3, `${m.cardCount} episodes on the shelf underneath`)
  ok(
    m.clippedCards.length === 0,
    `nothing clips its own content${m.clippedCards.length ? ` — ${JSON.stringify(m.clippedCards)}` : ''}`,
  )
  ok(
    m.invisibleLoaded.length === 0,
    `no loaded-but-invisible images${m.invisibleLoaded.length ? ` — ${m.invisibleLoaded.join(', ')}` : ''}`,
  )
  ok(m.brokenEager.length === 0, `every eager image decoded${m.brokenEager.length ? ` — ${m.brokenEager.join(', ')}` : ''}`)
  await shot(`${label}-1-hero`)

  // Switch show from the account menu and re-check everything that moved.
  const before = m.shelf.join('|')
  await page.click('button[aria-label*="account menu"]')
  await sleep(300)
  const opened = await page.evaluate(() => {
    const trigger = [...document.querySelectorAll('[role="menuitem"]')].find((b) =>
      b.textContent?.includes('Change show'),
    )
    trigger?.click()
    return !!trigger
  })
  await sleep(300)
  const switched = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="menuitemradio"]')]
    const next = rows.find((b) => b.getAttribute('aria-checked') !== 'true')
    next?.click()
    return { rows: rows.length, name: next?.textContent?.trim() ?? null }
  })
  await sleep(1100)
  m = await probe()

  ok(opened, 'the account menu offers Change show')
  ok(switched.rows === 4, `its flyout lists all four shows (got ${switched.rows})`)
  ok(m.shelf.join('|') !== before, `episode shelf followed the show (now: ${m.shelf.join(' / ')})`)
  ok(!!m.groupName, `cast strip names the new show (${m.groupName})`)
  ok(m.pageOverflow <= 0, `still no horizontal overflow after switching (${m.pageOverflow}px)`)
  ok(m.portraitCount === 4, 'four portraits on the second show')
  ok(m.clippedCards.length === 0, 'nothing clips on the second show')
  ok(
    m.invisibleLoaded.length === 0,
    `no invisible images after the show change${m.invisibleLoaded.length ? ` — ${m.invisibleLoaded.join(', ')}` : ''}`,
  )
  await shot(`${label}-2-second-show`)
  await shot(`${label}-3-full`, { fullPage: true })
}

await viewport('desktop', 1440, 900)
await viewport('mobile', 390, 844)

/* The onboarding picker, which a first-time player meets before any of the
 * above. It needs its own page because the seed at the top deliberately skips
 * it, and it is a four-up grid of art tiles — exactly the shape that clips at
 * one width and not another. */
console.log('\n=== onboarding picker ===')
const firstRun = await browser.newPage()
firstRun.on('pageerror', (e) => problems.push('pageerror: ' + e.message))
firstRun.on('console', (m) => m.type() === 'error' && problems.push('console: ' + m.text()))
await firstRun.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem(
      'onboard.session.v1',
      JSON.stringify({ role: 'employee', provider: 'Company SSO', signedInAt: Date.now() }),
    )
    localStorage.removeItem('onboard.group.v1')
  } catch {}
})

for (const [label, width, height] of [
  ['desktop', 1440, 900],
  ['mobile', 390, 844],
]) {
  await firstRun.setViewport({ width, height, deviceScaleFactor: 1 })
  await firstRun.goto(URL, { waitUntil: 'networkidle2' })
  await sleep(1000)

  const m = await firstRun.evaluate(() => {
    const doc = document.documentElement
    const tiles = [...document.querySelectorAll('main button')]
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      tiles: tiles.length,
      chrome: !!document.querySelector('header'),
      clipped: tiles.filter((b) => b.scrollHeight - b.clientHeight > 2 || b.scrollWidth - b.clientWidth > 2).length,
      labelled: [...document.querySelectorAll('main button')].filter((b) =>
        b.textContent?.includes('In production'),
      ).length,
    }
  })

  ok(m.tiles === 4, `${label}: four show tiles (got ${m.tiles})`)
  ok(!m.chrome, `${label}: no app chrome over the picker`)
  ok(m.overflow <= 0, `${label}: no horizontal page overflow (${m.overflow}px)`)
  ok(m.clipped === 0, `${label}: no tile clips its own content`)
  ok(m.labelled === 3, `${label}: the three unplayable shows are labelled (got ${m.labelled})`)
  await firstRun.screenshot({ path: path.join(SHOTS, `pickshow-${label}.png`) })
}
await firstRun.close()

console.log('\n=== console + network ===')
ok(problems.length === 0, problems.length ? `clean (found: ${problems.slice(0, 5).join(' | ')})` : 'no errors or failed requests')

await browser.close()
shutdown()

console.log(`\nscreenshots: ${path.relative(ROOT, SHOTS)}/`)
console.log(fails === 0 ? '✅ VISUAL CHECKS PASSED' : `❌ ${fails} VISUAL CHECK(S) FAILED`)
process.exit(fails === 0 ? 0 : 1)
