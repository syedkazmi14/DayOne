import { firstDay } from '../src/content/episodes/firstDay'
import { knowledgeBase, knowledgeById, concepts } from '../src/content/knowledge'
import { characters } from '../src/content/characters'
import { askCharacter } from '../src/ai/characterAgent'
import { retrieve } from '../src/ai/retrieval'
import { generateCoachAnalysis } from '../src/ai/coach'
import { applyDecision, baselineMastery, weakestConcept, episodeScore } from '../src/engine/adaptive'
import { estimateSuccess, wagerOptions } from '../src/engine/risk'
import type { ConceptId, DecisionRecord, Scene } from '../src/types'

let fails = 0
const ok = (cond: boolean, msg: string) => {
  if (!cond) { fails++; console.log('  FAIL  ' + msg) }
}
const section = (s: string) => console.log('\n=== ' + s + ' ===')

/* ---------------------------------------------------------------- graph */
section('EPISODE GRAPH INTEGRITY')
const scenes = firstDay.scenes
const ids = Object.keys(scenes)
console.log(`scenes: ${ids.length}`)

for (const s of Object.values(scenes)) {
  ok(s.id in scenes, `scene key mismatch: ${s.id}`)
  if (s.next) ok(!!scenes[s.next], `${s.id}.next -> missing ${s.next}`)
  for (const v of s.variants ?? []) ok(!!scenes[v.sceneId], `${s.id} variant -> missing ${v.sceneId}`)
  if (s.kind === 'decision') {
    ok((s.choices?.length ?? 0) === 3, `${s.id} should have 3 choices, has ${s.choices?.length}`)
    ok(s.choices!.filter(c => c.quality === 'best').length === 1, `${s.id} needs exactly one best choice`)
    ok(new Set(s.choices!.map(c => c.quality)).size === 3, `${s.id} choices should span all three qualities`)
    for (const c of s.choices!) {
      ok(!!scenes[c.consequenceSceneId], `${s.id}/${c.id} -> missing ${c.consequenceSceneId}`)
      ok(c.knowledgeConcepts.length > 0, `${s.id}/${c.id} has no concepts`)
      ok(!!c.ledgerLabel, `${s.id}/${c.id} has no ledger label`)
      ok(!/\b(correct|incorrect|right answer|wrong answer)\b/i.test(c.text), `${s.id}/${c.id} leaks correctness in wording`)
    }
  }
  if (s.kind === 'consequence') {
    ok(!!s.outcome, `${s.id} consequence without outcome`)
    ok((s.outcome?.citations.length ?? 0) > 0, `${s.id} outcome has no citations`)
    for (const c of s.outcome!.citations) ok(!!knowledgeById(c), `${s.id} cites unknown knowledge ${c}`)
    ok(!!s.next, `${s.id} has no next`)
    ok((s.chatWith?.length ?? 0) > 0, `${s.id} has no chat partners`)
    ok(!/\b(correct|incorrect)\b/i.test(s.outcome!.lesson), `${s.id} lesson says correct/incorrect`)
    ok(s.outcome!.lesson.length > 180, `${s.id} lesson too thin (${s.outcome!.lesson.length} chars)`)
  }
  for (const d of s.dialogue) ok(!!characters[d.characterId], `${s.id} unknown speaker ${d.characterId}`)
}

/* reachability: walk every branch */
const visited = new Set<string>()
const endings = new Set<string>()
const walk = (id: string, depth = 0) => {
  if (depth > 40) throw new Error('cycle at ' + id)
  if (visited.has(id)) return
  visited.add(id)
  const s: Scene = scenes[id]
  if (!s) return
  if (s.variants) { s.variants.forEach(v => walk(v.sceneId, depth + 1)); return }
  if (s.choices) { s.choices.forEach(c => walk(c.consequenceSceneId, depth + 1)); return }
  if (s.next) walk(s.next, depth + 1)
  else endings.add(id)
}
walk(firstDay.entrySceneId)
ok(visited.size === ids.length, `unreachable scenes: ${ids.filter(i => !visited.has(i)).join(', ') || 'none'}`)
ok(endings.size === 1 && endings.has('s_end'), `terminal scenes: ${[...endings].join(', ')}`)
console.log(`reachable: ${visited.size}/${ids.length} · terminal: ${[...endings].join(', ')}`)

/* every adaptive variant must be selectable */
const gate = Object.values(scenes).find(s => s.variants)!
for (const v of gate.variants!) {
  const m = baselineMastery()
  for (const c of Object.keys(m) as ConceptId[]) m[c] = { ...m[c], score: c === v.conceptFocus ? 0.05 : 0.9 }
  ok(weakestConcept(m, gate.variants!.map(x => x.conceptFocus)) === v.conceptFocus, `variant ${v.sceneId} unreachable`)
}
console.log(`adaptive variants selectable: ${gate.variants!.length}/3`)

