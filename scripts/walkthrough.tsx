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
g.localStorage = dom.window.localStorage
/* The app opens on the sign-in gate. The bulk of this suite is about what
 * happens AFTER sign-in, so seed a session rather than re-driving the gate
 * before every assertion; the gate itself is exercised at the end. */
dom.window.localStorage.setItem(
  'onboard.session.v1',
  JSON.stringify({ role: 'employee', provider: 'Company SSO', signedInAt: Date.now() }),
)
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

/**
 * Visible text first, then `aria-label`. Not every affordance is a word — the
 * header profile control is an avatar whose only text is the player's initials
 * — and the suite should drive what a user (or a screen reader) can actually
 * reach, not just what happens to render as a label.
 */
function findByText(needle: string, tag = 'button'): HTMLElement | null {
  const n = needle.toLowerCase()
  const els = [...document.querySelectorAll<HTMLElement>(tag)]
  return (
    els.find((e) => (e.textContent ?? '').toLowerCase().trim().includes(n)) ??
    els.find((e) => (e.getAttribute('aria-label') ?? '').toLowerCase().includes(n)) ??
    null
  )
}
/* The profile screen sits behind the header avatar's account menu, so reaching
 * it is two clicks: open the menu, then pick the item. */
async function openProfile() {
  if (!(await click('account menu'))) return false
  return click('profile')
}

async function click(needle: string, tag = 'button', label = needle) {
  const el = findByText(needle, tag)
  if (!el) { fails++; console.log(`  ✗ could not find ${tag} "${label}"`); return false }
  await act(async () => { el.click(); await sleep(80) })
  return true
}
/** Poll the rendered app until a condition holds, for async pipelines. */
async function waitFor(pred: () => boolean, ms = 20000) {
  const t0 = Date.now()
  while (!pred() && Date.now() - t0 < ms) await act(async () => { await sleep(120) })
  return pred()
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

console.log('\n=== 0. ONBOARDING: PICK A SHOW ===')
const buttonsWith = (s: string) =>
  [...document.querySelectorAll<HTMLElement>('button')].filter((b) => b.textContent?.includes(s))

ok(has('Pick your show'), 'a signed-in player with no chosen show gets the picker')
ok(!document.querySelector('header'), 'no app chrome over the picker — nothing to navigate past the question')
const showTiles = ['Rick and Morty', 'South Park', 'Family Guy', 'The Simpsons'].filter(
  (n) => buttonsWith(n).length > 0,
)
ok(showTiles.length === 4, `all four shows offered (got ${showTiles.length})`)
ok(
  [...document.querySelectorAll('button')].filter((b) => b.textContent?.includes('In production')).length === 3,
  'the three shows with no playable episode say so',
)

await act(async () => { buttonsWith('Rick and Morty')[0].click(); await sleep(150) })
await flush(150)
ok(!has('Pick your show'), 'choosing a show leaves the picker')
ok(localStorage.getItem('onboard.group.v1') === 'rick-and-morty', 'the choice is persisted as the default')

/* Signing in again must ask again: there is no auth, so each press of the
 * sign-in button is a new person sitting down, and the stored show is only
 * their default. Regression guard for landingAfterSignIn. */
await click('account menu')
await click('sign out')
await flush(120)
ok(localStorage.getItem('onboard.group.v1') === 'rick-and-morty', 'signing out keeps the chosen show')
await click('Company SSO')
await flush(150)
ok(has('Pick your show'), 'signing in again asks for the show again, even with one stored')
await act(async () => { buttonsWith('Rick and Morty')[0].click(); await sleep(150) })
await flush(150)

console.log('\n=== 1. HOME / EPISODE SELECT ===')
ok(has('DayOne'), 'wordmark renders')
ok(has('FIRST'), 'featured episode title')
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

ok(!switcher!.querySelector('button[aria-label="Next roster"]'), 'the roster arrows are gone from the hero')

console.log('\n=== 1c. SWITCHING SHOW FROM THE ACCOUNT MENU ===')
const clickEl = async (el: HTMLElement, ms = 120) => {
  await act(async () => { el.click(); await sleep(ms) })
  await flush(ms)
}
const openAccountMenu = () =>
  clickEl(document.querySelector<HTMLElement>('button[aria-label*="account menu"]')!, 80)
const menuItem = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.includes(label))
const showRows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
/** Account menu -> Change show -> the named show. */
const pickShow = async (name: string) => {
  await openAccountMenu()
  await clickEl(menuItem('Change show')!, 80)
  await clickEl(showRows().find((b) => b.textContent?.includes(name))!, 150)
}

