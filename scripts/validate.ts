import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { firstDay } from '../src/content/episodes/firstDay'
import { validateEpisode } from '../src/engine/validateEpisode'
import { findEpisode, initialState, reducer, type Action, type GameState } from '../src/engine/gameStore'
import { analyseRun, calibration, describeTelemetry } from '../src/engine/telemetry'
import { applyScript, customTopic, generateEpisode, TOPICS, TopicNotCovered } from '../src/ai/episodeGenerator'
import { attachAsset, planEpisodeAssets, presentationOf, visualTierOf } from '../src/media/assetPlan'
import { awaitClip, clipSeconds, clipToAsset, motionPrompt, ProceduralPrevisProvider, requestClip, ServerVideoProvider, videoProvider } from '../src/media/video'
import { imageProvider, ServerImageProvider } from '../src/media/image'
import { RuntimeSpeechProvider, ServerAudioProvider } from '../src/media/audio'
import { episodes } from '../src/content/episodes'
import { recastEpisode } from '../src/engine/recast'
import { lineupFor, recommendNext } from '../src/engine/lineup'
import { characterGroups, groupCast } from '../src/content/characterGroups'
import { resolveVoiceProfile, voiceProfiles } from '../src/voice/voiceProfiles'
import { knowledgeBase, knowledgeById, concepts } from '../src/content/knowledge'
import { characters } from '../src/content/characters'
import { askCharacter, suggestedQuestions } from '../src/ai/characterAgent'
import { CONFIDENCE_FLOOR, corpusFor, retrieve, SPECIFICITY_FLOOR } from '../src/ai/retrieval'
import { generateCoachAnalysis } from '../src/ai/coach'
import { applyDecision, baselineMastery, episodeScore, PLAYER_LENSES, selectVariant } from '../src/engine/adaptive'
import { estimateSuccess, MULTIPLIER, wagerOptions } from '../src/engine/risk'
import {
  partitionValidItems,
  sanitizeKnowledgeItem,
  sanitizeText,
  validateKnowledgeItem,
  validateKnowledgeSet,
} from '../src/content/validateKnowledge'
import { MAX_FILE_BYTES, ParseError, parseText, slugifyName } from '../src/ingest/parse'
import { contentStore, ReadOnlyStoreError } from '../src/data/contentStore'
import type { AssetRef, ConceptId, DecisionRecord, Episode, KnowledgeItem, ThreatProfile, WagerResult } from '../src/types'

let fails = 0
const ok = (cond: boolean, msg: string) => {
  if (!cond) { fails++; console.log('  FAIL  ' + msg) }
}
const section = (s: string) => console.log('\n=== ' + s + ' ===')

/* ---------------------------------------------------------------- graph */
section('EPISODE GRAPH INTEGRITY')
/* The rules live in src/engine/validateEpisode.ts, so the reducer's publish
 * gate, the Studio and this suite enforce one definition. */
const scenes = firstDay.scenes
const ids = Object.keys(scenes)
console.log(`scenes: ${ids.length}`)

const graph = validateEpisode(firstDay)
for (const e of graph.errors) ok(false, `${e.sceneId} · ${e.message}`)
ok(graph.reachable === ids.length, `every scene reachable (${graph.reachable}/${ids.length})`)
ok(graph.terminals.length === 1 && graph.terminals[0] === 's_end', `terminal scenes: ${graph.terminals.join(', ')}`)
console.log(`reachable: ${graph.reachable}/${ids.length} · terminal: ${graph.terminals.join(', ')}`)
for (const d of Object.values(scenes).flatMap(s => s.outcome?.citations ?? [])) ok(!!knowledgeById(d), `cites unknown knowledge ${d}`)

/* every decision carries a threat profile, or the coach's telemetry goes blind */
for (const s of Object.values(scenes)) if (s.kind === 'decision') ok(!!s.threat, `${s.id} has no threat profile`)

/* the validator has to catch what it claims to catch */
const broken = (mutate: (ep: Episode) => void) => {
  const ep = structuredClone(firstDay)
  mutate(ep)
  return validateEpisode(ep).ok
}
ok(!broken(ep => { ep.scenes.d1_email.choices![0].consequenceSceneId = 'nowhere' }), 'a dangling branch fails validation')
ok(!broken(ep => { ep.scenes.c1_report.next = 'd1_email' }), 'a cycle fails validation')
ok(!broken(ep => { ep.scenes.d1_email.choices![0].quality = 'best' }), 'two strong options fail validation')
ok(!broken(ep => { ep.scenes.c1_report.outcome!.citations = ['K-NOPE-99'] }), 'an unresolvable citation fails validation')
ok(!broken(ep => { ep.scenes.d1_email.choices![1].text = 'This is the correct answer.' }), 'correctness wording fails validation')
ok(!broken(ep => { delete (ep.scenes as Record<string, unknown>).s_end }), 'a missing ending fails validation')