/* ------------------------------------------------------------ knowledge */
section('KNOWLEDGE BASE')
ok(new Set(knowledgeBase.map(k => k.id)).size === knowledgeBase.length, 'duplicate knowledge ids')
for (const k of knowledgeBase) {
  ok(!!k.source.doc && !!k.source.section, `${k.id} not citable`)
  ok(k.concepts.every(c => concepts.some(x => x.id === c)), `${k.id} unknown concept`)
  ok(k.recommended.length > 0 && k.prohibited.length > 0, `${k.id} missing do/do-not`)
}
const covered = new Set(knowledgeBase.flatMap(k => k.concepts))
ok(covered.size === concepts.length, `concepts with no knowledge: ${concepts.filter(c => !covered.has(c.id)).map(c => c.id)}`)
console.log(`${knowledgeBase.length} rules · ${concepts.length} concepts · all citable`)

/* ------------------------------------------------------------ retrieval */
section('RETRIEVAL GROUNDING')
const probes: [string, string | null][] = [
  ['Why was that email suspicious?', 'K-PHI'],
  ['But the sender looked like my manager. Why would it be phishing?', null],
  ['Can I share my login with a teammate who is blocked?', 'K-PWD-01'],
  ['They asked me to read out the six digit code on the phone', 'K-PWD-02'],
  ['Is it ok to paste customer data into an external AI tool?', 'K-DAT-01'],
  ['How do I get a new tool approved?', 'K-TOL-01'],
  ['Nothing happened. Why report it at all?', 'K-INC'],
  ['what is the weather in tokyo today', null],
  ['how do I file my expenses for the christmas party', null],
]
for (const [q, expect] of probes) {
  const r = retrieve(q, { activeConcepts: [] })
  const top = r.hits[0]?.item.id ?? '—'
  const grounded = r.confidence >= 0.3
  console.log(`  ${grounded ? 'OK ' : 'REFUSE'} conf=${r.confidence.toFixed(2)} top=${top.padEnd(9)} "${q.slice(0, 52)}"`)
  if (expect) ok(top.startsWith(expect) && grounded, `expected ${expect} for "${q}"`)
}
// off-topic must refuse
for (const q of ['what is the weather in tokyo today', 'how do I file my expenses for the christmas party']) {
  ok(retrieve(q).confidence < 0.3, `should refuse: "${q}"`)
}

