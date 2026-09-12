import { existsSync } from 'node:fs'
import { firstDay } from '../src/content/episodes/firstDay'
import { episodes, episodesForGroup, featuredEpisode } from '../src/content/episodes'
import { characterGroups, groupCast } from '../src/content/characterGroups'
import { resolveVoiceProfile, voiceProfiles } from '../src/voice/voiceProfiles'
import { knowledgeBase, knowledgeById, concepts } from '../src/content/knowledge'
import { characters } from '../src/content/characters'
import { askCharacter } from '../src/ai/characterAgent'
import { retrieve } from '../src/ai/retrieval'
import { generateCoachAnalysis } from '../src/ai/coach'
import { applyDecision, baselineMastery, weakestConcept, episodeScore } from '../src/engine/adaptive'
import { estimateSuccess, wagerOptions } from '../src/engine/risk'
import {
  partitionValidItems,
  sanitizeText,
  validateKnowledgeItem,
  validateKnowledgeSet,
} from '../src/content/validateKnowledge'
import { MAX_FILE_BYTES, ParseError, parseText, slugifyName } from '../src/ingest/parse'
import { contentStore, ReadOnlyStoreError } from '../src/data/contentStore'
import type { ConceptId, DecisionRecord, KnowledgeItem, Scene } from '../src/types'

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

/* --------------------------------------------------------- roster + assets */
section('ROSTER, VOICES AND ARTWORK')

const rosterIds = characterGroups.flatMap(g => g.characterIds)
ok(new Set(rosterIds).size === rosterIds.length, 'a character appears in two groups')
ok(characterGroups.length >= 4, `expected at least 4 groups, got ${characterGroups.length}`)

for (const g of characterGroups) {
  ok(g.characterIds.length === 4, `${g.id} should field 4 characters, has ${g.characterIds.length}`)
  ok(groupCast(g).length === g.characterIds.length, `${g.id} references a character that does not exist`)
  for (const id of g.characterIds) ok(characters[id]?.groupId === g.id, `${id} is listed in ${g.id} but says it belongs to ${characters[id]?.groupId}`)
}

/* Every character resolves to a real voice, and no voice id is a secret. */
for (const ch of Object.values(characters)) {
  ok(ch.voiceProfileId in voiceProfiles, `${ch.id} points at missing voice profile "${ch.voiceProfileId}"`)
  const vp = resolveVoiceProfile(ch.voiceProfileId)
  ok(!!vp.voiceId, `${ch.id} voice profile has no cast voice id`)
  if (ch.id !== 'you') {
    // Cast voices are community voices (Creator tier and up), so every roster
    // character needs a premade stand-in or it goes silent on a Free key. The
    // narrator profile is exempt: its cast voice is already premade.
    ok(!!vp.fallbackVoiceId, `${ch.id} has no premade fallback — it would break on a Free key`)
    ok(vp.voiceId !== vp.fallbackVoiceId, `${ch.id} cast voice and fallback are the same id`)
    ok(ch.greetings.length > 0, `${ch.id} has no greeting (used for the voice preview)`)
    ok(!!ch.refusal, `${ch.id} has no refusal line`)
    ok(!!ch.avatar?.src, `${ch.id} has no avatar`)
    ok(existsSync('public' + ch.avatar!.src), `${ch.id} avatar missing on disk: public${ch.avatar!.src}`)
  }
}
for (const vp of Object.values(voiceProfiles)) {
  ok(!/^sk_/.test(vp.voiceId), `voice profile ${vp.id} looks like it holds an API key`)
}
console.log(`${Object.keys(characters).length - 1} characters · ${characterGroups.length} groups · ${Object.keys(voiceProfiles).length} voice profiles`)