/* every adaptive variant must be selectable — through the reducer's own selector */
const gate = Object.values(scenes).find(s => s.variants)!
for (const v of gate.variants!) {
  const m = baselineMastery()
  for (const c of Object.keys(m) as ConceptId[]) m[c] = { ...m[c], score: c === v.conceptFocus ? 0.05 : 0.9 }
  ok(selectVariant(gate, m).sceneId === v.sceneId, `variant ${v.sceneId} unreachable`)
}
console.log(`adaptive variants selectable: ${gate.variants!.length}/3`)
const lensPicks = PLAYER_LENSES.map(l => selectVariant(gate, l.mastery).sceneId)
ok(lensPicks[0] === 's3_call' && lensPicks[1] === 's3_export', `player A gets THE CALL and player B THE WEEKEND (got ${lensPicks.join(' / ')})`)

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
/* One lineup, every show: each show plays the same episodes with its own cast. */
for (const g of characterGroups) {
  const lineup = lineupFor(g.id, {})
  ok(lineup.length === episodes.length && lineup.every(e => !e.episode.locked), `${g.id} plays the full authored lineup`)
  for (const { episode: ep } of lineup) {
    ok(existsSync('public' + ep.image!.src), `${g.id}: ${ep.id} key art missing on disk (${ep.image?.src})`)
    ok(ep.cast.every(id => characters[id]?.groupId === g.id), `${g.id}: ${ep.id} is cast from its own show`)
  }
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
for (const q of [
  'what is the weather in tokyo today',
  'how do I file my expenses for the christmas party',
  // On-topic words, off-topic subject: "password" and "machine" match real rules.
  'What is the password for the espresso machine on floor two?',
  'What is the wifi password for the guest network in the cafeteria?',
]) {
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
const espressoPassword = await askCharacter({ characterId: 'summer', question: 'What is the password for the espresso machine on floor two?', ctx, history: [] })
ok(
  espressoPassword.kind === 'refusal' && espressoPassword.citations.length === 0,
  `a question whose subject is absent from the material is refused even when common words match (conf ${espressoPassword.confidence.toFixed(2)}, specificity ${espressoPassword.retrieved.signals.specificity.toFixed(2)})`,
)

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
const opts = wagerOptions(1240)
console.log('wagers: ' + opts.map(o => `${o.tier} ${o.multiplier}x -${o.stake}/+${o.reward}`).join('  '))
ok(opts.map(o => o.multiplier).join() === '1.2,2,4', 'bets are SAFE 1.2x, RISKY 2x, ALL IN 4x')
ok(opts.every(o => o.reward === Math.round(o.stake * o.multiplier)), 'a win returns stake x multiplier')
ok(wagerOptions(0).every(o => o.stake === 0), 'a zero balance stakes nothing')
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
  return { sceneId: id, sceneTitle: id, choiceId: c.id, choiceLabel: c.text, ledgerLabel: c.ledgerLabel, quality: c.quality, concepts: c.knowledgeConcepts, scoreImpact: c.scoreImpact, msToDecide: 12000, threat: scenes[id].threat }
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

/* Model output is the only untrusted source of knowledge items, and it can omit
 * a field entirely or send the wrong type. Sanitising must survive that and
 * hand the shape to the validator rather than throwing on it. */
const malformed = [
  { ...validItem, id: 'K-TST-10', edgeCases: undefined },
  { ...validItem, id: 'K-TST-11', source: undefined },
  { ...validItem, id: 'K-TST-12', recommended: 'Report it' },
  { ...validItem, id: 'K-TST-13', topic: 42 },
  null,
] as unknown as KnowledgeItem[]

let partitionThrew: string | null = null
let malformedSplit: ReturnType<typeof partitionValidItems> | null = null
try {
  malformedSplit = partitionValidItems(malformed)
} catch (e) {
  partitionThrew = (e as Error).message
}
ok(!partitionThrew, `partition should not throw on malformed model output, got "${partitionThrew}"`)
ok(malformedSplit?.valid.length === 0, 'no malformed item should be accepted')
ok(malformedSplit?.rejected.length === malformed.length, 'every malformed item should be rejected')
ok(
  malformedSplit?.rejected[0].errors.some(e => e.field === 'edgeCases'),
  'a missing array should be reported as a field error, not swallowed',
)
ok(
  malformedSplit?.rejected[1].errors.some(e => e.field === 'source'),
  'a missing source should be reported as uncitable',
)
ok(
  malformedSplit?.rejected[2].errors.some(e => e.field === 'recommended'),
  'a string where an array belongs should be reported',
)
ok(
  malformedSplit?.rejected[3].errors.some(e => e.field === 'topic'),
  'a number should not be coerced into a passing string',
)

/* The sanitiser still has to do its real job on well-formed input. */
const sanitised = sanitizeKnowledgeItem(bad({ rule: `Report${NUL} it${ZWSP}  now.` }))
ok(sanitised.rule === 'Report it now.', `sanitise should clean a valid item, got "${sanitised.rule}"`)
ok(validItem.rule.includes('Security Portal'), 'sanitise must not mutate its input')

console.log(`${kb.errors.length} errors on the shipped base · ${split.valid.length} valid / ${split.rejected.length} rejected on a mixed batch`)

/* ------------------------------------------------------- ingest: parsing */
{
  const { KNOWLEDGE_AGENT_SYSTEM } = await import('../src/ai/knowledgeAgent')
  const { concepts: taxonomy } = await import('../src/content/knowledge')
  ok(taxonomy.every((c) => KNOWLEDGE_AGENT_SYSTEM.includes(`  ${c.id} — `)), 'the extraction prompt lists every concept id the validator accepts')
}

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

/* ------------------------------------------------ engine: deterministic */
section('ONE LINEUP, EVERY SHOW · RECASTING')
const graphShape = (ep: Episode) =>
  JSON.stringify(Object.values(ep.scenes).map(s => [
    s.id, s.kind, s.next, s.variants?.map(v => [v.conceptFocus, v.sceneId]),
    s.choices?.map(c => [c.id, c.quality, c.consequenceSceneId, c.scoreImpact, c.knowledgeConcepts]),
    s.outcome?.citations, s.outcome?.tone, s.threat,
  ]))
const rmNames = /\b(Rick|Morty|Summer|Jerry|RICK|MORTY|SUMMER|JERRY|Sanchez|SANCHEZ)\b/
const episodeTexts = (ep: Episode) =>
  [ep.title, ep.subtitle, ep.synopsis, ...Object.values(ep.scenes).flatMap(s => [
    s.title, s.subtitle, s.prompt, s.chatHook, s.outcome?.banner, s.outcome?.lesson,
    ...s.dialogue.flatMap(d => [d.line, d.direction]),
    ...(s.choices ?? []).flatMap(c => [c.text, c.ledgerLabel]),
  ])].filter((t): t is string => !!t)

ok(recastEpisode(firstDay, 'rick-and-morty') === firstDay, "Rick and Morty keep First Day's hand-written script, untouched")
ok(recastEpisode(firstDay, null) === firstDay, 'no show (an admin) sees the episode as written')
for (const g of characterGroups.filter(g => g.id !== 'rick-and-morty')) {
  const rc = recastEpisode(firstDay, g.id)
  for (const e of validateEpisode(rc).errors) ok(false, `${g.id}: ${e.sceneId} · ${e.message}`)
  ok(graphShape(rc) === graphShape(firstDay), `${g.id}: same scenes, choices, consequences, scoring and adaptive act as the original`)
  ok(
    Object.values(rc.scenes).every(s => s.dialogue.every(d => d.characterId === 'you' || characters[d.characterId]?.groupId === g.id)),
    `${g.id}: every line is spoken by its own cast`,
  )
  const leftover = episodeTexts(rc).filter(t => rmNames.test(t))
  ok(leftover.length === 0, `${g.id}: no Rick and Morty names left${leftover.length ? ` — "${leftover[0].slice(0, 90)}"` : ''}`)
  ok(recastEpisode(firstDay, g.id) === rc, `${g.id}: the recast is memoised`)
}
const hooks = (ep: Episode) => Object.values(ep.scenes).map(s => s.chatHook ?? '').join(' | ')
const spFirstDay = recastEpisode(firstDay, 'south-park')
const fgFirstDay = recastEpisode(firstDay, 'family-guy')
const siFirstDay = recastEpisode(firstDay, 'the-simpsons')
ok(episodeTexts(spFirstDay).some(t => t.includes('CARTMAN’S DESK')), 'South Park: Rick’s desk becomes Cartman’s desk')
ok(hooks(spFirstDay).includes('Kyle is at your desk and he is not angry. Ask him anything.'), 'South Park: the mentor’s pronouns follow Kyle')
ok(hooks(fgFirstDay).includes('Ask Lois what she would have done'), 'Family Guy: the manager’s pronouns follow Lois')
ok(hooks(fgFirstDay).includes('Lois is curious now. Ask her what else her team does this way.'), 'Family Guy: object and possessive pronouns both follow Lois')
ok(hooks(siFirstDay).includes('Lisa is at your desk and she is not angry. Ask her anything.'), 'The Simpsons: Lisa keeps she/her')
ok(Object.values(spFirstDay.scenes).every(s => !s.assets?.audio), 'pre-rendered voice lines are dropped when the speaker changes')
console.log(`  south park: ${hooks(spFirstDay).split(' | ').find(h => h.includes('Kyle'))}`)
console.log(`  family guy: ${hooks(fgFirstDay).split(' | ').find(h => h.includes('Lois'))}`)

section('ENGINE · DETERMINISTIC TRANSITIONS')
const play = (s: GameState, ...actions: Action[]) => actions.reduce(reducer, s)
const toPhase = (s: GameState, phase: GameState['phase'], limit = 60) => {
  for (let i = 0; i < limit && s.phase !== phase; i++) s = reducer(s, { type: 'ADVANCE_DIALOGUE' })
  return s
}

const started = play(initialState(), { type: 'SELECT_EPISODE', episodeId: 'rm-ep01' }, { type: 'START_EPISODE' })
ok(started.view === 'scene' && started.sceneId === 's1_arrival', 'START_EPISODE enters the authored entry scene')
ok(reducer(started, { type: 'STAGE_WAGER', tier: 'allin' }) === started, 'a bet outside a decision scene is ignored')

const atD1 = toPhase(started, 'wager')
ok(atD1.sceneId === 'd1_email' && atD1.phase === 'wager', `dialogue advances deterministically to the first bet (at ${atD1.sceneId}/${atD1.phase})`)
ok(reducer(atD1, { type: 'CHOOSE', choiceId: 'd2_a' }) === atD1, "another scene's choice id is ignored — an action cannot inject a transition")
ok(reducer(atD1, { type: 'CHOOSE', choiceId: 'invented_choice' }) === atD1, 'an invented choice id is ignored')

const credits0 = atD1.player.credits
const risky = wagerOptions(credits0)[1]
const staked = reducer(atD1, { type: 'STAGE_WAGER', tier: 'risky' })
ok(staked.stagedWager?.stake === risky.stake && staked.stagedWager?.multiplier === 2, 'stake and multiplier are derived by the engine, not sent by the UI')
ok(staked.stagedWager?.estimate === estimateSuccess(scenes.d1_email, atD1.player.mastery).p, 'the mastery estimate is recorded silently at bet time')

const verified = reducer(staked, { type: 'CHOOSE', choiceId: 'd1_b' })
ok(verified.sceneId === 'c1_report', `the strong choice transitions to its authored consequence (got ${verified.sceneId})`)
ok(verified.player.credits === credits0 - risky.stake + risky.reward, 'a strong call pays stake x 2')
ok(verified.decisionsThisEpisode[0].threat?.source === 'external', 'the decision record carries the scene threat profile')
ok(verified.lastWager?.estimate === staked.stagedWager?.estimate, 'the estimate is revealed with the settled bet')

const again = reducer(staked, { type: 'CHOOSE', choiceId: 'd1_b' })
ok(
  again.sceneId === verified.sceneId && again.player.credits === verified.player.credits && JSON.stringify(again.player.mastery) === JSON.stringify(verified.player.mastery),
  'the same (state, action) produces the same state',
)
const clicked = play(atD1, { type: 'STAGE_WAGER', tier: 'allin' }, { type: 'CHOOSE', choiceId: 'd1_a' })
ok(clicked.sceneId === 'c1_click' && clicked.player.credits === 0, 'all in on a poor call loses the balance; the branch is still the authored one')

/* ------------------------------------------------ generator: episodes */
section('SCENARIO GENERATOR · KNOWLEDGE -> VALIDATED GRAPH')
const genFor = (topicId: string, mastery = baselineMastery(), groupId = 'rick-and-morty') =>
  generateEpisode({ topic: TOPICS.find(t => t.id === topicId)!, groupId, mastery })

for (const t of TOPICS.filter(t => t.concepts.length)) {
  const r = await genFor(t.id)
  for (const e of r.report.errors) ok(false, `${t.id}: ${e.sceneId} · ${e.message}`)
  ok(r.report.ok && r.source === 'local', `${t.id}: the generated graph validates offline`)
  const ep = r.episode
  const decisions = Object.values(ep.scenes).filter(s => s.kind === 'decision')
  ok(decisions.every(s => s.threat && s.knowledgeRefs?.length), `${t.id}: every decision carries a threat profile and knowledge refs`)
  ok(Object.values(ep.scenes).every(s => s.shot.prompt.length > 40), `${t.id}: every scene has a shot spec`)
  ok(presentationOf(ep.scenes[ep.entrySceneId]) === 'clip', `${t.id}: the cold open is specified as a clip`)
  ok(ep.knowledge!.length >= 2 && ep.provenance!.knowledgeIds.every(id => knowledgeById(id)), `${t.id}: grounded in extracted company rules`)
  ok(r.report.adaptiveVariants >= 2, `${t.id}: act three has at least two adaptive variants`)
  console.log(`  ${t.id.padEnd(14)} ${ep.title} · ${r.report.total} scenes · ${r.report.decisions} decisions · act 3 -> ${r.plan.targets.join(', ')}`)
}
const phishing = await genFor('phishing')
ok(phishing.episode.scenes.g_d1.threat!.source !== phishing.episode.scenes.g_d2.threat!.source, 'acts one and two test both threat sources')

for (const topic of [TOPICS.find(t => t.id === 'workplace-safety')!, customTopic('the espresso machine on floor two')]) {
  let refused: unknown = null
  try {
    await generateEpisode({ topic, groupId: 'rick-and-morty', mastery: baselineMastery() })
  } catch (e) {
    refused = e
  }
  ok(refused instanceof TopicNotCovered, `"${topic.label}" is not in the material — generation refuses rather than improvising`)
}
const custom = await generateEpisode({ topic: customTopic('sharing passwords and MFA codes'), groupId: 'south-park', mastery: baselineMastery() })
ok(custom.report.ok, 'a custom topic the material does cover generates a valid graph')

const phishingAgain = await genFor('phishing')
const noClock = (ep: Episode) => JSON.stringify({ ...ep, provenance: { ...ep.provenance, createdAt: '' } })
ok(noClock(phishing.episode) === noClock(phishingAgain.episode), 'the offline generator is deterministic for the same input')

const phishingGate = Object.values(phishing.episode.scenes).find(s => s.variants?.length)!
const [lensA, lensB] = PLAYER_LENSES.map(l => selectVariant(phishingGate, l.mastery))
ok(lensA.sceneId !== lensB.sceneId, `player A and player B get different act threes (${lensA.focus} vs ${lensB.focus})`)
const forA = await genFor('phishing', PLAYER_LENSES[0].mastery)
const forB = await genFor('phishing', PLAYER_LENSES[1].mastery)
ok(forA.plan.targets[0] !== forB.plan.targets[0], `targets are ordered by each player's weakness (${forA.plan.targets[0]} vs ${forB.plan.targets[0]})`)

/* A model writes words, never structure. */
const speakers: Record<string, string> = { player: 'you' }
for (const [role, ch] of Object.entries(phishing.roles)) speakers[role] = ch.id
const g1 = phishing.episode.scenes.g_d1
const hostile = applyScript(
  phishing.episode,
  {
    scenes: {
      g_d1: { choices: { [g1.choices![0].id]: 'Rewritten wording for this option.' }, next: 'g_end', consequenceSceneId: 'g_end', quality: 'best' },
      g_invented: { title: 'A SCENE THE ENGINE NEVER AUTHORED' },
      g_open: { dialogue: [{ speaker: 'the ceo', line: 'I am not in the cast.' }] },
      g_d1_good: { lesson: 'x'.repeat(5000) },
    },
  },
  speakers,
)
ok(!hostile.scenes.g_invented, 'a script cannot add scenes')
ok(hostile.scenes.g_d1.choices!.map(c => `${c.quality}>${c.consequenceSceneId}`).join() === g1.choices!.map(c => `${c.quality}>${c.consequenceSceneId}`).join(), 'a script cannot rewire a branch or change which option is strong')
ok(hostile.scenes.g_d1.choices![0].text === 'Rewritten wording for this option.', 'a script can rewrite the words')
ok(JSON.stringify(hostile.scenes.g_open.dialogue) === JSON.stringify(phishing.episode.scenes.g_open.dialogue), 'lines from speakers outside the cast are rejected')
ok(hostile.scenes.g_d1_good.outcome!.lesson === phishing.episode.scenes.g_d1_good.outcome!.lesson, 'an oversized lesson is rejected')
ok(validateEpisode(hostile).ok, 'the merged graph still validates')
const leaky = applyScript(phishing.episode, { scenes: { g_d1: { choices: { [g1.choices![0].id]: 'This is the correct answer.' } } } }, speakers)
ok(!validateEpisode(leaky).ok, 'a script that leaks correctness fails validation, so the generator discards it')

const genInFamilyGuy = recastEpisode(phishing.episode, 'family-guy')
ok(validateEpisode(genInFamilyGuy).ok && graphShape(genInFamilyGuy) === graphShape(phishing.episode), 'an admin-built episode recasts to any show without changing its graph')
ok(!episodeTexts(genInFamilyGuy).some(t => rmNames.test(t)), 'the recast admin-built episode carries no source-cast names')

/* ------------------------------------------------ engine: publishing */
{
  const { parseJsonReply } = await import('../src/ai/llm')
  const { applyScript } = await import('../src/ai/episodeGenerator')
  ok((parseJsonReply('```json\n{"a": "x}"}\n```\nHope this helps!') as { a: string }).a === 'x}', 'a model reply with fences and trailing prose still parses')
  let truncatedIsSyntaxError = false
  try {
    parseJsonReply('[{"a": 1}, {"b":')
  } catch (e) {
    truncatedIsSyntaxError = e instanceof SyntaxError
  }
  ok(truncatedIsSyntaxError, 'a truncated model reply is a SyntaxError, so callers fall back')
  const target = Object.values(phishing.episode.scenes).find((s) => s.kind === 'consequence')!
  const thin = applyScript(phishing.episode, { scenes: { [target.id]: { lesson: 'Too short.', banner: 'New banner' } } }, { player: 'you' })
  ok(
    thin.scenes[target.id].outcome!.lesson === target.outcome!.lesson && thin.scenes[target.id].outcome!.banner === 'NEW BANNER' && validateEpisode(thin).ok,
    'a thin model lesson keeps the drafted lesson instead of breaking the graph',
  )
}

section('ENGINE · PUBLISHING GENERATED EPISODES')
const genEp = phishing.episode
const admin0: GameState = { ...initialState(), session: { role: 'admin', provider: 'test', signedInAt: 0 } }
const employee0: GameState = { ...initialState(), session: { role: 'employee', provider: 'test', signedInAt: 0 } }
const base0 = admin0

ok(reducer(employee0, { type: 'PUBLISH_EPISODE', episode: genEp, status: 'published' }) === employee0, 'employees cannot publish — only admins build episodes')
ok(reducer(employee0, { type: 'GOTO', view: 'authoring' }) === employee0, 'employees cannot open the Studio')
ok(reducer(admin0, { type: 'GOTO', view: 'home' }).view === 'authoring', 'an admin has no show lobby — home is the Studio')

const liveLibrary = reducer(admin0, { type: 'PUBLISH_EPISODE', episode: genEp, status: 'published' }).published
ok(lineupFor('south-park', liveLibrary).some(e => e.episode.id === genEp.id), 'a published topic appears in every show’s lineup')
const southPark = play({ ...employee0, published: liveLibrary, groupId: 'south-park' }, { type: 'SELECT_EPISODE', episodeId: genEp.id }, { type: 'START_EPISODE' })
ok(
  southPark.groupId === 'south-park' && southPark.view === 'scene' && findEpisode(southPark, genEp.id)!.cast.every(id => characters[id].groupId === 'south-park'),
  'an employee plays the admin’s episode with the show they picked',
)
const draftLibrary = reducer(admin0, { type: 'PUBLISH_EPISODE', episode: genEp, status: 'draft' }).published
ok(
  lineupFor('south-park', draftLibrary).every(e => e.episode.id !== genEp.id) &&
    reducer({ ...employee0, published: draftLibrary }, { type: 'SELECT_EPISODE', episodeId: genEp.id }).view !== 'intro',
  'drafts stay invisible and unplayable for employees',
)
ok(reducer({ ...admin0, published: draftLibrary }, { type: 'SELECT_EPISODE', episodeId: genEp.id }).view === 'intro', 'an admin can preview a draft')
const recommended = recommendNext(lineupFor('family-guy', liveLibrary), ['social_engineering', 'incident_reporting'], firstDay.id)
ok(recommended?.entry.episode.id === genEp.id && recommended.covers.length > 0, 'results recommend the published episode that covers the weakness, never the one just played')
const invalid = structuredClone(genEp)
invalid.scenes.g_d1.choices![0].consequenceSceneId = 'nowhere'
ok(reducer(base0, { type: 'PUBLISH_EPISODE', episode: invalid, status: 'published' }) === base0, 'an invalid generated graph is refused at publish')
ok(reducer(base0, { type: 'PUBLISH_EPISODE', episode: { ...structuredClone(firstDay), title: 'SHADOW' }, status: 'published' }) === base0, 'a generated graph cannot shadow an authored episode')

let gp = play(base0, { type: 'PUBLISH_EPISODE', episode: genEp, status: 'published' }, { type: 'SELECT_EPISODE', episodeId: genEp.id }, { type: 'START_EPISODE' })
ok(gp.published[genEp.id]?.provenance?.status === 'published' && gp.sceneId === genEp.entrySceneId, 'a published generated episode plays through the same reducer')
gp = toPhase(gp, 'wager')
ok(gp.sceneId === 'g_d1', `generated dialogue advances to the first decision (at ${gp.sceneId})`)
const strong = genEp.scenes.g_d1.choices!.find(c => c.quality === 'best')!
gp = play(gp, { type: 'SKIP_WAGER' }, { type: 'CHOOSE', choiceId: strong.id })
ok(gp.sceneId === strong.consequenceSceneId, 'a generated choice follows its authored transition')

const actThreeFor = (mastery: GameState['player']['mastery']) =>
  reducer({ ...gp, sceneId: 'g_d2_good', phase: 'outcome', player: { ...gp.player, mastery } }, { type: 'CONTINUE' }).sceneId
const [aScene, bScene] = PLAYER_LENSES.map(l => actThreeFor(l.mastery))
ok(!!aScene && !!bScene && aScene !== bScene && aScene.startsWith('g_v_') && bScene.startsWith('g_v_'), `the reducer routes player A and B to different act threes (${aScene} / ${bScene})`)

/* ------------------------------------------------ telemetry */
section('RUN TELEMETRY + CALIBRATION')
const rec = (quality: DecisionRecord['quality'], threat: ThreatProfile | undefined, ms: number, wager?: WagerResult): DecisionRecord => ({
  sceneId: 'x', sceneTitle: 'x', choiceId: 'x', choiceLabel: 'x', ledgerLabel: 'x', quality, concepts: ['phishing'], scoreImpact: 0, msToDecide: ms, threat, wager,
})
const bet = (tier: WagerResult['tier'], won: boolean): WagerResult => ({ tier, staked: 100, payout: won ? 100 * MULTIPLIER[tier] : 0, multiplier: MULTIPLIER[tier], estimate: 0.5, won })
const trusting = [
  rec('best', { source: 'external', pressure: 'urgency' }, 6000, bet('allin', true)),
  rec('best', { source: 'external', pressure: 'authority' }, 9000),
  rec('poor', { source: 'internal', pressure: 'authority' }, 8200, bet('allin', false)),
  rec('poor', { source: 'internal', pressure: 'peer' }, 5000, bet('risky', false)),
  rec('best', { source: 'internal', pressure: 'peer' }, 6000),
]
const tt = analyseRun(trusting)
ok(tt.bySource.external.rate === 1 && Math.abs(tt.bySource.internal.rate! - 1 / 3) < 1e-9, 'accuracy is split by threat source')
ok(Math.round(tt.authoritySlowdownMs!) === 2933, `authority slowdown is measured (${tt.authoritySlowdownMs})`)
ok(tt.weakness?.id === 'trusts_known_people', `the weakness is trusting known people (got ${tt.weakness?.id})`)
const lead = describeTelemetry(tt)
ok(lead[0] === 'You correctly identified 100% of external threats, but only 33% of requests involving coworkers.', `lead sentence: ${lead[0]}`)
ok(/2\.9 seconds slower when authority pressure was introduced/.test(lead[1] ?? ''), `tempo sentence: ${lead[1]}`)
ok(tt.calibration.verdict === 'overconfident', `big bets on poor calls read as overconfident (${tt.calibration.verdict})`)
ok(calibration([rec('best', undefined, 1, bet('safe', true)), rec('best', undefined, 1, bet('safe', true))]).verdict === 'underconfident', 'safe bets on strong calls read as underconfident')
ok(calibration([rec('best', undefined, 1, bet('risky', true)), rec('acceptable', undefined, 1, bet('risky', false))]).verdict === 'calibrated', 'bets that match performance read as calibrated')
ok(calibration([rec('best', undefined, 1)]).verdict === 'no_data', 'no bets is no data, not a verdict')
const untagged = analyseRun([rec('best', undefined, 1), rec('poor', undefined, 1)])
ok(untagged.weakness === null && describeTelemetry(untagged).length === 0, 'untagged runs claim no pattern')

const tc = await generateCoachAnalysis({ decisions: trusting, before: baselineMastery(), after: baselineMastery(), questionsAsked: 1, score: 50 })
ok(tc.paragraphs[0].startsWith('You correctly identified 100% of external threats'), 'the coach leads with measured telemetry')
ok(tc.paragraphs[0].includes('trusting requests that appear to come from people you already know'), 'the coach names the biggest weakness')
ok(tc.headline === 'You catch attackers. You do not catch colleagues.', `coach headline: ${tc.headline}`)
console.log(`  [telemetry] ${tc.paragraphs[0]}`)

/* ------------------------------------------------ grounding trace */
section('GROUNDING TRACE')
ok(offTopic.grounding.status === 'refused' && !!offTopic.grounding.reason, `off-topic is refused and classified (${offTopic.grounding.reason})`)
console.log(`  espresso -> ${offTopic.grounding.status} · ${offTopic.grounding.reason} · ${offTopic.grounding.explanation}`)
ok(!offTopic.grounding.gatedBeforeModel, 'offline, no reply claims a model was gated')
const onTopic = await askCharacter({ characterId: 'summer', question: 'Why was the email suspicious?', ctx, history: [] })
ok(
  onTopic.grounding.status === 'grounded' && onTopic.grounding.usedIds.length > 0 && onTopic.grounding.usedIds.every(id => onTopic.grounding.retrievedIds.includes(id)),
  'a grounded reply only uses rules retrieval returned',
)
ok((await askCharacter({ characterId: 'morty', question: 'hey', ctx, history: [] })).grounding.status === 'social', 'small talk is classified as social, not grounded')
const narrow = [knowledgeBase.find(k => k.id === 'K-PWD-01')!]
const scoped = await askCharacter({ characterId: 'rick', question: 'Can I share my login with a teammate?', ctx, history: [], corpus: narrow })
ok(scoped.retrieved.hits.every(h => h.item.id === 'K-PWD-01'), "retrieval is confined to the episode's own corpus")

/* ------------------------------------------------ asset pipeline */
section('ASSET PIPELINE · VIDEO PROVIDER SEAM')
const plan = planEpisodeAssets(firstDay)
const clips = plan.filter(i => i.kind === 'video')
const stills = plan.filter(i => i.kind === 'image')
const keyframes = stills.filter(i => i.key.startsWith('image:keyframe'))
const lines = plan.filter(i => i.kind === 'audio')
const visible = Object.values(firstDay.scenes).filter(s => !s.variants?.length).length
ok(clips.length > 0 && clips.length <= 4, `clips are budgeted (${clips.length})`)
ok(clips[0].sceneId === firstDay.entrySceneId, 'the cold open is the first clip')
ok(!plan.some(i => i.sceneIds.includes('s3_gate')), 'adaptive gates get no assets')
ok(stills.reduce((n, i) => n + i.sceneIds.length, 0) === visible, 'every visible scene gets exactly one scene image — a keyframe or a shared background')
ok(keyframes.map(k => k.sceneId).join() === clips.map(c => c.sceneId).join(), 'every clip scene gets its own keyframe for image-to-video')
ok(stills.length - keyframes.length < visible - clips.length, 'backgrounds are shared by look')

const genClips = planEpisodeAssets(phishing.episode).filter(i => i.kind === 'video')
ok(genClips.map(c => c.reason).join() === 'cold open,closing shot,confrontation,incident beat', `a generated episode clips its cold open, confrontation, incident and ending (${genClips.map(c => c.sceneId).join(', ')})`)
ok(genClips.every(c => clipSeconds(phishing.episode.scenes[c.sceneId].shot) >= 5 && clipSeconds(phishing.episode.scenes[c.sceneId].shot) <= 8), 'every clip is 5–8 seconds')
const motion = motionPrompt(phishing.episode.scenes.g_d1.shot)
ok(
  /push-in/.test(motion) && /reaches toward the keyboard/.test(motion) && /concern/.test(motion) && /In the background/.test(motion) && /Maintain the original composition/.test(motion),
  `the motion prompt covers camera, action, expression, environment and continuity: ${motion}`,
)
ok(lines.length === Object.values(firstDay.scenes).flatMap(s => s.dialogue).filter(d => d.characterId !== 'you').length, 'every character line is planned for voice')
console.log(`  first day: ${clips.length} clips · ${stills.length} backgrounds for ${visible - clips.length} scenes · ${lines.length} voiced lines`)

const shot1 = firstDay.scenes.s1_arrival.shot
const ctx1 = { episodeId: 'rm-ep01', sceneId: 's1_arrival' }
const keyframe1: AssetRef = {
  kind: 'image',
  tier: 'generated',
  provider: 'test',
  url: '/api/media/assets/company/episodes/rm-ep01/backgrounds/s1_arrival.jpg',
  storageKey: 'company/episodes/rm-ep01/backgrounds/s1_arrival.jpg',
  createdAt: 'now',
}
const ctxImg = { ...ctx1, image: keyframe1 }
const previs = new ProceduralPrevisProvider()
const pj = await requestClip(shot1, ctx1, previs)
ok(pj.status === 'ready' && pj.tier === 'procedural' && !pj.url, 'procedural previs resolves immediately, with no file')
ok((await previs.getClipUrl(pj.id)) === null, 'procedural previs never returns a clip url')
const withPrevis = attachAsset(firstDay, clips[0], clipToAsset(pj)!)
ok(visualTierOf(withPrevis.scenes.s1_arrival.assets) === 'procedural', 'a procedural asset is reported as procedural, never as AI video')
ok(!firstDay.scenes.s1_arrival.assets, 'attaching an asset never mutates the authored episode')
ok(videoProvider().tier === 'procedural' && imageProvider().tier === 'procedural', 'with no media server the providers claim only the procedural tier')

type Reply = { status: number; body: unknown }
const fakeMedia = (routes: Record<string, Reply[]>) => async (url: string, init?: RequestInit) => {
  const queue = routes[`${init?.method ?? 'GET'} ${url}`]
  const next = queue && (queue.length > 1 ? queue.shift()! : queue[0])
  if (!next) return new Response(JSON.stringify({ message: 'no route' }), { status: 404 })
  return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } })
}
const clipKey = 'company/episodes/rm-ep01/videos/s1_arrival.mp4'
const server = new ServerVideoProvider({
  model: 'fal-ai/ltx-video',
  base: 'http://media.test',
  fetch: fakeMedia({
    'POST http://media.test/video': [{ status: 202, body: { jobId: 'job-1', status: 'queued' } }],
    'GET http://media.test/video/job-1': [
      { status: 200, body: { status: 'rendering' } },
      { status: 200, body: { status: 'ready', url: `/api/media/assets/${clipKey}`, storageKey: clipKey } },
    ],
  }),
})
ok(/generate visual assets first/.test((await requestClip(shot1, ctx1, server)).error ?? ''), 'image-to-video refuses to render without a generated scene image')
const job = await requestClip(shot1, ctxImg, server)
ok(job.status === 'queued' && job.tier === 'generated' && job.prompt === motionPrompt(shot1), "a real provider queues the render with the shot's motion prompt")
let sentToMedia: { imageKey?: string; durationSec?: number } = {}
const spy = new ServerVideoProvider({
  model: 'm',
  base: 'http://media.test',
  fetch: async (_url, init) => {
    sentToMedia = JSON.parse(String(init?.body ?? '{}'))
    return new Response(JSON.stringify({ jobId: 'spy', status: 'queued' }), { status: 202 })
  },
})
await requestClip(shot1, ctxImg, spy)
ok(sentToMedia.imageKey === keyframe1.storageKey && sentToMedia.durationSec === 5, 'the browser sends the stored keyframe key and a 5 s duration — never a token or image bytes')
ok(clipToAsset(job) === null, 'an unfinished render attaches nothing')
const seen: string[] = []
const rendered = await awaitClip(job, server, { sleep: async () => {}, onUpdate: j => seen.push(j.status) })
ok(seen.join() === 'rendering,ready', `polling walks queued -> rendering -> ready (saw ${seen.join()})`)
ok(rendered.url === `/api/media/assets/${clipKey}` && (await server.getClipUrl('job-1')) === rendered.url, 'the stored clip url comes back')
const withClip = attachAsset(firstDay, clips[0], clipToAsset(rendered)!)
ok(visualTierOf(withClip.scenes.s1_arrival.assets) === 'ai-video' && withClip.scenes.s1_arrival.assets!.video!.storageKey === clipKey, 'a generated clip attaches as AI video with its storage key')

