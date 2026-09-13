import { knowledgeBase } from '@/content/knowledge'
import { sourceDocs } from '@/content/sourceDocs'
import { MEDIA_BASE, mediaHealth, subscribeMediaStatus } from '@/media/mediaStatus'
import type { KnowledgeItem, SourceDoc } from '@/types'

/* ============================================================================
 * CONTENT STORE — the persistence seam.
 *
 * Mirrors the shape of src/ai/llm.ts: one narrow interface, a default that
 * needs no configuration, and an honest label for which tier is running. The
 * game reads content through this; where the content physically lives stops
 * mattering above this line.
 *
 * The static store is the DEFAULT and wraps the hardcoded arrays, so with no
 * database configured the app behaves exactly as it does today — the offline
 * demo is a product promise, not a fallback.
 * ========================================================================== */

export interface ContentStore {
  /** Which backing this instance reads. The UI may state the tier. */
  readonly kind: ContentStoreKind
  listKnowledge(): Promise<KnowledgeItem[]>
  saveKnowledge(items: KnowledgeItem[]): Promise<void>
  listSourceDocs(): Promise<SourceDoc[]>
  saveSourceDoc(doc: SourceDoc): Promise<void>
  /** Removes an uploaded document (and its stored text). */
  deleteSourceDoc(id: string): Promise<void>
  deleteKnowledge(ids: string[]): Promise<void>
}

export type ContentStoreKind = 'static' | 'db'

export class ReadOnlyStoreError extends Error {
  constructor(operation: string) {
    super(
      `${operation} is not supported by the static content store. ` +
        'Content is compiled into the bundle; configure a database-backed store to write.',
    )
    this.name = 'ReadOnlyStoreError'
  }
}

/**
 * Reads the compiled-in content. Writes are refused rather than silently
 * dropped: a caller that thinks it persisted something and did not is worse
 * than one that gets told the store is read-only.
 */
export function createStaticStore(
  seed: { knowledge?: KnowledgeItem[]; docs?: SourceDoc[] } = {},
): ContentStore {
  const knowledge = seed.knowledge ?? knowledgeBase
  const docs = seed.docs ?? sourceDocs
  return {
    kind: 'static',
    listKnowledge: async () => [...knowledge],
    listSourceDocs: async () => [...docs],
    saveKnowledge: async () => {
      throw new ReadOnlyStoreError('saveKnowledge')
    },
    saveSourceDoc: async () => {
      throw new ReadOnlyStoreError('saveSourceDoc')
    },
    deleteSourceDoc: async () => {
      throw new ReadOnlyStoreError('deleteSourceDoc')
    },
    deleteKnowledge: async () => {
      throw new ReadOnlyStoreError('deleteKnowledge')
    },
  }
}

export const staticStore = createStaticStore()

let active: ContentStore = staticStore

/** The store the app should read from. Static until something replaces it. */
export const contentStore = (): ContentStore => active

/** Swap the backing store. Called by composition roots and tests, not by UI. */
export function setContentStore(store: ContentStore): void {
  active = store
}

export const contentStoreLabel = (): string =>
  active.kind === 'db' ? 'DATABASE' : 'STATIC BUNDLE'

/* -------------------------------------------------------------- db-backed */

/**
 * Talks to server/mediaServer.mjs's /api/media/content/* routes, which
 * persist to Supabase Postgres when the server has SUPABASE_SECRET_KEY, and
 * to a local SQLite file (node:sqlite — no dependency, no account) otherwise.
 * A Studio upload and its extracted knowledge now survive a reload; without
 * the media server running, `active` never switches away from the static
 * store below, so nothing here changes for anyone not running it.
 */
export function createHttpContentStore(base: string): ContentStore {
  return {
    kind: 'db',
    async listKnowledge() {
      const res = await fetch(`${base}/content/knowledge`)
      if (!res.ok) return []
      return ((await res.json()) as { items?: KnowledgeItem[] }).items ?? []
    },
    async saveKnowledge(items) {
      await fetch(`${base}/content/knowledge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items }),
      })
    },
    async listSourceDocs() {
      const res = await fetch(`${base}/content/docs`)
      if (!res.ok) return []
      return ((await res.json()) as { docs?: SourceDoc[] }).docs ?? []
    },
    async saveSourceDoc(doc) {
      await fetch(`${base}/content/docs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(doc),
      })
    },
    async deleteSourceDoc(id) {
      await fetch(`${base}/content/docs/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    async deleteKnowledge(ids) {
      await fetch(`${base}/content/knowledge/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
    },
  }
}

/**
 * Switch to the database-backed store the moment the media server confirms
 * it is up — same discovery the video/image/audio tiers already use, so this
 * needs no separate probe. Runs once immediately (the health probe may have
 * already landed) and again on every status change.
 */
function syncWithMediaServer(): void {
  if (mediaHealth()?.content.configured) setContentStore(createHttpContentStore(MEDIA_BASE))
}

if (typeof window !== 'undefined') {
  syncWithMediaServer()
  subscribeMediaStatus(syncWithMediaServer)
}
