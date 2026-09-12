import { knowledgeBase } from '@/content/knowledge'
import { sourceDocs } from '@/content/sourceDocs'
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
