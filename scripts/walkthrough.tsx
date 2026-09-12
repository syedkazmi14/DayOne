/* Headless happy-path walkthrough: renders the real App in jsdom and clicks
 * through the whole episode the way a player would. */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:5173/',
  pretendToBeVisual: true,
})
const g = globalThis as Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
Object.defineProperty(g, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
g.HTMLElement = dom.window.HTMLElement
g.SVGElement = dom.window.SVGElement
g.Element = dom.window.Element
g.Node = dom.window.Node
g.Event = dom.window.Event
g.MouseEvent = dom.window.MouseEvent
g.KeyboardEvent = dom.window.KeyboardEvent
g.getComputedStyle = dom.window.getComputedStyle
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number
g.cancelAnimationFrame = (id: number) => clearTimeout(id)
g.IS_REACT_ACT_ENVIRONMENT = true
dom.window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
// Speech: resolve instantly so subtitle pacing does not stall the harness.
g.speechSynthesis = { speak: (u: { onend?: () => void }) => u.onend?.(), cancel() {}, getVoices: () => [] }
g.SpeechSynthesisUtterance = class { onend?: () => void; onerror?: () => void; constructor(public text: string) {} }
dom.window.speechSynthesis = g.speechSynthesis as never
;(dom.window as unknown as Record<string, unknown>).SpeechSynthesisUtterance = g.SpeechSynthesisUtterance

// Animations off: AnimatePresence exit transitions never settle under jsdom,
// which would stall every view change.
const { MotionGlobalConfig } = await import('framer-motion')
MotionGlobalConfig.skipAnimations = true

const React = await import('react')
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const App = (await import('../src/App')).default

let fails = 0
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.log('  ✗ ' + m) } else console.log('  ✓ ' + m) }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const flush = async (ms = 60) => { await act(async () => { await sleep(ms) }) }

const body = () => document.body.textContent ?? ''
const has = (s: string) => body().toLowerCase().includes(s.toLowerCase())

function findByText(needle: string, tag = 'button'): HTMLElement | null {
  const n = needle.toLowerCase()
  const els = [...document.querySelectorAll<HTMLElement>(tag)]
  return els.find((e) => (e.textContent ?? '').toLowerCase().trim().includes(n)) ?? null
}
async function click(needle: string, tag = 'button', label = needle) {
  const el = findByText(needle, tag)
  if (!el) { fails++; console.log(`  ✗ could not find ${tag} "${label}"`); return false }
  await act(async () => { el.click(); await sleep(80) })
  return true
}
/** Click the dialogue overlay until the scene leaves the dialogue phase. */
async function runDialogue(limit = 14) {
  for (let i = 0; i < limit; i++) {
    const overlay = document.querySelector<HTMLElement>('.absolute.inset-0.z-20.flex.cursor-pointer')
    if (!overlay) return
    await act(async () => { overlay.click(); await sleep(40) })
    await act(async () => { overlay.click(); await sleep(40) })
  }
}

const root = createRoot(document.getElementById('root')!)
await act(async () => { root.render(React.createElement(App)) })
await flush(200)

console.log('\n=== 1. HOME / EPISODE SELECT ===')
ok(has('ONBOARD'), 'wordmark renders')
ok(has('FIRST'), 'featured episode title')
ok(has('your training. your choices.'), 'tagline')
ok(has('THE CLIENT') && has('THE DEADLINE'), 'locked episodes on the shelf')
ok(has('Rick and Morty'), 'selected roster named in the hero')
ok(has('RICK') && has('MORTY') && has('SUMMER') && has('JERRY'), 'cast switcher shows the four portraits')
ok(document.querySelectorAll('img[src^="/characters/"]').length === 4, 'exactly the selected roster is rendered — no big card section')
ok(document.querySelectorAll('img[src^="/episodes/"]').length > 0, 'episode artwork rendered as images')

console.log('\n=== 1b. CAST SWITCHER ===')
const switcher = document.querySelector<HTMLElement>('[role="group"][aria-label="Character roster"]')
ok(!!switcher, 'cast switcher present in the hero')
ok(!document.querySelector('[aria-roledescription="carousel"]'), 'the big roster card section is gone')
const portraits = () => [
  ...(switcher?.querySelectorAll<HTMLElement>('[aria-label="Characters"] button[aria-pressed]') ?? []),
]
ok(portraits().length === 4, `four character buttons (got ${portraits().length})`)