/* ------------------------------------------------------- character voice */
section('CHARACTER REPLIES (offline grounded composer)')
const ctx = {
  sceneTitle: 'THE SUSPICIOUS EMAIL',
  situation: 'The player reported a phishing email.',
  activeConcepts: ['phishing', 'incident_reporting'] as ConceptId[],
  lastChoiceText: 'Report it with the Report Phish button',
  lastChoiceQuality: 'best' as const,
}
const qs = [
  ['vera', 'Why was the email suspicious?'],
  ['vera', 'But the sender looked like my manager. Why would it be phishing?'],
  ['dex', 'Can I just share my login once?'],
  ['milo', 'What should I do if I already clicked it?'],
  ['noor', 'Is it ok to paste customer data into an external AI tool?'],
  ['vera', 'What do you think about the new espresso machine on floor two?'],
  ['milo', 'hey'],
  ['vera', 'What should I have done?'],
]
for (const [id, q] of qs) {
  const r = await askCharacter({ characterId: id, question: q, ctx, history: [] })
  const words = r.text.split(/\s+/).length
  console.log(`\n  Q(${id}) ${q}`)
  console.log(`  A [${r.grounded ? r.citations.join(',') : 'DECLINED'}] ${words}w conf=${r.confidence.toFixed(2)}`)
  console.log(`     ${r.text}`)
  ok(r.text.length > 20, `empty reply for "${q}"`)
  ok(words < 110, `reply too long (${words}w) for "${q}"`)
  ok(!/\bundefined\b|NaN|\[object/.test(r.text), `malformed reply: ${r.text}`)
  ok(!/\.\s*\./.test(r.text), `double punctuation: ${r.text}`)
}
const offTopic = await askCharacter({ characterId: 'vera', question: 'What do you think about the new espresso machine on floor two?', ctx, history: [] })
ok(offTopic.grounded === false && offTopic.citations.length === 0, 'off-topic question should be declined, not answered')

/* determinism */
const a1 = await askCharacter({ characterId: 'vera', question: 'Why report it at all?', ctx, history: [] })
const a2 = await askCharacter({ characterId: 'vera', question: 'Why report it at all?', ctx, history: [] })
ok(a1.text === a2.text, 'offline composer should be deterministic')

/* ------------------------------------------------------------- mechanics */
section('ADAPTIVE + RISK')
let mastery = baselineMastery()
const d1 = scenes.d1_email
const est0 = estimateSuccess(d1, mastery)
console.log(`estimate for d1_email: ${Math.round(est0.p * 100)}% from ${est0.drivers.map(d => d.concept + ':' + Math.round(d.score * 100)).join(' ')}`)
ok(est0.p > 0.15 && est0.p < 0.95, 'estimate should stay off the rails')
const opts = wagerOptions(1240, est0.p)
console.log('wagers: ' + opts.map(o => `${o.tier} -${o.stake}/+${o.reward}`).join('  '))
ok(opts.every(o => o.reward > o.stake), 'every tier should pay more than it stakes')
ok(opts[2].stake === 1240, 'all-in should stake the balance')
ok(opts[0].stake < opts[1].stake && opts[1].stake <= opts[2].stake, 'stake ladder must ascend')

const before = { ...mastery }
mastery = applyDecision(mastery, d1.choices!.find(c => c.quality === 'best')!)
ok(mastery.phishing.score > before.phishing.score, 'best choice should raise mastery')
let m2 = applyDecision(baselineMastery(), d1.choices!.find(c => c.quality === 'poor')!)
ok(m2.phishing.score < before.phishing.score, 'poor choice should lower mastery')
console.log(`phishing: ${Math.round(before.phishing.score*100)} -> best ${Math.round(mastery.phishing.score*100)} / poor ${Math.round(m2.phishing.score*100)}`)

ok(episodeScore([]) === 0, 'empty run scores 0')
const perfect: DecisionRecord[] = ['d1_email','d2_tool','d3_creds','d4_report'].map(id => {
  const c = scenes[id].choices!.find(x => x.quality === 'best')!
  return { sceneId: id, sceneTitle: id, choiceId: c.id, choiceLabel: c.text, ledgerLabel: c.ledgerLabel, quality: c.quality, concepts: c.knowledgeConcepts, scoreImpact: c.scoreImpact, msToDecide: 12000 }
})
const worst = perfect.map(d => {
  const c = scenes[d.sceneId].choices!.find(x => x.quality === 'poor')!
  return { ...d, quality: c.quality, scoreImpact: c.scoreImpact, msToDecide: 2500 }
})
console.log(`score: perfect=${episodeScore(perfect)} worst=${episodeScore(worst)}`)
ok(episodeScore(perfect) > 90 && episodeScore(worst) < 15, 'score range should span')

/* ----------------------------------------------------------------- coach */
section('AI COACH')
for (const [name, run] of [['perfect', perfect], ['worst', worst]] as const) {
  let after = baselineMastery()
  for (const d of run) after = applyDecision(after, scenes[d.sceneId].choices!.find(c => c.quality === d.quality)!)
  const c = await generateCoachAnalysis({ decisions: run, before: baselineMastery(), after, questionsAsked: name === 'perfect' ? 4 : 0, score: episodeScore(run) })
  console.log(`\n  [${name}] ${c.headline}  (source: ${c.source}, focus: ${c.nextFocus.join(',')})`)
  c.paragraphs.forEach(p => console.log('   · ' + p.slice(0, 150) + (p.length > 150 ? '…' : '')))
  ok(c.paragraphs.length >= 3, `${name}: coach should produce 3+ paragraphs`)
  ok(!c.paragraphs.some(p => /undefined|NaN/.test(p)), `${name}: malformed coach text`)
  ok(c.nextFocus.length > 0, `${name}: no next focus`)
}

// mixed-quality run should surface the threat-shape asymmetry
const mixed: DecisionRecord[] = [
  { ...perfect[0], msToDecide: 20000 },
  { ...worst[1], msToDecide: 3000 },
  { ...worst[2], msToDecide: 2800 },
  { ...perfect[3], msToDecide: 18000 },
]
const mc = await generateCoachAnalysis({ decisions: mixed, before: baselineMastery(), after: baselineMastery(), questionsAsked: 3, score: episodeScore(mixed) })
console.log(`\n  [mixed] ${mc.headline}`)
mc.paragraphs.forEach(p => console.log('   · ' + p.slice(0, 160) + (p.length > 160 ? '…' : '')))
ok(mc.paragraphs.some(p => /faster|speed|quickest/i.test(p)), 'mixed run should detect the speed signal')

console.log('\n' + (fails === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${fails} CHECK(S) FAILED`))
process.exit(fails === 0 ? 0 : 1)
