import { concepts } from '@/content/knowledge'
import type { ConceptId, KnowledgeItem, Severity } from '@/types'

/* ============================================================================
 * KNOWLEDGE VALIDATION
 *
 * The gate between "text a model produced from a company document" and "content
 * the game is allowed to cite". Pure: no logging, no throwing, no process exit.
 * Callers decide what a failure means — scripts/validate.ts prints and exits,
 * the ingest path will reject the item and keep going.
 *
 * The rules here are the ones scripts/validate.ts has always enforced. They are
 * stated once, in this module, so the authoring path and the content suite
 * cannot drift apart.
 * ========================================================================== */

export interface ValidationError {
  /** Knowledge id when known, else a positional marker like 'item[3]'. */
  itemId: string
  field: string
  message: string
}

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']

const conceptIds = new Set<string>(concepts.map((c) => c.id))

/* --------------------------------------------------------------- sanitising */

/** Upper bounds per field. Generous — these reject runaway output, not prose. */
export const FIELD_LIMITS = {
  id: 64,
  topic: 200,
  rule: 1200,
  commonMistake: 600,
  consequence: 1200,
  edgeCase: 600,
  action: 300,
  sourceDoc: 300,
  sourceSection: 200,
} as const

/** C0/C1 control bytes, minus the whitespace ones \t \n \r that \s+ handles. */
const CONTROL_CHARS = new RegExp('[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]', 'g')
/** Zero-width and BOM characters: invisible, and they survive into prompts. */
const ZERO_WIDTH = new RegExp('[\u200B-\u200D\uFEFF]', 'g')

/**
 * Strips control characters and normalises whitespace. Text arriving from an
 * extracted PDF or a model completion carries stray control bytes, zero-width
 * characters and hard line breaks that survive all the way into a system prompt
 * and a rendered citation.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(CONTROL_CHARS, '')
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sanitises actual strings only. Anything else passes through untouched, so
 *  validateKnowledgeItem still sees the wrong type and reports it rather than
 *  having it quietly coerced into something that passes. */
const sanitizeIfString = (v: unknown): unknown => (typeof v === 'string' ? sanitizeText(v) : v)

/** Sanitises a list of strings, dropping blanks. Non-arrays pass through. */
const sanitizeList = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sanitizeIfString).filter((x) => x !== '') : v

/**
 * Field-wise sanitise. Returns a new item; never mutates the input.
 *
 * Tolerates malformed input by design: this runs on model output, where a field
 * may be missing or the wrong type entirely. Nothing here throws — a bad shape
 * is passed through for validateKnowledgeItem to reject with a real message,
 * rather than crashing the whole ingest run on a TypeError.
 */
export function sanitizeKnowledgeItem(item: KnowledgeItem): KnowledgeItem {
  if (!item || typeof item !== 'object') return item
  const source: unknown = item.source
  return {
    ...item,
    id: sanitizeIfString(item.id),
    topic: sanitizeIfString(item.topic),
    rule: sanitizeIfString(item.rule),
    commonMistake: sanitizeIfString(item.commonMistake),
    consequence: sanitizeIfString(item.consequence),
    edgeCases: sanitizeList(item.edgeCases),
    recommended: sanitizeList(item.recommended),
    prohibited: sanitizeList(item.prohibited),
    source:
      source && typeof source === 'object'
        ? {
            ...(source as KnowledgeItem['source']),
            doc: sanitizeIfString((source as KnowledgeItem['source']).doc),
            section: sanitizeIfString((source as KnowledgeItem['source']).section),
          }
        : source,
  } as KnowledgeItem
}

/* --------------------------------------------------------------- validation */

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

/**
 * Validates one item in isolation. Cross-item rules (unique ids, concept
 * coverage) live in validateKnowledgeSet.
 *
 * `ref` labels the item in errors when its id is missing or not a string.
 */
