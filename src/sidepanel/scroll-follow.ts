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
  contentRef: RefObject<HTMLDivElement | null>
  messages: readonly unknown[] | null | undefined
  reducedMotion: boolean
  viewKey: string
}

export interface ScrollFollowBindings {
  onScroll(): void
}

export function useScrollFollow(
  containerRef: RefObject<HTMLDivElement | null>,
  { contentRef, messages, reducedMotion, viewKey }: ScrollFollowOptions
): ScrollFollowBindings {
  const pinnedRef = useRef(true)
  const previousHeightRef = useRef(0)
  const programmaticScrollTopRef = useRef<number | null>(null)
  const previousViewKeyRef = useRef(viewKey)
  const animationFrameRef = useRef<number | null>(null)
  const animationTargetRef = useRef<number | null>(null)

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
    animationTargetRef.current = null
  }, [])

  const scrollToBottom = useCallback(
    (immediate: boolean) => {
      const container = containerRef.current
      if (!container) return
      const target = Math.max(0, container.scrollHeight - container.clientHeight)
      if (immediate) {
        cancelAnimation()
        programmaticScrollTopRef.current = target
        container.scrollTop = target
        return
      }
      animationTargetRef.current = target
      if (animationFrameRef.current !== null) return
      let lastNow: number | null = null
      const advance = (now: number) => {
        const element = containerRef.current
        const latestTarget = animationTargetRef.current
        if (!element || latestTarget === null) return
        const elapsed = lastNow === null ? 16 : Math.min(48, now - lastNow)
        lastNow = now
        const distance = latestTarget - element.scrollTop
        const step =
          Math.sign(distance) *
          Math.min(Math.abs(distance), (Math.max(24, Math.abs(distance) * 0.28) * elapsed) / 16)
        const next = Math.abs(distance) <= 1 ? latestTarget : element.scrollTop + step
        programmaticScrollTopRef.current = next
        element.scrollTop = next
        if (next === latestTarget) {
          animationFrameRef.current = null
          animationTargetRef.current = null
          return
        }
        animationFrameRef.current = requestAnimationFrame(advance)
      }
      animationFrameRef.current = requestAnimationFrame(advance)
    },
    [cancelAnimation, containerRef]
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
    if (!pinnedRef.current) cancelAnimation()
  }, [cancelAnimation, containerRef])

  useLayoutEffect(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    previousHeightRef.current = container.scrollHeight
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const currentHeight = container.scrollHeight
      const grew = currentHeight > previousHeightRef.current
      const wasNearBottom =
        previousHeightRef.current - container.scrollTop - container.clientHeight <
        SCROLL_FOLLOW_THRESHOLD
      previousHeightRef.current = currentHeight
      if (!grew || !pinnedRef.current || !wasNearBottom) {
        if (!wasNearBottom) pinnedRef.current = false
        return
      }
      scrollToBottom(reducedMotion)
    })
    observer.observe(content)
    return () => {
      observer.disconnect()
      cancelAnimation()
    }
  }, [cancelAnimation, containerRef, contentRef, reducedMotion, viewKey, scrollToBottom])

  useLayoutEffect(() => {
    if (previousViewKeyRef.current === viewKey) return
    previousViewKeyRef.current = viewKey
    pinnedRef.current = true
    scrollToBottom(true)
  }, [scrollToBottom, viewKey])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !pinnedRef.current || !messages || messages.length === 0) return
    scrollToBottom(reducedMotion)
  }, [containerRef, messages, reducedMotion, scrollToBottom])

  return { onScroll }
}