// arrows switch roster, and the episode shelf underneath follows
const nextRoster = switcher!.querySelector<HTMLElement>('button[aria-label="Next roster"]')
const prevRoster = switcher!.querySelector<HTMLElement>('button[aria-label="Previous roster"]')
ok(!!nextRoster && !!prevRoster, 'switcher has both arrows')

await act(async () => { nextRoster!.click(); await sleep(150) })
await flush(150)
ok(has('South Park'), 'next arrow switched to South Park')
ok(has('THE GROUP CHAT'), 'episode shelf followed the roster')
ok(!has('THE CLIENT'), 'the previous roster’s episodes left the shelf')
ok(has('CARTMAN') || has('ERIC'), 'switcher shows the new cast')

// keyboard on the switcher
await act(async () => {
  switcher!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await sleep(150)
})
await flush(150)
ok(has('Family Guy') && has('THE CONFIDENT ANSWER'), 'ArrowRight advanced to Family Guy')

// wraps around, so two arrows reach every roster
await act(async () => { nextRoster!.click(); await sleep(120) })
await flush(120)
ok(has('The Simpsons') && has('SECTOR 7-G'), 'reached The Simpsons')
await act(async () => { nextRoster!.click(); await sleep(120) })
await flush(120)
ok(has('Rick and Morty') && has('THE CLIENT'), 'wraps back round to Rick and Morty')

// selecting a character marks it
const first = portraits()[0]
await act(async () => { first.click(); await sleep(300) })
await flush(200)
ok(first.getAttribute('aria-pressed') === 'true', 'selected character is marked pressed')

console.log('\n=== 2. EPISODE INTRO ===')
await click('start episode')
await flush(150)
ok(has('FIRST DAY'), 'episode title')
ok(has('first day is about to get complicated'), 'subtitle')
ok(has('cast'), 'cast block')
ok(has('personalised before you start'), 'pre-episode adaptation notice')
ok(has('RICK SANCHEZ') && has('MORTY SMITH') && has('SUMMER SMITH'), 'cast listed')

console.log('\n=== 3. CINEMATIC SCENES ===')
await click('start episode')
await flush(200)
ok(has('EPISODE 01'), 'HUD shows episode code')
ok(has('THE INBOX'), 'act progress rail')
ok(has('HELIX DYNAMICS'), 'opening title card')
ok(has('Day one. Badge works') || has('Day one'), 'first subtitle line rendered')
let sawSpeaker = false
for (let i = 0; i < 14; i++) {
  const overlay = document.querySelector<HTMLElement>('.absolute.inset-0.z-20.flex.cursor-pointer')
  if (!overlay) break
  if (has('MORTY SMITH') || has('RICK SANCHEZ')) sawSpeaker = true
  await act(async () => { overlay.click(); await sleep(40) })
  await act(async () => { overlay.click(); await sleep(40) })
}
await flush(120)
ok(sawSpeaker, 'character speaker labels appeared during the scene')

console.log('\n=== 4. RISK TERMINAL ===')
ok(has('MAKE YOUR CALL'), 'wager terminal opened before the decision')
ok(has('estimate'), 'model estimate shown')
ok(has('no real money'), 'virtual-currency disclaimer present')
ok(has('model inputs'), 'estimate is explained by mastery inputs')
await click('RISKY')
await flush(150)

console.log('\n=== 5. DECISION ===')
ok(has('WHAT DO YOU DO?'), 'decision prompt')
ok(has('no feedback until the world reacts'), 'no-correctness framing')
ok(has('Report it with the Report Phish button'), 'choice B present')
ok(!has('correct') && !has('incorrect'), 'no correctness language on the decision screen')
await click('Report it with the Report Phish button')
await flush(250)

console.log('\n=== 6. CONSEQUENCE ===')
await runDialogue()
await flush(150)
ok(has('THREAT CONTAINED'), 'consequence banner for the strong choice')
ok(has('what actually happened'), 'lesson revealed after the world reacted')
ok(has('K-PHI-01'), 'citation chips')
ok(has('BEAT THE HOUSE') || has('HOUSE'), 'wager settled')
ok(has('talk to Summer'), 'character chat offered')

console.log('\n=== 7. CHARACTER CHAT (text) ===')
await click('talk to Summer')
await flush(200)
ok(has('SUMMER SMITH'), 'chat header')
ok(has('GROUNDED LOCAL') || has('LIVE'), 'llm mode surfaced honestly')
ok(has('rag ·'), 'retrieval status')
const suggestion = findByText('Why was that email suspicious', 'button')
ok(!!suggestion, 'suggested question chip present')
if (suggestion) { await act(async () => { suggestion.click(); await sleep(1400) }) }
await flush(300)
ok(has('credential-harvesting') || has('Report Phish'), 'grounded reply rendered')
ok(has('K-PHI'), 'reply carries citations')

