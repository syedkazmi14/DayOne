import { useLayoutEffect, useRef, useState } from 'react'

/** Used for the first paint only, before the real width is measured. */
const FALLBACK_W = 360

/**
 * The width a status bar has to work with, kept current as the viewport
 * changes. Wide designs lay their track out against this rather than a fixed
 * number. Zero readings (no layout engine, e.g. jsdom) keep the fallback.
 */
export function useTrackWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(FALLBACK_W)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.clientWidth > 0) setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => entry.contentRect.width > 0 && setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}