await openAccountMenu()
ok(!!menuItem('Change show'), 'the account menu offers Change show')
ok(showRows().length === 0, 'the shows stay behind it — the menu is not four rows of shows')

await clickEl(menuItem('Change show')!, 80)
ok(showRows().length === 4, `opening it lists all four shows (got ${showRows().length})`)
ok(showRows().filter((b) => b.getAttribute('aria-checked') === 'true').length === 1, 'the current show is marked, exactly once')
ok(
  showRows().filter((b) => b.textContent?.includes('In production')).length === 3,
  'the flyout labels the shows with nothing playable',
)

await clickEl(showRows().find((b) => b.textContent?.includes('South Park'))!, 150)
ok(!document.querySelector('[role="menu"]'), 'the menu closes on choosing, even though the view did not change')
ok(has('South Park'), 'menu switched to South Park')
ok(has('THE GROUP CHAT'), 'episode shelf followed the show')
ok(!has('THE CLIENT'), 'the previous show’s episodes left the shelf')
ok(has('CARTMAN') || has('ERIC'), 'cast strip shows the new cast')
ok(localStorage.getItem('onboard.group.v1') === 'south-park', 'the new show is persisted too')

await pickShow('The Simpsons')
ok(has('The Simpsons') && has('SECTOR 7-G'), 'every show is one click away — no cycling')

await pickShow('Rick and Morty')
ok(has('Rick and Morty') && has('THE CLIENT'), 'back on Rick and Morty')

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
ok(has('procedural previs · not AI-generated'), 'visual tier labelled — no video key, so procedural previs, never passed off as AI video')
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
ok(has('1.2×') && has('2×') && has('4×'), 'three fixed bets: SAFE 1.2× · RISKY 2× · ALL IN 4×')
ok(has('no real money'), 'virtual-currency disclaimer present')
ok(!has('estimate'), 'the mastery estimate stays hidden until the world reacts')
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
ok(has('RISKY 2×') && has('mastery model had you at'), 'bet settles on the authored outcome, then reveals the mastery estimate')
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
ok(has('REFUSED ·'), 'inspector classifies the off-topic reply as refused')
ok(has('under the 30% floor'), 'the refusal is explained against the confidence floor')
ok(has('rules used') && has('none — no policy asserted'), 'a refusal used no rules')
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
await click('no bet')
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
ok(has('behaviour under pressure'), 'run telemetry panel')
ok(has('external threats') && has('coworker requests'), 'accuracy split by threat source')
ok(has('bet like') || has('no bets placed'), 'wager calibration read')
const scoreEl = [...document.querySelectorAll('div')].map((d) => d.textContent ?? '').find((t) => /^\d{1,3}$/.test(t.trim()))
console.log('    score shown: ' + (scoreEl ?? '?').trim())

console.log('\n=== 11. PROFILE + STUDIO ===')
await click('employee profile')
await flush(300)
ok(has('knowledge areas'), 'profile screen')
ok(has('xp to level'), 'level progression shown')
ok(has('up next'), 'stats are wired to future scenarios')
ok(has('recent decisions'), 'decision history recorded')
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

