import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createStreamingValueController } from '@/dianzhi/ui/streaming-value-controller'

/**
 * Distance from the bottom edge (px) at which the Side Panel conversation view
 * still counts as "pinned to the latest message". While pinned, new streamed
 * content glides the view to the latest bottom; scrolling farther up unpins so
 * the user can read history without being yanked back down.
 */
export const SCROLL_FOLLOW_THRESHOLD = 150

export function isNearBottom(container: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <= SCROLL_FOLLOW_THRESHOLD
  )
}

export interface ScrollFollowOptions {
  /** Jump straight to the bottom instead of gliding (`prefers-reduced-motion`). */
  reducedMotion: boolean
  /** Conversation messages; a fresh reference (every snapshot update) re-runs the follow. */
  messages: readonly unknown[] | null | undefined
  /** `${conversationId}:${activeToolId}` used to detect entering chat / switching tools. */
  viewKey: string
}

/**
 * Smoothly follows the latest message in the Side Panel history while the user
 * is near the bottom (within `SCROLL_FOLLOW_THRESHOLD` px). Content growth while
 * pinned glides the scroll position at a rate adapted to recent growth — the
 * same feel as the content popover's animated height. Scrolling farther up
 * pauses following so history reads stay put; entering chat or switching tools
 * (a `viewKey` change) anchors instantly. Reduced motion jumps instead of
 * gliding. Returns the `onScroll` handler that keeps the pinned state in sync
 * with the user's position.
 */
export function useScrollFollow(
  containerRef: RefObject<HTMLDivElement | null>,
  { reducedMotion, messages, viewKey }: ScrollFollowOptions
): () => void {
  const controllerRef = useRef(
    createStreamingValueController(0, { minimumSpeed: 480, maximumSpeed: 2400 })
  )
  const pinnedRef = useRef(true)
  const animationFrameRef = useRef<number | null>(null)
  const previousViewKeyRef = useRef(viewKey)

  const stopAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  const onScroll = useCallback(() => {
    const container = containerRef.current
    if (container) pinnedRef.current = isNearBottom(container)
  }, [containerRef])

  // Entering chat or switching tools anchors at the latest message.
  useLayoutEffect(() => {
    if (previousViewKeyRef.current === viewKey) return
    previousViewKeyRef.current = viewKey
    pinnedRef.current = true
    const container = containerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [containerRef, viewKey])

  // Follow new content while pinned: glide the scroll position toward the
  // newest bottom each frame at a speed that tracks recent content growth.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !pinnedRef.current || !messages || messages.length === 0) return
    const target = Math.max(0, container.scrollHeight - container.clientHeight)
    if (reducedMotion) {
      container.scrollTop = target
      return
    }
    const now = performance.now()
    // The controller's value can be stale (a view anchor or the user's wheel
    // moved the scroll position outside the animation loop), so seed the chase
    // at the current position before observing the new target.
    controllerRef.current.setValue(container.scrollTop)
    controllerRef.current.observeTarget(target, now)
    const animate = (frameNow: number) => {
      if (!pinnedRef.current) {
        stopAnimation()
        return
      }
      container.scrollTop = controllerRef.current.advance(frameNow)
      if (!controllerRef.current.isSettled()) {
        animationFrameRef.current = window.requestAnimationFrame(animate)
      }
    }
    animationFrameRef.current = window.requestAnimationFrame(animate)
    return stopAnimation
  }, [containerRef, messages, reducedMotion, stopAnimation])

  useEffect(() => stopAnimation, [stopAnimation])

  return onScroll
}