const unconfigured = new ServerVideoProvider({ model: 'm', base: 'http://media.test', fetch: fakeMedia({ 'POST http://media.test/video': [{ status: 503, body: { message: 'FAL_KEY is not configured on the media server.' } }] }) })
const refusedJob = await requestClip(shot1, ctxImg, unconfigured)
ok(refusedJob.status === 'failed' && /FAL_KEY/.test(refusedJob.error ?? ''), 'an unconfigured server fails honestly')
const stuck = new ServerVideoProvider({
  model: 'm',
  base: 'http://media.test',
  fetch: fakeMedia({ 'POST http://media.test/video': [{ status: 202, body: { jobId: 'job-2' } }], 'GET http://media.test/video/job-2': [{ status: 200, body: { status: 'rendering' } }] }),
})
const timedOut = await awaitClip(await requestClip(shot1, ctxImg, stuck), stuck, { sleep: async () => {}, intervalMs: 1000, timeoutMs: 3000 })
ok(timedOut.status === 'failed' && /timed out/.test(timedOut.error ?? ''), 'a render that never finishes times out instead of hanging')
const garbled = new ServerVideoProvider({
  model: 'm',
  base: 'http://media.test',
  fetch: fakeMedia({ 'POST http://media.test/video': [{ status: 202, body: { jobId: 'job-3' } }], 'GET http://media.test/video/job-3': [{ status: 200, body: { status: 'done-ish' } }] }),
})
ok((await garbled.getStatus('job-3')).status === 'failed', 'an unknown status is a failure, not a success')
const offline = new ServerVideoProvider({ model: 'm', base: 'http://media.test', fetch: async () => { throw new Error('ECONNREFUSED') } })
ok((await requestClip(shot1, ctxImg, offline)).status === 'failed', 'an unreachable media server fails the job rather than throwing')