/* Episodes are grouped, imaged and cast from their own group. */
ok(new Set(episodes.map(e => e.id)).size === episodes.length, 'duplicate episode ids')
for (const ep of episodes) {
  ok(characterGroups.some(g => g.id === ep.groupId), `${ep.id} has unknown groupId ${ep.groupId}`)
  ok(!!ep.image?.src, `${ep.id} has no episode image`)
  ok(existsSync('public' + ep.image!.src), `${ep.id} image missing on disk: public${ep.image!.src}`)
  for (const id of ep.cast) {
    ok(!!characters[id], `${ep.id} casts unknown character ${id}`)
    ok(characters[id]?.groupId === ep.groupId, `${ep.id} casts ${id} from another group`)
  }
  ok(ep.locked || !!ep.scenes[ep.entrySceneId], `${ep.id} is unlocked but has no entry scene`)
}
for (const g of characterGroups) {
  const shelf = episodesForGroup(g.id)
  ok(shelf.length > 0, `${g.id} has no episodes on its shelf`)
  ok(!!featuredEpisode(g.id), `${g.id} has nothing to feature in the hero`)
}
console.log(`${episodes.length} episodes across ${characterGroups.length} groups · every title has an image`)

/* ------------------------------------------------------------ knowledge */
section('KNOWLEDGE BASE')
/* The rules live in src/content/validateKnowledge.ts so the ingest path and
 * this suite enforce one definition. Each structured error becomes one FAIL. */
const kb = validateKnowledgeSet(knowledgeBase, { requireFullCoverage: true })
for (const e of kb.errors) ok(false, `${e.itemId} · ${e.field}: ${e.message}`)
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
  ['summer', 'Why was the email suspicious?'],
  ['summer', 'But the sender looked like my manager. Why would it be phishing?'],
  ['rick', 'Can I just share my login once?'],
  ['morty', 'What should I do if I already clicked it?'],
  ['jerry', 'Is it ok to paste customer data into an external AI tool?'],
  ['summer', 'What do you think about the new espresso machine on floor two?'],
  ['morty', 'hey'],
  ['summer', 'What should I have done?'],
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
const offTopic = await askCharacter({ characterId: 'summer', question: 'What do you think about the new espresso machine on floor two?', ctx, history: [] })
ok(offTopic.grounded === false && offTopic.citations.length === 0, 'off-topic question should be declined, not answered')

/* determinism */
const a1 = await askCharacter({ characterId: 'summer', question: 'Why report it at all?', ctx, history: [] })
const a2 = await askCharacter({ characterId: 'summer', question: 'Why report it at all?', ctx, history: [] })
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

/* ------------------------------------------------ ingest: validation rules */
section('INGEST · KNOWLEDGE VALIDATION')

const validItem: KnowledgeItem = {
  id: 'K-TST-01',
  topic: 'Test rule',
  rule: 'Report anything that looks wrong through the Security Portal.',
  severity: 'high',
  commonMistake: 'Assuming somebody else already reported it.',
  consequence: 'Nobody reports it and containment starts a day late.',
  edgeCases: ['Uncertainty is not a reason to wait.'],
  recommended: ['Report it'],
  prohibited: ['Staying quiet'],
  concepts: ['incident_reporting'],
  source: { doc: 'Test Handbook', section: '1.1 Reporting', page: 1 },
}
const bad = (patch: Partial<KnowledgeItem>): KnowledgeItem => ({ ...validItem, ...patch })
const badFields = (item: KnowledgeItem) => validateKnowledgeItem(item).map(e => e.field)

ok(validateKnowledgeItem(validItem).length === 0, 'a well-formed item should pass clean')
ok(badFields(bad({ rule: '' })).includes('rule'), 'empty rule should fail')
ok(badFields(bad({ topic: '   ' })).includes('topic'), 'whitespace-only topic should fail')
ok(badFields(bad({ severity: 'urgent' as KnowledgeItem['severity'] })).includes('severity'), 'unknown severity should fail')
ok(badFields(bad({ concepts: ['time_travel' as ConceptId] })).includes('concepts'), 'unknown concept should fail')
ok(badFields(bad({ concepts: [] })).includes('concepts'), 'empty concepts should fail')
ok(badFields(bad({ recommended: [] })).includes('recommended'), 'empty recommended should fail')
ok(badFields(bad({ prohibited: [] })).includes('prohibited'), 'empty prohibited should fail')
ok(badFields(bad({ source: { doc: '', section: '1.1' } })).includes('source.doc'), 'uncitable doc should fail')
ok(badFields(bad({ source: { doc: 'D', section: '' } })).includes('source.section'), 'uncitable section should fail')
ok(badFields(bad({ rule: 'x'.repeat(1300) })).includes('rule'), 'oversized rule should fail')
ok(validateKnowledgeItem(bad({ id: '' }), 'item[7]').some(e => e.itemId === 'item[7]'), 'an id-less item should be labelled by ref')

