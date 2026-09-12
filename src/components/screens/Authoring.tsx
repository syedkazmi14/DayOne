import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Clapperboard, FileText, Film, Layers, Play, Presentation, ShieldCheck, Sparkles, Upload, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { runKnowledgeAgent, STAGES, type PipelineStage } from '@/ai/knowledgeAgent'
import { generateScenario, requestClip, VIDEO_PIPELINE_STAGES, type ScenarioDraft } from '@/ai/scenarioGenerator'
import { llmLabel, llmMode } from '@/ai/llm'
import { ttsTier, sttTier, voiceLabel } from '@/voice/voice'
import { firstDay } from '@/content/episodes'
import { sourceDocs } from '@/content/sourceDocs'
import type { KnowledgeItem, SourceDoc } from '@/types'
import { useGame } from '@/engine/gameStore'
import { Btn, Chip, Eyebrow, Rule } from '../ui/Bits'

/* ============================================================================
 * STUDIO — the authoring half, which is where the AI actually lives.
 *
 * Company material in, structured knowledge out, scenarios generated from that
 * knowledge, video prompts emitted for pre-rendering. The player-facing game
 * consumes the result and never calls any of this at runtime.
 * ========================================================================== */

const DOC_ICON: Record<SourceDoc['type'], typeof FileText> = {
  pdf: FileText,
  policy: ShieldCheck,
  handbook: Layers,
  slides: Presentation,
  video: Film,
}