const bg = await new ServerImageProvider({
  model: 'fal-ai/flux/schnell',
  base: 'http://media.test',
  fetch: fakeMedia({ 'POST http://media.test/image': [{ status: 200, body: { url: '/api/media/assets/bg.jpg', storageKey: 'company/episodes/e/backgrounds/s.jpg' } }] }),
}).generateBackground({ episodeId: 'e', sceneId: 's', prompt: 'p' })
ok(bg.asset?.tier === 'generated' && bg.asset.kind === 'image' && !!bg.asset.url, 'a generated background comes back as a stored image asset')
const voiced = await new ServerAudioProvider({
  base: 'http://media.test',
  fetch: fakeMedia({ 'POST http://media.test/audio': [{ status: 200, body: { url: '/api/media/assets/a.mp3', storageKey: 'k', voiceId: 'v1' } }] }),
}).renderLine({ episodeId: 'e', sceneId: 's', lineIndex: 0, text: 'hi', character: characters.rick })
ok(voiced.status === 'stored' && voiced.asset?.kind === 'audio', 'a pre-rendered line comes back as a stored audio asset')
ok((await new RuntimeSpeechProvider().renderLine()).status === 'runtime', 'without ElevenLabs nothing claims to be pre-rendered')

/* ------------------------------------------------ media server */
section('MEDIA SERVER · STORAGE + HONEST CONFIG')
const assetRoot = mkdtempSync(path.join(tmpdir(), 'onboard-assets-'))
const mediaPort = 8900 + Math.floor(Math.random() * 90)
const media = spawn(process.execPath, ['server/mediaServer.mjs'], {
  env: {
    ...process.env,
    MEDIA_SERVER_PORT: String(mediaPort),
    REPLICATE_API_TOKEN: '',
    SUPABASE_URL: '',
    ASSET_ROOT: assetRoot,
    CONTENT_DB_PATH: path.join(assetRoot, 'content.db'),
    VOICE_PROXY_PORT: '1',
  },
  stdio: 'ignore',
})
const mediaBase = `http://localhost:${mediaPort}/api/media`
const post = (route: string, body: unknown) => fetch(`${mediaBase}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
try {
  let health: { video: { configured: boolean }; image: { configured: boolean }; audio: { configured: boolean } } | null = null
  for (let i = 0; i < 50 && !health; i++) {
    await new Promise(r => setTimeout(r, 100))
    try { health = await (await fetch(`${mediaBase}/health`)).json() } catch { /* not up yet */ }
  }
  ok(!!health, 'media server starts')
  ok(health?.video.configured === false && health?.image.configured === false, 'without REPLICATE_API_TOKEN, video and image report unconfigured')
  ok(health?.audio.configured === false, 'without a reachable voice proxy, audio reports unconfigured')
  ok((await post('video', { episodeId: 'e1', sceneId: 's1', prompt: 'p' })).status === 503, 'a render request without a key is refused, not faked')
  const storedRes = await post('knowledge', { docId: 'security-notes', text: 'Report it.' })
  const stored = (await storedRes.json()) as { url: string; storageKey: string }
  ok(storedRes.ok && stored.storageKey === 'company/knowledge/security-notes.txt', 'an uploaded document gets an object-store key')
  ok(readFileSync(path.join(assetRoot, stored.storageKey), 'utf8') === 'Report it.', 'the document is written under that key')
  const served = await fetch(`http://localhost:${mediaPort}${stored.url}`)
  ok(served.ok && (await served.text()) === 'Report it.', 'stored assets are served back')
  ok((await post('knowledge', { docId: '../../etc', text: 'x' })).status === 400, 'path-shaped ids are rejected')
  const traversal = await fetch(`http://localhost:${mediaPort}/api/media/assets/..%2F..%2Fpackage.json`)
  ok(traversal.status === 400 || traversal.status === 404, `asset paths cannot escape the storage root (${traversal.status})`)

  const localHealth = (health as unknown as { content: { kind: string; episodes?: boolean }; storage: { kind: string } }) ?? null
  ok(localHealth?.content.kind === 'sqlite' && localHealth.storage.kind === 'local-disk' && localHealth.content.episodes === true, 'without Supabase, content falls back to SQLite and assets to local disk')
  const liveEpisode = { ...phishing.episode, provenance: { ...phishing.episode.provenance!, status: 'published' as const } }
  ok((await post('episodes', { episode: liveEpisode })).ok, 'a published episode is saved to the library')
  ok((await post('episodes', { episode: { ...liveEpisode, provenance: { ...liveEpisode.provenance, status: 'shipped' } } })).status === 400, 'an episode without a draft/published status is refused')
  const listed = (await (await fetch(`${mediaBase}/episodes`)).json()) as { episodes: Episode[] }
  ok(listed.episodes.length === 1 && listed.episodes[0].id === liveEpisode.id && Object.keys(listed.episodes[0].scenes).length === Object.keys(liveEpisode.scenes).length, 'the library lists it back intact')
  ok((await fetch(`${mediaBase}/episodes/${liveEpisode.id}`, { method: 'DELETE' })).ok, 'unpublishing deletes it from the library')
  ok(((await (await fetch(`${mediaBase}/episodes`)).json()) as { episodes: Episode[] }).episodes.length === 0, 'and it is gone for every browser')

  await post('content/docs', { id: 'doc-x', name: 'Uploaded policy' })
  await post('content/knowledge', { items: [{ id: 'K-DOC-X-01', rule: 'a' }, { id: 'K-DOC-X-02', rule: 'b' }] })
  const removedDoc = await fetch(`${mediaBase}/content/docs/doc-x`, { method: 'DELETE' })
  const removedItems = (await (await post('content/knowledge/remove', { ids: ['K-DOC-X-01', '../etc'] })).json()) as { removed: number }
  const docsLeft = ((await (await fetch(`${mediaBase}/content/docs`)).json()) as { docs: { id: string }[] }).docs
  const itemsLeft = ((await (await fetch(`${mediaBase}/content/knowledge`)).json()) as { items: { id: string }[] }).items
  ok(
    removedDoc.ok && removedItems.removed === 1 && docsLeft.length === 0 && itemsLeft.map((k) => k.id).join() === 'K-DOC-X-02',
    'an uploaded document and chosen knowledge items can be removed (unsafe ids ignored)',
  )
} finally {
  media.kill()
  rmSync(assetRoot, { recursive: true, force: true })
}

