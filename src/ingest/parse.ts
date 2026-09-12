import type { SourceDoc } from '@/types'

/* ============================================================================
 * INGEST — company material to SourceDoc.
 *
 * Pure text work. No React, no database, no LLM: this stage decides only what
 * the document SAYS, never what it means. The Knowledge Agent reads the result.
 *
 * parseText() does the work and is what the tests exercise. parseFile() is the
 * thin browser wrapper that reads a File and delegates, so nothing here needs a
 * DOM to be verified.
 * ========================================================================== */

export type SupportedExtension = 'txt' | 'md' | 'srt' | 'vtt'

export type ParseErrorCode = 'unsupported_type' | 'empty_document' | 'file_too_large'

export class ParseError extends Error {
  constructor(
    readonly code: ParseErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ParseError'
  }
}

/** 2 MB of text. Beyond this the corpus wants chunking, not a bigger string. */
export const MAX_FILE_BYTES = 2_000_000

/** Transcripts have no pages; prose is counted at a conventional 500 words. */
const WORDS_PER_PAGE = 500

const EXTENSION_TYPE: Record<SupportedExtension, SourceDoc['type']> = {
  txt: 'handbook',
  md: 'handbook',
  srt: 'video',
  vtt: 'video',
}

export const SUPPORTED_EXTENSIONS = Object.keys(EXTENSION_TYPE) as SupportedExtension[]

export interface ParseMeta {
  /** Original filename, including extension — drives type detection and id. */
  name: string
  /** Overrides the extension-derived SourceDoc type when the caller knows better. */
  type?: SourceDoc['type']
  /** Overrides the derived id. */
  id?: string
}

/* ------------------------------------------------------------------ helpers */

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase()
}

const isSupported = (ext: string): ext is SupportedExtension =>
  (SUPPORTED_EXTENSIONS as string[]).includes(ext)

/** Stable, readable id from the filename: 'Security Handbook v4.2.md' -> 'security-handbook-v4-2'. */
export function slugifyName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '')
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'document'
}

const CONTROL_CHARS = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]', 'g')
const ZERO_WIDTH = new RegExp('[\u200B-\u200D\uFEFF]', 'g')

/**
 * Collapses runs of spaces and single line breaks, but keeps blank lines as
 * paragraph boundaries — paragraph structure is signal for the segmenter, and
 * flattening everything to one line loses it.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(ZERO_WIDTH, '')
    .split(/\n{2,}/)
    .map((para) => para.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

/* -------------------------------------------------------------- subtitles */

const TIMESTAMP_LINE = /-->/
const SEQUENCE_LINE = /^\d+$/
/** HTML/VTT cue tags (<i>, <v Speaker>) and ASS override blocks ({\an8}). */
const MARKUP_TAGS = /<[^>]*>|\{\\[^}]*\}/g
const VTT_BLOCK_HEADER = /^(WEBVTT|NOTE|STYLE|REGION)\b/

/**
 * SRT and VTT reduce to their spoken text: sequence numbers, cue timings, cue
 * settings and markup carry no meaning once the transcript is prose.
 *
 * Consecutive duplicate lines are dropped because rolling captions repeat each
 * line across cues, which would otherwise triple-count every sentence.
 */
export function stripSubtitles(raw: string): string {
  const out: string[] = []
  let skippingBlock = false
  let lastText = ''

  for (const rawLine of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()

    if (!line) {
      skippingBlock = false
      out.push('')
      continue
    }
    if (VTT_BLOCK_HEADER.test(line)) {
      skippingBlock = true
      continue
    }
    if (skippingBlock) continue
    if (TIMESTAMP_LINE.test(line)) continue
    if (SEQUENCE_LINE.test(line)) continue

    const cleaned = line.replace(MARKUP_TAGS, '').replace(/\s+/g, ' ').trim()
    if (!cleaned) continue
    // Compare against the last spoken line, not the last array slot: rolling
    // captions repeat a line in the NEXT cue, with a blank line between.
    if (cleaned === lastText) continue
    lastText = cleaned
    out.push(cleaned)
  }

  return out.join('\n')
}

/* -------------------------------------------------------------- markdown */

/**
 * Markdown to plain prose. Structural markers go; the words they wrapped stay,
 * because the extractor cares about the normative sentence, not the formatting.
 *
 * Line-prefix matching uses [ \t] rather than \s: \s matches newlines, so a
 * leading-whitespace allowance would eat the blank line above a list and merge
 * it into the previous paragraph.
 */
export function stripMarkdown(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^~~~[^\n]*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^[ \t]{0,3}([-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}([-*_])[ \t]*(\1[ \t]*){2,}$/gm, '')
    .replace(/^[ \t]{0,3}\|.*\|[ \t]*$/gm, (row) =>
      /^[\s|:-]+$/.test(row) ? '' : row.replace(/\|/g, ' ').trim(),
    )
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
}

/* ----------------------------------------------------------------- parsing */

/**
 * The real entry point. Synchronous and side-effect free so it can be called
 * from a test, a script, or a browser upload handler identically.
 */
export function parseText(content: string, meta: ParseMeta): SourceDoc {
  const ext = extensionOf(meta.name)

  if (!isSupported(ext)) {
    throw new ParseError(
      'unsupported_type',
      `Unsupported file type ${ext ? `".${ext}"` : `(no extension on "${meta.name}")`}. Supported: ${SUPPORTED_EXTENSIONS.map((e) => `.${e}`).join(', ')}`,
    )
  }

  const byteLength = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(content).length : content.length
  if (byteLength > MAX_FILE_BYTES) {
    throw new ParseError(
      'file_too_large',
      `"${meta.name}" is ${(byteLength / 1_000_000).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1_000_000} MB`,
    )
  }

  const stripped =
    ext === 'srt' || ext === 'vtt' ? stripSubtitles(content) : ext === 'md' ? stripMarkdown(content) : content

  const text = normalizeWhitespace(stripped)
  if (!text) {
    throw new ParseError('empty_document', `"${meta.name}" contains no readable text after parsing`)
  }

  const type = meta.type ?? EXTENSION_TYPE[ext]
  const words = text.split(/\s+/).length

  return {
    id: meta.id ?? slugifyName(meta.name),
    name: meta.name,
    type,
    // Transcripts are timed, not paginated — the existing video doc uses 0.
    pages: type === 'video' ? 0 : Math.max(1, Math.ceil(words / WORDS_PER_PAGE)),
    // SourceDoc carries one text field, and it is what the Knowledge Agent
    // reads, so the full parsed document goes here rather than a preview.
    excerpt: text,
    yields: [],
  }
}

/** Browser wrapper: read the File, then hand off to parseText. */
export async function parseFile(file: File, meta: Partial<ParseMeta> = {}): Promise<SourceDoc> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ParseError(
      'file_too_large',
      `"${file.name}" is ${(file.size / 1_000_000).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1_000_000} MB`,
    )
  }
  const content = await file.text()
  return parseText(content, { ...meta, name: meta.name ?? file.name })
}
