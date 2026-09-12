import { motion } from 'framer-motion'
import { ArrowLeft, FileText, Film, Layers, Play, Presentation, Rocket, ShieldCheck, Upload, Wand2 } from 'lucide-react'
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
import { isLive, llmLabel, llmMode } from '@/ai/llm'
import { conceptLabel } from '@/content/knowledge'
import { sourceDocs } from '@/content/sourceDocs'
import { contentStore, contentStoreLabel } from '@/data/contentStore'
import { validateEpisode } from '@/engine/validateEpisode'
import { useGame } from '@/engine/gameStore'
import { ParseError, parseFile, SUPPORTED_EXTENSIONS } from '@/ingest/parse'
import { probeMediaServer } from '@/media/mediaStatus'
import { storeSourceDoc } from '@/media/storage'
import { useMediaStatus } from '@/media/useMediaStatus'
import { sttTier, ttsTier, voiceLabel } from '@/voice/voice'
import type { Episode, KnowledgeItem, SourceDoc } from '@/types'
import { VideoAssets, VisualAssets, VoiceAssets } from '../studio/AssetStudio'
import { GraphReview } from '../studio/GraphReview'
import { PlayerLensPanel } from '../studio/PlayerLensPanel'
import { Pipeline, StatusCard, Step, type StepState } from '../studio/StudioBits'
import { Btn, Chip, Eyebrow, Rule } from '../ui/Bits'

/* ============================================================================
 * STUDIO — the authoring workspace.
 *
 *   1 company knowledge   2 topic   3 generate   4 review graph
 *   5 visual assets       6 voice   7 player lens   8 preview + publish
 *
 * Everything on this screen runs before anyone plays. The employee-facing game
 * plays the finished, validated graph and never calls any of this at runtime.
 * ========================================================================== */

const DOC_ICON = {
  pdf: FileText,
  slides: Presentation,
  video: Film,
  handbook: Layers,
  policy: ShieldCheck,
} as const

