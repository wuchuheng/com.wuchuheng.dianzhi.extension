import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Distance from the bottom edge (px) at which the popover chat view still
 * counts as "pinned to the latest message". While pinned, streamed replies
 * keep the view scrolled to the bottom; scrolling farther up unpins so the
 * user can read history without being yanked back down.
 */
export const SCROLL_GUARD_THRESHOLD = 50

export function isNearBottom(container: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <= SCROLL_GUARD_THRESHOLD
  )
}

export interface ScrollGuardOptions {
  visible: boolean
  mode: 'card' | 'chat'
  streaming: boolean
  /** Conversation messages; a fresh reference (every snapshot update) re-runs the follow. */
  messages: readonly unknown[] | null | undefined
}

/**
 * Keeps the popover chat body pinned to the latest message while the user is
 * near the bottom (within `SCROLL_GUARD_THRESHOLD` px of it) and holds the
 * scroll position otherwise ("scroll guard"). While pinned, streamed chunks
 * are followed instantly so the newest lines stay visible in real time;
 * discrete updates (a sent message, a completed reply, an error banner)
 * smooth-scroll instead. Returns the `onScroll` handler that keeps the
 * pinned state in sync with the user's position.
 */
export function useScrollGuard(
  containerRef: RefObject<HTMLDivElement | null>,
  { visible, mode, streaming, messages }: ScrollGuardOptions
): () => void {
  const pinnedRef = useRef(true)

  const onScroll = useCallback(() => {
    const container = containerRef.current
    if (container) pinnedRef.current = isNearBottom(container)
  }, [containerRef])

  // Entering chat (or opening the popover in it) anchors at the latest
  // message and treats the view as pinned.
  useLayoutEffect(() => {
    if (!visible || mode !== 'chat') return
    pinnedRef.current = true
    const container = containerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [containerRef, mode, visible])

  // Follow new content while pinned: instantly during a stream (the target
  // keeps moving), smoothly for discrete updates where the transition shows.
  useLayoutEffect(() => {
    if (!visible || mode !== 'chat' || !messages || messages.length === 0) return
    const container = containerRef.current
    if (!container || !pinnedRef.current) return
    if (streaming) {
      container.scrollTop = container.scrollHeight
    } else {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }
  }, [containerRef, messages, mode, streaming, visible])

  return onScroll
}
