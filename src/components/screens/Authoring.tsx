import { motion } from 'framer-motion'
import { Check, Play, Rocket, Upload, Wand2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { runKnowledgeAgent, STAGES, type PipelineStage } from '@/ai/knowledgeAgent'
import {
  customTopic,
  GEN_STAGES,
  generateEpisode,
  MIN_RULES,
  selectKnowledge,
  TOPICS,
  TopicNotCovered,
  type GenerateResult,
  type GenStage,
  type TopicDef,
} from '@/ai/episodeGenerator'
import { currentModel, isLive, llmLabel, llmMode, OPENAI_MODELS, setModel } from '@/ai/llm'
import { conceptLabel } from '@/content/knowledge'
import { sourceDocs } from '@/content/sourceDocs'
import { contentStore } from '@/data/contentStore'
import { validateEpisode } from '@/engine/validateEpisode'
import { useGame } from '@/engine/gameStore'
import { ParseError, parseFile, SUPPORTED_EXTENSIONS } from '@/ingest/parse'
import { probeMediaServer } from '@/media/mediaStatus'
import { storeSourceDoc } from '@/media/storage'
import { useMediaStatus } from '@/media/useMediaStatus'
import { sttTier, ttsTier, voiceLabel } from '@/voice/voice'
import type { Episode, KnowledgeItem, SourceDoc } from '@/types'
import { VideoAssets, VisualAssets, VoiceAssets, type AssetRun } from '../studio/AssetStudio'
import { GraphReview } from '../studio/GraphReview'
import { PlayerLensPanel } from '../studio/PlayerLensPanel'
import { StatusCard, Step, StudioRail, type StepState } from '../studio/StudioBits'
import { Btn, Chip, Eyebrow } from '../ui/Bits'

/* ============================================================================
 * STUDIO — the authoring workspace. Admin only; the boundary is the ADMIN_ONLY
 * check in the GOTO reducer case, not the nav filter that hides the button.
 *
 *   1 knowledge   2 topic    3 generate   4 review story   5 images
 *   6 voices      7 video    8 act three  9 publish
 *
 * One step is on screen at a time — the rest are not in the DOM at all, with
 * navigation living in the fixed StudioRail header instead. Two separate
 * things decide what that is: the per-step predicates in `stepStates` say
 * which steps MAY be opened, and the `cursor` says which one is showing.
 * Keeping them apart is what lets a finished step be reopened without
 * inventing a second notion of progress.
 *
 * Everything here runs before anyone plays. The employee-facing game plays the
 * finished, validated graph and never calls any of this at runtime.
 * ========================================================================== */

const ASSET_KINDS = ['visual', 'voice', 'video'] as const
type AssetKind = (typeof ASSET_KINDS)[number]
const IDLE_RUNS: Record<AssetKind, AssetRun> = {
  visual: { rows: {}, running: false },
  voice: { rows: {}, running: false },
  video: { rows: {}, running: false },
}

/* One source of truth for the nine step titles. StudioRail prints all nine
 * up front, in the fixed header, while only one <Step> below ever renders —
 * duplicating the strings between the two would just be an invitation for
 * them to drift apart. */
const STEP_TITLES = [
  'Company knowledge',
  'Pick a topic',
  'Generate the episode',
  'Review the story',
  'Generate images',
  'Generate voices',
  'Generate video',
  'Preview act three',
  'Publish',
] as const

export function Authoring() {
  const { state, dispatch, group } = useGame()
  const { health, pending } = useMediaStatus()
  const fileInput = useRef<HTMLInputElement>(null)

  /* 1 — knowledge */
  const [uploads, setUploads] = useState<SourceDoc[]>([])
  /* The demo corpus is opt-in, not the starting point. It used to be spread
   * into `docs` unconditionally, which made an admin's own material look like
   * an afterthought appended to fixture content. */
  const [presets, setPresets] = useState<SourceDoc[]>([])
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<{ doc?: string; id?: PipelineStage }>({})
  const [extracted, setExtracted] = useState<KnowledgeItem[]>([])
  const [yieldByDoc, setYieldByDoc] = useState<Record<string, number>>({})

  /* 2..8 — episode */
  const [topic, setTopic] = useState<TopicDef | null>(null)
  const [custom, setCustom] = useState('')
  /* Mirrors the module-level choice in llm.ts purely so this picker re-renders;
   * llm.ts stays the source of truth that generate() reads. */
  const [model, setModelState] = useState(currentModel)
  const [gen, setGen] = useState<{ busy: boolean; stages: Partial<Record<GenStage, string>>; error?: string }>({ busy: false, stages: {} })
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [draft, setDraft] = useState<Episode | null>(null)
  const [published, setPublished] = useState<string | null>(null)

  /* Which step is showing. Every other step is absent from the DOM, so this
   * is the only thing that decides what is on screen. */
  const [cursor, setCursor] = useState(1)
  const prevStates = useRef<StepState[]>([])
  const advanced = useRef<Set<number>>(new Set())

  /* Asset generation state lives up here rather than inside the three asset
   * panels, because the wizard unmounts a step the moment you navigate off it
   * and a render already in flight must not lose its rows and timers. */
  const [runs, setRuns] = useState<Record<AssetKind, AssetRun>>(IDLE_RUNS)
  const setRun = useMemo(
    () =>
      Object.fromEntries(
        ASSET_KINDS.map((k) => [
          k,
          (next: React.SetStateAction<AssetRun>) =>
            setRuns((r) => ({ ...r, [k]: typeof next === 'function' ? (next as (p: AssetRun) => AssetRun)(r[k]) : next })),
        ]),
      ) as Record<AssetKind, React.Dispatch<React.SetStateAction<AssetRun>>>,
    [],
  )

  const docs = [...presets, ...uploads]
  const demoLoaded = presets.length > 0
  const loadDemo = () => setPresets(sourceDocs)

  /* Removal is local only. There is no delete anywhere below this component —
   * ContentStore exposes list/save and nothing else, and the media server
   * answers only GET and POST — so an upload that reached the server comes
   * back on the next reload. Demo docs were never persisted, so for them this
   * is a real removal. */
  const removeDoc = (id: string) => {
    setPresets((p) => p.filter((d) => d.id !== id))
    setUploads((u) => u.filter((d) => d.id !== id))
  }
  const report = useMemo(() => (draft ? validateEpisode(draft) : null), [draft])

  /* Restore a prior Studio session once the media server confirms it can
   * persist content — before that, `contentStore()` is still the static,
   * read-only bundle, and skipping the load leaves this screen exactly as it
   * behaves today with no media server running. */
  useEffect(() => {
    void (async () => {
      await probeMediaServer()
      if (contentStore().kind !== 'db') return
      try {
        const [persistedDocs, persistedItems] = await Promise.all([
          contentStore().listSourceDocs(),
          contentStore().listKnowledge(),
        ])
        if (persistedDocs.length) setUploads(persistedDocs)
        if (persistedItems.length) {
          setExtracted(persistedItems)
        }
      } catch {
        /* Nothing persisted yet, or the server dropped mid-request — Studio
         * still starts from a clean slate, same as without a media server. */
      }
    })()
  }, [])

  const resetEpisode = () => {
    setResult(null)
    setDraft(null)
    setPublished(null)
    setGen({ busy: false, stages: {} })
    /* The old draft's assets are gone with it, so its progress rows are too —
     * leaving them would report renders that no longer belong to anything. */
    setRuns(IDLE_RUNS)
    /* Let the steps that are about to re-lock auto-advance again once they are
     * legitimately re-completed. */
    advanced.current.clear()
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const doc = await parseFile(file)
      setUploads((u) => [...u.filter((d) => d.id !== doc.id), doc])
      const key = await storeSourceDoc(doc)
      // Best-effort: the static store refuses writes (no media server), and
      // that must not take the upload down — it just will not survive reload.
      try {
        await contentStore().saveSourceDoc(doc)
      } catch {
        /* static store, or the server dropped — doc still stands for this session */
      }
      setUploadNote(
        `${doc.name} parsed · ${doc.excerpt.split(/\s+/).length} words · ${key ? `stored at ${key}` : 'not stored (no media server) — kept for this session'}`,
      )
    } catch (err) {
      setUploadNote(err instanceof ParseError ? err.message : 'Could not read that file.')
    }
  }

  async function runAgent() {
    setRunning(true)
    setExtracted([])
    /* Seed every document at zero so the per-row chip can tell "this run found
     * nothing in it" apart from "this document was never in a run" — a doc
     * added after the last run, or rules restored from the content store with
     * no documents behind them, must not be labelled uncitable. */
    setYieldByDoc(Object.fromEntries(docs.map((d) => [d.id, 0])))
    setTopic(null)
    resetEpisode()
    const collected: KnowledgeItem[] = []
    for await (const ev of runKnowledgeAgent(docs, { speed: 2.4 })) {
      if (ev.type === 'stage') setStage({ doc: ev.doc?.name, id: ev.stage })
      if (ev.type === 'item' && ev.item && ev.doc) {
        const { item, doc } = ev
        collected.push(item)
        setExtracted((prev) => (prev.some((k) => k.id === item.id) ? prev : [...prev, item]))
        setYieldByDoc((y) => ({ ...y, [doc.id]: (y[doc.id] ?? 0) + 1 }))
      }
    }
    setStage({})
    setRunning(false)
    if (collected.length) {
      try {
        await contentStore().saveKnowledge(collected)
      } catch {
        /* static store, or the server dropped — extraction still powers
         * episode generation below, it just will not survive a reload */
      }
    }
  }

  async function generate() {
    if (!topic) return
    resetEpisode()
    setGen({ busy: true, stages: {} })
    try {
      const r = await generateEpisode({
        topic,
        groupId: group.id,
        mastery: state.player.mastery,
        corpus: extracted,
        paceMs: 320,
        onStage: (s, detail) => setGen((g) => ({ ...g, stages: { ...g.stages, [s]: detail } })),
      })
      setResult(r)
      setDraft(r.episode)
      setGen((g) => ({ ...g, busy: false }))
    } catch (e) {
      setGen((g) => ({
        ...g,
        busy: false,
        error: e instanceof TopicNotCovered ? e.message : `Generation failed: ${(e as Error).message}`,
      }))
    }
  }

  const publish = (status: 'draft' | 'published') => {
    if (!draft) return
    dispatch({ type: 'PUBLISH_EPISODE', episode: draft, status })
    if (status === 'published') setPublished(draft.id)
  }
  const play = () => draft && dispatch({ type: 'SELECT_EPISODE', episodeId: draft.id })

  const step = (locked: boolean, done: boolean): StepState => (locked ? 'locked' : done ? 'done' : 'active')
  const hasImages = !!draft && Object.values(draft.scenes).some((s) => s.assets?.background)
  const hasClips = !!draft && Object.values(draft.scenes).some((s) => s.assets?.video)
  const hasVoice = !!draft && Object.values(draft.scenes).some((s) => s.assets?.audio)

  /* An asset step is finished when its pass has RUN, not when it happens to
   * have produced stored files. Without an ElevenLabs key nothing is
   * pre-rendered at all — the player speaks every line at runtime instead — so
   * `hasVoice` stays false forever and step 6 could never be ticked off even
   * though the admin did everything the step asks. Keying off the run also
   * fixes a race in the other two: `hasImages` flipped on the FIRST attached
   * asset, marking the step done while the rest were still rendering. */
  const passRan = (k: AssetKind) => !runs[k].running && Object.keys(runs[k].rows).length > 0

  /* The unlock rules, in one place. These are the same predicates the steps
   * carried inline before the wizard existed — they stay the source of truth
   * for whether a step MAY be opened, and the cursor below only decides which
   * open step is showing. Keeping the two separate is what lets an earlier
   * step be reopened without inventing a second notion of progress. */
  const stepStates: StepState[] = [
    /* Rules can outlive their documents in the content store, so extraction
     * alone does not mean this step is finished — without a document behind
     * them there is nothing left to run the agent on, and a checkmark here
     * would sit next to a disabled button and a cold-start message. */
    step(false, extracted.length > 0 && docs.length > 0 && !running),
    step(!extracted.length || running, !!topic),
    step(!topic || running, !!draft),
    step(!draft, !!report?.ok),
    step(!draft, hasImages || passRan('visual')),
    step(!draft, hasVoice || passRan('voice')),
    step(!draft, hasClips || passRan('video')),
    step(!draft, !!draft),
    step(!report?.ok, !!published),
  ]
  const lastUnlocked = stepStates.reduce((acc, s, i) => (s === 'locked' ? acc : i + 1), 1)

  /* Clamped during render, not in an effect: editing step 2 after generating
   * re-locks everything downstream, and a cursor left pointing at step 6 would
   * otherwise paint one frame of a step whose data no longer exists. */
  const at = Math.min(cursor, lastUnlocked)
  const openStep = (n: number) => setCursor(Math.max(1, Math.min(n, lastUnlocked)))

  /* Auto-advance only on the TRANSITION into done, and only once per step.
   * Reopening a finished step must not immediately bounce forward again, and
   * step 8 (which is 'done' the moment it unlocks) must not be skipped past
   * before anyone has looked at it. */
  const stepKey = stepStates.join('|')
  useEffect(() => {
    const before = prevStates.current[at - 1]
    const now = stepStates[at - 1]
    prevStates.current = stepStates
    if (before === 'done' || now !== 'done') return
    if (advanced.current.has(at)) return
    if (at < stepStates.length && stepStates[at] !== 'locked') {
      advanced.current.add(at)
      setCursor(at + 1)
    }
    // stepStates is rebuilt every render; stepKey is its stable identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, at])

  /* Per-step summaries, in the same order as STEP_TITLES and stepStates. They
   * used to be passed one at a time as each <Step>'s `summary` prop, for that
   * step's own collapsed row; now that only the active step is ever on screen
   * there is no collapsed row left to read them, so the rail is their only
   * audience. The computations are unchanged — just gathered in one place. */
  const stepSummaries: (string | undefined)[] = [
    docs.length ? `${extracted.length} rules · ${docs.length} documents` : `${extracted.length} rules`,
    topic?.label,
    draft?.code,
    draft ? `${Object.keys(draft.scenes).length} scenes` : undefined,
    hasImages ? 'rendered' : undefined,
    hasVoice ? 'recorded' : undefined,
    hasClips ? 'animated' : undefined,
    'previewed',
    published ? 'published' : undefined,
  ]
  const railSteps = STEP_TITLES.map((label, i) => ({ n: i + 1, label, state: stepStates[i], summary: stepSummaries[i] }))

  return (
    <div className="relative h-full overflow-y-auto">
      {/* Narrower than the old 1180px: one step at a time reads as a column of
        * work, and a wide measure made every step look like a dashboard. Step
        * 4's two-pane graph review is the one exception — it earns the extra
        * room, and only while it is the step on screen. */}
      <div className={`mx-auto px-6 pb-32 pt-36 sm:px-10 ${at === 4 ? 'max-w-[1100px]' : 'max-w-[860px]'}`}>
        {/* No back button here. This screen sits under the app header, which
          * already has Episodes in it, and two controls for one destination is
          * the same noise the nav comment warns about. */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Eyebrow className="text-signal">studio</Eyebrow>
            <h1 className="mt-2 font-sans text-[26px] font-semibold tracking-[-0.015em] text-bone">Episode builder</h1>
          </div>
          <StudioRail steps={railSteps} at={at} onJump={openStep} />
        </div>

        <div className="mt-8 border-t border-bone/10 pt-2">

        {/* 1 ─ knowledge */}
        {at === 1 && (
        <Step
          n={1}
          title={STEP_TITLES[0]}
          detail="Only claims your documents can prove survive extraction."
          state={stepStates[0]}
        >
          {docs.length === 0 && extracted.length > 0 ? (
            /* Rules can persist to the content store after their documents are
              * gone — the demo corpus never persists at all — so a bare "add
              * documents" line here would sit under rules that already exist
              * and read like the screen forgot its own state. */
            <p className="font-sans text-[13px] font-light leading-relaxed text-bone-faint">
              You have {extracted.length} rules carried over from an earlier session, so add documents to extract more.
            </p>
          ) : docs.length === 0 ? (
            <p className="font-sans text-[13px] font-light leading-relaxed text-bone-faint">
              Add the documents this episode should be built from, or start from the demo corpus.
            </p>
          ) : (
            <div className="divide-y divide-bone/8 border-y border-bone/8">
              {docs.map((d) => {
                const active = stage.doc === d.name
                const got = yieldByDoc[d.id] ?? 0
                const visited = d.id in yieldByDoc
                return (
                  <div key={d.id} className="flex items-center gap-3 py-2.5">
                    <span className={`min-w-0 flex-1 truncate font-mono text-[11px] ${active ? 'text-signal' : 'text-bone'}`}>{d.name}</span>
                    {/* Everything that used to sit under the filename now reports
                      * on this one line: the live stage while the agent is on this
                      * document, the yield once it has moved on. */}
                    {active && (
                      <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-signal">
                        {STAGES.find((s) => s.id === stage.id)?.label ?? 'working'}
                      </span>
                    )}
                    {/* Only once the whole run is over: mid-run, a document the
                      * agent has not reached yet is merely queued, and labelling
                      * it uncitable before it has been read is a lie. */}
                    {visited && !running && !active && (
                      got ? (
                        <Chip tone="good">{got} rules</Chip>
                      ) : (
                        <Chip tone="signal">{isLive() ? 'nothing citable' : 'needs a language model'}</Chip>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => removeDoc(d.id)}
                      disabled={running}
                      aria-label={`Remove ${d.name}`}
                      className="shrink-0 p-1 text-bone-faint transition-colors hover:text-danger disabled:opacity-30"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Btn onClick={() => void runAgent()} disabled={running || !docs.length}>
              {running ? (
                <>
                  <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}>
                    <Wand2 size={13} />
                  </motion.span>
                  extracting…
                </>
              ) : (
                <>
                  <Play size={13} fill="currentColor" /> run knowledge agent
                </>
              )}
            </Btn>
            <input
              ref={fileInput}
              type="file"
              accept={SUPPORTED_EXTENSIONS.map((x) => `.${x}`).join(',')}
              onChange={(e) => void onUpload(e)}
              className="hidden"
            />
            <Btn variant="outline" onClick={() => fileInput.current?.click()} disabled={running}>
              <Upload size={12} /> upload {SUPPORTED_EXTENSIONS.map((x) => `.${x}`).join(' ')}
            </Btn>
            {/* The demo corpus stays on offer after the first load: it is the
              * only material that extracts without a language model, so it is
              * also the fallback when someone's own upload yields nothing. */}
            <Btn variant="ghost" size="sm" onClick={loadDemo} disabled={running || demoLoaded}>
              {demoLoaded ? 'demo content loaded' : 'load demo content'}
            </Btn>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
              {extracted.length} knowledge items
            </span>
          </div>
          {uploadNote && <p className="mt-3 font-mono text-[10px] text-bone-dim">{uploadNote}</p>}

          {extracted.length > 0 && (
            <div className="mt-6 grid gap-1.5 lg:grid-cols-2">
              {extracted.map((k) => (
                <div key={k.id} className="flex items-center gap-2 rounded border border-bone/8 bg-ink-900/30 px-3 py-2">
                  <span className="font-mono text-[9px] tracking-[0.12em] text-signal">{k.id}</span>
                  <span className="min-w-0 flex-1 truncate font-sans text-[12px] font-light text-bone">{k.topic}</span>
                  <Chip tone={k.severity === 'critical' ? 'danger' : k.severity === 'high' ? 'signal' : 'neutral'}>{k.severity}</Chip>
                </div>
              ))}
            </div>
          )}
        </Step>
        )}

        {/* 2 ─ topic */}
        {at === 2 && (
        <Step
          n={2}
          title={STEP_TITLES[1]}
          detail="Pick a topic with enough rules, or type your own."
          state={stepStates[1]}
        >
          <div className="flex flex-wrap gap-2">
            {TOPICS.map((t) => {
              const n = selectKnowledge(t, extracted).length
              const on = topic?.id === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTopic(t)
                    resetEpisode()
                  }}
                  className={`flex flex-col items-start rounded border px-4 py-3 text-left transition-colors ${
                    on ? 'border-signal/70 bg-signal/[0.07]' : 'border-bone/12 hover:border-bone/35'
                  }`}
                >
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-bone">{t.label}</span>
                  <span className={`mt-1 font-mono text-[9px] uppercase tracking-[0.12em] ${n >= MIN_RULES ? 'text-good' : 'text-danger'}`}>
                    {n} rules · {t.blurb}
                  </span>
                </button>
              )
            })}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!custom.trim()) return
              setTopic(customTopic(custom))
              resetEpisode()
            }}
            className="mt-3 flex max-w-md items-center gap-2 rounded border border-bone/15 px-3 focus-within:border-signal/50"
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="or type any topic…"
              className="min-w-0 flex-1 bg-transparent py-2.5 font-sans text-[13px] font-light text-bone placeholder:text-bone-faint focus:outline-none"
            />
            <button type="submit" className="font-mono text-[10px] uppercase tracking-[0.16em] text-bone-faint hover:text-signal">
              use
            </button>
          </form>
          <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-bone-faint">
            cast from {group.name} · personalised for the current employee profile
          </p>
        </Step>
        )}

        {/* 3 ─ generate */}
        {at === 3 && (
        <Step
          n={3}
          title={STEP_TITLES[2]}
          detail="The story structure is fixed and only the wording comes from your model."
          state={stepStates[2]}
        >
          {/* The model writes the wording, so the choice belongs next to the
            * button that spends it. Same button idiom as the topic picker
            * above rather than a new control for one setting. */}
          <div className="mb-5">
            <Eyebrow className="mb-2">model</Eyebrow>
            <div className="flex flex-wrap gap-2">
              {OPENAI_MODELS.map((id) => {
                const on = model === id
                return (
                  <button
                    key={id}
                    onClick={() => {
                      setModel(id)
                      setModelState(id)
                    }}
                    disabled={llmMode() !== 'openai' || gen.busy}
                    className={`rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${
                      on ? 'border-signal/70 bg-signal/[0.07] text-bone' : 'border-bone/12 text-bone-dim hover:border-bone/35'
                    }`}
                  >
                    {id}
                  </button>
                )
              })}
            </div>
            {llmMode() !== 'openai' && (
              <p className="mt-2 font-sans text-[12px] font-light text-bone-faint">
                No OpenAI key configured, so the wording comes from the built-in composer.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Btn onClick={() => void generate()} disabled={gen.busy}>
              <Wand2 size={13} />
              {gen.busy ? 'generating…' : `generate episode · ${topic?.label ?? ''}`}
            </Btn>
          </div>
          {(gen.busy || Object.keys(gen.stages).length > 0) && (
            <div className="mt-5 space-y-1.5">
              {GEN_STAGES.map((s) => (
                <div key={s.id} className="flex items-baseline gap-3 font-mono text-[10px]">
                  <span className={`w-[190px] shrink-0 uppercase tracking-[0.14em] ${gen.stages[s.id] ? 'text-cyan' : 'text-bone-faint/50'}`}>
                    {s.label}
                  </span>
                  <span className="text-bone-dim">{gen.stages[s.id] ?? ''}</span>
                </div>
              ))}
            </div>
          )}
          {gen.error && <p className="mt-4 max-w-2xl border-l-2 border-danger/60 pl-3 font-sans text-[13px] text-danger">{gen.error}</p>}
          {result && draft && (
            <div className="glass mt-6 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="signal">{draft.code}</Chip>
                <Chip tone={result.source === 'llm' ? 'good' : 'neutral'}>
                  {result.source === 'llm' ? `script · ${llmLabel()}` : 'script · deterministic composer'}
                </Chip>
                <Chip>{draft.provenance?.difficulty} difficulty</Chip>
              </div>
              <h3 className="t-display mt-3 text-3xl text-bone">{draft.title}</h3>
              <p className="mt-1 font-sans text-[13.5px] font-light text-bone-dim">{draft.synopsis}</p>
              <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-cyan">
                mastery targets · {result.plan.targets.map((c) => conceptLabel(c)).join(' → ')}
              </p>
              {result.notes.map((n) => (
                <p key={n} className="mt-2 font-mono text-[10px] text-signal">
                  {n}
                </p>
              ))}
            </div>
          )}
        </Step>
        )}

        {/* 4 ─ review */}
        {at === 4 && (
        <Step
          n={4}
          title={STEP_TITLES[3]}
          detail="Open any scene to see its choices, consequences and citations."
          state={stepStates[3]}
        >
          {draft && report && <GraphReview episode={draft} report={report} />}
        </Step>
        )}

        {/* 5 ─ visuals */}
        {at === 5 && (
        <Step
          n={5}
          title={STEP_TITLES[4]}
          detail="Renders a background for every scene and keyframes for the clips."
          state={stepStates[4]}
        >
          <div className="mb-5">
            <StatusCard
              title="asset storage"
              value={health ? health.storage.kind : 'none'}
              detail={health ? 'Assets are saved and survive a reload.' : 'Without a server, assets vanish on reload.'}
              tone={health ? 'good' : 'neutral'}
            />
          </div>
          {draft && <VisualAssets episode={draft} onChange={setDraft} run={runs.visual} setRun={setRun.visual} />}
        </Step>
        )}

        {/* 6 ─ voice */}
        {at === 6 && (
        <Step
          n={6}
          title={STEP_TITLES[5]}
          detail="Voice every line in that character's own ElevenLabs voice."
          state={stepStates[5]}
        >
          <div className="mb-5">
            <StatusCard
              title="elevenlabs"
              value={`${voiceLabel(ttsTier())} / ${voiceLabel(sttTier())}`}
              detail={ttsTier() === 'elevenlabs' ? 'Real ElevenLabs voices for every character line.' : 'Without a key, the browser voice fills in.'}
              tone={ttsTier() === 'elevenlabs' ? 'good' : 'neutral'}
            />
          </div>
          {draft && <VoiceAssets episode={draft} onChange={setDraft} run={runs.voice} setRun={setRun.voice} />}
        </Step>
        )}

        {/* 7 ─ video */}
        {at === 7 && (
        <Step
          n={7}
          title={STEP_TITLES[6]}
          detail="Only key beats become clips and the rest stay stills."
          state={stepStates[6]}
        >
          <div className="mb-5">
            <StatusCard
              title="video generation"
              value={health?.video.configured ? `${health.video.provider} · ${health.video.model}` : pending ? 'checking…' : 'procedural previs'}
              detail={health?.video.configured ? 'Animates each keyframe into a short video clip.' : 'Without a provider, scenes get procedural previs instead of video.'}
              tone={health?.video.configured ? 'good' : 'neutral'}
            />
          </div>
          {draft && <VideoAssets episode={draft} onChange={setDraft} run={runs.video} setRun={setRun.video} />}
        </Step>
        )}

        {/* 8 ─ lens */}
        {at === 8 && (
        <Step
          n={8}
          title={STEP_TITLES[7]}
          detail="See which act three each employee profile gets from this episode."
          state={stepStates[7]}
        >
          {draft && <PlayerLensPanel episode={draft} />}
        </Step>
        )}

        {/* 9 ─ ship */}
        {at === 9 && (
        <Step
          n={9}
          title={STEP_TITLES[8]}
          detail="Preview it as an employee, then put it on the shelf."
          state={stepStates[8]}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Btn
              variant="outline"
              onClick={() => {
                publish('draft')
                play()
              }}
            >
              <Play size={12} /> preview as employee
            </Btn>
            <Btn onClick={() => publish('published')} disabled={!!published}>
              <Rocket size={13} /> {published ? 'published' : 'publish episode'}
            </Btn>
            {published && (
              <Btn variant="outline" onClick={play}>
                <Play size={12} fill="currentColor" /> play it
              </Btn>
            )}
          </div>
          {published && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-good">
              on the {group.name} shelf
            </p>
          )}

          {/* Publishing is about content and can happen many times. Finishing
            * setup is about this workspace and happens once, so it is a
            * separate action behind its own rule rather than a third button in
            * the row above. */}
          <div className="mt-8 border-t border-bone/10 pt-5">
            {state.setupDone ? (
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-good">
                setup complete · employees can start playing
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Btn onClick={() => dispatch({ type: 'FINISH_SETUP' })} disabled={!published}>
                  <Check size={13} /> finish setup
                </Btn>
                <span className="font-sans text-[12px] font-light text-bone-faint">
                  {published ? 'Marks this workspace ready.' : 'Publish an episode first.'}
                </span>
              </div>
            )}
          </div>
        </Step>
        )}

        {/* Manual navigation, because auto-advance only fires on the step that
          * just completed — the asset steps are optional and would otherwise
          * be a dead end. */}
        <div className="flex items-center justify-between gap-3 pt-8">
          <Btn variant="ghost" size="sm" onClick={() => openStep(at - 1)} disabled={at <= 1}>
            ← back
          </Btn>
          <Btn variant="ghost" size="sm" onClick={() => openStep(at + 1)} disabled={at >= lastUnlocked}>
            next →
          </Btn>
        </div>
        </div>
      </div>
    </div>
  )
}
