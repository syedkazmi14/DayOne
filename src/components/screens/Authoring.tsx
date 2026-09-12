import { motion, AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'
import { runKnowledgeAgent, STAGES, type PipelineStage } from '@/ai/knowledgeAgent'
import { generateScenario, requestClip, VIDEO_PIPELINE_STAGES, type ScenarioDraft } from '@/ai/scenarioGenerator'
import { llmLabel, llmMode } from '@/ai/llm'
import { ttsTier, sttTier, voiceLabel } from '@/voice/voice'
import { firstDay } from '@/content/episodes'
import { groupCast } from '@/content/characterGroups'
import { concepts } from '@/content/knowledge'
import { sourceDocs } from '@/content/sourceDocs'
import { parseFile, ParseError, SUPPORTED_EXTENSIONS } from '@/ingest/parse'
import type { KnowledgeItem, SourceDoc } from '@/types'
import { useGame } from '@/engine/gameStore'

/* ============================================================================
 * STUDIO — the authoring workspace.
 *
 * Company material in, episode out. Everything on this screen runs at authoring
 * time; the employee-facing game plays a finished graph, so no employee ever
 * waits on a model and no model can invent a branch that does not exist.
 *
 * That boundary is a real constraint, not a talking point, so it lives in
 * Advanced alongside the provider tiers rather than on the front of the screen.
 * ========================================================================== */

const LENGTHS = ['4–6 minutes', '6–8 minutes', '8–10 minutes']

/** The six pipeline stages, told as the three things an author is waiting for. */
const PROGRESS_STEPS: { label: string; stages: PipelineStage[] }[] = [
  { label: 'Reading source material', stages: ['parse', 'segment'] },
  { label: 'Building scenarios', stages: ['extract', 'normalise'] },
  { label: 'Creating decision paths', stages: ['link', 'validate'] },
]

const docMeta = (d: SourceDoc) =>
  d.type === 'video' ? '31 min' : d.type === 'slides' ? `${d.pages} slides` : `${d.pages} pages`

export function Authoring() {
  const { dispatch, group } = useGame()
  const [docs, setDocs] = useState<SourceDoc[]>(sourceDocs)
  const [openDoc, setOpenDoc] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState('')
  const [focus, setFocus] = useState(concepts[0].id as string)
  const [length, setLength] = useState(LENGTHS[1])
  const cast = groupCast(group)
  const [castIds, setCastIds] = useState<string[]>(() => cast.map((c) => c.id))

  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState<{ doc?: string; id?: PipelineStage }>({})
  const [extracted, setExtracted] = useState<KnowledgeItem[]>([])
  const [selected, setSelected] = useState<KnowledgeItem | null>(null)
  const [draft, setDraft] = useState<ScenarioDraft | null>(null)
  const [drafting, setDrafting] = useState(false)
  const [clipNote, setClipNote] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setExtracted([])
    setDraft(null)
    setSelected(null)
    for await (const ev of runKnowledgeAgent(docs, { speed: 1.6 })) {
      if (ev.type === 'stage') setStage({ doc: ev.doc?.name, id: ev.stage })
      if (ev.type === 'item' && ev.item)
        setExtracted((prev) => (prev.some((k) => k.id === ev.item!.id) ? prev : [...prev, ev.item!]))
    }
    setStage({})
    setRunning(false)
  }

  async function makeScenario(k: KnowledgeItem) {
    setSelected(k)
    setDrafting(true)
    setDraft(null)
    const d = await generateScenario(k)
    setDraft(d)
    setDrafting(false)
  }

  /** Only the text formats parse.ts understands; anything else says so. */
  async function addFiles(files: FileList) {
    setAddError(null)
    for (const file of Array.from(files)) {
      try {
        const doc = await parseFile(file)
        setDocs((prev) => [...prev, doc])
      } catch (e) {
        setAddError(e instanceof ParseError ? e.message : `Could not read “${file.name}”.`)
      }
    }
  }

  const activeStepIndex = PROGRESS_STEPS.findIndex((s) => stage.id && s.stages.includes(stage.id))

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] px-6 pb-32 pt-36 sm:px-10">
        <button
          onClick={() => dispatch({ type: 'GOTO', view: 'home' })}
          className="mb-12 font-sans text-[13px] text-bone-dim transition-colors hover:text-bone"
        >
          ← Episodes
        </button>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="font-sans text-[34px] font-semibold tracking-[-0.02em] text-bone">Create an episode</h1>
          <p className="mt-3 max-w-xl font-sans text-[15px] font-light leading-relaxed text-bone-dim">
            Turn company policies, documents, and training material into an interactive DayOne episode.
          </p>
        </motion.div>

        {/* ---------------------------------------------------- source material */}
        <section className="mt-20">
          <h2 className="t-section">Source material</h2>
          <p className="mt-2 max-w-xl font-sans text-[14px] font-light leading-relaxed text-bone-dim">
            Add the policies, guides, presentations, or videos this episode should teach.
          </p>

          <div className="mt-8">
            {docs.map((d) => {
              const open = openDoc === d.id
              return (
                <div key={d.id} className="border-b border-bone/8">
                  <div className="flex items-center gap-4 py-3.5">
                    <button
                      onClick={() => setOpenDoc(open ? null : d.id)}
                      className="min-w-0 flex-1 text-left font-sans text-[14px] text-bone transition-colors hover:text-signal"
                    >
                      <span className="block truncate">{d.name}</span>
                    </button>
                    <span className="shrink-0 font-sans text-[13px] tabular-nums text-bone-faint">{docMeta(d)}</span>
                    <button
                      onClick={() => setDocs((prev) => prev.filter((x) => x.id !== d.id))}
                      aria-label={`Remove ${d.name}`}
                      className="shrink-0 px-1 font-sans text-[15px] leading-none text-bone-faint transition-colors hover:text-bone"
                    >
                      ×
                    </button>
                  </div>
                  <AnimatePresence>
                    {open && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden pb-4 font-sans text-[13px] font-light leading-relaxed text-bone-faint"
                      >
                        {d.excerpt}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>

          <input
            ref={fileInput}
            type="file"
            multiple
            accept={SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(',')}
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="mt-6 border border-bone/15 px-5 py-2.5 font-sans text-[13.5px] text-bone-dim transition-colors hover:border-bone/35 hover:text-bone"
          >
            Add material
          </button>
          {addError && <p className="mt-3 font-sans text-[13px] text-danger">{addError}</p>}
        </section>

        {/* ------------------------------------------------------ episode setup */}
        <section className="mt-20">
          <h2 className="t-section">Episode setup</h2>
          <div className="mt-8 grid gap-x-16 gap-y-10 sm:grid-cols-2">
            <Field label="Episode title">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="First Day"
                className="w-full max-w-[320px] border-b border-bone/15 bg-transparent pb-2 font-sans text-[15px] text-bone outline-none transition-colors placeholder:text-bone-faint focus:border-signal"
              />
            </Field>
            <Field label="Focus">
              <select
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                className="w-full max-w-[320px] border-b border-bone/15 bg-transparent pb-2 font-sans text-[15px] text-bone outline-none transition-colors focus:border-signal"
              >
                {concepts.map((c) => (
                  <option key={c.id} value={c.id} className="bg-ink-800">
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Length">
              <select
                value={length}
                onChange={(e) => setLength(e.target.value)}
                className="w-full max-w-[320px] border-b border-bone/15 bg-transparent pb-2 font-sans text-[15px] text-bone outline-none transition-colors focus:border-signal"
              >
                {LENGTHS.map((l) => (
                  <option key={l} value={l} className="bg-ink-800">
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Characters">
              <div className="flex flex-wrap gap-2">
                {cast.map((c) => {
                  const on = castIds.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      aria-pressed={on}
                      onClick={() =>
                        setCastIds((prev) => (on ? prev.filter((x) => x !== c.id) : [...prev, c.id]))
                      }
                      className={`border px-3 py-1.5 font-sans text-[13px] transition-colors ${
                        on ? 'border-bone/25 bg-bone/5 text-bone' : 'border-bone/10 text-bone-faint hover:text-bone-dim'
                      }`}
                    >
                      {c.name.split(' ')[0].charAt(0) + c.name.split(' ')[0].slice(1).toLowerCase()}
                    </button>
                  )
                })}
              </div>
            </Field>
          </div>
        </section>

        {/* ----------------------------------------------------------- generate */}
        <section className="mt-20">
          <button
            onClick={() => void run()}
            disabled={running || docs.length === 0}
            className="bg-signal px-7 py-3.5 font-sans text-[14px] font-medium text-ink-900 transition-colors duration-200 hover:bg-signal-hot disabled:pointer-events-none disabled:opacity-35"
          >
            {running ? 'Generating…' : 'Generate episode'}
          </button>
          <p className="mt-3 font-sans text-[13px] text-bone-faint">
            DayOne will build scenarios and decisions using the selected material.
          </p>

          <AnimatePresence>
            {running && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-8">
                <p className="font-sans text-[14px] text-bone">Preparing episode…</p>
                <div className="mt-3 space-y-1.5">
                  {PROGRESS_STEPS.map((s, i) => (
                    <p
                      key={s.label}
                      className={`font-sans text-[13.5px] transition-colors ${
                        i <= activeStepIndex ? 'text-bone-dim' : 'text-bone-faint'
                      }`}
                    >
                      {s.label}
                    </p>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* ------------------------------------------------- extracted teaching */}
        <AnimatePresence>
          {extracted.length > 0 && (
            <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-20">
              <h2 className="t-section">What this episode will teach</h2>
              <p className="mt-2 max-w-xl font-sans text-[14px] font-light leading-relaxed text-bone-dim">
                Select a rule to preview the scene built from it.
              </p>
              <div className="mt-8">
                {extracted.map((k) => (
                  <button
                    key={k.id}
                    onClick={() => void makeScenario(k)}
                    className={`block w-full border-b border-bone/8 py-4 text-left transition-colors ${
                      selected?.id === k.id ? 'text-bone' : 'text-bone-dim hover:text-bone'
                    }`}
                  >
                    <span className="block max-w-3xl font-sans text-[14.5px] font-light leading-snug">{k.rule}</span>
                    <span className="mt-1.5 block font-sans text-[12.5px] text-bone-faint">
                      {k.topic} · {k.source.doc}
                    </span>
                  </button>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* ---------------------------------------------------- scenario preview */}
        <AnimatePresence>
          {(drafting || draft) && (
            <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-20">
              <h2 className="t-section">Scene preview</h2>
              {drafting && <p className="mt-6 font-sans text-[14px] text-bone-dim">Writing the scene…</p>}
              {draft && (
                <div className="mt-8 max-w-3xl">
                  <p className="font-sans text-[15px] font-light leading-relaxed text-bone">{draft.situation}</p>

                  <div className="mt-8 space-y-4">
                    {draft.setup.map((s, i) => (
                      <div key={i}>
                        <span className="font-sans text-[12.5px] text-bone-faint">
                          {s.speaker.charAt(0) + s.speaker.slice(1).toLowerCase()}
                        </span>
                        <p className="font-sans text-[14.5px] font-light leading-snug text-bone-dim">{s.line}</p>
                      </div>
                    ))}
                  </div>

                  <p className="mt-10 font-sans text-[15px] font-medium text-bone">{draft.prompt}</p>
                  <div className="mt-4">
                    {draft.choices.map((c, i) => (
                      <div key={i} className="border-b border-bone/8 py-4">
                        <div className="flex items-baseline justify-between gap-6">
                          <span className="font-sans text-[14.5px] font-light leading-snug text-bone">{c.text}</span>
                          <span className="shrink-0 font-sans text-[12.5px] text-bone-faint">
                            {c.quality === 'best' ? 'Best' : c.quality === 'acceptable' ? 'Acceptable' : 'Poor'}
                          </span>
                        </div>
                        <p className="mt-2 font-sans text-[13px] font-light leading-relaxed text-bone-faint">
                          {c.consequence}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>

        {/* ----------------------------------------------------------- advanced */}
        <details className="group mt-24 border-t border-bone/8 pt-8">
          <summary className="cursor-pointer list-none font-sans text-[14px] font-medium text-bone-dim transition-colors marker:content-none hover:text-bone">
            Advanced
          </summary>

          <div className="mt-8 max-w-3xl space-y-8">
            <div>
              <h3 className="font-sans text-[13.5px] font-medium text-bone">Providers</h3>
              <dl className="mt-3 space-y-2">
                {[
                  ['Language model', llmLabel(), llmMode() === 'offline' ? 'No key configured — replies run on the deterministic grounded composer.' : 'Live completions for chat, coaching, extraction and generation.'],
                  ['Voice', `${voiceLabel(ttsTier())} / ${voiceLabel(sttTier())}`, 'TTS and STT sit behind one boundary in src/voice/voice.ts.'],
                  ['Video', 'Authoring stub', 'requestClip() is where a text-to-video call would write back to Scene.shot.videoUrl.'],
                ].map(([label, value, detail]) => (
                  <div key={label} className="flex flex-wrap items-baseline gap-x-3">
                    <dt className="font-sans text-[13px] text-bone-dim">{label}</dt>
                    <dd className="font-mono text-[12px] text-bone">{value}</dd>
                    <dd className="w-full font-sans text-[12.5px] font-light text-bone-faint">{detail}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <h3 className="font-sans text-[13.5px] font-medium text-bone">Pipeline stages</h3>
              <p className="mt-2 font-mono text-[12px] leading-relaxed text-bone-faint">
                {STAGES.map((s) => s.label.toLowerCase()).join(' · ')}
              </p>
            </div>

            {draft && (
              <div>
                <h3 className="font-sans text-[13.5px] font-medium text-bone">Video generation</h3>
                <p className="mt-2 font-mono text-[12px] text-bone-faint">
                  {VIDEO_PIPELINE_STAGES.join(' · ')}
                </p>
                <div className="mt-3 space-y-2">
                  {draft.shots.map((s, i) => (
                    <p key={i} className="font-sans text-[12.5px] font-light leading-relaxed text-bone-faint">
                      {s}
                    </p>
                  ))}
                </div>
                <button
                  onClick={() => void requestClip(firstDay.scenes.d1_email.shot).then((r) => setClipNote(r.note))}
                  className="mt-4 border border-bone/15 px-4 py-2 font-sans text-[13px] text-bone-dim transition-colors hover:border-bone/35 hover:text-bone"
                >
                  Queue render
                </button>
                {clipNote && <p className="mt-3 font-mono text-[12px] leading-relaxed text-bone-faint">{clipNote}</p>}
              </div>
            )}

            <div>
              <h3 className="font-sans text-[13.5px] font-medium text-bone">Why this is not a quiz</h3>
              <p className="mt-2 font-sans text-[13px] font-light leading-relaxed text-bone-faint">
                The generator is told that the wrong answer must be the most helpful one in the short term, and that no
                option may be identifiable as correct from its wording. Recall questions are cheap to generate and teach
                nothing — application under social pressure is the whole product.
              </p>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-3 block font-sans text-[13px] text-bone-dim">{label}</span>
      {children}
    </label>
  )
}
