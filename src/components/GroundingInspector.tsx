import { MessageCircle, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { CharacterReply, RefusalReason } from '@/ai/characterAgent'
import { llmLabel } from '@/ai/llm'
import type { KnowledgeItem } from '@/types'

/* ============================================================================
 * INSPECT AI — why the character was allowed to say what it said.
 *
 * Grounding status and refusal class, confidence against the floor, every
 * retrieved chunk with its relevance and matched terms, which rules the reply
 * actually used, and the exact system prompt. "Grounded" is shown, not claimed.
 * ========================================================================== */

const REASON: Record<RefusalReason, string> = {
  no_match: 'no match',
  out_of_scope: 'out of scope',
  weak_evidence: 'weak evidence',
}

export function GroundingInspector({
  reply,
  resolveKnowledge,
}: {
  reply: CharacterReply | null
  resolveKnowledge: (id: string) => KnowledgeItem | undefined
}) {
  const g = reply?.grounding
  const hits = reply?.retrieved.hits ?? []

  return (
    <div className="space-y-5">
      {/* grounding verdict */}
      <div>
        <div className="t-eyebrow mb-2 text-cyan">grounding</div>
        {!g ? (
          <p className="font-mono text-[10px] text-bone-faint">nothing yet — ask a question</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.14em] ${
                  g.status === 'grounded'
                    ? 'border-good/40 text-good'
                    : g.status === 'refused'
                      ? 'border-danger/45 text-danger'
                      : 'border-bone/20 text-bone-dim'
                }`}
              >
                {g.status === 'grounded' ? <ShieldCheck size={11} /> : g.status === 'refused' ? <ShieldAlert size={11} /> : <MessageCircle size={11} />}
                {g.status === 'grounded' ? 'GROUNDED' : g.status === 'refused' ? `REFUSED · ${REASON[g.reason!]}` : 'SOCIAL · NO POLICY'}
              </span>
              <span className="border border-bone/12 px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.12em] text-bone-faint">
                intent · {g.intent}
              </span>
              <span className="border border-bone/12 px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.12em] text-bone-faint">
                {reply!.source === 'llm' ? 'model wrote reply' : g.gatedBeforeModel ? 'model not called' : 'local composer'}
              </span>
            </div>
            <p className="mt-2 font-sans text-[12px] font-light leading-relaxed text-bone-dim">{g.explanation}</p>

            {g.status !== 'social' && (
              <div className="mt-3">
                <div className="relative h-[6px] overflow-visible rail">
                  <div
                    className={`h-full ${g.status === 'grounded' ? 'bg-good' : 'bg-danger'}`}
                    style={{ width: `${Math.max(1, g.confidence * 100)}%` }}
                  />
                  <div className="absolute -top-1 h-[14px] w-px bg-bone" style={{ left: `${g.floor * 100}%` }} />
                </div>
                <div className="mt-1 flex justify-between font-mono text-[9px] tabular-nums text-bone-faint">
                  <span>confidence {Math.round(g.confidence * 100)}</span>
                  <span>floor {Math.round(g.floor * 100)}</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* retrieval */}
      <div>
        <div className="t-eyebrow mb-2 text-cyan">retrieved context</div>
        {!reply ? (
          <p className="font-mono text-[10px] text-bone-faint">—</p>
        ) : hits.length ? (
          <div className="space-y-2.5">
            {hits.map((h) => {
              const used = g?.usedIds.includes(h.item.id)
              const k = resolveKnowledge(h.item.id) ?? h.item
              return (
                <div key={h.item.id} className={`border-l-2 pl-2.5 ${used ? 'border-good/60' : 'border-bone/10'}`}>
                  <div className="flex items-center gap-2 font-mono text-[10px]">
                    <span className="text-signal">{h.item.id}</span>
                    <span className="min-w-0 flex-1 truncate text-bone-dim">{h.item.topic}</span>
                    <span className="block h-[3px] w-14 shrink-0 overflow-hidden rail">
                      <span className="block h-full bg-cyan" style={{ width: `${h.relevance * 100}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-bone-faint">{h.relevance.toFixed(2)}</span>
                    {used && <span className="shrink-0 uppercase tracking-[0.12em] text-good">used</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] text-bone-faint">
                    matched: {h.matched.join(', ') || '—'} · bm25 {h.score.toFixed(2)}
                  </div>
                  {used && (
                    <p className="mt-1 font-sans text-[11px] font-light leading-snug text-bone-dim">
                      {k.rule} <span className="text-bone-faint">— {k.source.doc} § {k.source.section}</span>
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="font-mono text-[10px] text-bone-faint">no rule shares a meaningful term with the question</p>
        )}
        {reply && (
          <p className="mt-2 font-mono text-[9px] leading-relaxed text-bone-faint">
            query terms: {reply.retrieved.queryTerms.join(' · ') || '—'} · strength {reply.retrieved.signals.strength.toFixed(2)} ·
            coverage {reply.retrieved.signals.coverage.toFixed(2)} · specificity explained {Math.round(reply.retrieved.signals.specificity * 100)}% ·
            out-of-vocabulary {Math.round(reply.retrieved.signals.oovRatio * 100)}%
          </p>
        )}
      </div>

      <div>
        <div className="t-eyebrow mb-2 text-cyan">rules used</div>
        <p className="font-mono text-[10px] text-bone-dim">{g ? g.usedIds.join(', ') || 'none — no policy asserted' : '—'}</p>
      </div>

      <div>
        <div className="t-eyebrow mb-2 text-cyan">citations</div>
        {g?.usedIds.length ? (
          <div className="space-y-1">
            {g.usedIds.map((id) => {
              const k = resolveKnowledge(id)
              return (
                <p key={id} className="font-mono text-[9.5px] leading-relaxed text-bone-dim">
                  <span className="text-signal">{id}</span>{' '}
                  {k ? `${k.source.doc} § ${k.source.section}${k.source.page ? ` · p.${k.source.page}` : ''}` : 'unresolved'}
                </p>
              )
            })}
          </div>
        ) : (
          <p className="font-mono text-[10px] text-bone-faint">{g ? 'nothing cited — nothing asserted' : '—'}</p>
        )}
        {reply && (
          <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.12em] text-bone-faint">
            reply written by {reply.source === 'llm' ? llmLabel() : 'the deterministic grounded composer'}
          </p>
        )}
      </div>

      <div>
        <div className="t-eyebrow mb-2 text-cyan">system prompt sent to the model</div>
        {g?.gatedBeforeModel && (
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-danger">not sent — refused before the model was called</p>
        )}
        <pre className="whitespace-pre-wrap break-words font-mono text-[9.5px] leading-relaxed text-bone-faint">
          {reply?.promptPreview || '—'}
        </pre>
      </div>
    </div>
  )
}