export function Authoring() {
  const { dispatch } = useGame()
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
    for await (const ev of runKnowledgeAgent(sourceDocs, { speed: 1.6 })) {
      if (ev.type === 'stage') setStage({ doc: ev.doc?.name, id: ev.stage })
      if (ev.type === 'item' && ev.item) setExtracted((prev) => (prev.some((k) => k.id === ev.item!.id) ? prev : [...prev, ev.item!]))
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

  const pool = extracted.length ? extracted : []

  return (
    <div className="relative h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 pb-36 pt-24 sm:px-10">
        <button
          onClick={() => dispatch({ type: 'GOTO', view: 'home' })}
          className="mb-8 flex items-center gap-2 font-mono text-[10px] uppercase tracking-ultra text-bone-dim transition-colors hover:text-bone"
        >
          <ArrowLeft size={13} /> episodes
        </button>

        <Eyebrow className="text-signal">studio · content ingestion</Eyebrow>
        <h1 className="t-display mt-3 text-[clamp(2.2rem,7vw,4.4rem)] text-bone">
          BORING MATERIAL
          <br />
          IN. EPISODE OUT.
        </h1>
        <p className="mt-5 max-w-2xl font-sans text-[15px] font-light leading-relaxed text-bone-dim">
          Everything on this screen runs at authoring time. The employee-facing game plays a finished graph, so no
          employee ever waits on a model, and no model can invent a branch that does not exist.
        </p>

        {/* architecture */}
        <div className="mt-10">
          <Rule label="architecture" />
          <div className="mt-6 overflow-x-auto pb-2">
            <Pipeline />
          </div>
        </div>

        {/* integration status */}
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          <StatusCard
            title="language model"
            value={llmLabel()}
            detail={
              llmMode() === 'offline'
                ? 'No key configured. Character replies and coaching run on the deterministic grounded composer — same retrieval, same citations, no network.'
                : 'Live completions for character chat, coaching, knowledge extraction and scenario generation.'
            }
            tone={llmMode() === 'offline' ? 'neutral' : 'good'}
          />
          <StatusCard
            title="elevenlabs"
            value={`${voiceLabel(ttsTier())} / ${voiceLabel(sttTier())}`}
            detail="TTS and STT sit behind one boundary (src/voice/voice.ts). With a key, character replies are spoken by the assigned voice id. Without one, the browser engine stands in and the UI says so."
            tone={ttsTier() === 'elevenlabs' ? 'good' : 'neutral'}
          />
          <StatusCard
            title="video generation"
            value="AUTHORING STUB"
            detail="Every scene carries a shot prompt. requestClip() is where a text-to-video API would be called ahead of time, writing back to Scene.shot.videoUrl. Until then the procedural previs renders the shot."
            tone="neutral"
          />
        </div>

        {/* corpus */}
        <div className="mt-12">
          <Rule label="company material" />
          <div className="mt-6 grid gap-3 lg:grid-cols-2">
            {sourceDocs.map((d) => {
              const Icon = DOC_ICON[d.type]
              const active = stage.doc === d.name
              const done = d.yields.every((y) => extracted.some((k) => k.id === y))
              return (
                <div
                  key={d.id}
                  className={`glass p-4 transition-all duration-500 ${active ? 'border-signal/50' : done ? 'border-good/30' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={15} className={active ? 'text-signal' : done ? 'text-good' : 'text-bone-faint'} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-bone">{d.name}</span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
                      {d.type === 'video' ? '31:40' : `${d.pages}pp`}
                    </span>
                  </div>
                  <p className="mt-2.5 line-clamp-3 font-sans text-[11.5px] font-light italic leading-relaxed text-bone-faint">
                    {d.excerpt}
                  </p>
                  {active && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {STAGES.map((s) => (
                        <span
                          key={s.id}
                          className={`font-mono text-[8px] uppercase tracking-[0.14em] ${
                            stage.id === s.id ? 'text-signal' : 'text-bone-faint/50'
                          }`}
                        >
                          {s.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {done && !active && (
                    <div className="mt-3">
                      <Chip tone="good">{d.yields.length} rules extracted</Chip>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Btn onClick={() => void run()} disabled={running}>
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
            <span className="inline-flex items-center gap-2 border border-dashed border-bone/20 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.16em] text-bone-faint">
              <Upload size={12} /> upload — needs a storage + parse endpoint
            </span>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
              {extracted.length} / 14 knowledge items
            </span>
          </div>
        </div>

        {/* extracted knowledge */}
        <AnimatePresence>
          {pool.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-12">
              <Rule label="structured knowledge" />
              <div className="mt-6 grid gap-2 lg:grid-cols-2">
                {pool.map((k, i) => (
                  <motion.button
                    key={k.id}
                    initial={{ opacity: 0, y: 14, filter: 'blur(4px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    transition={{ duration: 0.45, delay: Math.min(i * 0.03, 0.4) }}
                    onClick={() => void makeScenario(k)}
                    className={`glass p-4 text-left transition-all duration-300 hover:border-signal/50 ${
                      selected?.id === k.id ? 'border-signal/60' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[9px] tracking-[0.14em] text-signal">{k.id}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] uppercase tracking-[0.1em] text-bone-dim">
                        {k.topic}
                      </span>
                      <Chip tone={k.severity === 'critical' ? 'danger' : k.severity === 'high' ? 'signal' : 'neutral'}>
                        {k.severity}
                      </Chip>
                    </div>
                    <p className="mt-2 font-sans text-[13px] font-light leading-snug text-bone">{k.rule}</p>
                    <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-bone-faint">
                      {k.source.doc} § {k.source.section}
                    </p>
                  </motion.button>
                ))}
              </div>
              <p className="mt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
                click any rule to generate a playable scene from it
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* scenario generator output */}
        <AnimatePresence>
          {(drafting || draft) && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mt-12">
              <Rule label="generated scenario" />
              {drafting && (
                <div className="mt-6 flex items-center gap-3">
                  <motion.span animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}>
                    <Sparkles size={14} className="text-cyan" />
                  </motion.span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan">
                    scenario generator · {selected?.id}
                  </span>
                </div>
              )}
              {draft && (
                <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
                  <div className="glass p-6">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Chip tone="cyan">{draft.knowledgeId}</Chip>
                      <Chip tone="neutral">{draft.source === 'llm' ? llmLabel() : 'deterministic derivation'}</Chip>
                    </div>
                    <Eyebrow className="mb-2">situation</Eyebrow>
                    <p className="font-sans text-[14px] font-light leading-relaxed text-bone">{draft.situation}</p>

                    <Eyebrow className="mb-2 mt-6">setup dialogue</Eyebrow>
                    <div className="space-y-2">
                      {draft.setup.map((s, i) => (
                        <div key={i}>
                          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-signal">{s.speaker}</span>
                          <p className="font-sans text-[13.5px] font-light leading-snug text-bone-dim">{s.line}</p>
                        </div>
                      ))}
                    </div>

                    <Eyebrow className="mb-2 mt-6">{draft.prompt}</Eyebrow>
                    <div className="space-y-2">
                      {draft.choices.map((c, i) => (
                        <div key={i} className="border border-bone/12 p-3">
                          <div className="flex items-start gap-3">
                            <span className="font-mono text-[11px] text-bone-dim">{'ABC'[i]}</span>
                            <span className="flex-1 font-sans text-[13.5px] font-light leading-snug text-bone">{c.text}</span>
                            <Chip tone={c.quality === 'best' ? 'good' : c.quality === 'acceptable' ? 'signal' : 'danger'}>
                              {c.quality}
                            </Chip>
                          </div>
                          <p className="mt-2 border-l border-bone/10 pl-3 font-sans text-[12px] font-light leading-relaxed text-bone-faint">
                            <span className="text-bone-dim">consequence:</span> {c.consequence}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="glass p-5">
                      <div className="mb-3 flex items-center gap-2">
                        <Clapperboard size={14} className="text-signal" />
                        <Eyebrow className="text-signal">video generation prompts</Eyebrow>
                      </div>
                      <div className="space-y-3">
                        {draft.shots.map((s, i) => (
                          <div key={i}>
                            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bone-faint">
                              shot {i + 1}
                            </span>
                            <p className="font-sans text-[12px] font-light leading-relaxed text-bone-dim">{s}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {VIDEO_PIPELINE_STAGES.map((s) => (
                          <span key={s} className="font-mono text-[8px] uppercase tracking-[0.14em] text-bone-faint">
                            {s}
                          </span>
                        ))}
                      </div>
                      <Btn
                        variant="outline"
                        className="mt-4 w-full"
                        onClick={() =>
                          void requestClip(firstDay.scenes.d1_email.shot).then((r) => setClipNote(r.note))
                        }
                      >
                        queue render
                      </Btn>
                      {clipNote && (
                        <p className="mt-3 font-mono text-[9.5px] leading-relaxed text-bone-faint">{clipNote}</p>
                      )}
                    </div>

                    <div className="glass mt-3 p-5">
                      <Eyebrow className="mb-2">why this is not a quiz</Eyebrow>
                      <p className="font-sans text-[12.5px] font-light leading-relaxed text-bone-dim">
                        The generator is told that the wrong answer must be the most helpful one in the short term, and
                        that no option may be identifiable as correct from its wording. Recall questions are cheap to
                        generate and teach nothing — application under social pressure is the whole product.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function StatusCard({
  title,
  value,
  detail,
  tone,
}: {
  title: string
  value: string
  detail: string
  tone: 'good' | 'neutral'
}) {
  return (
    <div className="glass p-5">
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <div className={`font-mono text-[12px] uppercase tracking-[0.14em] ${tone === 'good' ? 'text-good' : 'text-signal'}`}>
        {value}
      </div>
      <p className="mt-2.5 font-sans text-[12px] font-light leading-relaxed text-bone-faint">{detail}</p>
    </div>
  )
}

const NODES = [
  { label: 'COMPANY CONTENT', kind: 'io' },
  { label: 'KNOWLEDGE AGENT', kind: 'ai' },
  { label: 'SCENARIO GENERATOR', kind: 'ai' },
  { label: 'EPISODE GRAPH', kind: 'data' },
  { label: 'DETERMINISTIC GAME', kind: 'engine' },
] as const

function Pipeline() {
  const colors: Record<string, string> = {
    io: 'rgba(237,233,226,.35)',
    ai: '#6FD3D8',
    data: '#F5A524',
    engine: '#54D1A0',
  }
  return (
    <div className="min-w-[760px]">
      <div className="flex items-center gap-2">
        {NODES.map((n, i) => (
          <div key={n.label} className="flex items-center gap-2">
            <div
              className="border px-3.5 py-2.5 font-mono text-[9.5px] uppercase tracking-[0.16em]"
              style={{ borderColor: `${colors[n.kind]}55`, color: colors[n.kind] }}
            >
              {n.label}
              <div className="mt-0.5 text-[7.5px] tracking-[0.12em] text-bone-faint">
                {n.kind === 'ai' ? 'llm · authoring time' : n.kind === 'engine' ? 'reducer · no llm' : n.kind === 'data' ? 'json' : 'pdf · video · slides'}
              </div>
            </div>
            {i < NODES.length - 1 && <span className="block h-px w-6 bg-bone/20" />}
          </div>
        ))}
      </div>

      <div className="ml-[68%] mt-3 flex items-start gap-6">
        <div className="flex flex-col items-center">
          <span className="block h-4 w-px bg-bone/20" />
          <div className="border border-bone/20 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-bone-dim">
            player choice
            <div className="mt-0.5 text-[7.5px] text-bone-faint">deterministic branch</div>
          </div>
        </div>
        <div className="flex flex-col items-center">
          <span className="block h-4 w-px bg-cyan/40" />
          <div className="border border-cyan/40 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-cyan">
            character chat
            <div className="mt-0.5 text-[7.5px] text-bone-faint">llm + rag · runtime</div>
          </div>
          <span className="block h-4 w-px bg-cyan/40" />
          <div className="border border-cyan/40 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-cyan">
            elevenlabs
          </div>
        </div>
      </div>
    </div>
  )
}