const dupes = validateKnowledgeSet([validItem, { ...validItem, topic: 'Restated' }])
ok(dupes.duplicateIds.includes('K-TST-01'), 'duplicate ids should be reported')
ok(dupes.errors.some(e => e.field === 'id'), 'duplicate id should raise an error')

const partial = validateKnowledgeSet([validItem])
ok(partial.uncoveredConcepts.length === concepts.length - 1, 'a partial batch should report uncovered concepts')
ok(!partial.errors.length, 'a partial batch is not an error without requireFullCoverage')
ok(validateKnowledgeSet([validItem], { requireFullCoverage: true }).errors.some(e => e.itemId === '<set>'), 'full-coverage mode should flag the gap')

const NUL = String.fromCharCode(0)
const ZWSP = String.fromCharCode(0x200b)
const dirty = `Report${NUL} it${ZWSP}  through\nthe portal.`
ok(sanitizeText(dirty) === 'Report it through the portal.', `sanitizer should strip invisibles and collapse space, got "${sanitizeText(dirty)}"`)

const split = partitionValidItems([validItem, bad({ id: 'K-TST-02', severity: 'urgent' as KnowledgeItem['severity'] })])
ok(split.valid.length === 1 && split.rejected.length === 1, 'partition should split valid from rejected')
ok(split.rejected[0].errors.some(e => e.field === 'severity'), 'a rejected item should carry its own errors')
console.log(`${kb.errors.length} errors on the shipped base · ${split.valid.length} valid / ${split.rejected.length} rejected on a mixed batch`)

/* ------------------------------------------------------- ingest: parsing */
section('INGEST · DOCUMENT PARSING')

const throws = (fn: () => unknown, code: string, msg: string) => {
  try {
    fn()
    ok(false, `${msg} - nothing was thrown`)
  } catch (e) {
    ok(e instanceof ParseError && e.code === code, `${msg} - got ${(e as Error).message}`)
  }
}

const txt = parseText('Report suspicious email.\n\n\n\nDo not forward it.', { name: 'Security Notes.txt' })
ok(txt.type === 'handbook', 'txt should map to handbook')
ok(txt.id === 'security-notes', `slug should derive from the filename, got ${txt.id}`)
ok(txt.excerpt === 'Report suspicious email.\n\nDo not forward it.', 'paragraphs survive, blank runs collapse')
ok(txt.pages >= 1, 'prose should report at least one page')
ok(txt.yields.length === 0, 'a freshly parsed doc yields no knowledge yet')
ok(slugifyName('Helix Security Handbook v4.2.pdf') === 'helix-security-handbook-v4-2', 'slugify should flatten punctuation')

const md = parseText('# Heading\n\nUse **Report Phish**, see [the portal](https://helix.internal).\n\n- Never forward it\n', { name: 'policy.md' })
ok(!md.excerpt.includes('#') && !md.excerpt.includes('**'), 'markdown markers should be stripped')
ok(md.excerpt.includes('Heading') && md.excerpt.includes('Report Phish'), 'markdown text content should survive')
ok(md.excerpt.includes('the portal') && !md.excerpt.includes('https://'), 'link text kept, url dropped')
ok(md.excerpt.includes('Never forward it'), 'list item content should survive')
ok(md.excerpt.split('\n\n').length === 3, `markdown paragraph breaks should survive list stripping, got ${JSON.stringify(md.excerpt)}`)