export function Authoring() {
  const { state, dispatch, group } = useGame()
  const { health, pending } = useMediaStatus()
  const fileInput = useRef<HTMLInputElement>(null)

  /* 1 — knowledge */
  const [uploads, setUploads] = useState<SourceDoc[]>([])
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<{ doc?: string; id?: PipelineStage }>({})
  const [extracted, setExtracted] = useState<KnowledgeItem[]>([])
  const [yieldByDoc, setYieldByDoc] = useState<Record<string, number>>({})
  const [ran, setRan] = useState(false)

  /* 2..8 — episode */
  const [topic, setTopic] = useState<TopicDef | null>(null)
  const [custom, setCustom] = useState('')
  const [gen, setGen] = useState<{ busy: boolean; stages: Partial<Record<GenStage, string>>; error?: string }>({ busy: false, stages: {} })
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [draft, setDraft] = useState<Episode | null>(null)
  const [published, setPublished] = useState<string | null>(null)

  const docs = [...sourceDocs, ...uploads]
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
          setRan(true)
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
    setYieldByDoc({})
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
    setRan(true)
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

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-6 pb-32 pt-36 sm:px-10">
        <button
          onClick={() => dispatch({ type: 'GOTO', view: 'home' })}
          className="mb-12 font-sans text-[13px] text-bone-dim transition-colors hover:text-bone"
        >
          ← Episodes
        </button>

        <Eyebrow className="text-signal">studio · ai authoring</Eyebrow>
        <h1 className="t-display mt-3 text-[clamp(2.2rem,7vw,4.4rem)] text-bone">
          BORING MATERIAL
          <br />
          IN. EPISODE OUT.
        </h1>
        <p className="mt-5 max-w-2xl font-sans text-[15px] font-light leading-relaxed text-bone-dim">
          AI generates and personalises the content here, once. The employee plays a finished, validated graph through a
          deterministic engine — no employee waits on a model, and no model can invent a branch.
        </p>

        <div className="mt-10">
          <Rule label="architecture" />
          <div className="mt-6 overflow-x-auto pb-2">
            <Pipeline />
          </div>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatusCard
            title="language model"
            value={llmLabel()}
            detail={
              llmMode() === 'offline'
                ? 'No key. Extraction replays known docs, scripts come from the deterministic composer, chat uses the grounded composer. All labelled.'
                : 'Live extraction, episode scripts, character chat and coaching.'
            }
            tone={llmMode() === 'offline' ? 'neutral' : 'good'}
          />
          <StatusCard
            title="elevenlabs"
            value={`${voiceLabel(ttsTier())} / ${voiceLabel(sttTier())}`}
            detail="Character voices and dialogue audio only — not video. Without a key the browser voice stands in and says so."
            tone={ttsTier() === 'elevenlabs' ? 'good' : 'neutral'}
          />
          <StatusCard
            title="video generation"
            value={health?.video.configured ? `${health.video.provider} · ${health.video.model}` : pending ? 'checking…' : 'procedural previs'}
            detail={
              health?.video.configured
                ? 'Image-to-video: each major scene’s keyframe animated into a ~5 s clip through requestClip() at authoring time, then stored. The player only loads files.'
                : 'No video provider configured. requestClip() resolves to procedural previs, labelled as not AI-generated.'
            }
            tone={health?.video.configured ? 'good' : 'neutral'}
          />
          <StatusCard
            title="asset storage"
            value={health ? `${health.storage.kind}` : 'none'}
            detail={
              health
                ? `Object-store layout: ${health.storage.layout}.`
                : 'No media server running — generated assets live in this session only.'
            }
            tone={health ? 'good' : 'neutral'}
          />
          <StatusCard
            title="knowledge persistence"
            value={contentStoreLabel()}
            detail={
              contentStore().kind === 'db'
                ? 'Uploads and extracted rules survive a reload — stored in the media server’s local database.'
                : 'No media server running — uploads and extraction live in this session only, and are lost on reload.'
            }
            tone={contentStore().kind === 'db' ? 'good' : 'neutral'}
          />
        </div>

        {/* 1 ─ knowledge */}
        <Step
          n={1}
          title="COMPANY KNOWLEDGE"
          detail="Handbooks, policy documents and training transcripts. The knowledge agent turns them into atomic, citable rules — and rejects anything it cannot cite."
          state={step(false, extracted.length > 0 && !running)}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            {docs.map((d) => {
              const Icon = DOC_ICON[d.type]
              const active = stage.doc === d.name
              const got = yieldByDoc[d.id] ?? 0
              return (
                <div key={d.id} className={`glass p-4 transition-all duration-500 ${active ? 'border-signal/50' : got ? 'border-good/30' : ''}`}>
                  <div className="flex items-center gap-3">
                    <Icon size={15} className={active ? 'text-signal' : got ? 'text-good' : 'text-bone-faint'} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-bone">{d.name}</span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
                      {d.type === 'video' ? 'transcript' : `${d.pages}pp`}
                    </span>
                  </div>
                  <p className="mt-2.5 line-clamp-3 font-sans text-[11.5px] font-light italic leading-relaxed text-bone-faint">{d.excerpt}</p>
                  {active && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {STAGES.map((s) => (
                        <span
                          key={s.id}
                          className={`font-mono text-[8px] uppercase tracking-[0.14em] ${stage.id === s.id ? 'text-signal' : 'text-bone-faint/50'}`}
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {ran && !active && (
                    <div className="mt-3">
                      {got ? (
                        <Chip tone="good">{got} rules extracted</Chip>
                      ) : (
                        <Chip tone="signal">{isLive() ? 'no citable rules found' : '0 rules — new material needs a language model'}</Chip>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Btn onClick={() => void runAgent()} disabled={running}>
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

        {/* 2 ─ topic */}
        <Step
          n={2}
          title="PICK A TOPIC"
          detail="Coverage is counted against the knowledge extracted above. A topic the material does not cover is refused, not improvised."
          state={step(!extracted.length || running, !!topic)}
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

        {/* 3 ─ generate */}
        <Step
          n={3}
          title="GENERATE THE EPISODE"
          detail="Code builds the structure — scenes, transitions, which option is strong, citations, the adaptive act. A model, when configured, writes the words. Then the graph is validated with the same rules the engine enforces."
          state={step(!topic || running, !!draft)}
        >
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

        {/* 4 ─ review */}
        <Step
          n={4}
          title="REVIEW THE GRAPH"
          detail="Acts, scenes, choices, consequences, citations, shot specs and assets. Open any scene."
          state={step(!draft, !!report?.ok)}
        >
          {draft && report && <GraphReview episode={draft} report={report} />}
        </Step>

        {/* 5 ─ visuals */}
        <Step
          n={5}
          title="GENERATE VISUAL ASSETS"
          detail="Dialogue scenes get a generated background with character sprites over it; each major beat gets a keyframe for its clip. Rendered once, here."
          state={step(!draft, hasImages)}
        >
          {draft && <VisualAssets episode={draft} onChange={setDraft} />}
        </Step>

        {/* 6 ─ voice */}
        <Step
          n={6}
          title="GENERATE VOICES"
          detail="Every character line, in that character's ElevenLabs voice."
          state={step(!draft, hasVoice)}
        >
          {draft && <VoiceAssets episode={draft} onChange={setDraft} />}
        </Step>

        {/* 7 ─ video */}
        <Step
          n={7}
          title="GENERATE CINEMATIC VIDEO"
          detail="Four short clips — cold open, confrontation, incident, ending — each animated from its keyframe. Everything else stays background, sprite and voice."
          state={step(!draft, hasClips)}
        >
          {draft && <VideoAssets episode={draft} onChange={setDraft} />}
        </Step>

        {/* 8 ─ lens */}
        <Step
          n={8}
          title="TWO EMPLOYEES, ONE EPISODE"
          detail="Act three is selected by the mastery model at play time. Here is what two different employees get from this exact graph."
          state={step(!draft, !!draft)}
        >
          {draft && <PlayerLensPanel episode={draft} />}
        </Step>

        {/* 9 ─ ship */}
        <Step
          n={9}
          title="PREVIEW AND PUBLISH"
          detail="Publishing hands the graph to the reducer, which re-validates it and refuses anything that fails."
          state={step(!report?.ok, !!published)}
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
              on the {group.name} shelf · every employee who opens it gets their own act three
            </p>
          )}
        </Step>
      </div>
    </div>
  )
}