export function validateKnowledgeItem(item: KnowledgeItem, ref?: string): ValidationError[] {
  const errors: ValidationError[] = []
  const id = isNonEmptyString(item?.id) ? item.id : (ref ?? '<unknown>')
  const err = (field: string, message: string) => errors.push({ itemId: id, field, message })

  if (!item || typeof item !== 'object') {
    return [{ itemId: id, field: '<root>', message: 'not an object' }]
  }

  /* required strings */
  const strings: [keyof KnowledgeItem & string, number][] = [
    ['id', FIELD_LIMITS.id],
    ['topic', FIELD_LIMITS.topic],
    ['rule', FIELD_LIMITS.rule],
    ['commonMistake', FIELD_LIMITS.commonMistake],
    ['consequence', FIELD_LIMITS.consequence],
  ]
  for (const [field, limit] of strings) {
    const value = item[field]
    if (!isNonEmptyString(value)) err(field, 'required non-empty string')
    else if (value.length > limit) err(field, `exceeds ${limit} characters (${value.length})`)
  }

  /* severity — retrieval multiplies by a per-severity constant with no default,
   * so an unknown value silently produces NaN scores rather than an error. */
  if (!SEVERITIES.includes(item.severity)) {
    err('severity', `must be one of ${SEVERITIES.join(' | ')}, got ${JSON.stringify(item.severity)}`)
  }

  /* concept taxonomy */
  if (!Array.isArray(item.concepts) || item.concepts.length === 0) {
    err('concepts', 'required non-empty array')
  } else {
    for (const c of item.concepts) {
      if (!conceptIds.has(c)) err('concepts', `unknown concept ${JSON.stringify(c)}`)
    }
  }

  /* do / do-not — a rule with neither is not actionable */
  for (const field of ['recommended', 'prohibited'] as const) {
    const arr = item[field]
    if (!Array.isArray(arr) || arr.length === 0) {
      err(field, 'required non-empty array')
    } else {
      arr.forEach((a, i) => {
        if (!isNonEmptyString(a)) err(field, `[${i}] must be a non-empty string`)
        else if (a.length > FIELD_LIMITS.action) err(field, `[${i}] exceeds ${FIELD_LIMITS.action} characters`)
      })
    }
  }

  if (!Array.isArray(item.edgeCases)) {
    err('edgeCases', 'required array')
  } else {
    item.edgeCases.forEach((e, i) => {
      if (!isNonEmptyString(e)) err('edgeCases', `[${i}] must be a non-empty string`)
      else if (e.length > FIELD_LIMITS.edgeCase) err('edgeCases', `[${i}] exceeds ${FIELD_LIMITS.edgeCase} characters`)
    })
  }

  /* citability — an item that cannot be cited is unusable downstream, because a
   * character that cannot cite is made to say it does not know. */
  if (!item.source || typeof item.source !== 'object') {
    err('source', 'required object with doc and section')
  } else {
    if (!isNonEmptyString(item.source.doc)) err('source.doc', 'required — item is not citable')
    else if (item.source.doc.length > FIELD_LIMITS.sourceDoc)
      err('source.doc', `exceeds ${FIELD_LIMITS.sourceDoc} characters`)

    if (!isNonEmptyString(item.source.section)) err('source.section', 'required — item is not citable')
    else if (item.source.section.length > FIELD_LIMITS.sourceSection)
      err('source.section', `exceeds ${FIELD_LIMITS.sourceSection} characters`)

    if (item.source.page !== undefined && (!Number.isFinite(item.source.page) || item.source.page < 0)) {
      err('source.page', 'must be a non-negative number when present')
    }
  }

  return errors
}

export interface KnowledgeSetResult {
  errors: ValidationError[]
  /** Concepts in the taxonomy that no item in this set covers. */
  uncoveredConcepts: ConceptId[]
  duplicateIds: string[]
}

/**
 * Validates a whole knowledge base: every item, plus the cross-item rules.
 *
 * `requireFullCoverage` reflects a real constraint — the episode graph assumes
 * every concept has knowledge behind it, so the shipped base must cover all
 * seven. A partial ingest batch legitimately does not, hence the flag.
 */
export function validateKnowledgeSet(
  items: KnowledgeItem[],
  opts: { requireFullCoverage?: boolean } = {},
): KnowledgeSetResult {
  const errors: ValidationError[] = []

  if (!Array.isArray(items)) {
    return {
      errors: [{ itemId: '<set>', field: '<root>', message: 'expected an array of knowledge items' }],
      uncoveredConcepts: [],
      duplicateIds: [],
    }
  }

  items.forEach((item, i) => errors.push(...validateKnowledgeItem(item, `item[${i}]`)))

  const seen = new Set<string>()
  const duplicateIds: string[] = []
  for (const item of items) {
    const id = item?.id
    if (!isNonEmptyString(id)) continue
    if (seen.has(id) && !duplicateIds.includes(id)) duplicateIds.push(id)
    seen.add(id)
  }
  for (const id of duplicateIds) {
    errors.push({ itemId: id, field: 'id', message: 'duplicate knowledge id' })
  }

  const covered = new Set(items.flatMap((k) => (Array.isArray(k?.concepts) ? k.concepts : [])))
  const uncoveredConcepts = concepts.map((c) => c.id).filter((id) => !covered.has(id))

  if (opts.requireFullCoverage && uncoveredConcepts.length) {
    errors.push({
      itemId: '<set>',
      field: 'concepts',
      message: `concepts with no knowledge: ${uncoveredConcepts.join(', ')}`,
    })
  }

  return { errors, uncoveredConcepts, duplicateIds }
}

/** Convenience for the ingest path: sanitise, validate, split. */
export function partitionValidItems(items: KnowledgeItem[]): {
  valid: KnowledgeItem[]
  rejected: { item: KnowledgeItem; errors: ValidationError[] }[]
} {
  const valid: KnowledgeItem[] = []
  const rejected: { item: KnowledgeItem; errors: ValidationError[] }[] = []
  items.forEach((raw, i) => {
    const item = sanitizeKnowledgeItem(raw)
    const errors = validateKnowledgeItem(item, `item[${i}]`)
    if (errors.length) rejected.push({ item, errors })
    else valid.push(item)
  })
  return { valid, rejected }
}