// free-text question, including one the knowledge base cannot answer
const input = document.querySelector<HTMLInputElement>('input')
ok(!!input, 'chat input present')
if (input) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
  const typeInto = async (v: string) => {
    setter.call(input, v)
    await act(async () => { input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); await sleep(30) })
    await act(async () => { input.closest('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await sleep(1400) })
    await flush(200)
  }
  await typeInto('But the sender looked like my manager. Why would it be phishing?')
  ok(has('spoofed') || has('display names'), 'objection answered from the knowledge base')
  await typeInto('What do you think about the new espresso machine on floor two?')
  ok(has('not going to improvise') || has('do not have that in our policy set'), 'declines what the knowledge base does not cover')
  ok(has('declined'), 'refusal is labelled in the UI')
}
// inspector proves grounding
await click('inspect')
await flush(120)
ok(has('retrieved context'), 'retrieval inspector opens')
ok(has('system prompt sent to the model'), 'prompt is inspectable')
await click('voice')
await flush(120)
ok(has('mic → stt → rag → llm → tts'), 'voice pipeline shown')
ok(has('hold the floor'), 'mic control present')
const closeBtn = document.querySelector<HTMLElement>('aside button[aria-label="Close"]')
ok(!!closeBtn, 'chat close button')
if (closeBtn) await act(async () => { closeBtn.click(); await sleep(120) })
await flush(150)

console.log('\n=== 8. ACT 2 -> ACT 3 (adaptive) ===')
await click('continue')
await flush(250)
await runDialogue()
await flush(150)
ok(has('MAKE YOUR CALL'), 'act 2 wager')
await click('decide without staking')
await flush(150)
ok(has('THE EXPORT') || has('WHAT DO YOU DO?'), 'act 2 decision')
await click('Helix Assist')
await flush(250)
await runDialogue()
await flush(150)
ok(has('SAME SPEED') || has('what actually happened'), 'act 2 consequence')
await click('continue')
await flush(400)
ok(has('BUILDING ACT THREE'), 'adaptive interstitial shown')
ok(has('adaptive learning agent'), 'agent attributed')
await act(async () => { await sleep(3300) })
await flush(300)
const VARIANTS: [string, string][] = [
  ['RICK’S DESK', 'THE FAVOUR / credential sharing'],
  ['DESK PHONE', 'THE CALL / voice phishing'],
  ['THE WEEKEND', 'THE WEEKEND / bulk export'],
]
const which = (): string => VARIANTS.filter(([probe]) => has(probe)).map(([, n]) => n).join(',')
const run1Variant = which()
ok(run1Variant !== '', 'an adaptive act-3 variant loaded')
console.log('    variant: ' + (run1Variant || 'NONE'))

await runDialogue()
await flush(150)
if (has('MAKE YOUR CALL')) { await click('ALL IN'); await flush(150) }
const anyChoice = document.querySelector<HTMLElement>('button.choice')
ok(!!anyChoice, 'act 3 decision rendered')
if (anyChoice) await act(async () => { anyChoice.click(); await sleep(200) })
await flush(250)
await runDialogue()
await flush(150)
ok(has('what actually happened'), 'act 3 consequence')

console.log('\n=== 9. ACT 4 -> ENDING ===')
await click('continue')
await flush(250)
await runDialogue()
await flush(150)
if (has('MAKE YOUR CALL')) { await click('SAFE'); await flush(150) }
ok(has('FOUR DAYS LATE') || has('WHAT DO YOU DO?'), 'act 4 decision')
const a4 = findByText('Walk him to the Security Portal', 'button')
ok(!!a4, 'act 4 choice B present')
if (a4) await act(async () => { a4.click(); await sleep(200) })
await flush(250)
await runDialogue()
await flush(150)
ok(has('CONTAINED ON DAY FOUR'), 'act 4 consequence')
await click('continue')
await flush(300)
await runDialogue()
await flush(200)
ok(has('DAY ONE COMPLETE'), 'ending scene')

console.log('\n=== 10. RESULTS + AI COACH ===')
await click('see your results')
await flush(400)
ok(has('episode complete'), 'results screen')
ok(has('final score'), 'score block')
ok(has('your decisions'), 'decision ledger')
ok(has('Identified and reported phishing attempt'), 'ledger entry from act 1')
ok(has('ai coach analysis'), 'coach section')
await act(async () => { await sleep(900) })
await flush(300)
ok(has('what changes next'), 'next-episode plan rendered')
ok(has('what the system learned about you'), 'mastery movement')
const scoreEl = [...document.querySelectorAll('div')].map((d) => d.textContent ?? '').find((t) => /^\d{1,3}$/.test(t.trim()))
console.log('    score shown: ' + (scoreEl ?? '?').trim())

console.log('\n=== 11. PROFILE + STUDIO ===')
await click('employee profile')
await flush(300)
ok(has('your employee profile'), 'profile screen')
ok(has('overall knowledge'), 'overall knowledge')
ok(has('next scenario target'), 'stats are wired to future scenarios')
ok(has('decision history'), 'decision history recorded')
ok(has('questions you asked'), 'chat transcript recorded')
await click('episodes')
await flush(200)
await click('studio')
await flush(300)
ok(has('BORING MATERIAL'), 'studio screen')
ok(has('Helix Security Handbook'), 'source documents listed')
ok(has('KNOWLEDGE AGENT') && has('SCENARIO GENERATOR'), 'pipeline diagram')
ok(has('run knowledge agent'), 'pipeline can be run')
ok(has('video generation'), 'video authoring boundary documented')

console.log('\n=== 12. SECOND RUN: THE FAILURE BRANCHES ===')
await click('profile')                // reset lives on the profile screen
await flush(250)
await click('reset progression')
await flush(300)
await click('start episode')          // home hero
await flush(200)
await click('start episode')          // intro
await flush(250)
await runDialogue()
await flush(150)
if (has('MAKE YOUR CALL')) { await click('ALL IN'); await flush(150) }
await click('Click the link')
await flush(250)
await runDialogue()
await flush(150)
ok(has('SECURITY INCIDENT'), 'act 1 bad branch: incident banner')
ok(has('HOUSE CALLED IT'), 'losing wager settles against the player')
ok(has('what actually happened'), 'lesson still explains the mechanism')
ok(!has('INCORRECT'), 'never labels the choice incorrect')

await click('continue')
await flush(250)
await runDialogue()
await flush(150)
if (has('MAKE YOUR CALL')) { await click('decide without staking'); await flush(150) }
await click('Paste the export into the external AI tool')
await flush(250)
await runDialogue()
await flush(150)
ok(has('REPORTABLE DATA BREACH'), 'act 2 bad branch: breach consequence')

await click('continue')
await flush(400)
await act(async () => { await sleep(3300) })
await flush(300)
const run2Variant = which()
ok(run2Variant !== '', 'act 3 adapted again after two failures')
console.log('    variant: ' + (run2Variant || 'NONE') + '   (first run: ' + run1Variant + ')')
ok(run2Variant !== run1Variant, 'a different weakness produced a different act 3')
await runDialogue()
await flush(150)
if (has('MAKE YOUR CALL')) { await click('SAFE'); await flush(150) }
const worstChoice = document.querySelector<HTMLElement>('button.choice')
if (worstChoice) await act(async () => { worstChoice.click(); await sleep(200) })
await flush(250)
await runDialogue()
await flush(150)
await click('continue')
await flush(250)
await runDialogue()
await flush(150)
if (has('MAKE YOUR CALL')) { await click('decide without staking'); await flush(150) }
await click('Tell him to let it go')
await flush(250)
await runDialogue()
await flush(150)
ok(has('DAY 11: INVOICE FRAUD'), 'act 4 bad branch: delayed-report consequence')
await click('continue')
await flush(300)
await runDialogue()
await flush(200)
await click('see your results')
await flush(1400)
ok(has('episode complete'), 'results after a bad run')
ok(has('Suppressed a security incident') || has('Clicked an unverified link'), 'ledger records the failures')
const badCoach = body().includes('Today was expensive') || body().includes('expensive') || body().includes('costly')
ok(badCoach, 'coach reads the bad run differently')
const m = body().match(/final score(\d{1,3})/i)
console.log('    score shown: ' + (m ? m[1] : '?'))
ok(!!m && Number(m[1]) < 35, 'bad run scores low')

console.log('\n' + (fails === 0 ? '✅ WALKTHROUGH PASSED' : `❌ ${fails} STEP(S) FAILED`))
process.exit(fails === 0 ? 0 : 1)
