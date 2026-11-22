import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * Scroll to the element whose id matches `location.hash`, on mount and on
 * every hash navigation (including clicking the same hash link again, via
 * `location.key`). Client-side routes and lazily rendered pages mount after
 * the browser's own fragment jump, so it would otherwise miss the target.
 * A plain router effect: safe on static pages (no DeepSpace providers), and
 * a no-op during prerender, where effects don't run.
 */
export function useScrollToHash(): void {
  const { hash, key } = useLocation()
  useEffect(() => {
    if (!hash || hash.length < 2) return
    let id: string
    try {
      id = decodeURIComponent(hash.slice(1))
    } catch {
      return
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // One frame later, so layout (fonts, images) has settled.
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: reduce ? 'instant' : 'smooth' })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [hash, key])
}