console.log('\n=== 11b. STUDIO: KNOWLEDGE → EPISODE → ASSETS → PUBLISH → PLAY ===')
await click('run knowledge agent')
ok(await waitFor(() => has('14 knowledge items') && has('run knowledge agent')), 'knowledge agent extracted 14 citable rules')
await click('Workplace safety')
await click('generate episode')
ok(await waitFor(() => has('will not invent policy'), 8000), 'a topic the material does not cover is refused, not improvised')
await click('Phishing')
await click('generate episode')
ok(await waitFor(() => has('validated · playable'), 10000), 'generated graph validated and playable')
ok(has('script · deterministic composer'), 'offline script source labelled honestly')
ok(has('MADE FOR YOU') && has('adaptive'), 'graph review shows the adaptive act')
ok(has('mastery targets'), 'mastery targets shown')
await click('generate visual assets')
ok(await waitFor(() => has('re-render visual assets'), 8000), 'visual asset pass completed')
ok(has('procedural previs') && !has('ai generated · stored'), 'no video key: every clip is procedural previs, none claims to be AI')
await click('generate voice')
ok(await waitFor(() => has('runtime voice'), 8000), 'voice pass reports runtime synthesis without an ElevenLabs key')
await click('generate cinematic video')
ok(await waitFor(() => has('re-render cinematic video'), 8000), 'cinematic video pass completed')
ok(
  [...document.querySelectorAll('[data-asset-row^="video:"]')].length === 4 &&
    [...document.querySelectorAll('[data-asset-row^="video:"]')].every((r) => (r.textContent ?? '').includes('procedural previs')),
  'no video key: all four clips are procedural previs, none claims to be AI video',
)
const lensScenes = [...document.querySelectorAll('[data-lens-scene]')].map((e) => e.getAttribute('data-lens-scene'))
ok(lensScenes.length === 2 && lensScenes[0] !== lensScenes[1], `player A and B get different act threes (${lensScenes.join(' / ')})`)
await click('publish episode')
await flush(150)
ok(has('shelf · every employee'), 'episode published')
await click('play it')
await flush(250)
ok(has('generated episode') && has('validated graph'), 'intro shows generated provenance')
await click('start episode')
await flush(250)
await runDialogue()
await flush(150)
if (has('MAKE YOUR CALL')) { await click('no bet'); await flush(150) }
const genChoice = document.querySelector<HTMLElement>('button.choice')
ok(!!genChoice, 'generated decision rendered')
if (genChoice) await act(async () => { genChoice.click(); await sleep(200) })
await flush(250)
await runDialogue()
await flush(150)
ok(has('what actually happened') && has('K-'), 'generated consequence teaches with citations')
const exitBtn = document.querySelector<HTMLElement>('button[aria-label="Exit episode"]')
if (exitBtn) await act(async () => { exitBtn.click(); await sleep(200) })
await flush(300)
ok(has("generated from your company's material"), 'the published episode sits on the home shelf')

console.log('\n=== 12. SECOND RUN: THE FAILURE BRANCHES ===')
await openProfile()                // reset lives on the profile screen
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
if (has('MAKE YOUR CALL')) { await click('no bet'); await flush(150) }
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
if (has('MAKE YOUR CALL')) { await click('no bet'); await flush(150) }
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

console.log('\n=== 13. THE LOOP: NEXT EPISODE FROM THE WEAKNESS ===')
await click('generate my next episode')
ok(await waitFor(() => has('generated episode'), 8000), 'results generated a new episode from the weakest area and opened it')
ok(has('personalised before you start'), 'the new episode is adaptive too')

console.log('\n=== 14. SHOP ===')
const card = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('article')].find((a) => a.querySelector('h3')?.textContent === name) ?? null
const cardText = (name: string) => card(name)?.textContent ?? ''
const cardButton = (name: string, label: string) =>
  [...(card(name)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent?.trim() === label) ?? null
async function press(el: HTMLElement | null, label: string) {
  if (!el) { fails++; console.log(`  ✗ could not find "${label}"`); return }
  await act(async () => { el.click(); await sleep(80) })
  await flush(120)
}
const dialogButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === label) ?? null
const saved = () => JSON.parse(localStorage.getItem('onboard.player.v1') ?? '{}')

await click('episodes')
await flush(300)
await openProfile()
await flush(300)
await click('shop')
await flush(300)
ok(has('Spend your credits on profile cosmetics and collectibles.'), 'shop screen')
ok(has('Featured') && has('New this week'), 'featured and new sections')
ok(!/\b(rare|legendary|epic|left in stock)\b/i.test(body()), 'no rarity or scarcity copy')

// the bad run above still finished an episode, which earns a badge
await click('badges')
await flush(200)
ok(cardText('First Week').includes('Earned'), 'finishing an episode earned First Week')
ok(cardText('Perfect Episode').includes('Not for sale'), 'unearned badges are not purchasable')
ok(!cardButton('Perfect Episode', 'Buy'), 'no buy button on earned badges')
await press(cardButton('First Week', 'Equip'), 'equip First Week')
ok(cardText('First Week').includes('Equipped'), 'earned badge equipped')
await openProfile()
await flush(300)
ok(has('First Week') && has('Customize profile'), 'profile shows the badge and the customize link')

await click('reset progression')
await flush(300)
await click('shop')
await flush(300)
ok(has('1,240 credits'), 'balance shown by the heading')

