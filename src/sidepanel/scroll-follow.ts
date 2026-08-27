import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

export const SCROLL_FOLLOW_THRESHOLD = 150

interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

export function isNearBottom(container: ScrollMetrics): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_FOLLOW_THRESHOLD
  )
}

export function syncScrollForHeightGrowth(container: ScrollMetrics, heightDelta: number): boolean {
  if (heightDelta <= 0) return false
  const distanceBeforeGrowth =
    container.scrollHeight - heightDelta - container.scrollTop - container.clientHeight
  if (distanceBeforeGrowth >= SCROLL_FOLLOW_THRESHOLD) return false
  container.scrollTop += heightDelta
  return true
}

export interface ScrollFollowOptions {
  messages: readonly unknown[] | null | undefined
  reducedMotion: boolean
  viewKey: string
}

export interface ScrollFollowBindings {
  onScroll(): void
  onStreamingHeightDelta(delta: number): void
}

export function useScrollFollow(
  containerRef: RefObject<HTMLDivElement | null>,
  { messages, viewKey }: ScrollFollowOptions
): ScrollFollowBindings {
  const pinnedRef = useRef(true)
  const programmaticScrollTopRef = useRef<number | null>(null)
  const previousViewKeyRef = useRef(viewKey)

  const setProgrammaticScrollTop = useCallback(
    (nextScrollTop: number) => {
      const container = containerRef.current
      if (!container) return
      programmaticScrollTopRef.current = nextScrollTop
      container.scrollTop = nextScrollTop
    },
    [containerRef]
  )

  const onScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const expected = programmaticScrollTopRef.current
    if (expected !== null && Math.abs(container.scrollTop - expected) <= 1) {
      programmaticScrollTopRef.current = null
      return
    }
    programmaticScrollTopRef.current = null
    pinnedRef.current = isNearBottom(container)
  }, [containerRef])

  const onStreamingHeightDelta = useCallback(
    (heightDelta: number) => {
      const container = containerRef.current
      if (!container || !pinnedRef.current) return
      if (!syncScrollForHeightGrowth(container, heightDelta)) {
        pinnedRef.current = false
        return
      }
      programmaticScrollTopRef.current = container.scrollTop
    },
    [containerRef]
  )

  useLayoutEffect(() => {
    if (previousViewKeyRef.current === viewKey) return
    previousViewKeyRef.current = viewKey
    pinnedRef.current = true
    const container = containerRef.current
    if (container) setProgrammaticScrollTop(container.scrollHeight)
  }, [containerRef, setProgrammaticScrollTop, viewKey])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !pinnedRef.current || !messages || messages.length === 0) return
    setProgrammaticScrollTop(Math.max(0, container.scrollHeight - container.clientHeight))
  }, [containerRef, messages, setProgrammaticScrollTop])

  return { onScroll, onStreamingHeightDelta }
}