const srt = parseText(
  '1\n00:00:01,000 --> 00:00:04,000\nThe one-hour reporting window.\n\n2\n00:00:04,500 --> 00:00:07,000\nSession tokens survive a password change.\n',
  { name: 'briefing.srt' },
)
ok(srt.type === 'video' && srt.pages === 0, 'transcripts are video with no page count')
ok(!srt.excerpt.includes('-->') && !/\d{2}:\d{2}:\d{2}/.test(srt.excerpt), 'srt timestamps should be gone')
ok(!/^\d+$/m.test(srt.excerpt), 'srt sequence numbers should be gone')
ok(srt.excerpt.includes('one-hour reporting window') && srt.excerpt.includes('Session tokens'), 'srt speech should survive')

const vtt = parseText(
  'WEBVTT\n\nNOTE recorded 2026-09-12\n\n1\n00:00:01.000 --> 00:00:04.000 align:start position:0%\n<v Trainer>There is no blame attached to a report.</v>\n\n2\n00:00:04.000 --> 00:00:06.000\n<i>There is no blame attached to a report.</i>\n\n3\n00:00:06.000 --> 00:00:09.000\nIt is the four days of silence that cost us.\n',
  { name: 'briefing.vtt' },
)
ok(!vtt.excerpt.includes('WEBVTT') && !vtt.excerpt.includes('NOTE'), 'vtt headers and notes should be gone')
ok(!vtt.excerpt.includes('<v') && !vtt.excerpt.includes('<i>'), 'vtt cue tags should be stripped')
ok(!vtt.excerpt.includes('align:start'), 'vtt cue settings should be gone')
ok(vtt.excerpt.includes('no blame attached'), 'vtt speech should survive')
ok(vtt.excerpt.split('no blame attached').length - 1 === 1, 'a repeated rolling-caption line should collapse to one')
ok(vtt.excerpt.includes('four days of silence'), 'later cues should survive the dedupe')

throws(() => parseText('', { name: 'empty.txt' }), 'empty_document', 'an empty file should be rejected')
throws(() => parseText('   \n\n  \t ', { name: 'blank.txt' }), 'empty_document', 'a whitespace-only file should be rejected')
throws(() => parseText('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n', { name: 'silent.vtt' }), 'empty_document', 'a transcript with no speech should be rejected')
throws(() => parseText('x', { name: 'handbook.pdf' }), 'unsupported_type', 'pdf should be rejected until a pdf stage exists')
throws(() => parseText('x', { name: 'noextension' }), 'unsupported_type', 'an extensionless file should be rejected')
throws(() => parseText('x'.repeat(MAX_FILE_BYTES + 1), { name: 'huge.txt' }), 'file_too_large', 'an oversized file should be rejected')
console.log('parsed txt/md/srt/vtt · rejects empty, unsupported and oversized')

/* --------------------------------------------------------- content store */
section('CONTENT STORE')
const store = contentStore()
ok(store.kind === 'static', 'the default store should be the static bundle')
ok((await store.listKnowledge()).length === knowledgeBase.length, 'static store should serve the bundled knowledge')
ok((await store.listSourceDocs()).length > 0, 'static store should serve the bundled source docs')

const handedOut = await store.listKnowledge()
handedOut.push(validItem)
ok((await store.listKnowledge()).length === knowledgeBase.length, 'listKnowledge should hand back a copy, not the live array')

let refusedWrite = false
try {
  await store.saveKnowledge([validItem])
} catch (e) {
  refusedWrite = e instanceof ReadOnlyStoreError
}
ok(refusedWrite, 'the static store should refuse writes rather than silently drop them')
console.log(`store=${store.kind} · ${(await store.listKnowledge()).length} rules · ${(await store.listSourceDocs()).length} docs · read-only`)


console.log('\n' + (fails === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${fails} CHECK(S) FAILED`))
process.exit(fails === 0 ? 0 : 1)