await press(cardButton('Portal Frame', 'Buy'), 'buy Portal Frame')
ok(has('Buy Portal Frame?') && has('You will have 790 credits remaining.'), 'confirmation names price and remainder')
await press(dialogButton('Buy'), 'confirm buy')
await flush(200)
ok(!document.querySelector('[role="dialog"]'), 'dialog closed after purchase')
ok(has('Purchased Portal Frame'), 'subtle purchase confirmation')
ok(has('790 credits'), 'credits deducted')
ok(cardText('Portal Frame').includes('Owned') && !cardButton('Portal Frame', 'Buy'), 'owned, cannot be bought twice')
await press(cardButton('Portal Frame', 'Equip'), 'equip Portal Frame')
ok(cardText('Portal Frame').includes('Equipped') && !!cardButton('Portal Frame', 'Unequip'), 'border equipped')

await press(cardButton('Mr. Poopybutthole', 'Buy'), 'buy Mr. Poopybutthole')
await press(dialogButton('Buy'), 'confirm buy')
await press(cardButton('Mr. Poopybutthole', 'Showcase'), 'showcase Mr. Poopybutthole')
ok(cardText('Mr. Poopybutthole').includes('Showcased'), 'character showcased')

await click('titles')
await flush(200)
await press(cardButton('First Day Survivor', 'Buy'), 'buy First Day Survivor')
await press(dialogButton('Buy'), 'confirm buy')
await press(cardButton('First Day Survivor', 'Equip'), 'equip title')
ok(has('40 credits'), 'three purchases deducted (1240 − 450 − 600 − 150)')
ok(cardButton('Risk Taker', 'Buy')?.disabled === true && cardText('Risk Taker').includes('160 short'), 'unaffordable item is disabled and says why')

await click('owned')
await flush(150)
ok(!!card('First Day Survivor') && !card('Risk Taker'), 'owned filter')
await click('not owned')
await flush(150)
ok(!card('First Day Survivor') && !!card('Risk Taker'), 'not-owned filter')

const s = saved()
ok(s.credits === 40, 'credits persisted')
ok(['portal-frame', 'mr-poopybutthole', 'first-day-survivor'].every((id) => s.cosmetics?.ownedItems?.includes(id)), 'purchases persisted')
ok(s.cosmetics?.equippedBorder === 'portal-frame' && s.cosmetics?.equippedTitle === 'first-day-survivor' && s.cosmetics?.showcaseCharacter === 'mr-poopybutthole', 'equipped state persisted')

await openProfile()
await flush(300)
ok(has('First Day Survivor'), 'profile shows equipped title')
ok(has('Showcase') && has('Mr. Poopybutthole') && !has('Placeholder art'), 'profile shows showcase with real character art')
ok(!!document.querySelector('svg circle[stroke="#97CE4C"]'), 'profile avatar wears the border')

console.log('\n=== 15. COSMETICS RULES ===')
const cos = await import('../src/engine/cosmetics')
const base = { ...s, credits: 1000, cosmetics: cos.freshCosmetics() }
const bought = cos.purchase(base, 'risk-taker')
ok(bought.credits === 800 && bought.cosmetics.ownedItems.includes('risk-taker'), 'purchase deducts and grants')
ok(cos.purchase(bought, 'risk-taker') === bought, 'same item cannot be bought twice')
ok(cos.purchase({ ...base, credits: 100 }, 'risk-taker').credits === 100, 'cannot buy without enough credits')
ok(cos.purchase(base, 'first-week') === base, 'earned badges are not for sale')
ok(cos.equip(base, 'risk-taker') === base, 'cannot equip what you do not own')
const twoTitles = { ...base, cosmetics: { ...base.cosmetics, ownedItems: ['risk-taker', 'policy-breaker'] } }
const swapped = cos.equip(cos.equip(twoTitles, 'risk-taker'), 'policy-breaker')
ok(swapped.cosmetics.equippedTitle === 'policy-breaker', 'equipping a title replaces the previous one')
const badges = { ...base, cosmetics: { ...base.cosmetics, ownedItems: ['portal-badge', 'plumbus-badge', 'chicken-badge', 'cheesy-poofs'] } }
const worn = badges.cosmetics.ownedItems.reduce((pl: typeof base, id: string) => cos.equip(pl, id), badges)
ok(worn.cosmetics.equippedBadges.length === cos.MAX_EQUIPPED_BADGES, 'badge slots are capped')
ok(cos.unequip(worn, 'portal-badge').cosmetics.equippedBadges.length === 2, 'unequip frees a badge slot')

console.log('\n' + (fails === 0 ? '✅ WALKTHROUGH PASSED' : `❌ ${fails} STEP(S) FAILED`))
process.exit(fails === 0 ? 0 : 1)
