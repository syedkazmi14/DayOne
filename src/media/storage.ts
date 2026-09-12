import type { SourceDoc } from '@/types'
import { MEDIA_BASE, mediaHealth } from './mediaStatus'

/**
 * Persist an uploaded document under company/knowledge/. Returns the storage
 * key, or null when there is no media server — the caller says so rather than
 * implying the file was saved.
 */
export async function storeSourceDoc(doc: SourceDoc): Promise<string | null> {
  if (!mediaHealth()) return null
  try {
    const res = await fetch(`${MEDIA_BASE}/knowledge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ docId: doc.id, text: doc.excerpt }),
    })
    if (!res.ok) return null
    return ((await res.json()) as { storageKey?: string }).storageKey ?? null
  } catch {
    return null
  }
}