/* ------------------------------------------------ fake Replicate */
section('MEDIA SERVER · REPLICATE CONTRACT (fake Replicate API, no network)')
const FAKE_TOKEN = 'r8_fake_token_for_tests_only'
const replicateSeen: { url: string; auth?: string; body?: { input?: Record<string, unknown> } }[] = []
let videoPolls = 0
let throttledOnce = false
const fakeReplicate = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  replicateSeen.push({ url: req.url ?? '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined })
  const self = `http://127.0.0.1:${(fakeReplicate.address() as AddressInfo).port}`
  const reply = (status: number, obj: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  const prompt = String(replicateSeen.at(-1)?.body?.input?.prompt ?? '')
  if (req.url === '/v1/models/black-forest-labs/flux-schnell/predictions') return reply(201, { id: 'img-1', status: 'succeeded', output: [`${self}/files/frame.jpg`] })
  if (req.url === '/v1/models/wan-video/wan-2.2-i2v-fast/predictions' && !throttledOnce) {
    // Replicate's low-credit limit: burst 1. The first clip request is throttled once.
    throttledOnce = true
    return reply(429, { title: 'Request was throttled', status: 429, retry_after: 0.2 })
  }
  if (req.url === '/v1/models/wan-video/wan-2.2-i2v-fast/predictions') return reply(201, { id: prompt.includes('FORCE_FAILURE') ? 'vid-bad' : 'vid-1', status: 'starting' })
  if (req.url === '/v1/predictions/vid-1') {
    videoPolls++
    return reply(200, videoPolls < 2 ? { id: 'vid-1', status: 'processing' } : { id: 'vid-1', status: 'succeeded', output: `${self}/files/clip.mp4` })
  }
  if (req.url === '/v1/predictions/vid-bad') return reply(200, { id: 'vid-bad', status: 'failed', error: 'input image flagged by safety checker' })
  if (req.url === '/files/frame.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end('FAKEJPEG') }
  if (req.url === '/files/clip.mp4') { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end('FAKEMP4') }
  reply(404, { detail: 'not found' })
})
await new Promise<void>((r) => fakeReplicate.listen(0, '127.0.0.1', () => r()))
const replicateRoot = mkdtempSync(path.join(tmpdir(), 'onboard-replicate-'))
const replicatePort = 9100 + Math.floor(Math.random() * 90)
const replicateMedia = spawn(process.execPath, ['server/mediaServer.mjs'], {
  env: {
    ...process.env,
    MEDIA_SERVER_PORT: String(replicatePort),
    REPLICATE_API_TOKEN: FAKE_TOKEN,
    REPLICATE_API_BASE: `http://127.0.0.1:${(fakeReplicate.address() as AddressInfo).port}/v1`,
    SUPABASE_URL: '',
    ASSET_ROOT: replicateRoot,
    CONTENT_DB_PATH: path.join(replicateRoot, 'content.db'),
    VOICE_PROXY_PORT: '1',
  },
  stdio: 'ignore',
})
const rBase = `http://localhost:${replicatePort}/api/media`
const toBrowser: string[] = []
const readBack = async (r: Response) => {
  const t = await r.text()
  toBrowser.push(t)
  return JSON.parse(t)
}
const rPost = (route: string, body: unknown) => fetch(`${rBase}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
try {
  let rHealth: { video: { configured: boolean; model: string; mode: string } } | null = null
  for (let i = 0; i < 50 && !rHealth; i++) {
    await new Promise(r => setTimeout(r, 100))
    try { rHealth = await readBack(await fetch(`${rBase}/health`)) } catch { /* not up yet */ }
  }
  ok(!!rHealth?.video.configured && rHealth.video.model === 'wan-video/wan-2.2-i2v-fast' && rHealth.video.mode === 'image-to-video', 'with a token the server reports Wan 2.2 image-to-video')

  const img = await rPost('image', { episodeId: 'gen-test', sceneId: 'g_open', prompt: 'A glass lobby at dawn.' })
  const imgBody = await readBack(img)
  ok(img.ok && imgBody.storageKey === 'company/episodes/gen-test/backgrounds/g_open.jpg', 'a scene keyframe is generated and stored under backgrounds/')
  ok(readFileSync(path.join(replicateRoot, imgBody.storageKey), 'utf8') === 'FAKEJPEG', 'the stored keyframe is the file Replicate returned')
  const imgReq = replicateSeen.find(r => r.url.includes('flux-schnell'))
  ok(imgReq?.auth === `Bearer ${FAKE_TOKEN}` && imgReq?.body?.input?.aspect_ratio === '16:9', 'the image request is authenticated server-side and asks for 16:9')

  const noImage = await rPost('video', { episodeId: 'gen-test', sceneId: 'g_open', prompt: 'Slow push-in.' })
  await readBack(noImage)
  ok(noImage.status === 400, 'a clip request without a stored scene image is refused')
  const escape = await rPost('video', { episodeId: 'gen-test', sceneId: 'g_open', prompt: 'x', imageKey: '../../package.json' })
  await readBack(escape)
  ok(escape.status === 400, 'a keyframe key outside storage is refused')

  const vid = await rPost('video', { episodeId: 'gen-test', sceneId: 'g_open', prompt: 'Slow push-in toward the character.', imageKey: imgBody.storageKey, durationSec: 6 })
  const vidBody = await readBack(vid)
  ok(vid.status === 202 && vidBody.status === 'queued', `a clip job is queued (${vid.status} ${vidBody.status})`)
ok(replicateSeen.filter(r => r.url.includes('wan-2.2-i2v-fast')).length === 2, 'a throttled (429) prediction is retried after retry_after instead of failing the clip')
  const input = replicateSeen.find(r => r.url.includes('wan-2.2-i2v-fast'))?.body?.input ?? {}
  ok(input.image === `data:image/jpeg;base64,${Buffer.from('FAKEJPEG').toString('base64')}`, 'Wan receives the stored keyframe as its input image')
  ok(
    input.prompt === 'Slow push-in toward the character.' && input.num_frames === 97 && input.frames_per_second === 16 && input.resolution === '480p',
    `Wan receives the motion prompt and a short clip spec (${input.num_frames} frames @ ${input.frames_per_second} fps)`,
  )
  const seenStatuses: string[] = []
  let latest = vidBody
  for (let i = 0; i < 10 && !['ready', 'failed'].includes(latest.status); i++) {
    latest = await readBack(await fetch(`${rBase}/video/${vidBody.jobId}`))
    seenStatuses.push(latest.status)
  }
  ok(seenStatuses.join() === 'rendering,ready', `the job walks queued -> rendering -> ready (saw ${seenStatuses.join()})`)
  ok(
    latest.storageKey === 'company/episodes/gen-test/videos/g_open.mp4' && readFileSync(path.join(replicateRoot, latest.storageKey), 'utf8') === 'FAKEMP4',
    'the clip is downloaded into videos/',
  )
  const ranged = await fetch(`http://localhost:${replicatePort}${latest.url}`, { headers: { range: 'bytes=0-3' } })
  ok(ranged.status === 206 && ranged.headers.get('content-type') === 'video/mp4' && (await ranged.text()) === 'FAKE', 'the stored clip is served with range support for <video>')

  const bad = await readBack(await rPost('video', { episodeId: 'gen-test', sceneId: 'g_end', prompt: 'FORCE_FAILURE', imageKey: imgBody.storageKey }))
  const badStatus = await readBack(await fetch(`${rBase}/video/${bad.jobId}`))
  ok(badStatus.status === 'failed' && /safety checker/.test(badStatus.error ?? ''), 'a failed prediction is reported as failed, with its reason')

  const client = new ServerVideoProvider({ model: 'wan-video/wan-2.2-i2v-fast', base: rBase })
  const clientJob = await requestClip(
    phishing.episode.scenes.g_d1.shot,
    { episodeId: 'gen-test', sceneId: 'g_d1', image: { kind: 'image', tier: 'generated', provider: 'test', storageKey: imgBody.storageKey, createdAt: 'now' } },
    client,
  )
  const clientDone = await awaitClip(clientJob, client, { sleep: async () => {} })
  const clientAsset = clipToAsset(clientDone)
  ok(clientAsset?.tier === 'generated' && clientAsset.storageKey === 'company/episodes/gen-test/videos/g_d1.mp4', 'the browser-side provider drives the same server contract to a stored clip asset')

  const wanCalls = () => replicateSeen.filter(r => r.url.includes('wan-2.2-i2v-fast')).length
  const fluxCalls = () => replicateSeen.filter(r => r.url.includes('flux-schnell')).length
  const wanBefore = wanCalls()
  const again = await readBack(await rPost('video', { episodeId: 'gen-test', sceneId: 'g_open', prompt: 'Slow push-in toward the character.', imageKey: imgBody.storageKey }))
  ok(again.status === 'ready' && again.reused === true && again.storageKey === latest.storageKey && wanCalls() === wanBefore, 'a clip already in storage is reused — no new Replicate prediction')
  const imgAgain = await readBack(await rPost('image', { episodeId: 'gen-test', sceneId: 'g_open', prompt: 'A glass lobby at dawn.' }))
  ok(imgAgain.reused === true && fluxCalls() === 1, 'a scene image already in storage is reused')
  const forced = await readBack(await rPost('video', { episodeId: 'gen-test', sceneId: 'g_open', prompt: 'Slow push-in.', imageKey: imgBody.storageKey, force: true }))
  ok(forced.status === 'queued' && !forced.reused && wanCalls() === wanBefore + 1, 'force: true (re-render) pays for a new prediction')
  ok(toBrowser.every(b => !b.includes(FAKE_TOKEN)), 'the token never appears in any response the browser can see')
} finally {
  replicateMedia.kill()
  rmSync(replicateRoot, { recursive: true, force: true })
}

/* ------------------------------------------------ fake Supabase */
section('MEDIA SERVER · SUPABASE STORAGE + CONTENT (fake Supabase API, no network)')
const FAKE_SUPABASE_KEY = 'sb_secret_fake_key_for_tests_only'
const buckets = new Map<string, { type: string; body: Buffer }>()
const supaTables: Record<string, Map<string, { id: string; data: unknown; status?: string }>> = { episodes: new Map(), source_docs: new Map(), knowledge_items: new Map() }
const supaSeen: { method: string; path: string; apikey?: string; auth?: string }[] = []
const fakeSupabase = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = Buffer.concat(chunks)
  const url = new URL(req.url ?? '/', 'http://fake')
  supaSeen.push({ method: req.method ?? '', path: url.pathname, apikey: req.headers.apikey as string | undefined, auth: req.headers.authorization })
  const reply = (status: number, obj?: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(obj === undefined ? '' : JSON.stringify(obj))
  }
  const pub = /^\/storage\/v1\/object\/public\/(.+)$/.exec(url.pathname)
  if (pub) {
    // Only the public bucket is readable without a key.
    const id = decodeURIComponent(pub[1])
    const o = id.startsWith('dayone-assets/') ? buckets.get(id) : undefined
    if (!o) return reply(400, { error: 'not_found' })
    res.writeHead(200, { 'content-type': o.type })
    return res.end(req.method === 'HEAD' ? undefined : o.body)
  }
  if (req.headers.apikey !== FAKE_SUPABASE_KEY) return reply(401, { message: 'Invalid API key' })
  const obj = /^\/storage\/v1\/object\/(.+)$/.exec(url.pathname)
  if (obj) {
    const id = decodeURIComponent(obj[1])
    if (req.method === 'POST') {
      buckets.set(id, { type: String(req.headers['content-type']), body })
      return reply(200, { Key: id })
    }
    if (req.method === 'DELETE') {
      buckets.delete(id)
      return reply(200, { message: 'Successfully deleted' })
    }
    const o = buckets.get(id)
    if (!o) return reply(400, { error: 'not_found' })
    res.writeHead(200, { 'content-type': o.type })
    return res.end(o.body)
  }
  const table = supaTables[/^\/rest\/v1\/(\w+)$/.exec(url.pathname)?.[1] ?? '']
  if (!table) return reply(404, { message: 'relation does not exist' })
  if (req.method === 'GET') return reply(200, [...table.values()].map(r => ({ data: r.data })))
  if (req.method === 'POST') {
    for (const r of JSON.parse(body.toString('utf8'))) table.set(r.id, r)
    return reply(201)
  }
  if (req.method === 'DELETE') {
    table.delete((url.searchParams.get('id') ?? '').replace(/^eq\./, ''))
    return reply(204)
  }
  reply(405)
})
await new Promise<void>((r) => fakeSupabase.listen(0, '127.0.0.1', () => r()))
const supaUrl = `http://127.0.0.1:${(fakeSupabase.address() as AddressInfo).port}`
const supaRoot = mkdtempSync(path.join(tmpdir(), 'onboard-supabase-'))
const supaPort = 9200 + Math.floor(Math.random() * 90)
const supaMedia = spawn(process.execPath, ['server/mediaServer.mjs'], {
  env: {
    ...process.env,
    MEDIA_SERVER_PORT: String(supaPort),
    REPLICATE_API_TOKEN: FAKE_TOKEN,
    REPLICATE_API_BASE: `http://127.0.0.1:${(fakeReplicate.address() as AddressInfo).port}/v1`,
    SUPABASE_URL: supaUrl,
    SUPABASE_SECRET_KEY: FAKE_SUPABASE_KEY,
    ASSET_ROOT: supaRoot,
    CONTENT_DB_PATH: path.join(supaRoot, 'content.db'),
    VOICE_PROXY_PORT: '1',
  },
  stdio: 'ignore',
})
const sBase = `http://localhost:${supaPort}/api/media`
const sSeen: string[] = []
const sRead = async (r: Response) => {
  const t = await r.text()
  sSeen.push(t)
  return JSON.parse(t)
}
const sPost = (route: string, body: unknown) => fetch(`${sBase}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const storedLocally = (key: string) => {
  try {
    readFileSync(path.join(supaRoot, key))
    return true
  } catch {
    return false
  }
}
try {
  let sHealth: { content: { kind: string; episodes?: boolean }; storage: { kind: string; bucket?: string } } | null = null
  for (let i = 0; i < 50 && !sHealth; i++) {
    await new Promise(r => setTimeout(r, 100))
    try { sHealth = await sRead(await fetch(`${sBase}/health`)) } catch { /* not up yet */ }
  }
  ok(sHealth?.content.kind === 'supabase' && sHealth.storage.kind === 'supabase' && sHealth.storage.bucket === 'dayone-assets', 'with a Supabase secret key, content and storage report Supabase')

  const doc = await sRead(await sPost('knowledge', { docId: 'security-notes', text: 'Report it.' }))
  const privateDoc = buckets.get('dayone-private/company/knowledge/security-notes.txt')
  ok(privateDoc?.body.toString('utf8') === 'Report it.' && privateDoc.type === 'text/plain' && !doc.url, 'extracted policy text goes to the private bucket, with no public URL')

  const sImg = await sRead(await sPost('image', { episodeId: 'gen-supa', sceneId: 'g_open', prompt: 'A glass lobby at dawn.' }))
  ok(
    String(sImg.url).startsWith(`${supaUrl}/storage/v1/object/public/dayone-assets/company/episodes/gen-supa/backgrounds/g_open.jpg`) &&
      buckets.get('dayone-assets/company/episodes/gen-supa/backgrounds/g_open.jpg')?.body.toString('utf8') === 'FAKEJPEG',
    'a generated scene image is uploaded to the public bucket and served from its URL',
  )
  const wanBeforeSupa = replicateSeen.filter(r => r.url.includes('wan-2.2-i2v-fast')).length
  let sVid = await sRead(await sPost('video', { episodeId: 'gen-supa', sceneId: 'g_open', prompt: 'Slow push-in.', imageKey: sImg.storageKey }))
  const sInput = replicateSeen.filter(r => r.url.includes('wan-2.2-i2v-fast')).at(-1)?.body?.input ?? {}
  ok(sVid.status === 'queued' && sInput.image === `data:image/jpeg;base64,${Buffer.from('FAKEJPEG').toString('base64')}`, 'Wan receives the keyframe read back from the bucket')
  for (let i = 0; i < 10 && !['ready', 'failed'].includes(sVid.status); i++) sVid = await sRead(await fetch(`${sBase}/video/${sVid.jobId}`))
  ok(
    sVid.status === 'ready' && buckets.get('dayone-assets/company/episodes/gen-supa/videos/g_open.mp4')?.body.toString('utf8') === 'FAKEMP4' && String(sVid.url).includes('/object/public/dayone-assets/'),
    'the finished clip is uploaded to the bucket',
  )
  const sAgain = await sRead(await sPost('video', { episodeId: 'gen-supa', sceneId: 'g_open', prompt: 'Slow push-in.', imageKey: sImg.storageKey }))
  ok(sAgain.status === 'ready' && sAgain.reused === true && replicateSeen.filter(r => r.url.includes('wan-2.2-i2v-fast')).length === wanBeforeSupa + 1, 'a clip already in the bucket is reused, not re-rendered')
  ok(!storedLocally('company/episodes/gen-supa/videos/g_open.mp4') && !storedLocally('content.db'), 'nothing is written to local disk when Supabase is configured')

  ok((await sPost('content/docs', { id: 'doc-1', name: 'Security policy' })).ok, 'an uploaded document row is saved')
  ok((await sRead(await fetch(`${sBase}/content/docs`))).docs?.[0]?.name === 'Security policy', 'and read back from Postgres')
  ok(
    (await fetch(`${sBase}/content/docs/security-notes`, { method: 'DELETE' })).ok && !buckets.has('dayone-private/company/knowledge/security-notes.txt'),
    'removing a document deletes its extracted text from the private bucket',
  )
  ok((await fetch(`${sBase}/content/docs/doc-1`, { method: 'DELETE' })).ok && supaTables.source_docs.size === 0, 'and its row from Postgres')
  const sEpisode = { ...phishing.episode, provenance: { ...phishing.episode.provenance!, status: 'published' as const } }
  ok((await sPost('episodes', { episode: sEpisode })).ok && supaTables.episodes.get(sEpisode.id)?.status === 'published', 'a published episode is upserted into the episodes table with its status')
  ok((await sRead(await fetch(`${sBase}/episodes`))).episodes?.[0]?.id === sEpisode.id, 'every browser reads the same library')
  ok((await fetch(`${sBase}/episodes/${sEpisode.id}`, { method: 'DELETE' })).ok && supaTables.episodes.size === 0, 'unpublishing deletes the row')

  const keyed = supaSeen.filter(s => !s.path.includes('/object/public/'))
  ok(keyed.length > 0 && keyed.every(s => s.apikey === FAKE_SUPABASE_KEY && !s.auth), 'every private Supabase call carries the secret key in apikey (not as a bearer token)')
  ok(supaSeen.filter(s => s.path.includes('/object/public/')).every(s => !s.apikey), 'public object checks carry no key')
  ok(sSeen.every(b => !b.includes(FAKE_SUPABASE_KEY) && !b.includes(FAKE_TOKEN)), 'neither secret appears in any response the browser can see')
} finally {
  supaMedia.kill()
  fakeSupabase.close()
  fakeReplicate.close()
  rmSync(supaRoot, { recursive: true, force: true })
}

/* ------------------------------------------------ suggested questions */
section('SUGGESTED QUESTIONS · EVERY CHIP IS ANSWERABLE')
ok(CONFIDENCE_FLOOR === 0.3 && SPECIFICITY_FLOOR === 0.6, 'refusal thresholds are unchanged')
const chipContexts = [
  ...concepts.map(c => ({ label: c.id, ctx: { ...ctx, activeConcepts: [c.id] }, corpus: undefined as KnowledgeItem[] | undefined })),
  { label: 'first day scene', ctx, corpus: undefined as KnowledgeItem[] | undefined },
  ...[phishing, custom].map(g => ({ label: g.episode.id, ctx: { ...ctx, activeConcepts: g.episode.concepts }, corpus: corpusFor(g.episode.knowledge) })),
]
let chipCount = 0
for (const { label, ctx: chipCtx, corpus } of chipContexts) {
  const chips = suggestedQuestions(chipCtx, corpus)
  ok(chips.length > 0, `${label}: offers at least one question`)
  for (const q of chips) {
    chipCount++
    const reply = await askCharacter({ characterId: 'summer', question: q, ctx: chipCtx, history: [], corpus })
    ok(reply.kind !== 'refusal' && reply.grounding.status !== 'refused', `${label}: chip "${q}" is answered, not refused (conf ${reply.confidence.toFixed(2)})`)
  }
}
console.log(`  ${chipCount} chips offered across ${chipContexts.length} contexts · every one answered`)
const stillRefused = await askCharacter({ characterId: 'summer', question: 'What is the password for the espresso machine on floor two?', ctx, history: [] })
ok(stillRefused.grounding.status === 'refused' && stillRefused.grounding.reason === 'out_of_scope', `unsupported questions are still refused out of scope (${stillRefused.grounding.reason})`)


console.log('\n' + (fails === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${fails} CHECK(S) FAILED`))
process.exit(fails === 0 ? 0 : 1)
