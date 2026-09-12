/* ============================================================================
 * RESPONSIVE IMAGE PLUMBING
 *
 * `npm run assets` writes one baseline JPEG per asset at the largest size any
 * surface needs (characters 640x640, episodes 1280x720), and every surface used
 * to load exactly that file — a 58px intro avatar pulled the same ~52kB, 640px
 * JPEG as a 295px roster card. `npm run assets:optimize` derives a WebP ladder
 * beside each JPEG; this module turns an `ImageSpec.src` into the `srcSet` that
 * lets the browser pick the rung its rendered size actually needs.
 *
 * The JPEG stays the `<img src>` in every `<picture>`, so it remains the
 * fallback, the artwork is unchanged, and markup assertions that look for
 * `img[src^="/characters/"]` still hold.
 *
 * Anything that is not one of our own generated files — a customer's absolute
 * URL in an `ImageSpec` — gets `undefined` here and renders as a plain `<img>`.
 * ========================================================================== */

/** Keep in sync with SETS in scripts/optimizeAssets.mjs. */
export const CHARACTER_WIDTHS = [160, 320, 640] as const
export const EPISODE_WIDTHS = [640, 1280] as const

/** Only locally-served artwork under /characters or /episodes has a ladder. */
const LOCAL_ART = /^(\/(?:characters|episodes)\/[A-Za-z0-9_-]+)\.jpg$/

/**
 * `/characters/rick.jpg` -> `/characters/rick-160.webp 160w, ...`, or
 * `undefined` when the source has no generated derivatives.
 */
export function webpSrcSet(src: string | undefined, widths: readonly number[]): string | undefined {
  if (!src) return undefined
  const stem = LOCAL_ART.exec(src)?.[1]
  if (!stem) return undefined
  return widths.map((w) => `${stem}-${w}.webp ${w}w`).join(', ')
}

/* ------------------------------------------------------------------ preload */

/**
 * URLs we have already asked the browser for. The HTTP cache would dedupe a
 * repeat anyway, but this keeps us from allocating an Image per render.
 */
const asked = new Set<string>()

/**
 * Warm the cache for art the player is about to see — the next roster panel,
 * or the cast the intro screen will show — so the fade-in has nothing to wait
 * for. Deliberately `fetchPriority = 'low'`: this must never compete with the
 * artwork already on screen.
 *
 * Passing the same `srcSet`/`sizes` the component will render means the browser
 * resolves the identical candidate and the real `<img>` is a cache hit.
 */
export function preloadImage(src: string | undefined, widths: readonly number[], sizes: string): void {
  if (!src || typeof window === 'undefined' || typeof Image === 'undefined') return

  const srcSet = webpSrcSet(src, widths)
  const key = srcSet ? `${srcSet}|${sizes}` : src
  if (asked.has(key)) return
  asked.add(key)

  try {
    const img = new Image()
    img.decoding = 'async'
    // `fetchPriority` is not in every lib.dom we compile against.
    ;(img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low'
    if (srcSet) {
      img.sizes = sizes
      img.srcset = srcSet
    }
    // Also the fallback for browsers that ignore srcset (and our no-ladder case).
    img.src = src
  } catch {
    /* Preloading is an optimisation; never let it break a render. */
  }
}
